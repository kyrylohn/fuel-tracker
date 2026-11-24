'use strict';
/* Імпорт CSV-копії Fuelio (Налаштування → Резервна копія → CSV, файл vehicle-N-sync.csv).
   Файл складається з розділів "## Vehicle", "## Log", "## CostCategories", "## Costs";
   у кожному свій рядок заголовків. Стовпці шукаємо за назвою, а не за номером. */

function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Розбиває текст на рядки з урахуванням переносів усередині лапок
function splitRows(text) {
  const rows = []; let cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') q = !q;
    if (!q && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      rows.push(cur); cur = '';
    } else cur += c;
  }
  if (cur) rows.push(cur);
  return rows;
}

function sections(text) {
  const out = {}; let name = null, header = null;
  for (const raw of splitRows(String(text).replace(/^﻿/, ''))) {
    if (!raw.trim()) continue;
    const cells = parseCsvLine(raw);
    const m = cells[0] && cells[0].match(/^##\s*(.+)$/);
    if (m) { name = m[1].trim().toLowerCase(); header = null; out[name] = []; continue; }
    if (!name) continue;
    if (!header) { header = cells.map(h => h.trim().toLowerCase()); continue; }
    const row = {};
    header.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
    out[name].push(row);
  }
  return out;
}

const pick = (row, ...prefixes) => {
  for (const p of prefixes) if (p in row) return row[p];
  for (const p of prefixes) for (const k of Object.keys(row)) if (k.startsWith(p + ' ') || k.startsWith(p + '(')) return row[k];
  return '';
};
const num = v => { const n = parseFloat(String(v || '').replace(',', '.')); return isFinite(n) ? n : 0; };
function date(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4] || '12'}:${m[5] || '00'}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')} ${(m[4] || '12').padStart(2, '0')}:${m[5] || '00'}`;
  return '';
}

function parseFuelio(text) {
  const s = sections(text);
  const log = s.log || [];
  if (!log.length && !(s.costs || []).length) throw new Error('Не схоже на CSV Fuelio: немає розділу "## Log"');

  const v = (s.vehicle || [])[0] || {};
  const vehicle = {
    name: pick(v, 'name') || '', make: pick(v, 'make'), model: pick(v, 'model'),
    plate: pick(v, 'plate'), year: pick(v, 'year'), tank: num(pick(v, 'tank1capacity'))
  };

  const fills = log.map(r => {
    const litres = num(pick(r, 'fuel'));
    const total = num(pick(r, 'price'));
    const vp = num(pick(r, 'volumeprice'));
    return {
      date: date(pick(r, 'data', 'date')),
      odo: num(pick(r, 'odo')),
      litres, total,
      price: vp || (litres ? Math.round(total / litres * 1000) / 1000 : 0),
      full: pick(r, 'full') === '1' ? 1 : 0,
      missed: pick(r, 'missed') === '1' ? 1 : 0,
      // коди типів пального Fuelio не документовані: тип береться з налаштувань авто
      fuel: '',
      station: pick(r, 'city'),
      note: pick(r, 'notes'),
      uid: pick(r, 'uniqueid')
    };
  }).filter(f => f.date && f.litres > 0);

  const cats = {};
  (s.costcategories || []).forEach(r => { cats[pick(r, 'costtypeid')] = pick(r, 'name'); });

  const costs = (s.costs || []).filter(r => pick(r, 'istemplate') !== '1' && pick(r, 'isincome') !== '1').map(r => ({
    date: date(pick(r, 'date')),
    odo: num(pick(r, 'odo')),
    title: pick(r, 'costtitle'),
    catName: cats[pick(r, 'costtypeid')] || '',
    amount: num(pick(r, 'cost')),
    note: pick(r, 'notes'),
    uid: pick(r, 'uniqueid')
  })).filter(c => c.date && c.amount > 0);

  return { vehicle, fills, costs };
}

module.exports = { parseFuelio, parseCsvLine, sections };
