/* app-spike / test_s23_5 v1.0.0 (S23-5, D-137). Run: node test_s23_5.js
 * Flipkart-style titles ('Apple iPhone 17 Pro (Silver, 256 GB)') never name the type, so the word checks hid them (owner report 20 Nov 2026: Flipkart 0 matching products).
 * Fix under test: the AI answer P ('this title is the searched product') lets the engine confirm a card whose HARD checks passed, only as a CLOSE match; the app asks the AI about exactly those cards.
 * The labels here come from a FAKE labeller written in this test (not the real model): real titles of tests/fixtures/snap_iphone17pro_2026-11-05.json, hand rule for P and A. */
'use strict';
var fs = require('fs'), path = require('path');
var CODE = path.join(__dirname, '..');
var Q = require(path.join(CODE, 'query-engine', 'query_engine.js')), G = require(path.join(CODE, 'compare-engine', 'generic.js')), V = require(path.join(CODE, 'extension', 'view.js'));
var AF = require('./src/aiflow.js');
var SNAPS = JSON.parse(fs.readFileSync(path.join(CODE, '..', 'tests', 'fixtures', 'snap_iphone17pro_2026-11-05.json'), 'utf8')).snapshots, S = SNAPS.map(function (x) { return x.snapshot; });
var RUNS = SNAPS.map(function (x) { return { store: x.store, status: 'ok', count: 24 }; });
var pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d)); } }
// FAKE labeller (test only): phones P, everything else A
function fakeLabel(t) { return /(iphone|galaxy|redmi|oneplus|samsung|apple)/i.test(t) && !/(charg|case|cover|kurta|bangle|protector|glass)/i.test(t) ? 'P' : 'A'; }
function hooks(labels) { return { isA: function (t) { return labels[t] === 'A'; }, isP: function (t) { return labels[t] === 'P'; } }; }
function build(q, ai) { var r = G.compareAny({ query: q, searches: S, seenAt: 'T', ai: ai }); return { res: r, view: V.buildView(r, RUNS, '2026-11-05T10:00:00Z') }; }
function byStore(view) { var o = {}; ((view && view.groups) || []).forEach(function (g) { (g.rows || []).forEach(function (x) { var k = String(x.store).toLowerCase(); o[k] = (o[k] || 0) + 1; }); }); if (view && view.top) (view.top.rows || []).forEach(function (x) { var k = String(x.store).toLowerCase(); o[k] = (o[k] || 0) + 1; }); return o; }

// 1 the real problem, on the real saved titles
var plain = build('smartsetu phones');
var b0 = build('smartphones'), sh0 = byStore(b0.view);
ck('1a before: Flipkart and Reliance show nothing for smartphones (the owner report)', !sh0.flipkart && !sh0['reliance digital'], sh0);
var un0 = b0.res.aiInfo === undefined; ck('1b no ai passed = no ai info (unchanged shape)', un0, Object.keys(b0.res));
var h0 = build('smartphones', { isA: function () { return false; }, isP: function () { return false; } });
ck('1c empty hook: same screen as before, and the unsure list names the Flipkart and Reliance titles', JSON.stringify(byStore(h0.view)) === JSON.stringify(sh0) && h0.res.aiInfo.unsure.flipkart.length >= 20 && h0.res.aiInfo.unsure.reliancedigital.length >= 6 && h0.res.aiInfo.rescued === 0, h0.res.aiInfo && Object.keys(h0.res.aiInfo.unsure));
var all = {}; Object.keys(h0.res.aiInfo.unsure).forEach(function (s) { h0.res.aiInfo.unsure[s].forEach(function (t) { all[t] = fakeLabel(t); }); }); (function () { var sT = AF.shownTitles(h0.view, 400); sT.forEach(function (t) { all[t] = fakeLabel(t); }); })();
var b1 = build('smartphones', hooks(all)), sh1 = byStore(b1.view);
ck('1d after the AI said P: Flipkart and Reliance Digital now show their phones', sh1.flipkart >= 5 && sh1['reliance digital'] >= 5, sh1);
ck('1e rescued cards are close matches only: lowest price claim and exact groups are the same as before', JSON.stringify(b1.res.clusters) === JSON.stringify(b0.res.clusters) && b1.res.aiInfo.rescued > 0, [b1.res.aiInfo.rescued]);
ck('1f the junk the fake AI called A (kurtas, bangles) is not shown', !JSON.stringify(b1.view).match(/Kurta Set|Bangle/), 0);
ck('1g a card is never both rescued and left in the unsure list', (function () { var un = b1.res.aiInfo.unsure, rescuedTitles = 0; Object.keys(un).forEach(function (s) { un[s].forEach(function (t) { if (all[t] === 'P') rescuedTitles++; }); }); return rescuedTitles === 0 || b1.res.aiInfo.rescued >= 12; })(), b1.res.aiInfo.rescued);

// 2 hard checks stay (rule tests on made-up titles)
function card(t, p) { return { title: t, link: '', priceNum: p }; }
var pool = function () { return { Amazon: [card('Redmi 13C 5G Mobile 6GB RAM 128GB Storage', 8999), card('Samsung Galaxy M05 4G Mobile 4GB RAM 64GB Storage', 6999), card('realme C61 Smartphone 6GB RAM 128GB', 7499)], Flipkart: [card('Samsung Galaxy A06 (Black, 64 GB)', 6999), card('Redmi A4 (Starry Blue, 128 GB)', 8499), card('Redmi A4 Back Cover Case (Black)', 299), card('Apple iPhone 17 Pro (Silver, 256 GB)', 134900), card('Samsung 55 inch 4K Smart TV (Black)', 41999)] }; };
var P_ALL = { isA: function () { return false; }, isP: function () { return true; } }, NONE = { isA: function () { return false; }, isP: function () { return false; } };
function shownT(r) { var o = []; Object.keys(r.stores).forEach(function (s) { [3, 2].forEach(function (k) { r.stores[s][k].forEach(function (c) { o.push(s + ':' + c.title); }); }); }); return o; }
var r0 = Q.rank('smartphones under 10000', pool(), undefined, undefined, { ai: NONE }), rP = Q.rank('smartphones under 10000', pool(), undefined, undefined, { ai: P_ALL });
ck('2a without P the Flipkart titles stay hidden', !shownT(r0).some(function (x) { return x.indexOf('Flipkart:') === 0; }), shownT(r0));
ck('2b with P: Samsung A06 and Redmi A4 shown', shownT(rP).indexOf('Flipkart:Samsung Galaxy A06 (Black, 64 GB)') >= 0 && shownT(rP).indexOf('Flipkart:Redmi A4 (Starry Blue, 128 GB)') >= 0, shownT(rP));
ck('2c price cap holds even when the AI says P (iPhone 134900 stays out)', !shownT(rP).some(function (x) { return x.indexOf('iPhone') >= 0; }), shownT(rP));
ck('2d accessory check holds even when the AI says P (Back Cover Case stays out)', !shownT(rP).some(function (x) { return x.indexOf('Back Cover') >= 0; }), shownT(rP));
ck('2e a card with another brand than the query brand stays out even when the AI says P', (function () { var r = Q.rank('samsung phone under 10000', pool(), undefined, undefined, { ai: P_ALL }); return !shownT(r).some(function (x) { return x.indexOf('Redmi A4 (') >= 0; }) && shownT(r).indexOf('Flipkart:Samsung Galaxy A06 (Black, 64 GB)') >= 0; })(), 0);
ck('2f rescued cards are tier 2 (close), marked miss, never tier 3', (function () { var c = rP.stores.Flipkart[2].filter(function (x) { return x.title.indexOf('Galaxy A06') >= 0; })[0]; return !!c && c.miss === true && !rP.stores.Flipkart[3].some(function (x) { return x.title.indexOf('Galaxy A06') >= 0; }); })(), 0);
ck('2g isP throws = card stays hidden; only exactly true counts', (function () { var t = Q.rank('smartphones under 10000', pool(), undefined, undefined, { ai: { isA: function () { return false; }, isP: function () { throw new Error('x'); } } }); var s = Q.rank('smartphones under 10000', pool(), undefined, undefined, { ai: { isA: function () { return false; }, isP: function () { return 'P'; } } }); return !shownT(t).some(function (x) { return x.indexOf('Flipkart:') === 0; }) && !shownT(s).some(function (x) { return x.indexOf('Flipkart:') === 0; }); })(), 0);
ck('2h the AI A drops a card even if it would rank', (function () { var r = Q.rank('smartphones under 10000', pool(), undefined, undefined, { ai: { isA: function (t) { return t.indexOf('Redmi 13C') >= 0; }, isP: function () { return true; } } }); return !shownT(r).some(function (x) { return x.indexOf('Redmi 13C') >= 0; }); })(), 0);
ck('2i per store at most 12 rescued', (function () { var p = { Amazon: [card('Redmi 13C 5G Mobile 6GB RAM 128GB Storage', 8999), card('Samsung Galaxy M05 4G Mobile 4GB RAM 64GB Storage', 6999)], Flipkart: [] }; for (var i = 0; i < 20; i++) p.Flipkart.push(card('Samsung Galaxy A' + (10 + i) + ' (Black, 64 GB)', 7000 + i)); var r = Q.rank('smartphones under 10000', p, undefined, undefined, { ai: P_ALL }); return r.ai.rescued === 12; })(), 0);
ck('2j a different kind of product works the same (laptop titles that never say laptop; the AI A removes an accessory the word checks let through)', (function () { var p = { Amazon: [card('Zorbo Laptop 15 Intel Core i3 8GB RAM 512GB SSD', 34990), card('Zorbo Laptop 14 Intel Core i5 16GB RAM 512GB SSD', 48990)], Flipkart: [card('Zorbo X15 Intel Core i3 12th Gen (8 GB/512 GB SSD/Windows 11 Home)', 33990), card('Zorbo Laptop Bag Sleeve 15.6 inch', 499)] }; var lab = { isA: function (t) { return t.indexOf('Laptop Bag') >= 0; }, isP: function (t) { return t.indexOf('Zorbo X15 Intel') >= 0; } }; var a = Q.rank('laptop under 40000', p, undefined, undefined, { ai: NONE }), b = Q.rank('laptop under 40000', p, undefined, undefined, { ai: lab }); return shownT(a).indexOf('Flipkart:Zorbo X15 Intel Core i3 12th Gen (8 GB/512 GB SSD/Windows 11 Home)') < 0 && shownT(b).indexOf('Flipkart:Zorbo X15 Intel Core i3 12th Gen (8 GB/512 GB SSD/Windows 11 Home)') >= 0 && b.ai.rescued === 1 && shownT(b).join('|').indexOf('Laptop Bag') < 0; })(), 0);

// 3 the app flow: askTitles and refine against the real fixture, with a fake worker
ck('3a askTitles: unsure titles first, one store after the other, then the screen, no duplicates', (function () { var res = { aiInfo: { unsure: { a: ['a1', 'a2', 'a3'], b: ['b1', 'b2'] } } }, view = { groups: [{ rows: [{ title: 's1' }, { title: 'a1' }] }] }; var o = AF.askTitles(res, view, 100); return JSON.stringify(o) === JSON.stringify(['a1', 'b1', 'a2', 'b2', 'a3', 's1']); })(), 0);
ck('3b askTitles without unsure info = the cards on screen, as before', JSON.stringify(AF.askTitles({}, { groups: [{ rows: [{ title: 'x' }, { title: 'y' }] }] }, 10)) === JSON.stringify(['x', 'y']), 0);
ck('3c askTitles cap', AF.askTitles({ aiInfo: { unsure: { a: ['1', '2', '3', '4'] } } }, null, 2).length === 2, 0);
var posts = [], worker = function (url, body) { posts.push(body); if (body.action === 'classify') return Promise.resolve({ ok: true, labels: body.titles.map(fakeLabel) }); return Promise.resolve({ ok: false, reason: 'no' }); };
var aix = AF.make({ url: 'https://example.invalid/ai', post: worker, now: Date.now }), hook = null;
var cur = build('smartphones', { isA: function () { return false; }, isP: function () { return false; } });
function rebuild() { return build('smartphones', hook); }
(async function () {
  var rf = await aix.refine('smartphones', cur, rebuild, function () { return false; }, function (a, p) { hook = { isA: a, isP: p }; });
  ck('3d refine: the first call carries the Flipkart and Reliance titles, at most 45', posts.length >= 1 && posts[0].titles.length <= 45 && posts[0].titles.some(function (t) { return /^Apple iPhone 17 Pro \(Silver, 256 GB\)$/.test(t); }) && posts[0].titles.some(function (t) { return /^Apple iPhone 17 Pro 256 GB, Deep Blue$/.test(t); }), posts[0] && posts[0].titles.length);
  ck('3e refine: at most 2 calls', posts.length <= 2, posts.length);
  var sh = byStore(rf.next && rf.next.view);
  ck('3f refine returns a new screen where Flipkart and Reliance Digital have phones', !!rf.next && sh.flipkart >= 5 && sh['reliance digital'] >= 5 && rf.info.rescued > 0, [sh, rf.info]);
  ck('3g titles the AI called A are not on that screen', !JSON.stringify(rf.next.view).match(/Kurta Set|Bangle/), 0);
  // a Worker problem: old behaviour (no new screen)
  var bad = AF.make({ url: 'https://example.invalid/ai', post: function () { return Promise.reject(new Error('x')); }, now: Date.now }), hk2 = null;
  var rf2 = await bad.refine('smartphones', cur, function () { return build('smartphones', hk2); }, function () { return false; }, function (a, p) { hk2 = { isA: a, isP: p }; });
  ck('3h Worker error: no new screen, nothing changes', rf2.next === null, rf2.info);
  // only rescued, nothing dropped: the screen must still be drawn again
  var allP = AF.make({ url: 'https://example.invalid/ai', post: function (u, body) { return Promise.resolve({ ok: true, labels: body.titles.map(function () { return 'P'; }) }); }, now: Date.now }), hk3 = null;
  var rf3 = await allP.refine('smartphones', cur, function () { return build('smartphones', hk3); }, function () { return false; }, function (a, p) { hk3 = { isA: a, isP: p }; });
  ck('3k nothing dropped but cards rescued: a new screen is returned', rf3.info.dropped === 0 && rf3.info.rescued > 0 && rf3.next !== null, rf3.info);
  // source checks of the wiring in app.js
  var app = fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8');
  ck('3i app.js: hook with isP set after the rewrite and again after each classify', /aiLabels = \{ isA: AIX\.isAFor\(aiR\.search\), isP: AIX\.isPFor\(aiR\.search\) \}/.test(app) && /function \(f, p\) \{ aiLabels = \{ isA: f, isP: p \}; \}/.test(app), 0);
  ck('3j app.js keeps the old pins (seenAt: seenAt, sem: sem and q === live.q)', app.indexOf('seenAt: seenAt, sem: sem })') > 0 && app.indexOf('q === live.q') > 0, 0);
  console.log('test_s23_5: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
