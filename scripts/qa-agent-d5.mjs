import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'artifacts/quality/agent/d5');
await fs.mkdir(outDir, { recursive: true });
const d2 = JSON.parse(await fs.readFile(path.join(root, 'artifacts/quality/agent/d2/report.json'), 'utf8'));
const d3 = JSON.parse(await fs.readFile(path.join(root, 'artifacts/quality/agent/d3/repair-plan.json'), 'utf8'));
const d4 = JSON.parse(await fs.readFile(path.join(root, 'artifacts/quality/agent/d4/verification.json'), 'utf8'));
const gate = {
  phase: 'D5',
  generatedAt: new Date().toISOString(),
  status: d4.status === 'PASS' && d3.decision === 'NO_FAILURES_TO_REPAIR' ? 'PASS' : 'FAIL',
  commit: process.env.GITHUB_SHA || process.env.EXPECTED_SHA || null,
  checks: {
    d2Coverage: d2.fullSuite,
    d3RepairGate: d3.decision,
    d4Verifier: d4.status,
    screenshots: `${d2.screenshotCoverage.testsWithScreenshot}/${d2.fullSuite.total} tests`
  },
  releasePolicy: 'Do not release when D4 is FAIL or D3 requires human repair. CI must upload the evidence JSON/PNG artifacts.',
  ciIntegration: {
    workflow: '.github/workflows/ci.yml',
    requiredSteps: ['npm run qa:agent:generate', 'npm run qa:agent', 'npm run test:ui', 'npm run qa:agent:cards', 'npm run qa:agent:d2', 'npm run qa:agent:d3', 'npm run qa:agent:d4', 'npm run qa:agent:d5']
  }
};
await fs.writeFile(path.join(outDir, 'release-gate.json'), JSON.stringify(gate, null, 2));
await fs.writeFile(path.join(outDir, 'release-gate.md'), [
  '# D5 — release gate',
  '',
  `Status: **${gate.status}**`,
  `Full suite: ${d2.fullSuite.passed} passed / ${d2.fullSuite.failed} failed / ${d2.fullSuite.skipped} skipped`,
  `Screenshots: ${gate.checks.screenshots}`,
  `D3 repair gate: ${d3.decision}`,
  `D4 verifier: ${d4.status}`,
  '',
  'Release is blocked if D4 is FAIL or D3 requires human repair.',
  ''
].join('\n'));
console.log(JSON.stringify(gate, null, 2));
if (gate.status !== 'PASS') process.exitCode = 1;
