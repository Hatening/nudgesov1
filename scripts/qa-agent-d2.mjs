import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const read = async (file) => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
const evidence = await read('artifacts/evidence/playwright-results.json');
const coverage = await read('artifacts/quality/agent/latest/coverage.json');
const contracts = await read('docs/quality/d1-contracts.json');
const tests = evidence.tests || [];
const byFile = {};
for (const test of tests) {
  if (!byFile[test.file]) byFile[test.file] = { total: 0, passed: 0, failed: 0, skipped: 0, screenshots: 0 };
  const bucket = byFile[test.file];
  bucket.total += 1;
  bucket[test.status] = (bucket[test.status] || 0) + 1;
  if (test.screenshot) bucket.screenshots += 1;
}
const report = {
  phase: 'D2',
  generatedAt: new Date().toISOString(),
  fullSuite: evidence.totals,
  screenshotCoverage: {
    testsWithScreenshot: tests.filter((test) => test.screenshot).length,
    nonSkippedTests: tests.filter((test) => test.status !== 'skipped').length,
    missing: tests.filter((test) => test.status !== 'skipped' && !test.screenshot).map((test) => test.title)
  },
  d0: coverage.summary,
  d1: { contracts: contracts.contracts.length, reviewed: contracts.reviewed === true },
  byFile
};
const outDir = path.join(root, 'artifacts/quality/agent/d2');
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
const md = [
  '# D2 — coverage and evidence integration',
  '',
  `- Full-suite tests: ${report.fullSuite.total}`,
  `- Passed: ${report.fullSuite.passed}`,
  `- Failed: ${report.fullSuite.failed}`,
  `- Skipped: ${report.fullSuite.skipped}`,
  `- Tests with screenshots: ${report.screenshotCoverage.testsWithScreenshot}/${report.screenshotCoverage.nonSkippedTests}`,
  `- D0 registry pages: ${report.d0.registryPages}`,
  `- D0 observed PASS: ${report.d0.pass}`,
  `- D0 FAIL: ${report.d0.fail}`,
  `- D1 reviewed contracts: ${report.d1.contracts}`,
  '',
  '## Missing screenshots',
  '',
  ...(report.screenshotCoverage.missing.length ? report.screenshotCoverage.missing.map((title) => `- ${title}`) : ['- none']),
  ''
].join('\n');
await fs.writeFile(path.join(outDir, 'report.md'), md);
console.log(JSON.stringify(report, null, 2));
