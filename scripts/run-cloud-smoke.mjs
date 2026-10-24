import { spawn } from 'node:child_process';

const target = process.argv[2] || process.env.CLOUD_BASE_URL || 'https://nudgeso.onrender.com';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(npx, ['playwright', 'test', 'e2e/CLOUD-SMOKE.spec.ts', '--workers=1'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, BASE_URL: target, CLOUD_SMOKE: '1' }
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));
