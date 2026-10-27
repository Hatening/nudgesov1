import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestUpload, UPLOAD_LIMITS } from '../src/file-ingest.js';
import { parseMultipart } from '../src/multipart.js';

function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, data);
    centrals.push({ name: nameBytes, dataLength: data.length, offset });
    offset += local.length + nameBytes.length + data.length;
  }
  const centralParts = [];
  for (const entry of centrals) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(entry.dataLength, 20);
    central.writeUInt32LE(entry.dataLength, 24);
    central.writeUInt16LE(entry.name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(entry.offset, 42);
    centralParts.push(central, entry.name);
  }
  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, end]);
}

function docx(text) {
  return makeZip({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': `<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
  });
}

function xlsx() {
  return makeZip({
    '[Content_Types].xml': '<Types/>',
    'xl/sharedStrings.xml': '<sst><si><t>Product</t></si><si><t>Price</t></si><si><t>Tea</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c t="s"><v>2</v></c><c><v>12.50</v></c></row></sheetData></worksheet>'
  });
}

test('ingestUpload extracts DOCX paragraph text', () => {
  const result = ingestUpload('policy.docx', docx('Shipping takes 3-5 days. Returns are accepted within 30 days.'));
  assert.equal(result.type, 'docx');
  assert.match(result.text, /Shipping takes 3-5 days/);
  assert.match(result.text, /Returns are accepted/);
});

test('ingestUpload extracts XLSX shared strings and cell values', () => {
  const result = ingestUpload('prices.xlsx', xlsx());
  assert.equal(result.type, 'xlsx');
  assert.match(result.text, /Product\s+Price/);
  assert.match(result.text, /Tea\s+12\.50/);
});

test('ingestUpload enforces per-format size limits', () => {
  assert.throws(() => ingestUpload('large.txt', Buffer.alloc(UPLOAD_LIMITS.txt + 1, 0x61)), (error) => error.status === 413 && error.code === 'FILE_TOO_LARGE');
});

test('ingestUpload rejects legacy and macro formats clearly', () => {
  assert.throws(() => ingestUpload('old.doc', Buffer.from('x')), (error) => error.status === 415 && error.code === 'UNSUPPORTED_LEGACY_FORMAT');
  assert.throws(() => ingestUpload('macro.xlsm', Buffer.from('x')), (error) => error.status === 415 && error.code === 'UNSUPPORTED_MACRO_FORMAT');
});

test('ingestUpload rejects corrupt documents', () => {
  assert.throws(() => ingestUpload('bad.docx', Buffer.from('not a zip')), (error) => error.status === 415);
  assert.throws(() => ingestUpload('bad.pdf', Buffer.from('%PDF-1.4\nno text')), (error) => error.status === 422 && error.code === 'NEEDS_OCR');
});

test('parseMultipart returns one file and preserves binary bytes', () => {
  const boundary = '----testboundary';
  const fileBytes = Buffer.from([0, 1, 2, 255, 10]);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nTest title\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="policy.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`),
    fileBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  const parsed = parseMultipart(body, `multipart/form-data; boundary=${boundary}`);
  assert.equal(parsed.fields.title, 'Test title');
  assert.equal(parsed.file.filename, 'policy.docx');
  assert.deepEqual([...parsed.file.buffer], [...fileBytes]);
});
