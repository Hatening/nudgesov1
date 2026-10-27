import { readZipEntries } from './zip-reader.js';
import { extractPdfText } from './pdf-text.js';

export const UPLOAD_LIMITS = Object.freeze({
  txt: 5 * 1024 * 1024,
  md: 5 * 1024 * 1024,
  docx: 10 * 1024 * 1024,
  xlsx: 10 * 1024 * 1024,
  pdf: 15 * 1024 * 1024,
});

export const MAX_MULTIPART_BYTES = 18 * 1024 * 1024;
export const MAX_TEXT_CHARS = 1_000_000;

const LEGACY_EXTENSIONS = new Set(['doc', 'xls']);
const MACRO_EXTENSIONS = new Set(['docm', 'xlsm']);
const ALLOWED_EXTENSIONS = new Set(Object.keys(UPLOAD_LIMITS));

function fail(message, code = 'INVALID_FILE', status = 400) {
  throw Object.assign(new Error(message), { status, code });
}

function extensionOf(filename) {
  const name = String(filename || '').trim().toLowerCase();
  if (!name.includes('.')) return '';
  return name.slice(name.lastIndexOf('.') + 1);
}

function decodeXml(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xmlText(value) {
  return decodeXml(String(value).replace(/<[^>]+>/g, ''))
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function normalizeText(value) {
  const text = String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length > MAX_TEXT_CHARS) return text.slice(0, MAX_TEXT_CHARS);
  return text;
}

export function detectUploadType(filename, buffer) {
  const ext = extensionOf(filename);
  if (LEGACY_EXTENSIONS.has(ext)) {
    fail('Legacy .doc/.xls files are not supported. Please save as .docx/.xlsx.', 'UNSUPPORTED_LEGACY_FORMAT', 415);
  }
  if (MACRO_EXTENSIONS.has(ext)) {
    fail('Macro-enabled files are not supported. Please remove macros and save as .docx/.xlsx.', 'UNSUPPORTED_MACRO_FORMAT', 415);
  }
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    fail('Unsupported file type. Allowed: .txt, .md, .docx, .xlsx, .pdf.', 'UNSUPPORTED_FILE_TYPE', 415);
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) fail('File is empty.');
  if (buffer.length > UPLOAD_LIMITS[ext]) {
    fail(`File exceeds the ${Math.round(UPLOAD_LIMITS[ext] / 1024 / 1024)} MB limit for .${ext}.`, 'FILE_TOO_LARGE', 413);
  }

  if (ext === 'pdf' && buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    fail('File is not a valid PDF.', 'INVALID_FILE', 415);
  }
  if ((ext === 'docx' || ext === 'xlsx') && buffer.subarray(0, 4).toString('latin1') !== 'PK\u0003\u0004') {
    fail(`File is not a valid .${ext} archive.`, 'INVALID_FILE', 415);
  }
  return ext;
}

export function extractDocxText(buffer) {
  const entries = readZipEntries(buffer);
  const documentXml = entries.get('word/document.xml');
  if (!documentXml) fail('DOCX does not contain word/document.xml.', 'INVALID_DOCX', 400);
  const xml = documentXml.toString('utf8');
  const text = xml
    .replace(/<w:tab\b[^>]*\/>/gi, '\t')
    .replace(/<w:br\b[^>]*\/>/gi, '\n')
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return normalizeText(xmlText(text));
}

export function extractXlsxText(buffer) {
  const entries = readZipEntries(buffer);
  if (![...entries.keys()].some((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))) {
    fail('XLSX does not contain any worksheets.', 'INVALID_XLSX', 400);
  }

  const sharedXml = entries.get('xl/sharedStrings.xml')?.toString('utf8') || '';
  const sharedStrings = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)]
    .map((match) => xmlText(match[1]));

  const parts = [];
  const sheets = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const an = Number(a.match(/sheet(\d+)\.xml/i)?.[1] || 0);
      const bn = Number(b.match(/sheet(\d+)\.xml/i)?.[1] || 0);
      return an - bn;
    });

  for (const [sheetIndex, sheetName] of sheets.entries()) {
    const sheetXml = entries.get(sheetName)?.toString('utf8') || '';
    parts.push(`Sheet ${sheetIndex + 1}`);
    const rows = [...sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)];
    for (const row of rows) {
      const values = [];
      for (const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
        const attrs = cell[1];
        const type = attrs.match(/\bt="([^"]+)"/i)?.[1] || '';
        const raw = cell[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1]
          ?? cell[2].match(/<is\b[^>]*>([\s\S]*?)<\/is>/i)?.[1]
          ?? '';
        let value = xmlText(raw);
        if (type === 's') value = sharedStrings[Number(value)] ?? '';
        if (type === 'b') value = value === '1' ? 'TRUE' : 'FALSE';
        if (type === 'inlineStr') value = xmlText(cell[2]);
        values.push(value);
      }
      if (values.some((value) => value !== '')) parts.push(values.join('\t'));
    }
    parts.push('');
  }
  return normalizeText(parts.join('\n'));
}

/**
 * Validate a browser upload and extract plain text.
 * It is intentionally synchronous and never writes the uploaded bytes to disk.
 */
export function ingestUpload(filename, buffer) {
  const ext = detectUploadType(filename, buffer);
  let text = '';
  if (ext === 'txt' || ext === 'md') {
    if (buffer.includes(0)) fail('Text file contains binary NUL bytes.', 'INVALID_TEXT_FILE', 415);
    text = normalizeText(buffer.toString('utf8'));
  } else if (ext === 'pdf') {
    text = normalizeText(extractPdfText(buffer));
    if (!text || text.length < 10) {
      fail('This PDF has no extractable text layer. Scanned PDFs need OCR, which is not enabled.', 'NEEDS_OCR', 422);
    }
  } else if (ext === 'docx') {
    text = extractDocxText(buffer);
  } else if (ext === 'xlsx') {
    text = extractXlsxText(buffer);
  }
  if (!text || text.trim().length < 10) fail('File did not contain at least 10 characters of text.', 'EMPTY_DOCUMENT', 400);
  return { text, type: ext, bytes: buffer.length, extractedChars: text.length };
}

export { fail as uploadError };
