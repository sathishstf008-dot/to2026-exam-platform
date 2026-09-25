'use strict';

const crypto = require('node:crypto');

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // one working shift

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters';
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain letters and numbers';
  }
  return null;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, Date.now() + SESSION_TTL_MS);
  return token;
}

function getSessionUser(db, token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.role, u.agency, u.active, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?`).get(sha256(token));
  if (!row || row.expires_at < Date.now() || !row.active) return null;
  const { expires_at, active, ...user } = row;
  return user;
}

function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

/** Simple in-memory limiter for failed logins, keyed by IP + username. */
class LoginLimiter {
  constructor(maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    this.max = maxAttempts;
    this.windowMs = windowMs;
    this.failures = new Map();
  }
  isBlocked(key) {
    const entry = this.failures.get(key);
    if (!entry) return false;
    if (Date.now() - entry.first > this.windowMs) {
      this.failures.delete(key);
      return false;
    }
    return entry.count >= this.max;
  }
  fail(key) {
    const entry = this.failures.get(key);
    if (!entry || Date.now() - entry.first > this.windowMs) {
      this.failures.set(key, { count: 1, first: Date.now() });
    } else {
      entry.count++;
    }
  }
  reset(key) {
    this.failures.delete(key);
  }
}

module.exports = {
  hashPassword, verifyPassword, validatePassword,
  createSession, getSessionUser, destroySession, LoginLimiter, SESSION_TTL_MS,
};
