import { spawnSync } from 'node:child_process';

const commands = [
  ['generate D1 contracts', 'npm', ['run', 'qa:agent:generate']],
  ['D0 read-only explorer', 'npm', ['run', 'qa:agent']],
  ['full Playwright suite with screenshots', 'npx', ['playwright', 'test', '--workers=1']],
  ['fill non-UI evidence cards', 'npm', ['run', 'qa:agent:cards']],
  ['D2 evidence integration', 'npm', ['run', 'qa:agent:d2']],
  ['D3 repair gate', 'npm', ['run', 'qa:agent:d3']],
  ['D4 independent verification', 'npm', ['run', 'qa:agent:d4']],
  ['D5 release gate', 'npm', ['run', 'qa:agent:d5']]
];
for (const [label, command, args] of commands) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env
  });
  if (result.status !== 0) {
    console.error(`FAILED: ${label} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}
console.log('\nD0–D5 pipeline completed.');
