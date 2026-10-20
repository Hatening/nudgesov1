import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { redactPII } from './privacy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function clean(value, max = 4000) {
  return redactPII(String(value ?? '')).slice(0, max);
}

export function createRepairQueue({
  dir = path.join(__dirname, '..', 'artifacts', 'repair-queue'),
  env = process.env,
  spawnImpl = spawn,
  script = path.join(__dirname, '..', 'scripts', 'repair-worker.mjs')
} = {}) {
  function enqueue(input = {}) {
    const at = new Date().toISOString();
    const issueId = `repair_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const incident = {
      id: issueId,
      received_at: at,
      event: clean(input.event || 'monitor_error', 80),
      severity: clean(input.severity || 'high', 30),
      service: clean(input.service || 'relaydesk', 80),
      fingerprint: clean(input.fingerprint || '', 200),
      message: clean(input.message || input.log || 'external monitor alert', 4000),
      source: clean(input.source || 'external-monitor', 200)
    };
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${at.replace(/[:.]/g, '-')}-${issueId}.json`);
    fs.writeFileSync(file, JSON.stringify(incident, null, 2), 'utf8');

    let worker = 'disabled';
    if (env.REPAIR_WORKER_ENABLED !== '0') {
      try {
        const child = spawnImpl(process.execPath, [script, file], {
          cwd: path.join(__dirname, '..'),
          detached: true,
          stdio: 'ignore',
          env: { ...env, REPAIR_INCIDENT_FILE: file }
        });
        child.unref();
        worker = 'started';
      } catch {
        worker = 'failed';
      }
    }
    return { ...incident, file, worker };
  }
  return { enqueue, dir };
}
