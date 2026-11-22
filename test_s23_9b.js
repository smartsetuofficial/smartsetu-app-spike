// S23-9b (D-143) offline test: fetch retry, tab priority, fetch diagnostics. node test_s23_9b.js
'use strict';
var fs = require('fs'), path = require('path');
var R = require('./www/runner_core.js'), FR = require('./www/fetchread.js');
var pass = 0, fail = 0;
function ck(n, c, x) { if (c) pass++; else { fail++; console.log('FAIL ' + n + (x ? ' ' + JSON.stringify(x) : '')); } }
function mockApi() {
  var s = { created: [], nextId: 1, listeners: [] };
  s.tabs = {
    create: function (o) { var id = s.nextId++; s.created.push({ id: id, url: o.url }); return Promise.resolve({ id: id }); },
    remove: function () { return Promise.resolve(); },
    get: function () { return Promise.resolve({ status: 'loading' }); },
    onUpdated: { addListener: function (l) { s.listeners.push(l); }, removeListener: function (l) { s.listeners = s.listeners.filter(function (x) { return x !== l; }); } }
  };
  s.scripting = { executeScript: function (o) { var u = s.created.filter(function (c) { return c.id === o.target.tabId; })[0].url; return Promise.resolve([{ result: { cards: [{ link: u }], url: u } }]); } };
  return s;
}
var FK = ['amazon', 'flipkart', 'nykaa', 'reliancedigital'];
function O(x) { var o = { query: 'smartphones under 10000', collect: function () {}, settleMs: 0, loadMs: 60, fetchFirst: FK, maxTabs: 1, fetchMs: 80, fetchRetryWaitMs: 5, enabled: { Myntra: false, Croma: false } }; Object.keys(x || {}).forEach(function (k) { o[k] = x[k]; }); return o; }
function snap(store, q) { return { cards: [{ link: store.url(q) }], url: store.url(q), kind: 'search' }; }
function reader(over) { var calls = {}; var f = function (store, q) { calls[store.key] = (calls[store.key] || 0) + 1; return over && over[store.key] ? over[store.key](calls[store.key], store, q) : Promise.resolve(snap(store, q)); }; f.calls = calls; return f; }
(async function () {
  // 1 retry succeeds
  var api = mockApi(), f = reader({ reliancedigital: function (n, s, q) { return Promise.resolve(n === 1 ? { cards: [] } : snap(s, q)); } });
  var out = await R.runAll(api, O({ fetchRead: f })); var by = {}; out.runs.forEach(function (r) { by[r.key] = r; });
  ck('1a second fetch gives the cards, state ok via fetch, 2 tries', by.reliancedigital.state === 'ok' && by.reliancedigital.via === 'fetch' && by.reliancedigital.fetchTries === 2, by.reliancedigital);
  ck('1b no tab for Reliance', !api.created.some(function (c) { return /reliancedigital/.test(c.url); }));
  ck('1c stores that were fine were read once', f.calls.amazon === 1 && f.calls.flipkart === 1 && f.calls.nykaa === 1);
  // 2 retry also empty: tab fallback with diagnostics
  api = mockApi(); f = reader({ reliancedigital: function () { return Promise.resolve(null); } });
  var diagN = 0; out = await R.runAll(api, O({ fetchRead: f, fetchDiag: function (s) { diagN++; return { http: 403, bytes: 900, head: 'Access Denied', robot: true }; } })); by = {}; out.runs.forEach(function (r) { by[r.key] = r; });
  ck('2a fallback after 2 tries with reason, diag and first diag', by.reliancedigital.fetchFallback === 'no_cards' && by.reliancedigital.fetchTries === 2 && by.reliancedigital.fetchDiag && by.reliancedigital.fetchDiag.http === 403 && by.reliancedigital.fetchDiag1 && by.reliancedigital.fetchDiag1.robot === true, by.reliancedigital);
  ck('2b the tab read it (ok)', by.reliancedigital.state === 'ok' && !by.reliancedigital.via);
  // 3 timeout and fetchRetry:false do not retry
  api = mockApi(); f = reader({ reliancedigital: function () { return new Promise(function () {}); } });
  out = await R.runAll(api, O({ fetchRead: f })); by = {}; out.runs.forEach(function (r) { by[r.key] = r; });
  ck('3a hang: one try only, fallback timeout', f.calls.reliancedigital === 1 && by.reliancedigital.fetchFallback === 'timeout' && by.reliancedigital.fetchTries === 1, by.reliancedigital);
  api = mockApi(); f = reader({ reliancedigital: function () { return Promise.resolve({ cards: [] }); } });
  out = await R.runAll(api, O({ fetchRead: f, fetchRetry: false }));
  ck('3b fetchRetry false: one try', f.calls.reliancedigital === 1);
  // 4 priority: fallback store goes before tab-only stores that are still waiting
  api = mockApi(); f = reader({ reliancedigital: function () { return Promise.resolve(null); } });
  out = await R.runAll(api, O({ fetchRead: f }));
  var order = api.created.map(function (c) { return /ajio/.test(c.url) ? 'ajio' : /meesho/.test(c.url) ? 'meesho' : /tatacliq/.test(c.url) ? 'tata' : /reliancedigital/.test(c.url) ? 'reliance' : '?'; });
  ck('4a first tab is a tab-only store (it started at once), then Reliance BEFORE the other two', order.length === 4 && order[1] === 'reliance' && order.indexOf('reliance') < order.lastIndexOf('meesho') + 1 && order[0] !== 'reliance', order);
  // 5 deadline: after the deadline no retry
  api = mockApi(); f = reader({ reliancedigital: function () { return Promise.resolve({ cards: [] }); } });
  out = await R.runAll(api, O({ fetchRead: f, deadlineAt: Date.now() - 1 }));
  ck('5 after the deadline no second fetch', f.calls.reliancedigital === 1);
  // 6 fetchread diagnostics
  var longHtml = '<html><body>' + 'x'.repeat(1200) + ' Robot check please verify</body></html>';
  var rd = FR.make(function (u) { return Promise.resolve({ status: 200, url: u, text: function () { return Promise.resolve(longHtml); } }); }, function () { return { cards: [] }; });
  var st = { key: 'reliancedigital', url: function (q) { return 'https://www.reliancedigital.in/search?q=' + q; } };
  await rd(st, 'a');
  ck('6a diag: http 200, bytes, head, robot, cards 0', rd.last.reliancedigital.http === 200 && rd.last.reliancedigital.bytes === longHtml.length && rd.last.reliancedigital.head.length > 0 && rd.last.reliancedigital.head.length <= 60 && rd.last.reliancedigital.robot === true && rd.last.reliancedigital.cards === 0, rd.last);
  var rd2 = FR.make(function (u) { return Promise.resolve({ status: 403, url: u, text: function () { return Promise.resolve(''); } }); }, function () { return null; });
  var r2 = await rd2(st, 'a'); ck('6b 403: null and http 403 kept', r2 === null && rd2.last.reliancedigital.http === 403);
  // 7 wiring in app.js and copies
  var app = fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8');
  ck('7a app.js passes fetchDiag and writes ft, fd, fd1 into the STORES part', /o1\.fetchDiag = /.test(app) && /ft: r\.fetchTries/.test(app) && /fd: r\.fetchDiag/.test(app) && /fd1: r\.fetchDiag1/.test(app));
  ck('7b extension copies are identical', fs.readFileSync(path.join(__dirname, '..', 'extension', 'runner_core.js'), 'utf8') === fs.readFileSync(path.join(__dirname, 'www', 'runner_core.js'), 'utf8') && fs.readFileSync(path.join(__dirname, '..', 'extension', 'fetchread.js'), 'utf8') === fs.readFileSync(path.join(__dirname, 'www', 'fetchread.js'), 'utf8'));
  console.log('test_s23_9b: ' + pass + ' pass, ' + fail + ' fail'); process.exit(fail ? 1 : 0);
})();
