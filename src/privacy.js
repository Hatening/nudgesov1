export const CONSENT_VERSION = '2026-10-19';

export function redactPII(value) {
  return String(value ?? '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\b(?:\d{4}[ -]?){3}\d{4}\b/g, '[redacted-card]')
    .replace(/(?:\+?\d[\s().-]?){7,15}\d/g, '[redacted-phone]');
}

export function privacyNotice() {
  return '我们会在提供客服回复时处理你发送的文本和基础会话信息。请勿发送密码、支付卡号或身份证号等敏感信息。 / We process your message and basic session data to provide support. Do not send passwords, card numbers, or government IDs.';
}
