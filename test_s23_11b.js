/* app-spike / test_s23_11b v1.0.0 (S23-11b part 1, D-156, V-596). Run: node test_s23_11b.js
 * Full Test report additions: (6) why a store fell back to a tab and what the plain fetch saw, (7) 2 repeated titles and about 700 characters of one raw card for a search
 * where a store repeats titles above the limit, (8) the very long search runs with the AI on. Report only: no store reading changes. */
'use strict';
var fs = require('fs'), path = require('path');
var DS = require('./src/devsuite.js');
var pass = 0, fail = 0;
function ck(n, c, x) { if (c) pass++; else { fail++; console.log('FAIL ' + n + (x !== undefined ? ' ' + JSON.stringify(x) : '')); } }
var Q = DS.QUERIES, long = Q.filter(function (x) { return x.tag === 'very long'; })[0];
ck('1 the very long search has the AI on; 4 searches in all', long && long.ai === true && Q.filter(function (x) { return x.ai; }).length === 4, Q.filter(function (x) { return x.ai; }).map(function (x) { return x.tag; }));
var HTML = '<div class="card"><a href="https://shop.example/p/ABC123">' + 'x'.repeat(2000) + '</a></div>';
function snap(titles) { return { cards: titles.map(function (t, i) { return { html: i === 1 ? HTML : '<div id="c' + i + '">' + t + '</div>', link: 'https://shop.example/p/' + i }; }) }; }
function parseOf(titles) { return function () { return { cards: titles.map(function (t, i) { return { id: i === 1 ? 'ABC123' : 'c' + i, title: t, url: 'https://shop.example/p/' + i, priceNow: 100 }; }) }; }; }
var rep3 = ['Comfy bag', 'Comfy bag', 'Comfy bag', 'Other thing', 'Another thing'];
var a = DS.analyseRun({ snapshot: snap(rep3) }, parseOf(rep3), { on: '' });
ck('2a above the limit: 2 repeated titles kept', a.dups === 2 && a.dupTitles && a.dupTitles.length === 1 && a.dupTitles[0] === 'Comfy bag', a.dupTitles);
ck('2b about 700 characters of ONE raw card, the card the repeated title came from', typeof a.dupHtml === 'string' && a.dupHtml.length === 700 && a.dupHtml.indexOf('ABC123') > 0, a.dupHtml && a.dupHtml.length);
var two = ['A one', 'A one', 'B two', 'B two', 'C three', 'D four'];
var a2 = DS.analyseRun({ snapshot: snap(two) }, parseOf(two), { on: '' });
ck('2c two different repeated titles: both kept', a2.dupTitles && a2.dupTitles.join('|') === 'A one|B two', a2.dupTitles);
var fine = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8'];
var a3 = DS.analyseRun({ snapshot: snap(fine) }, parseOf(fine), { on: '' });
ck('2d at or below the limit: nothing kept (no memory used)', a3.dupTitles === undefined && a3.dupHtml === undefined, a3);
var one = ['x1', 'x1', 'y2', 'z3'];
ck('2e exactly 25 percent is not above the limit', DS.analyseRun({ snapshot: snap(one) }, parseOf(one), { on: '' }).dupTitles === undefined, 0);
var bad = DS.analyseRun({ snapshot: { cards: [] } }, function () { throw new Error('boom'); }, { on: '' });
ck('2f a parse error does not break the report numbers', bad.parseError === 'boom', bad);
// summarise keeps the fetch fields
var lines = [{ s: 'Reliance Digital', st: 'ok', ms: 21000, n: 12, via: 'tab', fb: 'no_cards', ft: 2, fd: { http: 200, bytes: 90210, robot: false, cards: 0, head: 'Search' }, fd1: { http: 200, bytes: 90210, robot: false, cards: 0 } }, { s: 'Amazon', st: 'ok', ms: 1400, n: 20, via: 'fetch', fb: null, ft: 1 }];
var s1 = DS.summarise(Q[2], { ms: 30000, stores: lines, runs: [], rows: [], ai: null }, function () { return { cards: [] }; });
var rl = s1.stores.filter(function (x) { return x.label === 'Reliance Digital'; })[0];
ck('3a fetch fallback reason, tries and both diagnostics are kept as short text', rl.fb === 'no_cards' && rl.ft === 2 && /"http":200/.test(rl.fd) && /"bytes":90210/.test(rl.fd1), rl);
var report = DS.buildReport({ version: 't', sums: [s1], queries: Q });
ck('3b the report says why Reliance went to a tab and what the fetch saw', /Reliance Digital \| ok [^\n]*\n    fetch fallback: no_cards \| tries 2 \| fetch saw \{"http":200,"bytes":90210,"robot":false,"cards":0,"head":"Search"\} \| first try saw/.test(report) && /finished via tab/.test(report), report.split('\n').slice(9, 14));
ck('3c a store that did not fall back gets no fallback line (one line only)', (report.match(/fetch fallback:/g) || []).length === 1, 0);
// PART 3
var st = { label: 'Meesho', state: 'ok', n: 20, parsed: 20, priced: 20, linked: 20, dups: 14, on: 0, off: 0, ms: 8000, dupTitles: ['Kids bag', 'Comfy'], dupHtml: '<div>sample</div>' };
var sA = { item: Q[8], ms: 1, error: null, ai: null, rows: [], rowCount: 0, stores: [st] }, sB = { item: Q[9], ms: 1, error: null, ai: null, rows: [], rowCount: 0, stores: [Object.assign({}, st, { dupTitles: ['later'], dupHtml: '<div>later</div>' })] };
var r2 = DS.buildReport({ version: 't', sums: [sA, sB], queries: Q });
ck('4a PART 3 lists the first search per store with the 2 titles and the card html', /PART 3: REPEATED TITLES ABOVE 25%/.test(r2) && /- Meesho \| search 9 \(kids school bag\) \| repeated titles: Kids bag \|\| Comfy\n    card html: <div>sample<\/div>/.test(r2) && !/later/.test(r2), r2.split('PART 3')[1]);
var r3 = DS.buildReport({ version: 't', sums: [Object.assign({}, sA, { stores: [Object.assign({}, st, { dupTitles: undefined, dupHtml: undefined })] })], queries: Q });
ck('4b no PART 3 when no store is above the limit', !/PART 3/.test(r3), 0);
// the gate still counts as before
var g = DS.gate([sA, sB]).filter(function (x) { return x.label === 'Meesho'; })[0];
ck('4c the gate numbers are unchanged (repeat 70 percent -> FAIL reason)', g && g.repeat === 70 && /repeated/.test(g.why.join(';')), g);
// size: the sample never grows the record beyond a few hundred bytes per search
ck('4d a record with the sample is small (title text + 700 chars)', JSON.stringify(a).length < 1200, JSON.stringify(a).length);
console.log('test_s23_11b: ' + pass + ' pass, ' + fail + ' fail'); process.exit(fail ? 1 : 0);
