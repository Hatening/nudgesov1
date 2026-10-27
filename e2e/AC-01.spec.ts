import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureScreenshot } from './helpers/screenshot';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const knowledgeFile = path.join(__dirname, 'fixtures', 'ac01-knowledge.txt');

test.describe('AC-01 merchant onboarding', () => {
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      await captureScreenshot(page, testInfo, 'AC-01', 'fail-final').catch(() => {});
    }
  });

  test('register/login -> site + template -> upload/confirm knowledge -> embed code', async ({ page }, testInfo) => {
    test.setTimeout(10 * 60 * 1000);
    const startedAt = Date.now();

    // New UI flow: landing -> onboarding (account + site + knowledge + embed).
    await page.goto('/landing.html');
    await expect(page.getByRole('heading', { name: /Calm Customer Support/i })).toBeVisible();
    await page.getByRole('link', { name: /Start free|免费开始/i }).first().click();
    await page.waitForURL(/onboarding\.html/);
    await expect(page.getByRole('heading', { name: /一步步把客服装好|Launch your support site|Set up/i })).toBeVisible();
    await captureScreenshot(page, testInfo, 'AC-01', 'step-landing');

    // Step 1: create account.
    const email = `qa-ac01-${Date.now()}@example.test`;
    const password = 'TestPass123!';
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('#authSubmit').click();
    await expect(page.locator('#sitePanel')).toBeVisible({ timeout: 15_000 });

    // Step 2: site name + industry template.
    const siteName = `QA-AC01-${Date.now()}`;
    await page.locator('#siteName').fill(siteName);
    await page.locator('.template[data-template="retail"]').click();
    await captureScreenshot(page, testInfo, 'AC-01', 'step-template');
    await page.locator('#createSite').click();
    await expect(page.locator('#kbPanel')).toBeVisible({ timeout: 15_000 });

    // Step 3: upload <=1 MB text knowledge and confirm the draft.
    const fileInput = page.locator('#kbFile');
    await expect(fileInput, 'AC-01 requires a knowledge file upload input.').toBeVisible();
    await fileInput.setInputFiles(knowledgeFile);

    const draft = page.locator('#kbDraft');
    await expect(draft, 'AC-01 requires a parsed knowledge draft.').toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#kbPreview')).toContainText('QA synthetic knowledge');
    await captureScreenshot(page, testInfo, 'AC-01', 'step-knowledge-draft');

    await page.locator('#kbConfirm').click();
    await expect(page.locator('#kbStatus')).toHaveText(/已确认|Confirmed/i, { timeout: 15_000 });

    // Step 4: copyable embed code + standalone URL.
    const embed = page.locator('#embedSnippet');
    await expect(embed).toBeVisible({ timeout: 10_000 });
    await expect(embed).toContainText(/widget\.js\?key=/);
    await expect(page.locator('#standaloneUrl')).toHaveAttribute('href', /^http/);
    await captureScreenshot(page, testInfo, 'AC-01', 'final');

    const elapsedMs = Date.now() - startedAt;
    expect(elapsedMs, 'AC-01 must complete within 10 minutes').toBeLessThanOrEqual(10 * 60 * 1000);
  });
});
