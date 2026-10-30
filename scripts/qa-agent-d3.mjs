import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'artifacts/quality/agent/d3');
await fs.mkdir(outDir, { recursive: true });
const evidence = JSON.parse(await fs.readFile(path.join(root, 'artifacts/evidence/playwright-results.json'), 'utf8'));
const failures = (evidence.tests || []).filter((test) => test.status === 'failed');
const classify = (failure) => {
  const text = `${failure.error || ''} ${failure.title}`;
  if (/timeout|waiting for locator|ECONN|socket hang up/i.test(text)) return 'environment-or-timing';
  if (/expect\(|assert|received|expected/i.test(text)) return 'product-or-test-expectation';
  if (/fixture|register|seed|data/i.test(text)) return 'fixture-or-data';
  return 'unclassified';
};
const plan = {
  phase: 'D3',
  generatedAt: new Date().toISOString(),
  mode: 'dry-run-repair-plan',
  policy: {
    maxRepairRounds: 2,
    isolatedWorktreeRequired: true,
    testWeakeningForbidden: true,
    productionWritesForbidden: true,
    autoApproveVisualBaselines: false
  },
  failures: failures.map((failure) => ({
    title: failure.title,
    file: failure.file,
    classification: classify(failure),
    error: failure.error,
    allowedNextStep: 'Diagnose and propose a minimal diff in an isolated worktree; rerun the failing, adjacent and full contracts.'
  })),
  decision: failures.length ? 'HUMAN_REVIEW_REQUIRED_BEFORE_REPAIR' : 'NO_FAILURES_TO_REPAIR'
};
await fs.writeFile(path.join(outDir, 'repair-plan.json'), JSON.stringify(plan, null, 2));
await fs.writeFile(path.join(outDir, 'repair-plan.md'), [
  '# D3 — repair plan',
  '',
  `Failures: ${failures.length}`,
  `Decision: ${plan.decision}`,
  '',
  '## Policy',
  '',
  '- max repair rounds: 2',
  '- isolated worktree required',
  '- never delete or skip tests',
  '- never weaken assertions',
  '- never write production data',
  '',
  ...(failures.length ? failures.map((failure) => `- ${failure.title} (${failure.file})`) : ['- No failed tests to repair.'])
].join('\n'));
console.log(JSON.stringify(plan, null, 2));
if (failures.length) process.exitCode = 2;
