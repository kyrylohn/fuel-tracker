'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-i18n-'));
process.env.DATA_DIR = tmp;
process.env.FUEL_HOOK_TOKEN = 'h'.repeat(40);
process.env.PRICES = '0';
const I = require('../public/i18n.js');
const D = require('../server/db');
const { server } = require('../server/server');

test('t: українська за замовчуванням, англійська зі словника, підстановка, невідомий ключ', () => {
  I.setLang('uk');
  assert.strictEqual(I.t('Немає такого методу'), 'Немає такого методу');
  assert.strictEqual(I.t('{m} хв тому', { m: 5 }), '5 хв тому');
  I.runWith('en', () => {
    assert.strictEqual(I.getLang(), 'en');
    assert.strictEqual(I.locale(), 'en-GB');
    assert.strictEqual(I.t('{m} хв тому', { m: 5 }), '5 min ago');
    assert.strictEqual(I.t('  ще не перекладений рядок {x} '.trim(), { x: 1 }), 'ще не перекладений рядок 1'); // відсутній ключ → українська, без падіння
    assert.strictEqual(I.months()[0], 'January');
  });
  assert.strictEqual(I.getLang(), 'uk');
  assert.strictEqual(I.locale(), 'uk-UA');
});

test('plural: 3 форми українською, однина/множина англійською', () => {
  assert.deepStrictEqual([1, 2, 5, 11, 21].map(n => I.plural(n, 'заправка', 'заправки', 'заправок')), ['заправка', 'заправки', 'заправок', 'заправок', 'заправка']);
  I.runWith('en', () => {
    assert.deepStrictEqual([1, 2, 0].map(n => I.plural(n, 'заправка', 'заправки', 'заправок')), ['fill-up', 'fill-ups', 'fill-ups']);
  });
});

test('словник: кожна англійська відповідь без кирилиці й з тими самими {плейсхолдерами}', () => {
  const ph = s => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const [k, v] of Object.entries(I.EN)) {
    assert.ok(!/[А-Яа-яІіЇїЄєҐґ]/.test(v), k);
    assert.strictEqual(ph(v), ph(k), k);
  }
});

test('налаштування lang: uk за замовчуванням, en приймається, сміття → uk', () => {
  assert.strictEqual(D.getSettings().lang, 'uk');
  assert.strictEqual(D.setSettings({ lang: 'en' }).lang, 'en');
  assert.strictEqual(D.setSettings({ lang: 'fr' }).lang, 'uk');
  assert.strictEqual(D.setSettings({ lang: 'en' }).lang, 'en');
  assert.strictEqual(D.setSettings({ lang: null }).lang, 'uk');
});

test('API: помилки мовою налаштувань, а HA-хук — завжди українською', async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  D.setSettings({ lang: 'en' });
  let r = await fetch(base + '/api/all');
  assert.strictEqual((await r.json()).error, 'Sign-in required');
  r = await fetch(base + '/api/hook/odo', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + 'h'.repeat(40) }, body: '{"odo":0}' });
  assert.match((await r.json()).error, /Не бачу|Немає/);
  D.setSettings({ lang: 'uk' });
  r = await fetch(base + '/api/all');
  assert.strictEqual((await r.json()).error, 'Потрібно увійти');
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
