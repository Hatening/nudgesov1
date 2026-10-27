function fail(message, status = 400, code = 'INVALID_MULTIPART') {
  throw Object.assign(new Error(message), { status, code });
}

function boundaryFrom(contentType) {
  const match = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  return match ? (match[1] || match[2]) : '';
}

function parseDisposition(value) {
  const result = {};
  for (const piece of String(value || '').split(';').slice(1)) {
    const match = piece.trim().match(/^([^=]+)="?([^"]*)"?$/);
    if (match) result[match[1].toLowerCase()] = match[2];
  }
  return result;
}

/**
 * Parse one browser FormData request without writing to disk.
 * Only a single file part is returned; text fields are kept for title/metadata.
 */
export function parseMultipart(body, contentType, options = {}) {
  const source = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
  const boundary = boundaryFrom(contentType);
  if (!boundary) fail('multipart/form-data boundary is missing.');
  if (source.length > (options.maxBytes || 20 * 1024 * 1024)) {
    fail('Multipart body is too large.', 413, 'FILE_TOO_LARGE');
  }
  const marker = Buffer.from(`--${boundary}`);
  const fields = {};
  let file = null;
  let partCount = 0;
  let cursor = source.indexOf(marker);
  if (cursor < 0) fail('Multipart boundary was not found.');

  while (cursor >= 0 && partCount < 20) {
    cursor += marker.length;
    if (source.subarray(cursor, cursor + 2).toString('latin1') === '--') break;
    if (source.subarray(cursor, cursor + 2).toString('latin1') !== '\r\n') fail('Malformed multipart boundary.');
    cursor += 2;
    const headerEnd = source.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd < 0) fail('Malformed multipart part headers.');
    const headerText = source.subarray(cursor, headerEnd).toString('utf8');
    if (headerText.length > 16_384) fail('Multipart headers are too large.', 413);
    const headers = {};
    for (const line of headerText.split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon <= 0) continue;
      headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    const dataStart = headerEnd + 4;
    const next = source.indexOf(marker, dataStart);
    if (next < 0) fail('Multipart closing boundary was not found.');
    let dataEnd = next;
    if (dataEnd >= 2 && source[dataEnd - 2] === 13 && source[dataEnd - 1] === 10) dataEnd -= 2;
    const data = source.subarray(dataStart, dataEnd);
    const disposition = parseDisposition(headers['content-disposition']);
    const name = disposition.name;
    if (disposition.filename !== undefined) {
      if (file) fail('Only one file can be uploaded per request.', 400, 'TOO_MANY_FILES');
      if (data.length > (options.maxFileBytes || 15 * 1024 * 1024)) {
        fail('Uploaded file is too large.', 413, 'FILE_TOO_LARGE');
      }
      const filename = disposition.filename
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        .slice(0, 180);
      file = {
        field: name || 'file',
        filename: filename || 'upload.bin',
        contentType: headers['content-type'] || 'application/octet-stream',
        buffer: Buffer.from(data)
      };
    } else if (name) {
      if (data.length > 100_000) fail('Multipart field is too large.', 413);
      fields[name] = data.toString('utf8');
    }
    partCount += 1;
    cursor = next;
  }
  return { fields, file, boundary };
}
