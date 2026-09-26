'use strict';

const { tx } = require('./db');
const { HttpError, clean, toId } = require('./validate');
const auth = require('./auth');
const C = require('./constants');

// ---------------------------------------------------------------------------
// Field specifications
// ---------------------------------------------------------------------------

const PERSON_SPEC = {
  full_name: { type: 'string', required: true, label: 'Full name' },
  alias: { type: 'string' },
  gender: { type: 'enum', values: C.GENDERS },
  dob: { type: 'date', label: 'Date of birth' },
  national_id: { type: 'string', max: 50, label: 'National ID' },
  parent_name: { type: 'string', label: "Father's / mother's name" },
  address: { type: 'text', max: 500 },
  height_cm: { type: 'int', min: 30, max: 260, label: 'Height' },
  identifying_marks: { type: 'text', max: 500 },
  status: { type: 'enum', values: C.PERSON_STATUSES, default: 'Suspect' },
  risk_level: { type: 'enum', values: C.RISK_LEVELS, default: 'Low', label: 'Risk level' },
  notes: { type: 'text' },
};

const FIR_SPEC = {
  fir_no: { type: 'string', required: true, max: 50, label: 'FIR number' },
  police_station: { type: 'string', required: true, label: 'Police station' },
  district: { type: 'string' },
  incident_date: { type: 'date', label: 'Incident date' },
  incident_place: { type: 'string', label: 'Place of occurrence' },
  offence_sections: { type: 'string', max: 300, label: 'Offence sections' },
  description: { type: 'text' },
  complainant: { type: 'string' },
  io_name: { type: 'string', label: 'Investigating officer' },
  status: { type: 'enum', values: C.FIR_STATUSES, default: 'Registered' },
};

const ARREST_SPEC = {
  person_id: { type: 'int', required: true, min: 1, label: 'Person' },
  fir_id: { type: 'int', min: 1, label: 'FIR' },
  arrest_date: { type: 'date', required: true, label: 'Arrest date' },
  place: { type: 'string' },
  arresting_officer: { type: 'string', label: 'Arresting officer' },
  notes: { type: 'text' },
};

const CASE_SPEC = {
  case_no: { type: 'string', required: true, max: 50, label: 'Case number' },
  fir_id: { type: 'int', min: 1, label: 'FIR' },
  court_name: { type: 'string', required: true, label: 'Court' },
  judge: { type: 'string' },
  case_type: { type: 'enum', values: C.CASE_TYPES, default: 'Criminal Trial', label: 'Case type' },
  filing_date: { type: 'date', label: 'Filing date' },
  status: { type: 'enum', values: C.CASE_STATUSES, default: 'Pending' },
  next_hearing: { type: 'date', label: 'Next hearing' },
};

const HEARING_SPEC = {
  hearing_date: { type: 'date', required: true, label: 'Hearing date' },
  purpose: { type: 'string' },
  outcome: { type: 'text', max: 2000 },
  next_date: { type: 'date', label: 'Next date' },
};

const VERDICT_SPEC = {
  verdict: { type: 'enum', values: C.VERDICTS, required: true },
  sentence_months: { type: 'int', min: 0, max: 1200, label: 'Sentence (months)' },
  fine_amount: { type: 'number', min: 0, label: 'Fine' },
  verdict_date: { type: 'date', label: 'Verdict date' },
  remarks: { type: 'text', max: 2000 },
};

const JAIL_SPEC = {
  inmate_no: { type: 'string', max: 50, label: 'Inmate number' },
  person_id: { type: 'int', required: true, min: 1, label: 'Person' },
  case_id: { type: 'int', min: 1, label: 'Court case' },
  prison_name: { type: 'string', required: true, label: 'Prison' },
  category: { type: 'enum', values: C.JAIL_CATEGORIES, default: 'Undertrial' },
  cell_block: { type: 'string', max: 50, label: 'Cell / block' },
  admission_date: { type: 'date', required: true, label: 'Admission date' },
  expected_release: { type: 'date', label: 'Expected release' },
  remarks: { type: 'text' },
};

const JAIL_UPDATE_SPEC = {
  prison_name: { type: 'string', required: true, label: 'Prison' },
  category: { type: 'enum', values: C.JAIL_CATEGORIES },
  cell_block: { type: 'string', max: 50 },
  expected_release: { type: 'date', label: 'Expected release' },
  remarks: { type: 'text' },
};

const RELEASE_SPEC = {
  release_date: { type: 'date', required: true, label: 'Release date' },
  release_reason: { type: 'enum', values: C.RELEASE_REASONS, required: true, label: 'Release reason' },
  remarks: { type: 'text' },
};

const USER_SPEC = {
  username: { type: 'string', required: true, max: 40 },
  full_name: { type: 'string', required: true, label: 'Full name' },
  role: { type: 'enum', values: C.ROLES, required: true },
  agency: { type: 'string', label: 'Agency / unit' },
  password: { type: 'string', required: true, max: 200 },
};

const USER_UPDATE_SPEC = {
  full_name: { type: 'string', required: true, label: 'Full name' },
  role: { type: 'enum', values: C.ROLES },
  agency: { type: 'string' },
  active: { type: 'int', min: 0, max: 1 },
  password: { type: 'string', max: 200 },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireRole(user, module) {
  if (!C.WRITE_ACCESS[module].includes(user.role)) {
    throw new HttpError(403, `Your role (${user.role}) cannot modify ${module} records`);
  }
}

function audit(db, user, action, entity, entityId, details = '') {
  db.prepare(`INSERT INTO audit_log (user_id, username, action, entity, entity_id, details)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(user ? user.id : null, user ? user.username : '', action, entity, entityId ?? null, String(details).slice(0, 1000));
}

function mustGet(db, sql, id, what) {
  const row = db.prepare(sql).get(id);
  if (!row) throw new HttpError(404, `${what} not found`);
  return row;
}

function updateRow(db, table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  const hasUpdatedAt = ['persons', 'firs', 'court_cases', 'jail_records'].includes(table);
  const set = keys.map((k) => `${k} = :${k}`).concat(hasUpdatedAt ? ["updated_at = datetime('now')"] : []);
  db.prepare(`UPDATE ${table} SET ${set.join(', ')} WHERE id = :id`).run({ ...data, id });
}

function insertRow(db, table, data) {
  const keys = Object.keys(data);
  const res = db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((k) => ':' + k).join(', ')})`).run(data);
  return Number(res.lastInsertRowid);
}

function uniqueGuard(fn, message) {
  try {
    return fn();
  } catch (err) {
    if (/UNIQUE constraint failed/.test(err.message)) throw new HttpError(409, message);
    throw err;
  }
}

const likeParam = (q) => `%${String(q).replace(/[\\%_]/g, (c) => '\\' + c)}%`;

function addMonths(isoDate, months) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

function setPersonStatus(db, personId, status) {
  db.prepare("UPDATE persons SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, personId);
}

function personExists(db, id) {
  mustGet(db, 'SELECT id FROM persons WHERE id = ?', id, 'Person');
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function routes(db, limiter) {
  const r = [];
  const add = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    r.push({ method, re, keys, handler, public: !!opts.public });
  };

  // ---- Auth ---------------------------------------------------------------
  add('POST', '/api/login', ({ body, ip, setCookie }) => {
    const { username, password } = clean(body, {
      username: { type: 'string', required: true, max: 40 },
      password: { type: 'string', required: true, max: 200 },
    });
    const key = `${ip}|${username.toLowerCase()}`;
    if (limiter.isBlocked(key)) throw new HttpError(429, 'Too many failed attempts. Try again later.');
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !user.active || !auth.verifyPassword(password, user.password_hash)) {
      limiter.fail(key);
      throw new HttpError(401, 'Invalid username or password');
    }
    limiter.reset(key);
    setCookie(auth.createSession(db, user.id));
    audit(db, user, 'LOGIN', 'user', user.id);
    return { user: publicUser(user) };
  }, { public: true });

  add('POST', '/api/logout', ({ token, user, setCookie }) => {
    auth.destroySession(db, token);
    audit(db, user, 'LOGOUT', 'user', user.id);
    setCookie(null);
    return { ok: true };
  });

  add('GET', '/api/me', ({ user }) => ({ user, permissions: permissionsFor(user.role) }));

  add('POST', '/api/me/password', ({ user, body }) => {
    const { current_password, new_password } = clean(body, {
      current_password: { type: 'string', required: true, max: 200, label: 'Current password' },
      new_password: { type: 'string', required: true, max: 200, label: 'New password' },
    });
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    if (!auth.verifyPassword(current_password, row.password_hash)) throw new HttpError(400, 'Current password is incorrect');
    const err = auth.validatePassword(new_password);
    if (err) throw new HttpError(400, err);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(new_password), user.id);
    audit(db, user, 'CHANGE_PASSWORD', 'user', user.id);
    return { ok: true };
  });

  add('GET', '/api/meta', () => ({
    person_statuses: C.PERSON_STATUSES, genders: C.GENDERS, risk_levels: C.RISK_LEVELS,
    fir_statuses: C.FIR_STATUSES, case_types: C.CASE_TYPES, case_statuses: C.CASE_STATUSES,
    verdicts: C.VERDICTS, jail_categories: C.JAIL_CATEGORIES, release_reasons: C.RELEASE_REASONS,
    roles: C.ROLES,
  }));

  // ---- Dashboard ------------------------------------------------------------
  add('GET', '/api/stats', () => {
    const one = (sql, ...p) => db.prepare(sql).get(...p).n;
    const t = today();
    const in7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    return {
      counts: {
        persons: one('SELECT COUNT(*) n FROM persons'),
        wanted: one("SELECT COUNT(*) n FROM persons WHERE status IN ('Wanted','Absconding')"),
        open_firs: one("SELECT COUNT(*) n FROM firs WHERE status <> 'Closed'"),
        arrests_30d: one("SELECT COUNT(*) n FROM arrests WHERE arrest_date >= date('now','-30 days')"),
        pending_cases: one("SELECT COUNT(*) n FROM court_cases WHERE status <> 'Disposed'"),
        convictions: one("SELECT COUNT(*) n FROM case_accused WHERE verdict = 'Convicted'"),
        in_custody: one("SELECT COUNT(*) n FROM jail_records WHERE status = 'In Custody'"),
        undertrials: one("SELECT COUNT(*) n FROM jail_records WHERE status = 'In Custody' AND category <> 'Convict'"),
      },
      persons_by_status: db.prepare('SELECT status, COUNT(*) n FROM persons GROUP BY status ORDER BY n DESC').all(),
      upcoming_hearings: db.prepare(`
        SELECT id, case_no, court_name, next_hearing FROM court_cases
        WHERE status <> 'Disposed' AND next_hearing BETWEEN ? AND ? ORDER BY next_hearing LIMIT 10`).all(t, in7),
      upcoming_releases: db.prepare(`
        SELECT j.id, j.inmate_no, j.prison_name, j.expected_release, p.full_name, p.id person_id
        FROM jail_records j JOIN persons p ON p.id = j.person_id
        WHERE j.status = 'In Custody' AND j.expected_release BETWEEN ? AND ? ORDER BY j.expected_release LIMIT 10`).all(t, in30),
      recent_activity: db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 12').all(),
    };
  });

  add('GET', '/api/search', ({ query }) => {
    const q = String(query.q || '').trim();
    if (q.length < 2) return { persons: [], firs: [], cases: [], inmates: [] };
    const like = likeParam(q);
    return {
      persons: db.prepare(`SELECT id, record_no, full_name, alias, status FROM persons
        WHERE full_name LIKE ?1 ESCAPE '\\' OR alias LIKE ?1 ESCAPE '\\' OR national_id LIKE ?1 ESCAPE '\\' OR record_no LIKE ?1 ESCAPE '\\'
        ORDER BY full_name LIMIT 20`).all(like),
      firs: db.prepare(`SELECT id, fir_no, police_station, status FROM firs
        WHERE fir_no LIKE ?1 ESCAPE '\\' OR offence_sections LIKE ?1 ESCAPE '\\' OR police_station LIKE ?1 ESCAPE '\\' LIMIT 20`).all(like),
      cases: db.prepare(`SELECT id, case_no, court_name, status FROM court_cases
        WHERE case_no LIKE ?1 ESCAPE '\\' OR court_name LIKE ?1 ESCAPE '\\' LIMIT 20`).all(like),
      inmates: db.prepare(`SELECT j.id, j.inmate_no, j.prison_name, j.status, p.full_name FROM jail_records j
        JOIN persons p ON p.id = j.person_id WHERE j.inmate_no LIKE ?1 ESCAPE '\\' LIMIT 20`).all(like),
    };
  });

  // ---- Persons (criminal database) -----------------------------------------
  add('GET', '/api/persons', ({ query }) => {
    const where = [];
    const params = {};
    if (query.q) {
      where.push(`(full_name LIKE :q ESCAPE '\\' OR alias LIKE :q ESCAPE '\\' OR national_id LIKE :q ESCAPE '\\' OR record_no LIKE :q ESCAPE '\\')`);
      params.q = likeParam(query.q);
    }
    if (query.status) { where.push('status = :status'); params.status = String(query.status); }
    if (query.risk) { where.push('risk_level = :risk'); params.risk = String(query.risk); }
    const sql = `SELECT p.*,
        (SELECT COUNT(*) FROM fir_accused fa WHERE fa.person_id = p.id) fir_count,
        (SELECT COUNT(*) FROM case_accused ca WHERE ca.person_id = p.id AND ca.verdict = 'Convicted') conviction_count
      FROM persons p ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY p.updated_at DESC, p.id DESC LIMIT 500`;
    return { items: db.prepare(sql).all(params) };
  });

  add('POST', '/api/persons', ({ user, body }) => {
    requireRole(user, 'persons');
    const data = clean(body, PERSON_SPEC);
    const id = tx(db, () => {
      const id = insertRow(db, 'persons', { ...data, created_by: user.id });
      const recordNo = `CR-${new Date().getFullYear()}-${String(id).padStart(6, '0')}`;
      db.prepare('UPDATE persons SET record_no = ? WHERE id = ?').run(recordNo, id);
      audit(db, user, 'CREATE', 'person', id, `${data.full_name} (${recordNo})`);
      return id;
    });
    return { item: getPerson(db, id) };
  });

  add('GET', '/api/persons/:id', ({ params }) => {
    const id = toId(params.id);
    const person = getPerson(db, id);
    return {
      item: person,
      firs: db.prepare(`SELECT f.id, f.fir_no, f.police_station, f.offence_sections, f.status, f.incident_date
        FROM fir_accused fa JOIN firs f ON f.id = fa.fir_id WHERE fa.person_id = ? ORDER BY f.incident_date DESC`).all(id),
      arrests: db.prepare(`SELECT a.*, f.fir_no FROM arrests a LEFT JOIN firs f ON f.id = a.fir_id
        WHERE a.person_id = ? ORDER BY a.arrest_date DESC`).all(id),
      cases: db.prepare(`SELECT c.id, c.case_no, c.court_name, c.status, c.next_hearing, ca.verdict, ca.sentence_months, ca.fine_amount, ca.verdict_date
        FROM case_accused ca JOIN court_cases c ON c.id = ca.case_id WHERE ca.person_id = ? ORDER BY c.filing_date DESC`).all(id),
      custody: db.prepare(`SELECT j.*, c.case_no FROM jail_records j LEFT JOIN court_cases c ON c.id = j.case_id
        WHERE j.person_id = ? ORDER BY j.admission_date DESC`).all(id),
    };
  });

  add('PUT', '/api/persons/:id', ({ user, params, body }) => {
    requireRole(user, 'persons');
    const id = toId(params.id);
    personExists(db, id);
    const data = clean(body, PERSON_SPEC, { partial: true });
    updateRow(db, 'persons', id, data);
    audit(db, user, 'UPDATE', 'person', id, Object.keys(data).join(', '));
    return { item: getPerson(db, id) };
  });

  // ---- Police: FIRs ---------------------------------------------------------
  add('GET', '/api/firs', ({ query }) => {
    const where = [];
    const params = {};
    if (query.q) {
      where.push(`(fir_no LIKE :q ESCAPE '\\' OR police_station LIKE :q ESCAPE '\\' OR offence_sections LIKE :q ESCAPE '\\' OR complainant LIKE :q ESCAPE '\\')`);
      params.q = likeParam(query.q);
    }
    if (query.status) { where.push('status = :status'); params.status = String(query.status); }
    return {
      items: db.prepare(`SELECT f.*, (SELECT COUNT(*) FROM fir_accused fa WHERE fa.fir_id = f.id) accused_count
        FROM firs f ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY f.id DESC LIMIT 500`).all(params),
    };
  });

  add('POST', '/api/firs', ({ user, body }) => {
    requireRole(user, 'firs');
    const data = clean(body, FIR_SPEC);
    const accused = parseIdList(body.accused_ids);
    const id = tx(db, () => {
      const id = uniqueGuard(() => insertRow(db, 'firs', { ...data, created_by: user.id }), 'FIR number already exists');
      for (const pid of accused) {
        personExists(db, pid);
        db.prepare('INSERT OR IGNORE INTO fir_accused (fir_id, person_id) VALUES (?, ?)').run(id, pid);
      }
      audit(db, user, 'CREATE', 'fir', id, data.fir_no);
      return id;
    });
    return getFir(db, id);
  });

  add('GET', '/api/firs/:id', ({ params }) => getFir(db, toId(params.id)));

  add('PUT', '/api/firs/:id', ({ user, params, body }) => {
    requireRole(user, 'firs');
    const id = toId(params.id);
    mustGet(db, 'SELECT id FROM firs WHERE id = ?', id, 'FIR');
    const data = clean(body, FIR_SPEC, { partial: true });
    uniqueGuard(() => updateRow(db, 'firs', id, data), 'FIR number already exists');
    audit(db, user, 'UPDATE', 'fir', id, Object.keys(data).join(', '));
    return getFir(db, id);
  });

  add('POST', '/api/firs/:id/accused', ({ user, params, body }) => {
    requireRole(user, 'firs');
    const id = toId(params.id);
    const fir = mustGet(db, 'SELECT id, fir_no FROM firs WHERE id = ?', id, 'FIR');
    const personId = toId(body && body.person_id, 'person');
    personExists(db, personId);
    db.prepare('INSERT OR IGNORE INTO fir_accused (fir_id, person_id) VALUES (?, ?)').run(id, personId);
    audit(db, user, 'ADD_ACCUSED', 'fir', id, `person #${personId} added to ${fir.fir_no}`);
    return getFir(db, id);
  });

  add('DELETE', '/api/firs/:id/accused/:pid', ({ user, params }) => {
    requireRole(user, 'firs');
    const id = toId(params.id);
    const pid = toId(params.pid);
    db.prepare('DELETE FROM fir_accused WHERE fir_id = ? AND person_id = ?').run(id, pid);
    audit(db, user, 'REMOVE_ACCUSED', 'fir', id, `person #${pid}`);
    return getFir(db, id);
  });

  // ---- Police: arrests -------------------------------------------------------
  add('GET', '/api/arrests', () => ({
    items: db.prepare(`SELECT a.*, p.full_name, p.record_no, f.fir_no FROM arrests a
      JOIN persons p ON p.id = a.person_id LEFT JOIN firs f ON f.id = a.fir_id
      ORDER BY a.arrest_date DESC, a.id DESC LIMIT 500`).all(),
  }));

  add('POST', '/api/arrests', ({ user, body }) => {
    requireRole(user, 'arrests');
    const data = clean(body, ARREST_SPEC);
    const id = tx(db, () => {
      personExists(db, data.person_id);
      if (data.fir_id) {
        mustGet(db, 'SELECT id FROM firs WHERE id = ?', data.fir_id, 'FIR');
        db.prepare('INSERT OR IGNORE INTO fir_accused (fir_id, person_id) VALUES (?, ?)').run(data.fir_id, data.person_id);
      }
      const id = insertRow(db, 'arrests', { ...data, created_by: user.id });
      setPersonStatus(db, data.person_id, 'Arrested');
      audit(db, user, 'ARREST', 'person', data.person_id, `arrest #${id} on ${data.arrest_date}`);
      return id;
    });
    return { item: db.prepare('SELECT * FROM arrests WHERE id = ?').get(id) };
  });

  // ---- Court -----------------------------------------------------------------
  add('GET', '/api/court-cases', ({ query }) => {
    const where = [];
    const params = {};
    if (query.q) {
      where.push(`(c.case_no LIKE :q ESCAPE '\\' OR c.court_name LIKE :q ESCAPE '\\' OR c.judge LIKE :q ESCAPE '\\' OR f.fir_no LIKE :q ESCAPE '\\')`);
      params.q = likeParam(query.q);
    }
    if (query.status) { where.push('c.status = :status'); params.status = String(query.status); }
    return {
      items: db.prepare(`SELECT c.*, f.fir_no, (SELECT COUNT(*) FROM case_accused ca WHERE ca.case_id = c.id) accused_count
        FROM court_cases c LEFT JOIN firs f ON f.id = c.fir_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.id DESC LIMIT 500`).all(params),
    };
  });

  add('POST', '/api/court-cases', ({ user, body }) => {
    requireRole(user, 'court');
    const data = clean(body, CASE_SPEC);
    const extraAccused = parseIdList(body.accused_ids);
    const id = tx(db, () => {
      if (data.fir_id) mustGet(db, 'SELECT id FROM firs WHERE id = ?', data.fir_id, 'FIR');
      const id = uniqueGuard(() => insertRow(db, 'court_cases', { ...data, created_by: user.id }), 'Case number already exists');
      const ins = db.prepare('INSERT OR IGNORE INTO case_accused (case_id, person_id) VALUES (?, ?)');
      if (data.fir_id) {
        // Integration: accused named in the police FIR automatically become parties to the trial.
        for (const { person_id } of db.prepare('SELECT person_id FROM fir_accused WHERE fir_id = ?').all(data.fir_id)) {
          ins.run(id, person_id);
        }
        db.prepare(`UPDATE firs SET status = 'Charge Sheeted', updated_at = datetime('now')
                    WHERE id = ? AND status IN ('Registered','Under Investigation')`).run(data.fir_id);
      }
      for (const pid of extraAccused) {
        personExists(db, pid);
        ins.run(id, pid);
      }
      audit(db, user, 'CREATE', 'court_case', id, data.case_no);
      return id;
    });
    return getCase(db, id);
  });

  add('GET', '/api/court-cases/:id', ({ params }) => getCase(db, toId(params.id)));

  add('PUT', '/api/court-cases/:id', ({ user, params, body }) => {
    requireRole(user, 'court');
    const id = toId(params.id);
    mustGet(db, 'SELECT id FROM court_cases WHERE id = ?', id, 'Court case');
    const data = clean(body, CASE_SPEC, { partial: true });
    if (data.fir_id) mustGet(db, 'SELECT id FROM firs WHERE id = ?', data.fir_id, 'FIR');
    uniqueGuard(() => updateRow(db, 'court_cases', id, data), 'Case number already exists');
    audit(db, user, 'UPDATE', 'court_case', id, Object.keys(data).join(', '));
    return getCase(db, id);
  });

  add('POST', '/api/court-cases/:id/accused', ({ user, params, body }) => {
    requireRole(user, 'court');
    const id = toId(params.id);
    mustGet(db, 'SELECT id FROM court_cases WHERE id = ?', id, 'Court case');
    const pid = toId(body && body.person_id, 'person');
    personExists(db, pid);
    db.prepare('INSERT OR IGNORE INTO case_accused (case_id, person_id) VALUES (?, ?)').run(id, pid);
    audit(db, user, 'ADD_ACCUSED', 'court_case', id, `person #${pid}`);
    return getCase(db, id);
  });

  add('POST', '/api/court-cases/:id/hearings', ({ user, params, body }) => {
    requireRole(user, 'court');
    const id = toId(params.id);
    const cs = mustGet(db, 'SELECT id, status FROM court_cases WHERE id = ?', id, 'Court case');
    const data = clean(body, HEARING_SPEC);
    tx(db, () => {
      insertRow(db, 'hearings', { ...data, case_id: id, created_by: user.id });
      const newStatus = cs.status === 'Pending' ? 'Under Trial' : cs.status;
      db.prepare("UPDATE court_cases SET next_hearing = ?, status = ?, updated_at = datetime('now') WHERE id = ?")
        .run(data.next_date, newStatus, id);
      audit(db, user, 'HEARING', 'court_case', id, `${data.hearing_date}: ${data.purpose}`);
    });
    return getCase(db, id);
  });

  add('PUT', '/api/court-cases/:id/accused/:pid', ({ user, params, body }) => {
    requireRole(user, 'court');
    const id = toId(params.id);
    const pid = toId(params.pid);
    mustGet(db, 'SELECT id FROM court_cases WHERE id = ?', id, 'Court case');
    const party = db.prepare('SELECT * FROM case_accused WHERE case_id = ? AND person_id = ?').get(id, pid);
    if (!party) throw new HttpError(404, 'This person is not an accused in the case');
    const data = clean(body, VERDICT_SPEC);
    if (data.verdict === 'Convicted' && data.sentence_months === null && data.fine_amount === null) {
      throw new HttpError(400, 'A conviction needs a sentence (months) and/or a fine');
    }
    if (data.verdict !== 'Pending' && !data.verdict_date) data.verdict_date = today();
    tx(db, () => {
      db.prepare(`UPDATE case_accused SET verdict = :verdict, sentence_months = :sentence_months, fine_amount = :fine_amount,
                  verdict_date = :verdict_date, remarks = :remarks WHERE case_id = :case_id AND person_id = :person_id`)
        .run({ ...data, case_id: id, person_id: pid });
      const personStatus = { Convicted: 'Convicted', Acquitted: 'Acquitted', Discharged: 'Released', 'Bail Granted': 'On Bail' }[data.verdict];
      if (personStatus) setPersonStatus(db, pid, personStatus);
      // Case is disposed once every accused has a final verdict.
      const open = db.prepare(`SELECT COUNT(*) n FROM case_accused WHERE case_id = ? AND verdict IN ('Pending','Bail Granted')`).get(id).n;
      if (open === 0) {
        db.prepare("UPDATE court_cases SET status = 'Disposed', next_hearing = NULL, updated_at = datetime('now') WHERE id = ?").run(id);
      }
      audit(db, user, 'VERDICT', 'court_case', id, `person #${pid}: ${data.verdict}${data.sentence_months ? `, ${data.sentence_months} months` : ''}`);
    });
    return getCase(db, id);
  });

  // ---- Jail -------------------------------------------------------------------
  add('GET', '/api/jail', ({ query }) => {
    const where = [];
    const params = {};
    if (query.q) {
      where.push(`(j.inmate_no LIKE :q ESCAPE '\\' OR p.full_name LIKE :q ESCAPE '\\' OR j.prison_name LIKE :q ESCAPE '\\' OR p.record_no LIKE :q ESCAPE '\\')`);
      params.q = likeParam(query.q);
    }
    if (query.status) { where.push('j.status = :status'); params.status = String(query.status); }
    if (query.category) { where.push('j.category = :category'); params.category = String(query.category); }
    return {
      items: db.prepare(`SELECT j.*, p.full_name, p.record_no, c.case_no FROM jail_records j
        JOIN persons p ON p.id = j.person_id LEFT JOIN court_cases c ON c.id = j.case_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY j.status = 'In Custody' DESC, j.admission_date DESC LIMIT 500`).all(params),
    };
  });

  add('POST', '/api/jail', ({ user, body }) => {
    requireRole(user, 'jail');
    const data = clean(body, JAIL_SPEC);
    const id = tx(db, () => {
      personExists(db, data.person_id);
      const already = db.prepare("SELECT inmate_no FROM jail_records WHERE person_id = ? AND status = 'In Custody'").get(data.person_id);
      if (already) throw new HttpError(409, `Person is already in custody as ${already.inmate_no}`);
      if (data.case_id) {
        mustGet(db, 'SELECT id FROM court_cases WHERE id = ?', data.case_id, 'Court case');
        // Integration: compute release date from the court's sentence when not given.
        const party = db.prepare('SELECT verdict, sentence_months FROM case_accused WHERE case_id = ? AND person_id = ?').get(data.case_id, data.person_id);
        if (party && party.verdict === 'Convicted') {
          data.category = 'Convict';
          if (!data.expected_release && party.sentence_months) {
            data.expected_release = addMonths(data.admission_date, party.sentence_months);
          }
        }
      }
      if (data.category === 'Convict' && data.case_id === null) {
        throw new HttpError(400, 'Convict admissions must reference the court case that passed the sentence');
      }
      const autoNo = !data.inmate_no;
      if (autoNo) data.inmate_no = `TMP-${Date.now()}-${Math.random()}`;
      const id = uniqueGuard(() => insertRow(db, 'jail_records', { ...data, created_by: user.id }), 'Inmate number already exists');
      if (autoNo) {
        data.inmate_no = `INM-${data.admission_date.slice(0, 4)}-${String(id).padStart(5, '0')}`;
        db.prepare('UPDATE jail_records SET inmate_no = ? WHERE id = ?').run(data.inmate_no, id);
      }
      setPersonStatus(db, data.person_id, data.category === 'Convict' ? 'Imprisoned' : 'In Custody');
      audit(db, user, 'ADMIT', 'jail_record', id, `${data.inmate_no} at ${data.prison_name} (${data.category})`);
      return id;
    });
    return { item: getJail(db, id) };
  });

  add('GET', '/api/jail/:id', ({ params }) => ({ item: getJail(db, toId(params.id)) }));

  add('PUT', '/api/jail/:id', ({ user, params, body }) => {
    requireRole(user, 'jail');
    const id = toId(params.id);
    const rec = getJail(db, id);
    if (rec.status !== 'In Custody') throw new HttpError(409, 'Released records cannot be modified');
    const data = clean(body, JAIL_UPDATE_SPEC, { partial: true });
    updateRow(db, 'jail_records', id, data);
    const moved = data.prison_name && data.prison_name !== rec.prison_name;
    audit(db, user, moved ? 'TRANSFER' : 'UPDATE', 'jail_record', id,
      moved ? `${rec.prison_name} → ${data.prison_name}` : Object.keys(data).join(', '));
    return { item: getJail(db, id) };
  });

  add('POST', '/api/jail/:id/release', ({ user, params, body }) => {
    requireRole(user, 'jail');
    const id = toId(params.id);
    const rec = getJail(db, id);
    if (rec.status !== 'In Custody') throw new HttpError(409, 'Inmate has already been released');
    const data = clean(body, RELEASE_SPEC);
    if (data.release_date < rec.admission_date) throw new HttpError(400, 'Release date cannot be before admission date');
    tx(db, () => {
      const status = data.release_reason === 'Transferred' ? 'Transferred' : 'Released';
      db.prepare(`UPDATE jail_records SET release_date = ?, release_reason = ?, status = ?,
                  remarks = CASE WHEN ? = '' THEN remarks ELSE ? END, updated_at = datetime('now') WHERE id = ?`)
        .run(data.release_date, data.release_reason, status, data.remarks, data.remarks, id);
      const personStatus = { Bail: 'On Bail', Acquitted: 'Acquitted', Transferred: null }[data.release_reason];
      if (personStatus !== null) setPersonStatus(db, rec.person_id, personStatus || 'Released');
      audit(db, user, 'RELEASE', 'jail_record', id, `${rec.inmate_no}: ${data.release_reason} on ${data.release_date}`);
    });
    return { item: getJail(db, id) };
  });

  // ---- Administration --------------------------------------------------------
  add('GET', '/api/users', ({ user }) => {
    requireRole(user, 'users');
    return { items: db.prepare('SELECT id, username, full_name, role, agency, active, created_at FROM users ORDER BY id').all() };
  });

  add('POST', '/api/users', ({ user, body }) => {
    requireRole(user, 'users');
    const data = clean(body, USER_SPEC);
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(data.username)) throw new HttpError(400, 'Username may contain letters, numbers, dot, dash and underscore (3-40 chars)');
    const err = auth.validatePassword(data.password);
    if (err) throw new HttpError(400, err);
    const { password, ...rest } = data;
    const id = uniqueGuard(() => insertRow(db, 'users', { ...rest, password_hash: auth.hashPassword(password) }), 'Username already exists');
    audit(db, user, 'CREATE', 'user', id, `${data.username} (${data.role})`);
    return { item: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) };
  });

  add('PUT', '/api/users/:id', ({ user, params, body }) => {
    requireRole(user, 'users');
    const id = toId(params.id);
    mustGet(db, 'SELECT id FROM users WHERE id = ?', id, 'User');
    const data = clean(body, USER_UPDATE_SPEC, { partial: true });
    if (id === user.id && (data.active === 0 || (data.role && data.role !== 'admin'))) {
      throw new HttpError(400, 'You cannot deactivate or demote your own account');
    }
    if (data.password) {
      const err = auth.validatePassword(data.password);
      if (err) throw new HttpError(400, err);
      data.password_hash = auth.hashPassword(data.password);
    }
    delete data.password;
    updateRow(db, 'users', id, data);
    if (data.active === 0 || data.password_hash) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    audit(db, user, 'UPDATE', 'user', id, Object.keys(data).map((k) => (k === 'password_hash' ? 'password' : k)).join(', '));
    return { item: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) };
  });

  add('GET', '/api/audit', ({ user, query }) => {
    requireRole(user, 'users');
    const params = {};
    const where = [];
    if (query.entity) { where.push('entity = :entity'); params.entity = String(query.entity); }
    if (query.user) { where.push('username = :user'); params.user = String(query.user); }
    return { items: db.prepare(`SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`).all(params) };
  });

  return r;
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

function getPerson(db, id) {
  return mustGet(db, 'SELECT * FROM persons WHERE id = ?', id, 'Person');
}

function getFir(db, id) {
  const item = mustGet(db, 'SELECT * FROM firs WHERE id = ?', id, 'FIR');
  return {
    item,
    accused: db.prepare(`SELECT p.id, p.record_no, p.full_name, p.alias, p.status FROM fir_accused fa
      JOIN persons p ON p.id = fa.person_id WHERE fa.fir_id = ? ORDER BY p.full_name`).all(id),
    arrests: db.prepare(`SELECT a.*, p.full_name FROM arrests a JOIN persons p ON p.id = a.person_id
      WHERE a.fir_id = ? ORDER BY a.arrest_date DESC`).all(id),
    cases: db.prepare('SELECT id, case_no, court_name, status FROM court_cases WHERE fir_id = ?').all(id),
  };
}

function getCase(db, id) {
  const item = mustGet(db, `SELECT c.*, f.fir_no FROM court_cases c LEFT JOIN firs f ON f.id = c.fir_id WHERE c.id = ?`, id, 'Court case');
  return {
    item,
    accused: db.prepare(`SELECT p.id, p.record_no, p.full_name, p.status, ca.verdict, ca.sentence_months, ca.fine_amount,
        ca.verdict_date, ca.remarks,
        (SELECT j.id FROM jail_records j WHERE j.person_id = p.id AND j.status = 'In Custody') custody_id
      FROM case_accused ca JOIN persons p ON p.id = ca.person_id WHERE ca.case_id = ? ORDER BY p.full_name`).all(id),
    hearings: db.prepare('SELECT * FROM hearings WHERE case_id = ? ORDER BY hearing_date DESC, id DESC').all(id),
  };
}

function getJail(db, id) {
  return mustGet(db, `SELECT j.*, p.full_name, p.record_no, c.case_no FROM jail_records j
    JOIN persons p ON p.id = j.person_id LEFT JOIN court_cases c ON c.id = j.case_id WHERE j.id = ?`, id, 'Jail record');
}

function publicUser(u) {
  return { id: u.id, username: u.username, full_name: u.full_name, role: u.role, agency: u.agency, active: u.active };
}

function permissionsFor(role) {
  return Object.fromEntries(Object.entries(C.WRITE_ACCESS).map(([k, roles]) => [k, roles.includes(role)]));
}

function parseIdList(v) {
  if (v === undefined || v === null || v === '') return [];
  if (!Array.isArray(v)) throw new HttpError(400, 'accused_ids must be a list');
  if (v.length > 100) throw new HttpError(400, 'Too many accused');
  return [...new Set(v.map((x) => toId(x, 'person')))];
}

module.exports = { routes, addMonths };
