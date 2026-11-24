'use strict';
const I18N = require('../public/i18n.js');
const _t = I18N.t;
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const C = require('../public/calc.js');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'fuel.sqlite');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
`);

const DEFAULT_CATS = [
  ['service', '🔧', 'ТО і ремонт'], ['tires', '🛞', 'Шини'], ['wash', '🫧', 'Мийка'],
  ['parking', '🅿️', 'Паркування'], ['insurance', '📄', 'Страхування'], ['fines', '👮', 'Штрафи'],
  ['parts', '⚙️', 'Запчастини'], ['other', '📦', 'Інше']
];

const MIGRATIONS = [
  _t('CREATE TABLE settings (k TEXT PRIMARY KEY, v TEXT);\n   CREATE TABLE fills (\n     id TEXT PRIMARY KEY, date TEXT NOT NULL, odo REAL NOT NULL DEFAULT 0,\n     litres REAL NOT NULL DEFAULT 0, price REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,\n     full INTEGER NOT NULL DEFAULT 1, missed INTEGER NOT NULL DEFAULT 0,\n     fuel TEXT NOT NULL DEFAULT \'\', station TEXT NOT NULL DEFAULT \'\', note TEXT NOT NULL DEFAULT \'\',\n     source TEXT NOT NULL DEFAULT \'manual\', status TEXT NOT NULL DEFAULT \'ok\', ext TEXT,\n     budget_account TEXT NOT NULL DEFAULT \'\', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);\n   CREATE INDEX fills_date ON fills(date);\n   CREATE UNIQUE INDEX fills_ext ON fills(ext) WHERE ext IS NOT NULL;\n   CREATE TABLE cats (id TEXT PRIMARY KEY, emoji TEXT NOT NULL DEFAULT \'\', name TEXT NOT NULL,\n     ord INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0);\n   CREATE TABLE costs (\n     id TEXT PRIMARY KEY, date TEXT NOT NULL, odo REAL NOT NULL DEFAULT 0, cat TEXT NOT NULL DEFAULT \'other\',\n     title TEXT NOT NULL DEFAULT \'\', amount REAL NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT \'\', ext TEXT,\n     budget_account TEXT NOT NULL DEFAULT \'\', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);\n   CREATE INDEX costs_date ON costs(date);\n   CREATE UNIQUE INDEX costs_ext ON costs(ext) WHERE ext IS NOT NULL;\n   -- черга до Бюджету: payload = JSON операції або NULL (видалити)\n   CREATE TABLE outbox (txid TEXT PRIMARY KEY, payload TEXT, tries INTEGER NOT NULL DEFAULT 0,\n     last_error TEXT, updated_at INTEGER NOT NULL);\n   CREATE TABLE hook_events (key TEXT PRIMARY KEY, ts INTEGER NOT NULL, fill_id TEXT, raw TEXT);\n   CREATE TABLE users (\n     id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT NOT NULL UNIQUE COLLATE NOCASE,\n     name TEXT NOT NULL, pass TEXT NOT NULL, created_at INTEGER NOT NULL);\n   CREATE TABLE sessions (\n     token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, ua TEXT);\n   CREATE TABLE audit (ts INTEGER NOT NULL, user_id INTEGER, action TEXT NOT NULL, ref TEXT);'),
  // Гаманець WOG: поповнення = оплата наперед (гроші пішли, пальне ще ні); заправка з гаманця — без грошей,
  // її вартість рахується з поповнень (FIFO, public/calc.js). bonus — списані бонуси (частина оплати).
  `ALTER TABLE fills ADD COLUMN pay TEXT NOT NULL DEFAULT 'money';
   ALTER TABLE fills ADD COLUMN bonus REAL NOT NULL DEFAULT 0;
   CREATE TABLE topups (
     id TEXT PRIMARY KEY, date TEXT NOT NULL, litres REAL NOT NULL, amount REAL NOT NULL DEFAULT 0,
     fuel TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', opening INTEGER NOT NULL DEFAULT 0,
     source TEXT NOT NULL DEFAULT 'manual', ext TEXT, budget_account TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE INDEX topups_date ON topups(date);`,
  // Нараховані бонуси WOG (кешбек ₴, ним потім платять)
  `ALTER TABLE fills ADD COLUMN earned REAL NOT NULL DEFAULT 0;
   ALTER TABLE topups ADD COLUMN earned REAL NOT NULL DEFAULT 0;`,
  // Сервіс: регламентні роботи (за пробігом і/або часом), комплекти шин, заміри протектора й переобування
  `CREATE TABLE reminders (
     id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'custom', cat TEXT NOT NULL DEFAULT 'service',
     every_km REAL NOT NULL DEFAULT 0, every_days INTEGER NOT NULL DEFAULT 0,
     last_odo REAL NOT NULL DEFAULT 0, last_date TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '',
     note TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, ord INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE tire_sets (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, season TEXT NOT NULL DEFAULT 'summer', size TEXT NOT NULL DEFAULT '',
     brand TEXT NOT NULL DEFAULT '', dot TEXT NOT NULL DEFAULT '', new_depth REAL NOT NULL DEFAULT 8,
     mounted INTEGER NOT NULL DEFAULT 0, retired INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE tire_events (
     id TEXT PRIMARY KEY, set_id TEXT NOT NULL REFERENCES tire_sets(id) ON DELETE CASCADE,
     date TEXT NOT NULL, odo REAL NOT NULL DEFAULT 0, kind TEXT NOT NULL,
     fl REAL, fr REAL, rl REAL, rr REAL, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
   CREATE INDEX tire_events_set ON tire_events(set_id, date);`,
  // «Відкласти» нагадування: до цієї дати рівень «due» показується як «soon» і push не шлеться
  `ALTER TABLE reminders ADD COLUMN snooze_until TEXT NOT NULL DEFAULT '';`,
  // Акумулятор: імпорт звітів BM300 Pro (вольтаж кожні 2 хв, пуски, зарядка, поїздки). Час локальний, РРРР-ММ-ДД ГГ:ХХ
  `CREATE TABLE bat_samples (t TEXT PRIMARY KEY, v REAL NOT NULL, soc INTEGER, temp INTEGER) WITHOUT ROWID;
   CREATE TABLE bat_cranks (t TEXT PRIMARY KEY, v REAL, ms INTEGER, status TEXT NOT NULL DEFAULT '');
   CREATE TABLE bat_charges (t TEXT PRIMARY KEY, idle REAL, high REAL, ripple REAL, status TEXT NOT NULL DEFAULT '');
   CREATE TABLE bat_trips (start TEXT PRIMARY KEY, "end" TEXT NOT NULL, minutes INTEGER NOT NULL DEFAULT 0, km REAL NOT NULL DEFAULT 0);`,
  // Інтервал за мотогодинами (BM300): що настане раніше — км, час чи мотогодини; для масла типово 300
  `ALTER TABLE reminders ADD COLUMN every_hours REAL NOT NULL DEFAULT 0;
   UPDATE reminders SET every_hours = 300 WHERE kind = 'oil' AND every_hours = 0;`,
  // Шини: дата купівлі комплекту (РРРР-ММ-ДД, порожньо — невідомо)
  `ALTER TABLE tire_sets ADD COLUMN bought TEXT NOT NULL DEFAULT '';`,
  // Валюта витрат: amount завжди у гривні; для USD — сума в доларах і курс, за яким пораховано
  `ALTER TABLE costs ADD COLUMN currency TEXT NOT NULL DEFAULT 'UAH';
   ALTER TABLE costs ADD COLUMN amount_cur REAL;
   ALTER TABLE costs ADD COLUMN rate REAL;`,
  // Нагадування → запис витрати, яким його закрили востаннє (одна витрата може закрити кілька робіт)
  `ALTER TABLE reminders ADD COLUMN last_cost TEXT NOT NULL DEFAULT '';`
];
// Типові регламентні роботи (інтервали — практика для 2.5 Duratec і умов України; користувач змінює під себе)
const DEFAULT_REMINDERS = [
  ['oil', 'Масло двигуна + масляний фільтр', 'service', 8000, 365, 300],  // 6-й елемент — мотогодини (колонка every_hours з міграції; для існуючих баз її ставить UPDATE у міграції)
  ['air', 'Повітряний фільтр', 'service', 15000, 730],
  ['cabin', 'Салонний фільтр', 'service', 15000, 365],
  ['brakefluid', 'Гальмівна рідина', 'service', 0, 730],
  ['plugs', 'Свічки запалювання', 'service', 100000, 0],
  ['atf', 'Масло в АКПП', 'service', 60000, 0],
  ['coolant', 'Антифриз', 'service', 100000, 1825],
  ['insurance', 'Автоцивілка (ОСЦПВ)', 'insurance', 0, 365]
];
(function migrate() {
  const row = db.prepare("SELECT v FROM meta WHERE k = 'schema'").get();
  let v = row ? Number(row.v) : 0;
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      if (v === 0) {
        const ins = db.prepare('INSERT INTO cats(id, emoji, name, ord) VALUES (?, ?, ?, ?)');
        DEFAULT_CATS.forEach((c, i) => ins.run(c[0], c[1], c[2], i));
      }
      if (v === 3) {
        const ins = db.prepare(`INSERT INTO reminders(id, title, kind, cat, every_km, every_days, ord, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        DEFAULT_REMINDERS.forEach((r, i) => ins.run('r-' + r[0], r[1], r[0], r[2], r[3], r[4], i, Date.now(), Date.now()));
      }
      v++;
      db.prepare("INSERT INTO meta(k, v) VALUES ('schema', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(String(v));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
})();

const now = () => Date.now();
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
const audit = (userId, action, ref) =>
  db.prepare('INSERT INTO audit(ts, user_id, action, ref) VALUES (?, ?, ?, ?)').run(now(), userId ?? null, action, ref ?? null);
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
const newId = p => p + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
const plain = r => r && Object.assign({}, r);

/* ---------- налаштування ---------- */
const SETTINGS = {
  // авто
  carName: '', carMake: '', carModel: '', carPlate: '', carYear: '', tank: 0, fuel: 'А-95',
  // паспорт авто (довідка в розділі «Сервіс»)
  carVin: '', carEngine: '', carPower: '', carGearbox: '', carDrive: '', carColor: '', carOil: '', carOilVolume: '',
  carOilFilter: '', carAirFilter: '', carCabinFilter: '', carTireSize: '', carTirePressure: '', carWipers: '', carNote: '',
  // шини: з якої глибини протектора радити заміну (мм); мінімум за ПДР — 1,6
  tireWarnSummer: 3, tireWarnWinter: 4,
  // мова інтерфейсу: 'uk' | 'en' (за замовчуванням українська); Home Assistant-хуки й push завжди українською
  lang: 'uk',
  // вішліст: категорія (хештег у примітці речі), речі з якою показуємо в «Сервісі»
  wishTag: 'авто',
  // акумулятор: дата встановлення (РРРР-ММ-ДД) і модель; аналітика BM300 для поточного акумулятора бере дані від цієї дати
  batteryInstalled: '', batteryModel: '', batteryPrevModel: '',
  // інтеграція з Бюджетом
  budgetEnabled: false, budgetAccount: '', budgetFuelCat: '', budgetCostCat: '',
  // ціни поблизу: центр пошуку (дім), радіус, область для Мінфіну
  homeLat: +process.env.HOME_LAT || 50.450, homeLng: +process.env.HOME_LNG || 30.523,
  priceRadius: 15, priceRegion: process.env.PRICE_REGION || 'kievskaya',
  // Бонуси WOG: [{ fuel: 'a95p', perL: 6, from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', where: 'azk'|'wallet', name }]
  wogBonuses: []
};
function getSettings() {
  const s = Object.assign({}, SETTINGS);
  for (const r of db.prepare('SELECT k, v FROM settings').all()) if (Object.hasOwn(SETTINGS, r.k)) s[r.k] = JSON.parse(r.v);
  return s;
}
function setSettings(patch) {
  const up = db.prepare('INSERT INTO settings(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
  for (let [k, v] of Object.entries(patch || {})) {
    if (!Object.hasOwn(SETTINGS, k)) continue;
    const def = SETTINGS[k];
    if (k === 'batteryInstalled' && String(v ?? '').trim() && !/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2})?$/.test(String(v).trim())) throw httpError(400, _t('Дата встановлення: РРРР-ММ-ДД [ГГ:ХХ]'));
    if (k === 'batteryInstalled') v = String(v ?? '').trim().replace('T', ' ');
    if (k === 'lang') { up.run(k, JSON.stringify(I18N.norm(v))); continue; }
    const val = Array.isArray(def) ? cleanBonuses(v)
      : typeof def === 'number' ? (k === 'homeLat' || k === 'homeLng' ? (+v || 0) : Math.max(0, +v || 0))
      : typeof def === 'boolean' ? !!v : String(v ?? '').slice(0, k === 'carNote' ? 1500 : 120);
    up.run(k, JSON.stringify(val));
  }
  return getSettings();
}

function cleanBonuses(v) {
  const keys = ['a95p', 'a95', 'a92', 'a100', 'dp', 'dpp', 'gas'];
  return (Array.isArray(v) ? v : []).slice(0, 40).map(b => ({
    net: String(b.net || 'WOG').slice(0, 30), fuel: keys.includes(b.fuel) ? b.fuel : 'a95p',
    perL: Math.min(50, Math.max(0, +b.perL || 0)), pct: Math.min(30, Math.max(0, +b.pct || 0)),
    from: /^\d{4}-\d{2}-\d{2}$/.test(b.from) ? b.from : '', to: /^\d{4}-\d{2}-\d{2}$/.test(b.to) ? b.to : '',
    where: b.where === 'wallet' ? 'wallet' : 'azk', name: String(b.name || '').slice(0, 80),
    note: String(b.note || '').slice(0, 200), active: b.active !== false
  })).filter(b => b.perL > 0 || b.pct > 0);
}

/* ---------- перевірка полів ---------- */
const DATE_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/;
function cleanDate(v) {
  const s = String(v || '').trim().replace('T', ' ').slice(0, 16);
  if (!DATE_RE.test(s)) throw httpError(400, _t('Дата: РРРР-ММ-ДД ГГ:ХХ'));
  return s.length === 10 ? s + ' 12:00' : s;
}
const numIn = (v, max, label) => {
  const n = +String(v ?? '').replace(',', '.') || 0;
  if (!isFinite(n) || n < 0 || n > max) throw httpError(400, label);
  return n;
};
const str = (v, n) => String(v ?? '').trim().slice(0, n);

function cleanFill(f, { draft } = {}) {
  const o = C.complete({
    litres: numIn(f.litres, 500, _t('Літри: 0–500')),
    price: numIn(f.price, 1000, _t('Ціна за літр: 0–1000')),
    total: numIn(f.total, 100000, _t('Сума: 0–100 000'))
  });
  const out = {
    date: cleanDate(f.date), odo: numIn(f.odo, 5e6, _t('Пробіг: 0–5 000 000')),
    litres: Math.round(o.litres * 100) / 100, price: Math.round(o.price * 1000) / 1000, total: Math.round(o.total * 100) / 100,
    full: f.full === false || f.full === 0 || f.full === '0' ? 0 : 1,
    pay: f.pay === 'wallet' ? 'wallet' : 'money',
    bonus: Math.round(numIn(f.bonus, 100000, _t('Бонуси: 0–100 000')) * 100) / 100,
    earned: Math.round(numIn(f.earned, 100000, _t('Бонуси: 0–100 000')) * 100) / 100,
    missed: f.missed ? 1 : 0,
    fuel: str(f.fuel, 40), station: str(f.station, 80), note: str(f.note, 500),
    budget_account: str(f.budget_account ?? f.budgetAccount, 40)
  };
  if (out.pay === 'wallet') { out.total = 0; if (!f.keepPrice) out.price = 0; out.budget_account = ''; }
  out.status = (draft || !(out.odo > 0)) ? 'draft' : 'ok';
  if (out.status === 'ok' && !(out.litres > 0)) throw httpError(400, _t('Вкажіть літри (або суму й ціну)'));
  return out;
}
function cleanCost(c) {
  const amount = numIn(c.amount, 1e6, _t('Сума: 0–1 000 000'));
  if (!(amount > 0)) throw httpError(400, _t('Вкажіть суму'));
  const cat = str(c.cat, 40) || 'other';
  if (!db.prepare('SELECT 1 FROM cats WHERE id = ?').get(cat)) throw httpError(400, _t('Немає такої категорії'));
  // USD: server.js підставляє amount (₴) = amount_cur × rate до виклику; тут лише нормалізація полів
  const usd = c.currency === 'USD' && c.amount_cur > 0 && c.rate > 0;
  return {
    currency: usd ? 'USD' : 'UAH', amount_cur: usd ? Math.round(c.amount_cur * 100) / 100 : null, rate: usd ? Math.round(c.rate * 1e6) / 1e6 : null,
    date: cleanDate(c.date), odo: numIn(c.odo, 5e6, _t('Пробіг: 0–5 000 000')), cat,
    title: str(c.title, 80), amount: Math.round(amount * 100) / 100, note: str(c.note, 500),
    budget_account: str(c.budget_account ?? c.budgetAccount, 40)
  };
}

/* ---------- Бюджет: черга операцій ---------- */
const budgetTxId = (kind, id) => `fuel-${kind}-${id}`;
const catName = id => (db.prepare('SELECT name FROM cats WHERE id = ?').get(id) || {}).name || '';
function queueBudget(kind, row) {
  const txid = budgetTxId(kind, row.id);
  const s = getSettings();
  const cat = kind === 'c' ? s.budgetCostCat : s.budgetFuelCat;
  const amount = kind === 'f' ? row.total : row.amount;
  const want = s.budgetEnabled && row.budget_account && cat && amount > 0 && row.status !== 'deleted'
    && !(kind === 'f' && row.pay === 'wallet') && !(kind === 't' && row.opening);
  const had = db.prepare('SELECT 1 FROM outbox WHERE txid = ?').get(txid) || db.prepare("SELECT 1 FROM meta WHERE k = ?").get('sent:' + txid);
  if (!want && !had) return;
  let payload = null;
  if (want) {
    const note = kind === 'f'
      ? ['Пальне', row.fuel, row.litres ? row.litres + ' л' : '', row.station, row.bonus ? `ще ${row.bonus} ₴ бонусами` : '', row.note].filter(Boolean).join(' · ')
      : kind === 't' ? ['Гаманець WOG: поповнення', row.fuel, row.litres + ' л', row.note].filter(Boolean).join(' · ')
      : [catName(row.cat), row.title, row.currency === 'USD' && row.amount_cur ? _t('${replace} за курсом {replace2}', { replace: String(row.amount_cur).replace('.', ','), replace2: String(Math.round(row.rate * 100) / 100).replace('.', ',') }) : '', row.note].filter(Boolean).join(' · ');
    payload = JSON.stringify({ id: txid, date: row.date.slice(0, 10), amount, account: row.budget_account, cat, note: note.slice(0, 200) });
  }
  db.prepare(`INSERT INTO outbox(txid, payload, tries, last_error, updated_at) VALUES (?, ?, 0, NULL, ?)
    ON CONFLICT(txid) DO UPDATE SET payload = excluded.payload, tries = 0, last_error = NULL, updated_at = excluded.updated_at`)
    .run(txid, payload, now());
}
const outboxPending = () => db.prepare('SELECT * FROM outbox ORDER BY updated_at').all().map(plain);
function outboxDone(txid, payload) {
  db.prepare('DELETE FROM outbox WHERE txid = ? AND payload IS ?').run(txid, payload);
  if (payload === null) db.prepare('DELETE FROM meta WHERE k = ?').run('sent:' + txid);
  else db.prepare("INSERT INTO meta(k, v) VALUES (?, '1') ON CONFLICT(k) DO NOTHING").run('sent:' + txid);
}
const outboxFailed = (txid, err) =>
  db.prepare('UPDATE outbox SET tries = tries + 1, last_error = ? WHERE txid = ?').run(String(err).slice(0, 300), txid);
const budgetState = () => {
  const r = db.prepare('SELECT COUNT(*) n, MAX(tries) t, MAX(last_error) e FROM outbox').get();
  return { pending: r.n, error: r.n && r.t ? r.e : null };
};
function requeueAllBudget() {
  return tx(() => {
    let n = 0;
    for (const f of db.prepare("SELECT * FROM fills").all()) { queueBudget('f', f); n++; }
    for (const c of db.prepare('SELECT * FROM costs').all()) { queueBudget('c', c); n++; }
    for (const t of db.prepare('SELECT * FROM topups').all()) { queueBudget('t', t); n++; }
    return n;
  });
}

/* ---------- дані ---------- */
const listFills = () => db.prepare('SELECT * FROM fills ORDER BY date DESC, created_at DESC').all().map(plain);
const listCosts = () => db.prepare('SELECT * FROM costs ORDER BY date DESC, created_at DESC').all().map(plain);
const listCats = () => db.prepare('SELECT * FROM cats ORDER BY ord, name').all().map(plain);
const getFill = id => plain(db.prepare('SELECT * FROM fills WHERE id = ?').get(String(id || '')));
const listTopups = () => db.prepare('SELECT * FROM topups ORDER BY date DESC, created_at DESC').all().map(plain);

function getAll() {
  return { settings: getSettings(), fills: listFills(), costs: listCosts(), topups: listTopups(), cats: listCats(), budget: budgetState(),
    reminders: listReminders(), tireSets: listTireSets(), tireEvents: listTireEvents() };
}

function saveFill(f, userId, opts = {}) {
  return tx(() => {
    const id = f.id ? String(f.id) : newId('f');
    const cur = getFill(id);
    const row = cleanFill(Object.assign({}, cur || {}, f), opts);
    const problem = row.status === 'ok' ? C.odoProblem(listFills(), Object.assign({ id }, row)) : null;
    if (problem && !f.force) throw httpError(409, problem);
    const t = now();
    if (cur) {
      db.prepare(`UPDATE fills SET date=?, odo=?, litres=?, price=?, total=?, full=?, missed=?, fuel=?, station=?, note=?,
        status=?, budget_account=?, pay=?, bonus=?, earned=?, updated_at=? WHERE id=?`)
        .run(row.date, row.odo, row.litres, row.price, row.total, row.full, row.missed, row.fuel, row.station, row.note,
          row.status, row.budget_account, row.pay, row.bonus, row.earned, t, id);
    } else {
      db.prepare(`INSERT INTO fills(id, date, odo, litres, price, total, full, missed, fuel, station, note, source, status, ext,
        budget_account, pay, bonus, earned, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, row.date, row.odo, row.litres, row.price, row.total, row.full, row.missed, row.fuel, row.station, row.note,
          str(opts.source || 'manual', 20), row.status, opts.ext ?? null, row.budget_account, row.pay, row.bonus, row.earned, t, t);
    }
    const saved = getFill(id);
    queueBudget('f', saved);
    audit(userId, cur ? 'editFill' : 'addFill', id);
    return saved;
  });
}
function deleteFill(id, userId) {
  return tx(() => {
    const cur = getFill(id);
    if (!cur) return false;
    db.prepare('DELETE FROM fills WHERE id = ?').run(cur.id);
    queueBudget('f', Object.assign(cur, { status: 'deleted' }));
    audit(userId, 'deleteFill', cur.id);
    return true;
  });
}

function saveCost(c, userId) {
  return tx(() => {
    const id = c.id ? String(c.id) : newId('c');
    const cur = plain(db.prepare('SELECT * FROM costs WHERE id = ?').get(id));
    const row = cleanCost(Object.assign({}, cur || {}, c));
    const t = now();
    if (cur) {
      db.prepare('UPDATE costs SET date=?, odo=?, cat=?, title=?, amount=?, currency=?, amount_cur=?, rate=?, note=?, budget_account=?, updated_at=? WHERE id=?')
        .run(row.date, row.odo, row.cat, row.title, row.amount, row.currency, row.amount_cur, row.rate, row.note, row.budget_account, t, id);
    } else {
      db.prepare(`INSERT INTO costs(id, date, odo, cat, title, amount, currency, amount_cur, rate, note, ext, budget_account, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, row.date, row.odo, row.cat, row.title, row.amount, row.currency, row.amount_cur, row.rate, row.note, c.ext ?? null, row.budget_account, t, t);
    }
    const saved = plain(db.prepare('SELECT * FROM costs WHERE id = ?').get(id));
    queueBudget('c', saved);
    audit(userId, cur ? 'editCost' : 'addCost', id);
    return saved;
  });
}
function deleteCost(id, userId) {
  return tx(() => {
    const cur = plain(db.prepare('SELECT * FROM costs WHERE id = ?').get(String(id || '')));
    if (!cur) return false;
    db.prepare('DELETE FROM costs WHERE id = ?').run(cur.id);
    db.prepare("UPDATE reminders SET last_cost='' WHERE last_cost = ?").run(cur.id);
    queueBudget('c', Object.assign(cur, { status: 'deleted' }));
    audit(userId, 'deleteCost', cur.id);
    return true;
  });
}

function saveTopup(x, userId, opts = {}) {
  return tx(() => {
    const id = x.id ? String(x.id) : newId('t');
    const cur = plain(db.prepare('SELECT * FROM topups WHERE id = ?').get(id));
    const v = Object.assign({}, cur || {}, x);
    const litres = numIn(v.litres, 1000, _t('Літри: 0–1000'));
    if (!(litres > 0)) throw httpError(400, _t('Вкажіть літри'));
    const row = { date: cleanDate(v.date), litres: Math.round(litres * 100) / 100, amount: Math.round(numIn(v.amount, 1e6, _t('Сума: 0–1 000 000')) * 100) / 100,
      fuel: str(v.fuel, 40), note: str(v.note, 300), opening: v.opening ? 1 : 0,
      earned: Math.round(numIn(v.earned, 100000, _t('Бонуси: 0–100 000')) * 100) / 100,
      budget_account: v.opening ? '' : str(v.budget_account ?? v.budgetAccount, 40) };
    const t = now();
    if (cur) db.prepare('UPDATE topups SET date=?, litres=?, amount=?, fuel=?, note=?, opening=?, budget_account=?, earned=?, updated_at=? WHERE id=?')
      .run(row.date, row.litres, row.amount, row.fuel, row.note, row.opening, row.budget_account, row.earned, t, id);
    else db.prepare(`INSERT INTO topups(id, date, litres, amount, fuel, note, opening, source, ext, budget_account, earned, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, row.date, row.litres, row.amount, row.fuel, row.note, row.opening,
        str(opts.source || 'manual', 20), opts.ext ?? null, row.budget_account, row.earned, t, t);
    const saved = plain(db.prepare('SELECT * FROM topups WHERE id = ?').get(id));
    queueBudget('t', saved);
    audit(userId, cur ? 'editTopup' : 'addTopup', id);
    return saved;
  });
}
function deleteTopup(id, userId) {
  return tx(() => {
    const cur = plain(db.prepare('SELECT * FROM topups WHERE id = ?').get(String(id || '')));
    if (!cur) return false;
    db.prepare('DELETE FROM topups WHERE id = ?').run(cur.id);
    queueBudget('t', Object.assign(cur, { status: 'deleted' }));
    audit(userId, 'deleteTopup', cur.id);
    return true;
  });
}

function saveCat(c) {
  const name = str(c.name, 40);
  if (!name) throw httpError(400, _t('Назва категорії'));
  const id = c.id ? str(c.id, 40) : newId('k');
  db.prepare(`INSERT INTO cats(id, emoji, name, ord, archived) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET emoji = excluded.emoji, name = excluded.name, archived = excluded.archived`)
    .run(id, str(c.emoji, 8), name, Date.now() % 1e9, c.archived ? 1 : 0);
  return listCats();
}

/* ---------- сервіс: нагадування й шини ---------- */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const cleanDay = (v, label) => { const d = String(v || '').trim().slice(0, 10); if (d && !DAY_RE.test(d)) throw httpError(400, label || _t('Дата: РРРР-ММ-ДД')); return d; };
const listReminders = () => db.prepare('SELECT * FROM reminders ORDER BY ord, created_at').all().map(plain);
const getReminder = id => plain(db.prepare('SELECT * FROM reminders WHERE id = ?').get(String(id || '')));
function saveReminder(r, userId) {
  return tx(() => {
    const id = r.id ? str(r.id, 40) : newId('r');
    const cur = getReminder(id);
    const v = Object.assign({}, cur || {}, r);
    const row = {
      title: str(v.title, 80), kind: str(v.kind, 20) || 'custom', cat: str(v.cat, 40) || 'service',
      every_km: Math.round(numIn(v.every_km, 1e6, _t('Інтервал: 0–1 000 000 км'))),
      every_hours: Math.round(numIn(v.every_hours, 20000, _t('Інтервал: 0–20 000 мотогод'))),
      every_days: Math.round(numIn(v.every_days, 3650 * 3, _t('Інтервал: до 30 років'))),
      last_odo: Math.round(numIn(v.last_odo, 5e6, _t('Пробіг: 0–5 000 000'))), last_date: cleanDay(v.last_date),
      due_date: cleanDay(v.due_date), note: str(v.note, 500), active: v.active === false || v.active === 0 ? 0 : 1
    };
    if (!row.title) throw httpError(400, _t('Назва роботи'));
    if (!row.every_km && !row.every_days && !row.every_hours && !row.due_date) throw httpError(400, _t('Вкажіть інтервал (км, місяці або мотогодини) чи дату'));
    const t = now();
    if (cur) db.prepare(`UPDATE reminders SET title=?, kind=?, cat=?, every_km=?, every_days=?, every_hours=?, last_odo=?, last_date=?, due_date=?, note=?, active=?, updated_at=? WHERE id=?`)
      .run(row.title, row.kind, row.cat, row.every_km, row.every_days, row.every_hours, row.last_odo, row.last_date, row.due_date, row.note, row.active, t, id);
    else db.prepare(`INSERT INTO reminders(id, title, kind, cat, every_km, every_days, every_hours, last_odo, last_date, due_date, note, active, ord, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, row.title, row.kind, row.cat, row.every_km, row.every_days, row.every_hours, row.last_odo, row.last_date, row.due_date, row.note, row.active, 100 + (t % 1e6), t, t);
    audit(userId, cur ? 'editReminder' : 'addReminder', id);
    return getReminder(id);
  });
}
function deleteReminder(id, userId) {
  const ok = db.prepare('DELETE FROM reminders WHERE id = ?').run(String(id || '')).changes > 0;
  if (ok) audit(userId, 'deleteReminder', id);
  return ok;
}
// Роботу виконано: новий відлік від дати/пробігу; дата «діє до» (поліс) зсувається на інтервал; за бажанням — витрата
function reminderDone(b, userId) {
  const r = getReminder(b.id);
  if (!r) throw httpError(404, _t('Немає такого нагадування'));
  const date = cleanDate(b.date).slice(0, 10);
  const odo = Math.round(numIn(b.odo, 5e6, _t('Пробіг: 0–5 000 000')));
  const patch = { id: r.id, last_date: date, last_odo: odo || r.last_odo };
  if (b.due_date !== undefined) patch.due_date = cleanDay(b.due_date);
  else if (r.due_date && r.every_days) patch.due_date = addDays(date, r.every_days);
  if (b.rnote) patch.note = str(b.rnote, 500);
  const saved = saveReminder(patch, userId);
  let cost = null;
  if (numIn(b.amount, 1e6, _t('Сума: 0–1 000 000')) > 0)
    cost = saveCost({ date: b.date, odo, cat: str(b.cat, 40) || r.cat, title: str(b.title, 80) || r.title, amount: b.amount, note: b.note,
      budget_account: b.budget_account }, userId);
  db.prepare("UPDATE reminders SET snooze_until='', last_cost=? WHERE id=?").run(cost ? cost.id : '', r.id);
  return { reminder: getReminder(r.id), cost };
}
// Відкласти: days 1..365 від сьогодні (локальна дата), 0 — скасувати
function reminderSnooze(b, userId) {
  const r = getReminder(b.id);
  if (!r) throw httpError(404, _t('Немає такого нагадування'));
  const days = Math.round(numIn(b.days, 365, _t('Днів: 0–365')));
  const until = days > 0 ? addDays(new Date().toLocaleDateString('sv-SE'), days) : '';
  db.prepare('UPDATE reminders SET snooze_until=?, updated_at=? WHERE id=?').run(until, now(), r.id);
  audit(userId, 'snoozeReminder', `${r.id}:${until}`);
  return { reminder: getReminder(r.id) };
}
const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const listTireSets = () => db.prepare('SELECT * FROM tire_sets ORDER BY retired, mounted DESC, created_at').all().map(plain);
const listTireEvents = () => db.prepare('SELECT * FROM tire_events ORDER BY date, created_at').all().map(plain);
const getTireSet = id => plain(db.prepare('SELECT * FROM tire_sets WHERE id = ?').get(String(id || '')));
function saveTireSet(x, userId) {
  return tx(() => {
    const id = x.id ? str(x.id, 40) : newId('s');
    const cur = getTireSet(id);
    const v = Object.assign({}, cur || {}, x);
    const row = {
      name: str(v.name, 60), season: ['summer', 'winter', 'all'].includes(v.season) ? v.season : 'summer',
      size: str(v.size, 40), brand: str(v.brand, 80), dot: str(v.dot, 8).replace(/\D/g, ''),
      new_depth: Math.round(numIn(v.new_depth || 8, 20, _t('Новий протектор: до 20 мм')) * 10) / 10,
      retired: v.retired ? 1 : 0, note: str(v.note, 500), bought: str(v.bought, 10)
    };
    if (row.bought) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.bought) || isNaN(Date.parse(row.bought + 'T12:00:00Z'))) throw httpError(400, _t('Дата купівлі: РРРР-ММ-ДД'));
      if (row.bought > new Date().toLocaleDateString('sv-SE')) throw httpError(400, _t('Дата купівлі не може бути в майбутньому'));
    }
    if (!row.name) row.name = { summer: 'Літні', winter: 'Зимові', all: 'Всесезонні' }[row.season];
    const t = now();
    if (cur) db.prepare('UPDATE tire_sets SET name=?, season=?, size=?, brand=?, dot=?, new_depth=?, retired=?, note=?, bought=?, updated_at=? WHERE id=?')
      .run(row.name, row.season, row.size, row.brand, row.dot, row.new_depth, row.retired, row.note, row.bought, t, id);
    else db.prepare(`INSERT INTO tire_sets(id, name, season, size, brand, dot, new_depth, mounted, retired, note, bought, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?)`).run(id, row.name, row.season, row.size, row.brand, row.dot, row.new_depth, row.retired, row.note, row.bought, t, t);
    if (row.retired && cur && cur.mounted) db.prepare('UPDATE tire_sets SET mounted = 0 WHERE id = ?').run(id);
    audit(userId, cur ? 'editTireSet' : 'addTireSet', id);
    return getTireSet(id);
  });
}
function deleteTireSet(id, userId) {
  const ok = db.prepare('DELETE FROM tire_sets WHERE id = ?').run(String(id || '')).changes > 0;
  if (ok) audit(userId, 'deleteTireSet', id);
  return ok;
}
const depth = (v, label) => { if (v === '' || v === null || v === undefined) return null; const n = numIn(v, 20, label); return Math.round(n * 10) / 10; };
function insertTireEvent(e) {
  const id = newId('e');
  const d = ['fl', 'fr', 'rl', 'rr'].map(k => depth(e[k], _t('Протектор: 0–20 мм')));
  db.prepare('INSERT INTO tire_events(id, set_id, date, odo, kind, fl, fr, rl, rr, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, e.set_id, cleanDate(e.date), Math.round(numIn(e.odo, 5e6, _t('Пробіг: 0–5 000 000'))), e.kind, d[0], d[1], d[2], d[3], str(e.note, 300), now());
  return id;
}
// Замір протектора (мм по кожному колесу; порожнє колесо — не міряли)
function tireMeasure(b, userId) {
  return tx(() => {
    const set = getTireSet(b.set_id);
    if (!set) throw httpError(404, _t('Немає такого комплекту'));
    if (!['fl', 'fr', 'rl', 'rr'].some(k => b[k] !== '' && b[k] !== null && b[k] !== undefined)) throw httpError(400, _t('Вкажіть глибину протектора'));
    const id = insertTireEvent(Object.assign({}, b, { kind: 'measure' }));
    audit(userId, 'tireMeasure', id);
    return id;
  });
}
// Переобування: знятий комплект (із заміром, якщо є) → встановлений; шиномонтаж — витрата
function tireSwap(b, userId) {
  const res = tx(() => {
    const to = getTireSet(b.to);
    if (!to) throw httpError(404, _t('Оберіть комплект, який ставите'));
    const from = db.prepare('SELECT * FROM tire_sets WHERE mounted = 1').all().map(plain);
    for (const f of from) {
      if (f.id === to.id) continue;
      insertTireEvent({ set_id: f.id, date: b.date, odo: b.odo, kind: 'unmount', note: '' });
      if (['fl', 'fr', 'rl', 'rr'].some(k => b[k] !== '' && b[k] != null)) insertTireEvent({ set_id: f.id, date: b.date, odo: b.odo, kind: 'measure', fl: b.fl, fr: b.fr, rl: b.rl, rr: b.rr, note: 'при знятті' });
      db.prepare('UPDATE tire_sets SET mounted = 0, updated_at = ? WHERE id = ?').run(now(), f.id);
    }
    if (!to.mounted) {
      insertTireEvent({ set_id: to.id, date: b.date, odo: b.odo, kind: 'mount', note: str(b.note, 300) });
      db.prepare('UPDATE tire_sets SET mounted = 1, retired = 0, updated_at = ? WHERE id = ?').run(now(), to.id);
    }
    audit(userId, 'tireSwap', to.id);
    return to.id;
  });
  let cost = null;
  if (numIn(b.amount, 1e6, _t('Сума: 0–1 000 000')) > 0)
    cost = saveCost({ date: b.date, odo: b.odo, cat: 'tires', title: 'Шиномонтаж', amount: b.amount, note: b.note, budget_account: b.budget_account }, userId);
  return { mounted: res, cost };
}
// Правка запису історії шин: дата, пробіг, примітка (+ глибини для заміру). Вид і комплект не змінюються
function updateTireEvent(b, userId) {
  return tx(() => {
    const cur = db.prepare('SELECT * FROM tire_events WHERE id = ?').get(String(b.id || ''));
    if (!cur) throw httpError(404, _t('Немає такого запису'));
    const date = cleanDate(b.date);
    const odo = Math.round(numIn(b.odo, 5e6, _t('Пробіг: 0–5 000 000')));
    let d = [cur.fl, cur.fr, cur.rl, cur.rr];
    if (cur.kind === 'measure') {
      d = ['fl', 'fr', 'rl', 'rr'].map(k => depth(b[k], _t('Протектор: 0–20 мм')));
      if (d.every(x => x === null)) throw httpError(400, _t('Вкажіть глибину протектора'));
    }
    db.prepare('UPDATE tire_events SET date=?, odo=?, fl=?, fr=?, rl=?, rr=?, note=? WHERE id=?')
      .run(date, odo, d[0], d[1], d[2], d[3], str(b.note, 300), cur.id);
    audit(userId, 'editTireEvent', cur.id);
    return plain(db.prepare('SELECT * FROM tire_events WHERE id = ?').get(cur.id));
  });
}
function deleteTireEvent(id, userId) {
  const ok = db.prepare('DELETE FROM tire_events WHERE id = ?').run(String(id || '')).changes > 0;
  if (ok) audit(userId, 'deleteTireEvent', id);
  return ok;
}

/* ---------- мийка ICW: усі оплати за день = одна мийка ---------- */
function washAdd({ date, amount, bonus, place }, userId) {
  const day = cleanDate(date).slice(0, 10);
  const ext = 'icw:' + day;
  const cur = plain(db.prepare('SELECT * FROM costs WHERE ext = ?').get(ext));
  const pays = cur ? ((cur.note.match(/(\d+) оплат/) || [])[1] | 0) : 0;
  const parts = cur ? ((cur.note.match(/оплат: ([\d +.]+)/) || [])[1] || '').trim() : '';
  const bonusPrev = cur ? +((cur.note.match(/ще ([\d.]+) ₴ бонусами/) || [])[1] || 0) : 0;
  const b = bonusPrev + (+bonus || 0);
  const note = ['ICW' + (place ? ' ' + place : cur ? (cur.note.match(/^ICW([^·]*)/) || ['', ''])[1].trimEnd() : ''),
    _t('{pays} оплат: {parts}{amount}', { pays: pays + 1, parts: parts ? parts + ' + ' : '', amount }), b ? _t('ще {b} ₴ бонусами', { b }) : ''].filter(Boolean).join(' · ');
  const saved = saveCost({ id: cur ? cur.id : undefined, date: cur ? cur.date : day + ' ' + cleanDate(date).slice(11), cat: 'wash', title: 'Мийка ICW',
    amount: Math.round(((cur ? cur.amount : 0) + amount) * 100) / 100, note, ext, budget_account: cur ? cur.budget_account : '' }, userId);
  return saved;
}

/* ---------- імпорт Fuelio ---------- */
function importFuelio(parsed, { budget } = {}, userId) {
  return tx(() => {
    const s = getSettings();
    const res = { fills: 0, costs: 0, skipped: 0, cats: 0 };
    const v = parsed.vehicle || {};
    const patch = {};
    if (!s.carName && v.name) patch.carName = v.name;
    if (!s.carMake && v.make) patch.carMake = v.make;
    if (!s.carModel && v.model) patch.carModel = v.model;
    if (!s.carPlate && v.plate) patch.carPlate = v.plate;
    if (!s.carYear && v.year) patch.carYear = v.year;
    if (!s.tank && v.tank) patch.tank = v.tank;
    setSettings(patch);
    const acct = budget ? s.budgetAccount : '';
    const key = (p, x) => 'fuelio:' + p + ':' + (x.uid || [x.date, x.odo, x.litres ?? x.amount].join('|'));
    const ext = db.prepare('SELECT 1 FROM fills WHERE ext = ? UNION SELECT 1 FROM costs WHERE ext = ?');
    const t = now();
    const insF = db.prepare(`INSERT INTO fills(id, date, odo, litres, price, total, full, missed, fuel, station, note, source,
      status, ext, budget_account, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?, 'fuelio', 'ok', ?, ?, ?, ?)`);
    for (const f of parsed.fills || []) {
      const k = key('f', f);
      if (ext.get(k, k)) { res.skipped++; continue; }
      const id = newId('f');
      insF.run(id, f.date, f.odo, f.litres, f.price, f.total, f.full, f.missed, f.fuel || s.fuel, str(f.station, 80), str(f.note, 500), k, acct, t, t);
      if (acct) queueBudget('f', getFill(id));
      res.fills++;
    }
    const catByName = {};
    listCats().forEach(c => { catByName[c.name.toLowerCase()] = c.id; });
    const insC = db.prepare(`INSERT INTO costs(id, date, odo, cat, title, amount, note, ext, budget_account, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    for (const c of parsed.costs || []) {
      const k = key('c', c);
      if (ext.get(k, k)) { res.skipped++; continue; }
      let cat = 'other';
      if (c.catName) {
        cat = catByName[c.catName.toLowerCase()];
        if (!cat) { cat = newId('k'); db.prepare('INSERT INTO cats(id, emoji, name, ord) VALUES (?, ?, ?, ?)').run(cat, '🏷️', str(c.catName, 40), 500 + res.cats); catByName[c.catName.toLowerCase()] = cat; res.cats++; }
      }
      const id = newId('c');
      insC.run(id, c.date, c.odo, cat, str(c.title, 80), c.amount, str(c.note, 500), k, acct, t, t);
      if (acct) queueBudget('c', plain(db.prepare('SELECT * FROM costs WHERE id = ?').get(id)));
      res.costs++;
    }
    audit(userId, 'importFuelio', JSON.stringify(res));
    return res;
  });
}

/* ---------- імпорт BM300 ---------- */
// NaN → NULL (у звіті можуть бути порожні клітинки)
const fin = x => (typeof x === 'number' && isFinite(x) ? x : null);
function importBm300(parsed, { dry } = {}, userId) {
  const sets = [
    ['samples', 'bat_samples', 't', ['t', 'v', 'soc', 'temp'], parsed.samples],
    ['cranks', 'bat_cranks', 't', ['t', 'v', 'ms', 'status'], parsed.cranks],
    ['charges', 'bat_charges', 't', ['t', 'idle', 'high', 'ripple', 'status'], parsed.charges],
    ['trips', 'bat_trips', 'start', ['start', 'end', 'minutes', 'km'], parsed.trips]
  ];
  const run = () => {
    const res = {};
    for (const [key, table, pk, cols, rows] of sets) {
      const list = rows || [];
      const q = cols.map(c => '"' + c + '"');
      const ins = db.prepare(`INSERT OR IGNORE INTO ${table}(${q.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
      const has = db.prepare(`SELECT 1 FROM ${table} WHERE "${pk}" = ?`);
      let fresh = 0;
      for (const r of list) {
        if (dry) { if (!has.get(r[pk])) fresh++; continue; }
        fresh += Number(ins.run(...cols.map(c => (typeof r[c] === 'number' ? fin(r[c]) : r[c] ?? null))).changes);
      }
      res[key] = { new: fresh, total: list.length };
    }
    const ts = (parsed.samples || []).map(s => s.t).concat((parsed.trips || []).map(x => x.start)).sort();
    res.from = ts[0] || null; res.to = ts.length ? ts[ts.length - 1] : null;
    res.device = parsed.device || '';
    if (!dry) audit(userId, 'importBm300', JSON.stringify({ samples: res.samples, cranks: res.cranks, charges: res.charges, trips: res.trips, from: res.from, to: res.to }));
    return res;
  };
  return dry ? run() : tx(run);
}

/* ---------- хук сповіщень ---------- */
function hookSeen(key) { return plain(db.prepare('SELECT * FROM hook_events WHERE key = ?').get(key)); }
function hookRecord(key, fillId, raw) {
  db.prepare('INSERT INTO hook_events(key, ts, fill_id, raw) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING').run(key, now(), fillId, String(raw).slice(0, 1000));
  db.prepare('DELETE FROM hook_events WHERE ts < ?').run(now() - 180 * 864e5);
}
const lastFill = () => plain(db.prepare("SELECT * FROM fills WHERE status = 'ok' ORDER BY odo DESC LIMIT 1").get());

/* ---------- експорт ---------- */
function exportJson() {
  return { app: 'fuel', exported: new Date().toISOString(), settings: getSettings(), cats: listCats(), fills: listFills(), costs: listCosts(), topups: listTopups(),
    reminders: listReminders(), tireSets: listTireSets(), tireEvents: listTireEvents() };
}
const csvCell = v => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function exportCsv() {
  const cats = {}; listCats().forEach(c => { cats[c.id] = c.name; });
  const fills = C.applyWallet(listFills(), listTopups()).fills;
  const seg = C.segments(fills);
  const rows = [['Тип', 'Дата', 'Пробіг', 'Літри', 'Ціна/л', 'Сума', 'Повний', 'Пропущена', 'л/100 км', 'Пальне / категорія', 'АЗС / назва', 'Примітка']];
  fills.slice().reverse().forEach(f => rows.push([f.pay === 'wallet' ? 'Заправка з гаманця' : 'Заправка', f.date, f.odo, f.litres, f.price, f.total, f.full ? 'так' : 'ні', f.missed ? 'так' : '',
    seg[f.id] ? seg[f.id].cons.toFixed(2) : '', f.fuel, f.station, f.note]));
  listTopups().slice().reverse().forEach(t => rows.push([t.opening ? 'Гаманець: початковий залишок' : 'Гаманець: поповнення', t.date, '', t.litres, t.litres ? Math.round(t.amount / t.litres * 100) / 100 : '', t.amount, '', '', '', t.fuel, '', t.note]));
  listCosts().slice().reverse().forEach(c => rows.push(['Витрата', c.date, c.odo || '', '', '', c.amount, '', '', '', cats[c.cat] || c.cat, c.title, c.note]));
  return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function backupTo(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.unlinkSync(file); } catch {}
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
}

/* ---------- користувачі й сесії (як у Бюджеті) ---------- */
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
const scryptAsync = require('node:util').promisify(crypto.scrypt);
async function verifyPassword(pw, stored) {
  const [alg, N, r, p, salt, key] = String(stored || '').split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(key, 'base64');
  const got = await scryptAsync(String(pw), Buffer.from(salt, 'base64'), want.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(want, got);
}
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));
const publicUser = u => u && ({ id: u.id, login: u.login, name: u.name });
function addUser({ login, name, password }) {
  if (!/^[a-z0-9._-]{2,32}$/i.test(login || '')) throw new Error(_t('Логін: 2–32 латинські літери, цифри, . _ -'));
  if (!name) throw new Error(_t('Потрібне ім\'я'));
  if (String(password || '').length < 10) throw new Error(_t('Пароль має бути щонайменше 10 символів'));
  db.prepare('INSERT INTO users(login, name, pass, created_at) VALUES (?, ?, ?, ?)').run(login, name, hashPassword(password), now());
  return publicUser(findUser(login));
}
const listUsers = () => db.prepare('SELECT * FROM users ORDER BY id').all().map(publicUser);
const findUser = login => db.prepare('SELECT * FROM users WHERE login = ?').get(String(login || ''));
function setPassword(login, password) {
  if (String(password || '').length < 10) throw new Error(_t('Пароль має бути щонайменше 10 символів'));
  const u = findUser(login);
  if (!u) throw new Error(_t('Немає такого користувача'));
  db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPassword(password), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  return true;
}
const deleteUser = login => db.prepare('DELETE FROM users WHERE login = ?').run(String(login || '')).changes > 0;
async function checkLogin(login, password) {
  const u = findUser(login);
  const ok = await verifyPassword(password, u ? u.pass : DUMMY_HASH);
  return ok && u ? u : null;
}
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 90);
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function createSession(userId, ua) {
  const token = crypto.randomBytes(32).toString('base64url');
  const t = now();
  db.prepare('INSERT INTO sessions(token_hash, user_id, created_at, expires_at, last_seen, ua) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sha(token), userId, t, t + SESSION_DAYS * 864e5, t, String(ua || '').slice(0, 200));
  audit(userId, 'login');
  return { token, maxAge: SESSION_DAYS * 86400 };
}
function sessionUser(token) {
  if (!token) return null;
  const h = sha(token);
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(h);
  if (!s) return null;
  const t = now();
  if (s.expires_at < t) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h); return null; }
  if (t - s.last_seen > 3600e3) db.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?').run(t, t + SESSION_DAYS * 864e5, h);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id) || null;
}
const deleteSession = token => { if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token)); };

module.exports = {
  db, DB_PATH, DATA_DIR, httpError, audit,
  getSettings, setSettings, getAll, listFills, listCosts, listCats, getFill, lastFill,
  saveFill, deleteFill, saveCost, deleteCost, saveCat, importFuelio, importBm300, listTopups, saveTopup, deleteTopup,
  outboxPending, outboxDone, outboxFailed, budgetState, requeueAllBudget,
  listReminders, getReminder, saveReminder, deleteReminder, reminderDone, reminderSnooze, addDays,
  listTireSets, listTireEvents, getTireSet, saveTireSet, deleteTireSet, tireMeasure, tireSwap, updateTireEvent, deleteTireEvent,
  washAdd, hookSeen, hookRecord, exportJson, exportCsv, backupTo,
  addUser, listUsers, findUser, setPassword, deleteUser, checkLogin, verifyPassword, publicUser,
  createSession, sessionUser, deleteSession
};
