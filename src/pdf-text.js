import zlib from 'node:zlib';

/**
 * 极简 PDF 文本提取（无第三方依赖）。
 * 只处理带文本层、使用 FlateDecode/未压缩内容流的 PDF；
 * 扫描件（纯图片）提取不到文本，由调用方返回 422 提示。
 */
function decodePdfString(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== '\\') { out += ch; continue; }
    const next = raw[i + 1];
    if (next === undefined) break;
    const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
    if (map[next]) { out += map[next]; i += 1; continue; }
    if (/[0-7]/.test(next)) {
      let oct = '';
      let j = i + 1;
      while (oct.length < 3 && /[0-7]/.test(raw[j])) { oct += raw[j]; j += 1; }
      out += String.fromCharCode(parseInt(oct, 8));
      i = j - 1;
      continue;
    }
    out += next; i += 1;
  }
  return out;
}

function extractFromContentStream(content) {
  const parts = [];
  // (text) Tj
  for (const m of content.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
    parts.push(decodePdfString(m[1]));
  }
  // [(a) -12 (b)] TJ
  for (const m of content.matchAll(/\[((?:[^\][]|\\.)*)\]\s*TJ/g)) {
    let line = '';
    for (const s of m[1].matchAll(/\(((?:\\.|[^\\()])*)\)/g)) line += decodePdfString(s[1]);
    if (line) parts.push(line);
  }
  return parts.join('\n');
}

export function extractPdfText(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const latin = source.toString('latin1');
  const chunks = [];
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let match;
  while ((match = streamRe.exec(latin))) {
    let data = Buffer.from(match[1], 'latin1');
    let decoded = null;
    for (const fn of [zlib.inflateSync, zlib.inflateRawSync, zlib.unzipSync]) {
      try { decoded = fn(data); break; } catch { /* try next */ }
    }
    const text = extractFromContentStream((decoded || data).toString('latin1'));
    if (text.trim()) chunks.push(text);
  }
  const text = chunks.join('\n').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').trim();
  // 中文字体通常使用 CID 编码，提取结果会为空或乱码；这里过滤掉纯控制字符结果
  const printable = text.replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u024F\u4E00-\u9FFF]/g, '');
  return printable.length >= 20 ? printable : '';
}

export function isPdfBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}
