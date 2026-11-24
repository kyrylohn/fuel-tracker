'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-eng-'));
const D = require('../server/db');
const SV = require('../server/service');
const E = require('../server/engine');

const fill = (date, odo) => ({ id: 'f' + odo, date, odo, litres: 40, full: 1, status: 'ok' });
// щодня 2 год двигуна (10:00–12:00) з 1 по 20 червня
const trips = [];
for (let d = 1; d <= 20; d++) { const dd = String(d).padStart(2, '0'); trips.push({ start: `2026-06-${dd} 10:00`, end: `2026-06-${dd} 12:00`, minutes: 120 }); }
const fills = [fill('2026-06-02 20:00', 1000), fill('2026-06-12 20:00', 1170), fill('2026-06-19 20:00', 1290), fill('2026-05-20 20:00', 900), fill('2026-06-25 20:00', 1400)];

test('середня швидкість: лише пари заправок усередині покриття', () => {
  const m = E.buildEngine(trips, fills);
  assert.equal(m.measuredMin, 2400);
  // 05-20→06-02 і 06-19→06-25 виходять за покриття — відкинуто
  assert.equal(m.pairs.length, 2);
  assert.equal(m.pairs[0].km, 170); assert.equal(m.pairs[0].minutes, 1200);
  const kmSum = 170 + 120, minSum = m.pairs[0].minutes + m.pairs[1].minutes;
  assert.ok(Math.abs(m.avgSpeed - kmSum / (minSum / 60)) < 1e-9);
  assert.ok(m.avgSpeed > 8 && m.avgSpeed < 9, String(m.avgSpeed));
});

test('швидкість: замало мотогодин або заправок — null; видалені заправки ігноруються', () => {
  assert.equal(E.buildEngine(trips.slice(0, 3), fills).avgSpeed, null);
  assert.equal(E.buildEngine(trips, [fills[0]]).avgSpeed, null);
  const withDeleted = fills.concat([Object.assign(fill('2026-06-07 20:00', 1100), { status: 'deleted' })]);
  assert.equal(E.buildEngine(trips, withDeleted).pairs.length, 2);
  assert.equal(E.buildEngine([], fills).has, false);
});

test('пара з дірою між поїздками (пропущений звіт) відкидається', () => {
  const gap = trips.filter(t => +t.start.slice(8, 10) < 3 || +t.start.slice(8, 10) > 17);
  const f2 = [fill('2026-06-02 20:00', 1000), fill('2026-06-19 20:00', 1290)];
  assert.equal(E.buildEngine(gap, f2).pairs.length, 0);
  assert.equal(E.buildEngine(trips, f2).pairs.length, 1);
});

test('engineMinutesBetween: виміряне, часткове покриття, екстраполяція', () => {
  const m = E.buildEngine(trips, fills);
  let r = E.engineMinutesBetween(m, '2026-06-05 00:00', '2026-06-08 00:00');
  assert.equal(r.minutes, 360); assert.equal(r.estimated, false);
  // 5 днів до покриття (05-27 → 06-01 10:00 — не покрито ~4,4 дня) + 2 виміряні поїздки
  r = E.engineMinutesBetween(m, '2026-05-30 00:00', '2026-06-03 00:00', { perDay: 7.2 });
  assert.equal(r.measuredMin, 240);
  assert.ok(r.estimated && r.estimatedMin > 0);
  const unc = (Date.parse('2026-06-01T10:00:00Z') - Date.parse('2026-05-30T00:00:00Z')) / 864e5;
  assert.ok(Math.abs(r.estimatedMin - Math.round(7.2 * unc / m.avgSpeed * 60)) <= 1);
  // за сумарними км: решта = kmTotal - виміряне×швидкість
  r = E.engineMinutesBetween(m, '2026-05-30 00:00', '2026-06-03 00:00', { kmTotal: 100 });
  assert.ok(Math.abs(r.km - 100) <= 1, r.km);
  // без швидкості лише виміряне
  const noSpeed = E.buildEngine(trips.slice(0, 3), fills);
  r = E.engineMinutesBetween(noSpeed, '2026-05-30 00:00', '2026-06-03 00:00', { perDay: 10 });
  assert.equal(r.estimated, false); assert.equal(r.minutes, r.measuredMin);
  // порожня модель
  assert.equal(E.engineMinutesBetween(E.buildEngine([], fills), '2026-06-01', '2026-06-02').minutes, 0);
});

test('пробіг: за мотогодинами, коли покриття після останнього запису, і запасний варіант', () => {
  const all = { fills, costs: [], reminders: [], tireSets: [], tireEvents: [] };
  const m = E.buildEngine(trips, fills);
  const old = SV.odometer(all, '2026-07-01', null);
  assert.equal(old.method, 'perDay');
  // остання заправка 06-25 — після покриття (до 06-20) → старий розрахунок
  assert.deepEqual(SV.odometer(all, '2026-07-01', m), old);
  assert.equal(SV.odometer(all, '2026-07-01', E.buildEngine([], fills)).method, 'perDay');
  // остання заправка 06-12 — далі 8 днів поїздок (≈ 16 год) + 2 дні без даних
  const f2 = fills.filter(f => f.odo <= 1170);
  const m2 = E.buildEngine(trips, f2.concat([fill('2026-06-02 20:00', 1000)]));
  const all2 = { fills: f2, costs: [], reminders: [], tireSets: [], tireEvents: [] };
  const o = SV.odometer(all2, '2026-06-22', m2);
  assert.equal(o.method, 'engine');
  assert.ok(o.engineMin >= 14 * 60 && o.engineMin <= 16 * 60, o.engineMin);
  assert.equal(o.est, Math.round(o.known + o.engineMin * m2.avgSpeed / 60 + o.perDay * o.extraDays));
  assert.ok(o.extraDays > 1 && o.extraDays < 3, o.extraDays);
});

test('нагадування: мотогодини від останнього виконання, лише довідка', () => {
  const all = { settings: D.getSettings(), fills, costs: [], tireSets: [], tireEvents: [],
    reminders: [{ id: 'r-oil', kind: 'oil', title: 'Масло', active: 1, every_km: 8000, every_days: 365, last_odo: 1000, last_date: '2026-06-02' },
      { id: 'r-x', kind: 'custom', title: 'X', active: 1, every_km: 0, every_days: 365, last_odo: 0, last_date: '' }] };
  const c = SV.compute(all, { today: '2026-06-20', trips });
  const eg = c.reminders['r-oil'].engine;
  assert.ok(eg && eg.measuredMin > 0 && eg.km > 0 && eg.avgSpeed > 0);
  assert.equal(c.reminders['r-x'].engine, undefined);
  const c0 = SV.compute(all, { today: '2026-06-20', trips: [] });
  assert.equal(c0.reminders['r-oil'].engine, undefined);
  assert.equal(c0.reminders['r-oil'].level, c.reminders['r-oil'].level);
});

test('engineSummary: місяці, оцінка за весь час, невідомо після останнього звіту', () => {
  const m = E.buildEngine(trips, fills);
  const s = E.engineSummary(m, '2026-06-30', 20000, 10);
  assert.equal(s.measuredMin, 2400); assert.equal(s.months.length, 1); assert.equal(s.months[0].trips, 20);
  assert.equal(s.lifetime.hours, Math.round(20000 / m.avgSpeed)); assert.equal(s.lifetime.estimated, true);
  assert.equal(s.sinceLatestUpload.unknown, true); assert.ok(s.sinceLatestUpload.days >= 9);
  assert.equal(E.engineSummary(E.buildEngine([], fills), '2026-06-30', 1, 1).has, false);
});

test('інтервал за мотогодинами: настав за годинами при нормі км і днів; без даних BM300 ігнорується', () => {
  const rem = { id: 'r-h', kind: 'custom', title: 'Масло', active: 1, every_km: 8000, every_days: 365, every_hours: 20, last_odo: 1000, last_date: '2026-06-02' };
  const all = { settings: D.getSettings(), fills, costs: [], tireSets: [], tireEvents: [], reminders: [rem] };
  // 06-02 → 06-20: 18 днів по 2 год = ~34 год > 20; пробіг і час далекі від ліміту
  let c = SV.compute(all, { today: '2026-06-20', trips });
  let st = c.reminders['r-h'];
  assert.equal(st.level, 'due'); assert.ok(st.hoursLeft < 0 && st.kmLeft > 0 && st.daysLeft > 0);
  assert.match(c.alerts[0].text, /Мотогодин: \d+ з 20/);
  // скоро: лишилось ≤ 10% (2 год)
  c = SV.compute(Object.assign({}, all, { reminders: [Object.assign({}, rem, { every_hours: 38 })] }), { today: '2026-06-20', trips });
  assert.equal(c.reminders['r-h'].level, 'soon');
  assert.match(c.alerts[0].text, /Мотогодини: лишилось \d+ з 38/);
  // без поїздок BM300 години не діють: жодного сповіщення
  c = SV.compute(all, { today: '2026-06-20', trips: [] });
  st = c.reminders['r-h'];
  assert.equal(st.hoursLeft, null); assert.equal(st.level, 'ok'); assert.equal(c.alerts.length, 0);
  // лише години, без даних → невідомо
  c = SV.compute(Object.assign({}, all, { reminders: [Object.assign({}, rem, { every_km: 0, every_days: 0 })] }), { today: '2026-06-20', trips: [] });
  assert.equal(c.reminders['r-h'].level, 'unknown');
});

test('збереження нагадування з every_hours', () => {
  const r = D.saveReminder({ title: 'Тест', every_hours: 150 }, null);
  assert.equal(r.every_hours, 150);
  assert.throws(() => D.saveReminder({ title: 'Нічого' }, null), e => e.status === 400);
  D.deleteReminder(r.id, null);
});
