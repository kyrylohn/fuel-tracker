'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-prices-'));
const P = require('../server/prices');
const D = require('../server/db');
test.after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

test('ключ пального з назви', () => {
  assert.strictEqual(P.fuelKey('А-95 Mustang'), 'a95p');
  assert.strictEqual(P.fuelKey('А-95'), 'a95');
  assert.strictEqual(P.fuelKey('ДП Mustang'), 'dpp');
  assert.strictEqual(P.fuelKey('Газ'), 'gas');
});

test('таблиця Мінфіну', () => {
  const html = '<table><tr><th>Оператор</th><th>А 95+</th></tr><tr><td>WOG</td><td></td><td>94,90</td><td>91,90</td><td></td><td>106,90</td><td>61,50</td></tr><tr><td>БРСМ-Нафта</td><td></td><td></td><td>86,99</td><td></td><td>100,99</td><td>58,99</td></tr></table>';
  const t = P.parseMinfin(html);
  assert.deepStrictEqual(t.WOG, { a95p: 94.9, a95: 91.9, a92: null, dp: 106.9, gas: 61.5 });
  assert.strictEqual(t['БРСМ-Нафта'].a95p, null); assert.strictEqual(t['БРСМ-Нафта'].a95, 86.99);
});

test('наявність пального WOG з опису', () => {
  const r = P.wogAvailability('АЗК працює згідно графіку.\nА-95 М - Готівка, банк.картки. Паливна картка (ліміт картки).\nДП - відсутнє\nГАЗ - лише для спецтранспорту\n');
  assert.deepStrictEqual(r.avail, { a95p: true, dp: false, gas: true });
  assert.strictEqual(r.notes.length, 1);
});

test('поради: інші підняли, WOG ще ні → поповнити; WOG підняв → вигода', () => {
  D.setSettings({ fuel: 'А-95 Mustang' });
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
  const ago = n => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const ins = D.db.prepare('INSERT OR REPLACE INTO price_days(day, net, fuel, price) VALUES (?, ?, ?, ?)');
  for (const n of ['ОККО', 'SOCAR', 'WOG']) ins.run(ago(5), n, 'a95p', 94.9);
  ins.run(day, 'ОККО', 'a95p', 96.9); ins.run(day, 'SOCAR', 'a95p', 96.9); ins.run(day, 'WOG', 'a95p', 94.9);
  let a = P.computeAdvice({ WOG: { a95p: 94.9 }, 'ОККО': { a95p: 96.9 }, SOCAR: { a95p: 96.9 } }, 'a95p', { litres: 50, value: 4795 });
  assert.strictEqual(a.kind, 'raise'); assert.match(a.text, /ОККО, SOCAR підняли А-95 Mustang, а WOG ще тримає 94,9/);
  const again = P.computeAdvice({ WOG: { a95p: 94.9 }, 'ОККО': { a95p: 96.9 }, SOCAR: { a95p: 96.9 } }, 'a95p', { litres: 50, value: 4795 });
  assert.strictEqual(again.id, a.id, 'та сама порада не повторюється');
  ins.run(day, 'WOG', 'a95p', 96.9);
  a = P.computeAdvice({ WOG: { a95p: 96.9 } }, 'a95p', { litres: 50, value: 4795 });
  assert.strictEqual(a.kind, 'wog'); assert.match(a.text, /94,9 → 96,9 ₴\. У гаманці 50 л по 95,9 ₴ — це вже 50 ₴ вигоди/);
});

test('бонуси WOG: ефективна ціна й порядок мереж', () => {
  D.setSettings({ fuel: 'А-95 Mustang', wogBonuses: [
    { name: 'Персональні', fuel: 'a95p', perL: 6, where: 'azk', from: '2026-10-01', to: '2099-12-31' },
    { name: 'Купон НП', fuel: 'a95p', perL: 2, where: 'azk', from: '2026-04-01', to: '2026-01-01' },
    { name: 'Гаманець', fuel: 'a95p', perL: 6, where: 'wallet' },
    { net: 'Parallel', name: 'Картка', fuel: 'a95p', pct: 10, where: 'azk' },
    { net: 'ОККО', name: 'не маю', fuel: 'a95p', perL: 50, where: 'azk', active: false }] });
  const b = P.bonusNow('a95p');
  assert.strictEqual(b.azk, 6, 'прострочений купон не рахується'); assert.strictEqual(b.wallet, 6);
  D.db.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES ('prices:latest', ?)").run(JSON.stringify({ ts: Date.now(), nets: { WOG: { a95p: 94.9 }, Parallel: { a95p: 89.9 } }, wog: [], okko: [] }));
  const o = P.overview(null);
  assert.strictEqual(o.wogEff, 88.9);
  assert.strictEqual(o.cheapest.net, 'Parallel', '10% від 89,9 = 8,99 ₴/л → 80,91');
  assert.strictEqual(o.cheapest.eff, 80.91);
});
