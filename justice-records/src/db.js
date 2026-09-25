'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','police','court','jail')),
  agency        TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Central criminal database: one row per individual, shared by all agencies.
CREATE TABLE IF NOT EXISTS persons (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  record_no      TEXT UNIQUE,
  full_name      TEXT NOT NULL,
  alias          TEXT NOT NULL DEFAULT '',
  gender         TEXT NOT NULL DEFAULT '',
  dob            TEXT,
  national_id    TEXT NOT NULL DEFAULT '',
  parent_name    TEXT NOT NULL DEFAULT '',
  address        TEXT NOT NULL DEFAULT '',
  height_cm      INTEGER,
  identifying_marks TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'Suspect',
  risk_level     TEXT NOT NULL DEFAULT 'Low' CHECK (risk_level IN ('Low','Medium','High')),
  notes          TEXT NOT NULL DEFAULT '',
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_persons_name ON persons(full_name);

-- Police: First Information Reports / cases
CREATE TABLE IF NOT EXISTS firs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  fir_no          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  police_station  TEXT NOT NULL,
  district        TEXT NOT NULL DEFAULT '',
  incident_date   TEXT,
  incident_place  TEXT NOT NULL DEFAULT '',
  offence_sections TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  complainant     TEXT NOT NULL DEFAULT '',
  io_name         TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'Registered',
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fir_accused (
  fir_id    INTEGER NOT NULL REFERENCES firs(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  added_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (fir_id, person_id)
);

CREATE TABLE IF NOT EXISTS arrests (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id         INTEGER NOT NULL REFERENCES persons(id),
  fir_id            INTEGER REFERENCES firs(id),
  arrest_date       TEXT NOT NULL,
  place             TEXT NOT NULL DEFAULT '',
  arresting_officer TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Court
CREATE TABLE IF NOT EXISTS court_cases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  case_no      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  fir_id       INTEGER REFERENCES firs(id),
  court_name   TEXT NOT NULL,
  judge        TEXT NOT NULL DEFAULT '',
  case_type    TEXT NOT NULL DEFAULT 'Criminal Trial',
  filing_date  TEXT,
  status       TEXT NOT NULL DEFAULT 'Pending',
  next_hearing TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS case_accused (
  case_id         INTEGER NOT NULL REFERENCES court_cases(id) ON DELETE CASCADE,
  person_id       INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  verdict         TEXT NOT NULL DEFAULT 'Pending',
  sentence_months INTEGER,
  fine_amount     REAL,
  verdict_date    TEXT,
  remarks         TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (case_id, person_id)
);

CREATE TABLE IF NOT EXISTS hearings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id      INTEGER NOT NULL REFERENCES court_cases(id) ON DELETE CASCADE,
  hearing_date TEXT NOT NULL,
  purpose      TEXT NOT NULL DEFAULT '',
  outcome      TEXT NOT NULL DEFAULT '',
  next_date    TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Jail / prison custody
CREATE TABLE IF NOT EXISTS jail_records (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  inmate_no        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  person_id        INTEGER NOT NULL REFERENCES persons(id),
  case_id          INTEGER REFERENCES court_cases(id),
  prison_name      TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT 'Undertrial' CHECK (category IN ('Remand','Undertrial','Convict')),
  cell_block       TEXT NOT NULL DEFAULT '',
  admission_date   TEXT NOT NULL,
  expected_release TEXT,
  release_date     TEXT,
  release_reason   TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'In Custody',
  remarks          TEXT NOT NULL DEFAULT '',
  created_by       INTEGER REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER,
  username  TEXT NOT NULL DEFAULT '',
  action    TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entity_id INTEGER,
  details   TEXT NOT NULL DEFAULT '',
  at        TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

/** Run fn inside a transaction; rolls back on any thrown error. */
function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDatabase, tx };
