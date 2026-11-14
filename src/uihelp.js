/* smartsetu app UI helpers (S14-4). Pure functions, no DOM, tested in Node (test_app.js).
 * They only shorten and group what the engine already returned. Nothing is added, estimated or invented. */
var FINAL = { ok: 1, no_cards: 1, no_data: 1, error: 1, timeout: 1, off: 1 };
// Short plain line for a store that was skipped because its page showed a notice; keys match webtabs.NOCARDS_NOTE (V-242, D-090).
var SKIP_TEXT = { croma: 'Not available yet' };

function isFinal(state) { return FINAL[state] === 1; }

function doneCount(states) {
  var n = 0, k;
  for (k in states) if (Object.prototype.hasOwnProperty.call(states, k) && isFinal(states[k])) n++;
  return n;
}

// One short line and one status kind (wait, ok, bad, skip, off) for a store. The long technical text stays out of the screen.
function shortLine(run, full) {
  var st = run && run.state, key = run && run.key, text = String(full == null ? '' : full);
  if (st === 'ok') return { text: text.replace(/\s*\(.*$/, ''), kind: 'ok' };
  if (st === 'off') return { text: text, kind: 'off' };
  if (st === 'retrying') return { text: 'Trying once more...', kind: 'wait' };
  if (st === 'no_cards') return SKIP_TEXT[key] ? { text: SKIP_TEXT[key], kind: 'skip' } : { text: 'No listings found', kind: 'bad' };
  if (st === 'timeout') return { text: 'Took too long', kind: 'bad' };
  if (st === 'no_data') return { text: 'No readable data', kind: 'bad' };
  if (st === 'error') return { text: 'Could not open this store', kind: 'bad' };
  return { text: text, kind: 'wait' };
}

// Matching listings: cards compared across stores first, listings seen at one store only go into one folded section.
// Only for a specific search that has at least one compared listing; otherwise nothing is hidden.
function splitGroups(groups, mode) {
  var all = groups || [], multi = [], single = [];
  all.forEach(function (g) { (g && g.comparable ? multi : single).push(g); });
  if (mode !== 'specific' || !multi.length) return { multi: all, single: [], multiNote: '', singleNote: '' };
  function shared(list) {
    if (list.length < 2) return '';
    var n = list[0].note || '';
    return n && list.every(function (g) { return (g.note || '') === n; }) ? n : '';
  }
  return { multi: multi, single: single, multiNote: shared(multi), singleNote: shared(single) };
}

// Rupees from a shown price like "\u20b91,29,900" (digits only). null when there is no number.
function rupeesOf(text) { var d = String(text == null ? '' : text).replace(/[^0-9]/g, ''); return d ? parseInt(d, 10) : null; }

// How much cheaper the lowest row is than the next cheapest store, from the two shown prices only (plain subtraction, nothing estimated).
// rows = view rows { store, price, isLowest, odd }. Returns { amount, store } or null.
function savings(rows) {
  var list = (rows || []).filter(function (r) { return r && !r.odd && rupeesOf(r.price) != null; });
  var low = list.filter(function (r) { return r.isLowest; })[0];
  if (!low) return null;
  var lp = rupeesOf(low.price), next = null;
  list.forEach(function (r) { var p = rupeesOf(r.price); if (r !== low && r.store !== low.store && p > lp && (!next || p < rupeesOf(next.price))) next = r; });
  return next ? { amount: rupeesOf(next.price) - lp, store: next.store } : null;
}

// Indian digit grouping for the savings line, e.g. 5000 -> "\u20b95,000", 125000 -> "\u20b91,25,000".
function inr(n) { var s = String(Math.round(n)), last = s.slice(-3), rest = s.slice(0, -3); return '\u20b9' + (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last; }

// R13 (D-105): the member screen shows no technical detail (seconds, read method, try numbers, "browser"). Pure text helpers.
function memberText(t) {
  var x = String(t == null ? '' : t).replace(/\s*\((?:fast read)\)\s*$/i, '').replace(/^(?:2nd|3rd) try:\s*/i, '');
  var m = /^Read (\d+) listings?(?: in [\d.]+ ?(?:s|ms))?\s*$/i.exec(x);
  if (m) return m[1] + (m[1] === '1' ? ' listing' : ' listings') + ' found';
  return x;
}
function memberFooter(when) { return (when ? 'Prices seen on ' + when + ' and they can change. ' : 'Prices can change. ') + 'Stock is not shown here, so check the store before you buy.'; }

module.exports = { memberText: memberText, memberFooter: memberFooter, rupeesOf: rupeesOf, savings: savings, inr: inr, isFinal: isFinal, doneCount: doneCount, shortLine: shortLine, splitGroups: splitGroups, SKIP_TEXT: SKIP_TEXT };
