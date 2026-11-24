/* app-spike / test_s23_10b v1.0.0 (S23-10 item b, D-149). Run: node test_s23_10b.js
 * Problem (owner report 0.10.24): Flipkart real phones the AI confirmed were drawn under "close matches / No exact match here" for a generic query.
 * Fix under test: a card the AI confirmed (tier 2, miss, ai) is a NORMAL row of its store in similar mode; still no best price, no cluster change.
 * Uses the real saved titles of tests/fixtures/snap_iphone17pro_2026-11-05.json and a FAKE labeller (same as test_s23_5). */
'use strict';
var fs = require('fs'), path = require('path');
var CODE = path.join(__dirname, '..');
var G = require(path.join(CODE, 'compare-engine', 'generic.js')), V = require(path.join(CODE, 'extension', 'view.js'));
var SNAPS = JSON.parse(fs.readFileSync(path.join(CODE, '..', 'tests', 'fixtures', 'snap_iphone17pro_2026-11-05.json'), 'utf8')).snapshots, S = SNAPS.map(function (x) { return x.snapshot; });
var RUNS = SNAPS.map(function (x) { return { store: x.store, status: 'ok', count: 24 }; });
var pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d)); } }
function fakeLabel(t) { return /(iphone|galaxy|redmi|oneplus|samsung|apple)/i.test(t) && !/(charg|case|cover|kurta|bangle|protector|glass)/i.test(t) ? 'P' : 'A'; }
var labels = {};
function hooks() { return { isA: function (t) { return labels[t] === 'A'; }, isP: function (t) { return labels[t] === 'P'; } }; }
function build(q, ai) { var r = G.compareAny({ query: q, searches: S, seenAt: 'T', ai: ai }); return { res: r, view: V.buildView(r, RUNS, '2026-11-05T10:00:00Z') }; }
function closeGroups(view) { return (view.groups || []).filter(function (g) { return /close matches/i.test(g.title); }); }
var h0 = build('smartphones', { isA: function () { return false; }, isP: function () { return false; } });
Object.keys(h0.res.aiInfo.unsure).forEach(function (s) { h0.res.aiInfo.unsure[s].forEach(function (t) { labels[t] = fakeLabel(t); }); });
var b0 = build('smartphones'), b1 = build('smartphones', hooks());
var fk = (b1.res.similar.stores.filter(function (s) { return s.store === 'flipkart'; })[0]) || {};
ck('1 AI confirmed Flipkart phones are normal rows (items), not close', fk.total >= 5 && fk.items && fk.items.length >= 5 && (!fk.close || fk.close.length === 0), [fk.total, fk.close && fk.close.length]);
ck('2 no "close matches" group for Flipkart on screen', !closeGroups(b1.view).some(function (g) { return /flipkart/i.test(g.title); }), closeGroups(b1.view).map(function (g) { return g.title; }));
var fkg = b1.view.groups.filter(function (g) { return /^flipkart$/i.test(g.title); })[0];
ck('3 Flipkart group note says Showing N of M, not "No exact match here"', fkg && /^Showing /.test(fkg.note), fkg && fkg.note);
ck('4 still similar mode, no best price claim, no label on any group', b1.res.similar.label === 'similar_not_same' && b1.view.groups.every(function (g) { return g.label === null || g.label === undefined; }) && !b1.view.pick, b1.view.mode);
ck('5 clusters (exact, lowest price) unchanged by the AI rescue', JSON.stringify(b1.res.clusters) === JSON.stringify(b0.res.clusters), 0);
ck('6 without ai nothing changes: no ai field anywhere in quarantine', (b0.res.quarantine || []).every(function (x) { return !('ai' in x); }), 0);
ck('7 ai flag only on rescued cards', (b1.res.quarantine || []).filter(function (x) { return x.ai; }).every(function (x) { return x.tier === 2 && x.miss === true; }), 0);
// plain tier 2 miss without ai stays a close match
var Q = { query: { cat: 'x' }, quarantine: [{ store: 'a', title: 'T1', url: 'u1', pricePaise: 100000, tier: 2, miss: true, reason: 'no_model_token' }, { store: 'a', title: 'T2', url: 'u2', pricePaise: 90000, tier: 2, miss: true, ai: true, reason: 'no_model_token' }], clusters: [] };
var sim = G.similar(Q), sa = sim.stores[0];
ck('8 synthetic: ai row is an item, non-ai tier 2 miss stays close', sa.items.length === 1 && sa.items[0].title === 'T2' && sa.close.length === 1 && sa.close[0].title === 'T1', sa);
console.log('test_s23_10b: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
