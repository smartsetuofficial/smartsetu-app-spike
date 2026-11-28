/* S23-22 offline test (D-164). Run: node test_s23_22.js (from code/app-spike).
 * In a matching-listings group, the same store + the same title + the same price is ONE row, for ALL 9 stores (D-073); the row of the lowest-price pick is kept; a different title, a different price or a different store is never merged; a row without a title or price is never merged; the store line count equals the rows drawn. */
'use strict';
var fs = require('fs'), path = require('path');
var U = require('./src/uihelp.js'), V = require('./www/view.js'), VX = require('../extension/view.js');
var pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d)); } }
var STORES = ['amazon', 'flipkart', 'myntra', 'ajio', 'nykaa', 'meesho', 'tatacliq', 'croma', 'reliancedigital'];
function mem(store, title, paise, url) { return { store: store, title: title, url: url, pricePaise: paise, mrpPaise: paise * 3, availability: 'unknown' }; }
function build(members, pickIdx) {
  var pick = pickIdx == null ? null : { comparable: true, member: members[pickIdx] };
  var res = { query: { brand: 'boat', models: ['141'] }, storeStatus: {}, clusters: [{ queryMatch: true, pick: pick, members: members }] };
  members.forEach(function (m) { res.storeStatus[m.store] = 'ok'; });
  return { res: res, view: V.buildView(res, [], 'T') };
}
STORES.forEach(function (s) {
  var other = STORES[(STORES.indexOf(s) + 1) % STORES.length];
  var a1 = mem(s, 'boAt Airdopes 141 Gen 2 Headphones', 109900, 'https://x/' + s + '/1');
  var a2 = mem(s, '  boat   AIRDOPES 141 gen 2 headphones ', 109900, 'https://x/' + s + '/2');
  var a3 = mem(s, 'boAt Airdopes 141 Gen 2 Headphones', 99900, 'https://x/' + s + '/3');
  var a4 = mem(s, 'boAt Airdopes 141 Gen 2 Headphone', 109900, 'https://x/' + s + '/4');
  var b1 = mem(other, 'boAt Airdopes 141 Gen 2 Headphones', 109900, 'https://y/' + other + '/1');
  var r = build([a1, a2, a3, a4, b1], null), rows = r.view.groups[0].rows;
  ck(s + ' same store+title+price is one row (5 members -> 4 rows)', rows.length === 4, rows.length);
  ck(s + ' different price, different title, other store are kept', rows.filter(function (x) { return x.pricePaise === 99900; }).length === 1 && rows.filter(function (x) { return /Headphone$/.test(x.title); }).length === 1 && rows.filter(function (x) { return x.url.indexOf('/' + other + '/') >= 0; }).length === 1, rows.map(function (x) { return x.title + x.pricePaise; }));
  ck(s + ' store line count equals the rows of that store', U.relevantByStore(r.res)[s] === rows.filter(function (x) { return x.url.indexOf('/' + s + '/') >= 0; }).length && U.relevantByStore(r.res)[other] === 1, U.relevantByStore(r.res));
  // the pick is the SECOND duplicate: it must be the one kept and still flagged lowest
  var p = build([a1, a2], 1), pr = p.view.groups[0].rows;
  ck(s + ' the pick row is the one kept and flagged', pr.length === 1 && pr[0].url === a2.url && pr[0].isLowest === true, pr);
  // the pick is the first duplicate
  var q = build([a2, a1], 1), qr = q.view.groups[0].rows;
  ck(s + ' pick first or second, one row and flagged', qr.length === 1 && qr[0].url === a1.url && qr[0].isLowest === true, qr);
});
// no title or no price: never merged (old behaviour, test_s23_6c 3e)
var np = build([{ store: 'amazon', url: 'u1', pricePaise: 100 }, { store: 'amazon', url: 'u2', pricePaise: 100 }], null);
ck('rows without a title are not merged', np.view.groups[0].rows.length === 2, np.view.groups[0].rows.length);
var nz = build([{ store: 'amazon', title: 'T', url: 'u1', pricePaise: 0 }, { store: 'amazon', title: 'T', url: 'u2', pricePaise: 0 }], null);
ck('rows without a price are not merged', nz.view.groups[0].rows.length === 2, nz.view.groups[0].rows.length);
ck('count line for rows without a title stays', U.relevantByStore({ storeStatus: { amazon: 'ok' }, similar: { mode: 'specific', stores: [] }, clusters: [{ queryMatch: true, members: [{ store: 'amazon' }, { store: 'amazon' }] }] }).amazon === 2, 0);
// the real case from the owner phone (27 Nov 2026): Myntra Gen 2 Headphones twice at 1099
var real = build([mem('myntra', 'boAt Airdopes 141 Gen 2 Headphones', 109900, 'https://m/1'), mem('myntra', 'boAt Airdopes 141 Gen 2 Headphones', 109900, 'https://m/2')], null);
ck('owner phone case: Myntra Gen 2 twice at 1,099 shows once', real.view.groups[0].rows.length === 1 && U.relevantByStore(real.res).myntra === 1, real.view.groups[0].rows.length);
// both copies of view.js are the same file, and the app copy equals the extension copy
ck('www/view.js equals extension/view.js byte for byte', fs.readFileSync(path.join(__dirname, 'www', 'view.js'), 'utf8') === fs.readFileSync(path.join(__dirname, '..', 'extension', 'view.js'), 'utf8'), 0);
ck('both copies give the same result', JSON.stringify(V.buildView(real.res, [], 'T')) === JSON.stringify(VX.buildView(real.res, [], 'T')), 0);
ck('app version 0.10.31', /VERSION = '0\.10\.31'/.test(fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8')), 0);
console.log('test_s23_22: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
