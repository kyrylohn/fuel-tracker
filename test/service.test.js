'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-svc-'));
const D = require('../server/db');
const SV = require('../server/service');

const fill = (date, odo, litres) => ({ id: 'f' + odo, date: date + ' 12:00', odo, litres, full: 1, status: 'ok', total: litres * 60 });
const base = () => ({
  settings: D.getSettings(),
  fills: [fill('2026-07-01', 140000, 40), fill('2026-08-01', 141000, 40), fill('2026-09-01', 142000, 40), fill('2026-10-01', 143000, 40)],
  costs: [], reminders: [], tireSets: [], tireEvents: []
});

test('міграція створює типові роботи', () => {
  const r = D.listReminders();
  assert.ok(r.find(x => x.id === 'r-oil' && x.every_km === 8000 && x.every_days === 365 && x.every_hours === 300));
  assert.ok(r.find(x => x.kind === 'insurance'));
});

test('пробіг: оцінка на сьогодні за середнім денним', () => {
  const o = SV.odometer(base(), '2026-10-31');
  assert.equal(o.known, 143000);
  assert.ok(o.perDay > 30 && o.perDay < 35, o.perDay);
  assert.ok(o.est > 143900 && o.est < 144100, o.est);
});

test('нагадування: за пробігом, за часом, що раніше', () => {
  const r = { id: 'x', active: 1, every_km: 8000, every_days: 365, last_odo: 139430, last_date: '2025-07-22' };
  const st = SV.reminderStatus(r, 144900, '2026-11-13', 30);
  assert.equal(st.kmLeft, 139430 + 8000 - 144900);
  assert.ok(st.daysLeft < 0);
  assert.equal(st.level, 'due'); // за часом прострочено, хоч за пробігом ще ні
  const st2 = SV.reminderStatus(Object.assign({}, r, { last_date: '2026-10-01' }), 146700, '2026-11-13', 30);
  assert.equal(st2.level, 'soon');
  assert.equal(SV.reminderStatus(Object.assign({}, r, { last_odo: 0, last_date: '' }), 1, '2026-11-13').level, 'unknown');
});

test('поліс: дата «діє до», нагадування за 14 днів', () => {
  const r = { id: 'i', kind: 'insurance', active: 1, every_km: 0, every_days: 365, last_date: '2025-11-20', due_date: '2026-11-19' };
  assert.equal(SV.reminderStatus(r, 0, '2026-11-01').level, 'ok');
  assert.equal(SV.reminderStatus(r, 0, '2026-11-10').level, 'soon');
  assert.equal(SV.reminderStatus(r, 0, '2026-11-20').level, 'due');
});

test('шини: знос і прогноз, поріг, вік DOT', () => {
  const set = { id: 's1', season: 'winter', new_depth: 9, mounted: 1, dot: '3519' };
  const ev = [
    { set_id: 's1', kind: 'mount', date: '2025-11-10 12:00', odo: 130000, created_at: 1 },
    { set_id: 's1', kind: 'measure', date: '2025-11-10 12:00', odo: 130000, fl: 7, fr: 7.2, rl: 7.5, rr: 7.4, created_at: 2 },
    { set_id: 's1', kind: 'unmount', date: '2026-04-01 12:00', odo: 135000, created_at: 3 },
    { set_id: 's1', kind: 'measure', date: '2026-04-01 12:00', odo: 135000, fl: 6, fr: 6.1, rl: 6.6, rr: 6.5, created_at: 4 },
    { set_id: 's1', kind: 'mount', date: '2026-11-01 12:00', odo: 144000, created_at: 5 }
  ];
  const t = SV.tireSetStatus(set, ev, 145000, '2026-11-13', 4);
  assert.equal(t.km, 6000);
  assert.equal(t.depth, 6);
  assert.equal(t.rate, 0.2);
  assert.equal(t.kmLeft, 10000);
  assert.equal(t.year, 2019);
  assert.equal(t.age, 7);
  assert.equal(t.level, 'soon');
  assert.equal(SV.dotYear('2021'), 2021);
  assert.equal(SV.dotYear('0822'), 2022);
});

test('сезон: прогноз холодний у листопаді → зимові; без прогнозу — календар', () => {
  const days = Array.from({ length: 9 }, (_, i) => ({ d: `2026-11-${String(10 + i).padStart(2, '0')}`, t: 3 + (i % 3) }));
  assert.equal(SV.seasonNeed('2026-11-12', { days }).need, 'winter');
  assert.equal(SV.seasonNeed('2026-10-05', { days: days.map((x, i) => ({ d: `2026-10-${String(3 + i).padStart(2, '0')}`, t: 14 })) }).need, 'summer');
  assert.equal(SV.seasonNeed('2026-12-05', null).need, 'winter');
  assert.equal(SV.seasonNeed('2026-06-05', null).source, 'calendar');
});

test('сповіщення: переобування, купівля, масло; відбиток для HA', () => {
  const all = base();
  all.reminders = [{ id: 'r-oil', title: 'Масло', kind: 'oil', active: 1, every_km: 8000, every_days: 365, last_odo: 139430, last_date: '2025-07-22' }];
  all.tireSets = [
    { id: 'a', name: 'Літні', season: 'summer', mounted: 1, new_depth: 8, retired: 0 },
    { id: 'b', name: 'Зимові', season: 'winter', mounted: 0, new_depth: 9, retired: 0 }
  ];
  all.tireEvents = [{ set_id: 'b', kind: 'measure', date: '2026-04-01 12:00', odo: 140000, fl: 3.5, fr: 3.6, rl: 4, rr: 4, created_at: 1 }];
  const days = Array.from({ length: 9 }, (_, i) => ({ d: `2026-11-${String(10 + i).padStart(2, '0')}`, t: 2 }));
  const c = SV.compute(all, { today: '2026-11-13', weather: { days } });
  const kinds = c.alerts.map(a => a.kind).sort();
  assert.deepEqual(kinds, ['buy', 'reminder', 'swap']);
  assert.match(c.alerts.find(a => a.kind === 'buy').text, /3,5 мм/);
  const h = SV.haSummary(c);
  assert.equal(h.service_count, 3);
  assert.match(h.service_state, /^[0-9a-f]{12}$/);
  assert.equal(SV.haSummary(SV.compute(all, { today: '2026-11-13', weather: { days } })).service_state, h.service_state);
  // переобулись на зимові → сповіщення про переобування зникає
  all.tireSets[0].mounted = 0; all.tireSets[1].mounted = 1;
  const c2 = SV.compute(all, { today: '2026-11-13', weather: { days } });
  assert.ok(!c2.alerts.some(a => a.kind === 'swap'));
});

test('БД: виконано → новий відлік, витрата; переобування з заміром', () => {
  const r = D.reminderDone({ id: 'r-oil', date: '2026-11-13 10:00', odo: 145000, amount: 3200, title: 'Заміна масла' }, null);
  assert.equal(r.reminder.last_odo, 145000);
  assert.equal(r.reminder.last_date, '2026-11-13');
  assert.equal(r.cost.amount, 3200);
  assert.equal(r.reminder.last_cost, r.cost.id, 'нагадування посилається на запис витрати');
  D.deleteCost(r.cost.id, null);
  assert.equal(D.getReminder('r-oil').last_cost, '', 'видалили витрату — посилання зникло');
  const ins = D.saveReminder({ id: 'r-insurance', last_date: '2025-11-20', due_date: '2026-11-19' }, null);
  assert.equal(ins.due_date, '2026-11-19');
  const done = D.reminderDone({ id: 'r-insurance', date: '2026-11-18 10:00', odo: 0 }, null);
  assert.equal(done.reminder.due_date, '2027-11-18');
  const a = D.saveTireSet({ name: 'Літні', season: 'summer' }, null).id;
  const b = D.saveTireSet({ name: 'Зимові', season: 'winter', dot: '3521' }, null).id;
  D.tireSwap({ to: a, date: '2026-04-01 10:00', odo: 140000 }, null);
  const sw = D.tireSwap({ to: b, date: '2026-11-13 10:00', odo: 145000, fl: 5, fr: 5.1, rl: '', rr: 5.5, amount: 800 }, null);
  assert.equal(sw.cost.cat, 'tires');
  const sets = D.listTireSets();
  assert.equal(sets.find(x => x.id === b).mounted, 1);
  assert.equal(sets.find(x => x.id === a).mounted, 0);
  const ev = D.listTireEvents().filter(e => e.set_id === a);
  assert.deepEqual(ev.map(e => e.kind), ['mount', 'unmount', 'measure']);
  assert.equal(ev[2].rl, null);
  assert.throws(() => D.tireMeasure({ set_id: b, date: '2026-11-13', odo: 1 }), /глибину/);
});

test('вішліст: devalue і відбір за хештегом', () => {
  const W = require('../server/wishlist');
  const flat = [{ list: 1 }, { items: 2 }, [3, 4], { name: 5, note: 6, itemPrice: 7, quantity: 9, imageUrl: 10 }, { name: 11, note: -1, quantity: 9 },
    'Масло 5W-20', '#авто 6 літрів', { value: 8, currency: 12 }, 189000, 1, 'oil.webp', 'Ніж', 'UAH'];
  const d = W.unflatten(flat);
  const out = W.pick(d, 'авто');
  assert.equal(out.length, 1);
  assert.equal(out[0].price, 1890);
  assert.equal(out[0].note, '6 літрів');
  assert.deepEqual(W.tagsOf('#Авто #шини x#ні'), ['авто', 'шини']);
});

test('відкласти: due → soon, не потрапляє в alerts; done очищає; тексти без «Час:»', () => {
  const all = base();
  const r = { id: 'r-oil', title: 'Масло двигуна + масляний фільтр', kind: 'oil', active: 1, every_km: 8000, every_days: 365, last_odo: 139430, last_date: '2025-07-22' };
  all.reminders = [r];
  let c = SV.compute(all, { today: '2026-11-13' });
  assert.equal(c.reminders['r-oil'].level, 'due');
  assert.equal(c.alerts.length, 1);
  assert.equal(c.alerts[0].title, 'Масло двигуна + масляний фільтр');
  assert.doesNotMatch(c.alerts[0].title + c.alerts[0].text, /Час:|Пробіг:/);
  assert.match(c.alerts[0].text, /^Минув рік з заміни \(22 лип 2025\) — пора міняти\. За пробігом ще ~[\d\s ]+ км\./);
  all.reminders = [Object.assign({}, r, { snooze_until: '2026-12-13' })];
  c = SV.compute(all, { today: '2026-11-13' });
  assert.equal(c.reminders['r-oil'].level, 'soon');
  assert.equal(c.reminders['r-oil'].snoozed, '2026-12-13');
  assert.equal(c.reminders['r-oil'].snoozedText, 'відкладено до 13 гру');
  assert.equal(c.alerts.length, 0);
  assert.equal(SV.haSummary(c).service_count, 0);
  // термін відкладення минув → знову due
  assert.equal(SV.compute(all, { today: '2026-12-13' }).reminders['r-oil'].level, 'due');
  // за пробігом і поліс
  const km = SV.compute(Object.assign(base(), { reminders: [{ id: 'k', title: 'Свічки', kind: 'plugs', active: 1, every_km: 8000, every_days: 0, last_odo: 136100, last_date: '' }] }), { today: '2026-10-31' });
  assert.match(km.alerts[0].text, /^Пробіг: лишилось ~[\d\s ]+ км \(до 144\D100 км\)\./);
  const ins = SV.compute(Object.assign(base(), { reminders: [{ id: 'i', title: 'Автоцивілка', kind: 'insurance', active: 1, every_km: 0, every_days: 365, last_odo: 0, last_date: '2025-11-19', due_date: '2026-11-19' }] }), { today: '2026-11-13' });
  assert.equal(ins.alerts[0].text, 'Поліс закінчується 19 лис (через 6 дн.).');
});

test('БД: snooze і done', () => {
  const today = new Date().toLocaleDateString('sv-SE');
  const s = D.reminderSnooze({ id: 'r-oil', days: 30 }, null).reminder;
  assert.equal(s.snooze_until, D.addDays(today, 30));
  assert.equal(D.listReminders().find(x => x.id === 'r-oil').snooze_until, s.snooze_until);
  assert.throws(() => D.reminderSnooze({ id: 'r-oil', days: 400 }, null));
  assert.equal(D.reminderSnooze({ id: 'r-oil', days: 0 }, null).reminder.snooze_until, '');
  D.reminderSnooze({ id: 'r-oil', days: 5 }, null);
  const d = D.reminderDone({ id: 'r-oil', date: today, odo: 150000 }, null);
  assert.equal(d.reminder.snooze_until, '');
  assert.equal(D.getReminder('r-oil').snooze_until, '');
});

test('шини: правка запису змінює дату, пересортування зберігає коректний пробіг; дата купівлі; міграція', () => {
  const set = D.saveTireSet({ name: 'Тест', season: 'winter', bought: '2026-01-05' }, null);
  assert.equal(set.bought, '2026-01-05');
  assert.throws(() => D.saveTireSet({ id: set.id, bought: '2999-01-01' }), /майбутньому/);
  assert.throws(() => D.saveTireSet({ id: set.id, bought: '05.01.2026' }), /Дата купівлі/);
  assert.equal(D.saveTireSet({ id: set.id, bought: '' }).bought, '');
  D.tireSwap({ to: set.id, date: '2026-10-25 15:39', odo: 144000 }, null);
  const mnt = D.listTireEvents().find(e => e.set_id === set.id && e.kind === 'mount');
  D.tireMeasure({ set_id: set.id, date: '2026-10-26 10:00', odo: 144100, fl: 7, fr: 7, rl: 7, rr: 7 }, null);
  const other = D.saveTireSet({ name: 'Інші', season: 'summer' }, null);
  D.tireSwap({ to: other.id, date: '2026-10-30 10:00', odo: 145000 }, null);
  const upd = D.updateTireEvent({ id: mnt.id, date: '2026-10-20T08:00', odo: 143500, note: 'x' }, null);
  assert.equal(upd.date, '2026-10-20 08:00'); assert.equal(upd.odo, 143500); assert.equal(upd.kind, 'mount');
  const all = { tireSets: D.listTireSets(), tireEvents: D.listTireEvents() };
  const st = SV.tireSetStatus(all.tireSets.find(x => x.id === set.id), all.tireEvents, 145000, '2026-11-14', 4);
  assert.equal(st.km, 1500); // 145000 - 143500 assert.equal(st.mountedDate, '2026-10-20');
  const m = D.listTireEvents().find(e => e.set_id === set.id && e.kind === 'measure');
  assert.throws(() => D.updateTireEvent({ id: m.id, date: m.date, odo: 1 }), /протектора/);
  assert.equal(D.updateTireEvent({ id: m.id, date: m.date, odo: 144100, fl: '6,5', fr: 7 }, null).fl, 6.5);
  assert.throws(() => D.updateTireEvent({ id: 'nope', date: m.date, odo: 1 }), /Немає/);
});

test('акумулятор: сповіщення про низьку напругу спокою й слабкі пуски', () => {
  const all = base();
  const ok = { rest: { nights: 7, low: 2, median: 12.55, min: 12.3, from: '2026-11-14', last: '2026-11-20', alert: false },
    crank: { cranks: 10, weak: 0, min: 9.85, minT: '2026-11-16 18:14', last: '2026-11-21 15:36', alert: false } };
  let c = SV.compute(all, { today: '2026-11-23', batHealth: ok, batLast: '2026-11-21 16:01' });
  assert.equal(c.alerts.filter(a => a.kind === 'battery').length, 0);

  const bad = { rest: { ...ok.rest, low: 6, median: 12.35, alert: true }, crank: { ...ok.crank, weak: 4, min: 9.4, minT: '2026-11-20 08:00', alert: true } };
  c = SV.compute(all, { today: '2026-11-23', batHealth: bad, batLast: '2026-11-21 16:01' });
  const b = c.alerts.filter(a => a.kind === 'battery');
  assert.equal(b.length, 2);
  assert.ok(b[0].id === 'b:rest:2026-11-20' && /6 з 7 .* 12,35 В/.test(b[0].text), b[0].text);
  assert.ok(b[1].id === 'b:crank:2026-11-21 15:36' && /4 з 10 .* 9,40 В, 20 лис/.test(b[1].text), b[1].text);
  assert.ok(SV.haSummary(c).service_text.includes('Слабкі пуски'));

  // застарілі дані (> 45 дн.) — не сповіщаємо, лишається лише «Завантаж звіт»
  c = SV.compute(all, { today: '2027-01-20', batHealth: bad, batLast: '2026-11-21 16:01' });
  assert.equal(c.alerts.filter(a => a.kind === 'battery').length, 0);
  assert.ok(c.alerts.some(a => a.kind === 'bm300'));
});

test('акумулятор: batteryHealth за даними BM300', () => {
  const B = require('../server/battery');
  const ins = D.db.prepare('INSERT OR REPLACE INTO bat_samples(t, v, soc, temp) VALUES (?, ?, 80, 10)');
  const insC = D.db.prepare("INSERT OR REPLACE INTO bat_cranks(t, v, ms, status) VALUES (?, ?, 900, 'OK')");
  for (let d = 1; d <= 7; d++) {
    const day = '2026-12-' + String(d).padStart(2, '0');
    for (let m = 0; m < 180; m += 2) ins.run(`${day} 0${2 + Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`, d <= 5 ? 12.3 : 12.6);
    insC.run(`${day} 08:00`, d <= 3 ? 9.4 : 10.2);
  }
  let h = B.batteryHealth();
  assert.equal(h.rest.alert, true); assert.equal(h.rest.low, 5); assert.equal(h.rest.last, '2026-12-07');
  assert.equal(h.crank.alert, true); assert.equal(h.crank.weak, 3); assert.equal(h.crank.min, 9.4);
  insC.run('2026-12-07 08:00', 10.2); D.db.prepare("UPDATE bat_cranks SET v = 10.3 WHERE t = '2026-12-03 08:00'").run();
  h = B.batteryHealth();
  assert.equal(h.crank.alert, false);
  D.db.exec('DELETE FROM bat_samples; DELETE FROM bat_cranks;');
});
