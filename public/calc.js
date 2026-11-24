/* Розрахунки «Бака»: спільні для сервера (тести, хуки) і браузера.
   Витрата рахується «від повного до повного»: усі літри, залиті після попереднього
   повного бака (включно з частковими заправками), ділимо на пробіг між двома повними.
   Якщо в проміжку є позначка «пропущена заправка», відрізок не рахується. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FuelCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const _t = (typeof module === 'object' && module.exports ? require('./i18n.js') : self.FuelI18n).t;

  const r2 = n => Math.round(n * 100) / 100;
  const ym = d => String(d || '').slice(0, 7);

  // Тільки завершені заправки з пробігом; порядок — за одометром, потім за датою
  function ordered(fills) {
    return (fills || [])
      .filter(f => f && f.status !== 'draft' && f.odo > 0 && f.litres > 0)
      .slice()
      .sort((a, b) => a.odo - b.odo || String(a.date).localeCompare(String(b.date)));
  }

  // id заправки → { cons, dist, litres } для кожної повної заправки, що закриває чистий відрізок
  function segments(fills) {
    const out = {};
    let prevFull = null, acc = 0, broken = false;
    for (const f of ordered(fills)) {
      if (!prevFull) { if (f.full) { prevFull = f; acc = 0; broken = false; } continue; }
      acc += f.litres;
      if (f.missed) broken = true;
      if (f.full) {
        const dist = f.odo - prevFull.odo;
        if (!broken && dist > 0 && acc > 0) out[f.id] = { cons: acc / dist * 100, dist, litres: acc };
        prevFull = f; acc = 0; broken = false;
      }
    }
    return out;
  }

  const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to + '￿');

  /* Зведення за період (from/to — 'YYYY-MM-DD' або порожньо = уся історія) */
  function stats(fills, costs, opts) {
    opts = opts || {};
    const from = opts.from || '', to = opts.to || '';
    const seg = segments(fills);
    const fs = ordered(fills).filter(f => inRange(f.date, from, to));
    const cs = (costs || []).filter(c => c && inRange(c.date, from, to));

    const fuelSpend = fs.reduce((a, f) => a + (f.total || 0), 0);
    const earned = fs.reduce((a, f) => a + (f.earned || 0), 0);
    const bonusSpent = fs.reduce((a, f) => a + (f.bonus || 0), 0);
    const litres = fs.reduce((a, f) => a + f.litres, 0);
    const costSpend = cs.reduce((a, c) => a + (c.amount || 0), 0);

    const odos = fs.map(f => f.odo).concat(cs.map(c => c.odo).filter(o => o > 0));
    const km = odos.length > 1 ? Math.max.apply(null, odos) - Math.min.apply(null, odos) : 0;

    const segs = fs.map(f => seg[f.id]).filter(Boolean);
    const segL = segs.reduce((a, s) => a + s.litres, 0), segD = segs.reduce((a, s) => a + s.dist, 0);
    const cons = segs.map(s => s.cons);

    // Вартість кілометра: пальне, спалене на пройденій відстані (без першої заправки періоду)
    const fuelForKm = fs.length > 1 ? fuelSpend - (fs[0].total || 0) : 0;

    const days = fs.length > 1 ? (Date.parse(fs[fs.length - 1].date.slice(0, 10)) - Date.parse(fs[0].date.slice(0, 10))) / 864e5 : 0;

    const months = {};
    const mon = k => months[k] || (months[k] = { month: k, fuel: 0, costs: 0, litres: 0 });
    fs.forEach(f => { const m = mon(ym(f.date)); m.fuel += f.total || 0; m.litres += f.litres; });
    cs.forEach(c => { mon(ym(c.date)).costs += c.amount || 0; });

    const byCat = {};
    cs.forEach(c => { byCat[c.cat || ''] = (byCat[c.cat || ''] || 0) + (c.amount || 0); });

    return {
      fills: fs.length, costsCount: cs.length, earned: r2(earned), bonusSpent: r2(bonusSpent),
      fuelSpend: r2(fuelSpend), costSpend: r2(costSpend), total: r2(fuelSpend + costSpend),
      litres: r2(litres), km: Math.round(km),
      avgCons: segD > 0 ? r2(segL / segD * 100) : null,
      lastCons: segs.length ? r2(segs[segs.length - 1].cons) : null,
      bestCons: cons.length ? r2(Math.min.apply(null, cons)) : null,
      worstCons: cons.length ? r2(Math.max.apply(null, cons)) : null,
      fuelPerKm: km > 0 && fuelForKm > 0 ? Math.round(fuelForKm / km * 100) / 100 : null,
      totalPerKm: km > 0 ? Math.round((fuelForKm + costSpend) / km * 100) / 100 : null,
      avgPrice: litres > 0 ? r2(fuelSpend / litres) : null,
      kmPerDay: days > 0 ? Math.round(km / days) : null,
      months: Object.values(months).sort((a, b) => a.month.localeCompare(b.month))
        .map(m => ({ month: m.month, fuel: r2(m.fuel), costs: r2(m.costs), litres: r2(m.litres) })),
      byCat
    };
  }


  /* Гаманець WOG: поповнення — партії літрів за своєю ціною; заправки з гаманця (pay = 'wallet')
     списують літри з найстаріших партій (FIFO), звідси їхня ціна й вартість. Повертає копії заправок
     з дорахованими price/total і залишок гаманця. Якщо літрів у гаманці забракло — беремо ціну
     останньої відомої партії. */
  function applyWallet(fills, topups) {
    const lots = (topups || []).filter(t => t && t.litres > 0).slice()
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(t => ({ date: t.date, left: t.litres, price: t.litres ? (t.amount || 0) / t.litres : 0 }));
    const out = (fills || []).map(f => Object.assign({}, f));
    const wallet = out.filter(f => f.pay === 'wallet').sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let lastPrice = 0, short = 0;
    for (const f of wallet) {
      let need = +f.litres || 0, cost = 0;
      for (const lot of lots) {
        if (need <= 0) break;
        if (lot.date > f.date || lot.left <= 0) continue;
        const take = Math.min(lot.left, need);
        lot.left -= take; need -= take; cost += take * lot.price; lastPrice = lot.price;
      }
      if (need > 0) {
        const p = lastPrice || (lots.find(l => l.date <= f.date) || lots[0] || {}).price || 0;
        cost += need * p; short += need;
      }
      f.total = r2(cost);
      f.price = f.litres ? Math.round(cost / f.litres * 100) / 100 : 0;
    }
    const left = lots.reduce((a, l) => a + l.left, 0);
    return { fills: out, balance: { litres: r2(left), value: r2(lots.reduce((a, l) => a + l.left * l.price, 0)), short: r2(short) } };
  }

  // Дозаповнює третє значення з двох відомих (літри, ціна за літр, сума)
  function complete(f) {
    const o = Object.assign({}, f);
    const L = +o.litres || 0, P = +o.price || 0, T = +o.total || 0;
    if (L && P && !T) o.total = r2(L * P);
    else if (L && T && !P) o.price = Math.round(T / L * 1000) / 1000;
    else if (P && T && !L) o.litres = Math.round(T / P * 100) / 100;
    return o;
  }

  // Перевірка пробігу нової/зміненої заправки відносно сусідів за датою
  function odoProblem(fills, f) {
    if (!(f.odo > 0)) return null;
    const others = (fills || []).filter(x => x.id !== f.id && x.status !== 'draft' && x.odo > 0);
    const before = others.filter(x => x.date < f.date).sort((a, b) => b.odo - a.odo)[0];
    const after = others.filter(x => x.date > f.date).sort((a, b) => a.odo - b.odo)[0];
    if (before && f.odo <= before.odo) return _t('Пробіг менший за попередню заправку ({odo} км)', { odo: before.odo });
    if (after && f.odo >= after.odo) return _t('Пробіг більший за наступну заправку ({odo} км)', { odo: after.odo });
    return null;
  }

  /* Бонуси й знижки мережі на сьогодні, ₴/л. bonuses — налаштування wogBonuses:
     { net, fuel, perL | pct, where: 'azk'|'wallet', from, to, active }. pct рахується від ціни. */
  function bonusFor(bonuses, net, key, where, price, day) {
    day = day || new Date().toLocaleDateString('sv-SE');
    let sum = 0;
    for (const b of bonuses || []) {
      if (b.active === false || (b.net || 'WOG') !== net || b.fuel !== key || (b.where || 'azk') !== where) continue;
      if ((b.from && day < b.from) || (b.to && day > b.to)) continue;
      sum += (+b.perL || 0) + (b.pct ? (+price || 0) * b.pct / 100 : 0);
    }
    return Math.round(sum * 100) / 100;
  }


  /* ---------- періоди й динаміка (Статистика, Журнал) ---------- */
  const p2 = n => String(n).padStart(2, '0');
  const isoD = (Y, M, D) => { const x = new Date(Y, M, D); return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`; };
  const PERIOD_MONTHS = { m: 1, '3m': 3, y: 12 };

  // «Місяць» / «3 міс.» / «Рік» = N календарних місяців до сьогодні; «Усе» — без меж
  function periodRange(p, now) {
    const d = now || new Date(), n = PERIOD_MONTHS[p];
    return n ? { from: isoD(d.getFullYear(), d.getMonth() - (n - 1), 1), to: '' } : { from: '', to: '' };
  }
  // попередній такий самий період, зсунутий на N місяців назад і обрізаний по той самий день (щоб порівнювати рівні відрізки); для «Усе» — null
  function prevPeriodRange(p, now) {
    const d = now || new Date(), n = PERIOD_MONTHS[p];
    if (!n) return null;
    const y = d.getFullYear(), m = d.getMonth() - n;
    const last = new Date(y, m + 1, 0).getDate();
    return { from: isoD(y, m - (n - 1), 1), to: isoD(y, m, Math.min(d.getDate(), last)) };
  }
  // зміна в % (ціле); null, якщо порівнювати нема з чим
  function pctChange(cur, prev) {
    if (!isFinite(cur) || !isFinite(prev) || cur === null || prev === null || !(prev > 0)) return null;
    return Math.round((cur - prev) / prev * 100);
  }
  // ключі місяців 'YYYY-MM' від a до b включно
  function monthKeys(a, b, cap) {
    const out = []; let [y, m] = a.split('-').map(Number);
    for (let k = `${y}-${p2(m)}`; k <= b && out.length < (cap || 240); m++, (m > 12 && (m = 1, y++)), k = `${y}-${p2(m)}`) out.push(k);
    return out;
  }
  // показники по місяцях для міні-графіків; відрізок витрати належить місяцю заправки, що його закрила
  function monthlyMetrics(fills, costs, months) {
    const seg = segments(fills), fs = ordered(fills);
    return months.map(k => {
      const st = stats(fills, costs, { from: k + '-01', to: k + '-31' });
      let km = 0; fs.forEach(f => { if (ym(f.date) === k && seg[f.id]) km += seg[f.id].dist; });
      return {
        month: k, avgCons: st.avgCons, avgPrice: st.avgPrice, km: km > 0 ? Math.round(km) : null, earned: st.earned > 0 ? st.earned : null,
        fuelPerKm: st.avgCons && st.avgPrice ? r2(st.avgCons / 100 * st.avgPrice) : null, total: st.total, fuel: st.fuelSpend, costs: st.costSpend
      };
    });
  }
  // суми по днях місяця: items = [{ date, v }]; масив довжиною в кількість днів
  function daySeries(items, month) {
    const [y, m] = month.split('-').map(Number), out = new Array(new Date(y, m, 0).getDate()).fill(0);
    (items || []).forEach(it => { if (ym(it.date) === month) out[+String(it.date).slice(8, 10) - 1] += it.v || 0; });
    return out.map(r2);
  }

  return { segments, stats, complete, odoProblem, ordered, applyWallet, bonusFor, periodRange, prevPeriodRange, pctChange, monthKeys, monthlyMetrics, daySeries };
});
