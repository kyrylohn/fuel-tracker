'use strict';
const I18N = require('../public/i18n.js');
const _t = I18N.t;
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const D = require('./db');
const B = require('./budget');
const C = require('../public/calc.js');
const { parseFuelio } = require('./fuelio');
const { parseFuelNotification } = require('./wog');
const P = require('./prices');
const SV = require('./service');
const { parseBm300 } = require('./bm300');
const { batterySummary } = require('./battery');
const W = require('./wishlist');
const FX = require('./fx');

const PORT = Number(process.env.PORT || 8080);
const PUBLIC = path.join(__dirname, '..', 'public');
const VERSION = (() => { try { return require('../package.json').version; } catch { return 'dev'; } })();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), interest-cohort=()'
};

function send(res, status, body, headers = {}) {
  const raw = Buffer.isBuffer(body) || typeof body === 'string';
  res.writeHead(status, Object.assign({}, SECURITY_HEADERS,
    raw ? {} : { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
  res.end(raw ? body : JSON.stringify(body));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(D.httpError(413, _t('Файл завеликий'))); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw D.httpError(415, _t('Очікую JSON'));
  const buf = await readBody(req, 1024 * 1024);
  try { return buf.length ? JSON.parse(buf.toString('utf8')) : {}; } catch { throw D.httpError(400, _t('Некоректний JSON')); }
}
function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
const isHttps = req => req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === '1';
const sessionCookie = (req, value, maxAge) => `sid=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;

// XFF довіряємо лише від Caddy: його IP у docker-мережі змінюється, тож резолвимо імена
const stripV4 = a => String(a || '').replace(/^::ffff:/i, '');
const trusted = new Set(String(process.env.TRUSTED_PROXIES || '').split(',').map(s => stripV4(s.trim())).filter(Boolean));
let resolved = new Set();
async function refreshTrusted() {
  const hosts = String(process.env.TRUSTED_PROXY_HOSTS ?? 'caddy').split(',').map(s => s.trim()).filter(Boolean);
  const next = new Set();
  for (const h of hosts) {
    try { for (const a of await require('node:dns').promises.lookup(h, { all: true })) next.add(stripV4(a.address)); } catch {}
  }
  resolved = next;
}
refreshTrusted();
setInterval(refreshTrusted, 5 * 60e3).unref();
function clientIp(req) {
  const peer = stripV4(req.socket.remoteAddress);
  if (trusted.has(peer) || resolved.has(peer)) {
    const last = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (last) return stripV4(last);
  }
  return peer;
}

const FAIL_WINDOW = 15 * 60e3, FAIL_PER_IP = 8, FAIL_GLOBAL = 30, FAILS_MAX = 1000;
const fails = new Map();
let globalFails = { count: 0, until: 0 };
const loginAllowed = ip => {
  if (globalFails.until >= Date.now() && globalFails.count >= FAIL_GLOBAL) return false;
  const f = fails.get(ip); if (!f) return true; if (f.until < Date.now()) { fails.delete(ip); return true; } return f.count < FAIL_PER_IP;
};
function loginFailed(ip) {
  const t = Date.now();
  if (globalFails.until < t) globalFails = { count: 1, until: t + FAIL_WINDOW }; else globalFails.count++;
  const f = fails.get(ip);
  if (!f || f.until < t) {
    if (fails.size >= FAILS_MAX) {
      for (const [k, v] of fails) if (v.until < t) fails.delete(k);
      while (fails.size >= FAILS_MAX) fails.delete(fails.keys().next().value);
    }
    fails.set(ip, { count: 1, until: t + FAIL_WINDOW });
  } else f.count++;
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  if (rel === '/login') rel = '/login.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    const longCache = /\/(fonts|icons)\//.test(file);
    const headers = {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': longCache ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Last-Modified': st.mtime.toUTCString()
    };
    if (!longCache && req.headers['if-modified-since'] && new Date(req.headers['if-modified-since']) >= new Date(st.mtime.toUTCString())) {
      res.writeHead(304, Object.assign({}, SECURITY_HEADERS, headers)); return res.end();
    }
    res.writeHead(200, Object.assign({}, SECURITY_HEADERS, headers));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------- хуки для Home Assistant ----------
   FUEL_HOOK_TOKEN: прийом push-сповіщень із телефона, дописування пробігу, зведення для сенсора.
   Без правильного токена ендпоінти поводяться як неіснуючі. */
function hookAllowed(req) {
  const want = process.env.FUEL_HOOK_TOKEN || '';
  if (want.length < 32) return false;
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const pad = n => String(n).padStart(2, '0');
const localStamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtNum = (n, d = 2) => Number(n).toLocaleString(I18N.locale(), { maximumFractionDigits: d });

const priced = () => { const all = D.getAll(); const w = C.applyWallet(all.fills, all.topups); return Object.assign(all, { fills: w.fills, wallet: w.balance }); };
const withService = all => Object.assign(all, { service: SV.compute(all, { weather: SV.weather() }) });
function draftMessage(f) {
  const last = D.lastFill();
  const parts = [f.litres ? fmtNum(f.litres) + _t(' л') : '', f.fuel, f.pay === 'wallet' ? _t('з гаманця') : f.total ? fmtNum(f.total) + ' ₴' : '',
    f.bonus ? _t('+ {bonus} ₴ бонусами', { bonus: fmtNum(f.bonus) }) : ''].filter(Boolean).join(' · ');
  return `${_t('{parts}. Який пробіг?', { parts })}${last ? ` ${_t('Минулого разу {odo} км.', { odo: fmtNum(last.odo, 0) })}` : ''}`;
}

function summary() {
  const all = priced();
  const s = C.stats(all.fills, all.costs);
  const m = localStamp().slice(0, 7);
  const month = C.stats(all.fills, all.costs, { from: m + '-01', to: m + '-31' });
  const last = D.lastFill();
  const drafts = all.fills.filter(f => f.status === 'draft');
  return {
    avg_cons: s.avgCons, last_cons: s.lastCons, fuel_per_km: s.fuelPerKm, total_per_km: s.totalPerKm,
    month_fuel: month.fuelSpend, month_costs: month.costSpend, month_litres: month.litres,
    last_date: last ? last.date : null, last_odo: last ? last.odo : null, last_price: last ? last.price : null,
    drafts: drafts.length, draft_id: drafts[0] ? drafts[0].id : null, budget_pending: all.budget.pending,
    wallet_litres: all.wallet.litres,
    ...priceSummary(),
    ...SV.haSummary(SV.compute(all, { weather: SV.weather() }))
  };
}

function priceSummary() {
  const o = P.overview(priced().wallet), a = P.advice();
  return {
    price_mine: o && o.wog, price_cheapest: o && o.cheapest ? o.cheapest.price : null, price_cheapest_net: o && o.cheapest ? o.cheapest.net : null,
    advice_id: a.id || null, advice_text: a.text || null, advice_kind: a.kind || null
  };
}

async function handleHook(req, res, p) {
  if (!hookAllowed(req)) throw D.httpError(404, _t('Немає такого методу'));
  if (p === '/api/hook/summary' && req.method === 'GET') return send(res, 200, summary());

  if (p === '/api/hook/notify' && req.method === 'POST') {
    const b = await readJson(req);
    const title = String(b.title || '').slice(0, 300), text = String(b.text || '').slice(0, 2000);
    const pkg = String(b.package || '').slice(0, 100);
    if (/icw/i.test(pkg)) {
      const all = `${title}\n${text}`;
      const m = all.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:грн|₴|uah)/i);
      const when = String(b.when || '').slice(0, 40);
      const key = crypto.createHash('sha256').update(['icw', pkg, title, text, when || localStamp()].join('\n')).digest('hex');
      if (D.hookSeen(key)) return send(res, 200, { status: 'duplicate' });
      // оплата, а не реклама: є сума і слово про оплату/списання (або сума зі знаком мінус)
      if (!m || /акці|знижк|подарун|промо/i.test(all) && !/оплат|списан|сплач/i.test(all)) { D.hookRecord(key, null, `${pkg}\n${title}\n${text}`); return send(res, 200, { status: 'ignored' }); }
      const amount = +m[1].replace(',', '.');
      const bm = all.match(/бонус\w*[^\d]{0,20}(\d+(?:[.,]\d{1,2})?)/i);
      const c = D.washAdd({ date: localStamp(), amount, bonus: bm ? +bm[1].replace(',', '.') : 0 }, null);
      D.hookRecord(key, c.id, `${pkg}\n${title}\n${text}`);
      B.kick();
      return send(res, 200, { status: 'wash', id: c.id, message: _t('+{amount} ₴, за сьогодні {amount2} ₴', { amount: fmtNum(amount), amount2: fmtNum(c.amount) }) });
    }
    const parsed = parseFuelNotification(title, text);
    if (!parsed) return send(res, 200, { status: 'ignored' });
    const day = localStamp().slice(0, 10);
    const key = crypto.createHash('sha256').update([pkg, title, text, day].join('\n')).digest('hex');
    const seen = D.hookSeen(key);
    if (seen) {
      const f = seen.fill_id && D.getFill(seen.fill_id);
      return send(res, 200, { status: 'duplicate', id: seen.fill_id, draft: !!(f && f.status === 'draft') });
    }
    const s = D.getSettings();
    const acct = s.budgetEnabled ? s.budgetAccount : '';
    if (parsed.kind === 'topup') {
      const t = D.saveTopup({ date: localStamp(), litres: parsed.litres, amount: parsed.total, fuel: parsed.fuel || s.fuel, earned: parsed.earned, budget_account: acct }, null, { source: 'notify' });
      D.hookRecord(key, t.id, `${pkg}\n${title}\n${text}`);
      B.kick();
      const bal = priced().wallet;
      return send(res, 200, { status: 'topup', id: t.id, topup: t,
        message: _t('+{litres} л {fuel} за {amount} ₴. У гаманці {litres2} л.', { litres: fmtNum(t.litres), fuel: t.fuel, amount: fmtNum(t.amount), litres2: fmtNum(bal.litres) }) });
    }
    const fill = D.saveFill({
      date: localStamp(), odo: 0, litres: parsed.litres, price: parsed.price, total: parsed.total, bonus: parsed.bonus, earned: parsed.earned,
      pay: parsed.kind === 'wallet' ? 'wallet' : 'money', keepPrice: false,
      full: true, fuel: parsed.fuel || s.fuel, station: /wog/i.test(title + text + pkg) ? 'WOG' : '',
      budget_account: acct
    }, null, { draft: true, source: 'notify' });
    D.hookRecord(key, fill.id, `${pkg}\n${title}\n${text}`);
    B.kick();
    return send(res, 200, { status: 'created', id: fill.id, fill, message: draftMessage(fill) });
  }

  if (p === '/api/hook/odo' && req.method === 'POST') {
    const b = await readJson(req);
    // без id — найсвіжіша чернетка (відповідь на сповіщення з телефона)
    const f = b.id ? D.getFill(b.id) : D.listFills().find(x => x.status === 'draft');
    if (!f) throw D.httpError(404, b.id ? _t('Немає такої заправки') : _t('Немає чернеток, яким потрібен пробіг'));
    const odo = Number(String(b.odo ?? '').replace(/[^\d.,]/g, '').replace(',', '.'));
    if (!(odo > 0)) throw D.httpError(400, _t('Не бачу числа пробігу'));
    const patch = { id: f.id, odo };
    if (b.full !== undefined) patch.full = !!b.full;
    const saved = D.saveFill(patch, null);
    B.kick();
    const seg = C.segments(priced().fills)[saved.id];
    return send(res, 200, { ok: true, fill: saved, cons: seg ? Math.round(seg.cons * 100) / 100 : null,
      message: seg ? _t('Записано: {odo} км, витрата {cons} л/100 км', { odo: fmtNum(odo, 0), cons: fmtNum(seg.cons) }) : _t('Записано: {odo} км', { odo: fmtNum(odo, 0) }) });
  }
  throw D.httpError(404, _t('Немає такого методу'));
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  if (p.startsWith('/api/hook/')) return handleHook(req, res, p);

  if (p === '/api/login' && req.method === 'POST') {
    const ip = clientIp(req);
    if (!loginAllowed(ip)) throw D.httpError(429, _t('Забагато спроб. Спробуйте за 15 хвилин.'));
    const { login, password } = await readJson(req);
    const u = await D.checkLogin(login, password);
    if (!u) { loginFailed(ip); throw D.httpError(401, _t('Неправильний логін або пароль')); }
    fails.delete(ip);
    const s = D.createSession(u.id, req.headers['user-agent']);
    return send(res, 200, { ok: true, user: D.publicUser(u) }, { 'Set-Cookie': sessionCookie(req, s.token, s.maxAge) });
  }

  const token = cookies(req).sid;
  const user = D.sessionUser(token);
  if (!user) return send(res, 401, { error: _t('Потрібно увійти'), login: true });
  if (req.method === 'POST' && req.headers['x-fuel'] !== '1') throw D.httpError(403, _t('Заборонено'));

  if (p === '/api/logout' && req.method === 'POST') {
    D.deleteSession(token);
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  if (p === '/api/prices' && req.method === 'GET') return send(res, 200, { latest: P.latest(), overview: P.overview(priced().wallet), keys: P.KEYS, key: P.fuelKey(D.getSettings().fuel) });
  if (p === '/api/prices/refresh' && req.method === 'POST') {
    if (req.headers['x-fuel'] !== '1') throw D.httpError(403, _t('Заборонено'));
    await P.refresh(() => priced().wallet); return send(res, 200, { overview: P.overview(priced().wallet) });
  }
  if (p === '/api/wish' && req.method === 'GET') {
    try { return send(res, 200, await W.items(D.getSettings().wishTag, url.searchParams.get('force') === '1')); }
    catch (e) { return send(res, 200, { error: e.message, items: [] }); }
  }
  if (p.startsWith('/api/wish/img/') && req.method === 'GET') {
    let nm = ''; try { nm = decodeURIComponent(p.slice('/api/wish/img/'.length)); } catch {}
    const img = await W.image(nm);
    if (!img) throw D.httpError(404, _t('Немає картинки'));
    return send(res, 200, img.body, { 'Content-Type': img.type, 'Cache-Control': 'private, max-age=86400' });
  }
  if (p === '/api/fx' && req.method === 'GET') {
    try { return send(res, 200, await FX.rate(new URL(req.url, 'http://x').searchParams.get('date'), 'USD')); }
    catch (e) { throw D.httpError(502, _t('Не вдалося взяти курс НБУ')); }
  }
  if (p === '/api/battery' && req.method === 'GET') return send(res, 200, batterySummary(localStamp().slice(0, 10)));
  if (p === '/api/all' && req.method === 'GET')
    return send(res, 200, Object.assign(withService(priced()), { prices: P.overview(priced().wallet), user: D.publicUser(user), version: VERSION, budgetLinked: B.configured() }));

  // USD-витрата: сума в $ × курс (ручний або НБУ на дату витрати) → amount у гривні
  const withFx = async b => {
    if (b.currency !== 'USD') return Object.assign({}, b, { currency: 'UAH', amount_cur: null, rate: null });
    const cur = parseFloat(String(b.amount).replace(',', '.'));
    if (!(cur > 0)) throw D.httpError(400, _t('Вкажіть суму'));
    let rate = parseFloat(String(b.rate ?? '').replace(',', '.'));
    if (!(rate > 0)) {
      try { rate = (await FX.rate(b.date, 'USD')).rate; } catch { throw D.httpError(400, _t('Не вдалося взяти курс НБУ — введіть курс вручну')); }
    }
    if (rate > 1000) throw D.httpError(400, _t('Курс: надто велике значення'));
    return Object.assign({}, b, { currency: 'USD', amount_cur: cur, rate, amount: Math.round(cur * rate * 100) / 100 });
  };
  const done = (body) => { B.kick(); return send(res, 200, body); };
  if (req.method === 'POST') {
    if (p === '/api/fill') return done({ fill: D.saveFill(await readJson(req), user.id) });
    if (p === '/api/fill/delete') return done({ ok: D.deleteFill((await readJson(req)).id, user.id) });
    if (p === '/api/cost') return done({ cost: D.saveCost(await withFx(await readJson(req)), user.id) });
    if (p === '/api/cost/delete') return done({ ok: D.deleteCost((await readJson(req)).id, user.id) });
    if (p === '/api/topup') return done({ topup: D.saveTopup(await readJson(req), user.id) });
    if (p === '/api/topup/delete') return done({ ok: D.deleteTopup((await readJson(req)).id, user.id) });
    if (p === '/api/reminder') return done({ reminder: D.saveReminder(await readJson(req), user.id) });
    if (p === '/api/reminder/delete') return done({ ok: D.deleteReminder((await readJson(req)).id, user.id) });
    if (p === '/api/reminder/done') return done(D.reminderDone(await readJson(req), user.id));
    if (p === '/api/reminder/snooze') return done(D.reminderSnooze(await readJson(req), user.id));
    if (p === '/api/tires/set') return done({ set: D.saveTireSet(await readJson(req), user.id) });
    if (p === '/api/tires/set/delete') return done({ ok: D.deleteTireSet((await readJson(req)).id, user.id) });
    if (p === '/api/tires/measure') return done({ id: D.tireMeasure(await readJson(req), user.id) });
    if (p === '/api/tires/swap') return done(D.tireSwap(await readJson(req), user.id));
    if (p === '/api/tires/event') return done({ event: D.updateTireEvent(await readJson(req), user.id) });
    if (p === '/api/tires/event/delete') return done({ ok: D.deleteTireEvent((await readJson(req)).id, user.id) });
    if (p === '/api/cat') return send(res, 200, { cats: D.saveCat(await readJson(req)) });
    if (p === '/api/settings') {
      const before = D.getSettings();
      const s = D.setSettings(await readJson(req));
      const changed = ['budgetEnabled', 'budgetFuelCat', 'budgetCostCat'].some(k => before[k] !== s[k]);
      if (changed) D.requeueAllBudget();
      return done({ settings: s });
    }
    if (p === '/api/budget/resync') { const n = D.requeueAllBudget(); await B.flush(); return send(res, 200, { queued: n, budget: D.budgetState() }); }
    if (p === '/api/import/bm300') {
      const buf = await readBody(req, 10 * 1024 * 1024);
      const parsed = parseBm300(buf);
      return url.searchParams.get('dry') === '1' ? send(res, 200, Object.assign({ dry: true }, D.importBm300(parsed, { dry: true }, user.id)))
        : done(D.importBm300(parsed, {}, user.id));
    }
    if (p === '/api/import/fuelio') {
      const buf = await readBody(req, 20 * 1024 * 1024);
      let parsed;
      try { parsed = parseFuelio(buf.toString('utf8')); } catch (e) { throw D.httpError(400, e.message); }
      if (url.searchParams.get('dry') === '1')
        return send(res, 200, { dry: true, vehicle: parsed.vehicle, fills: parsed.fills.length, costs: parsed.costs.length,
          from: parsed.fills.map(f => f.date).sort()[0] || null, to: parsed.fills.map(f => f.date).sort().pop() || null });
      return done(D.importFuelio(parsed, { budget: url.searchParams.get('budget') === '1' }, user.id));
    }
  }
  if (p === '/api/budget/refs' && req.method === 'GET') return send(res, 200, await B.refs());
  if (p === '/api/export.json' && req.method === 'GET')
    return send(res, 200, JSON.stringify(D.exportJson(), null, 1), { 'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="fuel-${localStamp().slice(0, 10)}.json"`, 'Cache-Control': 'no-store' });
  if (p === '/api/export.csv' && req.method === 'GET')
    return send(res, 200, D.exportCsv(), { 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="fuel-${localStamp().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' });
  throw D.httpError(404, _t('Немає такого методу'));
}

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  res.on('finish', () => {
    if (req.url !== '/healthz' && !/^\/(fonts|icons)\//.test(req.url)) console.log(`${new Date().toISOString()} ${req.method} ${req.url.split('?')[0]} ${res.statusCode} ${Date.now() - t0}ms`);
  });
  // мова відповіді: з налаштувань; Home Assistant-хуки (summary, notify, odo) ЗАВЖДИ українською — сповіщення вдома українські
  let lang = 'uk';
  try {
    if (!req.url.startsWith('/api/hook/') && req.url.startsWith('/api/')) lang = D.getSettings().lang;
  } catch {}
  return I18N.runWith(lang, async () => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/healthz') return send(res, 200, { ok: true, version: VERSION });
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain; charset=utf-8' });
      return serveStatic(req, res, url.pathname);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500 && status !== 502 && status !== 503) console.error(e);
      if (!res.headersSent) send(res, status, { error: status >= 500 && !e.status ? _t('Помилка сервера') : e.message });
    }
  });
});
server.requestTimeout = 60e3;
if (require.main === module) {
  server.listen(PORT, () => console.log(`Бак ${VERSION}: http://0.0.0.0:${PORT}, база ${D.DB_PATH}`));
  B.start();
  if (process.env.PRICES !== '0') { P.start(() => priced().wallet); SV.start(); }
  const shutdown = () => { server.close(() => { try { D.db.close(); } catch {} process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
module.exports = { server };
