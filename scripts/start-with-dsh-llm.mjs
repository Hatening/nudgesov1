import fs from 'node:fs';
import path from 'node:path';

// Local P0.5 launcher: reuse the DeepSeek account token already stored by DSH.
// The token is read into memory only; it is never printed or written to the repo.
const dshHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh');
const credentialPath = path.join(dshHome, '.credentials.yaml');
const raw = fs.readFileSync(credentialPath, 'utf8');
let inAccount = false;
let token = '';
for (const line of raw.split(/\r?\n/)) {
  if (/^\s{2}deepseek-account-platform\/default:\s*$/.test(line)) {
    inAccount = true;
    continue;
  }
  if (inAccount && /^\s{2}\S/.test(line)) break;
  if (inAccount) {
    const match = line.match(/^\s+token:\s*(\S+)\s*$/);
    if (match) { token = match[1]; break; }
  }
}
if (!token) throw new Error('DSH DeepSeek account token not found; sign in to DSH first.');

process.env.LLM_PROVIDER ||= 'openai';
process.env.LLM_BASE_URL ||= 'https://api.deepseek.com/v1';
process.env.LLM_MODEL ||= 'deepseek-flash';
process.env.LLM_API_KEY ||= token;
process.env.LLM_AUTH_HEADER ||= 'x-dsh-auth-token';
if (process.env.LLM_AUTH_SCHEME === undefined) process.env.LLM_AUTH_SCHEME = '';
process.env.LLM_TIMEOUT_MS ||= '45000';
process.env.LLM_TEMPERATURE ||= '0.35';
process.env.LLM_RESPONSE_FORMAT ||= 'json_object';

const { server } = await import('../server.js');
const port = Number(process.env.PORT || 3030);
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => {
  console.log(`RelayDesk MVP (real LLM) running at http://${host}:${port} (${process.env.LLM_PROVIDER}/${process.env.LLM_MODEL})`);
});
