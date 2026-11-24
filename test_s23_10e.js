/* app-spike / test_s23_10e v1.0.0 (S23-10 item e-lite, D-150). Run: node test_s23_10e.js
 * Store ORDER by relevance (storemap.rank / storemap.order). Nothing is dropped: every enabled store is still read; unknown category = the old order.
 * Why (08 finding 1): Ajio + Meesho + Tata CLiQ ran one by one (about 34 s) before Myntra and Croma, the 30 s gate then skipped them even for a phone search. */
'use strict';
var fs = require('fs'), path = require('path');
var M = require('./src/storemap.js'), R = require('./www/runner_core.js');
var FETCH = ['amazon', 'flipkart', 'nykaa', 'reliancedigital'], SPECIAL = ['myntra', 'croma'], ST = R.STORES;
var pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d)); } }
var all = {}; ST.forEach(function (s) { all[s.label] = true; });
function ord(q, en) { return M.order(q, ST, en || all, FETCH, SPECIAL); }
function j(x) { return JSON.stringify(x); }
var ph = ord('smartphones under 10000');
ck('1 phone: Ajio and Meesho wait, Croma before Myntra', j(ph.defer) === j(['Ajio', 'Meesho']) && j(ph.hi) === j(['Croma']) && j(ph.lo) === j(['Myntra']), ph);
var fa = ord('red tape shoes');
ck('2 fashion: nothing deferred, Myntra before Croma', fa.defer.length === 0 && j(fa.hi) === j(['Myntra']) && j(fa.lo) === j(['Croma']), fa);
var be = ord('lakme lipstick');
ck('3 beauty: nothing deferred, Myntra before Croma', be.defer.length === 0 && j(be.hi) === j(['Myntra']) && j(be.lo) === j(['Croma']), be);
var ga = ord('boat airdopes');
ck('4 gadget: Ajio waits, Croma before Myntra', j(ga.defer) === j(['Ajio']) && j(ga.hi) === j(['Croma']) && j(ga.lo) === j(['Myntra']), ga);
var un = ord('xyzzy qwerty');
ck('5 unknown category: same order as before (nothing deferred, Myntra then Croma)', un.defer.length === 0 && j(un.hi) === j(['Myntra', 'Croma']) && un.lo.length === 0, un);
ck('6 amazon and flipkart are never low', ['smartphones', 'red tape shoes', 'lakme lipstick', 'xyzzy'].every(function (q) { var r = M.rank(q, ST); return r.amazon === 0 && r.flipkart === 0; }), 0);
var QS = ['smartphones under 10000', 'iphone 17 pro', 'red tape shoes', 'lakme lipstick', 'boat airdopes', 'xyzzy qwerty', 'washing machine 7 kg', 'laptop under 40000', 'girls frock', 'bedsheet double', 'protein powder', 'nike', 'kurti', 'tv 43 inch', 'water bottle'];
var lost = 0, dup = 0;
QS.forEach(function (q) {
  var o = ord(q), seen = {};
  o.defer.concat(o.hi, o.lo).forEach(function (l) { if (seen[l]) dup++; seen[l] = 1; });
  ST.forEach(function (s) { var inFetch = FETCH.indexOf(s.key) >= 0, inSpecial = SPECIAL.indexOf(s.key) >= 0; var covered = inFetch || seen[s.label] || (!inSpecial && o.defer.indexOf(s.label) < 0); if (!covered) lost++; });
  // every special store is in hi or lo, every deferred store is a tab-only store
  SPECIAL.forEach(function (k) { var lab = ST.filter(function (s) { return s.key === k; })[0].label; if (o.hi.indexOf(lab) < 0 && o.lo.indexOf(lab) < 0) lost++; });
  o.defer.forEach(function (l) { var key = ST.filter(function (s) { return s.label === l; })[0].key; if (FETCH.indexOf(key) >= 0 || SPECIAL.indexOf(key) >= 0) lost++; });
});
ck('7 across ' + QS.length + ' queries no store is lost or listed twice', lost === 0 && dup === 0, [lost, dup]);
var off = ord('smartphones under 10000', Object.assign({}, all, { Ajio: false }));
ck('8 a store switched off by the kill switch is not deferred', j(off.defer) === j(['Meesho']), off);
ck('9 rank is 0 or 1 only', QS.every(function (q) { var r = M.rank(q, ST); return Object.keys(r).every(function (k) { return r[k] === 0 || r[k] === 1; }); }), 0);
// app.js wiring (static)
var app = fs.readFileSync(path.join(__dirname, 'src/app.js'), 'utf8');
ck('10 app.js asks storemap.order with the fetch list and the two special stores', /var ord = M\.order\(q, R\.STORES, pl\.enabled, SmartSetuFetchRead\.STORES_OK, \['myntra', 'croma'\]\)/.test(app), 0);
ck('11 deferred stores are switched off in pass 1 only', /ord\.defer\.forEach\(function \(l\) \{ pass1\[l\] = false; \}\)/.test(app), 0);
var iHi = app.indexOf('ord.hi.length'), iDef = app.indexOf('if (ord.defer.length)'), iLo = app.indexOf('ord.lo.length');
ck('12 order in startRun: hi special stores, deferred pass, lo special stores', iHi > 0 && iDef > iHi && iLo > iDef, [iHi, iDef, iLo]);
ck('13 deferred pass: same tab kind as pass 1 (mkTabs without user agent), time gate respected, never dropped', /var tabs3 = mkTabs\(\);/.test(app) && /runStores\(tabs3, opts\(W\.enabledOnly\(R\.STORES, ord\.defer\)\)\)/.test(app) && /if \(late\(\)\) \{ ord\.defer\.forEach/.test(app) && /var SKIP_BY_WORDS = false;/.test(app), 0);
ck('14 the deferred pass is read like any store (not a retry): retried flag cleared', /rr0\.retried = false/.test(app), 0);
console.log('test_s23_10e: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
