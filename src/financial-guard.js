/**
 * FinancialGuard — deterministic pre-RAG interception for financial requests.
 *
 * This module never calls a model. Any financial-refund/compensation request
 * must receive a fixed safe template and create an urgent human escalation.
 */

export const FINANCIAL_LANGUAGES = ['zh', 'en', 'es', 'fr', 'ar'];

const TERMS = [
  // Chinese
  ['zh', '退款'], ['zh', '退钱'], ['zh', '退货退款'], ['zh', '退差价'], ['zh', '赔偿'],
  ['zh', '赔付'], ['zh', '赔我'], ['zh', '赔钱'], ['zh', '赔款'], ['zh', '理赔'],
  ['zh', '折现'], ['zh', '补发'], ['zh', '补钱'], ['zh', '返现'], ['zh', '索赔'],
  ['zh', '退一赔三'], ['zh', '三倍赔偿'], ['zh', '仅退款'], ['zh', '强制退款'],
  ['zh', '退款承诺'], ['zh', '赔偿金'], ['zh', '补偿金'], ['zh', '退款政策'],
  // English
  ['en', 'refund'], ['en', 'refunds'], ['en', 'refunded'], ['en', 'refunding'],
  ['en', 'compensate'], ['en', 'compensation'], ['en', 'compensating'],
  ['en', 'reimburse'], ['en', 'reimbursement'], ['en', 'cash back'], ['en', 'cashback'],
  ['en', 'money back'], ['en', 'claim'], ['en', 'claims'], ['en', 'chargeback'],
  ['en', 'indemnity'], ['en', 'indemnify'], ['en', 'return for money'],
  ['en', 'return my money'], ['en', 'refund policy'], ['en', 'financial compensation'],
  // Spanish
  ['es', 'reembolso'], ['es', 'reembolsar'], ['es', 'devolución de dinero'],
  ['es', 'devolucion de dinero'], ['es', 'compensación'], ['es', 'compensacion'],
  ['es', 'indemnización'], ['es', 'indemnizacion'], ['es', 'reclamación'],
  ['es', 'reclamacion'], ['es', 'devolver el dinero'], ['es', 'contracargo'],
  // French
  ['fr', 'remboursement'], ['fr', 'rembourser'], ['fr', 'rembourse'],
  ['fr', 'indemnisation'], ['fr', 'indemniser'], ['fr', 'compensation'],
  ['fr', 'réclamation'], ['fr', 'reclamation'], ['fr', 'rétrofacturation'],
  // Arabic
  ['ar', 'استرداد'], ['ar', 'استرجاع المال'], ['ar', 'استرداد الأموال'],
  ['ar', 'تعويض'], ['ar', 'تعويضات'], ['ar', 'مطالبة'], ['ar', 'رد المبلغ'],
];

const TERMS_BY_LANGUAGE = TERMS.reduce((map, [lang, term]) => {
  (map[lang] ||= []).push(term);
  return map;
}, {});

const TEMPLATES = {
  zh: '您的诉求涉及退款/赔付等敏感处理，为了保障您的权益，系统已为您加急转交人工专员。请提供您的订单号，专员会尽快与您核实处理。',
  en: 'Your request involves a refund, compensation, or another sensitive financial matter. To protect your rights, we have escalated it to a human specialist. Please provide your order number so our team can verify and handle it as soon as possible.',
  es: 'Su solicitud implica un reembolso, una compensación u otro asunto financiero sensible. Para proteger sus derechos, la hemos transferido con prioridad a un especialista humano. Indique su número de pedido para que podamos verificarlo y atenderlo lo antes posible.',
  fr: 'Votre demande concerne un remboursement, une indemnisation ou une autre question financière sensible. Pour protéger vos droits, nous l\'avons transmise en priorité à un spécialiste humain. Merci d\'indiquer votre numéro de commande afin que nous puissions la vérifier et la traiter au plus vite.',
  ar: 'يتعلق طلبك باسترداد الأموال أو التعويض أو مسألة مالية حساسة أخرى. لحماية حقوقك، قمنا بتحويله بشكل عاجل إلى مختص بشري. يرجى تقديم رقم طلبك حتى يتمكن فريقنا من التحقق منه ومعالجته في أقرب وقت ممكن.',
};

function detectLanguage(text) {
  const value = String(text || '');
  if (/[\u0600-\u06ff]/.test(value)) return 'ar';
  if (/[\u4e00-\u9fff]/.test(value)) return 'zh';
  if (/[áéíóúñü¿¡]/i.test(value) || /\b(reembolso|compensación|devolución|reclamación|dinero)\b/i.test(value)) return 'es';
  if (/[àâçéèêëîïôûùüÿœ]/i.test(value) || /\b(remboursement|indemnisation|réclamation|argent)\b/i.test(value)) return 'fr';
  return 'en';
}

function hasTerm(text, term) {
  const value = String(text || '').toLowerCase();
  const needle = term.toLowerCase();
  if (/^[a-z][a-z\s-]*$/i.test(needle)) {
    return new RegExp(`(^|[^a-z])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(value);
  }
  return value.includes(needle);
}

/**
 * @param {string} text
 * @returns {{ intercepted: true, lang: string, matched: string[], status: 'transferred_to_human', need_human: true, reply: { text: string, lang: string }, escalation: { risk_level: 'high', category: 'financial', status: 'pending', priority: 'urgent' } } | null}
 */
export function financialGuard(text) {
  const value = String(text || '');
  if (!value.trim()) return null;
  const lang = detectLanguage(value);
  // Check all languages: users may mix languages; never let a financial request through.
  const matched = [];
  for (const [termLang, terms] of Object.entries(TERMS_BY_LANGUAGE)) {
    for (const term of terms) {
      if (hasTerm(value, term)) {
        matched.push(`${termLang}:${term}`);
        break;
      }
    }
    if (matched.length) break;
  }
  if (!matched.length) return null;
  return {
    intercepted: true,
    lang: TEMPLATES[lang] ? lang : 'en',
    matched,
    status: 'transferred_to_human',
    need_human: true,
    reply: { text: TEMPLATES[lang] || TEMPLATES.en, lang: TEMPLATES[lang] ? lang : 'en' },
    escalation: { risk_level: 'high', category: 'financial', status: 'pending', priority: 'urgent' },
  };
}

export function financialTemplate(lang) {
  return TEMPLATES[lang] || TEMPLATES.en;
}

export function isFinancialRisk(text) {
  return Boolean(financialGuard(text));
}
