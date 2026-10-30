import { test, expect } from './helpers/evidence-test';

async function register(request, label) {
  const email = `c4c5-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
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

test.describe('C4 preview plan context', () => {
  test('Pro intent is preserved into onboarding without payment', async ({ page }) => {
    const paymentRequests = [];
    page.on('request', (request) => {
      if (/stripe|paypal|checkout|payment\/create/i.test(request.url())) paymentRequests.push(request.url());
    });
    await page.goto('/landing.html');
    const pro = page.locator('.price-card.pro a');
    await expect(pro).toHaveAttribute('href', /plan=pro/);
    await expect(pro).toHaveAttribute('href', /billing=monthly/);
    await pro.click();
    await expect(page).toHaveURL(/\/onboarding\.html\?.*plan=pro.*billing=monthly/);
    await expect(page.locator('#planContext')).toBeVisible();
    await expect(page.locator('#planContext')).toContainText(/Pro preview/i);
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('nudgeso_onboarding_state') || '{}'));
    expect(state.plan).toBe('pro');
    expect(state.billing).toBe('monthly');
    await page.reload();
    await expect(page.locator('#planContext')).toContainText(/Pro preview/i);
    expect(paymentRequests).toEqual([]);
  });

  test('yearly billing selection reaches the same preview context', async ({ page }) => {
    await page.goto('/landing.html');
    await page.locator('#billingSwitch').click();
    const pro = page.locator('.price-card.pro a');
    await expect(pro).toHaveAttribute('href', /billing=yearly/);
    await pro.click();
    await expect(page).toHaveURL(/\/onboarding\.html\?.*plan=pro.*billing=yearly/);
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('nudgeso_onboarding_state') || '{}'));
    expect(state.plan).toBe('pro');
    expect(state.billing).toBe('yearly');
  });
});

test.describe('C5 wizard state', () => {
  test('kb step survives refresh for the same tenant', async ({ page, request }) => {
    const registration = await register(request, 'wizard');
    const token = registration.token || registration.access_token;
    const site = await createSite(request, token, `C5 Site ${Date.now()}`);
    await page.goto('/login.html');
    await page.evaluate(({ token, siteId, tenantId }) => {
      localStorage.setItem('relaydesk_token', token);
      localStorage.setItem('nudgeso_onboarding_state', JSON.stringify({ step: 'kb', siteId, tenantId }));
    }, { token, siteId: site.id, tenantId: registration.user.tenant_id });
    await page.goto('/onboarding.html');
    await expect(page.locator('#kbPanel')).toBeVisible();
    await expect(page.locator('#authPanel')).toBeHidden();
    await page.reload();
    await expect(page.locator('#kbPanel')).toBeVisible();
  });

  test('tenant switch clears stale wizard state and returns to site creation', async ({ page, request }) => {
    const registration = await register(request, 'wizard-tenant');
    const token = registration.token || registration.access_token;
    const site = await createSite(request, token, `C5 Other ${Date.now()}`);
    await page.goto('/login.html');
    await page.evaluate(({ token, siteId }) => {
      localStorage.setItem('relaydesk_token', token);
      localStorage.setItem('nudgeso_onboarding_state', JSON.stringify({ step: 'kb', siteId, tenantId: 'not-this-tenant' }));
    }, { token, siteId: site.id });
    await page.goto('/onboarding.html');
    await expect(page.locator('#sitePanel')).toBeVisible();
    await expect(page.locator('#kbPanel')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('nudgeso_onboarding_state'))).toBeNull();
    await page.locator('#createSite').click();
    await expect(page.locator('#siteError')).not.toBeEmpty();
    await expect(page.locator('#sitePanel')).toBeVisible();
  });
});
