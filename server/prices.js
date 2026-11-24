'use strict';
const I18N = require('../public/i18n.js');
const _t = I18N.t;
/* Ціни на пальне поблизу.
   - WOG: api.wog.ua — список АЗС з координатами + картка АЗС з цінами (у копійках) і переліком наявного пального.
   - ОККО: okko.ua/api — АЗС з координатами й наявністю (без цін), ціну беремо мережеву з Мінфіну.
   - Мінфін: index.minfin.com.ua/ua/markets/fuel/reg/<область>/ — ціни всіх мереж області.
   Оновлення кожні 3 години; щоденний знімок цін мереж іде в історію (price_days) — з нього поради щодо гаманця. */
const D = require('./db');
const C = require('../public/calc.js');

const UA = 'Mozilla/5.0 (compatible; fuel-tracker/1.0)';
const KEYS = { a95p: 'А-95+', a95: 'А-95', a92: 'А-92', a100: 'А-100', dp: 'ДП', dpp: 'ДП+', gas: 'Газ' };
const BIG = ['WOG', 'ОККО', 'SOCAR', 'UKRNAFTA', 'БРСМ-Нафта', 'AMIC', 'UPG'];

// Пальне з налаштувань → ключ ціни
function fuelKey(name) {
  const s = String(name || '').toLowerCase();
  if (/газ/.test(s)) return 'gas';
  if (/дп|дизель/.test(s)) return /mustang|pulls|\+|преміум/.test(s) ? 'dpp' : 'dp';
  if (/100/.test(s)) return 'a100';
  if (/92/.test(s)) return 'a92';
  if (/95/.test(s)) return /mustang|pulls|\+|преміум|energy|nano|v-power/.test(s) ? 'a95p' : 'a95';
  return 'a95';
}

async function get(url, json = true) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return json ? r.json() : r.text();
}
const km = (a, b) => {
  const dy = (a.lat - b.lat) * 111.2, dx = (a.lng - b.lng) * 111.2 * Math.cos(a.lat * Math.PI / 180);
  return Math.round(Math.hypot(dx, dy) * 10) / 10;
};
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

/* ---------- Мінфін: мережі області ---------- */
function parseMinfin(html) {
  const tables = html.match(/<table[\s\S]*?<\/table>/g) || [];
  const t = tables.find(x => /Оператор/.test(x));
  if (!t) throw new Error(_t('Мінфін: немає таблиці операторів'));
  const out = {};
  for (const row of t.match(/<tr[\s\S]*?<\/tr>/g) || []) {
    const cells = (row.match(/<td[^>]*>[\s\S]*?<\/td>/g) || []).map(c => strip(c));
    if (cells.length < 6) continue;
    // Оператор | (порожньо) | А-95+ | А-95 | А-92 | ДП | Газ
    const vals = cells.slice(-5).map(v => { const n = parseFloat(v.replace(',', '.')); return n > 0 ? n : null; });
    const [a95p, a95, a92, dp, gas] = vals;
    out[cells[0]] = { a95p, a95, a92, dp, gas };
  }
  if (!Object.keys(out).length) throw new Error(_t('Мінфін: порожня таблиця'));
  return out;
}

/* ---------- WOG ---------- */
function wogKey(f) {
  const n = String(f.name || ''), b = String(f.brand || '').toLowerCase();
  if (/газ/i.test(n)) return 'gas';
  if (/дп/i.test(n)) return /mustang/.test(b) ? 'dpp' : 'dp';
  if (n === '100') return 'a100';
  if (n === '92') return 'a92';
  if (n === '95') return /mustang/.test(b) ? 'a95p' : 'a95';
  return null;
}
// Рядки опису «А-95 М - Готівка…» — пальне, яке зараз продають; «… - відсутнє» / «лише для…» — обмеження
function wogAvailability(desc) {
  const avail = {}, notes = [];
  for (const line of String(desc || '').split('\n').map(s => s.trim()).filter(Boolean)) {
    const m = line.match(/^(М-100|А-95 М|А-95|А-92|ДП|МДП\+|ГАЗ)\s*[-–]\s*(.*)$/i);
    if (!m) { if (!/графіку|24\/7/i.test(line)) notes.push(line); continue; }
    const k = { 'м-100': 'a100', 'а-95 м': 'a95p', 'а-95': 'a95', 'а-92': 'a92', 'дп': 'dp', 'мдп+': 'dpp', 'газ': 'gas' }[m[1].toLowerCase()];
    avail[k] = !/відсутн|немає|не прац/i.test(m[2]);
    if (/лише|тільки|ліміт до|обмеж/i.test(m[2]) && !/ліміт картки/i.test(m[2])) notes.push(line);
  }
  return { avail, notes };
}
async function fetchWog(center, radius) {
  const list = (await get('https://api.wog.ua/fuel_stations')).data.stations
    .map(s => ({ id: s.id, lat: s.coordinates.latitude, lng: s.coordinates.longitude, name: s.name }))
    .map(s => Object.assign(s, { km: km(center, s) })).filter(s => s.km <= radius).sort((a, b) => a.km - b.km).slice(0, 25);
  const out = [];
  for (let i = 0; i < list.length; i += 4) {
    const chunk = await Promise.all(list.slice(i, i + 4).map(async s => {
      try {
        const d = (await get(`https://api.wog.ua/fuel_stations/${s.id}`)).data;
        const prices = {};
        (d.fuels || []).forEach(f => { const k = wogKey(f); if (k && f.price > 0) prices[k] = f.price / 100; });
        const { avail, notes } = wogAvailability(d.workDescription);
        return { net: 'WOG', id: 'wog-' + s.id, lat: s.lat, lng: s.lng, km: s.km,
          address: String(d.name || s.name).replace(/^[^,]*област[ьі],\s*/i, '').replace(/^м\.\s?Дніпро,\s*/i, ''), prices, avail, notes: notes.slice(0, 3) };
      } catch (e) { return null; }
    }));
    out.push(...chunk.filter(Boolean));
  }
  return out;
}

/* ---------- ОККО ---------- */
async function fetchOkko(center, radius) {
  const d = await get('https://www.okko.ua/api/uk/type/gas_stations');
  const map = { a95p: 'pulls95_tip_oplati', a95: 'a95_evro_tip_oplati', a92: 'a92_evro_tip_oplati', a100: 'pulls100_tip_oplati', dp: 'dp_evro_tip_oplati', dpp: 'pulls_diesel_tip_oplati', gas: 'gas_tip_oplati' };
  return (d.collection || []).map(x => x.attributes).filter(a => a.coordinates && a.coordinates.lat)
    .map(a => {
      const s = { lat: a.coordinates.lat, lng: a.coordinates.lng };
      const avail = {}; for (const [k, f] of Object.entries(map)) avail[k] = !!a[f];
      return { net: 'ОККО', id: 'okko-' + (a.Cod_AZK || a.Adresa), lat: s.lat, lng: s.lng, km: km(center, s),
        address: [a.Typ_naselenogo_punktu, a.Naselenyy_punkt].filter(Boolean).join(' ') + ', ' + strip(a.Adresa), prices: {}, avail,
        // з довгого HTML-оголошення лишаємо лише речення про обмеження (немає пального, лише готівка тощо)
        notes: strip(a.notification).split(/(?<=[.!])\s+/).filter(x => /відсутн|немає пальн|лише готівк|тільки готівк|обмеж|не працює/i.test(x)).slice(0, 2) };
    }).filter(s => s.km <= radius).sort((a, b) => a.km - b.km).slice(0, 25);
}

/* ---------- оновлення, історія, поради ---------- */
const getMeta = k => { const r = D.db.prepare('SELECT v FROM meta WHERE k = ?').get(k); try { return r ? JSON.parse(r.v) : null; } catch { return null; } };
const setMeta = (k, v) => D.db.prepare('INSERT INTO meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v));
D.db.exec(`CREATE TABLE IF NOT EXISTS price_days (day TEXT NOT NULL, net TEXT NOT NULL, fuel TEXT NOT NULL, price REAL NOT NULL,
  PRIMARY KEY (day, net, fuel))`);
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });

function history(net, fuel, days = 400) {
  return D.db.prepare('SELECT day, price FROM price_days WHERE net = ? AND fuel = ? ORDER BY day DESC LIMIT ?').all(net, fuel, days).map(r => ({ day: r.day, price: r.price })).reverse();
}
// Попередня відмінна ціна мережі (до останньої зміни) — щоб бачити «підняли / не підняли»
function lastChange(net, fuel) {
  const h = history(net, fuel, 60);
  if (!h.length) return null;
  const cur = h[h.length - 1];
  for (let i = h.length - 2; i >= 0; i--) if (h[i].price !== cur.price) return { from: h[i].price, to: cur.price, day: h[i + 1].day };
  return { from: cur.price, to: cur.price, day: null };
}

// поради йдуть у Home Assistant (advice_text) — завжди українською, незалежно від мови інтерфейсу
function computeAdvice(nets, key, wallet) { return I18N.runWith('uk', () => computeAdviceUk(nets, key, wallet)); }
function computeAdviceUk(nets, key, wallet) {
  const s = D.getSettings();
  const fuelLabel = s.fuel || KEYS[key];
  const prev = getMeta('prices:advice') || {};
  const out = { ...prev };
  const wog = nets.WOG && nets.WOG[key];
  const day = today();
  // 1) Інші великі мережі вже підняли ціну, а WOG ще ні — поповнити гаманець за старою ціною
  const raised = BIG.filter(n => n !== 'WOG' && nets[n] && nets[n][key]).filter(n => {
    const c = lastChange(n, key); return c && c.day && c.to > c.from && c.day >= addDays(day, -3);
  });
  const wogC = lastChange('WOG', key);
  const wogRaisedRecently = wogC && wogC.day && wogC.to > wogC.from && wogC.day >= addDays(day, -3);
  if (wog && raised.length >= 2 && !wogRaisedRecently) {
    const id = `raise-${day}-${key}`;
    if (prev.id !== id && !(prev.kind === 'raise' && prev.day >= addDays(day, -5)))
    {
      const bn = bonusNow(key, day);
      const extra = bn.azk > bn.wallet ? ` ${_t('Зважте: на АЗК зараз {azk} ₴/л бонусами, за гаманець — {wallet} ₴/л; гаманець виграє, якщо WOG підніме більш ніж на {wallet2} ₴.', { azk: fmt(bn.azk), wallet: fmt(bn.wallet), wallet2: fmt(bn.azk - bn.wallet) })}` : '';
      Object.assign(out, { id, kind: 'raise', day, text: _t('{join} підняли {fuelLabel}, а WOG ще тримає {wog} ₴. Схоже, скоро підніме й WOG — вигідно поповнити гаманець зараз.{extra}', { join: raised.join(', '), fuelLabel, wog: fmt(wog), extra }) });
    }
  }
  // 2) WOG підняв ціну — скільки зекономив гаманець
  if (wogRaisedRecently && wogC.day === day && wallet && wallet.litres > 0) {
    const id = `wog-${day}-${key}`;
    if (prev.id !== id) {
      const avg = wallet.value / wallet.litres;
      Object.assign(out, { id, kind: 'wog', day, text: _t('WOG підняв {fuelLabel}: {from} → {to} ₴. У гаманці {litres} л по {avg} ₴ — це вже {litres2} ₴ вигоди.', { fuelLabel, from: fmt(wogC.from), to: fmt(wogC.to), litres: fmt(wallet.litres), avg: fmt(avg), litres2: fmt((wogC.to - avg) * wallet.litres, 0) }) });
    }
  }
  // 3) Гаманець майже порожній (раз на тиждень)
  if (wallet && wallet.litres < 15 && (D.listTopups() || []).length) {
    const id = `low-${day}`;
    if (!(prev.kind === 'low' && prev.day >= addDays(day, -7)) && prev.id !== id && out.id === prev.id)
      Object.assign(out, { id, kind: 'low', day, text: _t('У гаманці WOG лишилось {litres} л. Ціна зараз {wog}; поповнюйте, коли є вільні гроші — ціни здебільшого лише ростуть.', { litres: fmt(wallet.litres), wog: wog ? fmt(wog) + ' ₴' : _t('невідома') }) });
  }
  setMeta('prices:advice', out);
  return out;
}
const fmt = (n, d = 2) => Number(n).toLocaleString(I18N.locale(), { maximumFractionDigits: d });
function addDays(day, n) { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

let running = null;
async function refresh(walletFn) {
  if (running) return running;
  running = (async () => {
    const s = D.getSettings();
    const center = { lat: +s.homeLat, lng: +s.homeLng };
    const radius = +s.priceRadius || 15;
    const res = { ts: Date.now(), center, radius, errors: [] };
    try { res.nets = parseMinfin(await get(`https://index.minfin.com.ua/ua/markets/fuel/reg/${encodeURIComponent(s.priceRegion)}/`, false)); }
    catch (e) { res.errors.push(_t('Мінфін: ') + e.message); res.nets = (getMeta('prices:latest') || {}).nets || {}; }
    try { res.wog = await fetchWog(center, radius); } catch (e) { res.errors.push('WOG: ' + e.message); res.wog = (getMeta('prices:latest') || {}).wog || []; }
    try { res.okko = await fetchOkko(center, radius); } catch (e) { res.errors.push('ОККО: ' + e.message); res.okko = (getMeta('prices:latest') || {}).okko || []; }
    // WOG у Мінфіні може відставати — беремо медіану цін АЗС WOG поблизу
    const wogMed = {};
    for (const k of Object.keys(KEYS)) {
      const v = res.wog.map(x => x.prices[k]).filter(Boolean).sort((a, b) => a - b);
      if (v.length) wogMed[k] = v[Math.floor(v.length / 2)];
    }
    if (Object.keys(wogMed).length) res.nets.WOG = Object.assign({}, res.nets.WOG || {}, wogMed);
    const day = today();
    const ins = D.db.prepare('INSERT INTO price_days(day, net, fuel, price) VALUES (?, ?, ?, ?) ON CONFLICT(day, net, fuel) DO UPDATE SET price = excluded.price');
    for (const [net, p] of Object.entries(res.nets)) for (const [k, v] of Object.entries(p)) if (v) ins.run(day, net, k, v);
    // ОККО: мережева ціна з Мінфіну
    res.okko.forEach(st => { for (const k of Object.keys(KEYS)) if (st.avail[k] && res.nets['ОККО'] && res.nets['ОККО'][k]) st.prices[k] = res.nets['ОККО'][k]; });
    setMeta('prices:latest', res);
    res.advice = computeAdvice(res.nets, fuelKey(s.fuel), walletFn ? walletFn() : null);
    if (res.errors.length) console.log('prices:', res.errors.join('; '));
    return res;
  })().finally(() => { running = null; });
  return running;
}

function latest() { return getMeta('prices:latest'); }
function advice() { return getMeta('prices:advice') || {}; }

// Бонуси WOG на сьогодні: ₴/л для АЗК і для поповнення гаманця
function bonusNow(key, day = today(), price) {
  const list = D.getSettings().wogBonuses || [];
  if (price === undefined) { const p = latest(); price = p && p.nets && p.nets.WOG ? p.nets.WOG[key] : 0; }
  return { azk: C.bonusFor(list, 'WOG', key, 'azk', price, day), wallet: C.bonusFor(list, 'WOG', key, 'wallet', price, day) };
}

// Що показати на головній: найдешевші мережі для мого пального, WOG поруч, гаманець
function overview(wallet) {
  const p = latest();
  if (!p) return null;
  const s = D.getSettings();
  const key = fuelKey(s.fuel);
  const label = KEYS[key];
  const bn = bonusNow(key);
  const blist = s.wogBonuses || [];
  // Порівнюємо ціни за вирахуванням бонусів кожної мережі: ними потім платять як гривнями
  const nets = Object.entries(p.nets || {}).filter(([, v]) => v[key])
    .map(([net, v]) => { const b = C.bonusFor(blist, net, key, 'azk', v[key]); return { net, price: v[key], bonus: b, eff: Math.round((v[key] - b) * 100) / 100 }; })
    .sort((a, b) => a.eff - b.eff);
  const stations = (p.wog || []).concat(p.okko || []).filter(x => x.prices[key] && x.avail[key] !== false).sort((a, b) => a.km - b.km);
  const wogNow = p.nets.WOG && p.nets.WOG[key];
  const c = lastChange('WOG', key);
  return {
    ts: p.ts, key, label, fuel: s.fuel, nets, cheapest: nets[0] || null, wog: wogNow || null,
    bonus: bn, wogEff: wogNow ? Math.round((wogNow - bn.azk) * 100) / 100 : null,
    walletEff: wogNow && bn.wallet ? Math.round((wogNow - bn.wallet) * 100) / 100 : null,
    wogChange: c && c.day ? c : null, nearest: stations.slice(0, 3),
    wallet: wallet && wallet.litres > 0 ? { litres: wallet.litres, price: Math.round(wallet.value / wallet.litres * 100) / 100,
      gain: wogNow ? Math.round((wogNow - wallet.value / wallet.litres) * wallet.litres) : null } : null,
    trend: history('WOG', key, 90), errors: p.errors
  };
}

let timer = null;
function start(walletFn) {
  const tick = () => {
    const p = latest();
    if (!p || Date.now() - p.ts > 3 * 3600e3 - 60e3) refresh(walletFn).catch(e => console.error('prices', e.message));
  };
  setTimeout(tick, 5000);
  timer = setInterval(tick, 15 * 60e3); timer.unref();
}

module.exports = { refresh, latest, overview, advice, start, fuelKey, parseMinfin, wogAvailability, computeAdvice, bonusNow, KEYS, history };
