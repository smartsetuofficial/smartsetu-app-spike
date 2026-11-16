/* smartsetu app / offerflow v1.0.0 (S22b-2, D-060, D-093, D-117). Pure functions, no DOM, no network, tested in Node (test_s22b2.js).
 * Store-page offer lines -> short lines under a result row. Rules (nothing is invented):
 *  - An amount is used ONLY when the page line itself states it (percent, flat Rs, "You pay"). No amount = "Offers available, check the store".
 *  - A bank offer lowers the price ONLY when its bank is one of the member's own cards (kept on the phone) AND the min order is met. Always labelled "estimate".
 *  - A coupon is never taken off the price (it needs a code at checkout). It is shown as "Possible", outside every total.
 *  - Lines that look like other products' tiles (isTileLine) are dropped before anything is read, so another product's offer never lands on this one.
 * The listed price of a store stays the listed price. Nothing here changes it. */
'use strict';
var KEY = 'smartsetu_cards_v1', PER_STORE = 2, MAX_PAGES = 16;

function make(deps) {
  var parser = deps.parser, adapter = deps.adapter, offers = deps.offers, isTile = deps.isTileLine || function () { return false; };
  var BANKS = adapter.BANKS.slice();

  function keyOfLabel(label) {
    var k, want = String(label || '').toLowerCase();
    for (k in parser.STORES) if (Object.prototype.hasOwnProperty.call(parser.STORES, k) && String(parser.STORES[k].name).toLowerCase() === want) return k;
    return null;
  }
  function inr(paise) {
    var r = Math.round(paise / 100), s = String(Math.abs(r)), last = s.slice(-3), rest = s.slice(0, -3);
    if (rest) last = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last;
    return '\u20B9' + last;
  }
  function validCards(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (c) { if (BANKS.indexOf(c) >= 0 && out.indexOf(c) < 0) out.push(c); });
    return out;
  }
  function loadCards(storage) { try { return validCards(JSON.parse(storage.getItem(KEY) || '[]')); } catch (_) { return []; } }
  function saveCards(storage, list) { var v = validCards(list); try { storage.setItem(KEY, JSON.stringify(v)); } catch (_) { /* private mode: cards are kept for this session only */ } return v; }

  // Which listings to read: the top PER_STORE cheapest matched listings of every store, never a "close match" group, never a price flagged odd.
  function pickTargets(view, perStore, maxPages) {
    perStore = perStore || PER_STORE; maxPages = maxPages || MAX_PAGES;
    var rows = [], seen = {};
    function add(r) { if (r && r.url && !r.odd && r.pricePaise > 0 && !seen[r.url]) { seen[r.url] = 1; rows.push(r); } }
    ((view && view.groups) || []).forEach(function (g) { if (/close matches/i.test(String(g.title || ''))) return; (g.rows || []).forEach(add); });
    if (view && view.top) (view.top.rows || []).forEach(add);
    rows.sort(function (a, b) { return a.pricePaise - b.pricePaise; });
    var n = {}, out = [];
    rows.forEach(function (r) { n[r.store] = n[r.store] || 0; if (n[r.store] < perStore && out.length < maxPages) { n[r.store]++; out.push({ store: r.store, url: r.url, pricePaise: r.pricePaise }); } });
    return out;
  }

  // lines: strings read from the product page. Returns a plain summary, or null when nothing useful is known.
  function assess(storeLabel, lines, pricePaise, cards) {
    var key = keyOfLabel(storeLabel);
    if (!key || !(pricePaise > 0)) return null;
    var clean = (lines || []).filter(function (l) { return !isTile(l); });
    var offs = parser.offersFromLines(key, clean);
    if (!offs.length) return null;
    var ao = adapter.adaptOffers(offs), ev = offers.evaluate({ pricePaise: pricePaise, offers: ao.offers }, ao.metas, { memberCards: validCards(cards) });
    var best = null;
    ev.counted.forEach(function (c) { if (c.type === 'bank' && (!best || c.discountPaise > best.discountPaise)) best = c; });
    var res = { after: null, possible: [], available: false };
    if (best && best.discountPaise > 0) res.after = { bank: best.bank, discountPaise: best.discountPaise, effectivePaise: Math.max(0, pricePaise - best.discountPaise) };
    ev.notCounted.forEach(function (n) {
      if (n.possibleSavingPaise > 0) {
        var tag = n.type === 'coupon' ? ' (coupon)' : (n.bank ? ' with ' + n.bank + ' card' : '');
        var text = 'Possible: ' + inr(n.possibleSavingPaise) + ' off' + tag;
        if (!res.possible.some(function (p) { return p.text === text; })) res.possible.push({ text: text, amountPaise: n.possibleSavingPaise });
      } else if (n.reason === 'amount_not_stated' && (n.type === 'bank' || n.type === 'coupon' || n.type === 'other')) res.available = true;
    });
    res.possible.sort(function (a, b) { return b.amountPaise - a.amountPaise; });
    res.possible = res.possible.slice(0, 2);
    if (res.after) res.possible = res.possible.filter(function (p) { return p.amountPaise > res.after.discountPaise || !new RegExp(res.after.bank).test(p.text); });
    if (!res.after && !res.possible.length && !res.available) return null;
    return res;
  }
  function rowLines(res) {
    if (!res) return [];
    var out = [];
    if (res.after) out.push({ kind: 'after', text: 'After your ' + res.after.bank + ' card: ' + inr(res.after.discountPaise) + ' less \u2192 ' + inr(res.after.effectivePaise) + ' (estimate)' });
    res.possible.forEach(function (p) { out.push({ kind: 'possible', text: p.text }); });
    if (!res.after && !res.possible.length && res.available) out.push({ kind: 'avail', text: 'Offers available, check the store' });
    return out;
  }
  // Group line: lowest price after the member's card offers. Only when at least one row has a counted card offer; the store's listed price is never touched.
  function groupLowest(rows, resOf) {
    var best = null;
    (rows || []).forEach(function (r) {
      if (r.odd) return;
      var res = resOf(r), eff = res && res.after ? res.after.effectivePaise : r.pricePaise;
      if (res && res.after && (!best || eff < best.effectivePaise)) best = { store: r.store, effectivePaise: eff, bank: res.after.bank };
    });
    if (!best) return null;
    var listed = null;
    (rows || []).forEach(function (r) { if (!r.odd && (listed === null || r.pricePaise < listed)) listed = r.pricePaise; });
    return { store: best.store, effectivePaise: best.effectivePaise, bank: best.bank, text: 'Lowest after your card offers: ' + inr(best.effectivePaise) + ' at ' + best.store + ' (estimate)', beatsListed: listed === null || best.effectivePaise < listed };
  }
  return { BANKS: BANKS, KEY: KEY, PER_STORE: PER_STORE, MAX_PAGES: MAX_PAGES, keyOfLabel: keyOfLabel, inr: inr, validCards: validCards, loadCards: loadCards, saveCards: saveCards, pickTargets: pickTargets, assess: assess, rowLines: rowLines, groupLowest: groupLowest };
}
module.exports = { make: make, KEY: KEY };
