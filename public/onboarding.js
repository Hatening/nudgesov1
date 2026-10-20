const $ = (s) => document.querySelector(s);
const panels = ['authPanel', 'sitePanel', 'kbPanel', 'embedPanel'];
const steps = ['auth', 'site', 'kb', 'embed'];
let token = localStorage.getItem('relaydesk_token') || '';
let site = null;
let draft = null;
let selectedTemplate = 'restaurant';

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
  button.textContent = isBusy ? '处理中… / Working…' : button.dataset.idleLabel;
}

async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 / Request failed (${response.status})`);
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
    error('authError', '请填写邮箱和密码 / Email and password are required.');
    return;
  }
  const button = $('#authSubmit');
  busy(button, true);
  try {
    const data = await authenticate(email, password);
    token = data.token;
    localStorage.setItem('relaydesk_token', token);
    showOnly('sitePanel');
    setStep('site');
  } catch (err) {
    error('authError', err.message);
  } finally {
    busy(button, false, '注册 / 登录');
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
    error('siteError', '请填写站点名称 / Site name is required.');
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
    showOnly('kbPanel');
    setStep('kb');
  } catch (err) {
    error('siteError', err.message);
  } finally {
    busy(button, false, '创建站点 / Create site');
  }
});

$('#kbFile').addEventListener('change', async () => {
  error('kbError', '');
  const file = $('#kbFile').files[0];
  if (!file) return;
  const sizeLabel = file.size < 1024 ? `${file.size} B` : `${Math.round(file.size / 1024)} KB`;
  $('#kbFileName').textContent = `${file.name} · ${sizeLabel}`;
  if (file.size > 1_000_000) {
    error('kbError', '文件超过 1 MB / File must be 1 MB or smaller.');
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
    $('#kbStatus').textContent = '草稿 / Draft';
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
    $('#kbStatus').textContent = '已确认 / Confirmed';
    $('#kbStatus').style.color = 'var(--green)';
    const embed = await api(`/api/v1/sites/${encodeURIComponent(site.id)}/embed-code`);
    busy(button, false, '确认知识库 / Confirm');
    $('#embedSnippet').textContent = embed.snippet;
    const link = $('#standaloneUrl');
    link.href = embed.standalone_url;
    link.textContent = embed.standalone_url;
    $('#embedPanel').classList.remove('hidden');
    setStep('embed');
    $('#embedPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    error('kbError', err.message);
  } finally {
    busy(button, false, '确认知识库 / Confirm');
  }
});

$('#copyEmbed').addEventListener('click', async () => {
  const text = $('#embedSnippet').textContent;
  try {
    await navigator.clipboard.writeText(text);
    $('#copyStatus').textContent = '已复制 / Copied';
  } catch {
    $('#copyStatus').textContent = '复制失败，请手动选择代码 / Copy failed; select the code manually.';
  }
});

(async function boot() {
  if (!token) return;
  try {
    await api('/api/v1/auth/me');
    showOnly('sitePanel');
    setStep('site');
  } catch {
    token = '';
    localStorage.removeItem('relaydesk_token');
  }
})();
