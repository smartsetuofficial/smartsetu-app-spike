/* app-spike / test_s22a v1.0.0 (S22a, D-115, V-394..). Run: node test_s22a.js
 * From the owner's 0.10.13 report (Laptop backpack 15.6 inch): 15.6 was split into 15 + 6, "15.6 Inch Compatible Laptop Backpack" was thrown out as a spare part,
 * a title with no size could not be shown as close, and Croma's own card text "Not Available at pincode" was not read. Titles below are the REAL titles from that report. */
'use strict';
var fs = require('fs'), path = require('path');
var Q = require('../query-engine/query_engine.js'), P = require('../parser-core/parser.js');
var W = require('./src/webtabs.js'), pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d)); } }
function read(f) { return fs.readFileSync(path.join(__dirname, f), 'utf8'); }
// 1. decimals are one token, the size is a stated size (like litres)
ck('1a norm keeps 15.6 in one piece', Q.norm('Giordano 15.6-inch Polyester') === 'giordano 15.6 inch polyester' && Q.norm('iPhone 17 Pro Max') === 'iphone 17 pro max' && Q.norm('Rs 1,499') === 'rs 1 499', [Q.norm('Giordano 15.6-inch Polyester'), Q.norm('Rs 1,499')]);
var q = Q.parse('Laptop backpack 15.6 inch');
ck('1b query: size 15.6 inch, words laptop + backpack, no model 15, no word 6', q.qty && q.qty.k === 'in' && q.qty.v === 15.6 && q.models.length === 0 && q.extras.join() === 'laptop,backpack' && q.qtyText === '15.6 inch', [q.qty, q.models, q.extras]);
var T = function (t) { var r = Q.analyse(q, { title: t, link: '', priceNum: 50000 }); return r.tier + (r.miss ? 'c' : ''); };
// 2. real titles from the report
ck('2a Flipkart "15.6 L Laptop Backpack" (bare 15.6) = exact', T('HP 15.6 L Laptop Backpack Single Blue(H1-01)_19 Black') === '3', T('HP 15.6 L Laptop Backpack Single Blue(H1-01)_19 Black'));
ck('2b "15.6 Inch Compatible Laptop Backpack" is a backpack, not a spare part', T('SKYBAGS Unisex Fuse 15.6 Inch Compatible Laptop Backpack with 2 Compartments - 18L') === '3' && T('Skybags Fuse 15.6 Inch Compatible Laptop Backpack 18L | 2 Compartments') === '3', 0);
ck('2c 15.6-inch, (15.6 inch), Upto 15.6" = exact', T('Giordano 15.6-inch Polyester Laptop Backpack - Black') === '3' && T('Tucano Giallo Backpack for 39.64 cm (15.6 inch) Laptops, Black') === '3' && T('Skybags Brat Pro Max 35L Laptop Backpack (Upto 15.6"), 3 Compartments') === '3', 0);
ck('2d other stated sizes are NOT 15.6 (15.3 inch, 15 Inch, 16")', T('Asus 16 L Backpack for 38.86 cm (15.3 inch) Laptops, Grey') === '0' && T('Tommy Hilfiger Joshua Polyester Unisex 15 Inch Laptop Backpack - Black') === '0' && T('ZIPLINE Men 16" Laptop Bag with Detachable Strap') === '0', 0);
ck('2e Myntra / Wesley titles with no size = close, never exact', T('Roadster 28L Archer Laptop Backpack') === '2c' && T('Wesley Milestone 2.0 Casual Waterproof Laptop Backpack/Office Bag/School Bag/College Bag') === '2c', 0);
ck('2f a laptop BAG or a bag with no laptop word is not a laptop backpack answer', T('Apsis Black Textured Medium 15.6 inch Laptop Bag') === '2' && T('STOIC Unisex Backpacks 16 L') === '2', 0);
ck('2g "compatible with X" is still a spare part; "3 in 1" is not a size', T('Replacement strap compatible with Skybags laptop backpack 15.6 inch') === '0' && T('3 in 1 Laptop Backpack 15.6 inch Combo') === '3', 0);
// 3. the same rule for every other query that states a size
var q2 = Q.parse('tv 55 inch'); var r2 = Q.analyse(q2, { title: 'Samsung 55 inch Smart TV', link: '', priceNum: 1 }), r3 = Q.analyse(q2, { title: 'Sony 43 inch Smart TV', link: '', priceNum: 1 });
ck('3 tv 55 inch: 55 inch title kept, 43 inch title out', q2.qty && q2.qty.v === 55 && r2.tier >= 2 && r3.tier === 0, [q2.qty, r2.tier, r3.tier]);
ck('3b litres still work (mixer 1.5 litre)', Q.parse('mixer jar 1.5 litre').qty.k === 'v' && Q.parse('mixer jar 1.5 litre').qty.v === 1500, Q.parse('mixer jar 1.5 litre').qty);
// 4. Croma: the card itself says Not Available at pincode -> unavailable (never the cheapest, D-060)
function card(txt) {
  var l = 'https://www.croma.com/lenovo-slim-backpack/p/314317', snap = { v: 1, kind: 'search', query: 'x', url: 'https://www.croma.com/searchB?q=x', probe: 'x', cards: [{ link: l, sponsored: false, ad: false, html: '<div><a href="' + l + '"><span>Lenovo Slim Everyday Laptop Backpack</span></a><div>' + txt + '</div></div>' }] };
  return P.parseSearch(snap).cards[0] || { notes: ['no_card'] };
}
var cr = card('Lenovo Slim Everyday Laptop Backpack \u20B9634 \u20B91,481 (Save \u20B9847) 57% Off Not Available at pincode Mumbai City, 400001'), cg = card('Lenovo Slim Everyday Laptop Backpack \u20B9634 \u20B91,481 (Save \u20B9847) 57% Off');
ck('4 Croma card text Not Available at pincode -> outOfStock; same card without it -> in', cr.outOfStock === true && cg.outOfStock === false && cr.priceNow === 634, [cr.outOfStock, cg.outOfStock, cr.priceNow]);
// 5. report: offers before the long listing block, only 3 ad lines per store
var rep = W.buildReport({ version: 't', query: 'q', runs: [], rows: [], diag: ['d'], croma: ['c'], listings: ['l1'], offers: ['o1'], struct: ['s1'], rescue: ['r1'] }), ix = function (s) { return rep.indexOf(s); };
ck('5a report order: DIAGNOSTIC, CROMA, OFFERS, ALL LISTINGS, PAGE STRUCTURE, CARD RESCUE', ix('DIAGNOSTIC') < ix('CROMA PINCODE') && ix('CROMA PINCODE') < ix('OFFERS FROM PRODUCT PAGES') && ix('OFFERS FROM PRODUCT PAGES') < ix('ALL LISTINGS READ') && ix('ALL LISTINGS READ') < ix('PAGE STRUCTURE') && ix('PAGE STRUCTURE') < ix('CARD RESCUE'), rep.slice(0, 40));
var fl = []; for (var i = 0; i < 40; i++) fl.push({ link: 'https://www.amazon.in/sspa/click?x=' + i, sponsored: true, ad: false, html: '<div>Sponsored Shirt ' + i + '</div>' });
var ads = W.listingLines([{ store: 'Amazon', snapshot: { cards: fl } }], [], function () { return { cards: [], skipped: { sponsored_or_ad: 40 } }; }).filter(function (l) { return /^- skipped ad \| /.test(l); });
ck('5b 3 ad lines per store, store header still says how many were skipped', ads.length === 3, ads.length);
// 6. design: 4 new icons, premium block, no best claim
var h = read('www/index.html'), c = read('www/app.css');
ck('6a Home: 4 new icons (q1..q4), old i1a..i4a gone, 4 perks cards, texts unchanged', ['q1r', 'q2f', 'q3r', 'q4s'].every(function (s) { return h.indexOf('id="' + s + '"') > 0; }) && !/id="i[1-4]a"/.test(h) && (h.match(/<svg class="pic"/g) || []).length === 4 && /Save More/.test(h) && /Shop Smart/.test(h) && /Check Fast/.test(h) && /100% Private/.test(h), 0);
ck('6b css: S22a block, result rows are cards, price text is dark-on-light (no white text on white)', /S22a \(D-115\)/.test(c) && /#results \.rows li/.test(c) && /#results \.rows \.pn\{[^}]*#0B1F3A/.test(c), 0);
ck('6c no ranking words in the new css or html (D-024)', !/best pick|winner|\branked?\b/i.test(c.slice(c.indexOf('S22a (D-115)')) + h), 0);
console.log('test_s22a: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
