'use strict';
const I18N = require('../public/i18n.js');
const _t = I18N.t;
/* Сервіс: стан регламентних робіт, шин і сповіщення для Home Assistant.
   - Поточний пробіг оцінюється: останній відомий (заправки, витрати, заміри шин) + середній денний пробіг × дні.
   - Нагадування: за пробігом (every_km від last_odo) і/або часом (every_days від last_date чи дата due_date).
   - Шини: знос за замірами (мм на 1000 км) → прогноз, скільки км до порога; вік за DOT.
   - Сезон: прогноз Open-Meteo для дому (правило +7 °C — середньодобова нижче → зимові), без прогнозу — календар.
   compute() — чиста функція (тести), погода кешується в meta. */
const D = require('./db');
const C = require('../public/calc.js');
const E = require('./engine');

const DAY = 864e5;
const dayNum = d => Math.floor(Date.parse(String(d).slice(0, 10) + 'T12:00:00Z') / DAY);
const r1 = n => Math.round(n * 10) / 10;
// назви сезонів — геттери, щоб переклад визначався мовою на момент виклику, а не при завантаженні модуля
const SEASON = { get summer() { return _t('літні'); }, get winter() { return _t('зимові'); }, get all() { return _t('всесезонні'); } };
const SEASON_GEN = { get summer() { return _t('літніх'); }, get winter() { return _t('зимових'); }, get all() { return _t('всесезонних'); } };

/* ---------- пробіг ---------- */
// engine — модель мотогодин (engine.js): якщо поїздки BM300 покривають час після останнього запису,
// цей відрізок рахуємо за мотогодини × середня швидкість, а км/день — лише для днів поза покриттям
function odometer(all, today, engine) {
  const pts = [];
  C.ordered(all.fills).forEach(f => pts.push({ d: f.date.slice(0, 10), t: f.date, odo: f.odo }));
  (all.costs || []).forEach(c => { if (c.odo > 0) pts.push({ d: c.date.slice(0, 10), t: c.date, odo: c.odo }); });
  (all.tireEvents || []).forEach(e => { if (e.odo > 0) pts.push({ d: e.date.slice(0, 10), t: e.date, odo: e.odo }); });
  (all.reminders || []).forEach(r => { if (r.last_odo > 0 && r.last_date) pts.push({ d: r.last_date.slice(0, 10), t: r.last_date, odo: r.last_odo }); });
  if (!pts.length) return { known: 0, date: null, est: 0, perDay: 0, method: 'none' };
  const last = pts.reduce((a, p) => (p.odo > a.odo ? p : a));
  // денний пробіг — за останні ~120 днів заправок (або за всю історію, якщо коротша)
  const fs = C.ordered(all.fills);
  let perDay = 0;
  if (fs.length > 1) {
    const end = fs[fs.length - 1];
    const start = fs.find(f => dayNum(end.date) - dayNum(f.date) <= 120 && f !== end) || fs[0];
    const days = dayNum(end.date) - dayNum(start.date);
    if (days > 0) perDay = (end.odo - start.odo) / days;
  }
  perDay = Math.max(0, Math.min(perDay, 300));
  const gap = Math.max(0, Math.min(dayNum(today) - dayNum(last.d), 120)); // далі 120 днів не екстраполюємо
  const old = { known: last.odo, date: last.d, est: Math.round(last.odo + perDay * gap), perDay: r1(perDay), method: 'perDay' };
  if (!engine || !engine.has || !engine.avgSpeed) return old;
  const a = E.stamp(last.t), b = today + ' 12:00';
  const cov = E.engineMinutesBetween(engine, a, b);   // лише виміряне
  if (!(cov.measuredMin > 0)) return old;
  const unc = Math.max(0, Math.min(cov.uncoveredDays, 120));
  const engineKm = cov.measuredMin * engine.avgSpeed / 60;
  return { known: last.odo, date: last.d, est: Math.round(last.odo + engineKm + perDay * unc), perDay: r1(perDay), method: 'engine',
    engineMin: cov.measuredMin, engineKm: Math.round(engineKm), extraDays: unc };
}

/* ---------- нагадування ---------- */
const soonHours = r => (r.every_hours > 0 ? r.every_hours * 0.1 : 0);
const soonKmOf = r => (r.every_km ? Math.max(500, Math.min(1500, r.every_km * 0.1)) : 0);
// eg — результат reminderEngine (мотохвилини від last_date); без даних BM300 його немає й години ігноруються
function reminderStatus(r, odoNow, today, perDay, eg) {
  const o = { id: r.id, kmLeft: null, daysLeft: null, hoursLeft: null, dueOdo: null, dueDate: null, level: 'unknown', progress: 0 };
  if (!r.active) { o.level = 'off'; return o; }
  if (r.every_km && r.last_odo > 0) { o.dueOdo = r.last_odo + r.every_km; o.kmLeft = Math.round(o.dueOdo - odoNow); }
  if (r.due_date) o.dueDate = r.due_date;
  else if (r.every_days && r.last_date) o.dueDate = D.addDays(r.last_date, r.every_days);
  if (o.dueDate) o.daysLeft = dayNum(o.dueDate) - dayNum(today);
  if (r.every_hours > 0 && eg && eg.minutes >= 0) {
    o.hoursUsed = Math.round(eg.minutes / 60); o.hoursEstimated = !!eg.estimated; o.dueHours = r.every_hours;
    o.hoursLeft = Math.round(r.every_hours - eg.minutes / 60);
  }
  if (o.kmLeft === null && o.daysLeft === null && o.hoursLeft === null) return o;
  const fr = [];
  if (o.kmLeft !== null) fr.push(1 - o.kmLeft / r.every_km);
  if (o.daysLeft !== null) fr.push(1 - o.daysLeft / (r.every_days || 365));
  if (o.hoursLeft !== null) fr.push(1 - o.hoursLeft / r.every_hours);
  o.progress = Math.max(0, Math.min(1, Math.max.apply(null, fr)));
  const soonKm = r.every_km ? Math.max(500, Math.min(1500, r.every_km * 0.1)) : 0;
  const due = (o.kmLeft !== null && o.kmLeft <= 0) || (o.daysLeft !== null && o.daysLeft <= 0) || (o.hoursLeft !== null && o.hoursLeft <= 0);
  const soon = (o.kmLeft !== null && o.kmLeft <= soonKm) || (o.daysLeft !== null && o.daysLeft <= (r.kind === 'insurance' ? 14 : 30)) || (o.hoursLeft !== null && o.hoursLeft <= soonHours(r));
  o.level = due ? 'due' : soon ? 'soon' : 'ok';
  // орієнтовна дата за пробігом (для «≈ через 2 міс.»)
  if (r.snooze_until && r.snooze_until > today && (o.level === 'due' || o.level === 'soon')) {
    if (o.level === 'due') o.level = 'soon';
    o.snoozed = r.snooze_until;
    o.snoozedText = _t('відкладено до {today}', { today: shortDay(r.snooze_until, today) });
  }
  if (o.kmLeft !== null && perDay > 0) o.kmDays = Math.round(o.kmLeft / perDay);
  return o;
}

// Скільки двигун пропрацював від останнього виконання (лише інформація, без впливу на строки)
function reminderEngine(engine, r, odoNow, today, perDay) {
  if (!engine || !engine.has || !r.active || r.kind === 'insurance' || !r.last_date) return null;
  const kmTotal = r.last_odo > 0 && odoNow > r.last_odo ? odoNow - r.last_odo : 0;
  const e = E.engineMinutesBetween(engine, r.last_date, today + ' 12:00', { kmTotal, perDay });
  return { minutes: e.minutes, measuredMin: e.measuredMin, estimated: e.estimated, km: e.km, avgSpeed: engine.avgSpeed ? Math.round(engine.avgSpeed * 10) / 10 : null };
}

/* ---------- шини ---------- */
const WHEELS = ['fl', 'fr', 'rl', 'rr'];
function minDepth(e) { const v = WHEELS.map(k => e[k]).filter(x => x !== null && x !== undefined); return v.length ? Math.min.apply(null, v) : null; }
function dotYear(dot) {
  const s = String(dot || '');
  if (/^\d{4}$/.test(s)) { const y = +s; if (y >= 1990 && y <= 2100) return y; return 2000 + +s.slice(2); } // РРРР або ТТРР (тиждень+рік)
  if (/^\d{2}$/.test(s)) return 2000 + +s;
  return null;
}
function tireSetStatus(set, events, odoNow, today, warn) {
  const ev = events.filter(e => e.set_id === set.id).sort((a, b) => a.date.localeCompare(b.date) || a.created_at - b.created_at);
  // пробіг на комплекті: суми відрізків «поставили → зняли» (+ поточний, якщо стоїть)
  let km = 0, mountedOdo = null, mountedDate = null;
  for (const e of ev) {
    if (e.kind === 'mount') { mountedOdo = e.odo; mountedDate = e.date.slice(0, 10); }
    if (e.kind === 'unmount' && mountedOdo !== null) { km += Math.max(0, e.odo - mountedOdo); mountedOdo = null; }
  }
  if (set.mounted && mountedOdo !== null && mountedOdo > 0) km += Math.max(0, odoNow - mountedOdo);
  const measures = ev.filter(e => e.kind === 'measure' && minDepth(e) !== null);
  const last = measures[measures.length - 1] || null;
  const depth = last ? minDepth(last) : null;
  // знос: мм на 1000 км між першим і останнім заміром (≥1500 км), або від нового протектора, якщо відомий пробіг до заміру
  let rate = null;
  if (measures.length >= 2) {
    const a = measures[0], b = last, dk = b.odo - a.odo;
    if (dk >= 1500 && minDepth(a) > depth) rate = (minDepth(a) - depth) / dk * 1000;
  }
  const kmLeft = depth !== null && rate > 0 ? Math.max(0, Math.round((depth - warn) / rate * 1000)) : null;
  const year = dotYear(set.dot);
  const age = year ? +today.slice(0, 4) - year : null;
  const measuredDays = last ? dayNum(today) - dayNum(last.date) : null;
  let level = 'ok';
  const why = [];
  if (depth !== null && depth < 1.6) { level = 'due'; why.push(_t('протектор {depth} мм — менше 1,6 мм за ПДР', { depth: fmtN(depth) })); }
  else if (depth !== null && depth < warn) { level = 'due'; why.push(_t('протектор {depth} мм (поріг {warn} мм)', { depth: fmtN(depth), warn: fmtN(warn) })); }
  else if (depth !== null && depth < warn + 1) { level = 'soon'; why.push(_t('протектор {depth} мм — до порога лишилось ~1 мм', { depth: fmtN(depth) })); }
  if (age !== null && age >= 8) { level = 'due'; why.push(_t('шинам {age} р. — гума задубіла', { age })); }
  else if (age !== null && age >= 6 && level === 'ok') { level = 'soon'; why.push(_t('шинам {age} р.', { age })); }
  return {
    id: set.id, km: Math.round(km), mountedDate, depth, last: last ? { date: last.date.slice(0, 10), odo: last.odo, fl: last.fl, fr: last.fr, rl: last.rl, rr: last.rr } : null,
    rate: rate ? Math.round(rate * 100) / 100 : null, kmLeft, age, year, warn, measuredDays, level, why,
    wear: depth !== null && set.new_depth > warn ? Math.max(0, Math.min(1, (set.new_depth - depth) / (set.new_depth - warn))) : null
  };
}
const plural = I18N.plural;
const fmtN = n => String(Math.round(n * 10) / 10).replace('.', ',');
const fmtV = n => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');

/* ---------- сезон ---------- */
// Які шини потрібні зараз — за стабільними НІЧНИМИ температурами (lo) на тиждень уперед:
// осінь (вер–гру): зимові, коли ≥4 з 7 ночей нижче 0 °C (або грудень); весна (бер–трав): літні, коли всі ночі
// (2 минулі + 7 прогнозних) вище 0 °C. Гістерезис: якщо вже стоїть зимова восени / літня навесні — не повертаємось.
function seasonNeed(today, weather, mountedSeason) {
  const m = +today.slice(5, 7);
  const cal = m >= 11 || m <= 3 ? 'winter' : 'summer';
  const base = need => ({ need, source: 'calendar' });
  if (m >= 6 && m <= 8) return base('summer');
  if (m <= 2) return base('winter');
  if (!weather || !weather.days || !weather.days.length || dayNum(today) - dayNum(weather.days[0].d) > 10) return base(cal);
  const ok = x => typeof x.lo === 'number';
  const next = weather.days.filter(x => x.d >= today && ok(x)).slice(0, 7);
  const past = weather.days.filter(x => x.d < today && ok(x)).slice(-2);
  if (next.length < 3) return base(cal);
  const frostNights = next.filter(x => x.lo < 0).length;
  const warmNights = next.filter(x => x.lo > 0).length;
  const pastWarm = past.every(x => x.lo > 0);
  const los = next.map(x => x.lo);
  const info = { source: 'forecast', frostNights, warmNights, nightMin: Math.min.apply(null, los), nightMax: Math.max.apply(null, los), days: next.length, soon: false };
  const autumn = m >= 9, spring = m >= 3 && m <= 5;
  if (autumn) {
    let need = frostNights >= 4 || m === 12 ? 'winter' : 'summer';
    if (mountedSeason === 'winter') need = 'winter';
    info.soon = mountedSeason === 'summer' && need === 'summer' && frostNights >= 1 && frostNights <= 3;
    return Object.assign({ need }, info);
  }
  if (spring) {
    const stable = pastWarm && warmNights === next.length && next.length >= 5;
    let need = stable ? 'summer' : 'winter';
    if (mountedSeason === 'summer') need = 'summer';
    info.soon = mountedSeason === 'winter' && need === 'winter' && warmNights >= 5;
    return Object.assign({ need }, info);
  }
  return Object.assign({ need: cal }, info);
}

/* ---------- тексти нагадувань ---------- */
function periodWord(days) {
  if (days && days % 365 === 0) { const y = days / 365; return y === 1 ? _t('рік') : y < 5 ? _t('{y} роки', { y }) : _t('{y} років', { y }); }
  return fmtDays(days);
}
// Людська причина: що саме спрацювало (час чи пробіг) і що з іншим
function reminderText(r, st, today) {
  const ins = r.kind === 'insurance';
  const due = st.level === 'due';
  const timeLeft = st.daysLeft !== null ? st.daysLeft : null;
  const timeFired = timeLeft !== null && (due ? timeLeft <= 0 : timeLeft <= (ins ? 14 : 30));
  const hrsTrig = st.hoursLeft !== null && (due ? st.hoursLeft <= 0 : st.hoursLeft <= soonHours(r));
  const kmTrig = st.kmLeft !== null && (due ? st.kmLeft <= 0 : st.kmLeft <= soonKmOf(r));
  const kmFired = st.kmLeft !== null && (due ? st.kmLeft <= 0 : true) && !timeFired && !(hrsTrig && !kmTrig);
  const hoursFired = hrsTrig && !timeFired && !kmFired;
  const ap = st.hoursEstimated ? '≈ ' : '';
  const sent = [];
  if (ins) {
    const when = shortDay(st.dueDate, today);
    sent.push(timeLeft < 0 ? _t('Поліс закінчився {when} ({timeLeft} тому) — час продовжити.', { when, timeLeft: fmtDays(-timeLeft) })
      : timeLeft === 0 ? _t('Поліс закінчується сьогодні.') : _t('Поліс закінчується {when} (через {timeLeft}).', { when, timeLeft: fmtDays(timeLeft) }));
  } else if (timeFired) {
    const since = r.last_date && r.every_days ? _t('Минув {every_days} з заміни ({last_date})', { every_days: periodWord(r.every_days), last_date: humanDay(r.last_date) }) : _t('Термін минув {today}', { today: shortDay(st.dueDate, today) });
    if (due) sent.push(`${timeLeft < 0 ? since : _t('Термін настав сьогодні')} ${_t('— пора міняти.')}`);
    else sent.push(_t('До кінця терміну {timeLeft} ({today}).', { timeLeft: fmtDays(timeLeft), today: shortDay(st.dueDate, today) }));
    if (st.kmLeft !== null) sent.push(st.kmLeft <= 0 ? _t('Пробіг теж перевищено на {kmLeft} км.', { kmLeft: fmtK(-st.kmLeft) }) : _t('За пробігом ще ~{kmLeft} км.', { kmLeft: fmtK(st.kmLeft) }));
  } else if (kmFired) {
    sent.push(due ? _t('Пробіг перевищено на {kmLeft} км (ліміт {dueOdo} км) — пора міняти.', { kmLeft: fmtK(-st.kmLeft), dueOdo: fmtK(st.dueOdo) })
      : _t('Пробіг: лишилось ~{kmLeft} км (до {dueOdo} км).', { kmLeft: fmtK(st.kmLeft), dueOdo: fmtK(st.dueOdo) }));
    if (timeLeft !== null && timeLeft > 0) sent.push(_t('За часом ще {timeLeft}.', { timeLeft: fmtDays(timeLeft) }));
  } else if (hoursFired) {
    sent.push(due ? _t('Мотогодин: {ap}{hoursUsed} з {dueHours} — пора міняти.', { ap, hoursUsed: fmtK(st.hoursUsed), dueHours: fmtK(st.dueHours) }) : _t('Мотогодини: лишилось {ap}{hoursLeft} з {dueHours}.', { ap, hoursLeft: fmtK(st.hoursLeft), dueHours: fmtK(st.dueHours) }));
    if (st.kmLeft !== null && st.kmLeft > 0) sent.push(_t('За пробігом ще ~{kmLeft} км.', { kmLeft: fmtK(st.kmLeft) }));
  }
  if (r.last_date && !ins && !timeFired) sent.push(`${_t('Востаннє: {last_date}', { last_date: humanDay(r.last_date) })}${r.last_odo ? _t(', {last_odo} км', { last_odo: fmtK(r.last_odo) }) : ''}.`);
  return { title: _t(r.title), text: sent.join(' ') };
}

/* ---------- усе разом ---------- */
function compute(all, opts) {
  opts = opts || {};
  const today = opts.today || new Date().toLocaleDateString('sv-SE');
  const s = all.settings || {};
  const engine = E.buildEngine(opts.trips !== undefined ? opts.trips : E.loadTrips(D.db), all.fills);
  const odo = odometer(all, today, engine);
  const odoNow = odo.est || odo.known;
  const reminders = {};
  (all.reminders || []).forEach(r => {
    const eg = reminderEngine(engine, r, odoNow, today, odo.perDay);
    reminders[r.id] = reminderStatus(r, odoNow, today, odo.perDay, eg);
    if (eg) reminders[r.id].engine = eg;
  });

  const sets = (all.tireSets || []).filter(x => !x.retired);
  const tires = {};
  sets.forEach(x => { tires[x.id] = tireSetStatus(x, all.tireEvents || [], odoNow, today, x.season === 'winter' ? +s.tireWarnWinter || 4 : +s.tireWarnSummer || 3); });
  const mounted = sets.find(x => x.mounted) || null;
  const season = seasonNeed(today, opts.weather, mounted ? mounted.season : null);

  const alerts = [];
  const week = Math.floor(dayNum(today) / 7); // протерміноване нагадуємо раз на тиждень
  for (const r of all.reminders || []) {
    const st = reminders[r.id];
    if (st.level !== 'due' && st.level !== 'soon') continue;
    if (st.snoozed) continue; // відкладені не нагадуємо
    const { title, text } = reminderText(r, st, today);
    alerts.push({
      id: `r:${r.id}:${st.level}:${r.last_date || r.due_date}${st.level === 'due' ? ':' + week : ''}`, kind: 'reminder', ref: r.id, level: st.level, title, text
    });
  }
  const swapNeeded = mounted && mounted.season !== 'all' && mounted.season !== season.need;
  const fr = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmtN(Math.abs(v));
  const rng = season.source === 'forecast' ? `${fr(season.nightMin)}…${fr(season.nightMax)} °C` : '';
  if (swapNeeded) {
    const target = sets.find(x => x.season === season.need) || sets.find(x => x.season === 'all');
    const why = season.source !== 'forecast' ? (season.need === 'winter' ? _t('Настав зимовий сезон — літня гума твердне й гірше гальмує.') : _t('Настав літній сезон — зимова гума швидко стирається й гірше гальмує.'))
      : season.need === 'winter' ? _t('Ночі стабільно в мінусі: {frostNights} з {days} ночей нижче 0 °C (прогноз {rng}). На літній гумі вранці слизько.', { frostNights: season.frostNights, days: season.days, rng })
        : _t('Ночі стабільно в плюсі (прогноз {rng}) — зимова гума швидко стирається й гірше гальмує.', { rng });
    alerts.push({ id: `t:swap:${season.need}:${today.slice(0, 4)}:${week}`, kind: 'swap', level: 'due',
      title: _t('Час переобутись на {need}', { need: SEASON[season.need] }),
      text: why + (target ? ` ${_t('Ставимо «{name}»', { name: _t(target.name) })}${tires[target.id] && tires[target.id].depth !== null ? ` ${_t('({depth} мм)', { depth: fmtN(tires[target.id].depth) })}` : ''}.` : ` ${_t('Комплекту {need} немає — додайте або купіть.', { need: SEASON_GEN[season.need] })}`) });
  } else if (mounted && mounted.season !== 'all' && season.soon) {
    const nxt = mounted.season === 'summer' ? 'winter' : 'summer';
    const txt = nxt === 'winter' ? _t('У прогнозі {frostNights} {frostNights2} (до {nightMin} °C).', { frostNights: season.frostNights, frostNights2: plural(season.frostNights, 'морозна ніч', 'морозні ночі', 'морозних ночей'), nightMin: fr(season.nightMin) })
      : _t('{warmNights} з {days} ночей у прогнозі вище 0 °C ({rng}), але стабільного тепла ще нема.', { warmNights: season.warmNights, days: season.days, rng });
    alerts.push({ id: `t:swapsoon:${nxt}:${today.slice(0, 4)}:${week}`, kind: 'swap', level: 'soon',
      title: _t('Скоро перевзуватись'), text: txt + _t(' Варто записатись на шиномонтаж.') });
  }
  // купівля: у передсезоння (зимові — з 15 серпня до кінця року, літні — з лютого до травня)
  const md = today.slice(5);
  const buySeason = md >= '08-15' ? 'winter' : md >= '02-01' && md <= '05-31' ? 'summer' : md <= '01-31' ? 'winter' : null;
  if (buySeason && sets.length) { // без жодного комплекту — лише підказка, не push
    const cands = sets.filter(x => x.season === buySeason || x.season === 'all');
    const ok = cands.find(x => tires[x.id].level !== 'due');
    if (!ok) {
      const reasons = cands.length ? cands.map(x => `«${_t(x.name)}»: ${tires[x.id].why.join(', ')}`).join('; ') : _t('комплекту {buySeason} шин немає', { buySeason: SEASON_GEN[buySeason] });
      const early = (buySeason === 'winter' && md < '10-15') || (buySeason === 'summer' && md < '03-15');
      alerts.push({ id: `t:buy:${buySeason}:${today.slice(0, 7)}`, kind: 'buy', level: early ? 'soon' : 'due',
        title: _t('Купити {buySeason} шини цього сезону', { buySeason: SEASON[buySeason] }),
        text: reasons + '.' + (early ? _t(' До сезону ціни нижчі й вибір більший.') : '') + (s.carTireSize ? ` ${_t('Розмір: {carTireSize}.', { carTireSize: s.carTireSize })}` : '') });
    }
  }
  if (mounted && tires[mounted.id].level === 'due' && !alerts.some(a => a.kind === 'buy')) {
    const t = tires[mounted.id];
    alerts.push({ id: `t:worn:${mounted.id}:${t.last ? t.last.date : ''}:${t.age}`, kind: 'worn', level: 'due', title: _t('Шини «{name}» час міняти', { name: _t(mounted.name) }), text: t.why.join(', ') + '.' });
  }
  // звіт BM300: нагадати завантажити, якщо останні дані старші за 30 днів (лише коли імпорт колись був)
  let batLast = opts.batLast;
  if (batLast === undefined) { try { batLast = (D.db.prepare('SELECT MAX(t) t FROM bat_samples').get() || {}).t || null; } catch { batLast = null; } }
  if (batLast) {
    const ago = dayNum(today) - dayNum(batLast.slice(0, 10));
    if (ago >= 30) alerts.push({ id: `b:upload:${batLast.slice(0, 10)}${ago >= 37 ? ':' + week : ''}`, kind: 'bm300', level: ago >= 37 ? 'due' : 'soon',
      title: _t('Завантаж звіт BM300'),
      text: _t('Останні дані акумулятора — {today} ({ago} дн. тому). У BM300: Settings → Export Data, потім у «Баку»: Ще → Імпорт з BM300.', { today: shortDay(batLast.slice(0, 10), today), ago }) });
  }
  // стан акумулятора: стабільно низька напруга спокою, слабкі пуски (на свіжих даних — до 45 дн.)
  let bh = opts.batHealth;
  if (bh === undefined) { try { bh = require('./battery').batteryHealth(); } catch { bh = null; } }
  const fresh = d => d && dayNum(today) - dayNum(d.slice(0, 10)) <= 45;
  if (bh && bh.rest && bh.rest.alert && fresh(bh.rest.last)) {
    const r = bh.rest;
    alerts.push({ id: `b:rest:${r.last}`, kind: 'battery', level: 'due', title: _t('Акумулятор недозаряджений'),
      text: _t('Напруга спокою {low} з {nights} останніх ночей нижче 12,4 В (медіана {median} В, {today} — {today2}). Зарядіть зарядним пристроєм до 100 %; якщо за тиждень знову так — перевірити витік на стоянці й генератор.', { low: r.low, nights: r.nights, median: fmtV(r.median), today: shortDay(r.from, today), today2: shortDay(r.last, today) }) });
  }
  if (bh && bh.crank && bh.crank.alert && fresh(bh.crank.last)) {
    const c = bh.crank;
    alerts.push({ id: `b:crank:${c.last}`, kind: 'battery', level: 'due', title: _t('Слабкі пуски'),
      text: _t('{weak} з {cranks} останніх пусків нижче 9,6 В (найнижчий {min} В, {today}). Зарядіть акумулятор і перевірте його навантажувальною вилкою на СТО — можливо, слабне.', { weak: c.weak, cranks: c.cranks, min: fmtV(c.min), today: shortDay(c.minT.slice(0, 10), today) }) });
  }
  const order = { due: 0, soon: 1 };
  alerts.sort((a, b) => order[a.level] - order[b.level]);

  // поради без push: заміряти протектор
  const hints = [];
  if (mounted) {
    const t = tires[mounted.id];
    if (t.measuredDays === null) hints.push({ kind: 'measure', ref: mounted.id, text: _t('Заміряйте протектор на «{name}» — тоді «Бак» порахує знос і скаже, коли купувати нові.', { name: _t(mounted.name) }) });
    else if (t.measuredDays > 180) hints.push({ kind: 'measure', ref: mounted.id, text: _t('Протектор «{name}» міряли {measuredDays} тому — час заміряти знову.', { name: _t(mounted.name), measuredDays: fmtDays(t.measuredDays) }) });
  } else if (!sets.length) hints.push({ kind: 'tires', text: _t('Додайте комплекти шин (літні й зимові) — нагадаю, коли переобуватись і коли купувати нові.') });

  return { today, odo, odoNow, reminders, tires, mounted: mounted ? mounted.id : null, season, alerts, hints };
}
const fmtK = n => Math.round(n).toLocaleString(I18N.locale());
function fmtDays(d) {
  if (d < 45) return _t('{d} дн.', { d });
  const m = Math.round(d / 30.4);
  return m < 18 ? _t('{m} міс.', { m }) : _t('{replace} р.', { replace: String(r1(d / 365)).replace('.', ',') });
}
const MON = { at: i => I18N.monShort()[i] };
const shortDay = (d, today) => `${+d.slice(8, 10)} ${MON.at(+d.slice(5, 7) - 1)}${today && d.slice(0, 4) !== today.slice(0, 4) ? ' ' + d.slice(0, 4) : ''}`;
const humanDay = d => `${+d.slice(8, 10)} ${MON.at(+d.slice(5, 7) - 1)} ${d.slice(0, 4)}`;

// Зведення для HA: стан = відбиток набору сповіщень (змінився → нове повідомлення), текст — усі разом
function haSummary(c) {
  const ids = c.alerts.map(a => a.id).sort().join('|');
  const h = require('node:crypto').createHash('sha1').update(ids).digest('hex').slice(0, 12);
  const oil = Object.values(c.reminders).find(x => x.id === 'r-oil');
  return {
    service_state: c.alerts.length ? h : 'none', service_count: c.alerts.length,
    service_title: c.alerts.length === 1 ? c.alerts[0].title : c.alerts.length ? _t('Сервіс: {length} нагадування', { length: c.alerts.length }) : null,
    service_text: c.alerts.map(a => (c.alerts.length > 1 ? '• ' + a.title + ': ' : '') + a.text).join('\n') || null,
    service_odo_est: c.odoNow || null,
    // куди веде натискання на push: одне нагадування — одразу його аркуш
    service_link: c.alerts.length === 1 && c.alerts[0].kind === 'reminder' && c.alerts[0].ref ? `/?rem=${encodeURIComponent(c.alerts[0].ref)}` : '/?tab=service',
    oil_km_left: oil ? oil.kmLeft : null, oil_days_left: oil ? oil.daysLeft : null,
    tires_season_need: c.season.need, tires_mounted: c.mounted
  };
}

/* ---------- погода (Open-Meteo, без ключа) ---------- */
async function refreshWeather() {
  const s = D.getSettings();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${s.homeLat}&longitude=${s.homeLng}&daily=temperature_2m_mean,temperature_2m_min,temperature_2m_max&past_days=2&forecast_days=10&timezone=Europe%2FKyiv`;
  const r = await fetch(url, { headers: { 'User-Agent': 'fuel-tracker/1.0' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('Open-Meteo: ' + r.status);
  const j = await r.json();
  const d = j.daily || {};
  const days = (d.time || []).map((t, i) => ({ d: t, t: d.temperature_2m_mean[i], lo: d.temperature_2m_min[i], hi: d.temperature_2m_max[i] })).filter(x => typeof x.t === 'number');
  if (!days.length) throw new Error(_t('Open-Meteo: порожньо'));
  const w = { ts: Date.now(), days };
  D.db.prepare("INSERT INTO meta(k, v) VALUES ('weather', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(JSON.stringify(w));
  return w;
}
function weather() { try { return JSON.parse((D.db.prepare("SELECT v FROM meta WHERE k = 'weather'").get() || {}).v || 'null'); } catch { return null; } }
function start() {
  const tick = () => { const w = weather(); if (!w || Date.now() - w.ts > 6 * 3600e3) refreshWeather().catch(e => console.error('weather:', e.message)); };
  setTimeout(tick, 5000); setInterval(tick, 30 * 60e3).unref();
}

module.exports = { reminderEngine, compute, haSummary, odometer, reminderStatus, tireSetStatus, seasonNeed, dotYear, weather, refreshWeather, start };
