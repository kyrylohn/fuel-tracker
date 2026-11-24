'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-bm-'));
const D = require('../server/db');
const { readXls } = require('../server/xls');
const { parseBm300, parseDate } = require('../server/bm300');
const { batterySummary } = require('../server/battery');

const SAMPLE = path.join(__dirname, 'fixtures', 'bm300-sample.xls');
// реальні експорти BM300 не в git (особисті дані): покладіть файл у test/fixtures/ або каталог у BM300_SAMPLES
const UPLOADS = process.env.BM300_SAMPLES || '';
const NOFIX = !fs.existsSync(SAMPLE) && 'немає test/fixtures/bm300-sample.xls';
const sample = () => fs.readFileSync(SAMPLE);

test('xls: аркуші й значення з еталонного файлу (звірено з xlrd)', { skip: NOFIX }, () => {
  const sh = readXls(sample());
  assert.deepStrictEqual(sh.map(s => s.name.split('_')[1]), ['History Report', 'Cranking Report', 'Charging Report', 'Trip Report']);
  assert.strictEqual(sh[0].name.split('_')[0], 'січ. 2026');
  assert.strictEqual(sh[0].rows.length, 724);
  assert.match(sh[0].rows[2][0].trim(), /^[0-9A-F]{12}$/);
  assert.deepStrictEqual(sh[0].rows[4].slice(0, 4).map(x => x.trim()), ['січ. 28/2026 13:49', '13.03', '100', '22']);
  assert.strictEqual(sh[3].rows.length, 14);
  assert.strictEqual(sh[3].rows[2][2].trim(), '20Minute');
});

test('xls: сміття відхиляється з 400', () => {
  for (const b of [Buffer.from('hello'), Buffer.alloc(4096), Buffer.concat([Buffer.from('D0CF11E0A1B11AE1', 'hex'), Buffer.alloc(2000)])]) {
    assert.throws(() => readXls(b), e => e.status === 400 && /BM300/.test(e.message));
  }
  assert.throws(() => parseBm300(Buffer.from('x')), e => e.status === 400);
});

test('дати: укр. й англ. скорочення', () => {
  assert.strictEqual(parseDate('\tтрав. 01/2026 00:01\t'), '2026-05-01 00:01');
  assert.strictEqual(parseDate('лист. 11/2026 13:21'), '2026-11-11 13:21');
  assert.strictEqual(parseDate('Feb 03/2026 7:05'), '2026-02-03 07:05');
  assert.strictEqual(parseDate('Test time'), null);
});

test('парсер: кількості й перші значення', { skip: NOFIX }, () => {
  const p = parseBm300(sample());
  assert.match(p.device, /^[0-9A-F]{12}$/);
  assert.strictEqual(p.samples.length, 2443);
  assert.deepStrictEqual(p.samples[0], { t: '2026-01-28 13:49', v: 13.03, soc: 100, temp: 22 });
  assert.strictEqual(p.samples[1].t, '2026-01-29 00:01');
  assert.strictEqual(p.trips.length, 11);
  assert.deepStrictEqual(p.trips[0], { start: '2026-01-31 23:21', end: '2026-01-31 23:41', minutes: 20, km: 0 });
  assert.strictEqual(p.cranks.length, 0);
  assert.strictEqual(p.charges.length, 0);
});

test('імпорт ідемпотентний, dry нічого не пише', { skip: NOFIX }, () => {
  const p = parseBm300(sample());
  const dry = D.importBm300(p, { dry: true }, null);
  assert.strictEqual(dry.samples.new, 2443);
  assert.strictEqual(D.db.prepare('SELECT COUNT(*) n FROM bat_samples').get().n, 0);
  const r1 = D.importBm300(p, {}, null);
  assert.deepStrictEqual([r1.samples.new, r1.trips.new, r1.from, r1.to], [2443, 11, '2026-01-28 13:49', '2026-01-31 23:59']);
  const r2 = D.importBm300(p, {}, null);
  assert.deepStrictEqual([r2.samples.new, r2.samples.total, r2.trips.new], [0, 2443, 0]);
  assert.strictEqual(D.db.prepare('SELECT COUNT(*) n FROM bat_samples').get().n, 2443);
  assert.strictEqual(D.db.prepare("SELECT COUNT(*) n FROM audit WHERE action = 'importBm300'").get().n, 2);
});

test('підсумок: глибокий розряд знаходиться, поїздка з просадкою — ні; поділ за датою заміни', { skip: NOFIX }, () => {
  const samples = [];
  const at = (day, h, m) => `${day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  // старий акумулятор: 2 липня з 03:00 до 04:20 на стоянці V падає до 8,15
  for (let i = 0; i <= 40; i++) { const mm = 180 + i * 2; samples.push({ t: at('2026-07-02', Math.floor(mm / 60), mm % 60), v: i === 20 ? 9.05 : 11.2, soc: 5, temp: 20 }); }
  // короткий провал (10 хв) — не епізод
  for (let i = 0; i < 5; i++) samples.push({ t: at('2026-07-03', 3, i * 2), v: 11.5, soc: 20, temp: 20 });
  // просадка під час поїздки (пуск) — ігнорується
  for (let i = 0; i < 20; i++) samples.push({ t: at('2026-07-03', 12, i * 2), v: 11.0, soc: 20, temp: 20 });
  // новий акумулятор: ночі 12,7 В
  for (const d of ['2026-07-10', '2026-07-11', '2026-07-12'])
    for (let m = 120; m < 300; m += 2) samples.push({ t: at(d, Math.floor(m / 60), m % 60), v: 12.7, soc: 90, temp: 18 });
  // поїздка з зарядкою 14,3 В
  for (let m = 0; m < 30; m += 2) samples.push({ t: at('2026-07-12', 18, m), v: 14.3, soc: 100, temp: 25 });
  const trips = [{ start: '2026-07-03 12:00', end: '2026-07-03 12:40', minutes: 40, km: 0 }, { start: '2026-07-12 18:00', end: '2026-07-12 18:30', minutes: 30, km: 0 },
    { start: '2026-07-12 19:00', end: '2026-07-12 19:05', minutes: 5, km: 0 }];
  const cranks = [{ t: '2026-07-03 12:00', v: 9.1, ms: 900, status: 'Bad' }, { t: '2026-07-12 18:00', v: 10.4, ms: 700, status: 'OK' }];
  D.importBm300({ samples, trips, cranks, charges: [] }, {}, null);
  // без дати заміни — усе разом
  const all = batterySummary('2026-07-20', { installed: '' });
  assert.ok(all.has && !all.previous);
  assert.strictEqual(all.discharges.length, 1);
  assert.deepStrictEqual([all.discharges[0].from, all.discharges[0].minV, all.discharges[0].minutes], ['2026-07-02 03:00', 9.05, 80]);
  assert.strictEqual(all.trips.total, 3 + 11);
  // з датою заміни
  D.setSettings({ batteryInstalled: '2026-07-04', batteryModel: 'Exide Premium EA770 77 Ah' });
  D.saveCost({ date: '2026-07-04', cat: 'parts', title: 'Акумулятор Exide', amount: 4200 }, null);
  const b = batterySummary('2026-11-14');
  assert.strictEqual(b.discharges.length, 0);
  assert.strictEqual(b.previous.discharges.length, 1);
  assert.strictEqual(b.previous.cranking.weak, 1);
  assert.strictEqual(b.cranking.weak, 0);
  assert.strictEqual(b.rest.health.level, 'ok');
  assert.strictEqual(b.rest.current, 12.7);
  assert.strictEqual(b.charging.verdict.level, 'ok');
  assert.strictEqual(b.model, 'Exide Premium EA770 77 Ah');
  assert.strictEqual(b.install.months, 4);
  assert.strictEqual(b.install.cost.amount, 4200);
  assert.strictEqual(b.latest.t, '2026-07-12 18:28');
  assert.strictEqual(b.ageDays, 125);
  assert.throws(() => D.setSettings({ batteryInstalled: 'вчора' }), e => e.status === 400);
});

test('усі 11 місячних файлів (якщо є поруч)', { skip: !UPLOADS || !fs.existsSync(UPLOADS) }, () => {
  const files = fs.readdirSync(UPLOADS).filter(f => f.endsWith('.xls'));
  for (const f of files) D.importBm300(parseBm300(fs.readFileSync(path.join(UPLOADS, f))), {}, null);
  const n = D.db.prepare('SELECT COUNT(*) n FROM bat_samples WHERE t < ?').get('2026-07-04').n;
  assert.ok(n > 100000);
  const b = batterySummary('2026-11-14', { installed: '' });
  assert.strictEqual(b.lowest.v, 8.15);
  assert.ok(b.discharges.some(e => e.from === '2026-07-02 17:41' && e.minV === 10.11), 'тривалий розряд 2 липня знайдено');
});
