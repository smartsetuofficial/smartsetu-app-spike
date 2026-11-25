/* app-spike / test_s23_11a v1.0.0 (S23-11 items 2, 3, 4; D-155, V-595). Run: node test_s23_11a.js
 * First Full Test report (V-594): a plain fetch that read a normal page with 0 cards cost a 20 s tab fallback in 5 of 12 searches and blocked the single tab slot.
 * Rules under test (every store, no word list): normal empty page = no results (no tab); anything unclear keeps the tab fallback; tab time = time left until the gate (at least 6 s, none in the last 6 s); a fetch store that does not sell the search waits. */
'use strict';
var fs = require('fs'), path = require('path');
var R = require('./www/runner_core.js'), W = require('./src/webtabs.js'), DS = require('./src/devsuite.js');
var pass = 0, fail = 0;
function ck(n, c, x) { if (c) pass++; else { fail++; console.log('FAIL ' + n + (x ? ' ' + JSON.stringify(x) : '')); } }
function mockApi() {
  var s = { created: [], nextId: 1, listeners: [] };
  s.tabs = { create: function (o) { var id = s.nextId++; s.created.push({ id: id, url: o.url }); return Promise.resolve({ id: id }); }, remove: function () { return Promise.resolve(); }, get: function () { return Promise.resolve({ status: 'loading' }); }, onUpdated: { addListener: function (l) { s.listeners.push(l); }, removeListener: function (l) { s.listeners = s.listeners.filter(function (x) { return x !== l; }); } } };
  s.scripting = { executeScript: function (o) { var u = s.created.filter(function (c) { return c.id === o.target.tabId; })[0].url; return Promise.resolve([{ result: { cards: [{ link: u }], url: u } }]); } };
  return s;
}
var FK = ['amazon', 'flipkart', 'nykaa', 'reliancedigital'];
function O(x) { var o = { query: 'red tape shoes', collect: function () {}, settleMs: 0, loadMs: 60, fetchFirst: FK, maxTabs: 1, fetchMs: 80, fetchRetryWaitMs: 5, enabled: { Myntra: false, Croma: false } }; Object.keys(x || {}).forEach(function (k) { o[k] = x[k]; }); return o; }
function snap(store, q) { return { cards: [{ link: store.url(q) }], url: store.url(q), kind: 'search' }; }
function reader(emptyKeys) { return function (store, q) { return Promise.resolve(emptyKeys.indexOf(store.key) >= 0 ? { cards: [] } : snap(store, q)); }; }
var NORMAL = { http: 200, bytes: 90000, head: 'Search results', robot: false, cards: 0, nr: true }; // S23-13 (D-158): nr = the page itself said there are no results
(async function () {
  // 1 pure helpers
  var now = 1000000;
  ck('1a no deadline: the old per store cap', R.budgetFor(20000, 0, now) === 20000);
  ck('1b 18 s left: 18 s', R.budgetFor(20000, now + 18000, now) === 18000);
  ck('1c 25 s left: the cap 20 s', R.budgetFor(20000, now + 25000, now) === 20000);
  ck('1d 8 s left: 8 s (at least 6 s)', R.budgetFor(20000, now + 8000, now) === 8000);
  ck('1e less than 6 s left or the deadline passed: no new tab', R.budgetFor(20000, now + 5000, now) === 0 && R.budgetFor(20000, now - 1, now) === 0);
  ck('1f emptyPageIsNoResults: only a normal 200 page with 0 cards that says no results', R.emptyPageIsNoResults(NORMAL) === true && !R.emptyPageIsNoResults(Object.assign({}, NORMAL, { nr: false })) && !R.emptyPageIsNoResults({ http: 200, bytes: 90000, head: 'x', robot: false, cards: 0 }) && !R.emptyPageIsNoResults({ http: 403, bytes: 900, robot: true, cards: null }) && !R.emptyPageIsNoResults({ http: 200, bytes: 90000, robot: true, cards: 0 }) && !R.emptyPageIsNoResults({ http: 200, bytes: 400, robot: false, cards: 0 }) && !R.emptyPageIsNoResults({ http: 200, bytes: 90000, robot: false, cards: null }) && !R.emptyPageIsNoResults({ http: null, bytes: null, robot: false, cards: null }) && !R.emptyPageIsNoResults(null));
  // 2 a normal empty page: no tab, state no_cards with noResults
  var api = mockApi(), out = await R.runAll(api, O({ fetchRead: reader(['reliancedigital']), fetchDiag: function () { return Object.assign({}, NORMAL); } }));
  var by = {}; out.runs.forEach(function (r) { by[r.key] = r; });
  ck('2a Reliance: no tab opened, noResults, 2 fetch tries, diag kept', !api.created.some(function (c) { return /reliancedigital/.test(c.url); }) && by.reliancedigital.noResults === true && by.reliancedigital.state === 'no_cards' && by.reliancedigital.cards === 0 && by.reliancedigital.fetchTries === 2 && by.reliancedigital.fetchDiag.http === 200, by.reliancedigital);
  ck('2b the other fetch stores are fine', by.amazon.state === 'ok' && by.amazon.via === 'fetch' && by.flipkart.state === 'ok');
  ck('2c failingLabels does not list a no results store, but lists an empty tab read', JSON.stringify(W.failingLabels([{ store: 'A', state: 'no_cards', noResults: true }, { store: 'B', state: 'no_cards' }, { store: 'C', state: 'no_data' }])) === '["B","C"]');
  // 3 unclear = old tab fallback
  [['blocked (robot words)', { http: 200, bytes: 90000, robot: true, cards: 0 }], ['http 403', { http: 403, bytes: 900, robot: false, cards: null }], ['tiny page', { http: 200, bytes: 500, robot: false, cards: null }], ['no diag', null], ['option off', 'off']].forEach(function (c) {
    var a = mockApi(), op = { fetchRead: reader(['reliancedigital']), fetchDiag: function () { return c[1] === 'off' ? Object.assign({}, NORMAL) : c[1]; } };
    if (c[1] === 'off') op.fetchEmptyIsNoResults = false;
    return R.runAll(a, O(op)).then(function (o2) { var b = {}; o2.runs.forEach(function (r) { b[r.key] = r; }); ck('3 ' + c[0] + ': tab fallback as before', a.created.some(function (x) { return /reliancedigital/.test(x.url); }) && b.reliancedigital.fetchFallback === 'no_cards' && !b.reliancedigital.noResults, b.reliancedigital); });
  });
  await new Promise(function (r) { setTimeout(r, 200); });
  // 4 fallbackPrio: the fallback of a store that does not sell the search goes after the tab only stores
  api = mockApi(); out = await R.runAll(api, O({ fetchRead: reader(['reliancedigital']), fetchEmptyIsNoResults: false, fallbackPrio: { reliancedigital: 3 } }));
  var ord = api.created.map(function (c) { return /ajio/.test(c.url) ? 'ajio' : /meesho/.test(c.url) ? 'meesho' : /tatacliq/.test(c.url) ? 'tata' : /reliancedigital/.test(c.url) ? 'reliance' : '?'; });
  ck('4a Reliance fallback is the LAST tab', ord.length === 4 && ord[3] === 'reliance', ord);
  api = mockApi(); out = await R.runAll(api, O({ fetchRead: reader(['reliancedigital']), fetchEmptyIsNoResults: false }));
  ord = api.created.map(function (c) { return /ajio/.test(c.url) ? 'ajio' : /meesho/.test(c.url) ? 'meesho' : /tatacliq/.test(c.url) ? 'tata' : /reliancedigital/.test(c.url) ? 'reliance' : '?'; });
  ck('4b without fallbackPrio the old order (fallback second, D-143)', ord[1] === 'reliance', ord);
  // 5 the tail: a deadline 3 s away opens no tab
  api = mockApi(); out = await R.runAll(api, O({ deadlineAt: Date.now() + 3000, fetchRead: reader([]) }));
  by = {}; out.runs.forEach(function (r) { by[r.key] = r; });
  ck('5 less than 6 s to the gate: tab stores skipped, fetch stores read', by.ajio.state === 'skipped' && by.meesho.state === 'skipped' && by.amazon.state === 'ok' && api.created.length === 0, [by.ajio.state, api.created.length]);
  // 6 report side
  var sums = [{ item: { nores: false }, stores: [{ label: 'Reliance Digital', state: 'no_cards', nr: 1, stage: null, ms: 3000, n: 0, parsed: 0, priced: 0, linked: 0, dups: 0, on: 0, off: 0 }] }];
  var g = DS.gate(sums);
  ck('6a the gate does not count a no results store as failed', g.length === 1 && g[0].failed === 0, g[0]);
  var app = fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8'), dev = fs.readFileSync(path.join(__dirname, 'src', 'devsuite.js'), 'utf8');
  ck('6b app.js passes fallbackPrio from the rank and keeps nr in the store lines', /fallbackPrio: fbPrio/.test(app) && /M\.rank\(q, R\.STORES\)/.test(app) && /nr: r\.noResults \? 1 : null/.test(app));
  ck('6c devsuite prints no_results', /st\.nr \? 'no_results' : st\.state/.test(dev));
  ck('6d the two runner_core copies are identical', fs.readFileSync(path.join(__dirname, 'www', 'runner_core.js'), 'utf8') === fs.readFileSync(path.join(__dirname, '..', 'extension', 'runner_core.js'), 'utf8'));
  console.log('test_s23_11a: ' + pass + ' pass, ' + fail + ' fail'); process.exit(fail ? 1 : 0);
})();
