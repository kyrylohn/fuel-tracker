'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-test-'));
process.env.DATA_DIR = tmp;
process.env.FUEL_HOOK_TOKEN = 'h'.repeat(40);
process.env.BUDGET_HOOK_TX_TOKEN = 'b'.repeat(40);

// Імітація Бюджету
const budgetTx = new Map();
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    if (req.headers.authorization !== 'Bearer ' + 'b'.repeat(40)) { res.writeHead(404); return res.end('{}'); }
    const j = body ? JSON.parse(body) : {};
    if (req.url === '/api/hook/refs') { res.writeHead(200); return res.end(JSON.stringify({ accounts: [{ id: 'acc1', name: 'Mono', currency: 'UAH' }], expenseCats: [{ id: 'cat1', name: 'Бензин' }] })); }
    if (req.url === '/api/hook/tx') budgetTx.set(j.id, j);
    if (req.url === '/api/hook/tx/delete') budgetTx.delete(j.id);
    res.writeHead(200); res.end('{"ok":true}');
  });
});

let base, cookie = '';
const D = () => require('../server/db');
async function api(method, p, body, headers = {}) {
  const r = await fetch(base + p, { method, headers: Object.assign({ 'Content-Type': 'application/json', 'X-Fuel': '1', Cookie: cookie }, headers), body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null) };
}
const hook = (p, body) => api(body ? 'POST' : 'GET', p, body, { Authorization: 'Bearer ' + 'h'.repeat(40), Cookie: '' });
const tick = () => new Promise(r => setTimeout(r, 600));

test.before(async () => {
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  process.env.BUDGET_URL = 'http://127.0.0.1:' + fake.address().port;
  const { server } = require('../server/server');
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  D().addUser({ login: 'tester', name: 'Тестер', password: 'correct-horse-1' });
});
test.after(() => { fake.close(); require('../server/server').server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('вхід і захист', async () => {
  assert.strictEqual((await api('GET', '/api/all')).status, 401);
  assert.strictEqual((await api('POST', '/api/login', { login: 'tester', password: 'wrong-wrong' })).status, 401);
  assert.strictEqual((await api('POST', '/api/login', { login: 'tester', password: 'correct-horse-1' })).status, 200);
  assert.strictEqual((await api('POST', '/api/fill', {}, { 'X-Fuel': '0' })).status, 403);
  assert.strictEqual((await hook('/api/hook/summary').then(() => api('GET', '/api/hook/summary', undefined, { Authorization: 'Bearer nope' }))).status, 404);
});

test('заправки, витрати й синхронізація з Бюджетом', async () => {
  const refs = await api('GET', '/api/budget/refs');
  assert.strictEqual(refs.body.accounts[0].id, 'acc1');
  await api('POST', '/api/settings', { budgetEnabled: true, budgetAccount: 'acc1', budgetFuelCat: 'cat1', budgetCostCat: 'cat1', tank: 50 });
  let r = await api('POST', '/api/fill', { date: '2026-11-01 10:00', odo: 10000, litres: 40, price: 55, full: true, budget_account: 'acc1' });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.fill.total, 2200);
  r = await api('POST', '/api/fill', { date: '2026-11-02 10:00', odo: 9000, litres: 10, price: 55 });
  assert.strictEqual(r.status, 409);
  const c = await api('POST', '/api/cost', { date: '2026-11-03', cat: 'wash', amount: 300, budget_account: 'acc1' });
  assert.strictEqual(c.status, 200);
  await tick();
  assert.strictEqual(budgetTx.size, 2);
  assert.strictEqual(budgetTx.get('fuel-f-' + (await api('GET', '/api/all')).body.fills[0].id).amount, 2200);
  await api('POST', '/api/cost/delete', { id: c.body.cost.id });
  await tick();
  assert.strictEqual(budgetTx.size, 1);
});

test('push → чернетка → пробіг', async () => {
  let r = await hook('/api/hook/notify', { package: 'ua.wog', title: 'WOG PRIDE', text: 'А-95 30 л, сума 1 650,00 грн' });
  assert.strictEqual(r.body.status, 'created');
  assert.match(r.body.message, /30 л · А-95 · 1\s650 ₴\. Який пробіг\? Минулого разу 10\s000 км/);
  const id = r.body.id;
  assert.strictEqual((await hook('/api/hook/notify', { package: 'ua.wog', title: 'WOG PRIDE', text: 'А-95 30 л, сума 1 650,00 грн' })).body.status, 'duplicate');
  assert.strictEqual((await hook('/api/hook/notify', { package: 'x', title: 'Telegram', text: 'привіт' })).body.status, 'ignored');
  assert.strictEqual((await hook('/api/hook/summary')).body.drafts, 1);
  await tick();
  assert.ok(budgetTx.has('fuel-f-' + id), 'чернетка вже в Бюджеті');
  assert.strictEqual((await hook('/api/hook/odo', { id, odo: '9 500' })).status, 409);
  r = await hook('/api/hook/odo', { odo: '10 500 км' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.cons, 6);
  const s = (await hook('/api/hook/summary')).body;
  assert.strictEqual(s.drafts, 0); assert.strictEqual(s.avg_cons, 6); assert.strictEqual(s.last_odo, 10500);
  assert.strictEqual((await hook('/api/hook/odo', { odo: '11000' })).status, 404);
});

test('імпорт Fuelio без дублікатів', async () => {
  const csv = '"## Log"\n"Data","Odo (km)","Fuel (litres)","Full","Price (optional)","Missed","VolumePrice","UniqueId"\n"2026-10-01 09:00","9000","45","1","2250","0","50","77"\n';
  const r1 = await api('POST', '/api/import/fuelio', csv, { 'Content-Type': 'text/csv' });
  assert.strictEqual(r1.body.fills, 1);
  const r2 = await api('POST', '/api/import/fuelio', csv, { 'Content-Type': 'text/csv' });
  assert.strictEqual(r2.body.fills, 0); assert.strictEqual(r2.body.skipped, 1);
  const csvExport = await fetch(base + '/api/export.csv', { headers: { Cookie: cookie } }).then(r => r.text());
  assert.match(csvExport, /Заправка,2026-10-01 09:00,9000,45/);
});

test('WOG: поповнення гаманця → Бюджет, заправка з гаманця → без грошей', async () => {
  const before = budgetTx.size;
  let r = await hook('/api/hook/notify', { package: 'd2.android.apps.wog', title: 'WOG PRIDE', text: 'ПОПОВНЕННЯ ГАМАНЦЯ БЕНЗИН MUSTANG 95, 50 Л - 4 795 ₴' });
  assert.strictEqual(r.body.status, 'topup');
  assert.match(r.body.message, /У гаманці 50 л/);
  await tick();
  assert.strictEqual(budgetTx.get('fuel-t-' + r.body.id).amount, 4795);
  r = await hook('/api/hook/notify', { package: 'd2.android.apps.wog', title: 'WOG PRIDE', text: 'ВИКОРИСТАННЯ ГАМАНЦЯ БЕНЗИН MUSTANG 95, 20 Л' });
  assert.strictEqual(r.body.status, 'created');
  assert.match(r.body.message, /20 л · А-95 Mustang · з гаманця/);
  await hook('/api/hook/odo', { odo: 10800 });
  await tick();
  assert.ok(!budgetTx.has('fuel-f-' + r.body.id), 'заправка з гаманця не дублюється в Бюджеті');
  const all = (await api('GET', '/api/all')).body;
  const f = all.fills.find(x => x.id === r.body.id);
  assert.strictEqual(f.total, 1918); assert.strictEqual(f.price, 95.9);
  assert.strictEqual(all.wallet.litres, 30);
  assert.strictEqual((await hook('/api/hook/summary')).body.wallet_litres, 30);
  r = await hook('/api/hook/notify', { package: 'd2.android.apps.wog', title: 'WOG PRIDE', text: 'КУПІВЛЯ НА АЗК БЕНЗИН MUSTANG 95, 35.4 Л - 2 168.64 ₴ Бонус: +151.5 Бонус: -872.22' });
  assert.match(r.body.message, /2\s168,64 ₴ · \+ 872,22 ₴ бонусами/);
  await tick();
  assert.strictEqual(budgetTx.get('fuel-f-' + r.body.id).amount, 2168.64);
  assert.match(budgetTx.get('fuel-f-' + r.body.id).note, /872.22 ₴ бонусами/);
  assert.strictEqual(budgetTx.size, before + 2);
});

test('push ICW: оплати за день складаються в одну мийку', async () => {
  const D = require('../server/db');
  const a = D.washAdd({ date: '2026-11-13 10:00', amount: 50, place: 'Запорізьке шосе 1В' }, null);
  const b = D.washAdd({ date: '2026-11-13 10:05', amount: 30, bonus: 10 }, null);
  assert.equal(a.id, b.id);
  assert.equal(b.amount, 80);
  assert.match(b.note, /2 оплат: 50 \+ 30/);
  assert.match(b.note, /ще 10 ₴ бонусами/);
  assert.match(b.note, /Запорізьке/);
});

test('картинки вішліста: шлях за межі не пропускається', async () => {
  await api('POST', '/api/login', { login: 'tester', password: 'correct-horse-1' }).catch(() => {});
  for (const n of ['..', '%2e%2e', '%2e%2e%2f%2e%2e', '%E0%A4%A']) assert.strictEqual((await api('GET', '/api/wish/img/' + n)).status, 404, n);
});

test('налаштування: ключ-прототип ігнорується', async () => {
  const D = require('../server/db');
  D.setSettings({ toString: 'x', constructor: 'y', tank: 55 });
  const s = D.getSettings();
  assert.strictEqual(Object.hasOwn(s, 'toString'), false);
  assert.strictEqual(typeof s.toString, 'function');
  assert.strictEqual(s.tank, 55);
});

test('імпорт BM300: 200, повтор без дублікатів, сміття — 400, /api/battery', { skip: !fs.existsSync(path.join(__dirname, 'fixtures', 'bm300-sample.xls')) && 'немає фікстури BM300 (не в git)' }, async () => {
  const buf = fs.readFileSync(path.join(__dirname, 'fixtures', 'bm300-sample.xls'));
  const post = (q, body) => fetch(base + '/api/import/bm300' + q, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Fuel': '1', Cookie: cookie }, body })
    .then(async r => ({ status: r.status, body: await r.json() }));
  let r = await post('?dry=1', buf);
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.dry, true); assert.strictEqual(r.body.samples.new, 2443);
  r = await post('', buf);
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.samples.new, 2443); assert.strictEqual(r.body.trips.new, 11);
  r = await post('', buf);
  assert.strictEqual(r.body.samples.new, 0);
  r = await post('', Buffer.from('це не xls'));
  assert.strictEqual(r.status, 400); assert.match(r.body.error, /BM300/);
  const nocsrf = await fetch(base + '/api/import/bm300', { method: 'POST', headers: { Cookie: cookie }, body: buf });
  assert.strictEqual(nocsrf.status, 403);
  const b = await api('GET', '/api/battery');
  assert.strictEqual(b.status, 200); assert.strictEqual(b.body.has, true); assert.strictEqual(b.body.latest.t, '2026-01-31 23:59'); assert.strictEqual(b.body.engine.has, true);
});

test('API шин: правка запису 200, погана дата 400, bought', async () => {
  let r = await api('POST', '/api/tires/set', { name: 'API', season: 'summer', bought: '2026-05-01' });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.set.bought, '2026-05-01');
  assert.strictEqual((await api('POST', '/api/tires/set', { name: 'API2', bought: '2999-01-01' })).status, 400);
  const id = r.body.set.id;
  r = await api('POST', '/api/tires/measure', { set_id: id, date: '2026-11-01 10:00', odo: 100, fl: 6, fr: 6, rl: 6, rr: 6 });
  const ev = D().listTireEvents().find(e => e.set_id === id);
  r = await api('POST', '/api/tires/event', { id: ev.id, date: '2026-11-02T09:30', odo: 120, fl: 5, fr: 5, rl: 5, rr: 5, note: 'n' });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.event.date, '2026-11-02 09:30');
  assert.strictEqual((await api('POST', '/api/tires/event', { id: ev.id, date: 'вчора', odo: 1, fl: 5 })).status, 400);
  assert.strictEqual((await api('POST', '/api/tires/event', { id: ev.id, date: '2026-11-02', odo: 1, fl: 5 }, { 'X-Fuel': '0' })).status, 403);
});

// останнім: вичерпує ліміт невдалих входів для 127.0.0.1
test('XFF від недовіреного peer ігнорується', async () => {
  let last;
  for (let i = 0; i < 9; i++) last = await api('POST', '/api/login', { login: 'tester', password: 'wrong-wrong' }, { 'X-Forwarded-For': `10.0.0.${i}` });
  assert.strictEqual(last.status, 429);
});
