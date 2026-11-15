/* app-spike / test_s21b v1.0.0 (S21b, D-110, V-370). Run: node test_s21b.js
 * Store line = how many listings MATCH the search (engine count), for any query, no word list. Uses the saved real snapshots of tests/fixtures. */
'use strict';
var fs = require('fs'), path = require('path');
require('./www/bundle.js');
var U = require('./src/uihelp.js'), SS = SmartSetu, pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d)); } }
var dir = path.join(__dirname, '..', '..', 'tests', 'fixtures');
function load(f) { var j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); return j.snapshots.map(function (w) { return w.snapshot || w; }).filter(function (s) { return s && s.cards && s.kind !== 'product'; }); }
var snaps = load('snap_iphone17pro_2026-11-05.json');
function rel(q) { return U.relevantByStore(SS.compareAny({ query: q, searches: snaps, products: [], seenAt: '2026-11-15T00:00:00Z' })); }
var a = rel('iphone 17 pro');
ck('1 specific search: compared listings counted per store (flipkart 9, reliance 6, amazon 8)', a.flipkart === 9 && a.reliancedigital === 6 && a.amazon === 8, a);
ck('2 stores that were read but have nothing that matches are 0, not missing (myntra, ajio, nykaa, meesho, tatacliq)', a.myntra === 0 && a.ajio === 0 && a.nykaa === 0 && a.meesho === 0 && a.tatacliq === 0, a);
ck('3 a store whose page gave no data (croma) is not in the map', !Object.prototype.hasOwnProperty.call(a, 'croma'), a);
var b = rel('smartphone');
ck('4 general search: similar-product listings counted (amazon 1, meesho 1), others 0', b.amazon === 1 && b.meesho === 1 && b.flipkart === 0, b);
var c = rel('lipstick');
ck('5 nothing matches anywhere -> every read store is 0', Object.keys(c).every(function (k) { return c[k] === 0; }) && Object.keys(c).length >= 7, c);
ck('6 line text: 0 / 1 / many', U.relevanceLine(0).text === 'No matching products' && U.relevanceLine(1).text === '1 matching listing' && U.relevanceLine(15).text === '15 matching listings' && U.relevanceLine(0).kind === 'skip' && U.relevanceLine(7).kind === 'ok', [U.relevanceLine(0), U.relevanceLine(1), U.relevanceLine(15)]);
ck('7 no engine result -> null (the plain line stays)', U.relevantByStore(null) === null && U.relevantByStore({}) === null, 0);
var app = fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8');
ck('8 buildNow calls paintRelevance after the engine ran, and paintRelevance only touches state ok stores', /paintRelevance\(res, runs\);\s*\n\s*return \{ view: v/.test(app) && /run\.state !== 'ok'/.test(app), 0);
ck('9 plan() no longer skips stores from the word list (SKIP_BY_WORDS false, skip only behind it)', /var SKIP_BY_WORDS = false;/.test(app) && /if \(SKIP_BY_WORDS && on && pick\.skip\[s\.key\]\)/.test(app), 0);
console.log('test_s21b: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
