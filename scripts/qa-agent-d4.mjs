import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const evidence = JSON.parse(await fs.readFile(path.join(root, 'artifacts/evidence/playwright-results.json'), 'utf8'));
const d2 = JSON.parse(await fs.readFile(path.join(root, 'artifacts/quality/agent/d2/report.json'), 'utf8'));
const d3 = JSON.parse(await fs.readFile(path.join(root, 'artifacts/quality/agent/d3/repair-plan.json'), 'utf8'));
const checks = [];
const add = (name, ok, detail) => checks.push({ name, ok, detail });
add('full_suite_finished', evidence.totals.total > 0, evidence.totals);
add('no_failed_tests', evidence.totals.failed === 0, { failed: evidence.totals.failed });
add('screenshots_for_non_skipped_tests', d2.screenshotCoverage.missing.length === 0, d2.screenshotCoverage);
add('screenshots_for_all_tests', d2.screenshotCoverage.testsWithScreenshot === d2.fullSuite.total, { screenshots: d2.screenshotCoverage.testsWithScreenshot, total: d2.fullSuite.total });
add('d0_no_page_failures', d2.d0.fail === 0, d2.d0);
add('d0_registry_reconciled', d2.d0.registryPages === d2.d0.explored + d2.d0.notRun, d2.d0);
add('d1_reviewed_manifest', d2.d1.reviewed === true, d2.d1);
add('repair_gate_clear', d3.decision === 'NO_FAILURES_TO_REPAIR', d3.decision);
const verification = {
  phase: 'D4',
  generatedAt: new Date().toISOString(),
  status: checks.every((check) => check.ok) ? 'PASS' : 'FAIL',
  checks,
  verifier: 'independent artifact verifier; it does not delete, skip or weaken tests'
};
const outDir = path.join(root, 'artifacts/quality/agent/d4');
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'verification.json'), JSON.stringify(verification, null, 2));
console.log(JSON.stringify(verification, null, 2));
if (verification.status !== 'PASS') process.exitCode = 1;
