'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Validate `body` against `spec` and return a clean object containing only
 * the declared fields. With `partial` set, missing fields are skipped
 * (used for updates) instead of defaulted.
 *
 * Field spec: { type: 'string'|'text'|'date'|'int'|'number'|'enum', required, max, values, min }
 */
function clean(body, spec, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
  const out = {};
  for (const [field, rule] of Object.entries(spec)) {
    let v = body[field];
    const missing = v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    if (missing) {
      if (partial && v === undefined) continue;
      if (rule.required) throw new HttpError(400, `${rule.label || field} is required`);
      out[field] = rule.type === 'string' || rule.type === 'text' ? '' : null;
      if (rule.type === 'enum' && rule.default !== undefined) out[field] = rule.default;
      continue;
    }
    const label = rule.label || field;
    switch (rule.type) {
      case 'string':
      case 'text': {
        if (typeof v !== 'string' && typeof v !== 'number') throw new HttpError(400, `${label} must be text`);
        v = String(v).trim();
        const max = rule.max || (rule.type === 'text' ? 5000 : 200);
        if (v.length > max) throw new HttpError(400, `${label} must be at most ${max} characters`);
        break;
      }
      case 'date':
        if (typeof v !== 'string' || !isValidDate(v)) throw new HttpError(400, `${label} must be a date (YYYY-MM-DD)`);
        break;
      case 'int':
      case 'number': {
        const n = Number(v);
        if (!Number.isFinite(n) || (rule.type === 'int' && !Number.isInteger(n))) {
          throw new HttpError(400, `${label} must be a ${rule.type === 'int' ? 'whole number' : 'number'}`);
        }
        if (rule.min !== undefined && n < rule.min) throw new HttpError(400, `${label} must be at least ${rule.min}`);
        if (rule.max !== undefined && n > rule.max) throw new HttpError(400, `${label} must be at most ${rule.max}`);
        v = n;
        break;
      }
      case 'enum':
        if (!rule.values.includes(v)) throw new HttpError(400, `${label} must be one of: ${rule.values.join(', ')}`);
        break;
      default:
        throw new Error(`Unknown rule type ${rule.type}`);
    }
    out[field] = v;
  }
  return out;
}

function toId(v, label = 'id') {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${label}`);
  return n;
}

module.exports = { HttpError, clean, toId, isValidDate };
