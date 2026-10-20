import fs from 'node:fs';
import path from 'node:path';

// Proof-of-concept repair worker. It turns an external alert into a DSH-ready
// prompt file. Set DSH_REPAIR_COMMAND to hand that prompt to a real orchestrator;
// otherwise this is a safe local dry-run.
const file = process.argv[2] || process.env.REPAIR_INCIDENT_FILE;
if (!file) {
  console.error('repair-worker: missing incident file');
  process.exit(2);
}
const incident = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const prompt = [
  'You are a DSH repair agent working in D:\\Documents\\AI_Projects\\NudgeSo\\relaydesk-mvp.',
  'An external monitor raised this incident.',
  '',
  `Incident: ${incident.id}`,
  `Event: ${incident.event}`,
  `Severity: ${incident.severity}`,
  `Service: ${incident.service}`,
  `Fingerprint: ${incident.fingerprint || '(none)'}`,
  `Source: ${incident.source}`,
  '',
  'Alert message:',
  incident.message,
  '',
  'Required workflow: reproduce with a focused test, write the failing test first,',
  'fix the root cause without weakening assertions, run npm test and the relevant',
  'Playwright acceptance tests, then report evidence and residual risk.'
].join('\n');

const promptFile = file.replace(/\.json$/, '.prompt.md');
fs.writeFileSync(promptFile, prompt, 'utf8');
const logFile = path.join(path.dirname(file), 'repair-worker.log');
fs.appendFileSync(logFile, `${new Date().toISOString()} queued ${incident.id} -> ${promptFile}\n`, 'utf8');

if (process.env.DSH_REPAIR_COMMAND) {
  // Deliberately opt-in: the default worker never executes arbitrary external text.
  const { spawn } = await import('node:child_process');
  const child = spawn(process.env.DSH_REPAIR_COMMAND, [promptFile], { detached: true, stdio: 'ignore', shell: false });
  child.unref();
}
