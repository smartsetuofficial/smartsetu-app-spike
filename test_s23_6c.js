/* S23-6c offline test. Run: node test_s23_6c.js (from code/app-spike).
 * 1. Invariant on saved snapshots x queries: a store line never counts rows the screen does not draw, and a screen is never empty while a line says "matching".
 * 2. generic 1.1.2 draws cluster members. 3. Store line texts. 4. Time cap: after the deadline no store tab is opened. 5. Wiring in app.js (the phone values are NOT measured). */
'use strict';
var fs = require('fs'), path = require('path');
require('./www/bundle.js');
var U = require('./src/uihelp.js'), SS = SmartSetu, R = require('./www/runner_core.js'), V = require('./www/view.js');
var FX = path.join(__dirname, '..', '..', 'tests', 'fixtures'), pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d)); } }
var sets = [];
fs.readdirSync(FX).filter(function (f) { return /^snap_.*\.json$/.test(f); }).forEach(function (f) {
  try { var s = JSON.parse(fs.readFileSync(path.join(FX, f), 'utf8')).snapshots.map(function (x) { return x.snapshot || x; }); if (s.length) sets.push({ f: f, s: s }); } catch (e) { /* not a snapshot file */ }
});
var QS = ['samsung smartphones', 'apple smartphones', 'iphone 17 pro', 'smartphones under 10000', 'lakme lipstick', 'lakme', 'red tape shoes for women', 'shoes under 1000', 'boat headphones', 'nike shoes', 'samsung', 'dog food', 'boat airdopes 141', 'apple iphone', 'lipstick', 'headphones'];
var cases = 0, lineNoRows = 0, emptyWithLine = 0, closeNoRows = 0, usedClusterRows = 0;
sets.forEach(function (x) { QS.forEach(function (q) {
  var res = SS.compareAny({ query: q, searches: x.s, products: [], seenAt: 'T' });
  var runs = Object.keys(res.storeStatus || {}).map(function (k) { return { key: k, store: k, state: res.storeStatus[k] === 'ok' ? 'ok' : 'bad' }; });
  var v = V.buildView(res, runs, 'T'), rel = U.relevantByStore(res), cl = U.closeByStore(res);
  if (!rel) return; cases++;
  var shown = {}; v.groups.forEach(function (g) { g.rows.forEach(function (r) { shown[r.store] = (shown[r.store] || 0) + 1; }); });
  var any = false, tot = 0;
  Object.keys(rel).forEach(function (k) {
    var sc = shown[V.storeName(k)] || 0; if (sc > 0) any = true; tot += rel[k];
    if (rel[k] > 0 && sc === 0) lineNoRows++;
    if (!(rel[k] > 0) && cl[k] > 0 && sc === 0) closeNoRows++;
  });
  if (tot > 0 && !any) emptyWithLine++;
  if (res.similar && res.similar.mode === 'similar_products' && res.clusters.length) usedClusterRows++;
}); });
ck('1a ran on many cases (>= 150)', cases >= 150, cases);
ck('1b a store line with "matching" always has rows on screen (0 cases)', lineNoRows === 0, lineNoRows);
ck('1c screen never empty while a line says matching (0 cases)', emptyWithLine === 0, emptyWithLine);
ck('1d a "close matches" line always has rows on screen (0 cases)', closeNoRows === 0, closeNoRows);
ck('1e cluster-using brand queries exist in the data (test is not vacuous)', usedClusterRows > 0, usedClusterRows);

// 2 generic draws cluster members
var G = SS.similar; var fake = { query: { models: [], brand: { key: 'x' } }, quarantine: [], clusters: [{ members: [
  { store: 'amazon', title: 'a one', url: 'https://x/1', pricePaise: 100, tier: 3, miss: false, availability: 'unknown' },
  { store: 'amazon', title: 'a two', url: 'https://x/2', pricePaise: 200, tier: 2, miss: false },
  { store: 'flipkart', title: 'f close', url: 'https://x/3', pricePaise: 300, tier: 2, miss: true }] }] };
var g = G(fake);
ck('2a exact cluster member is drawn, tier 2 without miss is not', g.stores.filter(function (s) { return s.store === 'amazon'; })[0].items.length === 1, g);
ck('2b tier 2 with miss is a close match', g.stores.filter(function (s) { return s.store === 'flipkart'; })[0].close.length === 1, g);
ck('2c specific query (model and brand) still has no generic block', G({ query: { models: ['141'], brand: { key: 'b' } }, clusters: fake.clusters, quarantine: [] }).mode === 'specific', 0);
ck('2d generic version 1.1.3', require('../compare-engine/generic.js').version === '1.1.3', 0);

// 3 store line texts
ck('3a line: matching', U.relevanceLine(3, 0).text === '3 matching listings', 0);
ck('3b line: only close matches', U.relevanceLine(0, 2).text === '2 close matches' && U.relevanceLine(0, 1).text === '1 close match' && U.relevanceLine(0, 2).kind === 'ok', 0);
ck('3c line: nothing', U.relevanceLine(0, 0).text === 'No matching products' && U.relevanceLine(0).kind === 'skip', 0);
ck('3d skipped state is final and has its own line', U.isFinal('skipped') && U.shortLine({ state: 'skipped', key: 'croma' }, '').text === 'Skipped to keep it fast' && V.buildView({ query: {} }, [{ store: 'Croma', state: 'skipped' }], 'T').stores[0].text === 'Skipped to keep it fast', 0);
var spec = { storeStatus: { amazon: 'ok' }, similar: { mode: 'specific', stores: [] }, clusters: [{ queryMatch: false, members: [{ store: 'amazon' }] }, { queryMatch: true, members: [{ store: 'amazon' }, { store: 'amazon' }] }] };
ck('3e specific search counts only clusters the screen draws', U.relevantByStore(spec).amazon === 2, U.relevantByStore(spec));

// 4 time cap in the runner (both copies identical)
var A = fs.readFileSync(path.join(__dirname, 'www', 'runner_core.js'), 'utf8'), B = fs.readFileSync(path.join(__dirname, '..', 'extension', 'runner_core.js'), 'utf8');
ck('4a both runner_core copies are identical', A === B, 0);
var opened = 0, api = { tabs: new Proxy({}, { get: function () { opened++; return function () { return Promise.reject(new Error('no tab expected')); }; } }) };
var done = [];
R.runAll(api, { query: 'x', collect: function () {}, enabled: {}, deadlineAt: Date.now() - 1, perStoreMs: 50, maxTabs: 1, retryTimeouts: false, onUpdate: function (r) { done.push(r.state); } }).then(function (out) {
  ck('4b after the deadline no tab is opened and every store is skipped', opened === 0 && out.runs.length === R.STORES.length && out.runs.every(function (r) { return r.state === 'skipped'; }), { opened: opened, states: out.runs.map(function (r) { return r.state; }) });
  ck('4c skipped runs carry doneAt', out.runs.every(function (r) { return typeof r.doneAt === 'number'; }), 0);
  wiring();
}, function (e) { ck('4b runAll after the deadline did not throw', false, String(e)); wiring(); });

function wiring() {
  var app = fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8');
  ck('5a time cap values in one line: 20 s per store, 30 s gate', /STORE_MS = 20000, GATE_MS = 30000/.test(app) && /perStoreMs: STORE_MS, deadlineAt: live\.t0 \+ GATE_MS/.test(app), 0);
  ck('5b the old 100 s late gate and the 50 s store budget are gone', !/> 100000/.test(app) && !/perStoreMs: 50000/.test(app), 0);
  ck('5c Myntra, Croma and the second try are gated by late()', /pl\.enabled\.Myntra && late\(\)/.test(app) && /pl\.enabled\.Croma && late\(\)/.test(app) && /var bad = late\(\) \? \[\]/.test(app), 0);
  ck('5d report line has every store (state, stage, seconds, fallback)', /lastStores = \(out\.runs/.test(app) && /STORES /.test(app) && /storesDiag\(\)/.test(app), 0);
  ck('5e version 0.10.26', /VERSION = '0\.10\.26'/.test(app) && JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version === '0.10.26', 0);
  ck('5f paintRelevance passes the close count', /U\.closeByStore\(res\)/.test(app) && /U\.relevanceLine\(rel\[run\.key\], cls\[run\.key\] \|\| 0\)/.test(app), 0);
  console.log('test_s23_6c: ' + pass + ' pass, ' + fail + ' fail'); process.exit(fail ? 1 : 0);
}
