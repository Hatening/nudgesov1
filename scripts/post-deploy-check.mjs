#!/usr/bin/env node
/**
 * Read-only post-deploy verification.
 *
 * Checks the public app, CORS, assets and (when a local Render key is present)
 * whether the live Render deployment matches the expected git SHA. It never
 * prints secret values and never writes to production.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const base = (process.env.BASE_URL || 'https://nudgeso.onrender.com').replace(/\/$/, '');
const expectedSha = process.env.EXPECTED_SHA
  || (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return ''; } })();
const out = { generatedAt: new Date().toISOString(), base, expectedSha, checks: [], ok: true };

function add(name, ok, detail) {
  out.checks.push({ name, ok, detail });
  if (!ok) out.ok = false;
}

async function fetchText(pathname, options = {}) {
  const response = await fetch(base + pathname, { redirect: 'follow', ...options });
  return { response, text: await response.text() };
}

try {
  const health = await fetchText('/api/health');
  let healthBody = null;
  try { healthBody = JSON.parse(health.text); } catch {}
  add('health_status', health.response.status === 200, { status: health.response.status });
  add('health_ok', Boolean(healthBody?.ok), { ok: healthBody?.ok, engine: healthBody?.engine?.state, llmConfigured: healthBody?.llmConfigured });
  add('health_schema', typeof healthBody?.knowledgeCount === 'number' && typeof healthBody?.service === 'string', { knowledgeCount: healthBody?.knowledgeCount, service: healthBody?.service });

  const landing = await fetchText('/landing.html');
  add('landing_status', landing.response.status === 200, { status: landing.response.status });
  add('landing_carousel', landing.text.includes('demoCarousel'), { hasCarousel: landing.text.includes('demoCarousel') });
  add('landing_locales_loaded', landing.text.includes('/landing-locales.js'), { hasLocaleScript: landing.text.includes('/landing-locales.js') });

  const localeResponse = await fetch(base + '/landing-locales.js');
  const localeText = await localeResponse.text();
  add('landing_locales_status', localeResponse.status === 200, { status: localeResponse.status });
  add('landing_locales_shape', localeText.includes('NS_LANDING_LOCALES') && localeText.length > 100_000, { bytes: localeText.length });

  const cors = await fetch(base + '/api/health', { headers: { Origin: 'https://www.nudgeso.com' } });
  add('cors_www', cors.headers.get('access-control-allow-origin') === 'https://www.nudgeso.com', {
    allowOrigin: cors.headers.get('access-control-allow-origin'),
  });
  const preflight = await fetch(base + '/api/health', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://www.nudgeso.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,authorization',
    },
  });
  add('cors_www_preflight', preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === 'https://www.nudgeso.com', {
    status: preflight.status,
    allowOrigin: preflight.headers.get('access-control-allow-origin'),
  });
} catch (error) {
  add('public_checks', false, { error: String(error).slice(0, 600) });
}

// Optional: verify the live Render SHA using a local key. Never print the key.
let renderKey = '';
if (fs.existsSync('.env.local')) {
  renderKey = (fs.readFileSync('.env.local', 'utf8').match(/^\s*RENDER_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m) || [])[1] || '';
}
if (renderKey) {
  try {
    const headers = { Authorization: `Bearer ${renderKey}`, Accept: 'application/json' };
    const servicesResponse = await fetch('https://api.render.com/v1/services?limit=50', { headers });
    const services = await servicesResponse.json();
    const service = services.map((row) => row.service || row).find((row) => row.name === 'nudgeso');
    if (!service) {
      add('render_service', false, { error: 'nudgeso service not found' });
    } else {
      const deploysResponse = await fetch(`https://api.render.com/v1/services/${service.id}/deploys?limit=5`, { headers });
      const deploys = await deploysResponse.json();
      const live = deploys.map((row) => row.deploy || row).find((row) => row.status === 'live');
      add('render_service', true, { id: service.id, name: service.name, autoDeploy: service.autoDeploy, branch: service.branch });
      add('render_live_sha', Boolean(live?.commit?.id) && (!expectedSha || live.commit.id === expectedSha), {
        expectedSha,
        liveSha: live?.commit?.id || null,
        deployId: live?.id || null,
      });
    }
  } catch (error) {
    add('render_api', false, { error: String(error).slice(0, 600) });
  }
} else {
  add('render_live_sha', false, { notRun: 'RENDER_API_KEY not present in .env.local' });
  out.ok = false;
}

fs.mkdirSync('artifacts/quality', { recursive: true });
fs.writeFileSync('artifacts/quality/post-deploy.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
