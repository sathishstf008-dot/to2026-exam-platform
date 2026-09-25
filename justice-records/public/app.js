/* Integrated Justice Records System — single-page client (no dependencies). */
(() => {
  'use strict';

  const state = { user: null, perms: {}, meta: null };
  const appEl = document.getElementById('app');
  const modalEl = document.getElementById('modal');

  // ------------------------------------------------------------------ utils
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(d) {
    if (!d) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    if (!m) return esc(d);
    return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  }
  function fmtDateTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts.replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return esc(ts);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
  function age(dob) {
    if (!dob) return '';
    const b = new Date(dob + 'T00:00:00');
    const n = new Date();
    let a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a;
  }
  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const money = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString());
  const months = (m) => {
    if (m === null || m === undefined) return '—';
    const y = Math.floor(m / 12);
    const r = m % 12;
    return [y ? `${y} yr` : '', r ? `${r} mo` : ''].filter(Boolean).join(' ') || '0 mo';
  };

  const BADGE = {
    danger: ['Wanted', 'Absconding', 'High', 'Convicted', 'Imprisoned', 'Convict'],
    warn: ['Arrested', 'In Custody', 'Under Trial', 'Undertrial', 'Remand', 'Medium', 'Pending', 'Under Investigation',
      'Reserved for Judgment', 'On Bail', 'Bail Granted', 'Suspect', 'Transferred'],
    ok: ['Released', 'Acquitted', 'Discharged', 'Closed', 'Disposed', 'Low'],
    police: ['Registered', 'Charge Sheeted', 'police'],
    court: ['court'],
    jail: ['jail'],
    admin: ['admin'],
  };
  function badge(v) {
    if (!v) return '';
    const cls = Object.keys(BADGE).find((k) => BADGE[k].includes(v)) || '';
    return `<span class="badge ${cls}">${esc(v)}</span>`;
  }

  const riskBadge = (r) => badge(r).replace(`>${esc(r)}<`, `>${esc(r)} risk<`);

  function pct(n, total) {
    if (!total) return 'w0';
    return 'w' + Math.min(100, Math.max(n ? 5 : 0, Math.round((n / total) * 20) * 5));
  }

  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    qs('#toasts').append(el);
    setTimeout(() => el.remove(), 4000);
  }

  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  async function api(method, path, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      if (res.status === 401 && path !== '/api/login') {
        state.user = null;
        renderLogin();
      }
      throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  // ------------------------------------------------------------------ forms
  /**
   * Field: { name, label, type: text|textarea|date|number|select|multiselect, options, required, full, hint, empty }
   * options: array of strings or [value, label] pairs.
   */
  function field(f, values) {
    const v = values[f.name];
    const req = f.required ? ' required' : '';
    const id = `f_${f.name}`;
    let input;
    if (f.type === 'textarea') {
      input = `<textarea id="${id}" name="${f.name}"${req} maxlength="${f.max || 5000}">${esc(v)}</textarea>`;
    } else if (f.type === 'select' || f.type === 'multiselect') {
      const multi = f.type === 'multiselect';
      const selected = multi ? new Set((v || []).map(String)) : new Set([String(v ?? '')]);
      const opts = (f.options || []).map((o) => {
        const [val, label] = Array.isArray(o) ? o : [o, o];
        return `<option value="${esc(val)}"${selected.has(String(val)) ? ' selected' : ''}>${esc(label)}</option>`;
      }).join('');
      // Always offer an explicit blank choice so a required picker is never silently pre-filled.
      const empty = multi ? '' : `<option value="">${esc(f.empty || '— Select —')}</option>`;
      input = `<select id="${id}" name="${f.name}"${req}${multi ? ' multiple size="6"' : ''}>${empty}${opts}</select>`;
    } else {
      const type = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'password' ? 'password' : 'text';
      const extra = f.type === 'number' ? ` step="${f.step || 1}" min="${f.min ?? 0}"` : ` maxlength="${f.max || 200}"`;
      input = `<input id="${id}" type="${type}" name="${f.name}" value="${esc(v)}"${req}${extra}${f.autocomplete ? ` autocomplete="${f.autocomplete}"` : ''}>`;
    }
    return `<label class="field${f.full ? ' full' : ''}" for="${id}">
      <span>${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</span>${input}
      ${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</label>`;
  }

  function formHtml(fields, values = {}, submitLabel = 'Save', cancelHref = null) {
    return `<form class="js-form" novalidate>
      <div class="form-grid">${fields.map((f) => field(f, values)).join('')}</div>
      <p class="error-text js-error" role="alert"></p>
      <div class="form-actions">
        ${cancelHref ? `<a class="btn" href="${esc(cancelHref)}">Cancel</a>` : '<button type="button" class="btn js-cancel">Cancel</button>'}
        <button type="submit" class="btn primary">${esc(submitLabel)}</button>
      </div></form>`;
  }

  function readForm(form) {
    const out = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.multiple) out[el.name] = [...el.selectedOptions].map((o) => Number(o.value));
      else out[el.name] = el.value;
    }
    return out;
  }

  function bindForm(form, onSubmit) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = qs('.js-error', form);
      errEl.textContent = '';
      const missing = qsa('[required]', form).find((el) => !String(el.value).trim());
      if (missing) {
        errEl.textContent = `${missing.closest('label').querySelector('span').textContent.replace('*', '').trim()} is required`;
        missing.focus();
        return;
      }
      const btn = qs('button[type=submit]', form);
      btn.disabled = true;
      try {
        await onSubmit(readForm(form));
      } catch (err) {
        errEl.textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    });
  }

  function openModal(title, bodyHtml, onSubmit) {
    modalEl.innerHTML = `<div class="card-head"><h2>${esc(title)}</h2>
      <button type="button" class="icon-btn js-close" aria-label="Close">&times;</button></div>
      <div class="card-body">${bodyHtml}</div>`;
    const close = () => modalEl.close();
    qsa('.js-close, .js-cancel', modalEl).forEach((b) => b.addEventListener('click', close));
    const form = qs('form', modalEl);
    if (form && onSubmit) {
      bindForm(form, async (data) => {
        await onSubmit(data);
        close();
      });
    }
    modalEl.showModal();
    const first = qs('input, select, textarea', modalEl);
    if (first) first.focus();
  }

  // Cached look-up lists for pickers
  async function personOptions() {
    const { items } = await api('GET', '/api/persons');
    return items.map((p) => [p.id, `${p.full_name}${p.alias ? ` "${p.alias}"` : ''} — ${p.record_no}`]);
  }
  async function firOptions() {
    const { items } = await api('GET', '/api/firs');
    return items.map((f) => [f.id, `${f.fir_no} — ${f.police_station}`]);
  }
  async function caseOptions() {
    const { items } = await api('GET', '/api/court-cases');
    return items.map((c) => [c.id, `${c.case_no} — ${c.court_name}`]);
  }

  // ------------------------------------------------------------------ table helper
  function table(cols, rows, { href, empty = 'No records found' } = {}) {
    if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
    return `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c[0])}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr${href ? ` class="clickable" data-href="${esc(href(r))}"` : ''}>
        ${cols.map((c) => `<td>${c[1](r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  // ------------------------------------------------------------------ layout
  const NAV = [
    ['Overview', null, [['#/dashboard', 'Dashboard', ''], ['#/persons', 'Criminal Database', '']]],
    ['Police', 'police', [['#/firs', 'FIRs / Cases', 'police'], ['#/arrests', 'Arrests', 'police']]],
    ['Court', 'court', [['#/cases', 'Court Cases', 'court']]],
    ['Jail', 'jail', [['#/jail', 'Prison Custody', 'jail']]],
    ['Administration', 'admin', [['#/users', 'Users', 'admin'], ['#/audit', 'Audit Trail', 'admin']], true],
  ];

  function renderShell() {
    const u = state.user;
    appEl.innerHTML = `<div class="shell">
      <aside class="sidebar" id="sidebar">
        <div class="logo"><img src="favicon.svg" alt=""><div><b>Justice Records</b><small>Police · Court · Jail</small></div></div>
        ${NAV.filter((g) => !g[3] || u.role === 'admin').map(([title, , links]) => `
          <div class="nav-group">${esc(title)}</div>
          <nav class="nav">${links.map(([href, label, cls]) => `<a href="${href}"><span class="dot ${cls}"></span>${esc(label)}</a>`).join('')}</nav>`).join('')}
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="btn menu-btn js-menu" type="button" aria-label="Menu">☰</button>
          <form class="js-search" role="search"><input type="search" name="q" placeholder="Search names, record no., FIR, case, inmate no…" aria-label="Global search"></form>
          <div class="userbox">
            <div class="who"><b>${esc(u.full_name)}</b><small>${esc(u.agency || '')}</small></div>
            ${badge(u.role)}
            <a class="btn sm" href="#/account">Account</a>
            <button class="btn sm js-logout" type="button">Sign out</button>
          </div>
        </header>
        <main class="content" id="content"></main>
      </div></div>`;

    qs('.js-logout').addEventListener('click', async () => {
      try { await api('POST', '/api/logout', {}); } catch { /* ignore */ }
      state.user = null;
      location.hash = '#/login';
      renderLogin();
    });
    qs('.js-menu').addEventListener('click', () => qs('#sidebar').classList.toggle('open'));
    qs('.js-search').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = e.target.q.value.trim();
      if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
    });
    qs('#content').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-href]');
      if (tr && !e.target.closest('a, button')) location.hash = tr.dataset.href;
    });
  }

  function renderLogin() {
    appEl.innerHTML = `<div class="login-page"><div class="login-card">
      <div class="logo"><img src="favicon.svg" alt=""><div><b>Integrated Justice Records</b><small>Authorised personnel only</small></div></div>
      <form class="js-login" novalidate>
        <label class="field">Username<input name="username" autocomplete="username" required></label>
        <label class="field">Password<input name="password" type="password" autocomplete="current-password" required></label>
        <p class="error-text js-error" role="alert"></p>
        <button class="btn primary" type="submit">Sign in</button>
      </form>
      <div class="agencies">${badge('police')}${badge('court')}${badge('jail')}${badge('admin')}</div>
      <p class="muted">All access is logged in the audit trail.</p>
    </div></div>`;
    const form = qs('.js-login');
    form.username.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = qs('.js-error', form);
      err.textContent = '';
      try {
        await api('POST', '/api/login', { username: form.username.value, password: form.password.value });
        await boot();
        if (!location.hash || location.hash === '#/login') location.hash = '#/dashboard';
        else route();
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
  }

  function page(title, { crumbs = '', sub = '', actions = '' } = {}) {
    return `<div class="page-head"><div>${crumbs ? `<div class="crumbs">${crumbs}</div>` : ''}
      <h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div>
      ${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
  }

  // ------------------------------------------------------------------ views
  const views = {};

  views.dashboard = async (c) => {
    const s = await api('GET', '/api/stats');
    const k = s.counts;
    const totalPersons = s.persons_by_status.reduce((a, r) => a + r.n, 0);
    c.innerHTML = page('Dashboard', { sub: `Welcome, ${esc(state.user.full_name)}. Unified view across police, courts and prisons.` }) + `
      <div class="card flow">
        <div class="step police"><b>1 · Police</b><span>Register FIR, identify accused, record arrests, file charge sheet.</span></div>
        <div class="step court"><b>2 · Court</b><span>Case filed from FIR, hearings scheduled, verdict &amp; sentence recorded.</span></div>
        <div class="step jail"><b>3 · Jail</b><span>Remand / undertrial / convict admission, release date from sentence.</span></div>
      </div>
      <div class="grid stats">
        <div class="card stat"><a href="#/persons"><div class="label">Persons on record</div><div class="value">${k.persons}</div></a></div>
        <div class="card stat danger"><a href="#/persons?status=Wanted"><div class="label">Wanted / absconding</div><div class="value">${k.wanted}</div></a></div>
        <div class="card stat police"><a href="#/firs"><div class="label">Open FIRs</div><div class="value">${k.open_firs}</div></a></div>
        <div class="card stat police"><a href="#/arrests"><div class="label">Arrests (30 days)</div><div class="value">${k.arrests_30d}</div></a></div>
        <div class="card stat court"><a href="#/cases"><div class="label">Pending court cases</div><div class="value">${k.pending_cases}</div></a></div>
        <div class="card stat court"><div class="label">Convictions</div><div class="value">${k.convictions}</div></div>
        <div class="card stat jail"><a href="#/jail"><div class="label">In custody</div><div class="value">${k.in_custody}</div></a></div>
        <div class="card stat jail"><a href="#/jail?category=Undertrial"><div class="label">Undertrials / remand</div><div class="value">${k.undertrials}</div></a></div>
      </div>
      <div class="grid cols-3">
        <div class="card"><div class="card-head"><h2>Persons by status</h2></div><div class="card-body">
          ${totalPersons ? `<div class="bars">${s.persons_by_status.map((r) => `<div class="bar-row"><span>${esc(r.status)}</span>
            <div class="bar-track"><div class="bar-fill ${pct(r.n, totalPersons)}"></div></div><span class="n">${r.n}</span></div>`).join('')}</div>`
            : '<div class="empty">No records yet</div>'}
        </div></div>
        <div class="card"><div class="card-head"><h2>Hearings in next 7 days</h2></div>
          ${table([['Date', (r) => `<span class="nowrap">${fmtDate(r.next_hearing)}</span>`], ['Case', (r) => `<a href="#/cases/${r.id}">${esc(r.case_no)}</a><div class="muted">${esc(r.court_name)}</div>`]],
            s.upcoming_hearings, { empty: 'No hearings scheduled' })}</div>
        <div class="card"><div class="card-head"><h2>Releases in next 30 days</h2></div>
          ${table([['Date', (r) => `<span class="nowrap">${fmtDate(r.expected_release)}</span>`], ['Inmate', (r) => `<a href="#/jail/${r.id}">${esc(r.full_name)}</a><div class="muted">${esc(r.inmate_no)} · ${esc(r.prison_name)}</div>`]],
            s.upcoming_releases, { empty: 'No releases due' })}</div>
      </div>
      <div class="card"><div class="card-head"><h2>Recent activity</h2></div>
        ${table([['When', (r) => `<span class="nowrap">${fmtDateTime(r.at)}</span>`], ['User', (r) => esc(r.username)], ['Action', (r) => `<span class="mono">${esc(r.action)}</span>`],
          ['Record', (r) => `${esc(r.entity)}${r.entity_id ? ` #${r.entity_id}` : ''}`], ['Details', (r) => esc(r.details)]], s.recent_activity)}
      </div>`;
  };

  // ---------------- Persons
  views.persons = async (c, params) => {
    const m = state.meta;
    const q = new URLSearchParams();
    ['q', 'status', 'risk'].forEach((k) => params[k] && q.set(k, params[k]));
    const { items } = await api('GET', `/api/persons?${q}`);
    c.innerHTML = page('Criminal Database', {
      sub: 'Central record of every suspect, accused and offender shared by all agencies.',
      actions: state.perms.persons ? '<a class="btn primary" href="#/persons/new">+ New person record</a>' : '',
    }) + `<div class="card">
      <form class="filters js-filters">
        <input type="search" name="q" placeholder="Name, alias, national ID, record no." value="${esc(params.q)}">
        <select name="status"><option value="">All statuses</option>${m.person_statuses.map((s) => `<option${params.status === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <select name="risk"><option value="">Any risk</option>${m.risk_levels.map((s) => `<option${params.risk === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <button class="btn" type="submit">Filter</button>
      </form>
      ${table([
        ['Record no.', (r) => `<span class="mono">${esc(r.record_no)}</span>`],
        ['Name', (r) => `<b>${esc(r.full_name)}</b>${r.alias ? `<div class="muted">alias “${esc(r.alias)}”</div>` : ''}`],
        ['Gender / Age', (r) => `${esc(r.gender || '—')}${r.dob ? ` · ${age(r.dob)}` : ''}`],
        ['National ID', (r) => esc(r.national_id || '—')],
        ['Status', (r) => badge(r.status)],
        ['Risk', (r) => badge(r.risk_level)],
        ['FIRs', (r) => r.fir_count],
        ['Convictions', (r) => r.conviction_count],
      ], items, { href: (r) => `#/persons/${r.id}` })}</div>`;
    bindFilters(c, 'persons');
  };

  function bindFilters(c, base) {
    const f = qs('.js-filters', c);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const p = new URLSearchParams();
      for (const el of f.elements) if (el.name && el.value) p.set(el.name, el.value);
      location.hash = `#/${base}${p.toString() ? '?' + p : ''}`;
    });
    qsa('select', f).forEach((s) => s.addEventListener('change', () => f.requestSubmit()));
  }

  function personFields() {
    const m = state.meta;
    return [
      { name: 'full_name', label: 'Full name', required: true },
      { name: 'alias', label: 'Alias / nickname' },
      { name: 'gender', label: 'Gender', type: 'select', options: m.genders },
      { name: 'dob', label: 'Date of birth', type: 'date' },
      { name: 'national_id', label: 'National ID / Aadhaar / Passport', max: 50 },
      { name: 'parent_name', label: "Father's / mother's name" },
      { name: 'height_cm', label: 'Height (cm)', type: 'number', min: 30 },
      { name: 'status', label: 'Status', type: 'select', options: m.person_statuses, required: true },
      { name: 'risk_level', label: 'Risk level', type: 'select', options: m.risk_levels, required: true },
      { name: 'address', label: 'Address', type: 'textarea', full: true, max: 500 },
      { name: 'identifying_marks', label: 'Identifying marks', type: 'textarea', full: true, max: 500 },
      { name: 'notes', label: 'Notes / modus operandi', type: 'textarea', full: true },
    ];
  }

  views.personNew = async (c) => {
    c.innerHTML = page('New person record', { crumbs: '<a href="#/persons">Criminal Database</a>' }) +
      `<div class="card"><div class="card-body">${formHtml(personFields(), { status: 'Suspect', risk_level: 'Low' }, 'Create record', '#/persons')}</div></div>`;
    bindForm(qs('.js-form', c), async (data) => {
      const { item } = await api('POST', '/api/persons', data);
      toast(`Record ${item.record_no} created`);
      location.hash = `#/persons/${item.id}`;
    });
  };

  views.personEdit = async (c, params, id) => {
    const { item } = await api('GET', `/api/persons/${id}`);
    c.innerHTML = page(`Edit ${item.full_name}`, { crumbs: `<a href="#/persons">Criminal Database</a> / <a href="#/persons/${id}">${esc(item.record_no)}</a>` }) +
      `<div class="card"><div class="card-body">${formHtml(personFields(), item, 'Save changes', `#/persons/${id}`)}</div></div>`;
    bindForm(qs('.js-form', c), async (data) => {
      await api('PUT', `/api/persons/${id}`, data);
      toast('Record updated');
      location.hash = `#/persons/${id}`;
    });
  };

  views.person = async (c, params, id) => {
    const d = await api('GET', `/api/persons/${id}`);
    const p = d.item;
    const events = [
      ...d.firs.map((f) => ({ date: f.incident_date, cls: 'police', html: `Named in <a href="#/firs/${f.id}">${esc(f.fir_no)}</a> — ${esc(f.offence_sections)} ${badge(f.status)}` })),
      ...d.arrests.map((a) => ({ date: a.arrest_date, cls: 'police', html: `Arrested at ${esc(a.place || '—')} by ${esc(a.arresting_officer || '—')}${a.fir_no ? ` (${esc(a.fir_no)})` : ''}` })),
      ...d.cases.map((k) => ({ date: k.verdict_date, cls: 'court', html: `<a href="#/cases/${k.id}">${esc(k.case_no)}</a> at ${esc(k.court_name)} — ${badge(k.verdict)}${k.sentence_months ? ` ${months(k.sentence_months)}` : ''}` })),
      ...d.custody.map((j) => ({ date: j.admission_date, cls: 'jail', html: `Admitted to ${esc(j.prison_name)} as ${esc(j.category)} (<a href="#/jail/${j.id}">${esc(j.inmate_no)}</a>)` })),
      ...d.custody.filter((j) => j.release_date).map((j) => ({ date: j.release_date, cls: 'jail', html: `Released from ${esc(j.prison_name)} — ${esc(j.release_reason)}` })),
    ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    const inCustody = d.custody.find((j) => j.status === 'In Custody');
    c.innerHTML = page(p.full_name, {
      crumbs: '<a href="#/persons">Criminal Database</a>',
      actions: [
        state.perms.persons ? `<a class="btn" href="#/persons/${id}/edit">Edit</a>` : '',
        state.perms.arrests ? '<button class="btn police js-arrest" type="button">Record arrest</button>' : '',
        state.perms.jail && !inCustody ? `<a class="btn jail" href="#/jail/new?person=${id}">Admit to jail</a>` : '',
        '<button class="btn js-print" type="button">Print dossier</button>',
      ].join(''),
    }) + `
      <div class="card"><div class="card-body profile-head">
        <div class="avatar">${esc(initials(p.full_name))}</div>
        <div><h2>${esc(p.full_name)}${p.alias ? ` <span class="muted">“${esc(p.alias)}”</span>` : ''}</h2>
          <div class="mono muted">${esc(p.record_no)}</div>
          <div class="actions">${badge(p.status)} ${riskBadge(p.risk_level)}
            ${inCustody ? `<span class="badge jail">In ${esc(inCustody.prison_name)} · ${esc(inCustody.inmate_no)}</span>` : ''}</div></div>
      </div></div>
      <div class="grid cols-2">
        <div class="card"><div class="card-head"><h2>Personal particulars</h2></div><div class="card-body"><dl class="details">
          <dt>Gender</dt><dd>${esc(p.gender || '—')}</dd>
          <dt>Date of birth</dt><dd>${fmtDate(p.dob)}${p.dob ? ` (age ${age(p.dob)})` : ''}</dd>
          <dt>National ID</dt><dd>${esc(p.national_id || '—')}</dd>
          <dt>Parent's name</dt><dd>${esc(p.parent_name || '—')}</dd>
          <dt>Height</dt><dd>${p.height_cm ? `${p.height_cm} cm` : '—'}</dd>
          <dt>Address</dt><dd>${esc(p.address || '—')}</dd>
          <dt>Identifying marks</dt><dd>${esc(p.identifying_marks || '—')}</dd>
          <dt>Notes</dt><dd>${esc(p.notes || '—')}</dd>
          <dt>Last updated</dt><dd>${fmtDateTime(p.updated_at)}</dd>
        </dl></div></div>
        <div class="card"><div class="card-head"><h2>Integrated history</h2><span class="muted">${events.length} events</span></div><div class="card-body">
          ${events.length ? `<ul class="timeline">${events.map((e) => `<li class="${e.cls}"><div class="when">${fmtDate(e.date)} · ${e.cls}</div>${e.html}</li>`).join('')}</ul>` : '<div class="empty">No police, court or jail history</div>'}
        </div></div>
      </div>
      <div class="card"><div class="card-head"><h2>FIRs</h2>${badge('police')}</div>
        ${table([['FIR no.', (r) => `<a href="#/firs/${r.id}">${esc(r.fir_no)}</a>`], ['Station', (r) => esc(r.police_station)], ['Sections', (r) => esc(r.offence_sections)],
          ['Incident', (r) => fmtDate(r.incident_date)], ['Status', (r) => badge(r.status)]], d.firs, { empty: 'Not named in any FIR' })}</div>
      <div class="card"><div class="card-head"><h2>Arrests</h2>${badge('police')}</div>
        ${table([['Date', (r) => fmtDate(r.arrest_date)], ['Place', (r) => esc(r.place)], ['Officer', (r) => esc(r.arresting_officer)], ['FIR', (r) => esc(r.fir_no || '—')], ['Notes', (r) => esc(r.notes)]], d.arrests, { empty: 'No arrests recorded' })}</div>
      <div class="card"><div class="card-head"><h2>Court cases</h2>${badge('court')}</div>
        ${table([['Case no.', (r) => `<a href="#/cases/${r.id}">${esc(r.case_no)}</a>`], ['Court', (r) => esc(r.court_name)], ['Case status', (r) => badge(r.status)],
          ['Verdict', (r) => badge(r.verdict)], ['Sentence', (r) => months(r.sentence_months)], ['Fine', (r) => money(r.fine_amount)], ['Next hearing', (r) => fmtDate(r.next_hearing)]], d.cases, { empty: 'No court cases' })}</div>
      <div class="card"><div class="card-head"><h2>Custody history</h2>${badge('jail')}</div>
        ${table([['Inmate no.', (r) => `<a href="#/jail/${r.id}">${esc(r.inmate_no)}</a>`], ['Prison', (r) => esc(r.prison_name)], ['Category', (r) => badge(r.category)],
          ['Admitted', (r) => fmtDate(r.admission_date)], ['Released', (r) => fmtDate(r.release_date)], ['Status', (r) => badge(r.status)]], d.custody, { empty: 'Never in custody' })}</div>`;

    qs('.js-print', c).addEventListener('click', () => window.print());
    const arrestBtn = qs('.js-arrest', c);
    if (arrestBtn) arrestBtn.addEventListener('click', () => arrestModal({ person_id: id, firs: d.firs.map((f) => [f.id, f.fir_no]) }));
  };

  async function arrestModal({ person_id, fir_id, firs, persons }) {
    const fields = [];
    if (!person_id) fields.push({ name: 'person_id', label: 'Person', type: 'select', options: persons || await personOptions(), required: true, full: true });
    if (!fir_id) fields.push({ name: 'fir_id', label: 'FIR', type: 'select', options: firs || await firOptions(), empty: '— Not linked —', full: true });
    fields.push(
      { name: 'arrest_date', label: 'Arrest date', type: 'date', required: true },
      { name: 'place', label: 'Place of arrest' },
      { name: 'arresting_officer', label: 'Arresting officer' },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    );
    openModal('Record arrest', formHtml(fields, { arrest_date: new Date().toISOString().slice(0, 10), arresting_officer: state.user.full_name }, 'Record arrest'), async (data) => {
      await api('POST', '/api/arrests', { ...data, person_id: person_id || data.person_id, fir_id: fir_id || data.fir_id });
      toast('Arrest recorded; person status set to Arrested');
      route();
    });
  }

  // ---------------- FIRs
  views.firs = async (c, params) => {
    const q = new URLSearchParams();
    ['q', 'status'].forEach((k) => params[k] && q.set(k, params[k]));
    const { items } = await api('GET', `/api/firs?${q}`);
    c.innerHTML = page('FIRs / Police Cases', {
      sub: 'First Information Reports registered by police stations.',
      actions: state.perms.firs ? '<a class="btn police" href="#/firs/new">+ Register FIR</a>' : '',
    }) + `<div class="card">
      <form class="filters js-filters">
        <input type="search" name="q" placeholder="FIR no., station, sections, complainant" value="${esc(params.q)}">
        <select name="status"><option value="">All statuses</option>${state.meta.fir_statuses.map((s) => `<option${params.status === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <button class="btn" type="submit">Filter</button>
      </form>
      ${table([
        ['FIR no.', (r) => `<b class="mono">${esc(r.fir_no)}</b>`],
        ['Police station', (r) => `${esc(r.police_station)}<div class="muted">${esc(r.district)}</div>`],
        ['Incident', (r) => `${fmtDate(r.incident_date)}<div class="muted">${esc(r.incident_place)}</div>`],
        ['Sections', (r) => esc(r.offence_sections)],
        ['IO', (r) => esc(r.io_name)],
        ['Accused', (r) => r.accused_count],
        ['Status', (r) => badge(r.status)],
      ], items, { href: (r) => `#/firs/${r.id}` })}</div>`;
    bindFilters(c, 'firs');
  };

  const firFields = () => [
    { name: 'fir_no', label: 'FIR number', required: true, max: 50 },
    { name: 'police_station', label: 'Police station', required: true },
    { name: 'district', label: 'District' },
    { name: 'status', label: 'Status', type: 'select', options: state.meta.fir_statuses, required: true },
    { name: 'incident_date', label: 'Date of incident', type: 'date' },
    { name: 'incident_place', label: 'Place of occurrence' },
    { name: 'offence_sections', label: 'Offence sections (Acts / sections)', max: 300 },
    { name: 'complainant', label: 'Complainant' },
    { name: 'io_name', label: 'Investigating officer' },
    { name: 'description', label: 'Brief facts', type: 'textarea', full: true },
  ];

  views.firNew = async (c) => {
    const persons = await personOptions();
    const fields = [...firFields(), { name: 'accused_ids', label: 'Accused persons', type: 'multiselect', options: persons, full: true,
      hint: 'Ctrl/Cmd-click to select several. New persons can be added from the Criminal Database.' }];
    c.innerHTML = page('Register FIR', { crumbs: '<a href="#/firs">FIRs</a>' }) +
      `<div class="card"><div class="card-body">${formHtml(fields, { status: 'Registered', io_name: state.user.full_name, police_station: state.user.agency }, 'Register FIR', '#/firs')}</div></div>`;
    bindForm(qs('.js-form', c), async (data) => {
      const { item } = await api('POST', '/api/firs', data);
      toast(`FIR ${item.fir_no} registered`);
      location.hash = `#/firs/${item.id}`;
    });
  };

  views.firEdit = async (c, params, id) => {
    const { item } = await api('GET', `/api/firs/${id}`);
    c.innerHTML = page(`Edit ${item.fir_no}`, { crumbs: `<a href="#/firs">FIRs</a> / <a href="#/firs/${id}">${esc(item.fir_no)}</a>` }) +
      `<div class="card"><div class="card-body">${formHtml(firFields(), item, 'Save changes', `#/firs/${id}`)}</div></div>`;
    bindForm(qs('.js-form', c), async (data) => {
      await api('PUT', `/api/firs/${id}`, data);
      toast('FIR updated');
      location.hash = `#/firs/${id}`;
    });
  };

  views.fir = async (c, params, id) => {
    const d = await api('GET', `/api/firs/${id}`);
    const f = d.item;
    const canEdit = state.perms.firs;
    c.innerHTML = page(f.fir_no, {
      crumbs: '<a href="#/firs">FIRs</a>',
      sub: `${esc(f.police_station)} · ${badge(f.status)}`,
      actions: [
        canEdit ? `<a class="btn" href="#/firs/${id}/edit">Edit</a>` : '',
        canEdit ? '<button class="btn js-add-accused" type="button">+ Accused</button>' : '',
        state.perms.arrests && d.accused.length ? '<button class="btn police js-arrest" type="button">Record arrest</button>' : '',
        state.perms.court ? `<a class="btn court" href="#/cases/new?fir=${id}">File court case</a>` : '',
        '<button class="btn js-print" type="button">Print</button>',
      ].join(''),
    }) + `
      <div class="card"><div class="card-head"><h2>FIR details</h2></div><div class="card-body"><dl class="details">
        <dt>District</dt><dd>${esc(f.district || '—')}</dd>
        <dt>Date of incident</dt><dd>${fmtDate(f.incident_date)}</dd>
        <dt>Place of occurrence</dt><dd>${esc(f.incident_place || '—')}</dd>
        <dt>Offence sections</dt><dd>${esc(f.offence_sections || '—')}</dd>
        <dt>Complainant</dt><dd>${esc(f.complainant || '—')}</dd>
        <dt>Investigating officer</dt><dd>${esc(f.io_name || '—')}</dd>
        <dt>Brief facts</dt><dd>${esc(f.description || '—')}</dd>
        <dt>Registered</dt><dd>${fmtDateTime(f.created_at)}</dd>
      </dl></div></div>
      <div class="card"><div class="card-head"><h2>Accused</h2></div>
        ${table([['Record no.', (r) => `<span class="mono">${esc(r.record_no)}</span>`], ['Name', (r) => `<a href="#/persons/${r.id}">${esc(r.full_name)}</a>${r.alias ? ` <span class="muted">“${esc(r.alias)}”</span>` : ''}`],
          ['Status', (r) => badge(r.status)], ...(canEdit ? [['', (r) => `<button class="btn sm danger js-remove" type="button" data-pid="${r.id}">Remove</button>`]] : [])], d.accused, { empty: 'No accused named yet' })}</div>
      <div class="grid cols-2">
        <div class="card"><div class="card-head"><h2>Arrests</h2></div>
          ${table([['Date', (r) => fmtDate(r.arrest_date)], ['Person', (r) => `<a href="#/persons/${r.person_id}">${esc(r.full_name)}</a>`], ['Officer', (r) => esc(r.arresting_officer)]], d.arrests, { empty: 'No arrests yet' })}</div>
        <div class="card"><div class="card-head"><h2>Court cases</h2></div>
          ${table([['Case no.', (r) => `<a href="#/cases/${r.id}">${esc(r.case_no)}</a>`], ['Court', (r) => esc(r.court_name)], ['Status', (r) => badge(r.status)]], d.cases, { empty: 'Not yet filed in court' })}</div>
      </div>`;

    qs('.js-print', c).addEventListener('click', () => window.print());
    qsa('.js-remove', c).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove this person from the FIR?')) return;
      try { await api('DELETE', `/api/firs/${id}/accused/${b.dataset.pid}`); toast('Removed'); route(); } catch (e) { toast(e.message, 'error'); }
    }));
    const addBtn = qs('.js-add-accused', c);
    if (addBtn) addBtn.addEventListener('click', async () => {
      const options = (await personOptions()).filter(([pid]) => !d.accused.some((a) => a.id === pid));
      openModal('Add accused to FIR', formHtml([{ name: 'person_id', label: 'Person', type: 'select', options, required: true, full: true,
        hint: 'Not listed? Create the person in the Criminal Database first.' }], {}, 'Add'), async (data) => {
        await api('POST', `/api/firs/${id}/accused`, data);
        toast('Accused added');
        route();
      });
    });
    const arrestBtn = qs('.js-arrest', c);
    if (arrestBtn) arrestBtn.addEventListener('click', () => arrestModal({ fir_id: id, persons: d.accused.map((a) => [a.id, `${a.full_name} — ${a.record_no}`]) }));
  };

  views.arrests = async (c) => {
    const { items } = await api('GET', '/api/arrests');
    c.innerHTML = page('Arrests', {
      sub: 'Arrest register across all police stations.',
      actions: state.perms.arrests ? '<button class="btn police js-arrest" type="button">+ Record arrest</button>' : '',
    }) + `<div class="card">${table([
      ['Date', (r) => `<span class="nowrap">${fmtDate(r.arrest_date)}</span>`],
      ['Person', (r) => `<a href="#/persons/${r.person_id}">${esc(r.full_name)}</a><div class="muted mono">${esc(r.record_no)}</div>`],
      ['FIR', (r) => (r.fir_id ? `<a href="#/firs/${r.fir_id}">${esc(r.fir_no)}</a>` : '—')],
      ['Place', (r) => esc(r.place)],
      ['Arresting officer', (r) => esc(r.arresting_officer)],
      ['Notes', (r) => esc(r.notes)],
    ], items)}</div>`;
    const b = qs('.js-arrest', c);
    if (b) b.addEventListener('click', () => arrestModal({}));
  };

  // ---------------- Court
  views.cases = async (c, params) => {
    const q = new URLSearchParams();
    ['q', 'status'].forEach((k) => params[k] && q.set(k, params[k]));
    const { items } = await api('GET', `/api/court-cases?${q}`);
    c.innerHTML = page('Court Cases', {
      sub: 'Criminal trials, bail and remand proceedings.',
      actions: state.perms.court ? '<a class="btn court" href="#/cases/new">+ File case</a>' : '',
    }) + `<div class="card">
      <form class="filters js-filters">
        <input type="search" name="q" placeholder="Case no., court, judge, FIR no." value="${esc(params.q)}">
        <select name="status"><option value="">All statuses</option>${state.meta.case_statuses.map((s) => `<option${params.status === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <button class="btn" type="submit">Filter</button>
      </form>
      ${table([
        ['Case no.', (r) => `<b class="mono">${esc(r.case_no)}</b><div class="muted">${esc(r.case_type)}</div>`],
        ['Court', (r) => `${esc(r.court_name)}<div class="muted">${esc(r.judge)}</div>`],
        ['FIR', (r) => (r.fir_id ? `<a href="#/firs/${r.fir_id}">${esc(r.fir_no)}</a>` : '—')],
        ['Filed', (r) => fmtDate(r.filing_date)],
        ['Accused', (r) => r.accused_count],
        ['Next hearing', (r) => `<span class="nowrap">${fmtDate(r.next_hearing)}</span>`],
        ['Status', (r) => badge(r.status)],
      ], items, { href: (r) => `#/cases/${r.id}` })}</div>`;
    bindFilters(c, 'cases');
  };

  const caseFields = (firs) => [
    { name: 'case_no', label: 'Case number', required: true, max: 50 },
    { name: 'court_name', label: 'Court', required: true },
    { name: 'judge', label: 'Presiding judge' },
    { name: 'case_type', label: 'Case type', type: 'select', options: state.meta.case_types, required: true },
    { name: 'filing_date', label: 'Filing date', type: 'date' },
    { name: 'status', label: 'Status', type: 'select', options: state.meta.case_statuses, required: true },
    { name: 'next_hearing', label: 'Next hearing', type: 'date' },
    { name: 'fir_id', label: 'Linked FIR', type: 'select', options: firs, empty: '— None (private complaint) —', hint: 'Accused in the FIR are added to the case automatically.' },
  ];

  views.caseNew = async (c, params) => {
    const [firs, persons] = await Promise.all([firOptions(), personOptions()]);
    const fields = [...caseFields(firs), { name: 'accused_ids', label: 'Additional accused', type: 'multiselect', options: persons, full: true, hint: 'Optional — anyone not named in the FIR.' }];
    c.innerHTML = page('File court case', { crumbs: '<a href="#/cases">Court Cases</a>' }) +
      `<div class="card"><div class="card-body">${formHtml(fields, {
        fir_id: params.fir || '', case_type: 'Criminal Trial', status: 'Pending',
        filing_date: new Date().toISOString().slice(0, 10), court_name: state.user.role === 'court' ? state.user.agency : '',
      }, 'File case', '#/cases')}</div></div>`;
    bindForm(qs('.js-form', c), async (data) => {
      const { item } = await api('POST', '/api/court-cases', data);
      toast(`Case ${item.case_no} filed`);
      location.hash = `#/cases/${item.id}`;
    });
  };

  views.caseEdit = async (c, params, id) => {
    const [{ item }, firs] = await Promise.all([api('GET', `/api/court-cases/${id}`), firOptions()]);
    c.innerHTML = page(`Edit ${item.case_no}`, { crumbs: `<a href="#/cases">Court Cases</a> / <a href="#/cases/${id}">${esc(item.case_no)}</a>` }) +
      `<div class="card"><div class="card-body">${formHtml(caseFields(firs), item, 'Save changes', `#/cases/${id}`)}</div></div>`;
    bindForm(qs('.js-form', c), async (data) => {
      await api('PUT', `/api/court-cases/${id}`, data);
      toast('Case updated');
      location.hash = `#/cases/${id}`;
    });
  };

  views.case = async (c, params, id) => {
    const d = await api('GET', `/api/court-cases/${id}`);
    const k = d.item;
    const canEdit = state.perms.court;
    c.innerHTML = page(k.case_no, {
      crumbs: '<a href="#/cases">Court Cases</a>',
      sub: `${esc(k.court_name)} · ${badge(k.status)}`,
      actions: [
        canEdit ? `<a class="btn" href="#/cases/${id}/edit">Edit</a>` : '',
        canEdit ? '<button class="btn js-add-accused" type="button">+ Accused</button>' : '',
        canEdit && k.status !== 'Disposed' ? '<button class="btn court js-hearing" type="button">Record hearing</button>' : '',
        '<button class="btn js-print" type="button">Print</button>',
      ].join(''),
    }) + `
      <div class="grid cols-2">
        <div class="card"><div class="card-head"><h2>Case details</h2></div><div class="card-body"><dl class="details">
          <dt>Case type</dt><dd>${esc(k.case_type)}</dd>
          <dt>Presiding judge</dt><dd>${esc(k.judge || '—')}</dd>
          <dt>Filed on</dt><dd>${fmtDate(k.filing_date)}</dd>
          <dt>Police FIR</dt><dd>${k.fir_id ? `<a href="#/firs/${k.fir_id}">${esc(k.fir_no)}</a>` : '—'}</dd>
          <dt>Next hearing</dt><dd>${fmtDate(k.next_hearing)}</dd>
        </dl></div></div>
        <div class="card"><div class="card-head"><h2>Hearings</h2><span class="muted">${d.hearings.length}</span></div><div class="card-body">
          ${d.hearings.length ? `<ul class="timeline">${d.hearings.map((h) => `<li class="court"><div class="when">${fmtDate(h.hearing_date)}${h.purpose ? ` · ${esc(h.purpose)}` : ''}</div>
            ${esc(h.outcome || '—')}${h.next_date ? `<div class="muted">Adjourned to ${fmtDate(h.next_date)}</div>` : ''}</li>`).join('')}</ul>` : '<div class="empty">No hearings recorded</div>'}
        </div></div>
      </div>
      <div class="card"><div class="card-head"><h2>Accused &amp; verdicts</h2></div>
        ${table([
          ['Accused', (r) => `<a href="#/persons/${r.id}">${esc(r.full_name)}</a><div class="muted mono">${esc(r.record_no)}</div>`],
          ['Verdict', (r) => badge(r.verdict)],
          ['Sentence', (r) => months(r.sentence_months)],
          ['Fine', (r) => money(r.fine_amount)],
          ['Verdict date', (r) => fmtDate(r.verdict_date)],
          ['Custody', (r) => (r.custody_id ? `<a href="#/jail/${r.custody_id}">In custody</a>` : '<span class="muted">Not in custody</span>')],
          ['', (r) => [
            canEdit ? `<button class="btn sm court js-verdict" type="button" data-pid="${r.id}">Verdict / order</button>` : '',
            state.perms.jail && !r.custody_id && ['Pending', 'Convicted'].includes(r.verdict) ? ` <a class="btn sm jail" href="#/jail/new?person=${r.id}&case=${id}">${r.verdict === 'Convicted' ? 'Commit to prison' : 'Remand'}</a>` : '',
          ].join('')],
        ], d.accused, { empty: 'No accused on this case' })}</div>`;

    qs('.js-print', c).addEventListener('click', () => window.print());
    const hb = qs('.js-hearing', c);
    if (hb) hb.addEventListener('click', () => openModal('Record hearing', formHtml([
      { name: 'hearing_date', label: 'Hearing date', type: 'date', required: true },
      { name: 'next_date', label: 'Adjourned to (next date)', type: 'date' },
      { name: 'purpose', label: 'Purpose / stage', full: true },
      { name: 'outcome', label: 'Proceedings / order', type: 'textarea', full: true, max: 2000 },
    ], { hearing_date: new Date().toISOString().slice(0, 10) }, 'Save hearing'), async (data) => {
      await api('POST', `/api/court-cases/${id}/hearings`, data);
      toast('Hearing recorded');
      route();
    }));
    const ab = qs('.js-add-accused', c);
    if (ab) ab.addEventListener('click', async () => {
      const options = (await personOptions()).filter(([pid]) => !d.accused.some((a) => a.id === pid));
      openModal('Add accused to case', formHtml([{ name: 'person_id', label: 'Person', type: 'select', options, required: true, full: true }], {}, 'Add'), async (data) => {
        await api('POST', `/api/court-cases/${id}/accused`, data);
        toast('Accused added');
        route();
      });
    });
    qsa('.js-verdict', c).forEach((b) => b.addEventListener('click', () => {
      const r = d.accused.find((a) => String(a.id) === b.dataset.pid);
      openModal(`Verdict — ${r.full_name}`, formHtml([
        { name: 'verdict', label: 'Verdict / order', type: 'select', options: state.meta.verdicts, required: true },
        { name: 'verdict_date', label: 'Date', type: 'date' },
        { name: 'sentence_months', label: 'Sentence (months)', type: 'number', hint: 'Required for conviction unless fine only' },
        { name: 'fine_amount', label: 'Fine amount', type: 'number', step: '0.01' },
        { name: 'remarks', label: 'Remarks', type: 'textarea', full: true, max: 2000 },
      ], { ...r, verdict_date: r.verdict_date || new Date().toISOString().slice(0, 10) }, 'Save verdict'), async (data) => {
        await api('PUT', `/api/court-cases/${id}/accused/${r.id}`, data);
        toast('Verdict recorded; person status updated');
        route();
      });
    }));
  };

  // ---------------- Jail
  views.jail = async (c, params) => {
    const q = new URLSearchParams();
    ['q', 'status', 'category'].forEach((k) => params[k] && q.set(k, params[k]));
    const { items } = await api('GET', `/api/jail?${q}`);
    c.innerHTML = page('Prison Custody', {
      sub: 'Admissions, undertrial and convict population, releases and transfers.',
      actions: state.perms.jail ? '<a class="btn jail" href="#/jail/new">+ Admit inmate</a>' : '',
    }) + `<div class="card">
      <form class="filters js-filters">
        <input type="search" name="q" placeholder="Inmate no., name, prison" value="${esc(params.q)}">
        <select name="status"><option value="">All statuses</option>${['In Custody', 'Released', 'Transferred'].map((s) => `<option${params.status === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <select name="category"><option value="">All categories</option>${state.meta.jail_categories.map((s) => `<option${params.category === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <button class="btn" type="submit">Filter</button>
      </form>
      ${table([
        ['Inmate no.', (r) => `<b class="mono">${esc(r.inmate_no)}</b>`],
        ['Name', (r) => `${esc(r.full_name)}<div class="muted mono">${esc(r.record_no)}</div>`],
        ['Prison / cell', (r) => `${esc(r.prison_name)}<div class="muted">${esc(r.cell_block)}</div>`],
        ['Category', (r) => badge(r.category)],
        ['Case', (r) => esc(r.case_no || '—')],
        ['Admitted', (r) => `<span class="nowrap">${fmtDate(r.admission_date)}</span>`],
        ['Release', (r) => `<span class="nowrap">${fmtDate(r.release_date || r.expected_release)}</span>${!r.release_date && r.expected_release ? '<div class="muted">expected</div>' : ''}`],
        ['Status', (r) => badge(r.status)],
      ], items, { href: (r) => `#/jail/${r.id}` })}</div>`;
    bindFilters(c, 'jail');
  };

  views.jailNew = async (c, params) => {
    const [persons, cases] = await Promise.all([personOptions(), caseOptions()]);
    const fields = [
      { name: 'person_id', label: 'Person', type: 'select', options: persons, required: true, full: true },
      { name: 'case_id', label: 'Court case / warrant', type: 'select', options: cases, empty: '— None —', full: true,
        hint: 'If the person is convicted in this case, category and expected release are filled from the sentence.' },
      { name: 'inmate_no', label: 'Inmate number', hint: 'Leave blank to auto-generate', max: 50 },
      { name: 'prison_name', label: 'Prison', required: true },
      { name: 'category', label: 'Category', type: 'select', options: state.meta.jail_categories, required: true },
      { name: 'cell_block', label: 'Block / cell', max: 50 },
      { name: 'admission_date', label: 'Admission date', type: 'date', required: true },
      { name: 'expected_release', label: 'Expected release', type: 'date' },
      { name: 'remarks', label: 'Remarks', type: 'textarea', full: true },
    ];
    c.innerHTML = page('Admit inmate', { crumbs: '<a href="#/jail">Prison Custody</a>' }) +
      `<div class="card"><div class="card-body">${formHtml(fields, {
        person_id: params.person || '', case_id: params.case || '', category: 'Undertrial',
        admission_date: new Date().toISOString().slice(0, 10), prison_name: state.user.role === 'jail' ? state.user.agency : '',
      }, 'Admit', '#/jail')}</div></div>`;
    bindForm(qs('.js-form', c), async (data) => {
      const { item } = await api('POST', '/api/jail', data);
      toast(`Admitted as ${item.inmate_no}`);
      location.hash = `#/jail/${item.id}`;
    });
  };

  views.jailRecord = async (c, params, id) => {
    const { item: j } = await api('GET', `/api/jail/${id}`);
    const active = j.status === 'In Custody';
    const canEdit = state.perms.jail && active;
    c.innerHTML = page(j.inmate_no, {
      crumbs: '<a href="#/jail">Prison Custody</a>',
      sub: `<a href="#/persons/${j.person_id}">${esc(j.full_name)}</a> · ${badge(j.status)} ${badge(j.category)}`,
      actions: [
        canEdit ? '<button class="btn js-update" type="button">Update / transfer</button>' : '',
        canEdit ? '<button class="btn jail js-release" type="button">Release</button>' : '',
        '<button class="btn js-print" type="button">Print</button>',
      ].join(''),
    }) + `<div class="card"><div class="card-head"><h2>Custody record</h2></div><div class="card-body"><dl class="details">
        <dt>Inmate</dt><dd><a href="#/persons/${j.person_id}">${esc(j.full_name)}</a> (${esc(j.record_no)})</dd>
        <dt>Prison</dt><dd>${esc(j.prison_name)}</dd>
        <dt>Block / cell</dt><dd>${esc(j.cell_block || '—')}</dd>
        <dt>Category</dt><dd>${esc(j.category)}</dd>
        <dt>Court case</dt><dd>${j.case_id ? `<a href="#/cases/${j.case_id}">${esc(j.case_no)}</a>` : '—'}</dd>
        <dt>Admission date</dt><dd>${fmtDate(j.admission_date)}</dd>
        <dt>Expected release</dt><dd>${fmtDate(j.expected_release)}</dd>
        <dt>Release date</dt><dd>${fmtDate(j.release_date)}</dd>
        <dt>Release reason</dt><dd>${esc(j.release_reason || '—')}</dd>
        <dt>Remarks</dt><dd>${esc(j.remarks || '—')}</dd>
      </dl></div></div>`;
    qs('.js-print', c).addEventListener('click', () => window.print());
    const ub = qs('.js-update', c);
    if (ub) ub.addEventListener('click', () => openModal('Update custody / transfer', formHtml([
      { name: 'prison_name', label: 'Prison', required: true },
      { name: 'cell_block', label: 'Block / cell', max: 50 },
      { name: 'category', label: 'Category', type: 'select', options: state.meta.jail_categories, required: true },
      { name: 'expected_release', label: 'Expected release', type: 'date' },
      { name: 'remarks', label: 'Remarks', type: 'textarea', full: true },
    ], j, 'Save'), async (data) => {
      await api('PUT', `/api/jail/${id}`, data);
      toast('Custody record updated');
      route();
    }));
    const rb = qs('.js-release', c);
    if (rb) rb.addEventListener('click', () => openModal(`Release ${j.full_name}`, formHtml([
      { name: 'release_date', label: 'Release date', type: 'date', required: true },
      { name: 'release_reason', label: 'Reason', type: 'select', options: state.meta.release_reasons, required: true },
      { name: 'remarks', label: 'Remarks (order no., authority)', type: 'textarea', full: true },
    ], { release_date: new Date().toISOString().slice(0, 10) }, 'Release'), async (data) => {
      await api('POST', `/api/jail/${id}/release`, data);
      toast('Inmate released');
      route();
    }));
  };

  // ---------------- Search
  views.search = async (c, params) => {
    const q = params.q || '';
    const r = await api('GET', `/api/search?q=${encodeURIComponent(q)}`);
    const total = r.persons.length + r.firs.length + r.cases.length + r.inmates.length;
    const input = qs('.js-search input');
    if (input) input.value = q;
    c.innerHTML = page(`Search: “${q}”`, { sub: `${total} result${total === 1 ? '' : 's'} across all agencies` }) + `<div class="search-results">
      <div class="card"><div class="card-head"><h2>Persons</h2></div>${table([['Record no.', (x) => `<span class="mono">${esc(x.record_no)}</span>`], ['Name', (x) => `${esc(x.full_name)}${x.alias ? ` <span class="muted">“${esc(x.alias)}”</span>` : ''}`], ['Status', (x) => badge(x.status)]], r.persons, { href: (x) => `#/persons/${x.id}` })}</div>
      <div class="card"><div class="card-head"><h2>FIRs</h2>${badge('police')}</div>${table([['FIR no.', (x) => esc(x.fir_no)], ['Station', (x) => esc(x.police_station)], ['Status', (x) => badge(x.status)]], r.firs, { href: (x) => `#/firs/${x.id}` })}</div>
      <div class="card"><div class="card-head"><h2>Court cases</h2>${badge('court')}</div>${table([['Case no.', (x) => esc(x.case_no)], ['Court', (x) => esc(x.court_name)], ['Status', (x) => badge(x.status)]], r.cases, { href: (x) => `#/cases/${x.id}` })}</div>
      <div class="card"><div class="card-head"><h2>Inmates</h2>${badge('jail')}</div>${table([['Inmate no.', (x) => esc(x.inmate_no)], ['Name', (x) => esc(x.full_name)], ['Prison', (x) => esc(x.prison_name)], ['Status', (x) => badge(x.status)]], r.inmates, { href: (x) => `#/jail/${x.id}` })}</div>
    </div>`;
  };

  // ---------------- Admin
  views.users = async (c) => {
    const { items } = await api('GET', '/api/users');
    c.innerHTML = page('Users', { sub: 'Accounts for police, court and jail personnel.', actions: '<button class="btn primary js-new" type="button">+ New user</button>' }) +
      `<div class="card">${table([
        ['Username', (u) => `<span class="mono">${esc(u.username)}</span>`],
        ['Name', (u) => esc(u.full_name)],
        ['Role', (u) => badge(u.role)],
        ['Agency / unit', (u) => esc(u.agency)],
        ['Status', (u) => (u.active ? '<span class="badge ok">Active</span>' : '<span class="badge danger">Disabled</span>')],
        ['', (u) => `<button class="btn sm js-edit" type="button" data-id="${u.id}">Edit</button>`],
      ], items)}</div>`;
    const roleOpts = state.meta.roles;
    qs('.js-new', c).addEventListener('click', () => openModal('New user', formHtml([
      { name: 'username', label: 'Username', required: true, max: 40, autocomplete: 'off' },
      { name: 'full_name', label: 'Full name', required: true },
      { name: 'role', label: 'Role', type: 'select', options: roleOpts, required: true },
      { name: 'agency', label: 'Agency / unit (station, court, prison)' },
      { name: 'password', label: 'Initial password', type: 'password', required: true, hint: 'Min 8 characters with letters and numbers', autocomplete: 'new-password' },
    ], { role: 'police' }, 'Create user'), async (data) => {
      await api('POST', '/api/users', data);
      toast('User created');
      route();
    }));
    qsa('.js-edit', c).forEach((b) => b.addEventListener('click', () => {
      const u = items.find((x) => String(x.id) === b.dataset.id);
      openModal(`Edit ${u.username}`, formHtml([
        { name: 'full_name', label: 'Full name', required: true },
        { name: 'role', label: 'Role', type: 'select', options: roleOpts, required: true },
        { name: 'agency', label: 'Agency / unit' },
        { name: 'active', label: 'Account status', type: 'select', options: [['1', 'Active'], ['0', 'Disabled']], required: true },
        { name: 'password', label: 'Reset password', type: 'password', hint: 'Leave blank to keep current password', autocomplete: 'new-password' },
      ], { ...u, active: String(u.active) }, 'Save'), async (data) => {
        if (!data.password) delete data.password;
        await api('PUT', `/api/users/${u.id}`, data);
        toast('User updated');
        route();
      });
    }));
  };

  views.audit = async (c, params) => {
    const q = new URLSearchParams();
    ['entity', 'user'].forEach((k) => params[k] && q.set(k, params[k]));
    const { items } = await api('GET', `/api/audit?${q}`);
    const entities = ['person', 'fir', 'court_case', 'jail_record', 'user', 'system'];
    c.innerHTML = page('Audit Trail', { sub: 'Every sign-in and change to records, with the responsible user.' }) + `<div class="card">
      <form class="filters js-filters">
        <select name="entity"><option value="">All record types</option>${entities.map((s) => `<option${params.entity === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <input name="user" placeholder="Username" value="${esc(params.user)}">
        <button class="btn" type="submit">Filter</button>
      </form>
      ${table([
        ['When', (r) => `<span class="nowrap">${fmtDateTime(r.at)}</span>`],
        ['User', (r) => esc(r.username)],
        ['Action', (r) => `<span class="mono">${esc(r.action)}</span>`],
        ['Record', (r) => `${esc(r.entity)}${r.entity_id ? ` #${r.entity_id}` : ''}`],
        ['Details', (r) => esc(r.details)],
      ], items)}</div>`;
    bindFilters(c, 'audit');
  };

  views.account = async (c) => {
    const u = state.user;
    c.innerHTML = page('My account') + `<div class="grid cols-2">
      <div class="card"><div class="card-head"><h2>Profile</h2></div><div class="card-body"><dl class="details">
        <dt>Username</dt><dd class="mono">${esc(u.username)}</dd><dt>Name</dt><dd>${esc(u.full_name)}</dd>
        <dt>Role</dt><dd>${badge(u.role)}</dd><dt>Agency / unit</dt><dd>${esc(u.agency || '—')}</dd>
        <dt>Can modify</dt><dd>${Object.entries(state.perms).filter(([, v]) => v).map(([k]) => esc(k)).join(', ') || 'Read-only'}</dd>
      </dl></div></div>
      <div class="card"><div class="card-head"><h2>Change password</h2></div><div class="card-body">
        ${formHtml([
          { name: 'current_password', label: 'Current password', type: 'password', required: true, full: true, autocomplete: 'current-password' },
          { name: 'new_password', label: 'New password', type: 'password', required: true, full: true, autocomplete: 'new-password', hint: 'Min 8 characters with letters and numbers' },
        ], {}, 'Change password', '#/dashboard')}
      </div></div></div>`;
    bindForm(qs('.js-form', c), async (data) => {
      await api('POST', '/api/me/password', data);
      toast('Password changed');
      qs('.js-form', c).reset();
    });
  };

  // ------------------------------------------------------------------ router
  const ROUTES = [
    [/^\/dashboard$/, views.dashboard, '#/dashboard'],
    [/^\/persons$/, views.persons, '#/persons'],
    [/^\/persons\/new$/, views.personNew, '#/persons'],
    [/^\/persons\/(\d+)\/edit$/, views.personEdit, '#/persons'],
    [/^\/persons\/(\d+)$/, views.person, '#/persons'],
    [/^\/firs$/, views.firs, '#/firs'],
    [/^\/firs\/new$/, views.firNew, '#/firs'],
    [/^\/firs\/(\d+)\/edit$/, views.firEdit, '#/firs'],
    [/^\/firs\/(\d+)$/, views.fir, '#/firs'],
    [/^\/arrests$/, views.arrests, '#/arrests'],
    [/^\/cases$/, views.cases, '#/cases'],
    [/^\/cases\/new$/, views.caseNew, '#/cases'],
    [/^\/cases\/(\d+)\/edit$/, views.caseEdit, '#/cases'],
    [/^\/cases\/(\d+)$/, views.case, '#/cases'],
    [/^\/jail$/, views.jail, '#/jail'],
    [/^\/jail\/new$/, views.jailNew, '#/jail'],
    [/^\/jail\/(\d+)$/, views.jailRecord, '#/jail'],
    [/^\/search$/, views.search, ''],
    [/^\/users$/, views.users, '#/users'],
    [/^\/audit$/, views.audit, '#/audit'],
    [/^\/account$/, views.account, ''],
  ];

  let routeSeq = 0;
  async function route() {
    if (!state.user) return renderLogin();
    if (!qs('#content')) renderShell();
    const raw = location.hash.replace(/^#/, '') || '/dashboard';
    const [path, query = ''] = raw.split('?');
    const params = Object.fromEntries(new URLSearchParams(query));
    const match = ROUTES.map(([re, view, nav]) => [re.exec(path), view, nav]).find(([m]) => m);
    if (!match) { location.hash = '#/dashboard'; return; }
    const [m, view, nav] = match;
    qsa('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === nav));
    qs('#sidebar').classList.remove('open');
    if (modalEl.open) modalEl.close();
    const content = qs('#content');
    const seq = ++routeSeq;
    const target = document.createElement('div');
    try {
      await view(target, params, m[1] ? Number(m[1]) : undefined);
      if (seq !== routeSeq) return; // a newer navigation superseded this one
      content.replaceChildren(target);
      window.scrollTo(0, 0);
    } catch (err) {
      if (seq !== routeSeq || err.status === 401) return;
      content.innerHTML = `<div class="card"><div class="card-body"><h2>Unable to load</h2><p class="error-text">${esc(err.message)}</p>
        <a class="btn" href="#/dashboard">Back to dashboard</a></div></div>`;
    }
  }

  async function boot() {
    const [{ user, permissions }, meta] = await Promise.all([api('GET', '/api/me'), api('GET', '/api/meta')]);
    state.user = user;
    state.perms = permissions;
    state.meta = meta;
    renderShell();
  }

  window.addEventListener('hashchange', route);
  boot().then(route).catch(() => renderLogin());
})();
