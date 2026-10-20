const token = localStorage.getItem('relaydesk_token') || '';
const $ = (selector) => document.querySelector(selector);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function badge(value, cls) {
  return `<span class="badge ${esc(cls)}">${esc(value)}</span>`;
}

function render(items) {
  const rows = $('#escalationRows');
  rows.innerHTML = '';
  $('#queueCount').textContent = String(items.length);
  $('#emptyState').classList.toggle('hidden', items.length > 0);
  for (const item of items) {
    const tr = document.createElement('tr');
    tr.dataset.escalationId = item.id;
    tr.dataset.status = item.status;
    tr.dataset.risk = item.risk;
    const resolveLabel = window.relaydeskI18n && window.relaydeskI18n.locale !== 'zh'
      ? window.relaydeskI18n.t('resolve')
      : '标记已处理';
    tr.innerHTML = `
      <td class="message-cell">${esc(item.message)}</td>
      <td class="site-cell">${esc(item.site_name || '')}</td>
      <td>${esc(item.language || '')}</td>
      <td>${esc(item.intent || '')}</td>
      <td>${badge(item.risk || 'high', item.risk === 'high' ? 'high' : 'medium')}</td>
      <td>${badge(item.status || 'pending', item.status || 'pending')}</td>
      <td>${esc(new Date(item.created_at).toLocaleString())}</td>
      <td><div class="row-actions"><button class="btn small" type="button" data-action="resolve" data-id="${esc(item.id)}">${esc(resolveLabel)}</button></div></td>
    `;
    rows.appendChild(tr);
  }
  rows.querySelectorAll('[data-action="resolve"]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api(`/api/v1/escalations/${encodeURIComponent(button.dataset.id)}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 'resolved' })
        });
        await load();
      } catch (err) {
        $('#queueError').textContent = err.message;
      }
    });
  });
}

async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 / Request failed (${response.status})`);
  return data;
}

async function load() {
  $('#queueError').textContent = '';
  if (!token) {
    $('#queueError').textContent = '未登录，请先登录商家后台。/ Please log in first.';
    $('#emptyState').classList.remove('hidden');
    return;
  }
  try {
    const data = await api('/api/v1/escalations');
    render(data.items || []);
  } catch (err) {
    $('#queueError').textContent = err.message;
  }
}

$('#refreshButton').addEventListener('click', load);
load();
