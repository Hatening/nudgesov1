import { test, expect } from '@playwright/test';

async function register(request, label) {
  const email = `c2c3-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  const response = await request.post('/api/v1/auth/register', {
    data: { email, password: 'TestPass123!' }
  });
  expect(response.status()).toBe(201);
  return response.json();
}

async function createSite(request, token, name) {
  const response = await request.post('/api/v1/sites', {
    headers: { authorization: `Bearer ${token}` },
    data: { name, industry_template: 'retail' }
  });
  expect(response.status()).toBe(201);
  return (await response.json()).site;
}

test.describe('C2 auth returnTo', () => {
  test('anonymous protected URL carries the exact returnTo into login', async ({ page }) => {
    await page.goto('/queue.html?from=c2');
    await expect(page).toHaveURL(/\/login\.html\?redirect=/);
    const redirect = new URL(page.url()).searchParams.get('redirect');
    expect(redirect).toBe('/queue.html?from=c2');
  });


  test('every protected surface carries its own returnTo', async ({ context }) => {
    const routes = ['/queue.html?tab=pending', '/insights.html?range=30d', '/manual.html', '/upload.html'];
    for (const route of routes) {
      const protectedPage = await context.newPage();
      await protectedPage.goto(route);
      await expect(protectedPage).toHaveURL(/\/login\.html\?redirect=/);
      expect(new URL(protectedPage.url()).searchParams.get('redirect')).toBe(route);
      await protectedPage.close();
    }
  });

  test('a successful login returns to the requested local URL', async ({ page, request }) => {
    const registration = await register(request, 'c2-success');
    await page.goto('/queue.html?from=c2-success');
    await expect(page).toHaveURL(/\/login\.html\?redirect=/);
    await page.locator('#email').fill(registration.user.email);
    await page.locator('#password').fill('TestPass123!');
    await page.locator('#loginBtn').click();
    await expect(page).toHaveURL(/\/queue\.html\?from=c2-success$/);
    await expect(page.locator('body')).not.toContainText('redirect=');
  });

  test('protocol-relative redirect cannot leave the origin', async ({ page, request }) => {
    const registration = await register(request, 'c2-open-redirect');
    await page.goto('/login.html?redirect=//evil.example/steal');
    const loginOrigin = new URL(page.url()).origin;
    await page.locator('#email').fill(registration.user.email);
    await page.locator('#password').fill('TestPass123!');
    await page.locator('#loginBtn').click();
    const finalUrl = new URL(page.url());
    expect(finalUrl.hostname).not.toContain('evil.example');
    expect(finalUrl.origin).toBe(loginOrigin);
  });

  test('encoded backslash redirect cannot leave the origin', async ({ page, request }) => {
    const registration = await register(request, 'c2-backslash');
    await page.goto('/login.html?redirect=/%5Cevil.example/steal');
    const loginOrigin = new URL(page.url()).origin;
    await page.locator('#email').fill(registration.user.email);
    await page.locator('#password').fill('TestPass123!');
    await page.locator('#loginBtn').click();
    const finalUrl = new URL(page.url());
    expect(finalUrl.hostname).not.toContain('evil.example');
    expect(finalUrl.origin).toBe(loginOrigin);
  });

  test('an expired token sends the protected page back to login with returnTo', async ({ page }) => {
    await page.goto('/login.html');
    await page.evaluate(() => localStorage.setItem('relaydesk_token', 'expired-or-invalid-token'));
    await page.goto('/queue.html?from=expired');
    await expect(page).toHaveURL(/\/login\.html\?redirect=/);
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/queue.html?from=expired');
    expect(await page.evaluate(() => localStorage.getItem('relaydesk_token'))).toBeNull();
  });
});

test.describe('C3 tenant isolation', () => {
  test('browser queue and tenant APIs never expose another tenant', async ({ page, request }) => {
    const accountA = await register(request, 'tenant-a');
    const accountB = await register(request, 'tenant-b');
    const tokenA = accountA.token || accountA.access_token;
    const tokenB = accountB.token || accountB.access_token;
    const siteA = await createSite(request, tokenA, `C3 Site A ${Date.now()}`);
    const siteB = await createSite(request, tokenB, `C3 Site B ${Date.now()}`);
    const markerA = `C3-A-${Date.now()}`;
    const markerB = `C3-B-${Date.now()}`;

    const messageA = await request.post(`/api/v1/public/${siteA.embed_key}/messages`, {
      data: { message: `${markerA} refund request order 12345` }
    });
    const messageB = await request.post(`/api/v1/public/${siteB.embed_key}/messages`, {
      data: { message: `${markerB} refund request order 67890` }
    });
    expect(messageA.status()).toBe(200);
    expect(messageB.status()).toBe(200);
    expect((await messageA.json()).escalation_id).toBeTruthy();
    expect((await messageB.json()).escalation_id).toBeTruthy();

    await page.goto('/login.html');
    await page.evaluate((token) => localStorage.setItem('relaydesk_token', token), tokenA);
    await page.goto('/queue.html?lang=en');
    await expect(page.locator('#escalationRows')).toContainText(markerA);
    await expect(page.locator('#escalationRows')).not.toContainText(markerB);

    await page.evaluate((token) => localStorage.setItem('relaydesk_token', token), tokenB);
    await page.reload();
    await expect(page.locator('#escalationRows')).toContainText(markerB);
    await expect(page.locator('#escalationRows')).not.toContainText(markerA);

    const crossSite = await request.post(`/api/v1/sites/${siteB.id}/kb/upload`, {
      headers: { authorization: `Bearer ${tokenA}` },
      data: { filename: 'cross.txt', title: 'cross', content: 'should never cross tenants' }
    });
    expect(crossSite.status()).toBe(404);

    const queueA = await request.get('/api/v1/escalations', {
      headers: { authorization: `Bearer ${tokenA}` }
    });
    const queueBodyA = await queueA.json();
    expect(JSON.stringify(queueBodyA)).not.toContain(markerB);

    const me = await request.get('/api/v1/auth/me', {
      headers: { authorization: `Bearer ${tokenA}` }
    });
    expect(me.status()).toBe(200);
    expect((await me.json()).user.tenant_id).toBe(accountA.user.tenant_id);
  });
});
