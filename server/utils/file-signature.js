

const prefix = (bytes, offset = 0) => (buf) =>
  buf.length >= offset + bytes.length
  && bytes.every((b, i) => buf[offset + i] === b);

const ascii = (text, offset = 0) => prefix([...text].map((c) => c.charCodeAt(0)), offset);



// lehnt reale, in jedem Reader funktionierende Dateien ab.
//




const PDF_MARKER = '%PDF-';
const PDF_MAX_OFFSET = 1024;
const pdfHeader = (buf) => {
  const at = buf.subarray(0, PDF_MAX_OFFSET + PDF_MARKER.length).indexOf(PDF_MARKER);
  return at >= 0 && at <= PDF_MAX_OFFSET;
};



const zipHeader = prefix([0x50, 0x4b, 0x03, 0x04]);


const oleHeader = prefix([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const webpHeader = (buf) => ascii('RIFF')(buf) && ascii('WEBP', 8)(buf);




// `<svg`.
//





// bisher "ungeprueft".
const SVG_HEAD_BYTES = 1024;
const svgHeader = (buf) => {
  const head = buf.subarray(0, SVG_HEAD_BYTES).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (!/^(<\?xml|<!--|<!DOCTYPE\s+svg|<svg)/i.test(head)) return false;
  return /<svg[\s>]/i.test(head);
};

const gifHeader = (buf) => ascii('GIF87a')(buf) || ascii('GIF89a')(buf);

const SIGNATURES = new Map([
  ['application/pdf', pdfHeader],
  ['image/png', prefix([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],

  ['image/jpeg', prefix([0xff, 0xd8, 0xff])],
  ['image/webp', webpHeader],
  ['image/gif', gifHeader],
  ['image/svg+xml', svgHeader],
  ['application/msword', oleHeader],
  ['application/vnd.ms-excel', oleHeader],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', zipHeader],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zipHeader],
]);



SIGNATURES.set('image/jpg', SIGNATURES.get('image/jpeg'));

export function contentMatchesMime(buffer, mime) {
  const check = SIGNATURES.get(String(mime || '').toLowerCase());









  // `js/unvalidated-dynamic-method-call` meldet.
  if (typeof check !== 'function') return true;
  if (!buffer || !buffer.length) return false;
  return check(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
}

export function hasSignature(mime) {
  return SIGNATURES.has(String(mime || '').toLowerCase());
}




const HEAD_B64_CHARS = 2048;

export function dataUrlContentMatches(dataUrl) {
  // `;base64,` case-insensitiv: ein data-URL-Leser dekodiert `;BASE64,` genauso,

  // lassen.
  const match = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(String(dataUrl || ''));
  if (!match) return false;
  const mime = match[1].toLowerCase();
  if (!hasSignature(mime)) return true;

  const b64 = match[2].replace(/\s/g, '').slice(0, HEAD_B64_CHARS);
  const head = Buffer.from(b64.slice(0, b64.length - (b64.length % 4)), 'base64');
  return contentMatchesMime(head, mime);
}
