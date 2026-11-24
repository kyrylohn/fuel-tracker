'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../public/calc.js');
const { parseFuelNotification: P } = require('../server/wog.js');
const { parseFuelio } = require('../server/fuelio.js');

const F = (id, date, odo, litres, total, full = 1, missed = 0) => ({ id, date, odo, litres, total, full, missed, status: 'ok' });

test('витрата від повного до повного з частковою заправкою', () => {
  const fills = [F('a', '2026-01-01', 1000, 40, 2000), F('b', '2026-01-05', 1300, 10, 500, 0), F('c', '2026-01-10', 1500, 30, 1500)];
  const s = C.segments(fills);
  assert.strictEqual(s.a, undefined);
  assert.strictEqual(s.b, undefined);
  assert.strictEqual(s.c.cons, 8); // 40 л на 500 км
  const st = C.stats(fills, [{ date: '2026-01-07', amount: 300, cat: 'wash' }]);
  assert.strictEqual(st.avgCons, 8);
  assert.strictEqual(st.km, 500);
  assert.strictEqual(st.fuelPerKm, 4); // (500+1500)/500
  assert.strictEqual(st.totalPerKm, 4.6);
  assert.strictEqual(st.months[0].costs, 300);
});

test('пропущена заправка ламає відрізок', () => {
  const s = C.segments([F('a', '1', 1000, 40, 0), F('b', '2', 1600, 40, 0, 1, 1), F('c', '3', 2100, 40, 0)]);
  assert.strictEqual(s.b, undefined);
  assert.strictEqual(s.c.cons, 8);
});

test('чернетки не рахуються, пробіг перевіряється', () => {
  const fills = [F('a', '2026-01-01', 1000, 40, 0), { id: 'd', date: '2026-01-02', odo: 0, litres: 30, status: 'draft' }];
  assert.strictEqual(C.ordered(fills).length, 1);
  assert.match(C.odoProblem(fills, { id: 'x', date: '2026-01-03', odo: 900 }), /менший/);
  assert.strictEqual(C.odoProblem(fills, { id: 'x', date: '2026-01-03', odo: 1200 }), null);
});

test('complete дораховує третє значення', () => {
  assert.strictEqual(C.complete({ litres: 40, price: 55 }).total, 2200);
  assert.strictEqual(C.complete({ litres: 40, total: 2200 }).price, 55);
  assert.strictEqual(C.complete({ price: 50, total: 2000 }).litres, 40);
});

test('розбір записів WOG PRIDE', () => {
  let r = P('WOG PRIDE', 'КУПІВЛЯ НА АЗК\nБЕНЗИН MUSTANG 95, 35.4 Л − 2 168.64 ₴\nБонус: +151.5\nБонус: −872.22');
  assert.deepStrictEqual(r, { kind: 'fill', fuel: 'А-95 Mustang', litres: 35.4, price: 85.9, total: 2168.64, bonus: 872.22, earned: 151.5 });
  r = P('WOG PRIDE', 'ПОПОВНЕННЯ ГАМАНЦЯ\nБЕНЗИН MUSTANG 95, 50 Л - 4 795 ₴\nБонус: +300');
  assert.deepStrictEqual(r, { kind: 'topup', fuel: 'А-95 Mustang', litres: 50, price: 95.9, total: 4795, bonus: 0, earned: 300 });
  r = P('WOG PRIDE', 'ВИКОРИСТАННЯ ГАМАНЦЯ\nБЕНЗИН MUSTANG 95, 20 Л');
  assert.deepStrictEqual(r, { kind: 'wallet', fuel: 'А-95 Mustang', litres: 20, price: 0, total: 0, bonus: 0, earned: 0 });
  r = P('WOG PRIDE', 'Дякуємо! А-95 40,00 л × 56,99 грн/л. Сума: 2 279,60 грн');
  assert.strictEqual(r.price, 56.99); assert.strictEqual(r.total, 2279.6); assert.strictEqual(r.fuel, 'А-95');
  assert.strictEqual(P('WOG PRIDE', 'Ви заправили 35.5 л ДП Mustang на 2 100 грн').fuel, 'ДП Mustang');
  assert.strictEqual(P('WOG PRIDE', 'КУПІВЛЯ НА АЗК\n2 товари - 620 ₴\nБонус: +16'), null);
  assert.strictEqual(P('WOG PRIDE', 'КУПІВЛЯ НА АЗК\nTEREA TURQUOISE. ТВЕН, 1 ШТ - 164.99 ₴'), null);
  assert.strictEqual(P('WOG', 'Знижка 3 грн на каву до неділі!'), null);
  assert.strictEqual(P('Telegram', 'привіт, як справи'), null);
});

test('гаманець: FIFO-ціна заправок з гаманця', () => {
  const r = C.applyWallet(
    [{ id: 'a', date: '2026-04-25 10:00', litres: 20, pay: 'wallet' }, { id: 'b', date: '2026-07-01', litres: 60, pay: 'wallet' }, { id: 'c', date: '2026-07-02', litres: 30, total: 2000 }],
    [{ date: '2026-03-02 09:00', litres: 50, amount: 3499.5 }, { date: '2026-06-01', litres: 100, amount: 8590 }]);
  assert.strictEqual(r.fills[0].total, 1399.8);
  assert.strictEqual(r.fills[1].total, 4676.7);
  assert.strictEqual(r.fills[2].total, 2000);
  assert.deepStrictEqual(r.balance, { litres: 70, value: 6013, short: 0 });
});

test('імпорт CSV Fuelio', () => {
  const csv = [
    '"## Vehicle"',
    '"Name","Description","DistUnit","FuelUnit","ConsumptionUnit","ImportCSVDateFormat","VIN","Insurance","Plate","Make","Model","Year","TankCount","Tank1Type","Tank2Type","Active","Tank1Capacity"',
    '"Октавія","","0","0","0","yyyy-MM-dd","","","AE1234AA","Skoda","Octavia","2015","1","100","0","1","55.0"',
    '"## Log"',
    '"Data","Odo (km)","Fuel (litres)","Full","Price (optional)","l/100km (optional)","latitude (optional)","longitude (optional)","City (optional)","Notes (optional)","Missed","TankNumber","FuelType","VolumePrice","StationID (optional)","ExcludeDistance","UniqueId","TankCalc","Weather"',
    '"2026-01-01 10:00","1000","40.0","1","2000.0","0.0","0","0","Дніпро","перша, ""тест""","0","1","100","50.0","0","0.0","11","0.0",""',
    '"2026-01-10","1500","30.0","1","1500.0","0.0","0","0","","","0","1","100","50.0","0","0.0","12","0.0",""',
    '"## CostCategories"', '"CostTypeID","Name","priority","color"', '"1","Service","0","#ff0000"',
    '"## Costs"',
    '"CostTitle","Date","Odo","CostTypeID","Notes","Cost","flag","idR","read","RemindOdo","RemindDate","isTemplate","RepeatOdo","RepeatMonths","isIncome","UniqueId"',
    '"Масло","2026-01-05","1200","1","","1800.0","0","0","1","0","2011-01-01","0","0","0","0","21"'
  ].join('\r\n');
  const p = parseFuelio(csv);
  assert.strictEqual(p.vehicle.make, 'Skoda'); assert.strictEqual(p.vehicle.tank, 55);
  assert.strictEqual(p.fills.length, 2);
  assert.strictEqual(p.fills[0].note, 'перша, "тест"');
  assert.strictEqual(p.fills[1].date, '2026-01-10 12:00');
  assert.strictEqual(p.costs[0].catName, 'Service'); assert.strictEqual(p.costs[0].amount, 1800);
  assert.throws(() => parseFuelio('a,b\n1,2'));
});

test('періоди: поточний і попередній такої ж довжини', () => {
  const now = new Date(2026, 10, 23); // 23 листопада 2026
  assert.deepStrictEqual(C.periodRange('m', now), { from: '2026-11-01', to: '' });
  assert.deepStrictEqual(C.periodRange('3m', now), { from: '2026-09-01', to: '' });
  assert.deepStrictEqual(C.periodRange('y', now), { from: '2025-12-01', to: '' });
  assert.deepStrictEqual(C.periodRange('all', now), { from: '', to: '' });
  assert.deepStrictEqual(C.prevPeriodRange('m', now), { from: '2026-10-01', to: '2026-10-23' });
  assert.deepStrictEqual(C.prevPeriodRange('3m', now), { from: '2026-06-01', to: '2026-08-23' });
  assert.deepStrictEqual(C.prevPeriodRange('y', now), { from: '2024-12-01', to: '2025-11-23' });
  assert.strictEqual(C.prevPeriodRange('all', now), null);
  // 31 березня → попередній місяць — лютий, день обрізається
  assert.deepStrictEqual(C.prevPeriodRange('m', new Date(2026, 2, 31)), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepStrictEqual(C.prevPeriodRange('3m', new Date(2026, 1, 10)), { from: '2025-09-01', to: '2025-11-10' });
});

test('pctChange: відсоток зміни або null', () => {
  assert.strictEqual(C.pctChange(97, 100), -3);
  assert.strictEqual(C.pctChange(150, 100), 50);
  assert.strictEqual(C.pctChange(10, 0), null);
  assert.strictEqual(C.pctChange(null, 10), null);
  assert.strictEqual(C.pctChange(10, null), null);
});

test('monthKeys, daySeries, monthlyMetrics', () => {
  assert.deepStrictEqual(C.monthKeys('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  const d = C.daySeries([{ date: '2026-02-03', v: 10 }, { date: '2026-02-03 12:00', v: 5.5 }, { date: '2026-03-01', v: 9 }], '2026-02');
  assert.strictEqual(d.length, 28);
  assert.strictEqual(d[2], 15.5);
  assert.strictEqual(d.reduce((a, b) => a + b, 0), 15.5);
  const fills = [F('a', '2026-01-01', 1000, 40, 2000), F('b', '2026-01-10', 1500, 40, 2400), F('c', '2026-02-10', 2000, 30, 1800)];
  const m = C.monthlyMetrics(fills, [], ['2026-01', '2026-02', '2026-03']);
  assert.strictEqual(m[0].avgCons, 8); assert.strictEqual(m[0].km, 500); assert.strictEqual(m[0].avgPrice, 55);
  assert.strictEqual(m[0].fuelPerKm, 4.4);
  assert.strictEqual(m[1].km, 500); // відрізок належить місяцю заправки, що його закрила
  assert.strictEqual(m[2].avgCons, null); assert.strictEqual(m[2].km, null);
});
