'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { ensureAdmin, seedDemo, DEMO_PASSWORD } = require('../src/seed');
const { addMonths } = require('../src/api');

let server;
let base;
const PASSWORD = 'Str0ngPass!';

before(async () => {
  const db = openDatabase(':memory:');
  ensureAdmin(db, PASSWORD);
  server = http.createServer(createApp(db, { logger: { error() {} } }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

/** Minimal cookie-keeping client per user. */
function client() {
  let cookie = '';
  return async function call(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
}

async function loginAs(username, password = PASSWORD) {
  const c = client();
  const r = await c('POST', '/api/login', { username, password });
  assert.equal(r.status, 200, `login ${username}: ${r.text}`);
  return c;
}

let admin; let police; let court; let jail;

test('rejects unauthenticated access and bad credentials', async () => {
  const anon = client();
  assert.equal((await anon('GET', '/api/persons')).status, 401);
  assert.equal((await anon('POST', '/api/login', { username: 'admin', password: 'wrong' })).status, 401);
});

test('admin creates agency users', async () => {
  admin = await loginAs('admin');
  for (const [username, role, agency] of [['police1', 'police', 'Central PS'], ['court1', 'court', 'Sessions Court'], ['jail1', 'jail', 'Central Prison']]) {
    const r = await admin('POST', '/api/users', { username, full_name: username, role, agency, password: PASSWORD });
    assert.equal(r.status, 201, r.text);
  }
  const weak = await admin('POST', '/api/users', { username: 'x1', full_name: 'X', role: 'police', password: 'short' });
  assert.equal(weak.status, 400);
  const dup = await admin('POST', '/api/users', { username: 'POLICE1', full_name: 'X', role: 'police', password: PASSWORD });
  assert.equal(dup.status, 409);

  police = await loginAs('police1');
  court = await loginAs('court1');
  jail = await loginAs('jail1');
  const me = await police('GET', '/api/me');
  assert.equal(me.body.permissions.firs, true);
  assert.equal(me.body.permissions.court, false);
});

test('full police → court → jail workflow keeps records in sync', async () => {
  // Police: create person and FIR naming them as accused
  const p = await police('POST', '/api/persons', { full_name: 'John Doe', alias: 'JD', gender: 'Male', dob: '1990-02-01', risk_level: 'High' });
  assert.equal(p.status, 201, p.text);
  const personId = p.body.item.id;
  assert.match(p.body.item.record_no, /^CR-\d{4}-000001$/);
  assert.equal(p.body.item.status, 'Suspect');

  const fir = await police('POST', '/api/firs', { fir_no: 'FIR-1/2026', police_station: 'Central PS', offence_sections: 'IPC 379', incident_date: '2026-01-10', accused_ids: [personId] });
  assert.equal(fir.status, 201, fir.text);
  const firId = fir.body.item.id;
  assert.equal(fir.body.accused.length, 1);

  // Other agencies cannot write police records
  assert.equal((await court('POST', '/api/persons', { full_name: 'X' })).status, 403);
  assert.equal((await jail('POST', '/api/firs', { fir_no: 'Z', police_station: 'Y' })).status, 403);

  // Arrest updates the person's status
  const arrest = await police('POST', '/api/arrests', { person_id: personId, fir_id: firId, arrest_date: '2026-01-12', place: 'Market' });
  assert.equal(arrest.status, 201, arrest.text);
  assert.equal((await court('GET', `/api/persons/${personId}`)).body.item.status, 'Arrested');

  // Jail: remand as undertrial
  const remand = await jail('POST', '/api/jail', { person_id: personId, prison_name: 'District Jail', category: 'Remand', admission_date: '2026-01-13' });
  assert.equal(remand.status, 201, remand.text);
  assert.match(remand.body.item.inmate_no, /^INM-2026-\d{5}$/);
  const dupAdmit = await jail('POST', '/api/jail', { person_id: personId, prison_name: 'Other', admission_date: '2026-01-14' });
  assert.equal(dupAdmit.status, 409);

  // Court: police cannot file court cases; court files one from the FIR
  assert.equal((await police('POST', '/api/court-cases', { case_no: 'SC-1', court_name: 'X' })).status, 403);
  const cs = await court('POST', '/api/court-cases', { case_no: 'SC-1/2026', court_name: 'Sessions Court', fir_id: firId, filing_date: '2026-02-01' });
  assert.equal(cs.status, 201, cs.text);
  const caseId = cs.body.item.id;
  assert.deepEqual(cs.body.accused.map((a) => a.id), [personId], 'FIR accused copied to court case');
  assert.equal((await police('GET', `/api/firs/${firId}`)).body.item.status, 'Charge Sheeted');

  const hearing = await court('POST', `/api/court-cases/${caseId}/hearings`, { hearing_date: '2026-02-10', purpose: 'Charges', next_date: '2026-03-01' });
  assert.equal(hearing.status, 201, hearing.text);
  assert.equal(hearing.body.item.status, 'Under Trial');
  assert.equal(hearing.body.item.next_hearing, '2026-03-01');

  // Conviction requires a sentence or fine
  assert.equal((await court('PUT', `/api/court-cases/${caseId}/accused/${personId}`, { verdict: 'Convicted' })).status, 400);
  const verdict = await court('PUT', `/api/court-cases/${caseId}/accused/${personId}`, { verdict: 'Convicted', sentence_months: 24, fine_amount: 5000, verdict_date: '2026-03-01' });
  assert.equal(verdict.status, 200, verdict.text);
  assert.equal(verdict.body.item.status, 'Disposed');
  assert.equal(verdict.body.accused[0].custody_id, remand.body.item.id);

  // Jail: close the remand and admit as convict; release date comes from the sentence
  const rel = await jail('POST', `/api/jail/${remand.body.item.id}/release`, { release_date: '2026-03-01', release_reason: 'Transferred', remarks: 'Committed on conviction' });
  assert.equal(rel.status, 201, rel.text);
  assert.equal(rel.body.item.status, 'Transferred');
  const convict = await jail('POST', '/api/jail', { person_id: personId, case_id: caseId, prison_name: 'Central Prison', admission_date: '2026-03-01' });
  assert.equal(convict.status, 201, convict.text);
  assert.equal(convict.body.item.category, 'Convict');
  assert.equal(convict.body.item.expected_release, '2028-03-01');

  const dossier = await police('GET', `/api/persons/${personId}`);
  assert.equal(dossier.body.item.status, 'Imprisoned');
  assert.equal(dossier.body.firs.length, 1);
  assert.equal(dossier.body.arrests.length, 1);
  assert.equal(dossier.body.cases[0].verdict, 'Convicted');
  assert.equal(dossier.body.custody.length, 2);

  const release = await jail('POST', `/api/jail/${convict.body.item.id}/release`, { release_date: '2028-03-01', release_reason: 'Sentence Completed' });
  assert.equal(release.status, 201);
  assert.equal((await jail('POST', `/api/jail/${convict.body.item.id}/release`, { release_date: '2028-03-02', release_reason: 'Other' })).status, 409);
  assert.equal((await police('GET', `/api/persons/${personId}`)).body.item.status, 'Released');

  const search = await jail('GET', '/api/search?q=john');
  assert.equal(search.body.persons.length, 1);
  const stats = await jail('GET', '/api/stats');
  assert.equal(stats.body.counts.convictions, 1);
});

test('validation, uniqueness and content-type checks', async () => {
  assert.equal((await police('POST', '/api/persons', {})).status, 400);
  assert.equal((await police('POST', '/api/persons', { full_name: 'A', dob: '2026-02-30' })).status, 400);
  assert.equal((await police('POST', '/api/persons', { full_name: 'A', status: 'Hero' })).status, 400);
  assert.equal((await police('POST', '/api/firs', { fir_no: 'fir-1/2026', police_station: 'X' })).status, 409);
  assert.equal((await police('POST', '/api/firs', 'fir_no=1', { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await police('POST', '/api/firs', '{bad json')).status, 400);
  assert.equal((await police('GET', '/api/persons/abc')).status, 400);
  assert.equal((await police('GET', '/api/persons/999')).status, 404);
  const like = await police('GET', '/api/persons?q=%25');
  assert.equal(like.body.items.length, 0, 'LIKE wildcards are escaped');
});

test('audit trail is admin-only and records changes', async () => {
  assert.equal((await police('GET', '/api/audit')).status, 403);
  const log = await admin('GET', '/api/audit');
  const actions = new Set(log.body.items.map((e) => e.action));
  for (const a of ['LOGIN', 'CREATE', 'ARREST', 'HEARING', 'VERDICT', 'ADMIT', 'RELEASE']) assert.ok(actions.has(a), `audit has ${a}`);
});

test('disabling a user revokes their session; admin cannot lock themselves out', async () => {
  const users = (await admin('GET', '/api/users')).body.items;
  const jailUser = users.find((u) => u.username === 'jail1');
  assert.equal((await admin('PUT', `/api/users/${jailUser.id}`, { full_name: 'jail1', active: 0 })).status, 200);
  assert.equal((await jail('GET', '/api/me')).status, 401);
  const self = users.find((u) => u.username === 'admin');
  assert.equal((await admin('PUT', `/api/users/${self.id}`, { full_name: 'Admin', active: 0 })).status, 400);
});

test('logout ends the session', async () => {
  const c = await loginAs('court1');
  assert.equal((await c('POST', '/api/logout', {})).status, 200);
  assert.equal((await c('GET', '/api/me')).status, 401);
});

test('serves the SPA with security headers and blocks path traversal', async () => {
  const anon = client();
  const home = await anon('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.text, /<script src="app.js">/);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.equal((await anon('GET', '/app.js')).status, 200);
  const trav = await anon('GET', '/..%2f..%2fpackage.json');
  assert.notEqual(trav.status, 200);
});

test('login is rate limited after repeated failures', async () => {
  const c = client();
  for (let i = 0; i < 5; i++) await c('POST', '/api/login', { username: 'police1', password: 'nope' });
  assert.equal((await c('POST', '/api/login', { username: 'police1', password: PASSWORD })).status, 429);
});

test('addMonths clamps to end of month', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-03-01', 24), '2028-03-01');
});

test('demo seed loads a consistent dataset', async () => {
  const db = openDatabase(':memory:');
  assert.equal(seedDemo(db), true);
  assert.equal(seedDemo(db), false);
  const srv = http.createServer(createApp(db));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${srv.address().port}`;
    const login = await fetch(url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'court1', password: DEMO_PASSWORD }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const stats = await (await fetch(url + '/api/stats', { headers: { Cookie: cookie } })).json();
    assert.equal(stats.counts.persons, 5);
    assert.equal(stats.counts.in_custody, 2);
  } finally {
    srv.close();
  }
});
