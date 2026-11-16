/* app-spike / test_s22b v1.0.0 (S22b, D-116, V-404..). Run: node test_s22b.js
 * From the owner's 0.10.14 report (Yoga mat 6mm): "mm" was no size, so 6mm became a model word, "6.0 mm" did not equal 6mm, a title with no size was thrown out,
 * and a title stating 8mm AND 6 mm was exact. Rule now (every query, no keyword list): number + unit from ONE closed table of physical units is a size;
 * same unit must be equal; unit not stated = close; two different sizes of the same unit with one equal = close. Titles below are REAL titles from that report. */
'use strict';
var fs = require('fs'), path = require('path'), Q = require('../query-engine/query_engine.js'), pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d)); } }
function T(q, t) { var r = Q.analyse(q, { title: t, link: '', priceNum: 300 }); return r.tier + (r.miss ? 'c' : ''); }
var y = Q.parse('Yoga mat 6mm');
ck('1a 6mm is a size (kind mm), not a model word', y.qty && y.qty.k === 'mm' && y.qty.v === 6 && y.models.length === 0 && y.extras.join() === 'yoga,mat', [y.qty, y.models, y.extras]);
ck('1b 6mm, 6 mm, 6.0 mm, 6Mm are the same size', ['Yoga mat for Women & Men EVA Material 6mm Anti-Slip Mat', 'Strauss Yoga Mat, 6 mm (Purple)', 'BARNIWALA YOGA MAT 6.0 mm Yoga Mat', 'CULT Yoga Mat Tpe 6Mm Peach With Strap And Bag'].every(function (t) { return T(y, t) === '3'; }), 0);
ck('1c 8mm is not 6mm', T(y, 'Decathlon Kimjaly - Unisex Excellent Grip Yoga Mat 8mm') === '0', T(y, 'Decathlon Kimjaly - Unisex Excellent Grip Yoga Mat 8mm'));
ck('1d no size in title = close, never exact (Amazon ARROWMAX, Meesho, Myntra style)', T(y, 'ARROWMAX Yoga Mat for Men & Women | Non Slip Exercise Mat with Textured Surface | Fitness,') === '2c' && T(y, 'Stylish Yoga Mats') === '2c' && T(y, 'CULT Lightweight Yoga Mat') === '2c', 0);
ck('1e title with 8mm AND 6 mm = close (Green Glow)', T(y, 'Green Glow Yogamat-8mm-Green-0001 Green 6 mm Yoga Mat') === '2c', T(y, 'Green Glow Yogamat-8mm-Green-0001 Green 6 mm Yoga Mat'));
ck('1f mat size in cm does not mix with thickness in mm', T(y, 'Yoga Mat 6mm 183 cm x 61 cm') === '3' && T(y, 'Yoga Mat 8mm 183cm x 61cm') === '0', 0);
ck('1g a laptop is not a yoga mat answer', T(y, 'Lenovo Yoga Slim 7 14AKP10 Laptop') === '2', T(y, 'Lenovo Yoga Slim 7 14AKP10 Laptop'));
// other units, same rule (no yoga-specific code anywhere)
var pb = Q.parse('power bank 10000mah'), ac = Q.parse('split ac 1.5 ton'), mx = Q.parse('mixer grinder 750 watt'), tv = Q.parse('tv 120hz');
ck('2a mah', pb.qty && pb.qty.k === 'mah' && pb.qty.v === 10000 && T(pb, 'Ambrane 10000 mAh Power Bank') === '3' && T(pb, 'Mi 20000mAh Power Bank') === '0', [pb.qty, T(pb, 'Ambrane 10000 mAh Power Bank'), T(pb, 'Mi 20000mAh Power Bank')]);
ck('2b ton', ac.qty && ac.qty.k === 'ton' && ac.qty.v === 1.5 && T(ac, 'LG 1.5 Ton 3 Star Split AC') !== '0' && T(ac, 'Voltas 2 Ton Split AC') === '0', [ac.qty, T(ac, 'LG 1.5 Ton 3 Star Split AC'), T(ac, 'Voltas 2 Ton Split AC')]);
ck('2c watt and kW are converted', mx.qty && mx.qty.k === 'pw' && mx.qty.v === 750 && Q.parse('heater 1 kw').qty.v === 1000, [mx.qty, Q.parse('heater 1 kw').qty]);
ck('2d hz', tv.qty && tv.qty.k === 'hz' && T(tv, 'Samsung 55 inch 120 Hz Smart TV') !== '0' && T(tv, 'Sony 60Hz TV') === '0', [tv.qty, T(tv, 'Samsung 55 inch 120 Hz Smart TV'), T(tv, 'Sony 60Hz TV')]);
// nothing that worked before changes
ck('3a 5G and 4G are not grams, GB is not a size, model words stay', Q.parse('redmi 12 5g').qty === null && Q.parse('iphone 17 pro 256gb').qty === null && Q.parse('boat airdopes 141').qty === null && Q.parse('iphone 17 pro').qty === null, 0);
ck('3b litres, kg, inch still work', Q.parse('water bottle 1 litre').qty.v === 1000 && Q.parse('atta 5 kg').qty.v === 5000 && Q.parse('tv 55 inch').qty.k === 'in', 0);
ck('3c plural from 3 letters: mat = mats, cap = caps', T(Q.parse('yoga mat'), 'Fashionable Yoga Mats') === '3' && T(Q.parse('baseball cap'), 'Pack of 2 Baseball Caps') !== '0', [T(Q.parse('yoga mat'), 'Fashionable Yoga Mats'), T(Q.parse('baseball cap'), 'Pack of 2 Baseball Caps')]);
// whole pipeline (bundle), real Flipkart titles of the report: close rows are never the lowest
global.self = global; eval(fs.readFileSync(path.join(__dirname, 'www/bundle.js'), 'utf8')); var S = global.SmartSetu;
function snap(host, p, cards) { return { v: 1, kind: 'search', query: 'Yoga mat 6mm', url: 'https://' + host + '/search?q=Yoga', probe: 'x', cards: cards.map(function (c) { var l = 'https://' + host + p.replace('ID', c.id); return { link: l, sponsored: false, ad: false, html: '<div><a href="' + l + '"><span>' + c.t + '</span></a><span>\u20b9' + c.p + '</span> <span>\u20b9' + (c.p * 3) + '</span> 66% off</div>' }; }) }; }
var fk = snap('www.flipkart.com', '/slug/p/itmID', [{ t: 'Green Glow Yogamat-8mm-Green-0001 Green 6 mm Yoga Mat', p: 288, id: 'a1b2c3d4e5f6a' }, { t: 'BARNIWALA YOGA MAT 6.0 mm Yoga Mat', p: 298, id: 'b1b2c3d4e5f6a' }, { t: 'Adrenex Yoga Mat 6mm | Exercise Mat for Gym/Home Workou...', p: 290, id: 'c1b2c3d4e5f6a' }, { t: 'ARROWMAX Yoga Mat for Men & Women Non Slip', p: 250, id: 'd1b2c3d4e5f6a' }]);
var res = S.compareAny({ query: 'Yoga mat 6mm', searches: [fk], products: [], seenAt: new Date().toISOString() }), st = res.similar.stores[0];
ck('4a Barniwala 6.0 mm is listed, cheapest of the store is a 6mm listing, not the cheaper no-size or 8mm one', st.items.some(function (i) { return /BARNIWALA/.test(i.title); }) && st.cheapest.pricePaise === 29000 && st.close.length === 2, [st.cheapest, st.close.length]);
console.log('test_s22b: ' + pass + ' pass, ' + fail + ' fail'); process.exit(fail ? 1 : 0);
