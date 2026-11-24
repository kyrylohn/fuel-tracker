'use strict';
/* Мотогодини за даними BM300 (bat_trips: інтервали, коли двигун був увімкнений).
   Чисті функції: модель будується з масивів поїздок і заправок, БД читає лише loadTrips().
   Середня швидкість = км між заправками / мотогодини між ними (лише пари, що повністю в зоні покриття).
   Усе, що виходить за покриття, — оцінка (estimated: true). */
const DAY = 864e5, MIN = 6e4;
const MIN_ENGINE_MIN = 120;       // менше 2 год двигуна — швидкість не рахуємо
const MAX_GAP_DAYS = 10;          // «дірка» між поїздками всередині пари = пропущений звіт, пару відкидаємо
const stamp = t => (String(t).length > 10 ? String(t).slice(0, 16) : String(t).slice(0, 10) + ' 12:00');
const tm = t => Date.parse(stamp(t).replace(' ', 'T') + ':00Z');
const r1 = n => Math.round(n * 10) / 10;

function loadTrips(db) {
  return db.prepare('SELECT start, "end" AS fin, minutes FROM bat_trips ORDER BY start').all().map(x => ({ start: x.start, end: x.fin, minutes: x.minutes }));
}

// Хвилини двигуна в [a, b) (мс); поїздка, що перетинає межу, береться пропорційно
function minutesIn(trips, a, b) {
  let sum = 0;
  for (const x of trips) {
    if (x.e <= a || x.s >= b) continue;
    const len = x.e - x.s, ov = Math.min(x.e, b) - Math.max(x.s, a);
    sum += len > 0 ? x.minutes * ov / len : 0;
  }
  return sum;
}
function maxGapDays(trips, a, b) {
  let prev = a, gap = 0;
  for (const x of trips) {
    if (x.e <= a) continue;
    if (x.s >= b) break;
    gap = Math.max(gap, x.s - prev);
    prev = Math.max(prev, x.e);
  }
  return Math.max(gap, b - prev) / DAY;
}

function buildEngine(rawTrips, fills) {
  const trips = (rawTrips || []).map(x => ({ s: tm(x.start), e: tm(x.end), minutes: +x.minutes || 0, start: x.start, end: x.end }))
    .filter(x => x.e >= x.s).sort((a, b) => a.s - b.s);
  const m = { trips, has: trips.length > 0, cov: null, measuredMin: 0, avgSpeed: null, pairs: [], pairKm: 0, pairMin: 0 };
  if (!trips.length) return m;
  m.cov = { s: trips[0].s, e: trips.reduce((a, x) => Math.max(a, x.e), 0), from: trips[0].start, to: trips.reduce((a, x) => (tm(x.end) >= tm(a) ? x.end : a), trips[0].end) };
  m.measuredMin = trips.reduce((a, x) => a + x.minutes, 0);
  const fs = (fills || []).filter(f => f && f.status !== 'deleted' && f.status !== 'draft' && f.odo > 0 && f.date)
    .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.odo - b.odo);
  for (let i = 1; i < fs.length; i++) {
    const a = fs[i - 1], b = fs[i], km = b.odo - a.odo, sa = tm(a.date), sb = tm(b.date);
    if (km <= 0 || sa < m.cov.s || sb > m.cov.e || sb <= sa) continue;
    if (maxGapDays(trips, sa, sb) > MAX_GAP_DAYS) continue;
    const min = Math.round(minutesIn(trips, sa, sb));
    if (min <= 0) continue;
    m.pairs.push({ from: stamp(a.date), to: stamp(b.date), fromOdo: a.odo, toOdo: b.odo, km, minutes: min, speed: r1(km / (min / 60)) });
  }
  m.pairKm = m.pairs.reduce((s, p) => s + p.km, 0);
  m.pairMin = m.pairs.reduce((s, p) => s + p.minutes, 0);
  if (m.pairMin >= MIN_ENGINE_MIN && m.pairKm > 0) m.avgSpeed = m.pairKm / (m.pairMin / 60);
  return m;
}

/* Мотохвилини між двома моментами 'YYYY-MM-DD[ HH:MM]'.
   Виміряне — з bat_trips; частина діапазону поза покриттям екстраполюється (потрібна середня швидкість):
   opts.kmTotal (км за весь діапазон, якщо відомі за одометром) → решта км / швидкість;
   інакше opts.perDay × дні поза покриттям / швидкість. */
function engineMinutesBetween(model, from, to, opts = {}) {
  const a = tm(from), b = tm(to);
  const out = { minutes: 0, measuredMin: 0, estimatedMin: 0, km: null, estimated: false, uncoveredDays: 0 };
  if (!model || !model.has || !(b > a)) return out;
  const measured = minutesIn(model.trips, a, b);
  const cs = Math.max(a, model.cov.s), ce = Math.min(b, model.cov.e);
  const covered = Math.max(0, ce - cs);
  const unc = (b - a) - covered;
  out.measuredMin = Math.round(measured);
  out.uncoveredDays = Math.round(unc / DAY * 10) / 10;
  let est = 0;
  if (unc > 0 && model.avgSpeed) {
    let km = null;
    if (opts.kmTotal > 0) km = Math.max(0, opts.kmTotal - measured * model.avgSpeed / 60);
    else if (opts.perDay > 0) km = opts.perDay * unc / DAY;
    if (km !== null) est = km / model.avgSpeed * 60;
    // є непокритий час, але оцінити його нічим — результат лише виміряна частина, без позначки «≈»
  }
  out.estimatedMin = Math.round(est);
  out.estimated = est > 0;
  out.minutes = Math.round(measured + est);
  if (model.avgSpeed) out.km = Math.round(out.minutes / 60 * model.avgSpeed);
  return out;
}

// Зведення для /api/battery
function engineSummary(model, today, odoNow, perDay) {
  const out = { has: model.has, measuredMin: Math.round(model.measuredMin), range: null, months: [], avgSpeed: null, pairs: [], lifetime: null, sinceLatestUpload: null };
  if (!model.has) return out;
  out.range = { from: model.cov.from, to: model.cov.to, days: Math.max(1, Math.round((model.cov.e - model.cov.s) / DAY)) };
  const mm = {};
  for (const x of model.trips) { const k = x.start.slice(0, 7); (mm[k] || (mm[k] = { month: k, minutes: 0, trips: 0 })); mm[k].minutes += x.minutes; mm[k].trips++; }
  out.months = Object.values(mm).sort((a, b) => (a.month < b.month ? -1 : 1));
  if (model.avgSpeed) {
    out.avgSpeed = r1(model.avgSpeed);
    out.pairs = model.pairs;
    out.pairTotals = { km: model.pairKm, minutes: model.pairMin };
    if (odoNow > 0) {
      out.lifetime = { hours: Math.round(odoNow / model.avgSpeed), odo: odoNow, estimated: true };
    }
  }
  const todayMs = tm(today);
  if (todayMs > model.cov.e) {
    const days = Math.round((todayMs - model.cov.e) / DAY);
    out.sinceLatestUpload = { from: model.cov.to, days, unknown: true,
      estimatedMin: model.avgSpeed && perDay > 0 ? Math.round(perDay * days / model.avgSpeed * 60) : null };
  }
  return out;
}

module.exports = { stamp, loadTrips, buildEngine, engineMinutesBetween, engineSummary, minutesIn, MIN_ENGINE_MIN };
