'use strict';
const I18N = require('../public/i18n.js');
const _t = I18N.t;
/* Вішліст (cmintey/wishlist, необов'язково: WISHLIST_URL + WISHLIST_LIST): речі з категорією #авто з публічного списку.
   Читаємо дані сторінки списку (SvelteKit __data.json, формат devalue) — без логіну, бо список публічний.
   Броні не показуємо: у вішлісті власник їх теж не бачить (сюрприз). Картинки віддаємо через /api/wish/img. */
const BASE = (process.env.WISHLIST_URL || '').replace(/\/$/, '');
const LIST = process.env.WISHLIST_LIST || '';
const enabled = !!(BASE && LIST);
const PUBLIC = (process.env.WISHLIST_PUBLIC || BASE).replace(/\/$/, '');
const BOT = (process.env.WISHLIST_BOT || '').replace(/^@?/, '');   // необов'язково: Telegram-бот, що додає речі у вішліст
const TAG_RE = /(^|\s)#([\p{L}\p{N}_-]{2,30})/gu;

// devalue: плаский масив, значення — індекси інших елементів; від'ємні — undefined/null/NaN
function unflatten(a) {
  const memo = new Map();
  const h = i => {
    if (i === -1) return undefined;
    if (i < 0) return null;
    if (memo.has(i)) return memo.get(i);
    const v = a[i];
    if (v === null || typeof v !== 'object') { memo.set(i, v); return v; }
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string' && ['Date', 'Set', 'Map', 'BigInt', 'RegExp', 'URL'].includes(v[0])) { memo.set(i, v[1]); return v[1]; }
      const o = []; memo.set(i, o); v.forEach(x => o.push(h(x))); return o;
    }
    const o = {}; memo.set(i, o);
    for (const k of Object.keys(v)) o[k] = h(v[k]);
    return o;
  };
  return h(0);
}
const tagsOf = note => [...String(note || '').matchAll(TAG_RE)].map(m => m[2].toLowerCase());
const cleanNote = note => String(note || '').replace(TAG_RE, '$1').replace(/\s{2,}/g, ' ').trim();

function pick(data, tag) {
  const list = data && data.list;
  if (!list || !Array.isArray(list.items)) throw new Error(_t('Вішліст: несподіваний формат даних'));
  return list.items.filter(it => tagsOf(it.note).includes(tag)).map(it => ({
    id: it.id, name: it.name, url: /^https?:\/\//i.test(it.url || '') ? it.url : '', note: cleanNote(it.note).slice(0, 300),
    price: it.itemPrice ? it.itemPrice.value / 100 : null, currency: it.itemPrice ? it.itemPrice.currency : null,
    image: it.imageUrl && /^[\w.-]+$/.test(it.imageUrl) ? it.imageUrl : (it.imageUrl && /^https?:/.test(it.imageUrl) ? it.imageUrl : null),
    qty: it.quantity, mostWanted: !!it.mostWanted
  }));
}

let cache = null;
async function items(tag, force) {
  if (!enabled) return { disabled: true, items: [] };
  tag = String(tag || 'авто').toLowerCase().replace(/^#/, '');
  if (!force && cache && cache.tag === tag && Date.now() - cache.ts < 10 * 60e3) return cache.out;
  const r = await fetch(`${BASE}/lists/${LIST}/__data.json`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(_t('Вішліст: ') + r.status);
  const j = await r.json();
  const node = (j.nodes || []).find(n => n && n.type === 'data' && Array.isArray(n.data) && n.data[0] && 'list' in n.data[0]);
  if (!node) throw new Error(_t('Вішліст: список не знайдено'));
  const list = pick(unflatten(node.data), tag);
  const out = { items: list, tag, total: list.reduce((a, x) => a + (x.price || 0) * (x.qty || 1), 0),
    listUrl: `${PUBLIC}/lists/${LIST}#cat=${encodeURIComponent(tag)}`, bot: BOT, ts: Date.now() };
  cache = { tag, ts: Date.now(), out };
  return out;
}
// Картинка речі: лише ім'я файлу з вішліста, без шляхів
async function image(name) {
  if (!enabled) return null;
  if (!/^(?!\.+$)[\w.-]{1,200}$/.test(String(name))) return null;
  const r = await fetch(`${BASE}/api/assets/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) return null;
  const type = r.headers.get('content-type') || '';
  if (!/^image\/(png|jpeg|webp|gif|avif)\b/i.test(type)) return null;
  return { type, body: Buffer.from(await r.arrayBuffer()) };
}

module.exports = { enabled, items, image, unflatten, pick, tagsOf, cleanNote };
