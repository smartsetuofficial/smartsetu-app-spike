/* app-spike / test_s23_16 v1.0.0 (S23-16, D-161, V-603). Run: node test_s23_16.js
 * Item A: a store that answers a search with its HOME page (Reliance Digital, 0.10.27 report: 616 KB, title "Online Electronic Shopping Store in India - Reliance Digital", 0 cards, nr false)
 *         is "no results" at once (no 20 s tab), for EVERY store in runner_core (the rule has no store word). A blank page with another title (Amazon, D-158) still goes to the tab.
 * Item B: Meesho cards show a catalog name as the title while the link names the product (real saved Meesho cards of the lakme search, and the boat case of the 0.10.27 report).
 *         The link name leads the title, the card title follows in brackets; titles whose words are in the link are never touched (all store configs).
 * Item C and D: the Full Test report gets the WHY 0 ROWS block and the page saw line (devsuite). */
'use strict';
var fs = require('fs'), path = require('path');
var FR = require('./www/fetchread.js'), R = require('./www/runner_core.js'), P = require('../parser-core/parser.js'), DS = require('./src/devsuite.js');
var pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d)); } }
var PAD = new Array(3000).join('x ');
function page(title, extra) { return '<html><head><title>' + title + '</title></head><body>' + (extra || '') + '<p>' + PAD + '</p></body></html>'; }
async function readOne(store, query, html, finMode) {
  var reqUrl = store.url(query), fin = finMode === 'root' ? new URL(reqUrl).origin + '/' : reqUrl;
  var read = FR.make(function () { return Promise.resolve({ status: 200, url: fin, text: function () { return Promise.resolve(html); } }); }, function (txt) { return { cards: /data-card/.test(txt) ? [{}] : [], title: '' }; });
  await read(store, query, undefined);
  return read.last[store.key];
}
(async function () {
  var HOME = 'Online Electronic Shopping Store in India - Reliance Digital';
  var qs = ['red tape shoes for women', 'lakme lipstick', 'protein powder', 'smartphones'];
  for (var i = 0; i < R.STORES.length; i++) {
    var st = R.STORES[i];
    for (var j = 0; j < qs.length; j++) {
      var d = await readOne(st, qs[j], page(HOME));
      ck('A1 ' + st.key + ' home title, 0 cards -> no results (home) for "' + qs[j] + '"', d.nr === true && d.nrWhy === 'home' && R.emptyPageIsNoResults(d), d);
    }
    var d2 = await readOne(st, 'red tape shoes', page('Red Tape Shoes - Online Shopping Store'));
    ck('A2 ' + st.key + ' title with a search word is NOT home', d2.nr === false, d2);
    var d3 = await readOne(st, 'red tape shoes', page('Amazon.in'));
    ck('A3 ' + st.key + ' blank page, other title -> tab as before (nr false)', d3.nr === false && !R.emptyPageIsNoResults(d3), d3);
    var d4 = await readOne(st, 'red tape shoes', page('Some Store'), 'root');
    ck('A4 ' + st.key + ' redirected to the store root -> no results (home)', d4.nr === true && d4.nrWhy === 'home', d4);
    var d5 = await readOne(st, 'for the', page(HOME));
    ck('A5 ' + st.key + ' query with no real word -> title sign not used', d5.nr === false, d5);
    var d6 = await readOne(st, 'red tape shoes', page(HOME, '<div data-card="1"></div>'));
    ck('A6 ' + st.key + ' page with cards untouched', d6.cards === 1 && d6.nr === false, d6);
    var d7 = await readOne(st, 'red tape shoes', page('Sorry', '<h1>No results found</h1>'));
    ck('A7 ' + st.key + ' words on the page still say no results (text)', d7.nr === true && d7.nrWhy === 'text', d7);
  }
  var dd = await readOne(R.STORES[0], 'boat', page(HOME));
  ck('A8 title and final path are kept for the report', dd.title === HOME && typeof dd.fin === 'string' && dd.fin.length > 0, dd);
  ck('A9 homeAnswer exported', typeof FR.homeAnswer === 'function' && FR.homeAnswer('https://a.in/search?q=x', 'https://a.in/', '', 'x') === true, 0);

  // ---- item B: real saved Meesho cards (lakme search, 3 Nov 2026)
  var fx = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'snap_lakme2_search_2026-11-03.json');
  var arr = JSON.parse(fs.readFileSync(fx, 'utf8')).snapshots, mee = arr.filter(function (x) { return x.store === 'meesho' || /meesho/.test((x.snapshot || {}).url || ''); })[0];
  var mc = P.parseSearch(mee.snapshot).cards, sh = mc.filter(function (c) { return c.notes.indexOf('title_from_slug_shared') >= 0; });
  ck('B1 real Meesho lakme: 2 shared catalog titles now lead with the product name', sh.length === 2 && sh.every(function (c) { return /^Lakme Forever Matte Liquid Lip /.test(c.title) && /\(Lakme Lipsticks 6Ml\)$/.test(c.title) && c.titleSource === 'slug' && c.titlePartial === true && c.dbg.cardTitle === 'Lakme Lipsticks 6Ml'; }), sh.map(function (c) { return c.title; }));
  ck('B2 the two real Meesho cards now differ (Nude Pink vs Red Carpet)', sh.length === 2 && sh[0].title !== sh[1].title, sh.map(function (c) { return c.title; }));
  // boat case of the 0.10.27 report: card title "Bluetooth Headphones & Earphones", link /boat-airdopes-181-pro/p/aqdw82
  function msnap(items, host, q) { return { v: 1, kind: 'search', query: q, url: 'https://' + host + '/search?q=' + q, probe: 'x', cards: items.map(function (it) { return { link: it[0], sponsored: false, ad: false, html: '<div><a href="' + it[0] + '">' + it[1] + '</a></div>' }; }) }; }
  var b = P.parseSearch(msnap([
    ['https://www.meesho.com/boat-airdopes-181-pro/p/aqdw82', 'Bluetooth Headphones & Earphones \u20B91,199 \u20B92,999 60% off'],
    ['https://www.meesho.com/boat-wired-earphones-bassheads-100/p/bbbb11', 'Bluetooth Headphones & Earphones \u20B9399 \u20B9999 60% off'],
    ['https://www.meesho.com/unique-sports-watch-gold/p/cccc22', 'Smart Watches \u20B9499 \u20B9999 50% off']
  ], 'www.meesho.com', 'boat')).cards;
  ck('B3 boat case: product name leads, category in brackets', /^Boat Airdopes 181 Pro \(Bluetooth Headphones & Earphones\)$/.test(b[0].title) && /^Boat Wired Earphones Bassheads 100 \(/.test(b[1].title), b.map(function (c) { return c.title; }));
  ck('B4 a single (not shared) title is not touched', b[2].title === 'Smart Watches' && b[2].titleSource === 'card' && b[2].notes.indexOf('title_from_slug_shared') < 0, b[2]);
  // colour variants whose words are in the link stay as they are, on every store host
  var hosts = [['www.myntra.com', 'https://www.myntra.com/headphones/boat/boat-airdopes-141-gen-2-48hrs-playback-true-wireless-in-ear-headphones/36551541/buy', 'https://www.myntra.com/headphones/boat/boat-airdopes-141-gen-2-48hrs-playback-true-wireless-in-ear-headphones/36551542/buy', 'boAt Airdopes 141 Gen 2 Headphones'],
    ['www.ajio.com', 'https://www.ajio.com/chumbak-printed-apple-iphone-16-plus-back-cover/p/703694481_navy', 'https://www.ajio.com/chumbak-printed-apple-iphone-16-plus-back-cover/p/703694482_red', 'CHUMBAK Printed Apple iPhone 16 Plus Back Cover'],
    ['www.tatacliq.com', 'https://www.tatacliq.com/gripp-stellar-magsafe-case-for-iphone-17-pro-max-orange/p-mp000000029393023', 'https://www.tatacliq.com/gripp-stellar-magsafe-case-for-iphone-17-pro-max-orange/p-mp000000029393024', 'Gripp Stellar Mag-Safe Case For Iphone 17 Pro Max - Orange'],
    ['www.croma.com', 'https://www.croma.com/samsung-galaxy-s26-ultra-5g-12gb-ram-256gb-black-/p/327244', 'https://www.croma.com/samsung-galaxy-s26-ultra-5g-12gb-ram-256gb-black-/p/327245', 'SAMSUNG Galaxy S26 Ultra 5G (12GB RAM, 256GB, Black)']];
  hosts.forEach(function (h) {
    var r = P.parseSearch(msnap([[h[1], h[3] + ' \u20B91,599 \u20B93,000 46% off'], [h[2], h[3] + ' \u20B91,699 \u20B93,000 43% off']], h[0], 'x')).cards;
    ck('B5 ' + h[0] + ' variants with the words in the link keep the card title', r.length === 2 && r.every(function (c) { return c.notes.indexOf('title_from_slug_shared') < 0 && c.titleSource === 'card'; }), r.map(function (c) { return [c.title, c.titleSource, c.notes]; }));
  });
  ck('B6 parser version 1.0.23', P.version === '1.0.23', P.version);

  // ---- item C and D: report text
  var item = { id: 11, q: 'gaming laptop test', ai: true, tag: 'very long', on: 'laptop|gaming' };
  var snapOk = msnap([['https://www.amazon.in/Foo-Gaming-Laptop-RTX/dp/B000000001/ref=1', 'Foo Gaming Laptop RTX 16GB \u20B982,000'], ['https://www.amazon.in/Bar-Gaming-Laptop/dp/B000000002/ref=1', 'Bar Gaming Laptop \u20B968,000'], ['https://www.amazon.in/Baz-Laptop-Bag/dp/B000000003/ref=1', 'Baz Laptop Bag \u20B9500'], ['https://www.amazon.in/Qux-Gaming-Laptop-X/dp/B000000004/ref=1', 'Qux Gaming Laptop \u20B990,000']], 'www.amazon.in', 'x');
  var one = { ms: 5000, stores: [{ s: 'Amazon', st: 'ok', ms: 1500, n: 4 }, { s: 'Tata CLiQ', st: 'no_cards', ms: 22000, n: 0 }], rows: [], runs: [
    { store: 'Amazon', state: 'ok', snapshot: snapOk },
    { store: 'Tata CLiQ', state: 'no_cards', snapshot: { url: 'https://www.tatacliq.com/search/?searchCategory=all&text=x', title: 'Search results | Tata CLiQ', cards: [] }, diag: { readyState: 'complete', visibility: 'hidden', links: 12 } }
  ], ai: { rewrite: { search: 'gaming laptop', max_price: 70000 }, refine: { rounds: 0, asked: 0 } } };
  var s = DS.summarise(item, one, function (sn) { return P.parseSearch(sn); });
  var rep = DS.buildReport({ version: '0.10.28', sums: [s], queries: [item], seenAt: 'T', ua: 'u', totalS: 5 });
  ck('C1 report has the WHY 0 ROWS block with the max price', /WHY 0 ROWS: search words "gaming laptop test" \| max price 70000/.test(rep), rep.split('\n').filter(function (l) { return /WHY/.test(l); }));
  ck('C2 Amazon line: parsed 4, on-topic 4, under max 2, 3 cheapest with price and title', /- Amazon \| 4 \| 4 \| 2 \| 500 Baz Laptop Bag ;; 68000 Bar Gaming Laptop ;; 82000 Foo Gaming Laptop RTX 16GB/.test(rep), rep.split('\n').filter(function (l) { return /^    - Amazon/.test(l); }));
  ck('D1 tab store with no cards prints the page saw line (path, title, cards, ready, links)', /page saw: path \/search\/ \| title Search results \| Tata CLiQ \| cards 0 \| ready complete \| hidden \| links 12/.test(rep), rep.split('\n').filter(function (l) { return /page saw/.test(l); }));
  ck('D2 an ok store with cards has no page saw line', !/Amazon[^\n]*\n[^\n]*page saw/.test(rep), 0);
  var rep2 = DS.buildReport({ version: 'v', sums: [DS.summarise({ id: 12, q: 'xqzvtn', ai: false, tag: 'no result', on: '', nores: true }, { ms: 1, stores: [], rows: [], runs: [{ store: 'Amazon', state: 'ok', snapshot: snapOk }] }, function (sn) { return P.parseSearch(sn); })], queries: [item], seenAt: 'T', ua: 'u', totalS: 1 });
  ck('C3 the nonsense search (0 rows is right) gets no WHY block', !/WHY 0 ROWS/.test(rep2), 0);
  var longFd = DS.summarise(item, { ms: 1, stores: [{ s: 'Reliance Digital', st: 'no_cards', fb: 'no_cards', ft: 2, fd: { http: 200, bytes: 616229, head: HOME, robot: false, cards: 0, nr: false, title: HOME, fin: '/products' } }], rows: [], runs: [] }, P.parseSearch);
  ck('D3 fetch saw keeps title and final path (limit 420 chars)', /"title":"Online Electronic Shopping Store in India - Reliance Digital","fin":"\/products"/.test(longFd.stores[0].fd), longFd.stores[0].fd);
  console.log('test_s23_16: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
