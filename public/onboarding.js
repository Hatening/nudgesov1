const $ = (s) => document.querySelector(s);
function tr(key, fallback) {
  const value = window.relaydeskI18n?.t(key);
  return value && value !== key ? value : fallback;
}
const panels = ['authPanel', 'sitePanel', 'kbPanel', 'embedPanel'];
const steps = ['auth', 'site', 'kb', 'embed'];
let token = localStorage.getItem('relaydesk_token') || '';
let site = null;
let draft = null;
let selectedTemplate = 'restaurant';

const STATE_KEY = 'nudgeso_onboarding_state';

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj;
  } catch (e) {}
  return null;
}
function saveState(patch) {
  const cur = loadState() || {};
  const next = Object.assign({}, cur, patch);
  try { localStorage.setItem(STATE_KEY, JSON.stringify(next)); } catch (e) {}
  return next;
}

function showOnly(id) {
  for (const panel of panels) {
    const el = document.getElementById(panel);
    if (el) el.classList.toggle('hidden', el.id !== id);
  }
}

function setStep(current) {
  const index = steps.indexOf(current);
  document.querySelectorAll('.steps li').forEach((li) => {
    const step = li.dataset.step;
    const i = steps.indexOf(step);
    li.classList.toggle('active', i === index);
    li.classList.toggle('done', i < index);
  });
}

function error(id, message) {
  const el = document.getElementById(id);
  if (el) el.textContent = message || '';
}

function busy(button, isBusy, label) {
  if (!button) return;
  if (!button.dataset.idleLabel) button.dataset.idleLabel = label || button.textContent;
  button.disabled = isBusy;
  button.textContent = isBusy ? tr('working', 'Working…') : button.dataset.idleLabel;
}

async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${tr('requestFailed', 'Request failed')} (${response.status})`);
  return data;
}

async function authenticate(email, password) {
  try {
    return await api('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
  } catch (err) {
    if (/already registered/i.test(err.message)) {
      return api('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
    }
    throw err;
  }
}

$('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  error('authError', '');
  const email = $('#email').value.trim();
  const password = $('#password').value;
  if (!email || !password) {
    error('authError', tr('requiredEmailPassword', 'Email and password are required.'));
    return;
  }
  const button = $('#authSubmit');
  busy(button, true);
  try {
    const data = await authenticate(email, password);
    token = data.token || data.access_token;
    localStorage.setItem('relaydesk_token', token);
    if (data.refresh_token) localStorage.setItem('relaydesk_refresh_token', data.refresh_token);
    localStorage.setItem('nudgeso_onboarding_pending', '1');
    saveState({ step: 'site', siteId: null });
    showOnly('sitePanel');
    setStep('site');
  } catch (err) {
    error('authError', err.message);
  } finally {
    busy(button, false, tr('authSubmit', 'Register / Sign in'));
  }
});

document.querySelectorAll('.template').forEach((button) => {
  button.addEventListener('click', () => {
    selectedTemplate = button.dataset.template;
    document.querySelectorAll('.template').forEach((b) => b.classList.toggle('selected', b === button));
  });
});

$('#createSite').addEventListener('click', async () => {
  error('siteError', '');
  const name = $('#siteName').value.trim();
  if (!name) {
    error('siteError', tr('requiredSiteName', 'Site name is required.'));
    return;
  }
  const button = $('#createSite');
  busy(button, true);
  try {
    const data = await api('/api/v1/sites', {
      method: 'POST',
      body: JSON.stringify({ name, industry_template: selectedTemplate })
    });
    site = data.site;
    saveState({ step: 'kb', siteId: site.id });
    showOnly('kbPanel');
    setStep('kb');
  } catch (err) {
    error('siteError', err.message);
  } finally {
    busy(button, false, tr('createSite', 'Create site'));
  }
});

$('#kbFile').addEventListener('change', async () => {
  error('kbError', '');
  const file = $('#kbFile').files[0];
  if (!file) return;
  const sizeLabel = file.size < 1024 ? `${file.size} B` : `${Math.round(file.size / 1024)} KB`;
  $('#kbFileName').textContent = `${file.name} · ${sizeLabel}`;
  if (file.size > 1_000_000) {
    error('kbError', tr('fileTooLarge', 'File must be 1 MB or smaller.'));
    return;
  }
  const button = $('#kbConfirm');
  button.disabled = true;
  try {
    const content = await file.text();
    const data = await api(`/api/v1/sites/${encodeURIComponent(site.id)}/kb/upload`, {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, title: file.name, content })
    });
    draft = data.document;
    $('#kbPreview').textContent = draft.content;
    $('#kbDraft').classList.remove('hidden');
    $('#kbStatus').textContent = tr('kbReady', 'Ready to check');
    $('#kbStatus').style.color = 'var(--muted)';
    button.disabled = false;
  } catch (err) {
    error('kbError', err.message);
  }
});

$('#kbConfirm').addEventListener('click', async () => {
  if (!draft) return;
  error('kbError', '');
  const button = $('#kbConfirm');
  busy(button, true);
  try {
    const confirmed = await api(`/api/v1/sites/${encodeURIComponent(site.id)}/kb/confirm`, {
      method: 'POST',
      body: JSON.stringify({ document_id: draft.id })
    });
    draft = confirmed.document;
    $('#kbStatus').textContent = tr('kbConfirmed', 'Confirmed');
    $('#kbStatus').style.color = 'var(--green)';
    const embed = await api(`/api/v1/sites/${encodeURIComponent(site.id)}/embed-code`);
    busy(button, false, tr('kbConfirm', 'Confirm knowledge'));
    $('#embedSnippet').textContent = embed.snippet;
    const link = $('#standaloneUrl');
    link.href = embed.standalone_url;
    link.textContent = embed.standalone_url;
    saveState({ step: 'embed', siteId: site.id });
    $('#embedPanel').classList.remove('hidden');
    setStep('embed');
    $('#embedPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    error('kbError', err.message);
  } finally {
    busy(button, false, tr('kbConfirm', 'Confirm knowledge'));
  }
});

$('#copyEmbed').addEventListener('click', async () => {
  const text = $('#embedSnippet').textContent;
  try {
    await navigator.clipboard.writeText(text);
    $('#copyStatus').textContent = tr('copied', 'Copied');
  } catch {
    $('#copyStatus').textContent = tr('copyFailed', 'Copy failed; select the code manually.');
  }
});

const finishBtn = $('#finishOnboarding');
if (finishBtn) {
  finishBtn.addEventListener('click', () => {
    try {
      localStorage.setItem('nudgeso_onboarding_done', '1');
      localStorage.removeItem('nudgeso_onboarding_pending');
    } catch (e) {}
    location.href = '/';
  });
}

async function loadEmbedCode(targetSite) {
  const embed = await api(`/api/v1/sites/${encodeURIComponent(targetSite.id)}/embed-code`);
  $('#embedSnippet').textContent = embed.snippet;
  const link = $('#standaloneUrl');
  link.href = embed.standalone_url;
  link.textContent = embed.standalone_url;
}

(async function boot() {
  if (!token) return;
  try {
    await api('/api/v1/auth/me');
  } catch {
    token = '';
    localStorage.removeItem('relaydesk_token');
    return;
  }
  const state = loadState();
  if (state && state.siteId) {
    try {
      const data = await api('/api/v1/sites');
      const items = data.items || [];
      const found = items.find((s) => String(s.id) === String(state.siteId)) || items[0];
      if (found) {
        site = found;
        if (state.step === 'embed') {
          await loadEmbedCode(site);
          showOnly('embedPanel');
          setStep('embed');
        } else {
          showOnly('kbPanel');
          setStep('kb');
        }
        return;
      }
    } catch (e) { /* fall through to site step */ }
  }
  showOnly('sitePanel');
  setStep('site');
})();
