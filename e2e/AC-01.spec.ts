import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureScreenshot } from './helpers/screenshot';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const knowledgeFile = path.join(__dirname, 'fixtures', 'ac01-knowledge.txt');

test.describe('AC-01 merchant onboarding', () => {
  test.afterEach(async ({ page }, testInfo) => {
    // Explicit failure evidence; do not rely on Playwright's automatic screenshot.
    if (testInfo.status !== testInfo.expectedStatus) {
      await captureScreenshot(page, testInfo, 'AC-01', 'fail-final').catch(() => {});
    }
  });

  test('register/login -> site + template -> upload/confirm knowledge -> embed code', async ({ page }, testInfo) => {
    test.setTimeout(10 * 60 * 1000); // AC-01 acceptance: <= 10 minutes

    const startedAt = Date.now();
    await page.goto('/');
    await page.waitForSelector('.app-shell', { timeout: 10_000 });
    await captureScreenshot(page, testInfo, 'AC-01', 'step-landing');

    // AC-01 step 1: there must be a merchant login/register entry.
    const authEntry = page
      .locator('a, button')
      .filter({ hasText: /登录|注册|sign in|sign up|log in|login|register/i })
      .first();

    await expect(
      authEntry,
      'AC-01 requires a merchant login/register entry; none was found on the live landing page.'
    ).toBeVisible({ timeout: 5_000 });

    await authEntry.click();
    await captureScreenshot(page, testInfo, 'AC-01', 'step-auth');

    // AC-01 step 1b: register or log in with the merchant account.
    const email = `qa-ac01-${Date.now()}@example.test`;
    const password = 'TestPass123!';
    await page.getByLabel(/邮箱|email/i).fill(email);
    await page.getByLabel(/密码|password/i).fill(password);
    await page
      .getByRole('button', { name: /注册|登录|sign in|sign up|log in|login|register/i })
      .click();

    // AC-01 step 2: create a site and apply an industry template.
    const siteName = `QA-AC01-${Date.now()}`;
    const siteNameInput = page
      .getByLabel(/站点名称|site name|workspace name|store name/i)
      .first();
    await expect(siteNameInput, 'AC-01 requires a site name field after login.').toBeVisible({ timeout: 5_000 });
    await siteNameInput.fill(siteName);

    const template = page
      .getByRole('button', { name: /餐饮|零售|诊所|本地服务|跨境|restaurant|retail|clinic|local service|cross-border|template/i })
      .first();
    await expect(template, 'AC-01 requires an industry template option.').toBeVisible({ timeout: 5_000 });
    await template.click();
    await captureScreenshot(page, testInfo, 'AC-01', 'step-template');

    const createSite = page
      .getByRole('button', { name: /创建|create|next|下一步|continue/i })
      .first();
    await createSite.click();

    // AC-01 step 3: upload a <=1 MB text knowledge file and confirm the draft.
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput, 'AC-01 requires a knowledge file upload input.').toBeVisible({ timeout: 5_000 });
    await fileInput.setInputFiles(knowledgeFile);

    const draft = page.locator('#kbDraft');
    await expect(draft, 'AC-01 requires a parsed knowledge draft.').toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#kbPreview')).toContainText('QA synthetic knowledge');
    await captureScreenshot(page, testInfo, 'AC-01', 'step-knowledge-draft');

    const confirm = page
      .getByRole('button', { name: /确认|confirm|approve|save|保存/i })
      .first();
    await expect(confirm, 'AC-01 requires a confirmation action for the knowledge draft.').toBeVisible({ timeout: 5_000 });
    await confirm.click();

    const confirmed = page.locator('#kbStatus');
    await expect(confirmed, 'AC-01 requires the knowledge status to become confirmed.').toHaveText(
      /已确认|Confirmed/i,
      { timeout: 10_000 }
    );

    // AC-01 step 4: the embed code or standalone page URL must be available.
    const embed = page.locator('#embedSnippet');
    await expect(embed, 'AC-01 requires a copyable embed code or standalone page URL.').toBeVisible({ timeout: 10_000 });
    await expect(embed).toContainText(/widget\.js\?key=/);
    await expect(page.locator('#standaloneUrl')).toHaveAttribute('href', /^http/);
    await captureScreenshot(page, testInfo, 'AC-01', 'final');

    // AC-01 acceptance: login -> embed code within 10 minutes.
    const elapsedMs = Date.now() - startedAt;
    expect(elapsedMs, 'AC-01 must complete within 10 minutes').toBeLessThanOrEqual(10 * 60 * 1000);
  });
});
