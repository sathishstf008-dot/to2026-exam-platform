'use strict';

const http = require('node:http');
const path = require('node:path');
const { openDatabase } = require('./src/db');
const { createApp } = require('./src/app');
const { ensureAdmin, seedDemo, DEMO_PASSWORD } = require('./src/seed');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'justice.db');

const db = openDatabase(DB_FILE);

if (process.env.SEED_DEMO === '1') {
  console.log(seedDemo(db)
    ? `Demo data loaded. Users admin / police1 / court1 / jail1, password: ${DEMO_PASSWORD}`
    : 'Database already has users; demo data not loaded.');
}
const created = ensureAdmin(db);
if (created) {
  console.log(`Created administrator "${created.username}"` +
    (created.generated ? ` with generated password: ${created.password}  (change it after first login)` : ''));
}

const app = createApp(db, { secureCookies: process.env.SECURE_COOKIES === '1' });
http.createServer(app).listen(PORT, HOST, () => {
  console.log(`Integrated Justice Records System running at http://${HOST}:${PORT}`);
});
