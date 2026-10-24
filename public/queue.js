const token = localStorage.getItem('relaydesk_token') || '';
const $ = (selector) => document.querySelector(selector);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function tr(key, fallback) {
  const value = window.relaydeskI18n?.t(key);
  return value && value !== key ? value : fallback;
}

function icon(name) {
  return window.NS_ICON ? window.NS_ICON(name, 15) : '';
}

// 三通道状态标签：图标 + 文字 + 颜色
function statusBadge(status) {
  if (status === 'resolved') return `<span class="badge resolved">${icon('check')} ${esc(tr('statusResolved', '已处理'))}</span>`;
  if (status === 'in_review') return `<span class="badge in_review">${icon('clock')} ${esc(tr('statusInReview', '处理中'))}</span>`;
  return `<span class="badge pending">${icon('clock')} ${esc(tr('statusPending', '等待中'))}</span>`;
}

function riskBadge(level) {
  if (level === 'high' || level === 'critical') return `<span class="badge high">${icon('alert')} ${esc(tr('riskHigh', '要紧'))}</span>`;
  if (level === 'low') return `<span class="badge low">${icon('check')} ${esc(tr('riskLow', '不急'))}</span>`;
  return `<span class="badge medium">${icon('info')} ${esc(tr('riskMedium', '一般'))}</span>`;
}

function render(items) {
  const rows = $('#escalationRows');
  rows.innerHTML = '';
  $('#queueCount').textContent = String(items.length);
  $('#emptyState').classList.toggle('hidden', items.length > 0);
  document.querySelector('.table-card').classList.toggle('hidden', items.length === 0);
  for (const item of items) {
    const row = document.createElement('tr');
    const financial = item.category === 'financial';
    const urgent = item.priority === 'urgent' || financial;
    row.dataset.escalationId = item.id;
    row.dataset.status = item.status;
    row.dataset.risk = item.risk;
    row.dataset.category = item.category || 'general';
    row.dataset.priority = item.priority || 'normal';
    if (urgent) row.classList.add('urgent-row');
    const resolveLabel = tr('resolve', '标记已处理');
    row.innerHTML = `
      <td class="message-cell" data-label="${esc(tr('labelCustomer', '客户说的话'))}">${esc(item.message)}</td>
      <td data-label="${esc(tr('labelSite', '店铺'))}">${esc(item.site_name || '')}</td>
      <td data-label="${esc(tr('labelLanguage', '语言'))}">${esc(item.language || '')}</td>
      <td data-label="${esc(tr('labelIntent', '想问什么'))}">${esc(item.intent || '')}</td>
      <td data-label="${esc(tr('labelRisk', '要紧程度'))}">${riskBadge(item.risk_level || item.risk)} ${financial ? '<span class="badge high">' + icon('alert') + ' ' + esc(tr('financial', '涉及钱')) + '</span>' : ''} ${urgent && !financial ? '<span class="badge high">' + icon('alert') + ' ' + esc(tr('urgent', '很急')) + '</span>' : ''}</td>
      <td data-label="${esc(tr('labelStatus', '状态'))}">${statusBadge(item.status || 'pending')}</td>
      <td data-label="${esc(tr('labelTime', '时间'))}">${esc(new Date(item.created_at).toLocaleString())}</td>
      <td class="row-actions-cell" data-label="${esc(tr('labelAction', '操作'))}"><div class="row-actions"><button class="btn small" type="button" data-action="resolve" data-id="${esc(item.id)}">${icon('check')} ${esc(resolveLabel)}</button></div></td>
    `;
    rows.appendChild(row);
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
  if (response.status === 401) {
    try { localStorage.removeItem('relaydesk_token'); localStorage.removeItem('relaydesk_refresh_token'); } catch (e) {}
    location.replace('/login.html?redirect=' + encodeURIComponent(location.pathname + location.search));
    return data;
  }
  if (!response.ok) throw new Error(data.error || `请求失败 / Request failed (${response.status})`);
  return data;
}

async function load() {
  $('#queueError').textContent = '';
  if (!token) {
    location.replace('/login.html?redirect=' + encodeURIComponent(location.pathname + location.search));
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
