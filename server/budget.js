'use strict';
const I18N = require('../public/i18n.js');
const _t = I18N.t;
/* Зв'язок із «Сімейним бюджетом»: кожна заправка/витрата стає витратою в Бюджеті
   з id "fuel-f-…" / "fuel-c-…". Зміни лягають у чергу (таблиця outbox) і відправляються
   у фоні; якщо Бюджет недоступний — повтор кожні 5 хвилин. */
const D = require('./db');

const URL_ = (process.env.BUDGET_URL || 'http://budget:8080').replace(/\/$/, '');
const TOKEN = process.env.BUDGET_HOOK_TX_TOKEN || '';
const configured = () => TOKEN.length >= 32;

async function call(method, path, body) {
  const res = await fetch(URL_ + path, {
    method, signal: AbortSignal.timeout(10000),
    headers: Object.assign({ Authorization: 'Bearer ' + TOKEN }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error((data && data.error) || _t('Бюджет відповів {status}', { status: res.status }));
  return data;
}

// Рахунки й категорії витрат Бюджету — для налаштувань
async function refs() {
  if (!configured()) throw D.httpError(503, _t('Зв\'язок з Бюджетом не налаштовано (BUDGET_HOOK_TX_TOKEN)'));
  try { return await call('GET', '/api/hook/refs'); }
  catch (e) { throw D.httpError(502, _t('Бюджет недоступний: ') + e.message); }
}

let running = false;
async function flush() {
  if (!configured() || running) return { skipped: true };
  running = true;
  let ok = 0, fail = 0;
  try {
    for (const item of D.outboxPending()) {
      try {
        if (item.payload) await call('POST', '/api/hook/tx', JSON.parse(item.payload));
        else await call('POST', '/api/hook/tx/delete', { id: item.txid });
        D.outboxDone(item.txid, item.payload);
        ok++;
      } catch (e) {
        D.outboxFailed(item.txid, e.message);
        fail++;
        if (/ECONNREFUSED|fetch failed|timeout|aborted/i.test(String(e.message || e.cause))) break; // Бюджет лежить — далі не пробуємо
      }
    }
  } finally { running = false; }
  if (ok || fail) console.log(`budget sync: ok ${ok}, fail ${fail}`);
  return { ok, fail };
}

let timer = null;
function kick() { clearTimeout(timer); timer = setTimeout(() => flush().catch(e => console.error('budget', e)), 300); }
function start() {
  if (!configured()) { console.log("budget sync: вимкнено (немає BUDGET_HOOK_TX_TOKEN)"); return; }
  kick();
  setInterval(() => flush().catch(e => console.error('budget', e)), 5 * 60e3).unref();
}

module.exports = { refs, flush, kick, start, configured };
