import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const base = (process.env.BASE_URL || 'http://127.0.0.1:3030').replace(/\/$/, '');
const outputDir = path.join(process.cwd(), 'artifacts', 'qa-matrix');
const pages = ['/landing.html', '/login.html', '/onboarding.html', '/upload.html', '/manual.html', '/insights.html', '/queue.html', '/chat.html'];
const viewports = [{ width: 390, height: 844 }, { width: 1440, height: 900 }];
const browser = await chromium.launch({ headless: true });
const report = { generated_at: new Date().toISOString(), base, pages: [], totals: { warnings: 0 } };

for (const route of pages) {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
    const warnings = await page.evaluate(() => {
      const visible = (el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const rects = [...document.querySelectorAll('button, a, input, select, textarea, .btn')]
        .filter(visible)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.tagName).trim().slice(0, 80),
            x: r.x, y: r.y, w: r.width, h: r.height,
            scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
            scrollHeight: el.scrollHeight, clientHeight: el.clientHeight
          };
        });
      const small = rects.filter((r) => r.w < 24 || r.h < 24).map((r) => ({ text: r.text, w: Math.round(r.w), h: Math.round(r.h) }));
      const clipped = rects.filter((r) => r.scrollWidth > r.clientWidth + 1 || r.scrollHeight > r.clientHeight + 1).map((r) => ({ text: r.text, scrollWidth: r.scrollWidth, clientWidth: r.clientWidth, scrollHeight: r.scrollHeight, clientHeight: r.clientHeight }));
      const overlaps = [];
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i]; const b = rects[j];
          const overlapW = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
          const overlapH = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
          const area = overlapW * overlapH;
          if (area > 0 && area > Math.min(a.w * a.h, b.w * b.h) * 0.2) {
            overlaps.push({ a: a.text, b: b.text, ratio: Number((area / Math.min(a.w * a.h, b.w * b.h)).toFixed(2)) });
          }
        }
      }
      return { small, clipped, overlaps: overlaps.slice(0, 20) };
    });
    const count = warnings.small.length + warnings.clipped.length + warnings.overlaps.length;
    report.pages.push({ route, viewport: viewport.width, warnings, warning_count: count });
    report.totals.warnings += count;
    await page.close();
  }
}
await browser.close();
fs.mkdirSync(outputDir, { recursive: true });
const output = path.join(outputDir, 'ui-geometry-warnings.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, warnings: report.totals.warnings, pages: report.pages.length }, null, 2));
