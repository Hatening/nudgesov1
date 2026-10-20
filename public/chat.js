const $ = (selector) => document.querySelector(selector);
const siteKey = new URLSearchParams(window.location.search).get('site') || '';
let site = null;
let consented = false;

function setError(id, message) {
  const el = document.getElementById(id);
  if (el) el.textContent = message || '';
}

function addMessage(role, text, lang, segment) {
  const bubble = document.createElement('div');
  bubble.className = 'message';
  bubble.dataset.role = role;
  if (lang) bubble.dataset.lang = lang;
  if (segment) bubble.dataset.segment = segment;
  bubble.textContent = text;
  const meta = document.createElement('small');
  meta.className = 'message-meta';
  meta.textContent = role === 'agent' ? `Support${lang ? ' · ' + lang : ''}` : 'You';
  bubble.appendChild(meta);
  $('#messages').appendChild(bubble);
  $('#messages').scrollTop = $('#messages').scrollHeight;
  return bubble;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function loadSite() {
  if (!siteKey) {
    setError('privacyError', '缺少站点 key / Missing site key.');
    $('#consentButton').disabled = true;
    return;
  }
  try {
    const data = await api(`/api/v1/public/${encodeURIComponent(siteKey)}`);
    site = data.site;
    $('#siteName').textContent = site.name || 'Customer support';
    if (data.privacy_notice) $('#privacyText').textContent = data.privacy_notice;
  } catch (err) {
    setError('privacyError', err.message);
    $('#consentButton').disabled = true;
  }
}

$('#consentButton').addEventListener('click', () => {
  consented = true;
  fetch(`/api/v1/public/${encodeURIComponent(siteKey)}/consent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: '2026-10-19' })
  }).catch(() => {});
  $('#privacyPanel').classList.add('hidden');
  $('#chatPanel').classList.remove('hidden');
  $('#messageInput').disabled = false;
  $('#sendButton').disabled = false;
  $('#voiceButton').disabled = false;
  $('#uploadVoiceButton').disabled = false;
  $('#messageInput').focus();
});

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function transcribeAudioFile(file) {
  if (window.__ASR_FIXTURE__) return String(window.__ASR_FIXTURE__);
  const data = await api(`/api/v1/public/${encodeURIComponent(siteKey)}/asr`, {
    method: 'POST',
    body: JSON.stringify({
      audio_filename: file.name,
      audio_base64: toBase64(await file.arrayBuffer())
    })
  });
  if (!data.transcript) throw new Error('本地 ASR 未返回文字 / Local ASR returned no transcript.');
  return data.transcript;
}

async function sendVoiceTranscript(transcript, file) {
  if (!transcript) return;
  setError('chatError', '');
  addMessage('user', `语音：${transcript}`, 'zh', 'voice-user');
  const button = $('#voiceButton');
  button.disabled = true;
  try {
    const data = await api(`/api/v1/public/${encodeURIComponent(siteKey)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        input_type: 'voice',
        transcript,
        audio_filename: file ? file.name : 'microphone',
        audio_size_bytes: file ? file.size : 0
      })
    });
    const reply = data.reply || {};
    const segments = Array.isArray(reply.segments) && reply.segments.length
      ? reply.segments
      : [{ type: 'answer', text: reply.text || '（无回复 / No reply）' }];
    for (const segment of segments) {
      addMessage('agent', segment.text || '', reply.lang || '', segment.type || 'answer');
    }
  } catch (err) {
    setError('chatError', err.message);
  } finally {
    button.disabled = false;
  }
}

function startLiveASR() {
  if (!consented) return;
  setError('chatError', '');
  if (window.__ASR_FIXTURE__) {
    sendVoiceTranscript(String(window.__ASR_FIXTURE__), null);
    return;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setError('chatError', '当前浏览器不支持网络语音，请使用文字或上传 .wav 录音。 / Speech recognition is unavailable; use text or upload a .wav file.');
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    const text = event.results && event.results[0] && event.results[0][0]
      ? event.results[0][0].transcript
      : '';
    if (text) sendVoiceTranscript(text, null);
  };
  recognition.onerror = (event) => {
    const code = event.error || 'unknown';
    if (code === 'network') {
      setError('chatError', '网络语音不可用，请使用文字或上传 .wav 录音。 / Speech network unavailable; use text or upload a .wav file.');
    } else if (code === 'not-allowed') {
      setError('chatError', '麦克风权限被拒绝，请使用文字或上传 .wav 录音。 / Microphone permission denied; use text or upload a .wav file.');
    } else {
      setError('chatError', `语音识别失败 / ASR failed: ${code}；可改用文字或上传 .wav 录音。`);
    }
  };
  try {
    recognition.start();
  } catch (err) {
    setError('chatError', err.message);
  }
}

$('#voiceButton').addEventListener('click', () => {
  if (consented) startLiveASR();
});

$('#uploadVoiceButton').addEventListener('click', () => {
  if (consented) $('#voiceFile').click();
});

$('#voiceFile').addEventListener('change', async () => {
  const file = $('#voiceFile').files[0];
  if (!file || !consented) return;
  try {
    const transcript = await transcribeAudioFile(file);
    await sendVoiceTranscript(transcript, file);
  } catch (err) {
    setError('chatError', err.message);
  } finally {
    $('#voiceFile').value = '';
  }
});

$('#composer').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!consented) return;
  setError('chatError', '');
  const input = $('#messageInput');
  const text = input.value.trim();
  if (!text) return;
  addMessage('user', text, 'zh');
  input.value = '';
  const button = $('#sendButton');
  button.disabled = true;
  try {
    const data = await api(`/api/v1/public/${encodeURIComponent(siteKey)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message: text })
    });
    const reply = data.reply || {};
    addMessage('agent', reply.text || '（无回复 / No reply）', reply.lang || '');
    if (reply.need_human) {
      const note = document.createElement('div');
      note.className = 'message';
      note.dataset.role = 'agent';
      note.textContent = '商家会尽快联系您。 / The merchant will follow up.';
      $('#messages').appendChild(note);
      $('#messages').scrollTop = $('#messages').scrollHeight;
    }
  } catch (err) {
    setError('chatError', err.message);
  } finally {
    button.disabled = false;
    input.focus();
  }
});

loadSite();
