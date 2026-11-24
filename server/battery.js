'use strict';
const I18N = require('../public/i18n.js');
const _t = I18N.t;
/* Акумулятор за даними BM300 (ручні місячні експорти → «останній замір» може бути тижневої давнини).
   Рахується при читанні, важке — SQL-агрегатами; нічні медіани й епізоди — по відфільтрованих вибірках. */
const D = require('./db');
const E = require('./engine');
const SV = require('./service');

const DAY = 864e5;
const r2 = n => Math.round(n * 100) / 100;
const dayNum = d => Math.floor(Date.parse(String(d).slice(0, 10) + 'T12:00:00Z') / DAY);
const tMs = t => Date.parse(t.replace(' ', 'T') + ':00Z');
const msT = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const median = a => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const REST_OK = 12.5, REST_LOW = 12.2;      // В на стоянці
const DEEP_V = 11.8, DEEP_MIN = 30;         // глибокий розряд: < 11,8 В щонайменше 30 хв поспіль
const CHG_LOW = 13.6, CHG_HIGH = 15.0;      // норма зарядки під час руху
const CRANK_LOW = 9.6;                      // слабкий пуск
const SHORT_TRIP = 10;                      // хв
const AFTER_OFF = 30 * 6e4;                 // після зупинки двигуна напруга ще «поверхнева» — не рахуємо як стоянку

function restHealth(v) {
  if (v == null) return null;
  if (v >= REST_OK) return { level: 'ok', text: _t('норма') };
  if (v >= REST_LOW) return { level: 'warn', text: _t('заряд неповний') };
  return { level: 'bad', text: _t('акумулятор розряджається на стоянці') };
}

const LO = '0000-00-00 00:00', HI = '9999-99-99 99:99';

// медіана напруги за ніч 02:00–05:00, коли двигун вимкнений (≥ 10 замірів), за зростанням дати
function restNights(db, inTrip, lo, hi) {
  const nights = {};
  for (const r of db.prepare("SELECT t, v FROM bat_samples WHERE t >= ? AND t < ? AND substr(t, 12, 5) >= '02:00' AND substr(t, 12, 5) < '05:00' ORDER BY t").iterate(lo, hi)) {
    if (inTrip(tMs(r.t), AFTER_OFF)) continue;
    (nights[r.t.slice(0, 10)] || (nights[r.t.slice(0, 10)] = [])).push(r.v);
  }
  return Object.entries(nights).filter(([, a]) => a.length >= 10).map(([d, a]) => ({ d, v: median(a) })).sort((a, b) => (a.d < b.d ? -1 : 1));
}

// індекс поїздок: «чи був двигун увімкнений у момент ms» (перекриття злиті, бінарний пошук)
function tripIndex(db) {
  const trips = db.prepare('SELECT start, "end" AS fin, minutes FROM bat_trips ORDER BY start').all()
    .map(x => ({ s: tMs(x.start), e: tMs(x.fin), minutes: x.minutes, start: x.start, end: x.fin }));
  const spans = [];
  for (const x of trips) {
    const last = spans[spans.length - 1];
    if (last && x.s <= last.e) last.e = Math.max(last.e, x.e); else spans.push({ s: x.s, e: x.e });
  }
  const inTrip = (ms, pad = 0) => {
    let lo = 0, hi = spans.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (ms < spans[m].s) hi = m - 1; else if (ms > spans[m].e + pad) lo = m + 1; else return true;
    }
    return false;
  };
  return { trips, inTrip };
}

// Аналіз одного вікна часу [lo, hi): напруга спокою, глибокі розряди, зарядка в русі, пуски
function analyze(db, trips, inTrip, lo, hi, latestT) {
  const res = {};
  const cnt = db.prepare('SELECT COUNT(*) n, MIN(t) a, MAX(t) b, COUNT(DISTINCT substr(t, 1, 10)) days FROM bat_samples WHERE t >= ? AND t < ?').get(lo, hi);
  res.range = cnt.n ? { from: cnt.a, to: cnt.b, days: cnt.days } : null;

  // напруга спокою: медіана за ніч 02:00–05:00, коли двигун вимкнений
  const nightMed = restNights(db, inTrip, lo, hi);
  const byMonth = {};
  nightMed.forEach(n => { (byMonth[n.d.slice(0, 7)] || (byMonth[n.d.slice(0, 7)] = [])).push(n.v); });
  const cur = median(nightMed.slice(-14).map(n => n.v));
  res.rest = {
    nights: nightMed.length, current: cur == null ? null : r2(cur), health: restHealth(cur),
    months: Object.entries(byMonth).map(([m, a]) => ({ month: m, v: r2(a.reduce((x, y) => x + y, 0) / a.length), nights: a.length }))
  };

  // глибокі розряди: V < 11,8 В ≥ 30 хв поспіль без двигуна
  const eps = [];
  let ep = null;
  for (const r of db.prepare('SELECT t, v, soc FROM bat_samples WHERE v < ? AND t >= ? AND t < ? ORDER BY t').iterate(DEEP_V, lo, hi)) {
    const ms = tMs(r.t);
    if (inTrip(ms)) { ep = null; continue; }
    if (ep && ms - ep.last <= 6 * 6e4) { ep.last = ms; ep.to = r.t; ep.minV = Math.min(ep.minV, r.v); ep.minSoc = Math.min(ep.minSoc, r.soc ?? 100); }
    else { ep = { from: r.t, to: r.t, last: ms, first: ms, minV: r.v, minSoc: r.soc ?? 100 }; eps.push(ep); }
  }
  res.discharges = eps.filter(e => e.last - e.first >= DEEP_MIN * 6e4)
    .map(e => ({ from: e.from, to: e.to, minutes: Math.round((e.last - e.first) / 6e4), minV: e.minV, minSoc: e.minSoc })).reverse();

  // найнижчий окремий замір (разові провали на 1–2 заміри в епізоди не потрапляють)
  res.lowest = Object.assign({}, db.prepare('SELECT t, v, soc FROM bat_samples WHERE t >= ? AND t < ? ORDER BY v, t LIMIT 1').get(lo, hi));
  if (!res.lowest.t) res.lowest = null;

  // зарядка під час руху: медіана V у поїздках ≥ 6 хв, без перших 3 хв
  const q = db.prepare('SELECT v FROM bat_samples WHERE t >= ? AND t <= ?');
  const all = [], recentV = [], chgMonths = {};
  const recentFrom = latestT ? msT(tMs(latestT) - 90 * DAY) : LO;
  for (const x of trips) {
    if (x.minutes < 6 || x.start < lo || x.start >= hi) continue;
    const vs = q.all(msT(x.s + 3 * 6e4), x.end).map(r => r.v);
    if (!vs.length) continue;
    all.push(...vs);
    (chgMonths[x.start.slice(0, 7)] || (chgMonths[x.start.slice(0, 7)] = [])).push(...vs);
    if (x.start >= recentFrom) recentV.push(...vs);
  }
  const medAll = median(all), medRecent = recentV.length >= 10 ? median(recentV) : medAll;
  res.charging = {
    samples: all.length, median: medAll == null ? null : r2(medAll), recent: medRecent == null ? null : r2(medRecent),
    months: Object.entries(chgMonths).map(([m, a]) => ({ month: m, v: r2(median(a)) })),
    verdict: medRecent == null ? null : medRecent < CHG_LOW ? { level: 'bad', text: _t('перевірити генератор: зарядка нижча за 13,6 В') }
      : medRecent > CHG_HIGH ? { level: 'bad', text: _t('перевірити генератор: зарядка вища за 15,0 В') } : { level: 'ok', text: _t('зарядка в нормі') }
  };

  // пуски
  res.cranking = {
    total: db.prepare('SELECT COUNT(*) n FROM bat_cranks WHERE t >= ? AND t < ?').get(lo, hi).n,
    last: db.prepare('SELECT t, v, ms, status FROM bat_cranks WHERE t >= ? AND t < ? ORDER BY t DESC LIMIT 10').all(lo, hi).map(r => Object.assign({ weak: r.v != null && r.v < CRANK_LOW }, r)),
    months: db.prepare("SELECT substr(t, 1, 7) month, ROUND(AVG(v), 2) v, COUNT(*) n FROM bat_cranks WHERE v IS NOT NULL AND t >= ? AND t < ? GROUP BY month ORDER BY month").all(lo, hi).map(r => Object.assign({}, r)),
    weak: db.prepare('SELECT COUNT(*) n FROM bat_cranks WHERE v < ? AND t >= ? AND t < ?').get(CRANK_LOW, lo, hi).n
  };
  return res;
}

const monthsBetween = (a, b) => { const x = a.slice(0, 10).split('-').map(Number), y = b.slice(0, 10).split('-').map(Number); return Math.max(0, (y[0] - x[0]) * 12 + y[1] - x[1] - (y[2] < x[2] ? 1 : 0)); };

// Мотогодини (engine.js): виміряні за bat_trips, середня швидкість із заправок, оцінка за весь час
function engineHours(today) {
  const all = D.getAll();
  const model = E.buildEngine(E.loadTrips(D.db), all.fills);
  const odo = SV.odometer(all, today, model);
  return E.engineSummary(model, today, odo.est || odo.known, odo.perDay);
}

// opts.installed / opts.model — перекривають налаштування (для тестів)
function batterySummary(today, opts = {}) {
  const db = D.db;
  const st = D.getSettings();
  const installed = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(opts.installed ?? st.batteryInstalled) ? (opts.installed ?? st.batteryInstalled) : '';
  const model = opts.model ?? st.batteryModel ?? '';
  const cnt = db.prepare('SELECT COUNT(*) n, MIN(t) a, MAX(t) b, COUNT(DISTINCT substr(t, 1, 10)) days FROM bat_samples').get();
  const nTrips = db.prepare('SELECT COUNT(*) n FROM bat_trips').get().n;
  const nCranks = db.prepare('SELECT COUNT(*) n FROM bat_cranks').get().n;
  if (!cnt.n && !nTrips && !nCranks) return { has: false, installed, model };

  const out = { has: true, samples: cnt.n, range: { from: cnt.a, to: cnt.b, days: cnt.days }, latest: null, ageDays: null, installed, model };
  const { trips, inTrip } = tripIndex(db);

  const split = installed ? (installed.length > 10 ? installed : installed + ' 00:00') : LO;
  if (cnt.n) {
    out.latest = Object.assign({}, db.prepare('SELECT t, v, soc, temp FROM bat_samples ORDER BY t DESC LIMIT 1').get());
    out.ageDays = Math.max(0, dayNum(today || out.latest.t.slice(0, 10)) - dayNum(out.latest.t));
    // по днях, останні 90 днів даних (лише поточний акумулятор)
    const from90 = new Date(dayNum(out.latest.t) * DAY - 89 * DAY).toISOString().slice(0, 10);
    out.daily = db.prepare(`SELECT substr(t, 1, 10) d, MIN(v) minV, MAX(v) maxV, MIN(soc) minSoc FROM bat_samples
      WHERE t >= ? AND t >= ? GROUP BY d ORDER BY d`).all(from90, split).map(r => Object.assign({}, r));
  }
  Object.assign(out, analyze(db, trips, inTrip, split, HI, out.latest && out.latest.t));
  if (installed) {
    const prev = analyze(db, trips, inTrip, LO, split, out.latest && out.latest.t);
    if (prev.range || prev.cranking.total) out.previous = prev;
    const ref = today || (out.latest ? out.latest.t.slice(0, 10) : installed);
    out.install = { date: installed.slice(0, 10), model, months: monthsBetween(installed, ref), cost: null };
    // витрата на акумулятор у дні встановлення (±3 дні)
    const cm = {}; D.listCats().forEach(c => { cm[c.id] = c.name; });
    const d0 = dayNum(installed.slice(0, 10));
    const hit = D.listCosts().filter(c => Math.abs(dayNum(c.date) - d0) <= 3 && /акум|batter/i.test([c.title, c.note, cm[c.cat] || ''].join(' ')))
      .sort((a, b) => Math.abs(dayNum(a.date) - d0) - Math.abs(dayNum(b.date) - d0))[0];
    if (hit) out.install.cost = { id: hit.id, title: hit.title, amount: hit.amount, date: hit.date.slice(0, 10) };
  }

  // поїздки по місяцях
  out.trips = {
    total: nTrips,
    months: db.prepare(`SELECT substr(start, 1, 7) month, COUNT(*) n, SUM(minutes) minutes, SUM(minutes < ?) short FROM bat_trips GROUP BY month ORDER BY month`)
      .all(SHORT_TRIP).map(r => ({ month: r.month, n: r.n, minutes: r.minutes, short: r.short, shortShare: r.n ? Math.round(r.short / r.n * 100) : 0 }))
  };
  const tt = out.trips.months.reduce((a, m) => ({ n: a.n + m.n, short: a.short + m.short, minutes: a.minutes + m.minutes }), { n: 0, short: 0, minutes: 0 });
  out.trips.shortShare = tt.n ? Math.round(tt.short / tt.n * 100) : 0;
  out.trips.minutes = tt.minutes;
  out.engine = engineHours(today || (out.latest ? out.latest.t.slice(0, 10) : new Date().toLocaleDateString('sv-SE')));
  return out;
}

/* Стан акумулятора для сповіщень (лише поточний акумулятор, після batteryInstalled):
   rest  — ≥ 5 з 7 останніх виміряних ночей напруга спокою < 12,4 В (стабільний недозаряд);
   crank — ≥ 3 з 10 останніх пусків < 9,6 В (акумулятор слабне). Повертає null, якщо даних немає. */
const ALERT_REST_V = 12.4, ALERT_NIGHTS = 7, ALERT_NIGHTS_LOW = 5;
const ALERT_CRANKS = 10, ALERT_CRANKS_WEAK = 3;
function batteryHealth() {
  const db = D.db;
  const st = D.getSettings();
  const inst = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(st.batteryInstalled || '') ? st.batteryInstalled : '';
  const split = inst ? (inst.length > 10 ? inst : inst + ' 00:00') : LO;
  const out = { rest: null, crank: null };
  const { inTrip } = tripIndex(db);
  const nights = restNights(db, inTrip, split, HI).slice(-ALERT_NIGHTS);
  if (nights.length >= ALERT_NIGHTS_LOW) {
    const low = nights.filter(n => n.v < ALERT_REST_V);
    out.rest = { nights: nights.length, low: low.length, median: r2(median(nights.map(n => n.v))), min: r2(Math.min(...nights.map(n => n.v))),
      from: nights[0].d, last: nights[nights.length - 1].d, alert: low.length >= ALERT_NIGHTS_LOW };
  }
  const cr = db.prepare('SELECT t, v FROM bat_cranks WHERE v IS NOT NULL AND t >= ? ORDER BY t DESC LIMIT ?').all(split, ALERT_CRANKS);
  if (cr.length >= 5) {
    const weak = cr.filter(c => c.v < CRANK_LOW);
    const minC = cr.reduce((a, c) => (c.v < a.v ? c : a));
    out.crank = { cranks: cr.length, weak: weak.length, min: minC.v, minT: minC.t, last: cr[0].t, alert: weak.length >= ALERT_CRANKS_WEAK };
  }
  return out;
}

module.exports = { engineHours, batterySummary, batteryHealth, restHealth, median, ALERT_REST_V, CRANK_LOW };
