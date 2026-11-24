/* Бак — інтерфейс. Без фреймворків: стан → render() → innerHTML, події через делегування. */
(function () {
  'use strict';
  const C = window.FuelCalc;
  const I18N = window.FuelI18n;
  const _t = I18N.t, plural = I18N.plural;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 2) => (n === null || n === undefined || !isFinite(n)) ? '—' : Number(n).toLocaleString(I18N.locale(), { maximumFractionDigits: d });
  const money = n => fmt(n, Math.abs(n) >= 1000 ? 0 : 2) + ' ₴';
  const pad = n => String(n).padStart(2, '0');
  const dec = n => n ? String(n).replace('.', ',') : '';
  const today = () => new Date().toLocaleDateString('sv-SE');
  const nowStamp = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  // назви місяців — з i18n (залежать від мови); MONTHS[i] / MON_SHORT[i] працюють через проксі-масиви
  // «ліниві» таблиці: перекладені підписи обчислюються при зверненні, а не при завантаженні скрипта, тож зміна мови діє одразу
  const lazyArr = get => new Proxy([], { get: (_, k) => { const a = get(); const v = a[k]; return typeof v === 'function' ? v.bind(a) : v; } });
  const lazyObj = get => new Proxy({}, {
    get: (_, k) => get()[k], has: (_, k) => k in get(), ownKeys: () => Reflect.ownKeys(get()),
    getOwnPropertyDescriptor: (_, k) => { const d = Object.getOwnPropertyDescriptor(get(), k); if (d) d.configurable = true; return d; }
  });
  const arrLike = lazyArr;
  const MONTHS = arrLike(I18N.months), MON_SHORT = arrLike(I18N.monShort);
  const dayLabel = d => { const [y, m, dd] = d.slice(0, 10).split('-'); return `${+dd} ${MON_SHORT[+m - 1]}${y !== String(new Date().getFullYear()) ? ' ' + y : ''}`; };
  const FUELS = ['А-95', 'А-95 Mustang', 'А-92', 'А-98', 'А-100 Mustang', 'ДП', 'ДП Mustang', 'Газ']; // це збережені в БД значення — не перекладаємо; на екрані показуємо через fuelName()
  const fuelName = f => _t(f || '');

  const I = {
    pump: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M3 21h13M7 7h5v4H7z"/><path d="M15 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    wrench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3-3 1.4-1.3a4 4 0 0 0-5-5L5 13 3 11l8-8 1.7 1.7z"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    car: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16h14M3 16v-3l2-5a2 2 0 0 1 2-1.4h10A2 2 0 0 1 19 8l2 5v3a1 1 0 0 1-1 1h-1M3 16v1a1 1 0 0 0 1 1h1"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/></svg>'
  };
  // решта іконок — той самий штрих; aria-hidden, бо поруч завжди є текст
  const svgI = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  Object.assign(I, {
    oil: svgI('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>'),
    air: svgI('<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>'),
    fan: svgI('<circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 1-7 4-7 2 0 2 3 0 5l-2 2M14 12c4 0 7 1 7 4 0 2-3 2-5 0l-2-2M12 14c0 4-1 7-4 7-2 0-2-3 0-5l2-2M10 12c-4 0-7-1-7-4 0-2 3-2 5 0l2 2"/>'),
    disc: svgI('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M21 12h-3"/>'),
    pads: svgI('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M3.5 9A9.5 9.5 0 0 1 9 3.5"/>'),
    zap: svgI('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
    cog: svgI('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
    thermo: svgI('<path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/><path d="M12 9v7"/>'),
    belt: svgI('<circle cx="7" cy="14" r="4"/><circle cx="18" cy="7" r="3"/><path d="M6.3 10 17 4.2M8.4 17.7 19.3 9.7"/>'),
    battery: svgI('<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M7 7V5M17 7V5M7 13h3M14 13h3M15.5 11.5v3"/>'),
    doc: svgI('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
    search: svgI('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
    tire: svgI('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v5M12 16v5M3 12h5M16 12h5"/>'),
    cart: svgI('<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 7H6"/>'),
    gift: svgI('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>'),
    wallet: svgI('<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M3 7h16a2 2 0 0 1 2 2v3h-5a2 2 0 0 0 0 4h5"/>'),
    sun: svgI('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    snow: svgI('<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 2 3-2M9 20l3-2 3 2"/>'),
    allseason: svgI('<path d="M8 2v2M2.3 6.3l1.4 1.4M2 12h2M12.7 7.3A4 4 0 0 0 5 9.5"/><path d="M17 21H9a4 4 0 1 1 3.6-5.7A3.2 3.2 0 1 1 17 21z"/>'),
    ruler: svgI('<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>'),
    swap: svgI('<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>'),
    receipt: svgI('<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
    tag: svgI('<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
    cash: svgI('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>'),
    download: svgI('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
    upload: svgI('<path d="M12 15V3M7 8l5-5 5 5M5 21h14"/>'),
    db: svgI('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
    bell: svgI('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4"/>'),
    logout: svgI('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
    pin: svgI('<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>'),
    up: svgI('<path d="M12 19V5M5 12l7-7 7 7"/>'),
    down: svgI('<path d="M12 5v14M5 12l7 7 7-7"/>'),
    wash: svgI('<path d="M7 16.3c2.2 0 4-1.8 4-4 0-1.3-.6-2.5-2-3.6S7 6.3 7 5.3c-.2 1-.8 2-2 3.1S3 11 3 12.3c0 2.2 1.8 4 4 4z"/><path d="M12.6 6.6A11 11 0 0 0 14 3c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a7 7 0 0 1-12.7 4"/>'),
    parking: svgI('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>'),
    shield: svgI('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="M12 8v4M12 16h.01"/>'),
    box: svgI('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>'),
    clock: svgI('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    chev: svgI('<path d="m9 6 6 6-6 6"/>'),
    close: svgI('<path d="M6 6l12 12M18 6 6 18"/>'),
    alert: svgI('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
    cloud: svgI('<path d="M17.5 19H8a5 5 0 1 1 4.6-7A3.5 3.5 0 1 1 17.5 19z"/><path d="m3 3 18 18"/>')
  });
  // категорії витрат: типові — своїми іконками; власні — значком, який вибрав користувач
  const CAT_I = { service: I.wrench, tires: I.tire, wash: I.wash, parking: I.parking, insurance: I.doc, fines: I.shield, parts: I.cog, other: I.box };
  const CAT_RE = [[/мийк|хімчист/i, I.wash], [/шин|колес/i, I.tire], [/страх|поліс/i, I.doc], [/парк/i, I.parking], [/штраф/i, I.shield], [/запчаст|детал/i, I.cog], [/сервіс|ремонт|\bто\b|обслуг/i, I.wrench]];
  const catIco = k => CAT_I[k.id] || (k.emoji && k.emoji !== '🏷️' ? `<span class="emo" aria-hidden="true">${esc(k.emoji)}</span>` : ((CAT_RE.find(([re]) => re.test(k.name || '')) || [])[1] || I.tag));

  const S = { data: null, tab: 'log', period: 'y', refs: null, offline: false, anim: true };
  const CACHE = 'fuel-cache-v1';

  /* ---------- мережа ---------- */
  async function api(path, body, opts) {
    opts = opts || {};
    const init = { credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      init.method = 'POST';
      init.headers['X-Fuel'] = '1';
      if (opts.raw) { init.body = body; init.headers['Content-Type'] = opts.type || 'text/csv'; }
      else { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    }
    let r;
    try { r = await fetch(path, init); }
    catch { throw Object.assign(new Error(_t('Немає зв’язку з сервером')), { network: true }); }
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && d.login) { location.replace('/login?next=' + encodeURIComponent(location.pathname)); throw new Error('login'); }
    if (!r.ok) throw Object.assign(new Error(d.error || (r.status >= 500 ? _t('Сервер не відповів ({status}). Спробуйте ще раз.', { status: r.status }) : _t('Помилка ') + r.status)), { status: r.status });
    return d;
  }
  /* ---------- офлайн-черга ---------- */
  const QUEUE = 'fuel-queue-v1', QFAILED = 'fuel-queue-failed';
  const lsGet = k => { try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : []; } catch { return []; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const qGet = () => lsGet(QUEUE);
  const hex8 = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('');
  const newId = p => p + Date.now().toString(36) + hex8();
  const qDrop = id => { const q = qGet().filter(x => x.id !== id); lsSet(QUEUE, q); };
  const optimistic = (it) => {
    const b = it.body;
    if (it.path === '/api/fill') {
      const total = b.total || (b.pay !== 'wallet' && b.litres && b.price ? Math.round(b.litres * b.price * 100) / 100 : 0);
      return { id: it.id, date: b.date, odo: b.odo, litres: b.litres, price: b.price, total, full: b.full ? 1 : 0, missed: b.missed ? 1 : 0, fuel: b.fuel, station: b.station, note: b.note, pay: b.pay, bonus: b.bonus, budget_account: b.budget_account, status: b.odo ? 'ok' : 'draft', queued: true };
    }
    const usd = b.currency === 'USD';
    return { id: it.id, date: b.date, odo: b.odo, cat: b.cat, title: b.title, amount: usd ? (b.rate > 0 ? Math.round(b.amount * b.rate * 100) / 100 : 0) : b.amount,
      currency: usd ? 'USD' : 'UAH', amount_cur: usd ? b.amount : null, rate: usd ? b.rate || null : null, note: b.note, budget_account: b.budget_account, queued: true };
  };
  // накладає записи з черги на S.data (нові додає, наявні — підміняє)
  function mergeQueue() {
    if (!S.data) return;
    qGet().forEach(it => {
      const list = it.path === '/api/fill' ? S.data.fills : S.data.costs;
      const rec = optimistic(it), i = list.findIndex(x => x.id === it.id);
      if (i >= 0) list[i] = Object.assign({}, list[i], rec); else list.push(rec);
    });
  }
  const saveCache = () => { try { localStorage.setItem(CACHE, JSON.stringify(S.data)); } catch {} };
  // кладе запис у чергу й оптимістично показує його; true — поставлено
  function enqueue(path, body) {
    const it = { id: body.id, path, body, ts: Date.now() };
    lsSet(QUEUE, qGet().filter(x => x.id !== it.id).concat(it));
    mergeQueue(); saveCache(); S.offline = true;
    return it;
  }
  let flushing = false;
  async function flushQueue() {
    if (flushing || !qGet().length) return;
    flushing = true;
    let ok = 0;
    try {
      for (const it of qGet()) {
        try {
          try { await api(it.path, it.body); }
          catch (e) { if (e.status === 409 && !it.body.force) await api(it.path, Object.assign({}, it.body, { force: true })); else throw e; }
          qDrop(it.id); ok++;
        } catch (e) {
          if (e.network || e.message === 'login' || !e.status || e.status >= 500) break;
          qDrop(it.id);
          lsSet(QFAILED, lsGet(QFAILED).concat({ id: it.id, path: it.path, body: it.body, ts: it.ts, error: e.message }));
          toast(_t('Не вдалося надіслати запис: ') + e.message);
        }
      }
    } finally { flushing = false; }
    if (ok) await load().catch(() => {});
    else if (S.data) render();
  }
  async function load() {
    try {
      S.data = await api('/api/all');
      S.offline = false;
      mergeQueue();
      saveCache();
    } catch (e) {
      if (e.message === 'login') return;
      const c = localStorage.getItem(CACHE);
      if (!c) throw e;
      S.data = JSON.parse(c); S.offline = true;
      mergeQueue();
    }
    window.__fuelLoaded = true;
    if (S.data.settings && S.data.settings.lang) I18N.setLang(S.data.settings.lang);
    render();
    if (S.data.settings.budgetEnabled && !S.refs) loadRefs();
    if (!S.offline && qGet().length) flushQueue();
    if (!S.offline) loadBattery();
  }
  async function loadRefs() {
    try { S.refs = await api('/api/budget/refs'); localStorage.setItem('fuel-refs', JSON.stringify(S.refs)); }
    catch { try { S.refs = JSON.parse(localStorage.getItem('fuel-refs')); } catch {} }
    return S.refs;
  }
  function toast(msg) {
    let box = $('#toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    box.replaceChildren(t); setTimeout(() => t.remove(), 3600);
  }

  /* ---------- похідні дані ---------- */
  // вбудовані категорії мають українські назви в БД; на екрані перекладаємо (власні назви збігу в словнику не мають)
  const cats = () => { const m = {}; (S.data.cats || []).forEach(c => { m[c.id] = Object.assign({}, c, { name: _t(c.name) }); }); return m; };
  const segs = () => C.segments(S.data.fills);
  function prevFill(f) {
    return C.ordered(S.data.fills).filter(x => x.id !== f.id && x.date < f.date).pop() || null;
  }
  const periodRange = p => C.periodRange(p);
  const PERIODS = lazyArr(() => [['m', _t('Місяць')], ['3m', _t('3 місяці')], ['y', _t('Рік')], ['all', _t('Усе')]]);

  /* ---------- анімація появи, плашки динаміки, міні-графіки ---------- */
  const MONTHS_GEN = arrLike(I18N.monthsGen);
  // попередній період порівнюємо лише тоді, коли журнал покриває його повністю (інакше «+88%» до напівпорожнього року)
  const covered = pr => {
    const ds = [...(S.data.fills || []), ...(S.data.costs || [])].map(x => x.date).filter(Boolean).sort();
    return !!ds.length && ds[0].slice(0, 7) <= pr.from.slice(0, 7);
  };
  const PREV_LABEL = lazyObj(() => ({ m: _t('до попереднього місяця'), '3m': _t('до попередніх 3 міс.'), y: _t('до попередніх 12 міс.') }));
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // число, яке «докручується» при появі вкладки; у розмітці одразу кінцеве значення
  const cn = (v, d, suf) => (v === null || v === undefined || !isFinite(v)) ? '—' : `<span class="cn" data-v="${v}" data-d="${d}"${suf ? ` data-suf="${esc(suf)}"` : ''}>${fmt(v, d)}${suf ? esc(suf) : ''}</span>`;
  const cnMoney = n => cn(n, Math.abs(n) >= 1000 ? 0 : 2, ' ₴');
  // dir: -1 — менше це добре (зелене), 1 — більше добре, 0 — нейтрально
  function dchip(pct, dir, label, compact) {
    if (pct === null || pct === undefined) return '';
    const cls = pct === 0 || dir === 0 ? 'flat' : ((pct < 0) === (dir < 0) ? 'good' : 'bad');
    const ar = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
    return `<span class="dchip ${cls}" title="${esc(label)}"><span aria-hidden="true">${ar}</span> ${Math.abs(pct)}%${compact ? '' : ' <em>' + esc(label) + '</em>'}<span class="sr">${pct > 0 ? _t(' більше, ') : pct < 0 ? _t(' менше, ') : _t(' без змін, ')}${esc(label)}</span></span>`;
  }
  // стовпчики по місяцях; рекорд (найкращий місяць) підсвічено
  function mini(vals, months, best, f) {
    const nums = vals.filter(v => v !== null && v !== undefined);
    if (nums.length < 2) return '';
    const hi = Math.max.apply(null, nums), rec = best === 'min' ? Math.min.apply(null, nums) : hi;
    const step = Math.min(35, 450 / vals.length);
    return `<div class="mb" role="img" aria-label="${_t('Графік по місяцях, рекорд: {rec}', { rec: esc(f(rec)) })}">${vals.map((v, i) => v === null || v === undefined
      ? `<i class="nil" style="--d:${Math.round(i * step)}ms"></i>`
      : `<i class="${v === rec ? 'rec' : ''}" style="height:${Math.max(14, v / hi * 100).toFixed(0)}%;--d:${Math.round(i * step)}ms" title="${esc(monLabel(months[i]) + ': ' + f(v))}"></i>`).join('')}</div>`;
  }
  function miniMonths(st, r) {
    const e = new Date(), endK = `${e.getFullYear()}-${pad(e.getMonth() + 1)}`;
    let keys = C.monthKeys(r.from ? r.from.slice(0, 7) : ((st.months[0] || {}).month || endK), endK);
    if (keys.length < 6) { const d = new Date(e.getFullYear(), e.getMonth() - 5, 1); keys = C.monthKeys(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`, endK); }
    return keys.slice(-24);
  }
  function runCounts(root) {
    const els = $$('.cn', root);
    if (!els.length) return;
    els.forEach(e => { e._v = +e.dataset.v; e._d = +e.dataset.d; e._s = e.dataset.suf || ''; });
    const set = k => els.forEach(e => { e.textContent = fmt(e._v * k, e._d) + e._s; });
    const t0 = performance.now(), dur = 800;
    set(0);
    const step = now => { const p = Math.min(1, (now - t0) / dur); set(1 - Math.pow(1 - p, 3)); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  // індекс для поступового з'явлення: блоки сторінки та смуги в списках
  function stagger(main) {
    Array.from(main.children).forEach((el, i) => el.style.setProperty('--k', Math.min(i, 10)));
    $$('.bar i', main).forEach(el => { const host = el.closest('.row') || el; el.style.setProperty('--d', Math.min(host.parentNode ? Array.prototype.indexOf.call(host.parentNode.children, host) : 0, 12) * 50 + 'ms'); });
  }

  /* ---------- каркас ---------- */
  function render() {
    const s = S.data.settings;
    const title = s.carName || [s.carMake, s.carModel].filter(Boolean).join(' ') || _t('Моє авто');
    const sub = [s.carPlate, fuelName(s.fuel)].filter(Boolean).join(' · ');
    const b = S.data.budget || {};
    let sync = '';
    const qn = qGet().length;
    if (qn) sync = `<div class="sync err">${S.offline ? `${_t('Офлайн')}<br>` : ''}${_t('В черзі: {qn}', { qn })}</div>`;
    else if (S.offline) sync = `<div class="sync err">${_t('Офлайн')}<br>${_t('дані з кешу')}</div>`;
    else if (s.budgetEnabled && b.pending) sync = `<div class="sync${b.error ? ' err' : ''}" title="${esc(b.error || '')}">${_t('До Бюджету')}<br>${_t('в черзі: {pending}', { pending: b.pending })}</div>`;
    const body = { log: viewLog, stats: viewStats, service: viewService, more: viewMore }[S.tab]();
    // анімація — лише при відкритті вкладки / зміні періоду, не при фонових оновленнях
    const anim = S.anim && !reduceMotion(); S.anim = false;
    $('#app').innerHTML = `
      <header class="top"><div class="car"><div class="car-ico">${I.car}</div><div style="min-width:0"><b>${esc(title)}</b><small>${esc(sub)}</small></div></div>${sync}</header>
      <main${anim ? ' class="anim"' : ''}>${body}</main>
      <nav class="tabs"><div class="in">${[['log', _t('Журнал'), I.pump], ['stats', _t('Статистика'), I.chart], ['service', _t('Сервіс'), I.wrench], ['more', _t('Ще'), I.more]]
        .map(([k, l, i]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}" ${S.tab === k ? 'aria-current="page"' : ''}>${i}<span>${l}</span></button>`).join('')}</div></nav>
      ${S.tab === 'more' ? '' : `<button class="fab" data-act="add" aria-label="${_t('Додати')}">${I.plus}</button>`}`;
    if (S.tab === 'stats') drawCharts();
    if (anim) { const m = $('main'); stagger(m); runCounts(m); }
  }

  /* ---------- журнал ---------- */
  function viewLog() {
    const all = C.stats(S.data.fills, S.data.costs);
    const mr = periodRange('m');
    const month = C.stats(S.data.fills, S.data.costs, mr);
    const drafts = S.data.fills.filter(f => f.status === 'draft');
    const sg = segs(), cm = cats();
    const entries = S.data.fills.map(f => ({ k: 'f', d: f.date, x: f })).concat(S.data.costs.map(c => ({ k: 'c', d: c.date, x: c })))
      .concat((S.data.topups || []).map(t => ({ k: 't', d: t.date, x: t })))
      .sort((a, b) => b.d.localeCompare(a.d));
    if (!entries.length) return `${hero(all, Object.assign(month, { paid: 0 }))}<div class="empty"><b>${_t('Ще немає заправок')}</b>${_t('Натисніть «+», щоб додати першу, або імпортуйте історію з Fuelio в розділі «Ще».')}</div>`;
    const thisM = new Date().toISOString().slice(0, 7);
    month.paid = entries.filter(e => e.d.slice(0, 7) === thisM).reduce((a, e) => a + paid(e), 0);
    let html = drafts.map(f => `<button class="banner" data-fill="${esc(f.id)}"><div class="ico fuel">${I.pump}</div><div><b>${_t('Нова заправка{station}', { station: f.station ? ' ' + esc(f.station) : '' })}</b><span>${[f.litres ? fmt(f.litres) + _t(' л') : '', f.pay === 'wallet' ? _t('з гаманця') : f.total ? money(f.total) : '', dayLabel(f.date)].filter(Boolean).join(' · ')}</span></div><span class="go">${_t('Допиши пробіг')}</span></button>`).join('');
    html += hero(all, month);
    const glance = [dueRow(), priceRow(), walletRow()].filter(Boolean);
    if (glance.length) html += `<div class="list glance">${glance.join('')}</div>`;
    const groups = [];
    entries.forEach(e => { const k = e.d.slice(0, 7); let g = groups[groups.length - 1]; if (!g || g.k !== k) groups.push(g = { k, items: [], sum: 0 }); g.items.push(e); g.sum += paid(e); });
    groups.slice(0, S.logMonths || 6).forEach(g => {
      const [y, m] = g.k.split('-');
      // динаміка до попереднього календарного місяця; для поточного — за ті самі дні
      const pk = +m === 1 ? `${+y - 1}-12` : `${y}-${pad(+m - 1)}`;
      const pg = groups.find(x => x.k === pk);
      const prevSum = !pg ? null : g.k === thisM ? pg.items.filter(e => +e.d.slice(8, 10) <= +today().slice(8, 10)).reduce((a, e) => a + paid(e), 0) : pg.sum;
      const chip = pg ? dchip(C.pctChange(g.sum, prevSum), -1, _t('до ') + MONTHS_GEN[+pk.slice(5) - 1]) : '';
      const days = C.daySeries(g.items.map(e => ({ date: e.d, v: paid(e) })), g.k), hi = Math.max.apply(null, days);
      const bars = hi > 0 ? `<div class="md" aria-hidden="true">${days.map((v, i) => `<i${v ? '' : ' class="nil"'} style="${v ? `height:${Math.max(12, v / hi * 100).toFixed(0)}%;` : ''}--d:${i * 12}ms" title="${i + 1}: ${esc(money(v))}"></i>`).join('')}</div>` : '';
      html += `<div class="month"><div class="mh"><b>${MONTHS[+m - 1]}${y !== String(new Date().getFullYear()) ? ' ' + y : ''}</b>${chip}<span class="num">${money(g.sum)}</span></div>${bars}</div><div class="list">`;
      g.items.forEach(e => { html += e.k === 'f' ? fillRow(e.x, sg) : e.k === 't' ? topupRow(e.x) : costRow(e.x, cm); });
      html += '</div>';
    });
    if (groups.length > (S.logMonths || 6)) html += `<button class="btn sec" style="margin-top:14px" data-act="more-log">${_t('Показати раніші місяці')}</button>`;
    return html;
  }
  // ті самі 12 місяців, що й «Рік» у статистиці, — щоб цифри збігались
  function hero() {
    const yr = C.stats(S.data.fills, S.data.costs, periodRange('y'));
    const tank = +S.data.settings.tank || 0;
    const range = tank && yr.avgCons ? tank / yr.avgCons * 100 : 0;
    return `<section class="hero" aria-label="${_t('Підсумок за 12 місяців')}">
      <div><div class="v num">${cn(yr.avgCons, 2)}<small>${_t('л/100')}</small></div><div class="l">${_t('витрата за рік')}</div></div>
      <div><div class="v num">${cn(yr.fuelPerKm, 2)}<small>${_t('₴/км')}</small></div><div class="l">${_t('пальне на 1 км')}</div></div>
      <div><div class="v num">${range ? cn(range, 0) : '—'}<small>${_t('км')}</small></div><div class="l">${range ? _t('на повному баку') : _t('вкажіть бак у «Ще»')}</div></div></section>`;
  }
  // компактні рядки «що зараз важливо»: прострочені роботи, ціна, гаманець
  function dueRow() {
    const due = svc().alerts.filter(a => a.level === 'due');
    if (!due.length) return '';
    const n = due.length;
    return `<button class="row lv-due" data-tab="service"><div class="ico">${I.alert}</div><div class="mid"><b>${n > 1 ? _t('{n} {n2} у Сервісі', { n, n2: plural(n, 'робота чекає', 'роботи чекають', 'робіт чекають') }) : esc(due[0].title)}</b><span>${n > 1 ? esc(due.map(a => a.title).join(', ')) : esc(due[0].text)}</span></div><span class="chev">${I.chev}</span></button>`;
  }
  function priceRow() {
    const o = S.data.prices;
    if (!o || !o.nets || !o.nets.length || !o.wog) return '';
    const trend = o.wogChange && o.wogChange.to !== o.wogChange.from ? (o.wogChange.to > o.wogChange.from ? ' ↑' : ' ↓') : '';
    const eff = o.bonus && o.bonus.azk && o.wogEff ? ` ${_t('→ {wogEff} з бонусами', { wogEff: fmt(o.wogEff) })}` : '';
    const cheap = o.cheapest && o.cheapest.net !== 'WOG' ? _t('дешевше {net} {eff} ₴', { net: esc(netName(o.cheapest.net)), eff: fmt(o.cheapest.eff) }) : _t('WOG найвигідніший');
    const near = o.nearest && o.nearest[0];
    return `<button class="row" data-act="prices"><div class="ico fuel"><span class="cur">₴</span></div><div class="mid"><b class="num">WOG ${fmt(o.wog)} ₴${trend}<span class="muted">${eff}</span></b><span>${cheap}${near ? ` ${_t('· поряд {net} {km} км', { net: esc(near.net), km: fmt(near.km, 1) })}` : ''}</span></div><span class="chev">${I.chev}</span></button>`;
  }
  function walletRow() {
    const w = S.data.wallet;
    if (!w || !(S.data.topups || []).length) return '';
    const gain = S.data.prices && S.data.prices.wallet && S.data.prices.wallet.gain > 0 ? ` ${_t('· вигода {gain}', { gain: money(S.data.prices.wallet.gain) })}` : '';
    return `<button class="row" data-act="wallet"><div class="ico">${I.wallet}</div><div class="mid"><b class="num">${_t('Гаманець WOG · {litres} л', { litres: fmt(w.litres) })}</b><span>${w.litres > 0 ? _t('на ') + money(w.value) + gain : _t('порожній')}${w.short ? ` ${_t('· бракує {short} л', { short: fmt(w.short) })}` : ''}</span></div><span class="chev">${I.chev}</span></button>`;
  }
  function fillRow(f, sg) {
    const p = prevFill(f);
    const dist = p && f.odo > 0 ? f.odo - p.odo : 0;
    const line1 = dayLabel(f.date) + ' · ' + (f.status === 'draft' ? _t('пробіг не вказано') : fmt(f.odo, 0) + _t(' км') + (dist > 0 ? ` (+${fmt(dist, 0)})` : ''));
    const line2 = fmt(f.litres) + _t(' л × ') + fmt(f.price) + _t(' ₴/л') + (f.pay === 'wallet' ? _t(' · з гаманця') : '') + (f.bonus ? ` ${_t('· ще {bonus} ₴ бонусами', { bonus: fmt(f.bonus) })}` : '') + (f.earned ? ` ${_t('· +{earned} бонусів', { earned: fmt(f.earned, 0) })}` : '');
    const s = sg[f.id];
    const chip = f.queued ? `<span class="chip q">${_t('в черзі')}</span>` : f.status === 'draft' ? `<span class="chip draft">${_t('чернетка')}</span>`
      : s ? `<span class="chip num">${_t('{cons} л/100', { cons: fmt(s.cons) })}</span>` : (!f.full ? `<span class="chip">${_t('неповний')}</span>` : '');
    return `<button class="row" data-fill="${esc(f.id)}"><div class="ico fuel">${I.pump}</div>
      <div class="mid"><b>${esc([fuelName(f.fuel), f.station].filter(Boolean).join(' · ') || _t('Заправка'))}${f.missed ? ` <span class="muted">${_t('· після пропуску')}</span>` : ''}</b><span class="num">${esc(line1)}</span><span class="num wrap">${esc(line2)}</span></div>
      <div class="end"><b class="num${f.pay === 'wallet' ? ' muted' : ''}" ${f.pay === 'wallet' ? `title="${_t('Оплачено з гаманця')}"` : ''}>${money(f.total)}</b>${chip}</div></button>`;
  }
  /* ---------- ціни ---------- */
  const NET_SHORT = lazyObj(() => ({ 'ДНІПРОНАФТА': _t('Дніпронафта'), UKRNAFTA: _t('Укрнафта'), 'БРСМ-Нафта': _t('БРСМ') }));
  const netName = n => NET_SHORT[n] || _t(n);
  const ago = ts => { const m = Math.round((Date.now() - ts) / 60000); return m < 60 ? _t('{m} хв тому', { m }) : m < 1440 ? _t('{m} год тому', { m: Math.round(m / 60) }) : _t('{m} дн тому', { m: Math.round(m / 1440) }); };
  async function pricesSheet(pos) {
    const title = _t('Ціни й заправки поряд');
    openSheet(`${head(title)}<p class="muted">${_t('Завантажую…')}</p>`);
    let d;
    try { d = await api('/api/prices'); } catch (e) { openSheet(`${head(title)}<p class="hint err">${esc(e.message)}</p>`); return; }
    const L = d.latest;
    if (!L) { openSheet(`${head(title)}<p class="hint">${_t('Ціни ще не завантажені. Спробуйте за хвилину.')}</p>`); return; }
    const key = S.priceKey || d.key;
    const from = pos || L.center;
    const dist = st => { const dy = (st.lat - from.lat) * 111.2, dx = (st.lng - from.lng) * 111.2 * Math.cos(from.lat * Math.PI / 180); return Math.hypot(dx, dy); };
    const stations = (L.wog || []).concat(L.okko || []).map(st => Object.assign({}, st, { km: dist(st) })).sort((a, b) => a.km - b.km).slice(0, 20);
    const BL = S.data.settings.wogBonuses || [];
    const bon = (net, price) => C.bonusFor(BL, net, key, 'azk', price);
    const wogRaw = (L.nets.WOG || {})[key];
    const wog = wogRaw ? wogRaw - bon('WOG', wogRaw) : wogRaw;
    const nets = Object.entries(L.nets || {}).filter(([, v]) => v[key]).map(([n, v]) => ({ n, b: bon(n, v[key]), p: v[key] - bon(n, v[key]), raw: v[key] })).sort((a, b) => a.p - b.p);
    const anyBonus = nets.some(x => x.b);
    const keys = Object.entries(d.keys).filter(([k]) => Object.values(L.nets).some(v => v[k]));
    const netRows = nets.map(x => `<div class="row" style="cursor:default"><div class="mid"><b>${esc(netName(x.n))}</b>${x.b ? `<span>${_t('{raw} ₴ мінус {b} ₴/л бонусами', { raw: fmt(x.raw), b: fmt(x.b) })}</span>` : ''}</div><div class="end"><b class="num">${fmt(x.p)} ₴</b>${wog && x.n !== 'WOG'
      ? `<span class="muted num" style="font-size:12px;display:block">${x.p === wog ? _t('як у WOG') : (x.p < wog ? '−' : '+') + fmt(Math.abs(wog - x.p)) + _t(' від WOG')}</span>` : ''}</div></div>`).join('');
    const stRows = stations.map(st => {
      const pr = st.prices[key], av = st.avail[key];
      const sb = pr ? bon(st.net, pr) : 0;
      const price = av === false ? `<span class="muted">${_t('немає')}</span>` : pr ? fmt(pr - sb) + ' ₴' + (sb ? `<span class="muted" style="display:block;font-size:12px;font-weight:400">${_t('{pr} без бонусів', { pr: fmt(pr) })}</span>` : '') : '—';
      return `<a class="row" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${+st.lat},${+st.lng}"><div class="ico ${st.net === 'WOG' ? 'fuel' : ''}" style="font-size:11px;font-weight:700">${st.net === 'WOG' ? 'WOG' : _t('ОККО')}</div>
        <div class="mid"><b>${esc(st.address)}</b><span>${_t('{km} км{notes}', { km: fmt(st.km, 1), notes: st.notes && st.notes.length ? ' · ' + esc(st.notes[0].slice(0, 80)) : '' })}</span></div>
        <div class="end"><b class="num">${price}</b></div></a>`;
    }).join('');
    openSheet(`${head(title)}
      <div class="seg" role="tablist" style="overflow-x:auto">${keys.map(([k, l]) => `<button data-pk="${k}" class="${k === key ? 'on' : ''}">${esc(_t(l))}</button>`).join('')}</div>
      <h4 style="margin-top:4px">${_t('Мережі в області')}</h4><div class="list">${netRows}</div>
      <div class="chart" id="ch-trend" style="margin-top:14px"></div>
      <h4>${_t('Поряд {pos}', { pos: pos ? _t('з вами') : _t('з домом') })}</h4>
      ${pos ? '' : `<button class="btn sec" data-geo style="margin:0 0 10px">${_t('{pin}Від мого місця', { pin: I.pin })}</button>`}
      <div class="list">${stRows}</div>
      <p class="hint" style="margin-top:10px">${_t('Оновлено {ts}.{anyBonus} Ціни WOG — з кожної АЗС; ОККО та інші мережі — середні по області (Мінфін). Натисніть АЗС, щоб прокласти маршрут.{join}', { ts: ago(L.ts), anyBonus: anyBonus ? _t(' Ціни показано мінус ваші бонуси (налаштування в «Ще → Бонуси й знижки»).') : '', join: L.errors && L.errors.length ? _t(' Помилки: ') + esc(L.errors.join('; ')) : '' })}</p>
      <button class="btn sec" data-refresh>${_t('Оновити ціни')}</button>`, sh => {
      $$('[data-pk]', sh).forEach(b => b.addEventListener('click', () => { S.priceKey = b.dataset.pk; pricesSheet(pos); }));
      const g = $('[data-geo]', sh);
      if (g) g.addEventListener('click', () => {
        if (!navigator.geolocation) return toast(_t('Геолокація недоступна'));
        g.disabled = true; g.textContent = _t('Визначаю місце…');
        navigator.geolocation.getCurrentPosition(p => pricesSheet({ lat: p.coords.latitude, lng: p.coords.longitude }),
          () => { g.disabled = false; g.innerHTML = I.pin + _t('Від мого місця'); toast(_t('Немає доступу до геолокації')); }, { timeout: 15000, maximumAge: 300000 });
      });
      $('[data-refresh]', sh).addEventListener('click', async ev => {
        ev.target.disabled = true; ev.target.textContent = _t('Оновлюю…');
        try { await api('/api/prices/refresh', {}); await load(); pricesSheet(pos); } catch (e) { toast(e.message); ev.target.disabled = false; }
      });
      const tr = (d.overview && key === d.key ? d.overview.trend : null) || [];
      lineChart($('#ch-trend', sh), {
        title: _t('Ціна {key} на WOG', { key: _t(d.keys[key]) }), sub: tr.length < 2 ? _t('історія збирається з сьогодні') : _t('₴ за літр, останні 90 днів'),
        points: tr.map(x => ({ t: Date.parse(x.day), d: x.day, y: x.price })),
        tip: p => `<b>${_t('{y} ₴/л', { y: fmt(p.y) })}</b><br>${dayLabel(p.d)}`, head: [_t('Дата'), _t('₴/л')], row: p => [p.d, fmt(p.y)]
      });
    });
  }

  // Скільки грошей реально пішло: заправки з гаманця вже оплачені поповненням
  function paid(e) {
    if (e.k === 'f') return e.x.pay === 'wallet' ? 0 : (e.x.total || 0);
    if (e.k === 't') return e.x.opening ? 0 : (e.x.amount || 0);
    return e.x.amount || 0;
  }
  function topupRow(t) {
    return `<button class="row" data-topup="${esc(t.id)}"><div class="ico">${I.wallet}</div>
      <div class="mid"><b>${t.opening ? _t('Гаманець: початковий залишок') : _t('Поповнення гаманця')}</b><span class="num">${dayLabel(t.date)} · ${esc([fuelName(t.fuel), fmt(t.litres) + _t(' л'), t.litres && t.amount ? fmt(t.amount / t.litres) + _t(' ₴/л') : ''].filter(Boolean).join(' · '))}</span></div>
      <div class="end"><b class="num">${t.opening ? '' : money(t.amount)}</b><span class="chip">${_t('у гаманець')}</span></div></button>`;
  }
  function costRow(c, cm) {
    const k = cm[c.cat] || { id: 'other', name: _t('Інше') };
    return `<button class="row" data-cost="${esc(c.id)}"><div class="ico">${catIco(k)}</div>
      <div class="mid"><b>${esc(c.title || k.name)}</b><span class="num">${dayLabel(c.date)}${c.title && c.title !== k.name ? ' · ' + esc(k.name) : ''}${c.odo ? ' · ' + fmt(c.odo, 0) + _t(' км') : ''}</span></div>
      <div class="end">${c.currency === 'USD' && c.amount_cur ? `<b class="num">$${fmt(c.amount_cur)}</b>${c.amount > 0 ? `<span class="muted num" style="font-size:12px">${money(c.amount)}</span>` : ''}` : `<b class="num">${money(c.amount)}</b>`}${c.queued ? `<span class="chip q">${_t('в черзі')}</span>` : ''}</div></button>`;
  }

  /* ---------- статистика ---------- */
  function segBar() {
    return `<div class="seg" role="tablist">${PERIODS.map(([k, l]) => `<button role="tab" aria-selected="${S.period === k}" data-period="${k}" class="${S.period === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  }
  function viewStats() {
    const r = periodRange(S.period);
    const st = C.stats(S.data.fills, S.data.costs, r);
    const tank = +S.data.settings.tank || 0;
    const tile = (l, v, u, s, ft) => `<div class="tile"><div class="l">${l}</div><div class="v num">${v}${u ? `<small>${u}</small>` : ''}</div>${s ? `<div class="s">${s}</div>` : ''}${ft ? `<div class="tl-foot">${ft}</div>` : ''}</div>`;
    if (!st.fills && !st.costsCount) return segBar() + `<div class="empty"><b>${_t('За цей період даних немає')}</b>${_t('Оберіть довший період.')}</div>`;
    const pr = C.prevPeriodRange(S.period), pst = pr && covered(pr) ? C.stats(S.data.fills, S.data.costs, pr) : null, pl = PREV_LABEL[S.period];
    const mk = miniMonths(st, r), mm = C.monthlyMetrics(S.data.fills, S.data.costs, mk);
    const col = k => mm.map(x => x[k]);
    const dl = (cur, prev, dir) => pst ? dchip(C.pctChange(cur, prev), dir, pl, true) : '';
    const rangeOf = c => tank && c ? tank / c * 100 : null;
    const foot = (chip, vals, best, f) => chip + mini(vals, mk, best, f);
    const lastTile = st.earned || st.bonusSpent
      ? tile(_t('Бонуси'), '+' + cn(st.earned, 0), '', _t('витрачено {bonusSpent}', { bonusSpent: money(st.bonusSpent) }), foot(dl(st.earned, pst && pst.earned, 1), col('earned'), 'max', v => fmt(v, 0)))
      : tile(_t('Остання витрата'), cn(st.lastCons, 2), _t('л/100 км'), '');
    return segBar() + `<section class="total"><div class="l">${_t('Усього на авто')}</div><div class="v num">${cnMoney(st.total)}</div>
      <div class="split"><span><i style="background:var(--s1)"></i>${_t('пальне {fuelSpend} · {litres} л', { fuelSpend: money(st.fuelSpend), litres: fmt(st.litres, 0) })}</span><span><i style="background:var(--s2)"></i>${_t('інше {costSpend}', { costSpend: money(st.costSpend) })}</span></div></section>
    <div class="tiles">
      ${tile(_t('Середня витрата'), cn(st.avgCons, 2), _t('л/100 км'), st.bestCons !== null ? _t('від {bestCons} до {worstCons}', { bestCons: fmt(st.bestCons), worstCons: fmt(st.worstCons) }) : _t('потрібні дві повні заправки'), foot(dl(st.avgCons, pst && pst.avgCons, -1), col('avgCons'), 'min', v => fmt(v) + _t(' л/100')))}
      ${tile(_t('Пальне на 1 км'), cn(st.fuelPerKm, 2), '₴', _t('усе авто {totalPerKm} ₴/км', { totalPerKm: fmt(st.totalPerKm) }), foot(dl(st.fuelPerKm, pst && pst.fuelPerKm, -1), col('fuelPerKm'), 'min', v => fmt(v) + _t(' ₴/км')))}
      ${tile(_t('Пробіг'), cn(st.km, 0), _t('км'), st.kmPerDay ? _t('≈ {kmPerDay} км на день', { kmPerDay: fmt(st.kmPerDay, 0) }) : '', foot(dl(st.km, pst && pst.km, 0), col('km'), 'max', v => fmt(v, 0) + _t(' км')))}
      ${tile(_t('Середня ціна'), cn(st.avgPrice, 2), _t('₴/л'), `${st.fills} ${plural(st.fills, 'заправка', 'заправки', 'заправок')}`, foot(dl(st.avgPrice, pst && pst.avgPrice, -1), col('avgPrice'), 'min', v => fmt(v) + _t(' ₴/л')))}
      ${tile(_t('Запас ходу'), tank && st.avgCons ? cn(tank / st.avgCons * 100, 0) : '—', _t('км'), tank ? _t('повний бак {tank} л', { tank: fmt(tank, 0) }) : _t('вкажіть об’єм бака в «Ще»'), tank ? foot(dl(rangeOf(st.avgCons), pst && rangeOf(pst.avgCons), 1), mm.map(x => rangeOf(x.avgCons)), 'max', v => fmt(v, 0) + _t(' км')) : '')}
      ${lastTile}
    </div>
        <div class="chart" id="ch-cons"></div>
    <div class="chart" id="ch-month"></div>
    <div class="chart" id="ch-price"></div>
    ${costsBlock(st, r)}${tripsBlock()}`;
  }

  /* SVG-графіки: одна вісь, тонкі лінії, підказка при наведенні/дотику, таблиця для доступності */
  function axisTicks(min, max, n) {
    if (min === max) { min -= 1; max += 1; }
    const raw = (max - min) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= raw);
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const out = []; for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
    return out;
  }
  function tableHtml(head, rows) {
    return `<details class="tbl"><summary>${_t('Таблиця')}</summary><table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td class="num">${c}</td>`).join('')}</tr>`).join('')}</table></details>`;
  }
  // шапка графіка: назва, велике значення і плашка динаміки
  function chartHead(cfg) {
    return `<h3>${cfg.title}</h3><p class="sub">${cfg.sub}</p><div class="ch-big"><span class="v num">${cfg.big || '—'}${cfg.unit ? `<small>${cfg.unit}</small>` : ''}</span>${cfg.chip || ''}</div>`;
  }
  // підписи осі X рівномірно за часом; однакові підряд не повторюємо
  function timeTicks(x0, x1, X) {
    const span = (x1 - x0) / 864e5, n = 4, out = []; let last = '';
    for (let k = 0; k < n; k++) {
      const d = new Date(x0 + (x1 - x0) * k / (n - 1));
      const lbl = span <= 62 ? `${d.getDate()} ${MON_SHORT[d.getMonth()]}` : `${MON_SHORT[d.getMonth()]} ’${String(d.getFullYear()).slice(2)}`;
      if (lbl !== last) out.push({ x: X(d.getTime()), lbl, a: k === 0 ? 'start' : k === n - 1 ? 'end' : 'middle' });
      last = lbl;
    }
    return out;
  }
  function lineChart(el, cfg) {
    const pts = cfg.points;
    el.innerHTML = chartHead(cfg) + (cfg.ref ? `<div class="legend"><span><i class="dash"></i>${_t('середня {ref}', { ref: fmt(cfg.ref) })}</span></div>` : '');
    if (pts.length < 2) { el.insertAdjacentHTML('beforeend', `<p class="muted" style="margin:6px 0 10px">${_t('Замало даних для графіка.')}</p>`); return; }
    const W = Math.max(280, el.clientWidth - 28), H = 190, L = 40, R = 12, T = 12, Bm = 26;
    const xs = pts.map(p => p.t), ys = pts.map(p => p.y).concat(cfg.ref ? [cfg.ref] : []);
    const ticks = axisTicks(Math.min.apply(null, ys), Math.max.apply(null, ys), 4);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    const X = t => L + (x1 === x0 ? 0.5 : (t - x0) / (x1 - x0)) * (W - L - R);
    const Y = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - Bm);
    const gid = 'g-' + el.id, base = H - Bm;
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(cfg.title)}"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--s1);stop-opacity:.38"/><stop offset="1" style="stop-color:var(--s1);stop-opacity:0"/></linearGradient></defs>`;
    ticks.forEach(v => { svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${fmt(v, 2)}</text>`; });
    timeTicks(x0, x1, X).forEach(k => { svg += `<text class="ax" x="${k.x}" y="${H - 6}" text-anchor="${k.a}">${k.lbl}</text>`; });
    if (cfg.ref) svg += `<line x1="${L}" x2="${W - R}" y1="${Y(cfg.ref)}" y2="${Y(cfg.ref)}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="4 4"/>`;
    const line = pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join('');
    svg += `<path class="area" d="${line}L${X(pts[pts.length - 1].t).toFixed(1)} ${base}L${X(pts[0].t).toFixed(1)} ${base}Z" fill="url(#${gid})"/>`;
    svg += `<path class="ln" pathLength="1" d="${line}" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (pts.length <= 40) pts.forEach(p => { svg += `<circle class="dot" cx="${X(p.t)}" cy="${Y(p.y)}" r="3" fill="var(--s1)" stroke="var(--surface)" stroke-width="2"/>`; });
    svg += `<line class="xh" x1="0" x2="0" y1="${T}" y2="${base}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/><circle class="mk" r="5" fill="var(--s1)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>`;
    svg += `<rect x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/></svg>`;
    el.insertAdjacentHTML('beforeend', svg + '<div class="tip"></div>' + tableHtml(cfg.head, pts.map(cfg.row)));
    hover(el, pts.map(p => ({ x: X(p.t), y: Y(p.y), html: cfg.tip(p) })), true);
  }
  function barChart(el, cfg) {
    const ms = cfg.months;
    el.innerHTML = chartHead(cfg) + `<div class="legend"><span><i style="background:var(--s1)"></i>${_t('Пальне')}</span><span><i style="background:var(--s2)"></i>${_t('Інші витрати')}</span></div>`;
    if (!ms.length) return;
    const W = Math.max(280, el.clientWidth - 28), H = 190, L = 44, R = 6, T = 10, Bm = 24;
    const ticks = axisTicks(0, Math.max.apply(null, ms.map(m => m.fuel + m.costs)), 4);
    const y1 = ticks[ticks.length - 1];
    const Y = v => T + (1 - v / y1) * (H - T - Bm);
    const slot = (W - L - R) / ms.length, bw = Math.min(28, slot * 0.6), step = Math.min(35, 450 / ms.length);
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(cfg.title)}">`;
    ticks.forEach(v => { svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${fmt(v, 0)}</text>`; });
    // підписи місяців: не частіше ніж раз на ~46px, щоб не накладались
    const every = Math.max(1, Math.ceil(46 / slot));
    const marks = [];
    ms.forEach((m, i) => {
      const cx = L + slot * (i + 0.5), x = cx - bw / 2;
      const yF = Y(m.fuel), yC = Y(m.fuel + m.costs), d = `style="--d:${Math.round(i * step)}ms"`;
      // нижній сегмент — пальне, верхній — інші витрати; 2px проміжок між ними, заокруглений верх стовпця
      if (m.fuel > 0) svg += `<path class="sb" ${d} d="${roundTop(x, yF, bw, Y(0) - yF, m.costs > 0 ? 0 : 4)}" fill="var(--s1)"/>`;
      if (m.costs > 0) svg += `<path class="sb" ${d} d="${roundTop(x, yC, bw, Math.max(1, yF - yC - (m.fuel > 0 ? 2 : 0)), 4)}" fill="var(--s2)"/>`;
      if ((ms.length - 1 - i) % every === 0) svg += `<text class="ax" x="${cx}" y="${H - 6}" text-anchor="middle">${MON_SHORT[+m.month.slice(5) - 1]}${ms.length > 12 || m.month.slice(5) === '01' ? ' ’' + m.month.slice(2, 4) : ''}</text>`;
      marks.push({ x: cx, y: yC, html: `<b>${MONTHS[+m.month.slice(5) - 1]} ${m.month.slice(0, 4)}</b><br>${_t('Пальне: {fuel}', { fuel: money(m.fuel) })}<br>${_t('Інші: {costs}', { costs: money(m.costs) })}<br>${_t('Разом: {costs}', { costs: money(m.fuel + m.costs) })}` });
    });
    svg += `<line class="xh" x1="0" x2="0" y1="${T}" y2="${H - Bm}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>`;
    svg += `<rect x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/></svg>`;
    el.insertAdjacentHTML('beforeend', svg + '<div class="tip"></div>' + tableHtml([_t('Місяць'), _t('Пальне'), _t('Інші'), _t('Літри')], ms.map(m => [m.month, fmt(m.fuel, 0), fmt(m.costs, 0), fmt(m.litres, 1)])));
    hover(el, marks, true);
  }
  function roundTop(x, y, w, h, r) {
    r = Math.min(r, h, w / 2);
    return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
  }
  function hover(el, marks, line) {
    const svg = $('svg', el), tip = $('.tip', el), xh = $('.xh', el), mk = $('.mk', el);
    const show = ev => {
      const box = svg.getBoundingClientRect();
      const sx = (ev.clientX - box.left) * (svg.viewBox.baseVal.width / box.width);
      let best = marks[0]; marks.forEach(m => { if (Math.abs(m.x - sx) < Math.abs(best.x - sx)) best = m; });
      const k = box.width / svg.viewBox.baseVal.width;
      tip.innerHTML = best.html; tip.style.display = 'block';
      const host = el.getBoundingClientRect(); // у SVG немає offsetLeft/offsetTop
      const left = Math.min(Math.max(best.x * k + box.left - host.left, 70), el.clientWidth - 70);
      tip.style.left = left + 'px'; tip.style.top = (best.y * k + box.top - host.top - 10) + 'px';
      if (line && xh) { xh.setAttribute('x1', best.x); xh.setAttribute('x2', best.x); xh.setAttribute('visibility', 'visible'); if (mk) { mk.setAttribute('cx', best.x); mk.setAttribute('cy', best.y); mk.setAttribute('visibility', 'visible'); } }
    };
    const hide = () => { tip.style.display = 'none'; if (xh) { xh.setAttribute('visibility', 'hidden'); if (mk) mk.setAttribute('visibility', 'hidden'); } };
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', hide);
  }
  function drawCharts() {
    const r = periodRange(S.period);
    const st = C.stats(S.data.fills, S.data.costs, r);
    const pr = C.prevPeriodRange(S.period), pst = pr && covered(pr) ? C.stats(S.data.fills, S.data.costs, pr) : null, pl = PREV_LABEL[S.period];
    const chip = (cur, prev) => pst ? dchip(C.pctChange(cur, prev), -1, pl) : '';
    const sg = segs();
    const inR = d => (!r.from || d >= r.from);
    const fills = C.ordered(S.data.fills).filter(f => inR(f.date));
    const t = d => Date.parse(d.slice(0, 10));
    const consPts = fills.filter(f => sg[f.id]).map(f => ({ t: t(f.date), d: f.date, y: Math.round(sg[f.id].cons * 100) / 100, dist: sg[f.id].dist }));
    lineChart($('#ch-cons'), {
      title: _t('Витрата пального'), sub: _t('л/100 км між повними заправками'), points: consPts, ref: st.avgCons,
      big: cn(st.avgCons, 2), unit: _t('л/100'), chip: chip(st.avgCons, pst && pst.avgCons),
      tip: p => `<b>${_t('{y} л/100 км', { y: fmt(p.y) })}</b><br>${_t('{d} · {dist} км', { d: dayLabel(p.d), dist: fmt(p.dist, 0) })}`,
      head: [_t('Дата'), _t('л/100 км'), _t('км')], row: p => [p.d.slice(0, 10), fmt(p.y), fmt(p.dist, 0)]
    });
    // повний ряд місяців періоду, навіть порожніх
    const e = new Date(), endKey = `${e.getFullYear()}-${pad(e.getMonth() + 1)}`;
    const startM = r.from ? r.from.slice(0, 7) : (st.months[0] || {}).month;
    const byM = {}; st.months.forEach(m => { byM[m.month] = m; });
    const months = startM ? C.monthKeys(startM, endKey, 120).map(k => byM[k] || { month: k, fuel: 0, costs: 0, litres: 0 }) : [];
    barChart($('#ch-month'), {
      title: _t('Витрати по місяцях'), sub: _t('₴, пальне та інші витрати на авто'), months,
      big: cnMoney(st.total), chip: chip(st.total, pst && pst.total)
    });
    lineChart($('#ch-price'), {
      title: _t('Ціна пального'), sub: _t('₴ за літр'), points: fills.filter(f => f.price > 0).map(f => ({ t: t(f.date), d: f.date, y: f.price, fuel: f.fuel })),
      big: cn(st.avgPrice, 2), unit: _t('₴/л · середня'), chip: chip(st.avgPrice, pst && pst.avgPrice),
      tip: p => `<b>${_t('{y} ₴/л', { y: fmt(p.y) })}</b><br>${dayLabel(p.d)}${p.fuel ? ' · ' + esc(fuelName(p.fuel)) : ''}`,
      head: [_t('Дата'), _t('₴/л'), _t('Пальне')], row: p => [p.d.slice(0, 10), fmt(p.y), esc(fuelName(p.fuel))]
    });
  }

  /* ---------- витрати ---------- */
  // витрати на авто (крім пального) за обраний період — у Статистиці
  function costsBlock(st, r) {
    const cm = cats();
    const list = S.data.costs.filter(c => !r.from || c.date >= r.from);
    const rows = Object.entries(st.byCat).sort((a, b) => b[1] - a[1]);
    const max = rows.length ? rows[0][1] : 0;
    let html = `<h4>${_t('Інші витрати{costSpend}', { costSpend: st.costSpend ? ' · ' + money(st.costSpend) : '' })}</h4>`;
    if (!list.length) return html + `<div class="empty"><b>${_t('Витрат немає')}</b>${_t('ТО, мийка, страховка, паркування — додавайте через «+».')}</div>`;
    html += '<div class="list bars">' + rows.map(([id, sum]) => {
      const k = cm[id] || { id: 'other', name: _t('Інше') };
      return `<div class="row"><div class="ico">${catIco(k)}</div><div class="mid"><b>${esc(k.name)}</b><div class="bar"><i style="width:${Math.max(2, sum / max * 100)}%"></i></div></div><div class="end"><b class="num">${money(sum)}</b><span class="muted num" style="font-size:12px">${fmt(sum / st.costSpend * 100, 0)}%</span></div></div>`;
    }).join('') + '</div>';
    html += `<details class="off"><summary>${_t('Усі записи ({length})', { length: list.length })}</summary><div class="list">${list.map(c => costRow(c, cm)).join('')}</div></details>`;
    return html;
  }

  /* ---------- сервіс ---------- */
  const KIND = lazyObj(() => ({ oil: [I.oil, _t('Масло двигуна')], air: [I.air, _t('Повітряний фільтр')], cabin: [I.fan, _t('Салонний фільтр')], brakefluid: [I.disc, _t('Гальмівна рідина')],
    brakes: [I.pads, _t('Гальмівні колодки')], plugs: [I.zap, _t('Свічки')], atf: [I.cog, _t('Масло АКПП')], coolant: [I.thermo, _t('Антифриз')], belt: [I.belt, _t('Ремінь / ролики')],
    battery: [I.battery, _t('Акумулятор')], insurance: [I.doc, _t('Страховка')], inspection: [I.search, _t('Діагностика')], custom: [I.wrench, _t('Інше')] }));
  const kIco = k => (KIND[k] || KIND.custom)[0];
  const SEASON = lazyObj(() => ({ summer: _t('Літні'), winter: _t('Зимові'), all: _t('Всесезонні') }));
  const SEASON_ICO = { summer: I.sun, winter: I.snow, all: I.allseason };
  const LVL_ORDER = { due: 0, soon: 1, ok: 2, unknown: 3, off: 4 };
  const svc = () => S.data.service || { alerts: [], hints: [], reminders: {}, tires: {}, odo: {}, season: {} };
  function durTxt(d) {
    if (d < 45) return d + _t(' дн.');
    const m = Math.round(d / 30.4);
    return m < 18 ? m + _t(' міс.') : fmt(d / 365, 1) + _t(' р.');
  }
  function remLine(r, st) {
    if (!st || st.level === 'off') return _t('вимкнено');
    if (st.level === 'unknown') return r.kind === 'insurance' ? _t('вкажіть, до якої дати діє поліс') : _t('вкажіть, коли робили востаннє');
    const p = [];
    if (st.kmLeft !== null) p.push(st.kmLeft <= 0 ? _t('пробіг перевищено на {kmLeft} км', { kmLeft: fmt(-st.kmLeft, 0) }) : _t('через {kmLeft} км', { kmLeft: fmt(st.kmLeft, 0) }));
    if (st.hoursLeft !== null && st.hoursLeft !== undefined) p.push(st.hoursLeft <= 0 ? _t('мотогодин: {hoursEstimated}{hoursUsed} з {dueHours}', { hoursEstimated: st.hoursEstimated ? '≈ ' : '', hoursUsed: fmt(st.hoursUsed, 0), dueHours: fmt(st.dueHours, 0) }) : _t('через {hoursEstimated}{hoursLeft} мотогод', { hoursEstimated: st.hoursEstimated ? '~' : '', hoursLeft: fmt(st.hoursLeft, 0) }));
    if (st.daysLeft !== null) p.push(st.daysLeft < 0 ? _t('термін минув {daysLeft} тому', { daysLeft: durTxt(-st.daysLeft) }) : (r.kind === 'insurance' ? _t('діє до ') : _t('до ')) + dayLabel(st.dueDate));
    if (st.snoozed) p.push(st.snoozedText || _t('відкладено до ') + dayLabel(st.snoozed));
    return p.join(' · ');
  }
  const intervalTxt = r => [r.every_km ? _t('кожні {every_km} км', { every_km: fmt(r.every_km, 0) }) : '', r.every_hours ? _t('кожні {every_hours} мотогод', { every_hours: fmt(r.every_hours, 0) }) : '', r.every_days ? (r.every_days % 365 === 0 ? `${r.every_days / 365 === 1 ? _t('щороку') : _t('кожні ') + r.every_days / 365 + _t(' р.')}` : _t('кожні {every_days} міс.', { every_days: Math.round(r.every_days / 30.4) })) : ''].filter(Boolean).join(_t(' або '));
  const lvChip = (l, snoozed) => l === 'due' ? `<span class="chip due">${_t('час')}</span>` : l === 'soon' ? `<span class="chip soon">${snoozed ? _t('відкладено') : _t('скоро')}</span>` : '';

  function alertBanners(list) {
    const ic = { reminder: I.wrench, swap: I.swap, buy: I.cart, worn: I.tire, bm300: I.battery, battery: I.battery };
    return list.map(a => `<button class="banner lv-${a.level}" data-alert="${esc(a.kind)}" data-ref="${esc(a.ref || '')}"><div class="ico">${a.kind === 'reminder' ? kIco((S.data.reminders.find(r => r.id === a.ref) || {}).kind) : ic[a.kind]}</div><div style="min-width:0"><b>${esc(a.title)}</b><span>${esc(a.text)}</span></div></button>`).join('');
  }

  function viewService() {
    const sv = svc();
    let html = alertBanners(sv.alerts);
    html += sv.hints.map(h => `<button class="banner" style="background:var(--surface)" data-hint="${esc(h.kind)}" data-ref="${esc(h.ref || '')}"><div class="ico">${I.tire}</div><div><span style="color:var(--ink)">${esc(h.text)}</span></div></button>`).join('');
    const o = sv.odo || {};
    html += `<section class="hero" style="grid-template-columns:1fr 1fr"><div><div class="v num">${cn(sv.odoNow, 0)}<small>${_t('км')}</small></div><div class="l">${o.est > o.known ? (o.method === 'engine' ? _t('пробіг зараз (оцінка за часом роботи двигуна)') : _t('пробіг зараз (оцінка)')) : _t('пробіг')}</div></div>
      <div><div class="v num">${o.perDay ? cn(o.perDay, 0) : '—'}<small>${_t('км/день')}</small></div><div class="l">${o.date ? _t('останній запис ') + dayLabel(o.date) + ' — ' + fmt(o.known, 0) + _t(' км') : _t('середній пробіг')}</div></div></section>`;

    html += oilRing(sv);

    const rs = S.data.reminders.slice().sort((a, b) => {
      const A = sv.reminders[a.id] || {}, B = sv.reminders[b.id] || {};
      return (LVL_ORDER[A.level] - LVL_ORDER[B.level]) || ((B.progress || 0) - (A.progress || 0));
    });
    const on = rs.filter(r => r.active), off = rs.filter(r => !r.active);
    html += `<h4>${_t('Обслуговування')}</h4><div class="list">` + on.map(r => remRow(r, sv.reminders[r.id])).join('') +
      `<button class="row" data-act="rem-new"><div class="ico" style="color:var(--accent)">${I.plus}</div><div class="mid"><b style="color:var(--accent)">${_t('Додати роботу')}</b><span>${_t('колодки, ремінь, акумулятор…')}</span></div></button></div>`;
    if (off.length) html += `<details class="off"><summary>${_t('Вимкнені ({length})', { length: off.length })}</summary><div class="list">${off.map(r => remRow(r, sv.reminders[r.id])).join('')}</div></details>`;

    html += tiresBlock(sv);
    html += carBlock();
    return html;
  }
  // кільце масла двигуна: скільки ресурсу вже вибрано; у центрі — найближча умова (пробіг, час або мотогодини)
  function oilRing(sv) {
    const r = S.data.reminders.find(x => x.kind === 'oil' && x.active), st = r && sv.reminders[r.id];
    if (!st || st.level === 'unknown' || st.level === 'off') return '';
    const opts = [];
    if (r.every_km > 0 && st.kmLeft !== null && st.kmLeft !== undefined) opts.push({ f: st.kmLeft / r.every_km, left: st.kmLeft, v: fmt(st.kmLeft, 0), u: _t('км') });
    if (r.every_days > 0 && st.daysLeft !== null && st.daysLeft !== undefined) opts.push({ f: st.daysLeft / r.every_days, left: st.daysLeft, v: st.daysLeft > 365 ? fmt(st.daysLeft / 365, 1) : st.daysLeft < 45 ? String(st.daysLeft) : String(Math.round(st.daysLeft / 30.4)), u: st.daysLeft > 365 ? _t('р.') : st.daysLeft < 45 ? _t('дн.') : _t('міс.') });
    if (r.every_hours > 0 && st.hoursLeft !== null && st.hoursLeft !== undefined) opts.push({ f: st.hoursLeft / r.every_hours, left: st.hoursLeft, v: fmt(st.hoursLeft, 0), u: _t('мотогод') });
    const near = opts.sort((a, b) => a.f - b.f)[0];
    const p = Math.max(0, Math.min(1, st.progress || 0)), R = 34, Cc = 2 * Math.PI * R;
    const center = near && near.left > 0 ? `<b class="num">${near.v}</b><small>${near.u}</small>` : `<b>${_t('час')}</b>`;
    return `<button class="oil lv-${st.level}" data-rem="${esc(r.id)}"><div class="ring" role="img" aria-label="${_t('Ресурс масла вибрано на {p}%', { p: Math.round(p * 100) })}">
      <svg viewBox="0 0 84 84"><circle class="trk" cx="42" cy="42" r="${R}"/><circle class="arc" cx="42" cy="42" r="${R}" transform="rotate(-90 42 42)" stroke-dasharray="${Cc.toFixed(1)}" stroke-dashoffset="${(Cc * (1 - p)).toFixed(1)}" style="--c:${Cc.toFixed(1)}"/></svg><div class="mid-t">${center}</div></div>
      <div class="mid"><b>${esc(_t(r.title))}</b><span class="num rl">${esc(remLine(r, st))}</span><span class="num">${_t('вибрано {p}% ресурсу', { p: Math.round(p * 100) })}</span></div>${lvChip(st.level, st.snoozed)}</button>`;
  }

  function remRow(r, st) {
    st = st || {};
    const pct = Math.round((st.progress || 0) * 100);
    return `<button class="row" data-rem="${esc(r.id)}"><div class="ico">${kIco(r.kind)}</div>
      <div class="mid"><b>${esc(_t(r.title))}</b><span class="num">${esc(remLine(r, st))}</span>${st.level === 'unknown' || st.level === 'off' ? '' : `<div class="bar lv-${st.level}"><i style="width:${Math.max(3, pct)}%"></i></div>`}</div>
      <div class="end">${lvChip(st.level, st.snoozed)}</div></button>`;
  }

  function wheelGrid(last, warn, small) {
    const cell = (k, l) => {
      const v = last ? last[k] : null;
      const c = v === null || v === undefined ? '' : v < warn ? 'due' : v < warn + 1 ? 'soon' : 'ok';
      return `<div class="wh ${c}"><b class="num">${v === null || v === undefined ? '—' : fmt(v, 1)}</b><small>${l}</small></div>`;
    };
    return `<div class="wheels${small ? ' sm' : ''}" aria-label="${_t('Протектор по колесах, мм')}">${cell('fl', _t('ліве перед.'))}${cell('fr', _t('праве перед.'))}<div class="axle"></div>${cell('rl', _t('ліве зад.'))}${cell('rr', _t('праве зад.'))}</div>`;
  }
  function tiresBlock(sv) {
    const sets = S.data.tireSets.filter(x => !x.retired);
    const se = sv.season || {};
    const sg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), 0);
    const wx = se.source === 'forecast' ? _t('Ночі на тиждень: {nightMin}…{nightMax} °C (нижче 0 °C: {frostNights} з {days}){soon}', { nightMin: sg(se.nightMin), nightMax: sg(se.nightMax), frostNights: se.frostNights, days: se.days, soon: se.soon ? _t(' — скоро перевзуватись') : '' }) : _t('За календарем');
    let html = `<h4>${_t('Шини')}</h4>`;
    const m = sets.find(x => x.mounted);
    if (sets.length) html += `<p class="hint season" style="margin:-2px 4px 8px">${SEASON_ICO[se.need] || ''}<span>${_t('{wx} → зараз потрібні {need}', { wx: esc(wx), need: (SEASON[se.need] || '').toLowerCase() })}${m && m.season !== 'all' && m.season !== se.need ? ` — <b style="color:var(--danger)">${_t('час переобутись')}</b>` : m ? _t(', стоять правильні') : ''}.</span></p>`;
    if (m) {
      const t = sv.tires[m.id] || {};
      html += `<button class="card tirecard" data-set="${esc(m.id)}"><div class="tc-head"><div><b class="ti">${SEASON_ICO[m.season]}${esc(_t(m.name))}</b><span>${esc([m.brand, m.size || S.data.settings.carTireSize, t.year ? 'DOT ' + t.year : ''].filter(Boolean).join(' · ') || _t('на колесах'))}</span></div>${lvChip(t.level)}</div>
        ${wheelGrid(t.last, t.warn || 3)}
        <div class="tc-foot"><span>${t.last ? _t('замір {date}', { date: dayLabel(t.last.date) }) : _t('ще не міряли')}${t.mountedDate ? ` ${_t('· стоять з {mountedDate}', { mountedDate: dayLabel(t.mountedDate) })}` : ''}${t.km ? ` ${_t('· {km} км на комплекті', { km: fmt(t.km, 0) })}` : ''}</span>
        <span>${t.kmLeft !== null && t.kmLeft !== undefined ? _t('≈ {kmLeft} км до {warn} мм ({rate} мм/1000 км)', { kmLeft: fmt(t.kmLeft, 0), warn: fmt(t.warn, 0), rate: fmt(t.rate) }) : t.depth !== null && t.depth !== undefined ? _t('поріг заміни {warn} мм — для прогнозу потрібен ще один замір', { warn: fmt(t.warn, 0) }) : ''}</span>
        ${t.why && t.why.length ? `<span style="color:var(--danger)">${esc(t.why.join(', '))}</span>` : ''}</div></button>`;
    }
    const rest = sets.filter(x => !x.mounted);
    if (rest.length) html += '<div class="list" style="margin-bottom:10px">' + rest.map(x => {
      const t = sv.tires[x.id] || {};
      return `<button class="row" data-set="${esc(x.id)}"><div class="ico">${SEASON_ICO[x.season]}</div><div class="mid"><b>${esc(_t(x.name))} <span class="muted" style="display:inline;font-weight:400">${_t('· зберігаються')}</span></b>
        <span class="num">${t.depth !== null && t.depth !== undefined ? _t('протектор {depth} мм', { depth: fmt(t.depth, 1) }) : _t('не міряли')}${t.km ? ` ${_t('· {km} км', { km: fmt(t.km, 0) })}` : ''}${t.year ? ` ${_t('· {year} р.', { year: t.year })}` : ''}${t.why && t.why.length ? ' · ' + esc(t.why.join(', ')) : ''}</span></div><div class="end">${lvChip(t.level)}</div></button>`;
    }).join('') + '</div>';
    html += `<div class="btns3">${m ? `<button class="btn sec" data-act="measure">${_t('{ruler}Заміряти', { ruler: I.ruler })}</button>` : ''}${sets.length ? `<button class="btn sec" data-act="swap">${_t('{swap}Переобути', { swap: I.swap })}</button>` : ''}<button class="btn sec" data-act="tireset">${_t('{plus}Комплект', { plus: I.plus })}</button></div>`;
    const retired = S.data.tireSets.filter(x => x.retired);
    if (retired.length) html += `<details class="off"><summary>${_t('Списані комплекти ({length})', { length: retired.length })}</summary><div class="list">${retired.map(x => `<button class="row" data-set="${esc(x.id)}"><div class="ico">${SEASON_ICO[x.season]}</div><div class="mid"><b>${esc(_t(x.name))}</b><span>${esc([x.brand, x.size].filter(Boolean).join(' · '))}</span></div></button>`).join('')}</div></details>`;
    return html;
  }

  const CAR_FIELDS = lazyArr(() => [
    [_t('Основне'), [['carName', _t('Назва'), _t('як підписати в шапці')], ['carMake', _t('Марка')], ['carModel', _t('Модель')], ['carYear', _t('Рік'), '', 'numeric'], ['carPlate', _t('Номер')], ['carVin', 'VIN'], ['carColor', _t('Колір')]]],
    [_t('Двигун і трансмісія'), [['carEngine', _t('Двигун')], ['carPower', _t('Потужність')], ['carGearbox', _t('Коробка')], ['carDrive', _t('Привід')], ['tank', _t('Бак, л'), '', 'decimal']]],
    [_t('Витратні матеріали'), [['carOil', _t('Масло')], ['carOilVolume', _t('Об’єм масла')], ['carOilFilter', _t('Масляний фільтр')], ['carAirFilter', _t('Повітряний фільтр')], ['carCabinFilter', _t('Салонний фільтр')], ['carWipers', _t('Двірники')]]],
    [_t('Шини'), [['carTireSize', _t('Розмір'), '235/50 R17'], ['carTirePressure', _t('Тиск'), _t('2,4 бар')], ['tireWarnSummer', _t('Міняти літні з'), _t('мм'), 'decimal'], ['tireWarnWinter', _t('Міняти зимові з'), _t('мм'), 'decimal']]]
  ]);
  function carBlock() {
    const s = S.data.settings;
    const line = [s.carEngine, s.carPower, s.carGearbox].filter(Boolean).join(' · ');
    const cons = [s.carOil ? _t('масло ') + s.carOil + (s.carOilVolume ? ', ' + s.carOilVolume : '') : '', s.carTireSize ? _t('шини ') + s.carTireSize : ''].filter(Boolean).join(' · ');
    return `<h4>${_t('Авто')}</h4><div class="list"><button class="row" data-act="carinfo"><div class="ico">${I.car}</div><div class="mid"><b>${esc([s.carMake, s.carModel, s.carYear].filter(Boolean).join(' ') || _t('Паспорт авто'))}${s.carPlate ? ' · ' + esc(s.carPlate) : ''}</b>
      <span>${esc(line || _t('двигун, коробка, VIN'))}</span><span>${esc(cons || _t('масло, фільтри, розмір шин'))}</span></div><span class="chev">${I.chev}</span></button>${batRow()}${wishRow()}</div>`;
  }
  function carInfoSheet() {
    const s = S.data.settings;
    const body = CAR_FIELDS.map(([g, fs]) => {
      const rows = fs.filter(([k]) => s[k] !== '' && s[k] !== 0 && s[k] !== undefined && !/^tireWarn/.test(k));
      if (!rows.length) return '';
      return `<h4>${g}</h4><div class="card">${rows.map(([k, l]) => `<div class="f"><label>${l}</label><div class="val">${esc(k === 'tank' ? fmt(s[k]) + _t(' л') : s[k])}</div></div>`).join('')}</div>`;
    }).join('');
    const ins = S.data.reminders.find(r => r.kind === 'insurance' && r.active);
    const insSt = ins && svc().reminders[ins.id];
    openSheet(`${head(_t('Паспорт авто'))}${body || `<p class="muted">${_t('Ще не заповнено.')}</p>`}
      ${ins ? `<h4>${_t('Документи')}</h4><div class="list"><button class="row" data-rem-open="${esc(ins.id)}"><div class="ico">${I.doc}</div><div class="mid"><b>${esc(_t(ins.title))}</b><span>${esc(remLine(ins, insSt))}${ins.note ? ' · ' + esc(ins.note) : ''}</span></div>${lvChip(insSt && insSt.level)}</button></div>` : ''}
      ${s.carNote ? `<h4>${_t('Нотатки')}</h4><div class="card" style="padding:12px 14px;white-space:pre-wrap">${esc(s.carNote)}</div>` : ''}
      <button class="btn" data-edit style="margin-top:14px">${_t('Змінити')}</button>`, sh => {
      $('[data-edit]', sh).addEventListener('click', carForm);
      const b = $('[data-rem-open]', sh); if (b) b.addEventListener('click', () => reminderSheet(S.data.reminders.find(r => r.id === b.dataset.remOpen)));
    });
  }

  function reminderSheet(r) {
    const st = svc().reminders[r.id] || {};
    const facts = [
      [_t('Інтервал'), intervalTxt(r) || (r.due_date ? _t('до дати') : '—')],
      [_t('Востаннє'), r.last_date ? dayLabel(r.last_date) + (r.last_odo ? ` ${_t('· {last_odo} км', { last_odo: fmt(r.last_odo, 0) })}` : '') : _t('не вказано')],
      [_t('Наступного разу'), [st.dueOdo ? _t('на {dueOdo} км', { dueOdo: fmt(st.dueOdo, 0) }) + (st.kmDays > 0 ? ` ${_t('(≈ через {kmDays})', { kmDays: durTxt(st.kmDays) })}` : '') : '', st.dueDate ? _t('до ') + dayLabel(st.dueDate) : ''].filter(Boolean).join(_t(' або ')) || '—']
    ];
    const eg = st.engine;
    const egLine = eg && eg.minutes > 0 ? `${_t('Двигун пропрацював {estimated}{minutes} від {oil}', { estimated: eg.estimated ? '≈ ' : '', minutes: durMin(Math.round(eg.minutes / 60) * 60 || eg.minutes), oil: r.kind === 'oil' ? _t('заміни') : _t('останнього разу') })}${eg.km ? ` ${_t('({estimated}{km} км за середньою швидкістю {avgSpeed} км/год)', { estimated: eg.estimated ? '≈ ' : '', km: fmt(eg.km, 0), avgSpeed: fmt(eg.avgSpeed, 1) })}` : ''}.${eg.estimated ? _t(' Частину часу без звітів BM300 оцінено за пробігом.') : ''}` : '';
    const rec = remRecords(r), cm = cats();
    openSheet(`${head(esc(_t(r.title)))}
      ${st.level === 'due' || st.level === 'soon' ? `<div class="banner lv-${st.level}" style="cursor:default"><div class="ico">${st.snoozed ? I.clock : kIco(r.kind)}</div><div><b>${st.snoozed ? _t('Відкладено') : st.level === 'due' ? _t('Час робити') : _t('Скоро')}</b><span>${esc(st.snoozed ? remLine(r, st) : ((svc().alerts.find(a => a.ref === r.id) || {}).text || remLine(r, st)))}</span></div></div>` : ''}
      ${st.snoozed ? `<div class="snz"><button class="btn sec" data-snz="0">${_t('Не відкладати')}</button></div>`
        : st.level === 'due' ? `<div class="snz"><span>${_t('Відкласти нагадування:')}</span><button class="btn sec" data-snz="7">${_t('на тиждень')}</button><button class="btn sec" data-snz="30">${_t('на місяць')}</button></div>` : ''}
      <div class="card">${facts.map(([l, v]) => `<div class="f"><label>${l}</label><div class="val">${esc(v)}</div></div>`).join('')}</div>
      ${rec.last ? `<h4>${_t('Запис про {insurance}', { insurance: r.kind === 'insurance' ? _t('поліс') : _t('останній раз') })}</h4><div class="list">${costRow(rec.last, cm)}</div>`
        : r.last_date ? `<p class="hint">${_t('Запису витрати за {last_date} не знайшов. Наступного разу натисніть «{insurance}» і вкажіть суму — запис прив’яжеться сам.', { last_date: esc(dayLabel(r.last_date)), insurance: r.kind === 'insurance' ? _t('Оформив новий поліс') : _t('Зроблено') })}</p>` : ''}
      ${rec.earlier.length ? `<h4>${_t('Інші записи')}</h4><div class="list">${rec.earlier.map(c => costRow(c, cm)).join('')}</div>` : ''}
      ${egLine ? `<p class="hint">${esc(egLine)}${r.every_hours ? ` ${_t('Інтервал {every_hours} мотогод враховується разом із км і місяцями — що настане раніше.', { every_hours: fmt(r.every_hours, 0) })}` : r.kind === 'oil' ? _t(' У місті з короткими поїздками масло старіє швидше, ніж видно за кілометрами.') : ''}</p>` : ''}
      ${r.note ? `<p class="hint" style="white-space:pre-wrap">${esc(r.note)}</p>` : ''}
      <button class="btn" data-done style="margin-top:12px">${r.kind === 'insurance' ? _t('Оформив новий поліс') : _t('Зроблено')}</button>
      <button class="btn sec" data-edit>${_t('Змінити інтервал і дані')}</button>`, sh => {
      $('[data-done]', sh).addEventListener('click', () => doneForm(r));
      $('[data-edit]', sh).addEventListener('click', () => reminderForm(r));
      $$('[data-snz]', sh).forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await api('/api/reminder/snooze', { id: r.id, days: +b.dataset.snz });
          await load(); toast(+b.dataset.snz ? _t('Відкладено — до того часу без червоного і без push') : _t('Нагадування знову активне'));
          reminderSheet(S.data.reminders.find(x => x.id === r.id));
        } catch (e) { b.disabled = false; toast(e.message); }
      }));
      $$('[data-cost]', sh).forEach(b => b.addEventListener('click', () => costView(S.data.costs.find(c => c.id === b.dataset.cost), () => reminderSheet(S.data.reminders.find(x => x.id === r.id)))));
    });
  }
  // записи витрат, що стосуються нагадування: прив’язаний при «Зроблено» (last_cost), інакше — за словами в назві/примітці
  // (старі нотатки бувають російською, тому шукаємо обома мовами)
  const REM_KW = { oil: /масл|олив|oil/i, air: /повітр|воздуш/i, cabin: /салон/i, brakefluid: /гальмівн\S* рід|тормозн\S* жид|dot ?4/i, brakes: /колодк|гальмівн\S* диск|тормозн\S* диск/i,
    plugs: /свіч|свеч/i, atf: /акпп|коробк|atf/i, coolant: /антифриз|тосол|охолодж/i, belt: /ремін|ремен|ролик/i, battery: /акумулятор|аккумулятор|акб/i,
    insurance: /осцпв|автоцив|каско|страхов|поліс/i, inspection: /діагност|диагност/i };
  const TO_RE = /(^|[^а-яіїєґa-z])ТО([^а-яіїєґa-z]|$)/;
  function remMatch(r, c) {
    const title = c.title || '', t = `${title}\n${c.note || ''}`;
    if (r.title && title.trim().toLowerCase() === r.title.trim().toLowerCase()) return true;
    if (r.kind === 'insurance') return c.cat === 'insurance' || REM_KW.insurance.test(t);
    if (r.kind === 'oil' && REM_KW.atf.test(title)) return false;   // «Масло в АКПП» — не про двигун
    if (r.kind === 'oil' && TO_RE.test(title)) return true;          // планове ТО = масло двигуна
    const kw = REM_KW[r.kind];
    return !!kw && kw.test(t);
  }
  function remRecords(r) {
    const costs = S.data.costs || [];
    const linked = r.last_cost ? costs.find(c => c.id === r.last_cost) : null;
    const hits = costs.filter(c => c !== linked && remMatch(r, c));
    const last = linked || (r.last_date && hits.find(c => c.date.slice(0, 10) === r.last_date)) || null;
    return { last, earlier: hits.filter(c => c !== last).slice(0, 5) };
  }
  function odoField(id, name, val, label) {
    const sv = svc();
    return `<div class="f"><label for="${id}">${label || _t('Пробіг')}</label><input id="${id}" name="${name}" inputmode="numeric" value="${val || ''}" placeholder="${sv.odoNow ? '≈ ' + fmt(sv.odoNow, 0) : ''}" autocomplete="off"><span class="u">${_t('км')}</span></div>`;
  }
  const m2d = m => !m ? 0 : m % 12 === 0 ? m / 12 * 365 : Math.round(m * 30.4);
  const numV = v => parseFloat(String(v).replace(/\s/g, '').replace(',', '.')) || 0;
  function doneForm(r) {
    const s = S.data.settings, ins = r.kind === 'insurance';
    openSheet(`${head(ins ? _t('Новий поліс') : _t('Виконано: ') + esc(_t(r.title)))}<form id="df" novalidate>
      <div class="card">
        <div class="f"><label for="dd">${_t('Дата')}</label><input id="dd" name="date" type="datetime-local" value="${esc(nowStamp().replace(' ', 'T'))}"></div>
        ${ins ? `<div class="f"><label for="du">${_t('Діє до')}</label><input id="du" name="due_date" type="date"></div>` : odoField('do', 'odo', '', _t('Пробіг'))}
      </div>
      ${ins ? '' : `<p class="hint">${_t('Порожній пробіг — візьму оцінку на сьогодні. Від цієї дати й пробігу піде новий відлік.')}</p>`}
      <div class="card">
        <div class="f"><label for="da">${_t('Сума')}</label><input id="da" name="amount" inputmode="decimal" placeholder="${_t('необов’язково')}"><span class="u">₴</span></div>
        <div class="f"><label for="dt">${_t('Що саме')}</label><input id="dt" name="title" value="${esc(r.title)}"></div>
        ${noteField('dn', '', ins ? _t('страховик, номер поліса') : _t('масло, фільтр, СТО'))}
      </div>
      <p class="hint">${_t('Із сумою запис з’явиться у витратах{budgetEnabled}.', { budgetEnabled: s.budgetEnabled ? _t(' і в Бюджеті') : '' })}</p>
      ${accountSelect(s.budgetEnabled ? s.budgetAccount : '')}
      <p class="hint err" id="de" role="alert"></p>
      <button class="btn" type="submit">${_t('Зберегти')}</button></form>`, sh => {
      const f = $('#df', sh); growAll(sh);
      if (ins) f.date.addEventListener('change', () => { if (!f.due_date.value) { const d = new Date(f.date.value.slice(0, 10)); d.setFullYear(d.getFullYear() + 1); d.setDate(d.getDate() - 1); f.due_date.value = d.toISOString().slice(0, 10); } });
      if (ins) f.date.dispatchEvent(new Event('change'));
      f.addEventListener('submit', async e => {
        e.preventDefault();
        const body = { id: r.id, date: f.date.value.replace('T', ' '), odo: ins ? 0 : (numV(f.odo.value) || svc().odoNow || 0), amount: numV(f.amount.value), title: f.title.value, note: f.note.value,
          budget_account: f.budget_account ? f.budget_account.value : '' };
        if (ins) { body.due_date = f.due_date.value; if (f.note.value) body.rnote = f.note.value; }
        try { await api('/api/reminder/done', body); closeSheet(); toast(_t('Записано, новий відлік пішов')); load(); }
        catch (err) { $('#de', sh).textContent = err.message; }
      });
    });
  }
  function reminderForm(r) {
    const isNew = !r;
    r = r || { title: '', kind: 'custom', cat: 'service', every_km: '', every_days: 365, every_hours: '', last_odo: '', last_date: '', due_date: '', note: '', active: 1 };
    const months = r.every_days ? Math.round(r.every_days / 30.4) : '';
    openSheet(`${head(isNew ? _t('Нова робота') : _t('Налаштування'))}<form id="rf" novalidate>
      <div class="card">
        <div class="f"><label for="rt">${_t('Назва')}</label><input id="rt" name="title" value="${esc(r.title)}" placeholder="${_t('Гальмівні колодки')}"></div>
        <div class="f"><label for="rk">${_t('Тип')}</label><select id="rk" name="kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${k === r.kind ? 'selected' : ''}>${v[1]}</option>`).join('')}</select></div>
      </div>
      <h4>${_t('Як часто')}</h4><div class="card">
        <div class="f"><label for="rkm">${_t('Кожні')}</label><input id="rkm" name="every_km" inputmode="numeric" value="${r.every_km || ''}" placeholder="—"><span class="u">${_t('км')}</span></div>
        <div class="f"><label for="rm">${_t('або кожні')}</label><input id="rm" name="months" inputmode="numeric" value="${months}" placeholder="—"><span class="u">${_t('міс.')}</span></div>
        <div class="f"><label for="rh">${_t('або кожні')}</label><input id="rh" name="every_hours" inputmode="numeric" value="${r.every_hours || ''}" placeholder="—"><span class="u">${_t('мотогод')}</span></div>
      </div><p class="hint">${_t('Що настане раніше. Мотогодини рахуються за поїздками BM300; без звітів цей інтервал не діє. Для поліса — 12 міс. і дата «діє до».')}</p>
      <h4>${_t('Востаннє')}</h4><div class="card">
        <div class="f"><label for="rld">${_t('Дата')}</label><input id="rld" name="last_date" type="date" value="${esc(r.last_date)}"></div>
        ${odoField('rlo', 'last_odo', r.last_odo || '', _t('Пробіг'))}
        <div class="f"><label for="rdd">${_t('Діє до')}</label><input id="rdd" name="due_date" type="date" value="${esc(r.due_date)}"></div>
      </div><p class="hint">${_t('«Діє до» — для страховки й іншого з фіксованою датою; тоді інтервал у місяцях лише зсуває її після продовження.')}</p>
      <div class="card">
        <div class="f"><label for="rn">${_t('Примітка')}</label><input id="rn" name="note" value="${esc(r.note)}" placeholder="${_t('яке масло, де робили')}"></div>
        <label class="sw"><span>${_t('Нагадувати')}<small>${_t('вимкніть, якщо робота неактуальна')}</small></span><input type="checkbox" name="active" ${r.active ? 'checked' : ''}></label>
      </div>
      <p class="hint err" id="re" role="alert"></p>
      <button class="btn" type="submit">${_t('Зберегти')}</button>
      ${isNew ? '' : `<button class="btn del" type="button" data-del>${_t('Видалити')}</button>`}</form>`, sh => {
      const f = $('#rf', sh);
      const del = $('[data-del]', sh);
      if (del) del.addEventListener('click', async () => { if (!confirm(_t('Видалити нагадування?'))) return; await api('/api/reminder/delete', { id: r.id }); closeSheet(); load(); });
      f.addEventListener('submit', async e => {
        e.preventDefault();
        try {
          await api('/api/reminder', { id: r.id, title: f.title.value, kind: f.kind.value, cat: f.kind.value === 'insurance' ? 'insurance' : r.cat || 'service',
            every_km: numV(f.every_km.value), every_days: m2d(numV(f.months.value)), every_hours: numV(f.every_hours.value),
            last_date: f.last_date.value, last_odo: numV(f.last_odo.value), due_date: f.due_date.value, note: f.note.value, active: f.active.checked });
          closeSheet(); toast(_t('Збережено')); load();
        } catch (err) { $('#re', sh).textContent = err.message; }
      });
    });
  }

  function tireSetSheet(x) {
    const sv = svc(), t = sv.tires[x.id] || {};
    const ev = S.data.tireEvents.filter(e => e.set_id === x.id).slice().reverse();
    const evTxt = e => e.kind === 'mount' ? _t('Поставили на авто') : e.kind === 'unmount' ? _t('Зняли') : _t('Замір: ') + ['fl', 'fr', 'rl', 'rr'].map(k => e[k] === null ? '—' : fmt(e[k], 1)).join(' / ') + _t(' мм');
    openSheet(`${head(`<span class="ti">${SEASON_ICO[x.season]}${esc(_t(x.name))}</span>`)}
      <p class="muted" style="margin-top:0">${esc([SEASON[x.season], x.brand, x.size || S.data.settings.carTireSize, t.year ? _t('виготовлені ') + t.year + _t(' р.') : '', x.bought ? _t('куплені ') + dayLabel(x.bought) : '', x.mounted ? _t('на авто') : x.retired ? _t('списані') : _t('зберігаються')].filter(Boolean).join(' · '))}</p>
      ${t.last ? wheelGrid(t.last, t.warn || 3) : ''}
      ${t.why && t.why.length ? `<p class="hint err">${esc(t.why.join(', '))}</p>` : ''}
      <div class="card">
        <div class="f"><label>${_t('Пробіг на них')}</label><div class="val">${_t('{km} км', { km: fmt(t.km || 0, 0) })}</div></div>
        <div class="f"><label>${_t('Знос')}</label><div class="val">${t.rate ? fmt(t.rate) + _t(' мм на 1000 км') : _t('потрібно два заміри з різницею від 1500 км')}</div></div>
        ${t.kmLeft !== null && t.kmLeft !== undefined ? `<div class="f"><label>${_t('До заміни')}</label><div class="val">${_t('≈ {kmLeft} км (до {warn} мм)', { kmLeft: fmt(t.kmLeft, 0), warn: fmt(t.warn, 0) })}</div></div>` : ''}
        <div class="f"><label>${_t('Новий протектор')}</label><div class="val">${_t('{new_depth} мм', { new_depth: fmt(x.new_depth, 1) })}</div></div>
      </div>
      ${x.note ? `<p class="hint">${esc(x.note)}</p>` : ''}
      ${ev.length ? `<h4>${_t('Історія')}</h4><div class="list">${ev.map(e => `<div class="row" role="button" tabindex="0" data-ev="${esc(e.id)}" aria-label="${_t('Змінити запис')}"><div class="ico">${e.kind === 'measure' ? I.ruler : e.kind === 'mount' ? I.up : I.down}</div><div class="mid"><b class="num">${esc(evTxt(e))}</b><span class="num">${dayLabel(e.date)}${e.odo ? ' · ' + fmt(e.odo, 0) + _t(' км') : ''}${e.note ? ' · ' + esc(e.note) : ''}</span></div><button class="ibtn del" data-rm-ev="${esc(e.id)}" aria-label="${_t('Видалити запис')}">${I.close}</button></div>`).join('')}</div>` : ''}
      <button class="btn" data-measure style="margin-top:12px">${_t('Заміряти протектор')}</button>
      <button class="btn sec" data-edit>${_t('Змінити комплект')}</button>`, sh => {
      $('[data-measure]', sh).addEventListener('click', () => measureForm(x.id));
      $('[data-edit]', sh).addEventListener('click', () => tireSetForm(x));
      $$('[data-ev]', sh).forEach(r => {
        const open = () => tireEventForm(S.data.tireEvents.find(e => e.id === r.dataset.ev), x.id);
        r.addEventListener('click', open);
        r.addEventListener('keydown', ev => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === r) { ev.preventDefault(); open(); } });
      });
      $$('[data-rm-ev]', sh).forEach(b => b.addEventListener('click', async ev => {
        ev.stopPropagation();
        if (!confirm(_t('Видалити цей запис?'))) return;
        await api('/api/tires/event/delete', { id: b.dataset.rmEv }); await load(); tireSetSheet(S.data.tireSets.find(y => y.id === x.id));
      }));
    });
  }
  function tireSetForm(x) {
    const isNew = !x;
    const se = svc().season || {};
    x = x || { name: '', season: S.data.tireSets.some(y => y.season === 'winter') ? 'summer' : 'winter', size: S.data.settings.carTireSize || '', brand: '', dot: '', new_depth: 8, note: '', retired: 0 };
    let season = x.season;
    openSheet(`${head(isNew ? _t('Новий комплект шин') : _t('Комплект шин'))}<form id="sf2" novalidate>
      <div class="seg" role="radiogroup" aria-label="${_t('Сезон')}">${Object.entries(SEASON).map(([k, l]) => `<button type="button" data-season="${k}" class="${k === season ? 'on' : ''}">${SEASON_ICO[k]}${l}</button>`).join('')}</div>
      <div class="card">
        <div class="f"><label for="sn">${_t('Назва')}</label><input id="sn" name="name" value="${esc(x.name)}" placeholder="${_t('Зимові Nokian')}"></div>
        <div class="f"><label for="sb">${_t('Марка, модель')}</label><input id="sb" name="brand" value="${esc(x.brand)}" placeholder="Nokian Hakkapeliitta R5"></div>
        <div class="f"><label for="ss">${_t('Розмір')}</label><input id="ss" name="size" value="${esc(x.size)}" placeholder="235/50 R17"></div>
        <div class="f"><label for="sd">DOT</label><input id="sd" name="dot" inputmode="numeric" maxlength="4" value="${esc(x.dot)}" placeholder="${_t('3521 = 35 тиждень 2021')}"></div>
        <div class="f"><label for="snd">${_t('Новий протектор')}</label><input id="snd" name="new_depth" inputmode="decimal" value="${dec(x.new_depth)}"><span class="u">${_t('мм')}</span></div>
        <div class="f"><label for="sbt">${_t('Куплені')}</label><input id="sbt" name="bought" type="date" max="${esc(nowStamp().slice(0, 10))}" value="${esc(x.bought || '')}"></div>
        <div class="f"><label for="sno">${_t('Примітка')}</label><input id="sno" name="note" value="${esc(x.note)}" placeholder="${_t('де зберігаються, диски')}"></div>
      </div>
      <p class="hint">${_t('DOT — 4 цифри в овалі на боковині: тиждень і рік випуску. Новий протектор: літні ≈ 8 мм, зимові ≈ 9–10 мм.')}</p>
      ${isNew ? `<div class="card"><label class="sw"><span>${_t('Зараз стоять на авто')}<small>${_t('щоб рахувати пробіг на комплекті')}</small></span><input type="checkbox" name="mount"></label></div>
        <div class="card" id="mnt" hidden>
          <div class="f"><label for="smd">${_t('Поставили')}</label><input id="smd" name="mdate" type="datetime-local" value="${esc(nowStamp().replace(' ', 'T'))}"></div>
          ${odoField('smo', 'modo', '', _t('Пробіг'))}
        </div>`
        : `<div class="card"><label class="sw"><span>${_t('Списані')}<small>${_t('продали, викинули')}</small></span><input type="checkbox" name="retired" ${x.retired ? 'checked' : ''}></label></div>`}
      <p class="hint err" id="se" role="alert"></p>
      <button class="btn" type="submit">${_t('Зберегти')}</button>
      ${isNew ? '' : `<button class="btn del" type="button" data-del>${_t('Видалити комплект з історією')}</button>`}</form>`, sh => {
      const f = $('#sf2', sh);
      $$('[data-season]', sh).forEach(b => b.addEventListener('click', () => { season = b.dataset.season; $$('[data-season]', sh).forEach(y => y.classList.toggle('on', y === b)); }));
      if (f.mount) {
        const mnt = $('#mnt', sh), sync = () => { mnt.hidden = !f.mount.checked; };
        f.mount.addEventListener('change', sync); sync();
      }
      const del = $('[data-del]', sh);
      if (del) del.addEventListener('click', async () => { if (!confirm(_t('Видалити комплект і всі його заміри?'))) return; await api('/api/tires/set/delete', { id: x.id }); closeSheet(); load(); });
      f.addEventListener('submit', async e => {
        e.preventDefault();
        try {
          const r = await api('/api/tires/set', { id: x.id, name: f.name.value, season, brand: f.brand.value, size: f.size.value, dot: f.dot.value, new_depth: numV(f.new_depth.value), note: f.note.value, bought: f.bought.value, retired: f.retired ? f.retired.checked : 0 });
          if (f.mount && f.mount.checked) await api('/api/tires/swap', { to: r.set.id, date: f.mdate.value.replace('T', ' ') || nowStamp(), odo: numV(f.modo.value) || svc().odoNow || 0, note: _t('початковий стан') });
          if (isNew && !S.data.settings.carTireSize && f.size.value) await api('/api/settings', { carTireSize: f.size.value });
          closeSheet(); toast(_t('Комплект збережено')); await load();
          if (isNew && f.mount && f.mount.checked) measureForm(r.set.id);
        } catch (err) { $('#se', sh).textContent = err.message; }
      });
    });
  }
  function depthInputs(vals) {
    vals = vals || {};
    const inp = (k, l) => `<label class="wh-in"><small>${l}</small><input name="${k}" inputmode="decimal" placeholder="${_t('мм')}" autocomplete="off" value="${vals[k] === null || vals[k] === undefined ? '' : String(vals[k]).replace('.', ',')}"></label>`;
    return `<div class="wheels inputs">${inp('fl', _t('ліве перед.'))}${inp('fr', _t('праве перед.'))}<div class="axle"></div>${inp('rl', _t('ліве зад.'))}${inp('rr', _t('праве зад.'))}</div>`;
  }
  function tireEventForm(e, setId) {
    if (!e) return;
    const title = e.kind === 'mount' ? _t('Поставили на авто') : e.kind === 'unmount' ? _t('Зняли') : _t('Замір протектора');
    const back = () => tireSetSheet(S.data.tireSets.find(y => y.id === setId));
    openSheet(`${head(title)}<form id="ef" novalidate>
      <div class="card">
        <div class="f"><label for="ed">${_t('Дата')}</label><input id="ed" name="date" type="datetime-local" value="${esc(e.date.replace(' ', 'T'))}"></div>
        ${odoField('eo', 'odo', e.odo ? String(Math.round(e.odo)) : '', _t('Пробіг'))}
      </div>
      ${e.kind === 'measure' ? depthInputs(e) : ''}
      <div class="card"><div class="f"><label for="en">${_t('Примітка')}</label><input id="en" name="note" value="${esc(e.note)}"></div></div>
      ${e.kind === 'measure' ? '' : `<p class="hint">${_t('Витрату шиномонтажу змінюйте в журналі.')}</p>`}
      <p class="hint err" id="ee" role="alert"></p>
      <button class="btn" type="submit">${_t('Зберегти')}</button>
      <button class="btn sec" type="button" data-back>${_t('Скасувати')}</button></form>`, sh => {
      const f = $('#ef', sh);
      $('[data-back]', sh).addEventListener('click', back);
      f.addEventListener('submit', async ev => {
        ev.preventDefault();
        const v = k => f[k] && f[k].value.trim() ? numV(f[k].value) : '';
        try {
          await api('/api/tires/event', { id: e.id, date: f.date.value.replace('T', ' '), odo: numV(f.odo.value), note: f.note.value, fl: v('fl'), fr: v('fr'), rl: v('rl'), rr: v('rr') });
          toast(_t('Збережено')); await load(); back();
        } catch (err) { $('#ee', sh).textContent = err.message; }
      });
    });
  }
  function measureForm(setId) {
    const sets = S.data.tireSets.filter(x => !x.retired);
    if (!sets.length) return tireSetForm(null);
    setId = setId || (sets.find(x => x.mounted) || sets[0]).id;
    openSheet(`${head(_t('Замір протектора'))}<form id="mf" novalidate>
      <div class="card">
        <div class="f"><label for="ms">${_t('Комплект')}</label><select id="ms" name="set_id">${sets.map(x => `<option value="${esc(x.id)}" ${x.id === setId ? 'selected' : ''}>${esc(_t(x.name))}${x.mounted ? _t(' (на авто)') : ''}</option>`).join('')}</select></div>
        <div class="f"><label for="md">${_t('Дата')}</label><input id="md" name="date" type="datetime-local" value="${esc(nowStamp().replace(' ', 'T'))}"></div>
        ${odoField('mo', 'odo', '', _t('Пробіг'))}
      </div>
      <p class="hint">${_t('Глибина в найзношенішому місці кожної шини, мм. Без глибиноміра: монета 1 грн, тризуб до основи ≈ 3 мм. Порожнє поле — колесо не міряли.')}</p>
      ${depthInputs()}
      <div class="card"><div class="f"><label for="mn">${_t('Примітка')}</label><input id="mn" name="note" placeholder="${_t('нерівний знос, грижа…')}"></div></div>
      <p class="hint err" id="me" role="alert"></p>
      <button class="btn" type="submit">${_t('Зберегти')}</button></form>`, sh => {
      const f = $('#mf', sh);
      // перше введене значення пропонуємо для порожніх коліс (часто міряють однаково)
      f.fl.addEventListener('change', () => ['fr', 'rl', 'rr'].forEach(k => { if (!f[k].value) f[k].placeholder = f.fl.value; }));
      f.addEventListener('submit', async e => {
        e.preventDefault();
        const v = k => f[k].value.trim() ? numV(f[k].value) : '';
        try {
          await api('/api/tires/measure', { set_id: f.set_id.value, date: f.date.value.replace('T', ' '), odo: numV(f.odo.value) || svc().odoNow || 0, fl: v('fl'), fr: v('fr'), rl: v('rl'), rr: v('rr'), note: f.note.value });
          closeSheet(); toast(_t('Замір записано')); load();
        } catch (err) { $('#me', sh).textContent = err.message; }
      });
    });
  }
  function swapForm() {
    const sets = S.data.tireSets.filter(x => !x.retired);
    const cur = sets.find(x => x.mounted);
    const need = (svc().season || {}).need;
    const cand = sets.filter(x => !x.mounted);
    if (!cand.length) { toast(_t('Додайте комплект, який ставите')); return tireSetForm(null); }
    const pick = (cand.find(x => x.season === need) || cand[0]).id;
    const s = S.data.settings;
    openSheet(`${head(_t('Переобування'))}<form id="wf" novalidate>
      <div class="card">
        <div class="f"><label for="wt">${_t('Ставимо')}</label><select id="wt" name="to">${cand.map(x => `<option value="${esc(x.id)}" ${x.id === pick ? 'selected' : ''}>${esc(_t(x.name))}</option>`).join('')}</select></div>
        <div class="f"><label for="wd">${_t('Дата')}</label><input id="wd" name="date" type="datetime-local" value="${esc(nowStamp().replace(' ', 'T'))}"></div>
        ${odoField('wo', 'odo', '', _t('Пробіг'))}
      </div>
      ${cur ? `<h4>${_t('Протектор знятих «{name}»', { name: esc(_t(cur.name)) })}</h4><p class="hint">${_t('Заміряйте, поки колеса зняті, — так «Бак» порахує знос і нагадає вчасно купити нові.')}</p>${depthInputs()}` : ''}
      <div class="card">
        <div class="f"><label for="wa">${_t('Шиномонтаж')}</label><input id="wa" name="amount" inputmode="decimal" placeholder="${_t('необов’язково')}"><span class="u">₴</span></div>
        <div class="f"><label for="wn">${_t('Примітка')}</label><input id="wn" name="note" placeholder="${_t('СТО, балансування')}"></div>
      </div>
      ${accountSelect(s.budgetEnabled ? s.budgetAccount : '')}
      <p class="hint err" id="we" role="alert"></p>
      <button class="btn" type="submit">${_t('Переобуто')}</button></form>`, sh => {
      const f = $('#wf', sh);
      f.addEventListener('submit', async e => {
        e.preventDefault();
        const v = k => f[k] && f[k].value.trim() ? numV(f[k].value) : '';
        try {
          await api('/api/tires/swap', { to: f.to.value, date: f.date.value.replace('T', ' '), odo: numV(f.odo.value) || svc().odoNow || 0, fl: v('fl'), fr: v('fr'), rl: v('rl'), rr: v('rr'),
            amount: numV(f.amount.value), note: f.note.value, budget_account: f.budget_account ? f.budget_account.value : '' });
          closeSheet(); toast(_t('Переобуто')); load();
        } catch (err) { $('#we', sh).textContent = err.message; }
      });
    });
  }
  function servicePicker() {
    const sv = svc();
    const rs = S.data.reminders.filter(r => r.active).sort((a, b) => LVL_ORDER[(sv.reminders[a.id] || {}).level] - LVL_ORDER[(sv.reminders[b.id] || {}).level]);
    openSheet(`${head(_t('Додати'))}<div class="pick">
      <button data-new="cost"><div class="ico">${I.receipt}</div>${_t('Витрата')}</button>
      <button data-new="measure"><div class="ico">${I.ruler}</div>${_t('Замір протектора')}</button></div>
      <h4>${_t('Виконана робота')}</h4><div class="list">${rs.map(r => `<button class="row" data-done-r="${esc(r.id)}"><div class="ico">${kIco(r.kind)}</div><div class="mid"><b>${esc(_t(r.title))}</b><span>${esc(remLine(r, sv.reminders[r.id]))}</span></div>${lvChip((sv.reminders[r.id] || {}).level)}</button>`).join('')}</div>`, sh => {
      $('[data-new=cost]', sh).addEventListener('click', () => costForm(null));
      $('[data-new=measure]', sh).addEventListener('click', () => measureForm(null));
      $$('[data-done-r]', sh).forEach(b => b.addEventListener('click', () => doneForm(S.data.reminders.find(r => r.id === b.dataset.doneR))));
    });
  }


  /* ---------- вішліст: покупки для авто ---------- */
  function loadWish(force) {
    if (S.wishLoading) return;
    S.wishLoading = true;
    api('/api/wish' + (force ? '?force=1' : '')).then(d => { S.wish = d; }).catch(e => { S.wish = { error: e.message, items: [] }; })
      .finally(() => { S.wishLoading = false; if (S.tab === 'service' && !$('.scrim')) render(); });
  }
  function wishRow() {
    const w = S.wish;
    if (!w) loadWish();
    if (w && w.disabled) return '';
    const n = w ? (w.items || []).length : 0;
    const sub = !w ? _t('завантажую вішліст…') : w.error ? _t('вішліст зараз недоступний') : n ? `${n} ${plural(n, 'річ', 'речі', 'речей')}${w.total ? ' · ' + money(w.total) : ''}` : _t('поки порожньо');
    return `<button class="row" data-act="wish"><div class="ico">${I.cart}</div><div class="mid"><b>${_t('Покупки для авто')}</b><span>${sub}</span></div><span class="chev">${I.chev}</span></button>`;
  }
  function wishSheet() {
    openSheet(`${head(_t('Покупки для авто'))}${wishBlock()}`);
  }
  function wishBlock() {
    const w = S.wish;
    if (!w) { loadWish(); return `<p class="muted">${_t('Завантажую вішліст…')}</p>`; }
    const tag = esc(w.tag || S.data.settings.wishTag || _t('авто'));
    const img = it => it.image ? `<img src="${'/api/wish/img/' + encodeURIComponent(it.image)}" alt="" loading="lazy">` : I.cart;
    const rows = (w.items || []).map(it => `<a class="row" href="${esc(it.url || w.listUrl)}" target="_blank" rel="noopener"><div class="ico thumb">${/^https?:/.test(it.image || '') ? I.cart : img(it)}</div>
      <div class="mid"><b>${it.mostWanted ? '★ ' : ''}${esc(it.name)}</b><span>${esc(it.note && !it.note.startsWith(it.name.slice(0, 25)) ? it.note : (it.url ? it.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : ''))}</span></div>
      <div class="end">${it.price ? `<b class="num">${money(it.price)}</b>` : ''}${it.qty > 1 ? `<span class="chip">×${it.qty}</span>` : ''}</div></a>`).join('');
    return `${w.total ? `<p class="muted num" style="margin:-4px 4px 12px">${_t('Разом {total}', { total: money(w.total) })}</p>` : ''}
      ${w.error ? `<p class="hint err">${_t('Вішліст зараз недоступний. Спробуйте пізніше.')}</p>` : ''}
      <div class="list">${rows || `<div class="row" style="cursor:default"><div class="ico">${I.cart}</div><div class="mid"><b>${_t('Поки порожньо')}</b><span style="white-space:normal">${_t('Додайте у вішліст річ із #{tag} у примітці', { tag })}</span></div></div>`}
      <a class="row" href="${esc(w.listUrl || '#')}" target="_blank" rel="noopener"><div class="ico">${I.gift}</div><div class="mid"><b style="color:var(--accent)">${_t('Відкрити у вішлісті')}</b><span style="white-space:normal">${w.bot ? _t('Нова річ: посилання боту @{bot} з #{tag} у тексті або #{tag2} у примітці', { bot: w.bot, tag, tag2: tag }) : _t('Нова річ: додайте у вішліст із #{tag} у примітці', { tag })}</span></div></a></div>`;
  }

  /* ---------- ще: налаштування ---------- */
  function viewMore() {
    const s = S.data.settings, b = S.data.budget || {};
    const budgetLine = !S.data.budgetLinked ? _t('Зв\'язок не налаштовано на сервері')
      : !s.budgetEnabled ? _t('Вимкнено')
      : b.pending ? (b.error ? _t('Помилка: {error}', { error: b.error }) : _t('У черзі: {pending}', { pending: b.pending })) : _t('Усе передано');
    return `
      <h4>${_t('Авто')}</h4><div class="list">
        <button class="row" data-act="car"><div class="ico">${I.car}</div><div class="mid"><b>${esc(s.carName || _t('Назва, номер, бак'))}</b><span>${esc([s.carMake, s.carModel, s.carYear, s.carPlate].filter(Boolean).join(' · ') || _t('не заповнено'))}${s.tank ? _t(' · бак ') + fmt(s.tank, 0) + _t(' л') : ''}</span></div></button>
        <button class="row" data-act="wallet"><div class="ico">${I.wallet}</div><div class="mid"><b>${_t('Гаманець WOG')}</b><span>${(S.data.topups || []).length ? _t('у гаманці {litres} л', { litres: fmt((S.data.wallet || {}).litres) }) : _t('поповнення наперед і заправки з гаманця')}</span></div></button>
        <button class="row" data-act="bonuses"><div class="ico">${I.gift}</div><div class="mid"><b>${_t('Бонуси й знижки')}</b><span>${(() => { const a = (S.data.settings.wogBonuses || []).filter(b => b.active !== false && (!b.to || b.to >= today())); return a.length ? esc([...new Set(a.map(b => netName(b.net || 'WOG')))].join(', ') + ' · ' + a.length + _t(' діючих')) : _t('бонусні програми мереж і купони'); })()}</span></div></button>
        <button class="row" data-act="cats"><div class="ico">${I.tag}</div><div class="mid"><b>${_t('Категорії витрат')}</b><span>${_t('{length} категорій', { length: S.data.cats.filter(c => !c.archived).length })}</span></div></button>
      </div>
      <h4>${_t('Сімейний бюджет')}</h4><div class="list">
        <button class="row" data-act="budget"><div class="ico">${I.cash}</div><div class="mid"><b>${_t('Запис витрат у Бюджет')}</b><span>${esc(budgetLine)}</span></div></button>
      </div>
      <h4>${_t('Дані')}</h4><div class="list">
        <button class="row" data-act="import"><div class="ico">${I.upload}</div><div class="mid"><b>${_t('Імпорт з Fuelio')}</b><span>${_t('CSV-копія: заправки й витрати, без дублікатів')}</span></div></button>
        <button class="row" data-act="bm300"><div class="ico">${I.battery}</div><div class="mid"><b>${_t('Імпорт з BM300')}</b><span>${_t('звіти монітора акумулятора (.xls), без дублікатів')}</span></div></button>
        <a class="row" href="/api/export.csv" download><div class="ico">${I.download}</div><div class="mid"><b>${_t('Експорт CSV')}</b><span>${_t('для таблиць')}</span></div></a>
        <a class="row" href="/api/export.json" download><div class="ico">${I.db}</div><div class="mid"><b>${_t('Копія JSON')}</b><span>${_t('усі дані й налаштування')}</span></div></a>
      </div>
      <h4>${_t('Автоматично з WOG')}</h4><div class="list"><div class="row" style="cursor:default"><div class="ico">${I.bell}</div><div class="mid"><b>${_t('Push від WOG → чернетка')}</b><span style="white-space:normal">${_t('Home Assistant передає сповіщення WOG сюди, а вам приходить запит пробігу. Чернетки видно вгорі журналу.')}</span></div></div></div>
      <h4>Мова / Language</h4><div class="card"><div class="f"><label for="s-lang">${_t('Мова інтерфейсу')}</label><select id="s-lang" data-lang><option value="uk" ${I18N.getLang() === 'uk' ? 'selected' : ''}>Українська</option><option value="en" ${I18N.getLang() === 'en' ? 'selected' : ''}>English</option></select></div></div>
      <h4>${_t('Обліковий запис')}</h4><div class="list">
        <button class="row" data-act="logout"><div class="ico">${I.logout}</div><div class="mid"><b>${_t('Вийти')}</b><span>${esc((S.data.user || {}).name || '')}</span></div></button>
      </div>
      <p class="muted" style="text-align:center;font-size:12px;margin-top:18px">${_t('Бак {version}', { version: esc(S.data.version || '') })}</p>`;
  }

  /* ---------- акумулятор (BM300) ---------- */
  // дані — з ручних місячних експортів, тому скрізь пишемо «дані на <дата>»
  const durMin = m => (m >= 60 ? _t('{m} год{m2}', { m: Math.floor(m / 60), m2: m % 60 ? ' ' + (m % 60) + _t(' хв') : '' }) : _t('{m} хв', { m }));
  const monLabel = m => `${MON_SHORT[+m.slice(5) - 1]} ${m.slice(2, 4)}`;
  const batChip = h => h ? (h.level === 'ok' ? `<span class="chip ok">${_t('норма')}</span>` : h.level === 'warn' ? `<span class="chip soon">${_t('заряд неповний')}</span>` : `<span class="chip due">${_t('розряджається')}</span>`) : '';
  const batClr = l => (l === 'ok' ? 'var(--accent)' : l === 'warn' ? 'var(--warn)' : 'var(--danger)');
  function loadBattery() {
    if (S.batLoading) return;
    S.batLoading = true;
    api('/api/battery').then(d => {
      const j = JSON.stringify(d);
      if (j === S.batJson) return;
      S.bat = d; S.batJson = j;
      if ((S.tab === 'service' || S.tab === 'stats') && !$('.scrim')) render();
    }).catch(() => {}).finally(() => { S.batLoading = false; });
  }
  function batRow() {
    const b = S.bat;
    if (!b) return '';
    if (!b.has) return `<button class="row" data-act="bm300"><div class="ico">${I.battery}</div><div class="mid"><b>${_t('Акумулятор')}</b><span>${_t('завантаж звіт BM300')}</span></div><span class="chev">${I.chev}</span></button>`;
    const l = b.latest;
    return `<button class="row" data-act="bat"><div class="ico">${I.battery}</div><div class="mid"><b class="num">${l ? _t('{v} В{soc}', { v: fmt(l.v, 1), soc: l.soc !== null && l.soc !== undefined ? ' · ' + l.soc + ' %' : '' }) : _t('Акумулятор')}</b>
      <span>${l ? _t('Акумулятор · дані на ') + dayLabel(l.t) : _t('Акумулятор · є лише поїздки')}</span></div><div class="end">${batChip(b.rest && b.rest.health)}</div><span class="chev">${I.chev}</span></button>`;
  }
  // стовпці «напруга спокою по місяцях»
  function restBars(months) {
    const W = 320, H = 150, L = 6, R = 6, T = 18, Bm = 22;
    const lo = 11.5, hi = Math.max(13, Math.max.apply(null, months.map(m => m.v)) + 0.1);
    const Y = v => T + (1 - (Math.max(v, lo) - lo) / (hi - lo)) * (H - T - Bm);
    const slot = (W - L - R) / months.length, bw = Math.min(30, slot * 0.6);
    const lvl = v => (v >= 12.5 ? 'ok' : v >= 12.2 ? 'warn' : 'bad');
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${_t('Напруга спокою по місяцях')}">`;
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(12.5)}" y2="${Y(12.5)}" stroke-dasharray="4 4"/>`;
    months.forEach((m, i) => {
      const cx = L + slot * (i + 0.5), y = Y(m.v);
      svg += `<path d="${roundTop(cx - bw / 2, y, bw, Y(lo) - y, 4)}" fill="${batClr(lvl(m.v))}"/><text class="ax" x="${cx}" y="${y - 4}" text-anchor="middle">${fmt(m.v, 2)}</text><text class="ax" x="${cx}" y="${H - 6}" text-anchor="middle">${MON_SHORT[+m.month.slice(5) - 1]}</text>`;
    });
    return svg + '</svg>';
  }
  // мінімум напруги по днях за 90 днів
  function dailyLine(days) {
    if (days.length < 2) return '';
    const W = 320, H = 110, L = 34, R = 6, T = 10, Bm = 20;
    const t = d => Date.parse(d);
    const x0 = t(days[0].d), x1 = t(days[days.length - 1].d);
    const ticks = axisTicks(Math.min(11.8, Math.min.apply(null, days.map(d => d.minV))), Math.max.apply(null, days.map(d => d.maxV)), 3);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const X = d => L + (x1 === x0 ? 0.5 : (t(d) - x0) / (x1 - x0)) * (W - L - R);
    const Y = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - Bm);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${_t('Мінімум і максимум напруги по днях')}">`;
    ticks.forEach(v => { svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 4}" y="${Y(v) + 4}" text-anchor="end">${fmt(v, 1)}</text>`; });
    svg += `<text class="ax" x="${L}" y="${H - 5}">${dayLabel(days[0].d)}</text><text class="ax" x="${W - R}" y="${H - 5}" text-anchor="end">${dayLabel(days[days.length - 1].d)}</text>`;
    const path = k => days.map((d, i) => (i ? 'L' : 'M') + X(d.d).toFixed(1) + ' ' + Y(d[k]).toFixed(1)).join('');
    svg += `<path d="${path('maxV')}" fill="none" stroke="var(--s2)" stroke-width="1.5" stroke-linejoin="round"/><path d="${path('minV')}" fill="none" stroke="var(--s1)" stroke-width="1.5" stroke-linejoin="round"/>`;
    return svg + '</svg>';
  }
  const infoRow = (b, sub, end) => `<div class="row" style="cursor:default"><div class="mid"><b class="num">${b}</b>${sub ? `<span class="wrap num">${sub}</span>` : ''}</div>${end ? `<div class="end">${end}</div>` : ''}</div>`;
  // розділи аналітики для одного акумулятора (поточного — d = відповідь API, попереднього — d = b.previous)
  function batSections(d, old) {
    const r = d.rest || {}, ch = d.charging || {}, cr = d.cranking || {};
    let h = '';
    if (r.current !== null && r.current !== undefined) {
      h += `<h4>${_t('Напруга на стоянці')}</h4><div class="list">${infoRow(fmt(r.current, 2) + _t(' В'), _t('медіана нічних замірів (02–05 год, двигун вимкнений) за останні {nights} {nights2}: {text}', { nights: Math.min(14, r.nights), nights2: plural(Math.min(14, r.nights), 'ніч', 'ночі', 'ночей'), text: esc(r.health.text) }), batChip(r.health))}</div>`;
      if (r.months.length) h += `<div class="chart" style="margin-top:10px"><p class="sub">${_t('Середня нічна напруга по місяцях, В · пунктир — норма 12,5 В')}</p>${restBars(r.months)}${tableHtml([_t('Місяць'), _t('В'), _t('Ночей')], r.months.map(m => [m.month, fmt(m.v, 2), m.nights]))}</div>`;
    }
    if (!old && d.daily && d.daily.length > 1) h += `<div class="chart"><h3>${_t('Останні 90 днів')}</h3><p class="sub"><span style="color:var(--s1)">${_t('мінімум')}</span> ${_t('і')} <span style="color:var(--s2)">${_t('максимум')}</span> ${_t('напруги за день, В')}</p>${dailyLine(d.daily)}${tableHtml([_t('День'), _t('Мін'), _t('Макс'), _t('Заряд мін, %')], d.daily.map(x => [x.d, fmt(x.minV, 2), fmt(x.maxV, 2), x.minSoc ?? '—']))}</div>`;
    const dd = d.discharges || [];
    const ddRow = e => infoRow(`${dayLabel(e.from)} ${e.from.slice(11)} — ${e.to.slice(0, 10) === e.from.slice(0, 10) ? '' : dayLabel(e.to) + ' '}${e.to.slice(11)}`, _t('{minutes} · мінімум {minV} В · {minSoc} %', { minutes: durMin(e.minutes), minV: fmt(e.minV, 2), minSoc: e.minSoc }));
    h += `<h4>${_t('Глибокі розряди')}</h4>`;
    h += dd.length ? `<p class="hint" style="margin-top:-2px">${_t('Нижче 11,8 В щонайменше 30 хв поспіль без двигуна — це скорочує життя акумулятора.')}</p><div class="list">${dd.slice(0, 5).map(ddRow).join('')}</div>
      ${dd.length > 5 ? `<details class="off"><summary>${_t('Ще {length}', { length: dd.length - 5 })}</summary><div class="list">${dd.slice(5).map(ddRow).join('')}</div></details>` : ''}`
      : `<p class="hint" style="margin-top:-2px">${_t('Не було — у завантажених даних напруга не падала нижче 11,8 В на стоянці.')}</p>`;
    if (d.lowest && d.lowest.v < 11.8) h += `<p class="hint num" style="margin-top:8px">${_t('Найнижчий замір: {v} В · {t} {t2}{soc}.', { v: fmt(d.lowest.v, 2), t: dayLabel(d.lowest.t), t2: d.lowest.t.slice(11), soc: d.lowest.soc !== null && d.lowest.soc !== undefined ? ' · ' + d.lowest.soc + ' %' : '' })}</p>`;
    if (ch.median !== null && ch.median !== undefined) {
      h += `<h4>${_t('Зарядка під час руху')}</h4><div class="list">${infoRow(fmt(ch.recent, 2) + _t(' В'), `${_t('медіана напруги в поїздках')}${ch.recent !== ch.median ? ` ${_t('за останні 90 днів (за весь час {median} В)', { median: fmt(ch.median, 2) })}` : ''} ${_t('· норма 13,6–15,0 В')}`,
        `<span class="chip ${ch.verdict.level === 'ok' ? 'ok' : 'due'}">${ch.verdict.level === 'ok' ? _t('норма') : _t('генератор')}</span>`)}
        ${ch.verdict.level === 'ok' ? '' : infoRow(ch.verdict.text.charAt(0).toUpperCase() + ch.verdict.text.slice(1))}</div>`;
    }
    h += `<h4>${_t('Пуски двигуна')}</h4>`;
    if (cr.total) {
      h += `<div class="list">${cr.last.map(c => infoRow(_t('{v} В · {ms} мс', { v: fmt(c.v, 2), ms: c.ms }), `${dayLabel(c.t)} ${c.t.slice(11)} · ${esc(c.status)}`, c.weak ? `<span class="chip due">${_t('слабкий')}</span>` : '')).join('')}</div>
        <p class="hint" style="margin-top:8px">${cr.months.map(m => _t('{month}: {v} В', { month: monLabel(m.month), v: fmt(m.v, 2) })).join(' · ')}${_t('. Нижче 9,6 В — слабкий стартер або акумулятор')}${cr.weak ? _t('; таких пусків: {weak}', { weak: cr.weak }) : ''}.</p>`;
    } else h += `<p class="hint" style="margin-top:-2px">${_t('У звітах поки немає тестів пуску.')}</p>`;
    return h;
  }
  function batSheet() {
    const b = S.bat;
    if (!b || !b.has) return bm300Form();
    const l = b.latest, tr = b.trips || {}, ins = b.install, st = S.data.settings;
    let h = head(_t('Акумулятор'));
    h += `<div class="list"><button class="row" data-bat-edit><div class="ico">${I.battery}</div><div class="mid"><b>${esc(b.model || _t('Модель не вказана'))}</b>
      <span>${b.installed ? _t('встановлено {installed} {installed2} {installed3} · {months} міс.', { installed: +b.installed.slice(8, 10), installed2: MON_SHORT[+b.installed.slice(5, 7) - 1], installed3: b.installed.slice(0, 4), months: ins.months }) : _t('вкажіть дату встановлення — аналіз піде лише за поточним акумулятором')}</span>
      ${ins && ins.cost ? `<span class="num">${_t('куплено за {amount}', { amount: money(ins.cost.amount) })}</span>` : ''}</div><span class="chev">${I.chev}</span></button></div>`;
    if (l) {
      h += `<section class="hero" style="margin-top:12px"><div><div class="v num">${fmt(l.v, 2)}<small>${_t('В')}</small></div><div class="l">${_t('останній замір')}</div></div>
        <div><div class="v num">${l.soc !== null && l.soc !== undefined ? l.soc : '—'}<small>%</small></div><div class="l">${_t('заряд')}</div></div>
        <div><div class="v num">${l.temp !== null && l.temp !== undefined ? l.temp : '—'}<small>°C</small></div><div class="l">${_t('температура')}</div></div></section>
        <p class="hint">${_t('Дані на {t}, {t2} — звіти завантажуються вручну', { t: dayLabel(l.t), t2: l.t.slice(11) })}${b.ageDays > 7 ? _t('; це було {ageDays} {ageDays2} тому, завантажте свіжий', { ageDays: b.ageDays, ageDays2: plural(b.ageDays, 'день', 'дні', 'днів') }) : ''}${_t('. Покриття: {from} — {to}, {days} {days2}.', { from: dayLabel(b.range.from), to: dayLabel(b.range.to), days: b.range.days, days2: plural(b.range.days, 'день', 'дні', 'днів') })}</p>`;
    }
    h += batSections(b, false);
    if (b.installed && !b.rest.nights && !(b.cranking && b.cranking.total)) h += `<p class="hint">${_t('Після встановлення нового акумулятора звітів ще немає — завантажте свіжий.')}</p>`;
    if (tr.total) {
      const lastM = tr.months.slice(-6).reverse();
      h += `<h4>${_t('Поїздки')}</h4><p class="hint" style="margin-top:-2px">${_t('Коротких (менше 10 хв) — {shortShare}% з {total}: на коротких поїздках двигун не встигає прогрітись, витрата росте, а акумулятор не добирає заряд.', { shortShare: tr.shortShare, total: tr.total })}</p>
        <div class="list">${lastM.map(m => infoRow(`${MONTHS[+m.month.slice(5) - 1]} ${m.month.slice(0, 4)}`, _t('{n} {n2} · двигун {minutes} · коротких {shortShare}%', { n: m.n, n2: plural(m.n, 'поїздка', 'поїздки', 'поїздок'), minutes: durMin(m.minutes), shortShare: m.shortShare }))).join('')}</div>`;
    }
    h += engineBlock(b);
    if (b.previous) h += `<details class="off"><summary>${_t('Попередній акумулятор{batteryPrevModel}', { batteryPrevModel: S.data.settings.batteryPrevModel ? ' · ' + esc(S.data.settings.batteryPrevModel) : '' })}${b.previous.range ? ` · ${dayLabel(b.previous.range.from)} — ${dayLabel(b.previous.range.to)}` : ''}</summary>${batSections(b.previous, true)}</details>`;
    h += `<button class="btn" data-act="bm300" style="margin-top:14px">${_t('Імпорт з BM300')}</button>`;
    openSheet(h, sh => { $('[data-bat-edit]', sh).addEventListener('click', batForm); });
  }
  function batForm() {
    const s = S.data.settings;
    openSheet(`${head(_t('Акумулятор'))}<form id="btf"><div class="card">
      <div class="f"><label for="bt-m">${_t('Модель')}</label><input id="bt-m" name="batteryModel" maxlength="120" value="${esc(s.batteryModel || '')}" placeholder="Exide Premium EA770 77 Ah"></div>
      <div class="f"><label for="bt-p">${_t('Попередній')}</label><input id="bt-p" name="batteryPrevModel" maxlength="120" value="${esc(s.batteryPrevModel || '')}" placeholder="${_t('модель старого акумулятора')}"></div>
      <div class="f"><label for="bt-d">${_t('Встановлено')}</label><input id="bt-d" name="batteryInstalled" type="datetime-local" value="${esc(s.batteryInstalled ? (s.batteryInstalled.length > 10 ? s.batteryInstalled.replace(' ', 'T') : s.batteryInstalled + 'T12:00') : '')}"></div></div>
      <p class="hint">${_t('Час потрібен, якщо міняли посеред дня, щоб розряд старого акумулятора не потрапив до нового. Висновки про стан (напруга спокою, розряди, пуски) рахуються лише за даними від дати встановлення; старіші показані окремо як «попередній акумулятор».')}</p>
      <button class="btn" type="submit">${_t('Зберегти')}</button></form>`, sh => {
      $('#btf', sh).addEventListener('submit', async e => {
        e.preventDefault(); const f = e.target;
        try {
          await api('/api/settings', { batteryModel: f.batteryModel.value, batteryPrevModel: f.batteryPrevModel.value, batteryInstalled: f.batteryInstalled.value });
          closeSheet(); toast(_t('Збережено')); S.batJson = null; await load();
        } catch (err) { $('.btn', f).insertAdjacentHTML('afterend', `<p class="hint err">${esc(err.message)}</p>`); }
      });
    });
  }
  function tripsBlock() {
    const b = S.bat, tr = b && b.has && b.trips;
    if (!tr || !tr.total) return '';
    const tile = (l, v, u, s) => `<div class="tile"><div class="l">${l}</div><div class="v num">${v}${u ? `<small>${u}</small>` : ''}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
    const last = tr.months[tr.months.length - 1];
    return `<h4>${_t('Поїздки (BM300)')}</h4>
      <div class="tiles">
        ${tile(_t('Поїздок'), fmt(tr.total, 0), '', _t('усі завантажені звіти'))}
        ${tile(_t('Коротких (&lt; 10 хв)'), tr.shortShare, '%', _t('двигун не встигає прогрітись'))}
      </div>
      <div class="list">${tr.months.slice(-6).reverse().map(m => `<div class="row" style="cursor:default"><div class="mid"><b>${MONTHS[+m.month.slice(5) - 1]} ${m.month.slice(0, 4)}</b><span class="num">${_t('{n} {n2} · двигун {minutes} · коротких {shortShare}%', { n: m.n, n2: plural(m.n, 'поїздка', 'поїздки', 'поїздок'), minutes: durMin(m.minutes), shortShare: m.shortShare })}</span></div></div>`).join('')}</div>${engineBlock(b)}`;
  }
  // Мотогодини: виміряні (BM300), середня швидкість (заправки), оцінка за весь час
  function engineBlock(b) {
    const e = b && b.engine;
    if (!e || !e.has) return '';
    const tile = (l, v, u, s) => `<div class="tile"><div class="l">${l}</div><div class="v num">${v}${u ? `<small>${u}</small>` : ''}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
    const hrs = m => fmt(Math.round(m / 60), 0);
    const su = e.sinceLatestUpload;
    return `<h4>${_t('Мотогодини')}</h4>
      <div class="tiles">
        ${tile(_t('Виміряно'), hrs(e.measuredMin), _t('год'), _t('за {days} {days2} даних', { days: e.range.days, days2: plural(e.range.days, 'день', 'дні', 'днів') }))}
        ${tile(_t('Середня швидкість'), e.avgSpeed ? fmt(e.avgSpeed, 1) : '—', _t('км/год'), e.avgSpeed ? _t('за {length} {length2} між заправками', { length: e.pairs.length, length2: plural(e.pairs.length, 'відрізок', 'відрізки', 'відрізків') }) : _t('замало даних: потрібно 2 год і дві заправки'))}
        ${e.lifetime ? tile(_t('За весь час'), '≈ ' + fmt(e.lifetime.hours, 0), _t('год'), _t('оцінка: {odo} км ÷ {avgSpeed} км/год', { odo: fmt(e.lifetime.odo, 0), avgSpeed: fmt(e.avgSpeed, 1) })) : ''}
        ${su ? tile(_t('Після останнього звіту'), su.days, plural(su.days, 'день', 'дні', 'днів'), su.estimatedMin ? _t('невідомо; ≈ {estimatedMin} год за оцінкою', { estimatedMin: hrs(su.estimatedMin) }) : _t('невідомо')) : ''}
      </div>
      <p class="hint" style="margin-top:-6px">${_t('Мотогодини — час, коли двигун був запущений (за поїздками BM300). Швидкість рахується з пробігу між заправками, що повністю в зоні даних; оцінки позначено «≈».')}</p>
      ${e.pairs.length ? `<details class="off"><summary>${_t('Швидкість між заправками ({length})', { length: e.pairs.length })}</summary><div class="list">${e.pairs.slice().reverse().map(p => infoRow(`${dayLabel(p.from)} — ${dayLabel(p.to)}`, _t('{km} км · двигун {minutes} · {speed} км/год', { km: fmt(p.km, 0), minutes: durMin(p.minutes), speed: fmt(p.speed, 1) }))).join('')}</div></details>` : ''}`;
  }
  function bm300Form() {
    openSheet(`${head(_t('Імпорт з BM300'))}
      <p class="muted" style="margin-top:0">${_t('У застосунку BM300 Pro експортуйте місячний звіт (')}<b>Data Report</b>${_t(', файл')} <code>.xls</code>${_t(') і виберіть один або кілька файлів. Повторний імпорт того самого місяця дублікатів не створює.')}</p>
      <label class="drop" for="bf">${_t('Вибрати файли .xls')}<input id="bf" type="file" accept=".xls,application/vnd.ms-excel" multiple hidden></label>
      <div id="ip"></div>`, sh => {
      $('#bf', sh).addEventListener('change', async e => {
        const files = Array.from(e.target.files || []); if (!files.length) return;
        const out = $('#ip', sh);
        out.innerHTML = `<p class="muted">${_t('Перевіряю…')}</p>`;
        const good = []; let html = '';
        for (const file of files) {
          try {
            const buf = await file.arrayBuffer();
            const d = await api('/api/import/bm300?dry=1', buf, { raw: true, type: 'application/octet-stream' });
            good.push({ file, buf });
            html += `<div class="card" style="padding:12px 14px"><b>${esc(file.name)}</b><br><span class="muted num">${d.from ? `${dayLabel(d.from)} — ${dayLabel(d.to)} · ` : ''}${_t('нових вимірів {new} з {total}, поїздок {new2} з {total2}, пусків {new3} з {total3}', { new: fmt(d.samples.new, 0), total: fmt(d.samples.total, 0), new2: d.trips.new, total2: d.trips.total, new3: d.cranks.new, total3: d.cranks.total })}</span></div>`;
          } catch (err) { html += `<div class="card" style="padding:12px 14px"><b>${esc(file.name)}</b><p class="hint err" style="margin:4px 0 0">${esc(err.message)}</p></div>`; }
        }
        out.innerHTML = html + (good.length ? `<button class="btn" data-go>${_t('Імпортувати')}${good.length > 1 ? ` (${good.length})` : ''}</button>` : '');
        const go = $('[data-go]', out); if (!go) return;
        go.addEventListener('click', async ev => {
          ev.target.disabled = true;
          const sum = { samples: 0, trips: 0, cranks: 0 };
          try {
            for (const g of good) {
              const r = await api('/api/import/bm300', g.buf, { raw: true, type: 'application/octet-stream' });
              sum.samples += r.samples.new; sum.trips += r.trips.new; sum.cranks += r.cranks.new;
            }
            closeSheet(); toast(_t('Імпортовано: {samples} вимірів, {trips} поїздок, {cranks} пусків', { samples: fmt(sum.samples, 0), trips: sum.trips, cranks: sum.cranks }));
            S.batJson = null; loadBattery();
          } catch (err) { ev.target.disabled = false; out.insertAdjacentHTML('beforeend', `<p class="hint err">${esc(err.message)}</p>`); }
        });
      });
    });
  }

  /* ---------- аркуші ---------- */
  let sheetOpen = false, opener = null;
  function openSheet(html, mount) {
    if (!$('.scrim')) opener = document.activeElement;
    closeSheet(true);
    const d = document.createElement('div');
    d.className = 'scrim'; d.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-t" tabindex="-1"><div class="grab"></div>${html}</div>`;
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) closeSheet(); });
    document.body.appendChild(d);
    document.body.style.overflow = 'hidden';
    if (!sheetOpen) { history.pushState({ sheet: 1 }, ''); sheetOpen = true; }
    if (mount) mount($('.sheet', d));
    const first = $('input:not([type=checkbox]),select', d);
    if (first && !('ontouchstart' in window)) first.focus(); else $('.sheet', d).focus({ preventScroll: true });
  }
  function closeSheet(keepHistory) {
    const d = $('.scrim'); if (d) d.remove();
    document.body.style.overflow = '';
    if (!keepHistory && sheetOpen) { sheetOpen = false; history.back(); }
    if (!keepHistory && opener && opener.isConnected) { opener.focus({ preventScroll: true }); opener = null; }
  }
  // Esc закриває; Tab не виходить за межі шторки
  document.addEventListener('keydown', e => {
    const sh = $('.scrim .sheet'); if (!sh) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
    if (e.key !== 'Tab') return;
    const f = $$('button:not([disabled]),a[href],input:not([type=hidden]):not([disabled]),select,textarea,summary', sh).filter(x => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && (document.activeElement === f[0] || document.activeElement === sh)) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  window.addEventListener('popstate', () => { if (sheetOpen) { sheetOpen = false; closeSheet(true); } });
  const head = t => `<h2 id="sh-t">${t}<button class="x" data-close aria-label="${_t('Закрити')}">${I.close}</button></h2>`;

  function accountSelect(cur) {
    const s = S.data.settings;
    if (!s.budgetEnabled || !S.data.budgetLinked) return '';
    const accs = ((S.refs || {}).accounts || []).filter(a => a.currency === 'UAH');
    return `<div class="card"><div class="f"><label for="ba">${_t('До Бюджету')}</label><select id="ba" name="budget_account">
      <option value="">${_t('не записувати')}</option>${accs.map(a => `<option value="${esc(a.id)}" ${a.id === cur ? 'selected' : ''}>${esc(a.name)}${a.owner ? ' · ' + esc(a.owner) : ''}</option>`).join('')}
      ${cur && !accs.find(a => a.id === cur) ? `<option value="${esc(cur)}" selected>${_t('поточний рахунок')}</option>` : ''}</select></div></div>`;
  }

  function fillForm(f) {
    const s = S.data.settings;
    const isNew = !f;
    const last = C.ordered(S.data.fills).pop();
    const pr = S.data.prices;
    const station = last ? last.station : '';
    // ціна: сьогоднішня WOG для свого пального, якщо заправляємось на WOG; інакше — з минулої заправки
    const wogNow = pr && pr.wog && (!pr.fuel || pr.fuel === s.fuel) && (!station || /wog/i.test(station)) ? pr.wog : 0;
    f = f || { date: nowStamp(), odo: '', litres: '', price: wogNow || (last ? last.price : ''), total: '', full: 1, missed: 0, fuel: s.fuel, station, note: '', pay: 'money', bonus: 0, budget_account: s.budgetEnabled ? s.budgetAccount : '' };
    const hasWallet = (S.data.topups || []).length > 0 || f.pay === 'wallet';
    const fuels = FUELS.includes(f.fuel) || !f.fuel ? FUELS : [f.fuel].concat(FUELS);
    openSheet(`${head(isNew ? _t('Нова заправка') : f.status === 'draft' ? _t('Допишіть пробіг') : _t('Заправка'))}
      <form id="ff" novalidate>
      <div class="card">
        <div class="f"><label for="fd">${_t('Дата')}</label><input id="fd" name="date" type="datetime-local" value="${esc(f.date.replace(' ', 'T'))}" required></div>
        <div class="f"><label for="fo">${_t('Пробіг')}</label><input id="fo" name="odo" inputmode="numeric" placeholder="${last ? _t('більше ') + fmt(last.odo, 0) : _t('з одометра')}" value="${f.odo || ''}" autocomplete="off"><span class="u">${_t('км')}</span></div>
      </div><p class="hint" id="oh"></p>
      ${hasWallet ? `<div class="seg" role="radiogroup" aria-label="${_t('Оплата')}" style="margin:0 0 12px"><button type="button" data-pay="money" class="${f.pay !== 'wallet' ? 'on' : ''}">${_t('Гроші')}</button><button type="button" data-pay="wallet" class="${f.pay === 'wallet' ? 'on' : ''}">${_t('Гаманець WOG')}</button></div>` : ''}
      <div class="card">
        <div class="f"><label for="fl">${_t('Літри')}</label><input id="fl" name="litres" inputmode="decimal" value="${dec(f.litres)}" autocomplete="off"><span class="u">${_t('л')}</span></div>
        <div class="f" data-money><label for="fp">${_t('Ціна')}</label><input id="fp" name="price" inputmode="decimal" value="${dec(f.price)}" autocomplete="off"><span class="u">${_t('₴/л')}</span></div>
        <div class="f" data-money><label for="ft">${_t('Сума')}</label><input id="ft" name="total" inputmode="decimal" value="${dec(f.total)}" autocomplete="off"><span class="u">₴</span></div>
        <div class="f" data-money><label for="fb">${_t('Бонусами')}</label><input id="fb" name="bonus" inputmode="decimal" value="${dec(f.bonus)}" placeholder="0" autocomplete="off"><span class="u">₴</span></div>
      </div><p class="hint" id="ph"></p>
      <div class="card">
        <label class="sw"><span>${_t('Повний бак')}<small>${_t('для розрахунку витрати')}</small></span><input type="checkbox" name="full" ${f.full ? 'checked' : ''}></label>
        <label class="sw"><span>${_t('Пропущена заправка')}<small>${_t('перед цією була незаписана')}</small></span><input type="checkbox" name="missed" ${f.missed ? 'checked' : ''}></label>
      </div>
      <div class="card">
        <div class="f"><label for="fu">${_t('Пальне')}</label><select id="fu" name="fuel">${fuels.map(x => `<option value="${esc(x)}" ${x === f.fuel ? 'selected' : ''}>${esc(fuelName(x))}</option>`).join('')}</select></div>
        <div class="f"><label for="fs">${_t('АЗС')}</label><input id="fs" name="station" value="${esc(f.station)}" placeholder="${_t('WOG, ОККО…')}"></div>
        ${noteField('fn', f.note)}
      </div>
      ${accountSelect(f.budget_account)}
      <p class="hint err" id="fe" role="alert"></p>
      <button class="btn" type="submit">${_t('Зберегти')}</button>
      ${isNew ? '' : `<button class="btn del" type="button" data-del>${_t('Видалити')}</button>`}
      </form>`, sh => {
      const form = $('#ff', sh); growAll(sh);
      const order = [];
      const num = n => parseFloat(String(form[n].value).replace(/\s/g, '').replace(',', '.')) || 0;
      const recalc = changed => {
        const i = order.indexOf(changed); if (i >= 0) order.splice(i, 1); order.push(changed);
        const known = ['litres', 'price', 'total'].filter(k => num(k) > 0);
        if (known.length < 2) return;
        const keep = order.slice(-2);
        const target = ['litres', 'price', 'total'].find(k => !keep.includes(k)) || 'total';
        const L = num('litres'), P = num('price'), T = num('total');
        if (target === 'total' && L && P) form.total.value = (Math.round(L * P * 100) / 100).toString().replace('.', ',');
        if (target === 'price' && L && T) form.price.value = (Math.round(T / L * 100) / 100).toString().replace('.', ',');
        if (target === 'litres' && P && T) form.litres.value = (Math.round(T / P * 100) / 100).toString().replace('.', ',');
      };
      ['litres', 'price', 'total'].forEach(k => form[k].addEventListener('input', () => recalc(k)));
      let pay = f.pay === 'wallet' ? 'wallet' : 'money';
      const payUi = () => {
        $$('[data-money]', sh).forEach(x => { x.style.display = pay === 'wallet' ? 'none' : ''; });
        $('#ph', sh).textContent = pay === 'wallet'
          ? _t('Оплачено раніше поповненням. Вартість порахується за цінами поповнень (зараз у гаманці {litres} л).', { litres: fmt((S.data.wallet || {}).litres) })
          : _t('Сума — скільки сплачено грошима. Достатньо двох значень із трьох, третє порахується саме.');
        const ba = $('#ba', sh); if (ba) ba.closest('.card').style.display = pay === 'wallet' ? 'none' : '';
        $$('[data-pay]', sh).forEach(b => b.classList.toggle('on', b.dataset.pay === pay));
      };
      $$('[data-pay]', sh).forEach(b => b.addEventListener('click', () => { pay = b.dataset.pay; payUi(); }));
      payUi();
      if (f.price) order.push('price');
      const odoHint = () => {
        const odo = num('odo'); const h = $('#oh', sh);
        const cand = { id: f.id, date: form.date.value.replace('T', ' '), odo };
        const p = C.ordered(S.data.fills).filter(x => x.id !== f.id && x.date < cand.date).pop();
        const prob = C.odoProblem(S.data.fills, cand);
        h.className = 'hint' + (prob ? ' err' : '');
        h.textContent = prob || (p ? `${_t('Попередня: {odo} км', { odo: fmt(p.odo, 0) })}${odo > p.odo ? ` ${_t('· проїхали {odo} км', { odo: fmt(odo - p.odo, 0) })}` : ''}` : '');
      };
      form.odo.addEventListener('input', odoHint); form.date.addEventListener('change', odoHint); odoHint();
      if (f.status === 'draft') setTimeout(() => form.odo.focus(), 50);
      const del = $('[data-del]', sh);
      if (del) del.addEventListener('click', async () => {
        if (!confirm(_t('Видалити заправку?'))) return;
        try { await api('/api/fill/delete', { id: f.id }); qDrop(f.id); closeSheet(); toast(_t('Видалено')); load(); } catch (e) { if (e.network) return toast(_t('Офлайн: видалення недоступне')); $('#fe', sh).textContent = e.message; }
      });
      const submit = async force => {
        const body = {
          id: f.id, date: form.date.value.replace('T', ' '), odo: num('odo'), litres: num('litres'), price: num('price'), total: num('total'),
          full: form.full.checked, missed: form.missed.checked, fuel: form.fuel.value, station: form.station.value, note: form.note.value,
          pay, bonus: pay === 'wallet' ? 0 : num('bonus'),
          budget_account: form.budget_account ? form.budget_account.value : f.budget_account, force
        };
        if (!body.id) body.id = f.id = newId('f');
        const btn = $('button[type=submit]', sh); btn.disabled = true;
        try {
          const res = await api('/api/fill', body);
          qDrop(body.id);
          closeSheet();
          if (!body.odo) { toast(_t('Збережено як чернетку — пробіг можна дописати пізніше')); load(); return; }
          await load();
          const sg = segs()[res.fill && res.fill.id];
          toast(sg ? _t('Заправку збережено · {cons} л/100 на {dist} км', { cons: fmt(sg.cons), dist: fmt(sg.dist, 0) }) : body.full ? _t('Заправку збережено') : _t('Заправку збережено · витрата порахується після повного бака'));
        } catch (e) {
          if (e.network) { enqueue('/api/fill', body); closeSheet(); toast(_t('Збережено на телефоні — надішлю, щойно буде зв’язок')); render(); return; }
          btn.disabled = false;
          if (e.status === 409 && confirm(e.message + _t('\n\nЗберегти все одно?'))) return submit(true);
          $('#fe', sh).textContent = e.message;
        }
      };
      form.addEventListener('submit', e => { e.preventDefault(); submit(false); });
    });
  }

  /* ---------- перегляд запису (без редагування; «Змінити» відкриває форму) ---------- */
  const stampLabel = d => dayLabel(d) + (d.length > 10 ? ', ' + d.slice(11, 16) : '');
  const factCard = rows => `<div class="card">${rows.filter(Boolean).map(([l, v]) => `<div class="f"><label>${l}</label><div class="val num">${esc(v)}</div></div>`).join('')}</div>`;
  const noteCard = n => n ? `<h4>${_t('Примітка')}</h4><div class="card note">${esc(n)}</div>` : '';
  function costView(c, back) {
    if (!c) return;
    const k = cats()[c.cat] || { name: _t('Інше') };
    const usd = c.currency === 'USD' && c.amount_cur;
    const closes = (S.data.reminders || []).filter(r => r.last_cost === c.id);
    openSheet(`${head(esc(c.title || k.name))}
      ${factCard([
        [_t('Сума'), usd ? `$${fmt(c.amount_cur)}${c.amount > 0 ? ' · ' + money(c.amount) : ''}` : money(c.amount)],
        usd && c.rate ? [_t('Курс'), `${fmt(c.rate, 2)} ₴/$`] : null,
        [_t('Категорія'), k.name],
        [_t('Дата'), stampLabel(c.date)],
        [_t('Пробіг'), c.odo ? fmt(c.odo, 0) + _t(' км') : _t('не вказано')],
        c.queued ? [_t('Стан'), _t('в черзі, ще не на сервері')] : null])}
      ${noteCard(c.note)}
      ${closes.length ? `<h4>${_t('Закрила нагадування')}</h4><div class="list">${closes.map(r => `<button class="row" data-rem-open="${esc(r.id)}"><div class="ico">${kIco(r.kind)}</div><div class="mid"><b>${esc(_t(r.title))}</b><span class="num">${esc(remLine(r, svc().reminders[r.id] || {}))}</span></div></button>`).join('')}</div>` : ''}
      <button class="btn" type="button" data-edit>${_t('Змінити')}</button>
      ${back ? `<button class="btn sec" type="button" data-back>${_t('Назад')}</button>` : ''}`, sh => {
      $('[data-edit]', sh).addEventListener('click', () => costForm(c));
      const b = $('[data-back]', sh); if (b) b.addEventListener('click', back);
      $$('[data-rem-open]', sh).forEach(x => x.addEventListener('click', () => reminderSheet(S.data.reminders.find(r => r.id === x.dataset.remOpen))));
    });
  }
  function fillView(f) {
    if (!f) return;
    if (f.status === 'draft') return fillForm(f);
    const p = prevFill(f), dist = p && f.odo > 0 ? f.odo - p.odo : 0, sg = segs()[f.id];
    openSheet(`${head(esc([fuelName(f.fuel), f.station].filter(Boolean).join(' · ') || _t('Заправка')))}
      ${factCard([
        [_t('Дата'), stampLabel(f.date)],
        [_t('Пробіг'), f.odo ? fmt(f.odo, 0) + _t(' км') + (dist > 0 ? ` (+${fmt(dist, 0)})` : '') : _t('не вказано')],
        [_t('Літри'), fmt(f.litres) + _t(' л') + (f.full ? _t(', повний бак') : _t(', неповний'))],
        [_t('Ціна'), fmt(f.price) + _t(' ₴/л')],
        [_t('Сума'), money(f.total) + (f.pay === 'wallet' ? _t(' · з гаманця WOG') : '')],
        f.bonus ? [_t('Бонусами'), money(f.bonus)] : null,
        f.earned ? [_t('Нараховано'), _t('+{earned} бонусів', { earned: fmt(f.earned, 0) })] : null,
        sg ? [_t('Витрата'), _t('{cons} л/100 км', { cons: fmt(sg.cons) })] : null,
        f.missed ? [_t('Перед нею'), _t('пропущена заправка')] : null,
        f.queued ? [_t('Стан'), _t('в черзі, ще не на сервері')] : null])}
      ${noteCard(f.note)}
      <button class="btn" type="button" data-edit>${_t('Змінити')}</button>`, sh => {
      $('[data-edit]', sh).addEventListener('click', () => fillForm(f));
    });
  }
  // примітка — багаторядкова: рядки не губляться при збереженні, висота росте з текстом
  const noteField = (id, val, ph) => `<div class="f"><label for="${id}">${_t('Примітка')}</label><textarea id="${id}" name="note" rows="1" data-grow${ph ? ` placeholder="${esc(ph)}"` : ''}>${esc(val || '')}</textarea></div>`;
  const growAll = sh => $$('textarea[data-grow]', sh).forEach(t => { const g = () => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }; t.addEventListener('input', g); requestAnimationFrame(g); });
  function costForm(c) {
    const s = S.data.settings;
    const isNew = !c;
    const last = C.ordered(S.data.fills).pop();
    c = c || { date: nowStamp(), odo: '', cat: 'service', title: '', amount: '', note: '', budget_account: s.budgetEnabled ? s.budgetAccount : '' };
    const list = S.data.cats.filter(k => !k.archived || k.id === c.cat);
    let cur = c.currency === 'USD' ? 'USD' : 'UAH';
    openSheet(`${head(isNew ? _t('Нова витрата') : _t('Витрата'))}<form id="cf" novalidate>
      <div class="card"><div class="cats" role="radiogroup" aria-label="${_t('Категорія')}">${list.map(k => `<button type="button" role="radio" aria-checked="${k.id === c.cat}" data-cat="${esc(k.id)}" class="${k.id === c.cat ? 'on' : ''}">${catIco(k)}${esc(_t(k.name))}</button>`).join('')}</div></div>
      <div class="card">
        <div class="f"><label for="ca">${_t('Сума')}</label><input id="ca" name="amount" inputmode="decimal" value="${dec(c.currency === 'USD' ? c.amount_cur : c.amount)}" required>
          <div class="seg mini" role="radiogroup" aria-label="${_t('Валюта')}"><button type="button" role="radio" data-cur="UAH" aria-checked="${cur === 'UAH'}" class="${cur === 'UAH' ? 'on' : ''}">₴</button><button type="button" role="radio" data-cur="USD" aria-checked="${cur === 'USD'}" class="${cur === 'USD' ? 'on' : ''}">$</button></div></div>
        <div class="f" id="crow" ${cur === 'USD' ? '' : 'hidden'}><label for="cr">${_t('Курс')}</label><input id="cr" name="rate" inputmode="decimal" value="${c.currency === 'USD' ? dec(c.rate) : ''}" placeholder="${_t('курс НБУ')}"><span class="u">₴/$</span></div>
        <p class="hint" id="cfx" ${cur === 'USD' ? '' : 'hidden'} style="margin:0 0 8px"></p>
        <div class="f"><label for="ct">${_t('Що саме')}</label><input id="ct" name="title" value="${esc(c.title)}" placeholder="${_t('Заміна масла')}"></div>
        <div class="f"><label for="cd">${_t('Дата')}</label><input id="cd" name="date" type="datetime-local" value="${esc(c.date.replace(' ', 'T'))}"></div>
        <div class="f"><label for="co">${_t('Пробіг')}</label><input id="co" name="odo" inputmode="numeric" value="${c.odo || ''}" placeholder="${last ? fmt(last.odo, 0) : _t('необов’язково')}"><span class="u">${_t('км')}</span></div>
        ${noteField('cn', c.note)}
      </div>
      ${accountSelect(c.budget_account)}
      <p class="hint err" id="ce" role="alert"></p>
      <button class="btn" type="submit">${_t('Зберегти')}</button>
      ${isNew ? '' : `<button class="btn del" type="button" data-del>${_t('Видалити')}</button>`}</form>`, sh => {
      const form = $('#cf', sh); growAll(sh);
      let cat = c.cat;
      $$('[data-cat]', sh).forEach(b => b.addEventListener('click', () => {
        cat = b.dataset.cat; $$('[data-cat]', sh).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
      }));
      // валюта: ₴ / $ (для $ — курс НБУ на дату витрати, можна задати свій)
      let nbu = null, nbuFor = '';
      const num = v => parseFloat(String(v).replace(/\s/g, '').replace(',', '.')) || 0;
      const fxLine = () => {
        const el = $('#cfx', sh);
        if (cur !== 'USD') return;
        const amt = num(form.amount.value), own = num(form.rate.value), r = own > 0 ? own : nbu && nbu.rate;
        const day = form.date.value.slice(0, 10);
        if (!r) { el.textContent = nbu === false ? _t('Не вдалося взяти курс НБУ — введіть курс вручну') : _t('Беру курс НБУ…'); return; }
        const src = own > 0 ? _t('за вашим курсом') : _t('за курсом НБУ');
        el.textContent = amt > 0 ? _t('≈ {r} ₴ {src} {r2} на {day}', { r: fmt(amt * r, 0), src, r2: fmt(r, 2), day: dayLabel(day) }) : _t('{src} {r} на {day}', { src: src[0].toUpperCase() + src.slice(1), r: fmt(r, 2), day: dayLabel(day) });
      };
      const loadFx = async () => {
        const day = form.date.value.slice(0, 10);
        if (!day || nbuFor === day) return fxLine();
        nbuFor = day; nbu = null; fxLine();
        try { const r = await api('/api/fx?date=' + day); if (nbuFor === day) { nbu = r; form.rate.placeholder = fmt(r.rate, 2); } }
        catch { if (nbuFor === day) nbu = false; }
        fxLine();
      };
      $$('[data-cur]', sh).forEach(b => b.addEventListener('click', () => {
        cur = b.dataset.cur;
        $$('[data-cur]', sh).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
        $('#crow', sh).hidden = $('#cfx', sh).hidden = cur !== 'USD';
        if (cur === 'USD') loadFx();
      }));
      ['amount', 'rate'].forEach(k => form[k].addEventListener('input', fxLine));
      form.date.addEventListener('change', () => { if (cur === 'USD') loadFx(); });
      if (cur === 'USD') loadFx();
      const del = $('[data-del]', sh);
      if (del) del.addEventListener('click', async () => {
        if (!confirm(_t('Видалити витрату?'))) return;
        try { await api('/api/cost/delete', { id: c.id }); qDrop(c.id); closeSheet(); toast(_t('Видалено')); load(); } catch (e) { if (e.network) return toast(_t('Офлайн: видалення недоступне')); $('#ce', sh).textContent = e.message; }
      });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const n = k => parseFloat(String(form[k].value).replace(/\s/g, '').replace(',', '.')) || 0;
        if (!c.id) c.id = newId('c');
        const body = { id: c.id, date: form.date.value.replace('T', ' '), odo: n('odo'), cat, title: form.title.value, amount: n('amount'), note: form.note.value,
          currency: cur, rate: cur === 'USD' ? n('rate') || null : null, budget_account: form.budget_account ? form.budget_account.value : c.budget_account };
        try {
          await api('/api/cost', body);
          qDrop(body.id);
          closeSheet(); toast(_t('Витрату збережено')); load();
        } catch (err) {
          if (err.network) { enqueue('/api/cost', body); closeSheet(); toast(_t('Збережено на телефоні — надішлю, щойно буде зв’язок')); render(); return; }
          $('#ce', sh).textContent = err.message;
        }
      });
    });
  }

  function carForm() {
    const s = S.data.settings;
    const f = ([k, l, ph, im]) => `<div class="f"><label for="s-${k}">${l}</label><input id="s-${k}" name="${k}" value="${esc(s[k] === 0 ? '' : s[k] ?? '')}" ${ph ? `placeholder="${esc(ph)}"` : ''} ${im ? `inputmode="${im}"` : ''}></div>`;
    openSheet(`${head(_t('Авто'))}<form id="sf">
      ${CAR_FIELDS.map(([g, fs], i) => `<h4${i ? '' : ' style="margin-top:0"'}>${g}</h4><div class="card">${fs.map(f).join('')}${i === 1 ? `<div class="f"><label for="s-fuel">${_t('Пальне')}</label><select id="s-fuel" name="fuel">${FUELS.map(x => `<option value="${esc(x)}" ${x === s.fuel ? 'selected' : ''}>${esc(fuelName(x))}</option>`).join('')}</select></div>` : ''}</div>`).join('')}
      <h4>${_t('Нотатки')}</h4><div class="card"><div class="f"><textarea name="carNote" rows="4" placeholder="${_t('коди фарби, ключі, контакти СТО…')}">${esc(s.carNote || '')}</textarea></div></div>
      <button class="btn" type="submit">${_t('Зберегти')}</button></form>`, sh => {
      $('#sf', sh).addEventListener('submit', async e => {
        e.preventDefault();
        const body = {}; $$('input,select,textarea', e.target).forEach(i => { body[i.name] = /^(tank|tireWarn)/.test(i.name) ? parseFloat(i.value.replace(',', '.')) || 0 : i.value; });
        await api('/api/settings', body); closeSheet(); toast(_t('Збережено')); load();
      });
    });
  }

  async function budgetForm() {
    if (!S.data.budgetLinked) { openSheet(`${head(_t('Сімейний бюджет'))}<p>${_t('На сервері не задано токен зв\'язку з Бюджетом (BUDGET_HOOK_TX_TOKEN і BUDGET_URL у .env).')}</p>`); return; }
    openSheet(`${head(_t('Сімейний бюджет'))}<p class="muted">${_t('Завантажую рахунки…')}</p>`);
    const refs = await loadRefs();
    if (!refs) { openSheet(`${head(_t('Сімейний бюджет'))}<p class="hint err">${_t('Бюджет недоступний. Спробуйте пізніше.')}</p>`); return; }
    const s = S.data.settings, b = S.data.budget || {};
    const opt = (list, cur) => list.map(x => `<option value="${esc(x.id)}" ${x.id === cur ? 'selected' : ''}>${esc((x.emoji ? x.emoji + ' ' : '') + x.name + (x.owner ? ' · ' + x.owner : ''))}</option>`).join('');
    const guess = (re) => (refs.expenseCats.find(c => re.test(c.name)) || {}).id || '';
    openSheet(`${head(_t('Сімейний бюджет'))}<form id="bf">
      <div class="card"><label class="sw"><span>${_t('Записувати витрати в Бюджет')}<small>${_t('кожна заправка й витрата стає операцією «Витрата»')}</small></span><input type="checkbox" name="budgetEnabled" ${s.budgetEnabled ? 'checked' : ''}></label></div>
      <div class="card">
        <div class="f"><label for="b-a">${_t('Рахунок')}</label><select id="b-a" name="budgetAccount"><option value="">—</option>${opt(refs.accounts.filter(a => a.currency === 'UAH'), s.budgetAccount)}</select></div>
        <div class="f"><label for="b-f">${_t('Пальне')}</label><select id="b-f" name="budgetFuelCat"><option value="">—</option>${opt(refs.expenseCats, s.budgetFuelCat || guess(/бензин|пальн/i))}</select></div>
        <div class="f"><label for="b-c">${_t('Інші витрати')}</label><select id="b-c" name="budgetCostCat"><option value="">—</option>${opt(refs.expenseCats, s.budgetCostCat || guess(/машин|авто/i))}</select></div>
      </div>
      <p class="hint">${_t('Рахунок — типовий для нових записів, у кожній заправці його можна змінити. Зміни й видалення теж передаються в Бюджет. Стан:')} ${b.pending ? _t('у черзі {pending}{error}', { pending: b.pending, error: b.error ? _t(', помилка: ') + esc(b.error) : '' }) : _t('усе передано')}.</p>
      <button class="btn" type="submit">${_t('Зберегти')}</button>
      <button class="btn sec" type="button" data-resync>${_t('Передати все повторно')}</button></form>`, sh => {
      $('#bf', sh).addEventListener('submit', async e => {
        e.preventDefault(); const f = e.target;
        await api('/api/settings', { budgetEnabled: f.budgetEnabled.checked, budgetAccount: f.budgetAccount.value, budgetFuelCat: f.budgetFuelCat.value, budgetCostCat: f.budgetCostCat.value });
        closeSheet(); toast(_t('Збережено')); load();
      });
      $('[data-resync]', sh).addEventListener('click', async () => { const r = await api('/api/budget/resync', {}); toast(r.budget.pending ? _t('У черзі {pending}', { pending: r.budget.pending }) : _t('Усе передано')); closeSheet(); load(); });
    });
  }

  function catsForm() {
    openSheet(`${head(_t('Категорії витрат'))}<div class="list" id="cl">${S.data.cats.map(k => `<div class="row"><div class="ico">${catIco(k)}</div><div class="mid"><b>${esc(_t(k.name))}</b>${k.archived ? `<span>${_t('прихована')}</span>` : ''}</div><button class="btn sec" style="width:auto;margin:0;padding:8px 12px" data-arch="${esc(k.id)}">${k.archived ? _t('Показати') : _t('Сховати')}</button></div>`).join('')}</div>
      <form id="nc" style="margin-top:12px"><div class="card"><div class="f"><label for="ne">${_t('Значок')}</label><input id="ne" name="emoji" maxlength="4" placeholder="🔋"></div><div class="f"><label for="nn">${_t('Назва')}</label><input id="nn" name="name" required></div></div><button class="btn" type="submit">${_t('Додати категорію')}</button></form>`, sh => {
      $$('[data-arch]', sh).forEach(b => b.addEventListener('click', async () => {
        const k = S.data.cats.find(x => x.id === b.dataset.arch);
        const r = await api('/api/cat', Object.assign({}, k, { archived: !k.archived })); S.data.cats = r.cats; catsForm();
      }));
      $('#nc', sh).addEventListener('submit', async e => { e.preventDefault(); const r = await api('/api/cat', { emoji: e.target.emoji.value, name: e.target.name.value }); S.data.cats = r.cats; catsForm(); });
    });
  }

  function importForm() {
    openSheet(`${head(_t('Імпорт з Fuelio'))}
      <p class="muted" style="margin-top:0">${_t('У Fuelio:')} <b>${_t('Налаштування → Резервна копія та синхронізація → Експорт CSV')}</b> ${_t('(або файл')} <code>vehicle-1-sync.csv</code> ${_t('з Google Drive/Dropbox). Повторний імпорт того самого файлу дублікатів не створює.')}</p>
      <label class="drop" for="if">${_t('Вибрати файл .csv')}<input id="if" type="file" accept=".csv,text/csv,text/plain" hidden></label>
      <div id="ip"></div>`, sh => {
      $('#if', sh).addEventListener('change', async e => {
        const file = e.target.files[0]; if (!file) return;
        const text = await file.text();
        const out = $('#ip', sh);
        try {
          const d = await api('/api/import/fuelio?dry=1', text, { raw: true });
          const v = d.vehicle || {};
          out.innerHTML = `<div class="card" style="padding:12px 14px"><b>${esc([v.name, v.make, v.model].filter(Boolean).join(' · ') || _t('Авто'))}</b><br>
            <span class="muted">${_t('{fills} заправок, {costs} витрат', { fills: d.fills, costs: d.costs })}${d.from ? `, ${dayLabel(d.from)} — ${dayLabel(d.to)}` : ''}</span></div>
            ${S.data.settings.budgetEnabled ? `<div class="card"><label class="sw"><span>${_t('Записати й у Бюджет')}<small>${_t('зазвичай не треба: стара історія вже там є')}</small></span><input type="checkbox" id="ib"></label></div>` : ''}
            <button class="btn" data-go>${_t('Імпортувати')}</button>`;
          $('[data-go]', out).addEventListener('click', async ev => {
            ev.target.disabled = true;
            try {
              const r = await api('/api/import/fuelio' + ($('#ib', out) && $('#ib', out).checked ? '?budget=1' : ''), text, { raw: true });
              closeSheet(); toast(`${_t('Імпортовано: {fills} заправок, {costs} витрат', { fills: r.fills, costs: r.costs })}${r.skipped ? _t(', пропущено дублікатів: {skipped}', { skipped: r.skipped }) : ''}`); S.tab = 'log'; load();
            } catch (err) { ev.target.disabled = false; out.insertAdjacentHTML('beforeend', `<p class="hint err">${esc(err.message)}</p>`); }
          });
        } catch (err) { out.innerHTML = `<p class="hint err">${esc(err.message)}</p>`; }
      });
    });
  }

  function walletSheet() {
    const w = S.data.wallet || { litres: 0, value: 0 };
    const list = S.data.topups || [];
    const used = S.data.fills.filter(f => f.pay === 'wallet');
    openSheet(`${head(_t('Гаманець WOG'))}
      <section class="hero" style="grid-template-columns:1fr 1fr"><div><div class="v num">${fmt(w.litres)}<small>${_t('л')}</small></div><div class="l">${_t('залишок')}</div></div><div><div class="v num">${fmt(w.value, 0)}<small>₴</small></div><div class="l">${_t('за цінами поповнень')}</div></div></section>
      <p class="hint">${_t('Поповнення — це оплата наперед: гроші йдуть у Бюджет одразу, а заправки з гаманця в Бюджет не пишуться і коштують стільки, скільки ви платили за ці літри (спершу найстаріші). Push від WOG про поповнення й використання гаманця записуються самі.')}</p>
      ${list.length ? '<div class="list">' + list.map(topupRow).join('') + '</div>' : ''}
      ${used.length ? `<p class="hint" style="margin-top:10px">${_t('Заправок з гаманця: {length}, {litres} л.', { length: used.length, litres: fmt(used.reduce((a, f) => a + f.litres, 0)) })}</p>` : ''}
      <button class="btn" data-new-topup style="margin-top:12px">${_t('Додати поповнення')}</button>
      <button class="btn sec" data-new-opening>${_t('Вказати поточний залишок')}</button>`, sh => {
      $('[data-new-topup]', sh).addEventListener('click', () => topupForm(null));
      $('[data-new-opening]', sh).addEventListener('click', () => topupForm(null, true));
      $$('[data-topup]', sh).forEach(b => b.addEventListener('click', () => topupForm(list.find(x => x.id === b.dataset.topup))));
    });
  }
  function topupForm(t, opening) {
    const s = S.data.settings;
    const isNew = !t;
    t = t || { date: nowStamp(), litres: '', amount: '', fuel: s.fuel, note: '', opening: opening ? 1 : 0, budget_account: s.budgetEnabled ? s.budgetAccount : '' };
    openSheet(`${head(t.opening ? _t('Залишок у гаманці') : isNew ? _t('Поповнення гаманця') : _t('Поповнення'))}<form id="tf" novalidate>
      ${t.opening ? `<p class="hint">${_t('Скільки літрів уже лежить у гаманці WOG і скільки ви за них заплатили. У Бюджет не записується.')}</p>` : ''}
      <div class="card">
        <div class="f"><label for="tl">${_t('Літри')}</label><input id="tl" name="litres" inputmode="decimal" value="${dec(t.litres)}" required><span class="u">${_t('л')}</span></div>
        <div class="f"><label for="ta">${_t('Сплачено')}</label><input id="ta" name="amount" inputmode="decimal" value="${dec(t.amount)}"><span class="u">₴</span></div>
        <div class="f"><label for="td">${_t('Дата')}</label><input id="td" name="date" type="datetime-local" value="${esc(t.date.replace(' ', 'T'))}"></div>
        <div class="f"><label for="tu">${_t('Пальне')}</label><select id="tu" name="fuel">${(FUELS.includes(t.fuel) || !t.fuel ? FUELS : [t.fuel].concat(FUELS)).map(x => `<option value="${esc(x)}" ${x === t.fuel ? 'selected' : ''}>${esc(fuelName(x))}</option>`).join('')}</select></div>
        <div class="f"><label for="tn">${_t('Примітка')}</label><input id="tn" name="note" value="${esc(t.note)}"></div>
      </div>
      ${t.opening ? '' : accountSelect(t.budget_account)}
      <p class="hint err" id="te" role="alert"></p>
      <button class="btn" type="submit">${_t('Зберегти')}</button>
      ${isNew ? '' : `<button class="btn del" type="button" data-del>${_t('Видалити')}</button>`}</form>`, sh => {
      const form = $('#tf', sh);
      const n = k => parseFloat(String(form[k].value).replace(/\s/g, '').replace(',', '.')) || 0;
      const del = $('[data-del]', sh);
      if (del) del.addEventListener('click', async () => {
        if (!confirm(_t('Видалити поповнення?'))) return;
        try { await api('/api/topup/delete', { id: t.id }); closeSheet(); toast(_t('Видалено')); load(); } catch (e) { $('#te', sh).textContent = e.message; }
      });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        try {
          await api('/api/topup', { id: t.id, date: form.date.value.replace('T', ' '), litres: n('litres'), amount: n('amount'), fuel: form.fuel.value, note: form.note.value,
            opening: t.opening, budget_account: form.budget_account ? form.budget_account.value : t.budget_account });
          closeSheet(); toast(_t('Збережено')); load();
        } catch (err) { $('#te', sh).textContent = err.message; }
      });
    });
  }

  function bonusesSheet() {
    const list = S.data.settings.wogBonuses || [];
    const KEYN = { a95p: _t('А-95+ (Mustang, Pulls)'), a95: _t('А-95'), a92: _t('А-92'), a100: _t('А-100'), dp: _t('ДП'), dpp: _t('ДП+ (Mustang, Pulls)'), gas: _t('Газ') };
    const NETS = ['WOG', _t('ОККО'), 'UKRNAFTA', 'SOCAR', _t('БРСМ-Нафта'), 'AMIC', 'UPG', 'Parallel', 'KLO', 'Marshal']
      .concat(((S.data.prices && S.data.prices.nets) || []).map(x => x.net)).filter((x, i, a) => a.indexOf(x) === i);
    const per = d => d ? dayLabel(d) : '…';
    const rate = b => [b.perL ? fmt(b.perL) + _t(' ₴/л') : '', b.pct ? fmt(b.pct) + '%' : ''].filter(Boolean).join(' + ');
    const groups = {};
    list.forEach((b, i) => { (groups[b.net || 'WOG'] = groups[b.net || 'WOG'] || []).push([b, i]); });
    const body = Object.entries(groups).map(([net, items]) => `<h4>${esc(netName(net))}</h4><div class="list">${items.map(([b, i]) => {
      const done = b.to && b.to < today(), off = b.active === false;
      return `<div class="row" style="cursor:default;${done || off ? 'opacity:.55' : ''}"><div class="ico">${b.where === 'wallet' ? I.wallet : I.pump}</div>
        <div class="mid"><b>${rate(b)} · ${esc(b.name || _t('Бонус'))}</b><span>${esc(KEYN[b.fuel] || b.fuel)} · ${b.where === 'wallet' ? _t('поповнення гаманця') : _t('на АЗК')} · ${per(b.from)} — ${per(b.to)}${done ? _t(' · завершено') : ''}</span>${b.note ? `<span style="white-space:normal">${esc(b.note)}</span>` : ''}</div>
        <label class="have"><input type="checkbox" data-act-b="${i}" ${off ? '' : 'checked'}><small>${_t('є')}</small></label>
        <button class="ibtn del" data-rm="${i}" aria-label="${_t('Видалити бонус')}">${I.close}</button></div>`;
    }).join('')}</div>`).join('');
    openSheet(`${head(_t('Бонуси й знижки'))}
      <p class="hint">${_t('Бонуси нараховуються за літр і потім витрачаються як гривні, тож «Бак» віднімає їх від ціни мережі, коли порівнює, де вигідніше. Галочка «у мене є» — бонус діє для вас (картка, реєстрація, купон). Коли умови зміняться, додайте новий запис, а старий видаліть.')}</p>
      ${body || `<p class="muted">${_t('Поки порожньо.')}</p>`}
      <h4>${_t('Додати')}</h4>
      <form id="bf2"><div class="card">
        <div class="f"><label for="bnet">${_t('Мережа')}</label><select id="bnet" name="net">${NETS.map(n => `<option value="${esc(n)}">${esc(netName(n))}</option>`).join('')}</select></div>
        <div class="f"><label for="bn">${_t('Назва')}</label><input id="bn" name="name" placeholder="${_t('Персональні умови')}"></div>
        <div class="f"><label for="bp">${_t('₴ за літр')}</label><input id="bp" name="perL" inputmode="decimal" placeholder="0"><span class="u">${_t('₴/л')}</span></div>
        <div class="f"><label for="bpc">${_t('або % від ціни')}</label><input id="bpc" name="pct" inputmode="decimal" placeholder="0"><span class="u">%</span></div>
        <div class="f"><label for="bk">${_t('Пальне')}</label><select id="bk" name="fuel">${Object.entries(KEYN).map(([k, l]) => `<option value="${k}" ${k === ((S.data.prices || {}).key || 'a95p') ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="f"><label for="bw">${_t('Де')}</label><select id="bw" name="where"><option value="azk">${_t('Купівля на АЗК')}</option><option value="wallet">${_t('Поповнення гаманця (WOG)')}</option></select></div>
        <div class="f"><label for="bf">${_t('З')}</label><input id="bf" name="from" type="date"></div>
        <div class="f"><label for="bt">${_t('До')}</label><input id="bt" name="to" type="date"></div>
        <div class="f"><label for="bno">${_t('Примітка')}</label><input id="bno" name="note" placeholder="${_t('умови, де дивитись')}"></div>
      </div><p class="hint err" id="be"></p><button class="btn" type="submit">${_t('Додати')}</button></form>`, sh => {
      const save = async l => { await api('/api/settings', { wogBonuses: l }); await load(); bonusesSheet(); };
      $$('[data-rm]', sh).forEach(b => b.addEventListener('click', () => {
        if (!confirm(_t('Видалити цей бонус?'))) return;
        const l = list.slice(); l.splice(+b.dataset.rm, 1); save(l);
      }));
      $$('[data-act-b]', sh).forEach(c => c.addEventListener('change', () => {
        const l = list.map((b, i) => i === +c.dataset.actB ? Object.assign({}, b, { active: c.checked }) : b); save(l);
      }));
      $('#bf2', sh).addEventListener('submit', e => {
        e.preventDefault(); const f = e.target;
        const n = v => parseFloat(String(v).replace(',', '.')) || 0;
        if (!n(f.perL.value) && !n(f.pct.value)) { $('#be', sh).textContent = _t('Вкажіть ₴/л або %'); return; }
        save(list.concat([{ net: f.net.value, name: f.name.value, perL: n(f.perL.value), pct: n(f.pct.value), fuel: f.fuel.value,
          where: f.net.value === 'WOG' ? f.where.value : 'azk', from: f.from.value, to: f.to.value, note: f.note.value, active: true }]));
      });
    });
  }

  function addPicker() {
    openSheet(`${head(_t('Додати'))}<div class="pick">
      <button data-new="fill"><div class="ico fuel">${I.pump}</div>${_t('Заправка')}</button>
      <button data-new="cost"><div class="ico">${I.receipt}</div>${_t('Витрата')}</button>
      <button data-new="topup" class="wide"${S.offline ? ' disabled' : ''}><div class="ico">${I.wallet}</div>${_t('Поповнення гаманця WOG{offline}', { offline: S.offline ? _t(' · потрібен зв’язок') : '' })}</button></div>`, sh => {
      $('[data-new=topup]', sh).addEventListener('click', () => S.offline ? toast(_t('Офлайн: поповнення недоступне')) : topupForm(null));
      $('[data-new=fill]', sh).addEventListener('click', () => fillForm(null));
      $('[data-new=cost]', sh).addEventListener('click', () => costForm(null));
    });
  }

  /* ---------- події ---------- */
  document.addEventListener('click', e => {
    if (!S.data || e.target.closest('.scrim')) return;
    const t = e.target.closest('[data-tab],[data-act],[data-fill],[data-cost],[data-topup],[data-period],[data-rem],[data-set],[data-alert],[data-hint]');
    if (!t) return;
    if ((t.dataset.rem || t.dataset.set || t.dataset.alert || t.dataset.hint) && S.offline) return toast(_t('Офлайн: зміни недоступні'));
    if (t.dataset.rem) return reminderSheet(S.data.reminders.find(r => r.id === t.dataset.rem));
    if (t.dataset.set) return tireSetSheet(S.data.tireSets.find(x => x.id === t.dataset.set));
    if (t.dataset.alert) {
      const k = t.dataset.alert, ref = t.dataset.ref, sv = svc();
      if (k === 'reminder') return reminderSheet(S.data.reminders.find(r => r.id === ref));
      if (k === 'swap') return swapForm();
      if (k === 'worn') return tireSetSheet(S.data.tireSets.find(x => x.id === sv.mounted));
      if (k === 'bm300') return bm300Form();
      if (k === 'battery') return batSheet();
      if (k === 'buy') { S.tab = 'service'; render(); return tireSetForm(null); }
    }
    if (t.dataset.hint) return t.dataset.hint === 'measure' ? measureForm(t.dataset.ref) : tireSetForm(null);
    if (t.dataset.tab) { S.tab = t.dataset.tab; S.anim = true; if (S.tab === 'service' && S.wish && Date.now() - (S.wish.ts || 0) > 600e3) S.wish = null; render(); window.scrollTo(0, 0); return; }
    if (t.dataset.period) { S.period = t.dataset.period; S.anim = true; render(); return; }
    if (t.dataset.fill) { return fillView(S.data.fills.find(f => f.id === t.dataset.fill)); }
    if (t.dataset.topup) { if (S.offline) return toast(_t('Офлайн: редагування недоступне')); return topupForm(S.data.topups.find(x => x.id === t.dataset.topup)); }
    if (t.dataset.cost) { return costView(S.data.costs.find(c => c.id === t.dataset.cost)); }
    const a = t.dataset.act;
    if (S.offline && a !== 'more-log' && a !== 'add') return toast(_t('Офлайн: зміни недоступні'));
    if (a === 'add') return S.tab === 'service' ? servicePicker() : addPicker();
    if (a === 'rem-new') return reminderForm(null);
    if (a === 'measure') return measureForm(null);
    if (a === 'swap') return swapForm();
    if (a === 'tireset') return tireSetForm(null);
    if (a === 'carinfo') return carInfoSheet();
    if (a === 'more-log') { S.logMonths = (S.logMonths || 6) + 12; return render(); }
    if (a === 'car') return carForm();
    if (a === 'cats') return catsForm();
    if (a === 'budget') return budgetForm();
    if (a === 'import') return importForm();
    if (a === 'bm300') return bm300Form();
    if (a === 'bat') return batSheet();
    if (a === 'wallet') return walletSheet();
    if (a === 'prices') return pricesSheet(null);
    if (a === 'bonuses') return bonusesSheet();
    if (a === 'wish') return wishSheet();
    if (a === 'logout') return api('/api/logout', {}).finally(() => { localStorage.removeItem(CACHE); location.replace('/login'); });
  });
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (S.tab === 'stats') drawCharts(); }, 200); });
  // зміна мови: зберегти в налаштуваннях, перетягнути дані (серверні тексти приходять уже новою мовою) і перемалювати
  document.addEventListener('change', async e => {
    const sel = e.target.closest && e.target.closest('[data-lang]');
    if (!sel) return;
    const prev = I18N.getLang(), next = I18N.norm(sel.value);
    if (S.offline) { sel.value = prev; return toast(_t('Офлайн: зміни недоступні')); }
    try {
      await api('/api/settings', { lang: next });
      I18N.setLang(next);
      await load();
    } catch (err) { sel.value = prev; toast(err.message); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.data) { if (!$('.scrim')) load().catch(() => {}); else flushQueue(); } });
  window.addEventListener('online', () => { if (S.data) load().catch(() => {}); });

  // ?add=fill відкриває форму одразу (ярлик на головному екрані)
  load().then(() => {
    flushQueue();
    const q = new URLSearchParams(location.search);
    if (q.get('add') === 'fill') fillForm(null);
    if (q.get('add') === 'cost') costForm(null);
    if (['log', 'stats', 'service', 'more'].includes(q.get('tab'))) { S.tab = q.get('tab'); S.anim = true; render(); }
    const rm = q.get('rem'), rr = rm && S.data.reminders.find(x => x.id === rm);
    if (rr) { S.tab = 'service'; S.anim = true; render(); reminderSheet(rr); }
    const d = q.get('draft'); if (d) { const f = S.data.fills.find(x => x.id === d); if (f) fillForm(f); }
    if (q.toString()) history.replaceState(null, '', '/');
  }).catch(e => window.__fuelShow && window.__fuelShow(_t('Не вдалося завантажити'), e.message));
})();
