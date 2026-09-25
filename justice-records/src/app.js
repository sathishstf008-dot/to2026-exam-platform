'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { routes } = require('./api');
const auth = require('./auth');
const { HttpError } = require('./validate');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY = 256 * 1024;
const COOKIE = 'jr_session';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html'; // SPA fallback
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, SECURITY_HEADERS);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

function createApp(db, { secureCookies = false, logger = console } = {}) {
  const limiter = new auth.LoginLimiter();
  const table = routes(db, limiter);

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;

    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
      return serveStatic(req, res, pathname);
    }

    try {
      const route = table.find((rt) => rt.method === req.method && rt.re.test(pathname));
      if (!route) {
        const exists = table.some((rt) => rt.re.test(pathname));
        throw new HttpError(exists ? 405 : 404, exists ? 'Method not allowed' : 'Not found');
      }
      const params = {};
      const m = route.re.exec(pathname);
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });

      const token = parseCookies(req.headers.cookie)[COOKIE];
      const user = auth.getSessionUser(db, token);
      if (!route.public && !user) throw new HttpError(401, 'Please sign in');

      let body = {};
      if (req.method !== 'GET' && req.method !== 'DELETE') {
        // Requiring JSON blocks cross-site form posts (CSRF) in addition to SameSite cookies.
        if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
          throw new HttpError(415, 'Content-Type must be application/json');
        }
        const raw = await readBody(req);
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          throw new HttpError(400, 'Invalid JSON');
        }
      }

      const headers = {};
      const setCookie = (value) => {
        const attrs = ['Path=/', 'HttpOnly', 'SameSite=Strict'];
        if (secureCookies) attrs.push('Secure');
        headers['Set-Cookie'] = value
          ? `${COOKIE}=${value}; Max-Age=${auth.SESSION_TTL_MS / 1000}; ${attrs.join('; ')}`
          : `${COOKIE}=; Max-Age=0; ${attrs.join('; ')}`;
      };

      const result = await route.handler({
        req, params, body, user, token, setCookie,
        query: Object.fromEntries(url.searchParams),
        ip: req.socket.remoteAddress,
      });
      send(res, req.method === 'POST' && pathname !== '/api/login' && pathname !== '/api/logout' ? 201 : 200, result, headers);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      logger.error(err);
      send(res, 500, { error: 'Internal server error' });
    }
  };
}

module.exports = { createApp };
