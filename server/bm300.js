'use strict';
const I18N = require('../public/i18n.js');
const _t = I18N.t;
/* Імпорт звіту BM300 Pro (Data Report .xls): History (вольтаж/заряд/температура кожні 2 хв, групи по 5 стовпців на день),
   Cranking (пуски), Charging (зарядка від генератора), Trip (поїздки). Аркуші розпізнаємо за суфіксом назви.
   Усі клітинки — рядки з табуляціями навколо; час локальний (Київ), зберігаємо як РРРР-ММ-ДД ГГ:ХХ, як у заправках. */
const { readXls } = require('./xls');

const MONTHS = {
  'січ': 1, 'лют': 2, 'бер': 3, 'квіт': 4, 'трав': 5, 'черв': 6, 'лип': 7, 'серп': 8, 'вер': 9, 'жовт': 10, 'лист': 11, 'груд': 12,
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};
const DATE_RE = /^([A-Za-zА-Яа-яіїєґІЇЄҐ]+)\.?\s+(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/;
const p2 = n => String(n).padStart(2, '0');

function parseDate(s) {
  const m = DATE_RE.exec(String(s).trim());
  if (!m) return null;
  const mo = MONTHS[m[1].toLowerCase()];
  if (!mo) return null;
  const d = +m[2], h = +m[4], mi = +m[5];
  if (d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return `${m[3]}-${p2(mo)}-${p2(d)} ${p2(h)}:${m[5]}`;
}
const cell = v => String(v ?? '').trim();
const num = v => { const m = /^-?\d+(?:[.,]\d+)?/.exec(cell(v)); return m ? parseFloat(m[0].replace(',', '.')) : NaN; };
const minutesOf = s => {
  const t = cell(s); let min = 0, any = false;
  for (const [re, k] of [[/(\d+)\s*Day/i, 1440], [/(\d+)\s*Hour/i, 60], [/(\d+)\s*Min/i, 1], [/(\d+)\s*Sec/i, 1 / 60]]) {
    const m = re.exec(t); if (m) { min += +m[1] * k; any = true; }
  }
  return any ? Math.round(min) : NaN;
};
const diffMin = (a, b) => Math.round((Date.parse(b.replace(' ', 'T') + 'Z') - Date.parse(a.replace(' ', 'T') + 'Z')) / 6e4);

function parseBm300(buf) {
  const sheets = readXls(buf);
  const by = suffix => sheets.find(s => s.name.trim().toLowerCase().endsWith(suffix));
  const hist = by('history report');
  if (!hist) { const e = new Error(_t('Це не файл .xls з BM300')); e.status = 400; throw e; }
  const out = { device: cell(hist.rows[2]?.[0]).slice(0, 40), samples: [], cranks: [], charges: [], trips: [] };

  for (let r = 4; r < hist.rows.length; r++) {
    const row = hist.rows[r];
    for (let c = 0; c + 3 < row.length; c += 5) {
      const t = parseDate(row[c]);
      if (!t) continue;
      const v = num(row[c + 1]), soc = num(row[c + 2]), temp = num(row[c + 3]);
      if (!(v > 0 && v < 40)) continue;
      out.samples.push({ t, v, soc: isNaN(soc) ? null : Math.round(soc), temp: isNaN(temp) ? null : Math.round(temp) });
    }
  }
  const tableRows = sh => (sh ? sh.rows.slice(2) : []);
  for (const r of tableRows(by('cranking report'))) {
    const t = parseDate(r[0]); if (!t) continue;
    out.cranks.push({ t, v: num(r[1]), ms: Math.round(num(r[2])) || 0, status: cell(r[3]).slice(0, 20) });
  }
  for (const r of tableRows(by('charging report'))) {
    const t = parseDate(r[0]); if (!t) continue;
    out.charges.push({ t, idle: num(r[1]), high: num(r[2]), ripple: num(r[3]), status: cell(r[4]).slice(0, 20) });
  }
  for (const r of tableRows(by('trip report'))) {
    const start = parseDate(r[0]); if (!start) continue; // рядок «Total» і заголовки
    const end = parseDate(r[1]) || start;
    let minutes = minutesOf(r[2]);
    if (isNaN(minutes)) minutes = Math.max(0, diffMin(start, end));
    out.trips.push({ start, end, minutes, km: num(r[7]) || 0 });
  }
  return out;
}

module.exports = { parseBm300, parseDate };
