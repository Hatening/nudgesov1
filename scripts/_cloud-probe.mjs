import fs from 'node:fs';
import path from 'node:path';

const dshHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh');
const file = path.join(dshHome, '.credentials.yaml');
let token = '';
if (fs.existsSync(file)) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let inAccount = false;
  for (const line of lines) {
    if (/^\s{2}deepseek-account-platform\/default:\s*$/.test(line)) { inAccount = true; continue; }
    if (inAccount && /^\s{2}\S/.test(line)) break;
    if (inAccount) {
      const m = line.match(/^\s+token:\s*(\S+)\s*$/);
      if (m) { token = m[1]; break; }
    }
  }
}
console.log('token found:', Boolean(token), 'len:', token.length);
if (!token) process.exit(1);
for (const headers of [{ authorization: `Bearer ${token}` }, { 'x-dsh-auth-token': token }]) {
  try {
    const res = await fetch('https://api.deepseek.com/v1/models', { headers, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    console.log(Object.keys(headers)[0], '->', res.status, text.slice(0, 200));
  } catch (e) {
    console.log(Object.keys(headers)[0], 'ERR', e.message);
  }
}
