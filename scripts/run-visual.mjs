import { spawn } from 'node:child_process';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const update = process.argv.includes('--update');
const args = ['playwright', 'test', 'e2e/PHASE13-VISUAL.spec.ts', '--workers=1'];
if (update) args.push('--update-snapshots');
const child = spawn(npx, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, VISUAL_TEST: '1' }
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));
