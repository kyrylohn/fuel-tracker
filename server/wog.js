'use strict';
/* Розбір тексту push-сповіщення / запису історії WOG PRIDE.
   Формати з історії застосунку (листопад 2026):
     «КУПІВЛЯ НА АЗК  БЕНЗИН MUSTANG 95, 35.4 Л  - 2 168.64 ₴  Бонус: +151.5  Бонус: -872.22»
     «ПОПОВНЕННЯ ГАМАНЦЯ  БЕНЗИН MUSTANG 95, 50 Л  - 4 795 ₴»      (оплата наперед, у бак ще нічого)
     «ВИКОРИСТАННЯ ГАМАНЦЯ  БЕНЗИН MUSTANG 95, 20 Л»               (заправка з гаманця, без грошей)
     «КУПІВЛЯ НА АЗК  2 товари  - 620 ₴»                            (не пальне — ігноруємо)
   Точний текст саме push ще не бачили, тому розбір навмисно гнучкий.
   Повертає null, якщо це не пальне, або { kind: 'fill'|'wallet'|'topup', fuel, litres, price, total, bonus, earned }
   (bonus — списані бонуси, earned — нараховані). */

const N = s => parseFloat(String(s).replace(/[\s  ]/g, '').replace(',', '.'));
const MONEY = '(\\d{1,3}(?:[\\s\\u00a0\\u202f]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)';
const CUR = '(?:грн\\.?|₴|uah)';

function fuelName(low) {
  let fuel = '';
  if (/(?<!\p{L})(дп|дизель|diesel)(?!\p{L})/u.test(low)) fuel = 'ДП';
  else if (/(?<!\p{L})(газ|lpg|пропан)(?!\p{L})/u.test(low)) fuel = 'Газ';
  else {
    const m = low.match(/(?<![\p{L}\d])[aа]-?\s?(92|95|98|100)(?!\d)/u)
      || low.match(/(?:бензин|mustang)[^\d\n]{0,20}(92|95|98|100)(?!\d)/u);
    if (m) fuel = 'А-' + m[1];
  }
  if (fuel && fuel !== 'Газ' && /mustang/.test(low)) fuel += ' Mustang';
  return fuel;
}

function parseFuelNotification(title, text) {
  const s = `${title || ''}\n${text || ''}`.replace(/[−–—]/g, '-');
  if (!s.trim()) return null;
  const low = s.toLowerCase();

  const litresM = s.match(/(\d+(?:[.,]\d{1,3})?)\s*(?:л|l|літр\p{L}*)(?![\p{L}\/])/iu);
  const litres = litresM ? N(litresM[1]) : 0;
  const fuel = fuelName(low);
  // Без літрів це не пальне («2 товари», кава, реклама зі знижками)
  if (!(litres > 0) || litres > 200) return null;
  if (!fuel && !/бензин|пальн|паливо|fuel|wog/i.test(s)) return null;

  const kind = /поповнення\s+гаманц/i.test(s) ? 'topup' : /використання\s+гаманц|з\s+гаманц/i.test(s) ? 'wallet' : 'fill';

  const priceM = s.match(new RegExp(MONEY + '\\s*' + CUR + '\\s*/\\s*(?:л|l)(?!\\p{L})', 'iu'));
  let price = priceM ? N(priceM[1]) : 0;

  // Сума: грошові значення з валютою, крім ціни за літр; беремо найбільше
  let total = 0;
  const re = new RegExp('-?\\s?' + MONEY + '\\s*' + CUR + '(?!\\s*/\\s*(?:л|l)(?!\\p{L}))', 'giu');
  let m; while ((m = re.exec(s))) { const v = N(m[1]); if (v > total) total = v; }
  if (total > 100000) return null;

  // Від'ємні бонуси — списані бонуси (частина оплати)
  let bonus = 0;
  const bre = /бонус\p{L}*\s*:?\s*-\s*(\d+(?:[.,]\d{1,2})?)/giu;
  while ((m = bre.exec(s))) bonus += N(m[1]);
  bonus = Math.round(bonus * 100) / 100;
  // Додатні — нараховані бонуси (кешбек, ним потім платять як гривнями)
  let earned = 0;
  const ere = /бонус\p{L}*\s*:?\s*\+\s*(\d+(?:[.,]\d{1,2})?)/giu;
  while ((m = ere.exec(s))) earned += N(m[1]);
  earned = Math.round(earned * 100) / 100;

  if (kind === 'wallet') { total = 0; price = 0; }
  // ціна за літр: повна (гроші + бонуси), бо бонуси — теж плата
  if (!price && total) price = Math.round((total + bonus) / litres * 100) / 100;
  return { kind, fuel, litres, price, total, bonus, earned };
}

module.exports = { parseFuelNotification };
