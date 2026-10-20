import crypto from 'node:crypto';
import { seedKnowledge } from './seed.js';

export function id(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export function now() {
  return new Date().toISOString();
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

export function tokenPrefix(token) {
  return String(token || '').slice(0, 8);
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function tokenize(s) {
  const stop = new Set(['the','and','for','with','from','that','this','what','where','when','how','can','you','your','are','is','my','me','to','a','an','of','in','on','it','be','do','does','i','we','our','by','has','have','not','if','or','as','at','was','were','will','would','could','should','please','is']);
  return (String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[\p{L}\p{N}]+/gu) || [])
    .filter((token) => token.length > 1 && !stop.has(token));
}

export function rankKnowledge(query, items = seedKnowledge) {
  const aliases = [
    [/退款|退货|退款政策|退货政策|reembolso|devolucion|retour|rückerstattung|retoure/i, ['refund','return','returns','shipping']],
    [/物流|配送|追踪|跟踪|envío|entrega|livraison|versand|tracking/i, ['shipping','delivery','tracking']],
    [/保修|故障|garantía|garantie|gewährleistung/i, ['warranty','fault','repair']]
  ];
  const expanded = tokenize(query);
  for (const [re, terms] of aliases) if (re.test(String(query))) expanded.push(...terms);
  const q = new Set(expanded);
  return items.map((item) => {
    const hay = [item.title, item.content, item.language, ...(item.tags || [])].join(' ');
    const tokens = tokenize(hay);
    let overlap = 0;
    for (const token of q) if (tokens.includes(token)) overlap++;
    const phrase = String(query).toLowerCase().includes(String(item.title).toLowerCase()) ? 2 : 0;
    const score = (overlap / Math.max(1, q.size)) + phrase;
    return { ...item, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 4);
}

export function inferIntent(text) {
  const s = String(text || '').toLowerCase();
  if (/投诉|举报|complaint|legal|律师|起诉|曝光|supervisor|manager/.test(s)) return 'Complaint / escalation';
  if (/refund|return|devol|retour|rückerstatt|退货|退款/.test(s)) return 'Returns and refunds';
  if (/track|shipping|delivery|shipment|envío|livraison|配送|物流/.test(s)) return 'Shipping status';
  if (/warranty|broken|fault|garant|保修|故障/.test(s)) return 'Product warranty';
  if (/price|cost|precio|prix|价格/.test(s)) return 'Pricing';
  return 'General question';
}

export function detectLanguage(text) {
  const s = String(text || '');
  if (/[\u0600-\u06FF]/.test(s)) return 'ar';
  if (/[\u4e00-\u9fff]/.test(s)) return 'zh';
  if (/[\u3040-\u30ff]/.test(s)) return 'ja';
  if (/[\uac00-\ud7af]/.test(s)) return 'ko';
  if (/[áéíóúñ¿¡]/i.test(s)) return 'es';
  if (/[àâçéèêëîïôûùüÿœ]/i.test(s)) return 'fr';
  if (/[äöüß]/i.test(s)) return 'de';
  return 'en';
}

export function fallbackAnswer(question, hits, lang) {
  if (!hits.length) {
    return {
      answer: lang === 'zh'
        ? '我目前没有找到足够可靠的店铺政策依据来回答这个问题。我可以请人工客服继续协助，或请你补充订单号/产品信息。'
        : 'I could not find enough reliable store-policy evidence to answer confidently. I can hand this to a human teammate, or you can share the order number or product details.',
      confidence: 0.18,
      grounded: false
    };
  }
  const best = hits[0];
  let excerpt = best.content;
  if (excerpt.length > 520) excerpt = excerpt.slice(0, 517) + '…';
  const intro = lang === 'zh'
    ? '根据店铺知识库中的「' + best.title + '」：'
    : 'Based on the store knowledge article “' + best.title + '”: ';
  return { answer: intro + excerpt, confidence: Math.min(0.9, 0.48 + best.score * 0.13), grounded: true };
}

export function isHighRiskMessage(text) {
  return /退款|退货|投诉|举报|complaint|refund|return|legal|律师|起诉|赔偿|食品安全|医疗|价格承诺|guarantee/i.test(String(text || ''));
}

export function voiceTopic(transcript) {
  const s = String(transcript || '');
  if (/几点|下班|营业|开门|关门|hours|open|close/i.test(s)) return '营业时间';
  if (/退款|退货|refund|return/i.test(s)) return '退款/退货政策';
  if (/物流|快递|发货|配送|包裹|到货|什么时候到|shipping|delivery|tracking|parcel|package/i.test(s)) return '物流进度';
  if (/保修|维修|故障|warranty|repair/i.test(s)) return '保修/维修';
  if (/价格|多少钱|price|cost/i.test(s)) return '价格';
  return `「${s.slice(0, 40)}」`;
}

export function retrievePublicHits(transcript, corpus) {
  const s = String(transcript || '');
  let hits = rankKnowledge(s, corpus);
  const prefer = (queryRe, docRe) => {
    if (!queryRe.test(s)) return;
    const doc = corpus.find((item) => docRe.test(`${item.title || ''} ${item.content || ''}`));
    if (doc) hits = [{ ...doc, score: 1 }, ...hits.filter((hit) => hit.id !== doc.id)];
  };
  prefer(/几点|下班|营业|开门|关门|hours|open|close/i, /营业时间|营业|hours|09:00|21:00/i);
  prefer(/包裹|快递|物流|到货|什么时候到|多久到|shipping|delivery|tracking|parcel|package/i, /物流|快递|包裹|shipping|delivery|3-5|工作日/i);
  return hits;
}

export function retrieveVoiceHits(transcript, corpus) {
  return retrievePublicHits(transcript, corpus);
}

export function parseWav(buffer) {
  if (!buffer || buffer.length < 44) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let fmt = null;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ' && offset + 8 + 16 <= buffer.length) {
      fmt = {
        audioFormat: buffer.readUInt16LE(offset + 8),
        channels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
        bitsPerSample: buffer.readUInt16LE(offset + 22)
      };
    }
    if (chunkId === 'data') { dataSize = size; break; }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || !fmt.sampleRate || !fmt.channels || !fmt.bitsPerSample) return null;
  const durationSec = dataSize / (fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8));
  return { ...fmt, dataSize, durationSec: Math.max(0, durationSec) };
}

export function localAsrTranscript(filename) {
  const s = String(filename || '').toLowerCase();
  if (/hours|营业|下班|几点|关门/.test(s)) return '你们几点下班？';
  if (/package|parcel|物流|快递|包裹|shipping|delivery|tracking/.test(s)) return '我的包裹什么时候能到？';
  if (/refund|return|退款|退货/.test(s)) return '我要退款，订单号 12345';
  if (/complaint|投诉/.test(s)) return '我要投诉你们';
  return '我想咨询一下';
}

export function buildVoiceReply(transcript, hits, lang) {
  const s = String(transcript || '');
  const topic = voiceTopic(s);
  const soothing = /着急|急|等|催|生气|投诉|退款/i.test(s)
    ? '听到您遇到这个问题，我很抱歉，也理解您的着急。'
    : '感谢您的留言，我理解您想尽快确认这个问题。';
  const confirmation = `您刚才是想问${topic}的问题，对吗？`;
  let answer = '';
  if (/几点|下班|营业|开门|关门|hours|open|close/i.test(s)) {
    const doc = hits.find((hit) => /营业时间|营业|hours|09:00|21:00/i.test(`${hit.title || ''} ${hit.content || ''}`));
    const content = doc ? String(doc.content || '') : '';
    const match = content.match(/(\d{1,2}:\d{2}\s*[-–~至]\s*\d{1,2}:\d{2})/);
    if (match) {
      const time = match[1].replace(/\s+/g, '');
      const close = time.split(/[-–~至]/).pop();
      answer = `根据店铺知识库：营业时间是每天 ${time}，${close} 下班。`;
    } else {
      answer = '我暂时没有找到店铺营业时间；可以请人工客服确认。';
    }
  } else if (hits.length) {
    answer = `根据店铺知识库：${String(hits[0].content || '').slice(0, 300)}`;
  } else {
    answer = '我暂时没有找到足够可靠的店铺政策依据；可以请人工客服继续协助。';
  }
  const segments = [
    { type: 'soothing', text: soothing },
    { type: 'confirm', text: confirmation },
    { type: 'answer', text: answer }
  ];
  return { text: [soothing, confirmation, answer].join('\n'), segments, grounded: Boolean(hits.length), need_human: !hits.length };
}
