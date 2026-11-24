'use strict';
const I18N = require('../public/i18n.js');
const _t = I18N.t;
/* Курс НБУ (офіційний) на дату. Кеш — таблиця meta, ключ fx:USD:<дата>. Майбутня дата → сьогодні. */
const D = require('./db');

function today() { return new Date().toLocaleDateString('sv-SE'); }

async function rate(date, code) {
  code = String(code || 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error(_t('Невідома валюта'));
  let day = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today()) day = today();
  const key = `fx:${code}:${day}`;
  const hit = D.db.prepare('SELECT v FROM meta WHERE k = ?').get(key);
  if (hit && Number(hit.v) > 0) return { rate: Number(hit.v), date: day };
  const url = `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=${code}&date=${day.replace(/-/g, '')}&json`;
  const r = await fetch(url, { headers: { 'User-Agent': 'fuel-tracker/1.0' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(_t('НБУ: ') + r.status);
  const j = await r.json();
  const v = Array.isArray(j) && j[0] && Number(j[0].rate);
  if (!(v > 0)) throw new Error(_t('НБУ: немає курсу на ') + day);
  D.db.prepare('INSERT INTO meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(key, String(v));
  return { rate: v, date: day };
}
module.exports = { rate };
