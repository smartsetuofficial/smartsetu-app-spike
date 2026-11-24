/* app-spike / test_s22b2 v1.0.0 (S22b-2, D-117, V-411..). Run: node test_s22b2.js
 * Offers under result rows. Lines below are shapes seen on real store pages (V-230, V-237, V-242): Reliance "Flat Rs.400 Off" and percent+cap+bank lines,
 * Tata bank-wise percent lines, Amazon bank name only, Flipkart tiles of other products, Myntra "Coupon"/"Bank Offer" without an amount. */
'use strict';
var fs = require('fs'), path = require('path');
var P = require('../parser-core/parser.js'), A = require('../compare-engine/adapter.js'), O = require('../compare-engine/offers.js'), W = require('./src/webtabs.js');
var OF = require('./src/offerflow.js').make({ parser: P, adapter: A, offers: O, isTileLine: W.isTileLine });
var pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d)); } }
var REL = ['Flat Rs.400 Off on HDFC Bank Credit Card | Min Order: 5000', '10% Instant Discount up to Rs.1500 on ICICI Bank Credit Card', 'No Cost EMI available'];
var P30K = 3000000;

// 1 parser and adapter: flat amount
var o1 = P.offersFromLines('reliancedigital', REL);
ck('1a flat Rs.400 read, min order 5000', o1[0].flatRs === 400, o1[0]);
ck('1b a percent in the same line wins, no flat amount is read', P.offersFromLines('reliancedigital', ['Flat Rs.400 Off or 10% off on SBI Bank Credit Card'])[0].flatRs === undefined, 0);
ck('1c "Flat Rs 300 cashback" is not an instant discount, no flat amount', P.offersFromLines('reliancedigital', ['Flat Rs 300 cashback on Axis Bank Credit Card'])[0].flatRs === undefined, 0);
ck('1d unknown store or bad input: no offers, no throw', P.offersFromLines('nostore', REL).length === 0 && P.offersFromLines('amazon', null).length === 0, 0);
var ad = A.adaptOffers(o1).offers;
ck('1e adapter flatPaise 40000 for a bank offer, null when none stated', ad[0].flatPaise === 40000 && ad[0].minOrderPaise === 500000 && ad[1].flatPaise === null && ad[0].bank === 'HDFC', ad);
ck('1f parser 1.0.22', P.version === '1.0.22', P.version);

// 2 card matches: only then the price goes down
var r = OF.assess('Reliance Digital', REL, P30K, ['HDFC']);
ck('2a HDFC card + min order met: Rs 400 less, effective 29,600', r && r.after && r.after.bank === 'HDFC' && r.after.discountPaise === 40000 && r.after.effectivePaise === 2960000, r);
ck('2b other bank offer is only Possible', r.possible.length === 1 && /ICICI/.test(r.possible[0].text) && r.possible[0].amountPaise === 150000, r.possible);
ck('2c row lines: after (estimate) then possible', OF.rowLines(r)[0].text === 'With your HDFC credit card: \u20B9400 less \u2192 \u20B929,600 (estimate)' && OF.rowLines(r)[1].kind === 'possible', OF.rowLines(r));
var r0 = OF.assess('Reliance Digital', REL, P30K, []);
ck('2d no card chosen: nothing counted, both are Possible', !r0.after && r0.possible.length === 2, r0);
ck('2e min order not met (price 4,000 < 5,000): HDFC flat not counted, not shown', (function () { var x = OF.assess('Reliance Digital', REL, 400000, ['HDFC']); return !x || !x.after; })(), 0);
ck('2f percent with cap: 10% of 30,000 = 3,000, capped at 1,500', OF.assess('Reliance Digital', REL, P30K, ['ICICI']).after.discountPaise === 150000, 0);

// 3 coupons never lower the price
var rc = OF.assess('Reliance Digital', ['Use Code SAVE200 Flat Rs.200 off coupon'], P30K, ['HDFC', 'ICICI', 'SBI', 'Axis']);
ck('3a coupon: no after, only Possible (coupon)', rc && !rc.after && rc.possible[0].text === 'Coupon: about \u20B9200 off, needs a code', rc);
ck('3b coupon alone never makes a group line', OF.groupLowest([{ store: 'Reliance Digital', pricePaise: P30K, url: 'u' }], function () { return rc; }) === null, 0);

// 4 no amount = say so, invent nothing
var ra = OF.assess('Amazon', ['Bank Offer: 5% Instant Discount on HDFC Bank cards', 'Coupon: Apply coupon at checkout'], 100000, ['HDFC']);
var ra2 = OF.assess('Myntra', ['Coupon', 'Bank Offer'], 100000, ['HDFC']);
ck('4a (S22b-3) a bank line that does NOT say credit or debit is never subtracted, even with the bank ticked: shown as Possible with its bank', ra && !ra.after && ra.possible[0] && /HDFC/.test(ra.possible[0].text) && ra.possible[0].amountPaise === 5000, ra);
ck('4b Myntra "Coupon" / "Bank Offer" words without amount: no offer lines read at all', ra2 === null, ra2);
var ra3 = OF.assess('Amazon', ['Bank Offer: instant discount on HDFC Bank cards (see terms)'], 100000, ['HDFC']);
ck('4c bank offer text with a money word but no amount: "Offers available", not a number', ra3 === null || (!ra3.after && ra3.possible.length === 0), ra3);
ck('4d unknown store label or no price: null', OF.assess('Nowhere', REL, P30K, []) === null && OF.assess('Reliance Digital', REL, 0, []) === null, 0);

// 5 tiles of other products are dropped before reading (Flipkart)
var tile = ['\u20B91,27,900 with Bank offer', '12% off', '10% Instant Discount on HDFC Bank Credit Card'];
var rf = OF.assess('Flipkart', tile, 12790000, ['HDFC']);
ck('5a Flipkart tile lines dropped, only the real bank line counts', rf && rf.after && rf.after.discountPaise === 1279000, rf);
ck('5b tiles alone give no offer at all (another product\'s offer never lands here)', OF.assess('Flipkart', tile.slice(0, 2), 12790000, ['HDFC']) === null, OF.assess('Flipkart', tile.slice(0, 2), 12790000, ['HDFC']));

// 6 targets: top 2 cheapest matched per store, no close-match group, no odd price, no duplicates
var rows = function (s, arr) { return arr.map(function (x, i) { return { store: s, title: 't', url: 'https://' + s + '/' + i + '/' + x, pricePaise: x * 100, odd: false }; }); };
var view = { groups: [{ title: 'Phone X', rows: rows('Amazon', [900, 500, 700]).concat(rows('Flipkart', [800])) }, { title: 'Flipkart: close matches', rows: rows('Flipkart', [100]) }, { title: 'Phone Y', rows: [{ store: 'Ajio', url: 'https://a/1', pricePaise: 5000, odd: true }, { store: 'Ajio', url: 'https://a/2', pricePaise: 6000, odd: false }] }] };
var tg = OF.pickTargets(view);
ck('6a Amazon top 2 (500, 700), Flipkart 1, Ajio non-odd only, close group skipped', tg.length === 4 && tg.filter(function (x) { return x.store === 'Amazon'; }).map(function (x) { return x.pricePaise; }).join() === '50000,70000' && !tg.some(function (x) { return x.pricePaise === 10000 || x.pricePaise === 5000; }), tg);
ck('6b page cap', OF.pickTargets({ groups: [{ title: 'a', rows: rows('Amazon', [1, 2]).concat(rows('Flipkart', [3, 4]), rows('Ajio', [5, 6])) }] }, 2, 3).length === 3, 0);
ck('6c nothing to read: empty', OF.pickTargets({ groups: [] }).length === 0 && OF.pickTargets(null).length === 0, 0);

// 7 group line: lowest after card offers; listed price untouched
var rowsG = [{ store: 'Amazon', pricePaise: 3000000, url: 'a' }, { store: 'Reliance Digital', pricePaise: 3020000, url: 'b' }];
var resMap = { a: null, b: OF.assess('Reliance Digital', ['10% Instant Discount up to Rs.1500 on HDFC Bank Credit Card'], 3020000, ['HDFC']) };
var gl = OF.groupLowest(rowsG, function (x) { return resMap[x.url]; });
ck('7a group line names store and estimate, 30,200 - 1,500 = 28,700', gl && gl.store === 'Reliance Digital' && gl.effectivePaise === 2870000 && gl.beatsListed === true && /^Lowest after your card offers: \u20B928,700 at Reliance Digital \(estimate\)$/.test(gl.text), gl);
ck('7b no card offer anywhere: no group line', OF.groupLowest(rowsG, function () { return null; }) === null, 0);
ck('7c rows are not modified', rowsG[0].pricePaise === 3000000 && rowsG[1].pricePaise === 3020000, rowsG);

// 8 member cards: phone-only list, only known banks
var mem = { v: null, getItem: function () { return this.v; }, setItem: function (k, v) { this.v = v; this.k = k; } };
ck('8a save keeps only known banks, no duplicates', OF.saveCards(mem, ['HDFC', 'HDFC', 'Nobank', 'SBI']).join() === 'HDFC,SBI' && mem.k === 'smartsetu_cards_v1', mem);
ck('8b load round trip, and bad data = empty list', OF.loadCards(mem).join() === 'HDFC,SBI' && OF.loadCards({ getItem: function () { return '{bad'; } }).length === 0 && OF.loadCards({ getItem: function () { throw new Error('x'); } }).length === 0, 0);
ck('8c bank list is the adapter list', OF.BANKS.join() === A.BANKS.join() && OF.BANKS.indexOf('HDFC') >= 0, OF.BANKS);
ck('8d every store name the view shows maps to a parser store', ['Amazon', 'Flipkart', 'Ajio', 'Myntra', 'Nykaa', 'Meesho', 'Tata CLiQ', 'Croma', 'Reliance Digital'].every(function (n) { return OF.keyOfLabel(n); }), 0);
ck('8e rupee format, Indian grouping', OF.inr(1279000) === '\u20B912,790' && OF.inr(12345600) === '\u20B91,23,456' && OF.inr(40000) === '\u20B9400', [OF.inr(1279000), OF.inr(12345600)]);

// 9 shipped files
var read = function (f) { var s = fs.readFileSync(path.join(__dirname, f), 'utf8'); return /app\.css$/.test(f) ? s.replace(/([\d.]+)rem/g, function (m, n) { return +(n * 16).toFixed(3) + 'px'; }) : s; };
var app = read('src/app.js'), html = read('www/index.html'), css = read('www/app.css');
ck('9a app.js: offers start only after the result is drawn, never in onSubmit', /setTimeout\(function \(\) \{ runOffers\(finView, myTok\)/.test(app) && app.indexOf('runOffers') > app.indexOf('render(fin.view)') && !/function onSubmit[\s\S]{0,400}runOffers/.test(app), 0);
ck('9b app.js: new search cancels old offer reads (token), offerRaw cleared', /offerTok\+\+; if \(!only\) offerRaw = \{\}/.test(app) && /tok !== offerTok/.test(app), 0);
ck('9c app.js: draws with textContent only, no innerHTML', app.indexOf('innerHTML') < 0, 0);
ck('9d html has My cards button and panel with phone-only note', /id="cardsbtn"/.test(html) && /id="cardspanel"/.test(html) && /stays on this phone/.test(html), 0);
ck('9e css has offer lines and 434/360 safe card grid', /\.of-after/.test(css) && /\.gl\{/.test(css), 0);
ck('9f the word "Lowest price found" is not used in the app any more', app.indexOf('Lowest price found') < 0 && /Lowest listed price/.test(app), 0);
ck('9g www bundle has offersFromLines and equals the extension bundle', read('www/bundle.js') === fs.readFileSync(path.join(__dirname, '..', 'extension', 'bundle.js'), 'utf8') && /offersFromLines/.test(read('www/bundle.js')), 0);
console.log('test_s22b2: ' + pass + ' pass, ' + fail + ' fail'); process.exit(fail ? 1 : 0);
