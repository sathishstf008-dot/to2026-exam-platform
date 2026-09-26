# Integrated Justice Records System

A web application that links **Police**, **Courts** and **Jails** around one shared
**criminal database**, so a person's full history (FIRs, arrests, trials, verdicts,
custody) is visible in one place and each agency's actions update the others.

## Features

| Module | What it does |
| --- | --- |
| **Criminal Database** | Central person record (auto record no. `CR-YYYY-NNNNNN`), aliases, ID numbers, physical description, identifying marks, status (Suspect, Wanted, Arrested, In Custody, Convicted, Imprisoned, Acquitted, Released…), risk level, integrated timeline and printable dossier. |
| **Police** | Register FIRs with offence sections, investigating officer and accused; record arrests; filter/search FIRs. |
| **Court** | File cases (optionally linked to an FIR), record hearings and adjournments, record verdicts/orders per accused with sentence and fine. |
| **Jail** | Admit inmates (remand / undertrial / convict) with auto inmate no., cell/block, transfers, releases with reason. |
| **Dashboard** | Counts across agencies, persons by status, hearings in the next 7 days, releases due in 30 days, recent activity. |
| **Global search** | Names, aliases, national IDs, record/FIR/case/inmate numbers across all agencies. |
| **Administration** | User accounts per agency, role changes, account disable, password reset, full audit trail. |

### How the agencies are integrated

1. **Police → Criminal DB** – recording an arrest sets the person's status to *Arrested*.
2. **Police → Court** – filing a court case from an FIR copies the FIR's accused into the case and marks the FIR *Charge Sheeted*.
3. **Court → Criminal DB** – a verdict updates the person's status (Convicted, Acquitted, On Bail…); the case becomes *Disposed* once every accused has a final verdict.
4. **Court → Jail** – admitting a convicted person against a case sets the category to *Convict* and computes the expected release date from the sentence.
5. **Jail → Criminal DB** – admission and release update the person's custody status. A person can't be in custody twice at once.

### Roles

Every signed-in user can **read** all records. Writing is restricted:

| Role | Can modify |
| --- | --- |
| `police` | Persons, FIRs, arrests |
| `court` | Court cases, hearings, verdicts |
| `jail` | Custody records (admit, update/transfer, release) |
| `admin` | Everything, plus users and the audit trail |

## Running it

Requires **Node.js 22.13 or later**. There are no npm dependencies: it uses the built-in `node:sqlite` and `node:http`.

```bash
cd justice-records

# Start with sample data and demo accounts (admin, police1, court1, jail1 / password Demo@2026)
npm run demo

# Or start with an empty database
ADMIN_PASSWORD='YourStrongPass1' npm start
```

Then open http://127.0.0.1:3000.

If you start with an empty database and don't set `ADMIN_PASSWORD`, the server creates an `admin` user with a random
password and prints it once to the console.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address (`0.0.0.0` to expose on the network) |
| `DB_FILE` | `data/justice.db` | SQLite database file |
| `ADMIN_PASSWORD` | random | Password for the first `admin` account |
| `SEED_DEMO` | – | `1` loads demo data into an empty database |
| `SECURE_COOKIES` | – | `1` adds the `Secure` flag to cookies (use when served over HTTPS) |

## Tests

```bash
npm test
```

The suite runs the full police → court → jail workflow against an in-memory database. It also covers
role enforcement, validation, the audit trail, session revocation, login rate limiting, static file security and the demo seed.

## Security notes

- Passwords are hashed with scrypt. Sessions use random tokens, stored as SHA-256 hashes, in `HttpOnly; SameSite=Strict` cookies, and expire after 8 hours.
- Write requests must be JSON, which blocks cross-site form posts. A strict Content-Security-Policy is sent with every response (no inline scripts or styles).
- All SQL is parameterized, and all output is HTML-escaped in the client.
- Failed logins are rate limited (5 per 15 minutes per IP and username).
- Every login and every change is written to the audit log with the user who made it.
- Disabling a user or resetting their password signs them out immediately.

For production use, put it behind HTTPS (for example a reverse proxy), set `SECURE_COOKIES=1`, and back up the database file regularly.

## Project layout

```
justice-records/
├── server.js          # entry point
├── src/
│   ├── app.js         # HTTP layer: routing, cookies, static files, security headers
│   ├── api.js         # REST endpoints and cross-agency business rules
│   ├── auth.js        # password hashing, sessions, login rate limiter
│   ├── db.js          # SQLite schema
│   ├── seed.js        # first admin + demo data
│   ├── validate.js    # input validation
│   └── constants.js   # statuses, roles, permissions
├── public/            # single-page web client (HTML/CSS/JS, no build step)
└── test/api.test.js
```
