'use strict';

const crypto = require('node:crypto');
const { hashPassword } = require('./auth');
const { tx } = require('./db');

const DEMO_PASSWORD = 'Demo@2026';

/** Make sure at least one administrator exists. Returns generated credentials, if any. */
function ensureAdmin(db, password = process.env.ADMIN_PASSWORD) {
  const count = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  if (count > 0) return null;
  const pwd = password || crypto.randomBytes(9).toString('base64url') + '9a';
  db.prepare(`INSERT INTO users (username, full_name, role, agency, password_hash)
              VALUES ('admin', 'System Administrator', 'admin', 'Headquarters', ?)`).run(hashPassword(pwd));
  return { username: 'admin', password: pwd, generated: !password };
}

/** Populate sample users and records so the integrated workflow can be explored. */
function seedDemo(db) {
  // Demo records reference user ids 1-4, so only seed a fresh database.
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) return false;
  const hash = hashPassword(DEMO_PASSWORD);
  tx(db, () => {
    const addUser = db.prepare('INSERT OR IGNORE INTO users (username, full_name, role, agency, password_hash) VALUES (?, ?, ?, ?, ?)');
    addUser.run('admin', 'System Administrator', 'admin', 'Headquarters', hash);
    addUser.run('police1', 'Insp. R. Kumar', 'police', 'Central Police Station', hash);
    addUser.run('court1', 'Registrar S. Mehta', 'court', 'District & Sessions Court', hash);
    addUser.run('jail1', 'Supt. A. Fernandes', 'jail', 'Central Prison', hash);

    const year = new Date().getFullYear();
    const d = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
    const person = db.prepare(`INSERT INTO persons (full_name, alias, gender, dob, national_id, parent_name, address,
      height_cm, identifying_marks, status, risk_level, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`);
    const people = [
      ['Ravi Shankar', 'Ravi Knife', 'Male', '1988-03-14', 'ID-448120', 'Mohan Shankar', '12 Market Road, Old Town', 172, 'Scar on left cheek', 'Imprisoned', 'High', 'Repeat offender — robbery'],
      ['Suresh Pillai', '', 'Male', '1995-07-02', 'ID-552871', 'K. Pillai', '44 Lake View Colony', 168, 'Tattoo on right forearm', 'In Custody', 'Medium', ''],
      ['Anita Desai', '', 'Female', '1990-11-23', 'ID-661045', 'P. Desai', '7 Station Street', 160, '', 'On Bail', 'Low', 'Cheating case'],
      ['Imran Qureshi', 'Bhai', 'Male', '1983-01-30', 'ID-331904', 'Salim Qureshi', 'Unknown', 178, 'Mole above right eyebrow', 'Wanted', 'High', 'Absconding since last hearing'],
      ['Deepak Rao', '', 'Male', '2000-05-19', 'ID-774310', 'V. Rao', '3 Hill Crescent', 175, '', 'Acquitted', 'Low', ''],
    ];
    const ids = people.map((p) => {
      const id = Number(person.run(...p).lastInsertRowid);
      db.prepare('UPDATE persons SET record_no = ? WHERE id = ?').run(`CR-${year}-${String(id).padStart(6, '0')}`, id);
      return id;
    });

    const fir = db.prepare(`INSERT INTO firs (fir_no, police_station, district, incident_date, incident_place, offence_sections,
      description, complainant, io_name, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,2)`);
    const f1 = Number(fir.run(`FIR-${year}-0101`, 'Central Police Station', 'Metro District', d(-240), 'MG Road ATM',
      'IPC 392, 397', 'Armed robbery at ATM kiosk at night.', 'Bank Manager', 'Insp. R. Kumar', 'Charge Sheeted').lastInsertRowid);
    const f2 = Number(fir.run(`FIR-${year}-0145`, 'Central Police Station', 'Metro District', d(-60), 'Lake View Colony',
      'IPC 379', 'Two-wheeler theft.', 'M. Joseph', 'SI P. Nair', 'Charge Sheeted').lastInsertRowid);
    const f3 = Number(fir.run(`FIR-${year}-0152`, 'North Police Station', 'Metro District', d(-30), 'Station Street',
      'IPC 420', 'Online cheating of customers.', 'Consumer Forum', 'SI L. Thomas', 'Under Investigation').lastInsertRowid);
    const f4 = Number(fir.run(`FIR-${year}-0170`, 'Central Police Station', 'Metro District', d(-10), 'Old Town',
      'IPC 302', 'Homicide — accused absconding.', 'Victim family', 'Insp. R. Kumar', 'Registered').lastInsertRowid);
    const acc = db.prepare('INSERT INTO fir_accused (fir_id, person_id) VALUES (?, ?)');
    acc.run(f1, ids[0]); acc.run(f1, ids[4]); acc.run(f2, ids[1]); acc.run(f3, ids[2]); acc.run(f4, ids[3]);

    const arrest = db.prepare('INSERT INTO arrests (person_id, fir_id, arrest_date, place, arresting_officer, created_by) VALUES (?,?,?,?,?,2)');
    arrest.run(ids[0], f1, d(-235), 'Bus stand', 'Insp. R. Kumar');
    arrest.run(ids[4], f1, d(-234), 'Residence', 'Insp. R. Kumar');
    arrest.run(ids[1], f2, d(-55), 'Lake View Colony', 'SI P. Nair');
    arrest.run(ids[2], f3, d(-25), 'Residence', 'SI L. Thomas');

    const cc = db.prepare(`INSERT INTO court_cases (case_no, fir_id, court_name, judge, case_type, filing_date, status, next_hearing, created_by)
      VALUES (?,?,?,?,?,?,?,?,3)`);
    const c1 = Number(cc.run(`SC-${year}-011`, f1, 'District & Sessions Court', 'Hon. J. Banerjee', 'Criminal Trial', d(-200), 'Disposed', null).lastInsertRowid);
    const c2 = Number(cc.run(`CC-${year}-208`, f2, 'Chief Judicial Magistrate Court', 'Hon. K. Iyer', 'Criminal Trial', d(-45), 'Under Trial', d(3)).lastInsertRowid);
    const c3 = Number(cc.run(`CC-${year}-231`, f3, 'Chief Judicial Magistrate Court', 'Hon. K. Iyer', 'Criminal Trial', d(-20), 'Under Trial', d(6)).lastInsertRowid);
    const party = db.prepare(`INSERT INTO case_accused (case_id, person_id, verdict, sentence_months, fine_amount, verdict_date)
      VALUES (?,?,?,?,?,?)`);
    party.run(c1, ids[0], 'Convicted', 84, 25000, d(-120));
    party.run(c1, ids[4], 'Acquitted', null, null, d(-120));
    party.run(c2, ids[1], 'Pending', null, null, null);
    party.run(c3, ids[2], 'Bail Granted', null, null, null);
    const hearing = db.prepare('INSERT INTO hearings (case_id, hearing_date, purpose, outcome, next_date, created_by) VALUES (?,?,?,?,?,3)');
    hearing.run(c1, d(-150), 'Final arguments', 'Arguments heard, reserved for judgment', d(-120));
    hearing.run(c1, d(-120), 'Judgment', 'A1 convicted — 7 years RI; A2 acquitted', null);
    hearing.run(c2, d(-25), 'Framing of charges', 'Charges framed; accused pleaded not guilty', d(3));
    hearing.run(c3, d(-15), 'Bail hearing', 'Bail granted on surety', d(6));

    const jail = db.prepare(`INSERT INTO jail_records (inmate_no, person_id, case_id, prison_name, category, cell_block, admission_date,
      expected_release, release_date, release_reason, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,4)`);
    jail.run(`INM-${year}-00001`, ids[0], c1, 'Central Prison', 'Convict', 'Block C / 14', d(-120), d(2400), null, '', 'In Custody');
    jail.run(`INM-${year}-00002`, ids[1], c2, 'District Jail', 'Undertrial', 'Block A / 3', d(-54), null, null, '', 'In Custody');
    jail.run(`INM-${year}-00003`, ids[2], c3, 'District Jail', 'Undertrial', 'Women Block / 2', d(-24), null, d(-15), 'Bail', 'Released');
    jail.run(`INM-${year}-00004`, ids[4], c1, 'District Jail', 'Undertrial', 'Block A / 7', d(-233), null, d(-120), 'Acquitted', 'Released');

    db.prepare("INSERT INTO audit_log (user_id, username, action, entity, details) VALUES (1, 'admin', 'SEED', 'system', 'Demo data loaded')").run();
  });
  return true;
}

module.exports = { ensureAdmin, seedDemo, DEMO_PASSWORD };
