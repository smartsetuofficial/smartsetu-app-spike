/* app-spike / test_s23_13 v1.0.0 (S23-13; D-158, V-599). Run: node test_s23_13.js
 * 2nd Full Test (V-599 source): Amazon read 0 of 11 as no_results in 2.9 s after S23-11a. Fix: a blank fetched page is NOT "no results" (it goes to the tab as before); only a page that says so is.
 * Also: one pool of tab slots (MAX_TABS = 2), Myntra and Croma start at once, and every page load / answer belongs to its own hidden page (the plugin names the page, V-599). */
'use strict';
var fs = require('fs'), path = require('path');
var R = require('./www/runner_core.js'), W = require('./src/webtabs.js'), FR = require('./www/fetchread.js');
var pass = 0, fail = 0;
function ck(n, c, x) { if (c) pass++; else { fail++; console.log('FAIL ' + n + (x ? ' ' + JSON.stringify(x) : '')); } }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
var FILL = '<!-- ' + new Array(1200).join('x') + ' -->';
function page(body, scripts) { return '<html><head><title>t</title>' + (scripts || '') + '</head><body>' + body + FILL + '</body></html>'; }
function fakeFetch(html, finalUrl, status) { return function (u) { return Promise.resolve({ status: status == null ? 200 : status, url: finalUrl || u, text: function () { return Promise.resolve(html); } }); }; }
function snapNone() { return { cards: [], url: 'x', kind: 'search' }; }
var AZ = R.STORES.filter(function (s) { return s.key === 'amazon'; })[0], RD = R.STORES.filter(function (s) { return s.key === 'reliancedigital'; })[0];

(async function () {
  // 1 fetchread: the page itself says "no results"
  var a = FR.make(fakeFetch(page('<h1>Amazon</h1><div>Results will load</div>')), snapNone), r1 = await a(AZ, 'iphone');
  ck('1a blank 200 page with 0 cards: nr false (the Amazon case)', a.last.amazon.http === 200 && a.last.amazon.cards === 0 && a.last.amazon.nr === false && a.last.amazon.bytes >= 1000, a.last.amazon);
  var b = FR.make(fakeFetch(page('<div class="x">No results for iphone 99. Try checking your spelling.</div>')), snapNone); await b(AZ, 'iphone 99');
  ck('1b visible words "No results for" : nr true, why text', b.last.amazon.nr === true && b.last.amazon.nrWhy === 'text', b.last.amazon);
  var c = FR.make(fakeFetch(page('<div>Loading</div>', '<script>var m = "no results";</script><style>.no-results{}</style>')), snapNone); await c(AZ, 'x');
  ck('1c the words only inside script or style do not count', c.last.amazon.nr === false, c.last.amazon);
  var d = FR.make(fakeFetch(page('<div>Search</div>'), 'https://www.reliancedigital.in/c/no-search-results/?q=x'), snapNone); await d(RD, 'smartphones under 10000');
  ck('1d Reliance no-search-results address: nr true, why url (V-337)', d.last.reliancedigital.nr === true && d.last.reliancedigital.nrWhy === 'url', d.last.reliancedigital);
  var e = FR.make(fakeFetch(page('<div>No results anywhere? no, we have many products</div>')), function () { return { cards: [{ link: 'a' }], url: 'x' }; }); await e(AZ, 'x');
  ck('1e a page with cards is never marked (nr false)', e.last.amazon.cards === 1 && e.last.amazon.nr === false, e.last.amazon);
  var f = FR.make(fakeFetch(page('<div>Please verify you are human. No results</div>')), snapNone); await f(AZ, 'x');
  ck('1f robot words still win: robot true', f.last.amazon.robot === true && R.emptyPageIsNoResults(f.last.amazon) === false, f.last.amazon);
  ck('1g emptyPageIsNoResults needs nr', R.emptyPageIsNoResults({ http: 200, bytes: 90000, robot: false, cards: 0, nr: true }) === true && R.emptyPageIsNoResults({ http: 200, bytes: 90000, robot: false, cards: 0 }) === false && R.emptyPageIsNoResults({ http: 200, bytes: 90000, robot: false, cards: 0, nr: false }) === false);

  // 2 runAll with the real fetchread: blank = tab fallback (Amazon is read again), says no results = no tab
  function api2() { var s = { created: [] }; s.tabs = { create: function (o) { var id = s.created.length + 1; s.created.push({ id: id, url: o.url }); return Promise.resolve({ id: id }); }, remove: function () { return Promise.resolve(); }, get: function () { return Promise.resolve({ status: 'complete' }); }, onUpdated: { addListener: function () {}, removeListener: function () {} } }; s.scripting = { executeScript: function (o) { var u = s.created.filter(function (x) { return x.id === o.target.tabId; })[0].url; return Promise.resolve([{ result: { cards: [{ link: u }], url: u } }]); } }; return s; }
  function run2(fr, label) { var en = {}; R.STORES.forEach(function (s) { en[s.label] = s.label === label; }); var ap = api2(); return R.runAll(ap, { query: 'iphone 17 pro', collect: function () {}, settleMs: 0, loadMs: 60, rereads: 0, fetchFirst: ['amazon', 'reliancedigital'], fetchRead: fr, fetchDiag: function (s) { return fr.last[s.key] ? JSON.parse(JSON.stringify(fr.last[s.key])) : null; }, fetchMs: 200, fetchRetryWaitMs: 5, enabled: en, maxTabs: 1 }).then(function (o) { return { api: ap, out: o }; }); }
  var blank = FR.make(fakeFetch(page('<div>Results will load</div>')), snapNone), rb = await run2(blank, 'Amazon');
  var az = rb.out.runs.filter(function (x) { return x.key === 'amazon'; })[0];
  ck('2a Amazon blank page: opens the tab and reads cards (state ok, via tab), not no_results', rb.api.created.some(function (x) { return /amazon/.test(x.url); }) && az.state === 'ok' && !az.noResults && az.fetchFallback === 'no_cards', az);
  var says = FR.make(fakeFetch(page('<div>No results for iphone 17 pro</div>')), snapNone), rs = await run2(says, 'Amazon');
  var az2 = rs.out.runs.filter(function (x) { return x.key === 'amazon'; })[0];
  ck('2b page says no results: no tab, noResults, state no_cards', rs.api.created.length === 0 && az2.noResults === true && az2.state === 'no_cards', az2);

  // 3 slots
  var sl = R.makeSlots(2), cur = 0, max = 0;
  async function job(ms) { cur++; if (cur > max) max = cur; await sleep(ms); cur--; return ms; }
  await Promise.all([1, 2, 3, 4, 5].map(function (i) { return sl.run(1, function () { return job(15); }); }));
  ck('3a never more than 2 at once, all 5 jobs ran', max === 2 && cur === 0 && sl.active() === 0, [max, cur]);
  var order = [], sl2 = R.makeSlots(1);
  var hold = sl2.run(1, function () { return sleep(30); });
  var p1 = sl2.run(4, function () { order.push('lo'); }), p2 = sl2.run(1, function () { order.push('hi'); }), p3 = sl2.run(0, function () { order.push('first'); });
  await Promise.all([hold, p1, p2, p3]);
  ck('3b waiting jobs go by priority (0, then 1, then 4)', order.join() === 'first,hi,lo', order);
  var sl3 = R.makeSlots(1), thrown = false; try { await sl3.run(1, function () { throw new Error('x'); }); } catch (_) { thrown = true; }
  var ran = false; await sl3.run(1, function () { ran = true; });
  ck('3c a job that throws gives the slot back', thrown && ran && sl3.active() === 0);
  var s0 = R.makeSlots(0), n0 = 0; await Promise.all([1, 2, 3].map(function () { return s0.run(1, function () { n0++; return sleep(5); }); }));
  ck('3d makeSlots(0) = no limit, all 3 ran together', n0 === 3 && s0.active() === 0, n0);

  // 4 one shared pool for runAll AND an outside job (Myntra / Croma): max 2 open pages in total
  var live = 0, peak = 0, ap4 = api2(), pool = R.makeSlots(2);
  var oc = ap4.tabs.create, orm = ap4.tabs.remove;
  ap4.tabs.create = function (o) { live++; if (live > peak) peak = live; return oc(o); };
  ap4.tabs.remove = function (id) { live--; return orm(id); };
  var oe = ap4.scripting.executeScript; ap4.scripting.executeScript = function (o) { return sleep(12).then(function () { return oe(o); }); };
  var allOn = {}; R.STORES.forEach(function (s) { allOn[s.label] = true; });
  var outside = pool.run(1, function () { live++; if (live > peak) peak = live; return sleep(60).then(function () { live--; return 'my'; }); }); // the outside job (Myntra / Croma) also counts as an open page
  var o4 = await R.runAll(ap4, { query: 'x', collect: function () {}, settleMs: 0, loadMs: 60, rereads: 0, enabled: allOn, slots: pool, perStoreMs: 3000, retryTimeouts: false });
  await outside;
  ck('4a with a shared pool: 9 stores read, open pages never above 2, pool empty at the end', o4.runs.filter(function (x) { return x.state === 'ok'; }).length === 9 && peak === 2 && live === 0 && pool.active() === 0, [peak, live, pool.active()]);

  // 5 webtabs: each load belongs to its own page
  function plug() { var st = { n: 0, load: [], msg: [], codes: [], early: false }; st.api = { open: function () { var id = 'w' + (++st.n); if (st.early) st.load.forEach(function (f) { f({ id: id }); }); return Promise.resolve(id); }, exec: function (o) { st.codes.push(o.code); return Promise.resolve(); }, close: function () { return Promise.resolve(); }, onMessage: function (fn) { st.msg.push(fn); return Promise.resolve(function () {}); }, onLoaded: function (fn) { st.load.push(fn); return Promise.resolve(function () {}); } }; return st; }
  function fire(st, id) { st.load.forEach(function (f) { f(id == null ? undefined : { id: id }); }); }
  var p5 = plug(), w5 = W.createWebTabs(p5.api), heard = []; w5.tabs.onUpdated.addListener(function (id, i) { heard.push(id + ':' + i.status); });
  var ta = await w5.tabs.create({ url: 'https://a.example/', active: false }), tb = await w5.tabs.create({ url: 'https://b.example/', active: false });
  fire(p5, tb.id);
  ck('5a two pages in one object: the load of B does not complete A', heard.join() === tb.id + ':complete' && (await w5.tabs.get(ta.id)).status === 'loading' && (await w5.tabs.get(tb.id)).status === 'complete', heard);
  fire(p5, ta.id);
  ck('5b then the load of A completes A', heard.length === 2 && (await w5.tabs.get(ta.id)).status === 'complete', heard);
  var p6 = plug(), x1 = W.createWebTabs(p6.api), x2 = W.createWebTabs(p6.api), h1 = [], h2 = [];
  x1.tabs.onUpdated.addListener(function (id, i) { h1.push(id); }); x2.tabs.onUpdated.addListener(function (id, i) { h2.push(id); });
  var t1 = await x1.tabs.create({ url: 'https://a.example/' }), t2 = await x2.tabs.create({ url: 'https://b.example/' });
  fire(p6, t2.id);
  ck('5c two WebTabs objects: a load of the page of object 2 is not heard by object 1', h1.length === 0 && h2.join() === t2.id && (await x1.tabs.get(t1.id)).status === 'loading', [h1, h2]);
  var p7 = plug(); p7.early = true; var w7 = W.createWebTabs(p7.api), t7 = await w7.tabs.create({ url: 'https://a.example/' });
  ck('5d the load came before open() gave the id back: the page counts as complete', t7.status === 'complete' && (await w7.tabs.get(t7.id)).status === 'complete', t7);
  var p8 = plug(), w8 = W.createWebTabs(p8.api), h8 = []; w8.tabs.onUpdated.addListener(function (id, i) { h8.push(id); });
  var t8 = await w8.tabs.create({ url: 'https://a.example/' }); fire(p8, null);
  ck('5e a load event without an id (older plugin or Custom Tab) keeps the old behaviour', h8.join() === t8.id, h8);
  var p9 = plug(), y1 = W.createWebTabs(p9.api, { execMs: 30 }), y2 = W.createWebTabs(p9.api, { execMs: 30 });
  var ya = await y1.tabs.create({ url: 'https://a.example/' }), yb = await y2.tabs.create({ url: 'https://b.example/' });
  var q1 = y1.scripting.executeScript({ target: { tabId: ya.id }, func: function () { return 1; } }).catch(function () {}), q2 = y2.scripting.executeScript({ target: { tabId: yb.id }, func: function () { return 1; } }).catch(function () {});
  await sleep(10); var cids = p9.codes.map(function (cd) { return (cd.match(/var C = "([^"]+)"/) || [])[1]; });
  ck('5f the first answer id of two WebTabs objects differs (no mix-up)', cids.length === 2 && cids[0] && cids[1] && cids[0] !== cids[1], cids);
  await Promise.all([q1, q2]);

  // 6 app wiring (static) and shared copies
  var app = fs.readFileSync(path.join(__dirname, 'src/app.js'), 'utf8');
  ck('6a MAX_TABS = 2, GATE 50 s, one pool per search, opts use the pool', /MAX_TABS = 2/.test(app) && /GATE_MS = 50000/.test(app) && /var slots = R\.makeSlots\(MAX_TABS\)/.test(app) && /slots: slots/.test(app) && !/maxTabs: 1/.test(app), 0);
  var iH = app.indexOf('var hiDone'), iP = app.indexOf('out = await runStores(tabs, o1)');
  ck('6b Myntra and Croma start BEFORE the first pass is awaited and wait for a slot', iH > 0 && iH < iP && /slots\.run\(si < ord\.hi\.length \? 1 : 4, stepOf\[seq\[si\]\]\)/.test(app), [iH, iP]);
  ck('6c their results are merged into out after the other stages, skipped ones are not marked retried', /await hiDone;/.test(app) && /W\.mergeRuns\(out, \{ runs: hiRuns \}\)/.test(app) && /r\.state === 'skipped'\) r\.retried = false/.test(app), 0);
  ck('6d the old sequential loops are gone', !/await stepOf\[ord\.hi\[hi\]\]\(\)/.test(app) && !/await stepOf\[ord\.lo\[lo\]\]\(\)/.test(app), 0);
  var ext = path.join(__dirname, '..', 'extension');
  ck('6e runner_core and fetchread are byte-identical in app-spike/www and extension', ['runner_core.js', 'fetchread.js'].every(function (f) { return fs.readFileSync(path.join(__dirname, 'www', f), 'utf8') === fs.readFileSync(path.join(ext, f), 'utf8'); }), 0);
  var wt = fs.readFileSync(path.join(__dirname, 'src/webtabs.js'), 'utf8');
  ck('6f webtabs uses the id of the load event and a per object answer prefix', /lid = ev && ev\.id != null/.test(wt) && /'c' \+ inst \+ '_'/.test(wt), 0);
  ck('6g version 0.10.27', /VERSION = '0\.10\.27'/.test(app) && JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version === '0.10.27', 0);

  console.log('test_s23_13: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
