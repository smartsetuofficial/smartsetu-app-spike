/* smartsetu app UI helpers (S14-4). Pure functions, no DOM, tested in Node (test_app.js).
 * They only shorten and group what the engine already returned. Nothing is added, estimated or invented. */
var FINAL = { ok: 1, no_cards: 1, no_data: 1, error: 1, timeout: 1, off: 1 };
// Short plain line for a store that was skipped because its page showed a notice; keys match webtabs.NOCARDS_NOTE (V-242, D-090).
var SKIP_TEXT = { croma: 'Skipped: asks for a pincode' };

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

module.exports = { isFinal: isFinal, doneCount: doneCount, shortLine: shortLine, splitGroups: splitGroups, SKIP_TEXT: SKIP_TEXT };
