
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { isIP } from 'node:net';

const DEFAULT_MAX_REDIRECTS = 5;




//











const ALLOWED_PROTOCOLS = new Set(['https:', 'http:']);



// /cal/ umleitet) bleiben sie, sonst braeche jeder WebDAV-Sync.
const ORIGIN_BOUND_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization']);









function literalAddress(url) {
  const host = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname;
  return isIP(host) ? host : null;
}

function assertLookupAcceptsLiteral(lookup, url) {
  const address = literalAddress(url);
  if (!lookup || !address) return Promise.resolve();
  return new Promise((resolve, reject) => {
    lookup(address, { all: true }, (err) => (err ? reject(err) : resolve()));
  });
}

export function resolveRedirect(from, location) {
  let next;
  try {
    next = new URL(location, from);
  } catch {
    throw new Error('Invalid redirect location');
  }
  if (!ALLOWED_PROTOCOLS.has(next.protocol)) {
    throw new Error(`Redirect to unsupported protocol: ${next.protocol}`);
  }
  if (from.protocol === 'https:' && next.protocol === 'http:') {
    throw new Error('Redirect downgrades https to http');
  }
  return next;
}

export function headersForRedirect(headers, from, to) {
  if (from.origin === to.origin) return headers;
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!ORIGIN_BOUND_HEADERS.has(name.toLowerCase())) out[name] = value;
  }
  return out;
}


// node-fetch tat das (`User-Agent: node-fetch`, `Accept: */*`, `Accept-Encoding:






const DEFAULT_HEADERS = {
  'User-Agent': 'Aashiyana (+https://github.com/AyushChandrawat/Aashiyana)',
  Accept: '*/*',
  'Accept-Encoding': 'gzip, deflate, br',
};

function decodeBody(res) {


  if (res.statusCode === 204 || res.statusCode === 304
    || res.headers['content-length'] === '0') {
    return res;
  }
  const encoding = String(res.headers['content-encoding'] || '').toLowerCase().trim();
  let decompressor;
  if (encoding === 'gzip' || encoding === 'x-gzip') decompressor = zlib.createGunzip();
  else if (encoding === 'deflate') decompressor = zlib.createInflate();
  else if (encoding === 'br') decompressor = zlib.createBrotliDecompress();
  else return res;

  res.on('error', (err) => decompressor.destroy(err));
  decompressor.on('close', () => res.destroy());
  res.pipe(decompressor);
  return decompressor;
}

function fetchLike(res) {
  return {
    status: res.statusCode,
    get ok() { return res.statusCode >= 200 && res.statusCode < 300; },
    headers: {
      get(name) {
        const value = res.headers[String(name).toLowerCase()];
        return Array.isArray(value) ? value.join(', ') : (value ?? null);
      },
    },
    body: decodeBody(res),
  };
}

export function safeRequest(rawUrl, {
  method = 'GET',
  headers = {},
  body,
  lookup,
  signal,
  redirect = 'follow',
  maxRedirects = DEFAULT_MAX_REDIRECTS,
} = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(rawUrl);
    } catch (err) {
      reject(err);
      return;
    }

    const transport = url.protocol === 'https:' ? https : http;
    const outHeaders = { ...headers };
    const lowerKeys = new Set(Object.keys(outHeaders).map((h) => h.toLowerCase()));

    // Schreibweise) mitgibt.
    for (const [name, value] of Object.entries(DEFAULT_HEADERS)) {
      if (!lowerKeys.has(name.toLowerCase())) outHeaders[name] = value;
    }
    const hasBody = body !== undefined && body !== null;

    // Wert und keine explizite Transfer-Encoding vorgibt).
    if (hasBody
      && (typeof body === 'string' || Buffer.isBuffer(body))
      && !Object.keys(outHeaders).some((h) => h.toLowerCase() === 'content-length')
      && !Object.keys(outHeaders).some((h) => h.toLowerCase() === 'transfer-encoding')) {
      outHeaders['Content-Length'] = Buffer.byteLength(body);
    }

    const start = () => transport.request(url, { method, headers: outHeaders, lookup, signal }, (res) => {
      const status = res.statusCode;
      if (redirect === 'follow' && status >= 300 && status < 400 && res.headers.location) {
        res.resume(); // Redirect-Body verwerfen, Socket freigeben
        if (maxRedirects <= 0) {
          reject(new Error('Too many redirects'));
          return;
        }
        let next;
        try {
          next = resolveRedirect(url, res.headers.location);
        } catch (err) {
          reject(err);
          return;
        }
        resolve(safeRequest(next.href, {
          method,
          headers: headersForRedirect(headers, url, next),
          body,
          lookup,
          signal,
          redirect,
          maxRedirects: maxRedirects - 1,
        }));
        return;
      }
      resolve(fetchLike(res));
    });

    assertLookupAcceptsLiteral(lookup, url).then(() => {
      const req = start();
      req.on('error', reject);
      if (hasBody) req.write(body);
      req.end();
    }, reject);
  });
}
