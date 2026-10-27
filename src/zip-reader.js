import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function fail(message, code = 'INVALID_ARCHIVE', status = 400) {
  throw Object.assign(new Error(message), { status, code });
}

/**
 * Read the entries of a ZIP archive without writing anything to disk.
 * This is deliberately small: DOCX/XLSX are ZIP containers and the product
 * only needs named XML entries. ZIP64 and encrypted archives are rejected.
 */
export function readZipEntries(buffer, options = {}) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const maxEntries = options.maxEntries || 5000;
  const maxEntryBytes = options.maxEntryBytes || 20 * 1024 * 1024;
  const maxTotalBytes = options.maxTotalBytes || 40 * 1024 * 1024;
  if (source.length < 22 || source.readUInt32LE(0) !== LOCAL_SIG) fail('Not a ZIP archive.');

  let eocd = -1;
  const searchStart = Math.max(0, source.length - 65557);
  for (let i = source.length - 22; i >= searchStart; i -= 1) {
    if (source.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) fail('ZIP end-of-central-directory record was not found.');

  const entryCount = source.readUInt16LE(eocd + 10);
  const centralOffset = source.readUInt32LE(eocd + 16);
  if (entryCount > maxEntries) fail('ZIP contains too many entries.', 'ARCHIVE_TOO_LARGE', 413);
  if (centralOffset >= source.length) fail('ZIP central directory offset is invalid.');

  const entries = new Map();
  let total = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > source.length || source.readUInt32LE(cursor) !== CENTRAL_SIG) {
      fail('ZIP central directory entry is corrupt.');
    }
    const flags = source.readUInt16LE(cursor + 8);
    const method = source.readUInt16LE(cursor + 10);
    const compressedSize = source.readUInt32LE(cursor + 20);
    const uncompressedSize = source.readUInt32LE(cursor + 24);
    const nameLength = source.readUInt16LE(cursor + 28);
    const extraLength = source.readUInt16LE(cursor + 30);
    const commentLength = source.readUInt16LE(cursor + 32);
    const localOffset = source.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > source.length) fail('ZIP central directory is truncated.');
    if (flags & 1) fail('Encrypted ZIP entries are not supported.', 'ENCRYPTED_ARCHIVE', 415);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      fail('ZIP64 archives are not supported.', 'ZIP64_UNSUPPORTED', 415);
    }
    if (uncompressedSize > maxEntryBytes) fail('ZIP entry is too large.', 'ARCHIVE_TOO_LARGE', 413);
    total += uncompressedSize;
    if (total > maxTotalBytes) fail('ZIP expands beyond the archive safety limit.', 'ARCHIVE_TOO_LARGE', 413);

    const name = source.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (!name || name.includes('\u0000')) fail('ZIP entry name is invalid.');
    if (localOffset + 30 > source.length || source.readUInt32LE(localOffset) !== LOCAL_SIG) {
      fail('ZIP local header is corrupt.');
    }
    const localNameLength = source.readUInt16LE(localOffset + 26);
    const localExtraLength = source.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataStart > source.length || dataEnd > source.length) fail('ZIP entry data is truncated.');
    const compressed = source.subarray(dataStart, dataEnd);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) {
      try { data = zlib.inflateRawSync(compressed, { maxOutputLength: maxEntryBytes }); }
      catch { fail('ZIP entry could not be decompressed.', 'INVALID_ARCHIVE'); }
    } else {
      fail(`Unsupported ZIP compression method ${method}.`, 'UNSUPPORTED_COMPRESSION', 415);
    }
    if (data.length !== uncompressedSize) fail('ZIP entry size does not match its directory record.');
    entries.set(name, data);
    cursor = next;
  }
  return entries;
}
