import type { APIRequestContext } from '@playwright/test';

export interface MerchantFixture {
  email: string;
  token: string;
  user: { tenant_id: string; email: string };
  site: { id: string; embed_key: string; name: string };
}

export async function createMerchantFixture(request: APIRequestContext, label = 'd1'): Promise<MerchantFixture> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  const response = await request.post('/api/v1/auth/register', {
    data: { email, password: 'TestPass123!' }
  });
  if (response.status() !== 201) {
    throw new Error(`D1 fixture registration failed: HTTP ${response.status()} ${await response.text()}`);
  }
  const registration = await response.json();
  const token = registration.token || registration.access_token;
  if (!token) throw new Error('D1 fixture registration did not return a token');
  const siteResponse = await request.post('/api/v1/sites', {
    headers: { authorization: `Bearer ${token}` },
    data: { name: `D1 Fixture ${Date.now()}`, industry_template: 'retail' }
  });
  if (siteResponse.status() !== 201) {
    throw new Error(`D1 fixture site failed: HTTP ${siteResponse.status()} ${await siteResponse.text()}`);
  }
  const { site } = await siteResponse.json();
  return { email, token, user: registration.user, site };
}
