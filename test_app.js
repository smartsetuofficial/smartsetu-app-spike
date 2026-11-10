/* smartsetu app / test_app v0.1 (S14-1). Run: node test_app.js. Mock plugin + captured fixture; no network, no phone. */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
var W = require('./src/webtabs.js');
var R = require('./www/runner_core.js');
require('./www/bundle.js');
var pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } }
function sha12(f) { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 12); }
function read(f) { return fs.readFileSync(path.join(__dirname, f), 'utf8'); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var fxDir = path.join(__dirname, '..', '..', 'tests', 'fixtures'), fxSnap = null;
if (fs.existsSync(fxDir)) {
  fs.readdirSync(fxDir).filter(function (f) { return /^snap_amazon_/.test(f); }).forEach(function (f) {
    if (fxSnap) return;
    try { var j = JSON.parse(fs.readFileSync(path.join(fxDir, f), 'utf8')); (j.snapshots || []).forEach(function (s) { if (!fxSnap && s.snapshot && s.snapshot.cards && s.snapshot.cards.length > 2 && /amazon/i.test(s.store)) fxSnap = s.snapshot; }); } catch (_) {}
  });
}

// Mock plugin. exec() really runs the injected code in a vm sandbox that has window.mobileApp.postMessage, like the store page has.
function mockPlugin(opt) {
  opt = opt || {};
  var st = { opened: [], closed: [], open: 0, maxOpen: 0, msgFns: [], loadFns: [], execs: 0, nextId: 1, unsubM: 0, unsubL: 0 };
  var urls = {};
  st.api = {
    open: function (o) {
      var id = 'w' + (st.nextId++); urls[id] = o.url; st.opened.push(o); st.open++; if (st.open > st.maxOpen) st.maxOpen = st.open;
      if (opt.loadBeforeId) st.loadFns.forEach(function (f) { f({ id: id }); });
      else setTimeout(function () { st.loadFns.forEach(function (f) { f({ id: id }); }); }, 2);
      return Promise.resolve(id);
    },
    exec: function (o) {
      st.execs++; st.lastCode = o.code;
      if (opt.noBridge) return Promise.resolve();
      var sb = { location: { href: urls[o.id] || '' }, document: opt.doc || { title: 'Access denied', body: { innerText: 'Please   verify\n you are human' }, querySelectorAll: function () { return [1, 2, 3]; } }, FX: fxSnap, console: console, JSON: JSON, Promise: Promise, setTimeout: setTimeout, String: String };
      sb.window = { mobileApp: { postMessage: function (m) { if (opt.dropExec && m.detail && m.detail.kind === 'exec') return; setTimeout(function () { st.msgFns.forEach(function (f) { f(opt.rawStyle ? { rawMessage: JSON.stringify(m) } : m); }); }, 1); } } };
      sb.window.location = sb.location;
      try { vm.runInNewContext(o.code, sb, { timeout: 2000 }); } catch (e) { return Promise.reject(e); }
      return Promise.resolve();
    },
    close: function (o) { st.closed.push(o.id); st.open--; return Promise.resolve(); },
    onMessage: function (fn) { st.msgFns.push(fn); return Promise.resolve(function () { st.unsubM++; st.msgFns = st.msgFns.filter(function (f) { return f !== fn; }); }); },
    onLoaded: function (fn) { st.loadFns.push(fn); return Promise.resolve(function () { st.unsubL++; st.loadFns = st.loadFns.filter(function (f) { return f !== fn; }); }); }
  };
  return st;
}
// page-side functions, must be self-contained (they are sent as source text, like executeScript func)
function pageOk(q, n) { return { echoed: q, n: n, href: location.href }; }
async function pageSlow(q) { await new Promise(function (r) { setTimeout(r, 20); }); return { slow: q }; }
function pageThrow() { throw new Error('boom'); }
function pageSnap(q) { var s = JSON.parse(JSON.stringify(FX)); s.url = location.href; s.query = q; return s; }
function pageUndef() { return undefined; }

(async function () {
  // A1 create / get / onUpdated: load event after the id is known
  var p1 = mockPlugin(), w1 = W.createWebTabs(p1.api);
  var heard = []; w1.tabs.onUpdated.addListener(function (id, info) { heard.push([id, info.status]); });
  var t1 = await w1.tabs.create({ url: 'https://www.amazon.in/s?k=x', active: false });
  var g0 = await w1.tabs.get(t1.id);
  ok(t1.id === 'w1' && g0.status === 'loading' && p1.opened[0].visible === false && p1.opened[0].url === 'https://www.amazon.in/s?k=x', 'A1 create opens hidden webview, status loading');
  await sleep(15);
  var g1 = await w1.tabs.get(t1.id);
  ok(g1.status === 'complete' && heard.length === 1 && heard[0][0] === 'w1' && heard[0][1] === 'complete', 'A1 load event makes the tab complete and tells listeners');
  // A2 early load (event before the id is returned) is not lost
  var p2 = mockPlugin({ loadBeforeId: true }), w2 = W.createWebTabs(p2.api);
  var t2 = await w2.tabs.create({ url: 'https://www.meesho.com/search?q=x', active: false });
  ok(t2.status === 'complete' && (await w2.tabs.get(t2.id)).status === 'complete', 'A2 page loaded before the id came back is still complete');
  // A3 active: true opens a visible webview
  var p3 = mockPlugin(), w3 = W.createWebTabs(p3.api); await w3.tabs.create({ url: 'https://x.test/', active: true });
  ok(p3.opened[0].visible === true, 'A3 foreground flag reaches the plugin');
  // A4 executeScript returns func result through the message bridge, args are passed, message styles both work
  [false, true].forEach(function () {});
  var p4 = mockPlugin(), w4 = W.createWebTabs(p4.api), t4 = await w4.tabs.create({ url: 'https://www.amazon.in/s?k=x' });
  var r4 = await w4.scripting.executeScript({ target: { tabId: t4.id }, func: pageOk, args: ['iphone 17pro', 7] });
  ok(r4 && r4[0] && r4[0].result.echoed === 'iphone 17pro' && r4[0].result.n === 7 && r4[0].result.href === 'https://www.amazon.in/s?k=x', 'A4 result and args round trip');
  var p4b = mockPlugin({ rawStyle: true }), w4b = W.createWebTabs(p4b.api), t4b = await w4b.tabs.create({ url: 'https://a.test/' });
  var r4b = await w4b.scripting.executeScript({ target: { tabId: t4b.id }, func: pageOk, args: ['q', 1] });
  ok(r4b[0].result.n === 1, 'A4 rawMessage style from the plugin also works');
  // A5 async func, two scripts at once keep their own answers, undefined becomes null
  var both = await Promise.all([w4.scripting.executeScript({ target: { tabId: t4.id }, func: pageSlow, args: ['one'] }), w4.scripting.executeScript({ target: { tabId: t4.id }, func: pageOk, args: ['two', 2] })]);
  ok(both[0][0].result.slow === 'one' && both[1][0].result.echoed === 'two', 'A5 two scripts at once do not mix answers');
  var ru = await w4.scripting.executeScript({ target: { tabId: t4.id }, func: pageUndef, args: [] });
  ok(ru[0].result === null, 'A5 undefined result becomes null');
  // A6 page script error becomes a rejected promise with the message
  var e6 = null; try { await w4.scripting.executeScript({ target: { tabId: t4.id }, func: pageThrow, args: [] }); } catch (e) { e6 = e; }
  ok(e6 && /boom/.test(e6.message), 'A6 page error reaches the caller');
  // A7 no bridge: times out with the "bridge missing" reason; page started but no answer: other reason
  var p7 = mockPlugin({ noBridge: true }), w7 = W.createWebTabs(p7.api, { execMs: 40 }), t7 = await w7.tabs.create({ url: 'https://a.test/' });
  var e7 = null; try { await w7.scripting.executeScript({ target: { tabId: t7.id }, func: pageOk, args: ['q', 1] }); } catch (e) { e7 = e; }
  ok(e7 && /no answer from the page/.test(e7.message), 'A7 missing bridge is named');
  var p7b = mockPlugin({ dropExec: true }), w7b = W.createWebTabs(p7b.api, { execMs: 40 }), t7b = await w7b.tabs.create({ url: 'https://a.test/' });
  var e7b = null; try { await w7b.scripting.executeScript({ target: { tabId: t7b.id }, func: pageOk, args: ['q', 1] }); } catch (e) { e7b = e; }
  ok(e7b && /page started/.test(e7b.message), 'A7 started-but-no-answer is told apart');
  // A8 remove closes the webview and fails a waiting script; dispose removes plugin listeners
  var p8 = mockPlugin({ dropExec: true }), w8 = W.createWebTabs(p8.api, { execMs: 5000 }), t8 = await w8.tabs.create({ url: 'https://a.test/' });
  var wait8 = w8.scripting.executeScript({ target: { tabId: t8.id }, func: pageOk, args: ['q', 1] }).then(function () { return null; }, function (e) { return e; });
  await sleep(10); await w8.tabs.remove(t8.id);
  var e8 = await wait8;
  ok(e8 && /tab closed/.test(e8.message) && p8.closed.length === 1 && p8.open === 0, 'A8 remove closes the webview and frees a waiting script');
  w8.dispose(); ok(p8.unsubM === 1 && p8.unsubL === 1, 'A8 dispose removes both plugin listeners');
  // A9 func must be a function
  var e9 = null; try { await w4.scripting.executeScript({ target: { tabId: t4.id }, func: 'alert(1)', args: [] }); } catch (e) { e9 = e; }
  ok(e9 && /func missing/.test(e9.message), 'A9 a string is not accepted as func');

  // A10 probe (test-build diagnostic): only when asked, cleared on the next page, also after a page error
  var p10 = mockPlugin(), w10 = W.createWebTabs(p10.api, { probe: true }), t10 = await w10.tabs.create({ url: 'https://www.flipkart.com/search?q=x' });
  await w10.scripting.executeScript({ target: { tabId: t10.id }, func: pageOk, args: ['q', 1] });
  var pr10 = w10.lastProbe();
  ok(pr10 && pr10.d.title === 'Access denied' && pr10.d.text === 'Please verify you are human' && pr10.d.items === 3 && /flipkart/.test(pr10.d.url), 'A10 probe gives title, url, short text, price-like count');
  await w10.tabs.create({ url: 'https://www.nykaa.com/' });
  ok(w10.lastProbe() === null, 'A10 probe is cleared when the next page opens');
  var t10c = await w10.tabs.create({ url: 'https://www.croma.com/' });
  try { await w10.scripting.executeScript({ target: { tabId: t10c.id }, func: pageThrow, args: [] }); } catch (_) {}
  ok(w10.lastProbe() && w10.lastProbe().d.title === 'Access denied', 'A10 probe also comes back after a page error');
  var p10b = mockPlugin(), w10b = W.createWebTabs(p10b.api), t10b = await w10b.tabs.create({ url: 'https://a.test/' });
  await w10b.scripting.executeScript({ target: { tabId: t10b.id }, func: pageOk, args: ['q', 1] });
  ok(w10b.lastProbe() === null && !/probeNow/.test(String(p10b.lastCode || '')), 'A10 no probe unless asked');

  // E: S14-1c data build helpers
  ok(W.sameSite('www.amazon.in', 'amazon.in') && W.sameSite('m.flipkart.com', 'www.flipkart.com') && !W.sameSite('amazon.in', 'amazon.com'), 'E1 sameSite');
  var runsE = [{ store: 'Amazon', state: 'ok', snapshot: { cards: [1] } }, { store: 'Flipkart', state: 'no_cards' }, { store: 'Myntra', state: 'off' }, { store: 'Croma', state: 'no_data' }, { store: 'Nykaa', state: 'error' }];
  ok(JSON.stringify(W.failingLabels(runsE)) === '["Flipkart","Croma"]', 'E2 only no_cards and no_data are retried');
  var enE = W.enabledOnly(R.STORES, ['Flipkart']);
  ok(enE.Flipkart === true && enE.Amazon === false && enE.Myntra === false && Object.keys(enE).length === 9, 'E3 enabledOnly turns on just the named stores');
  var outE = { runs: runsE.slice(), snapshots: [] };
  W.mergeRuns(outE, { runs: [{ store: 'Flipkart', state: 'ok', snapshot: { cards: [2] } }, { store: 'Amazon', state: 'off' }, { store: 'Croma', state: 'no_cards' }] });
  ok(outE.runs[1].state === 'ok' && outE.runs[1].retried === true && outE.runs[0].state === 'ok' && !outE.runs[0].retried && outE.runs[3].state === 'no_cards' && outE.snapshots.length === 2, 'E4 mergeRuns replaces retried stores, skips off, rebuilds snapshots');
  var cardsE = [{ ad: true, link: 'https://www.amazon.in/sspa/x', html: 'iphone' }, { link: 'https://evil.example/p/1', html: 'iphone' }, { link: 'http://www.amazon.in/dp/1', html: 'iphone' }, { sponsored: true, link: 'https://www.amazon.in/dp/2', html: 'iphone' }, { link: '/dp/B0CASE', html: 'phone case' }, { link: '/dp/B0IPHONE', html: 'Apple iPhone 17 Pro' }];
  var pk = W.pickProduct(cardsE, 'iphone 17pro', 'https://www.amazon.in/s?k=iphone');
  ok(pk && pk.url === 'https://www.amazon.in/dp/B0IPHONE', 'E5 pickProduct skips ads, other sites, http; prefers the listing with the first query word');
  ok(W.pickProduct([{ link: '/dp/1', html: 'x' }], 'iphone', 'https://www.amazon.in/s?k=a').url === 'https://www.amazon.in/dp/1' && W.pickProduct([], 'a', 'https://www.amazon.in/s') === null && W.pickProduct([{ link: '/p/1' }], 'a', 'not a url') === null, 'E5 fallbacks: first usable, none, bad search url');
  // E6 readPage: opens hidden, waits for load, runs the function, always closes, never throws
  var p6 = mockPlugin(), w6 = W.createWebTabs(p6.api);
  var r6 = await W.readPage(w6, 'https://www.amazon.in/dp/1', pageOk, { args: ['q', 5], settleMs: 5 });
  ok(r6.ok && r6.result.n === 5 && p6.opened[0].visible === false && p6.closed.length === 1 && p6.open === 0, 'E6 readPage returns the result and closes the page');
  var r6b = await W.readPage(w6, 'https://www.amazon.in/dp/1', pageThrow, { settleMs: 5 });
  ok(r6b.ok === false && /boom/.test(r6b.error) && p6.open === 0, 'E6 readPage reports a page error and still closes');
  var p6c = mockPlugin({ noBridge: true }), w6c = W.createWebTabs(p6c.api, { execMs: 40 });
  var r6c = await W.readPage(w6c, 'https://a.test/', pageOk, { settleMs: 5 });
  ok(r6c.ok === false && /no answer/.test(r6c.error) && p6c.open === 0, 'E6 readPage reports a silent page and closes');
  // E7 offerProbe through the real injection path with a fake page
  var clicks = [];
  var docO = { title: 'Apple iPhone 17 Pro | Store', body: { innerText: 'Apple iPhone 17 Pro\n\u20b91,29,900\nBank Offer\n10% Instant Discount on HDFC Bank Credit Card\nBuy now\nNo cost EMI from \u20b95,000 per month\nBank Offer\nsome very long line ' + new Array(40).join('offer ') + '\nDelivery by Tuesday' }, querySelectorAll: function () { return [{ innerText: 'Add to cart', click: function () { clicks.push('cart'); } }, { innerText: 'View all offers', click: function () { clicks.push('offers'); } }]; } };
  var p7 = mockPlugin({ doc: docO }), w7 = W.createWebTabs(p7.api);
  var r7 = await W.readPage(w7, 'https://www.flipkart.com/p/1', W.offerProbe, { settleMs: 5 });
  var d7 = r7.result || {};
  ok(r7.ok && d7.clicked === 1 && clicks.join() === 'offers' && d7.total === 3 && d7.lines.indexOf('10% Instant Discount on HDFC Bank Credit Card') >= 0 && d7.lines.indexOf('Buy now') < 0 && d7.lines.filter(function (l) { return l === 'Bank Offer'; }).length === 1, 'E7 offerProbe: clicks only the offers button, keeps offer lines once, drops other lines and very long lines');
  var l7 = W.offerLines('Flipkart', 'https://www.flipkart.com/p/1', r7);
  ok(l7[0] === 'Flipkart product page' && l7.indexOf('- Bank Offer') > 0 && /Offer-like lines: 3 \(expanded 1\)/.test(l7.join('|')), 'E7 offerLines text');
  ok(/could not read/.test(W.offerLines('Croma', 'x', { ok: false, error: 'boom' })[0]), 'E7 offerLines on a failed read');
  // E8 structureProbe on a small fake page tree
  function mk(tag, cls, kids, text, href) { var n = { tagName: tag.toUpperCase(), className: cls, children: kids || [], parentElement: null, _t: text || '', _h: href || null }; n.children.forEach(function (c) { c.parentElement = n; }); return n; }
  function txt(n) { return n._t + n.children.map(txt).join(' '); }
  function allOf(n, o) { o = o || []; n.children.forEach(function (c) { o.push(c); allOf(c, o); }); return o; }
  function wire(n) { Object.defineProperty(n, 'textContent', { get: function () { return txt(n); } }); n.getAttribute = function (k) { return k === 'href' ? n._h : null; }; n.querySelector = function () { return allOf(n).filter(function (c) { return c.tagName === 'A' && c._h; })[0] || null; }; n.children.forEach(wire); return n; }
  var card = mk('div', 'card x', [mk('a', 'lnk', [mk('span', 't', [], 'Apple iPhone 17 Pro')], '', '/p/apple-iphone-17-pro/itm1'), mk('div', 'pr', [mk('span', 'now', [], '\u20b91,27,900')])]);
  var root = wire(mk('body', '', [mk('div', 'grid', [card, mk('div', 'x', [mk('span', 'now', [], '\u20b9999')])])]));
  global.document = { querySelectorAll: function (s) { return s === 'a[href]' ? allOf(root).filter(function (c) { return c.tagName === 'A'; }) : allOf(root); } };
  var d8 = await W.structureProbe(); delete global.document;
  ok(d8.anchors === 1 && d8.priceLeaves === 2 && d8.samples.length === 2 && d8.samples[0].price === '\u20b91,27,900' && /^span\.now < div\.pr < div\.card/.test(d8.samples[0].chain) && d8.samples[0].href === '/p/apple-iphone-17-pro/itm1' && /Apple iPhone 17 Pro/.test(d8.samples[0].text) && /div\.grid/.test(d8.samples[1].chain), 'E8 structureProbe gives price element chain, link and text of the card');
  ok(/Sample 1: /.test(W.structLines('Flipkart', { ok: true, result: d8 }).join('|')) && /could not read/.test(W.structLines('Croma', { ok: false, error: 'x' })[0]), 'E8 structLines');

  // F: S14-1d (line shapes from the owner's phone 9 Nov 2026; the prose lines here are our own words)
  var linesF = ['Apple iPhone 17 Pro 256 GB, Silver', 'MRP \u20b91,34,900.00 (Inclusive of all taxes)4% OFF', '10% up to Rs.15000 Instant Discount with IndusInd Bank Credit Card EMI', 'Flat Rs. 7000 Instant Discount with Kotak Bank Credit Card EMI', 'I love how premium this feels in my hand, the finish is great and the price is fair for what you get today.', 'Verdict: Great phone. Save your money for this one and look no further.', 'Save upto \u20b917,500', 'Exchange Offer', 'Offer Price', 'You Save', 'See all offers & discounts', 'Amazon Pay ICICI Bank Credit Card', 'EMI \u20b926,118 x 6m', 'Extra 35% off on First Order', 'Bank offers are many and you can check the bank site for the full list of card terms before you pay today', 'Premium EMI plans available', 'Premium finish and great price', 'Bank offer applies. Check details'];
  var clicksF = [];
  var docF = { title: 'T', body: { innerText: linesF.join('\n') }, querySelectorAll: function () { return [
    { tagName: 'A', innerText: 'View all offers', getAttribute: function () { return '/offers/page'; }, click: function () { clicksF.push('navlink'); } },
    { tagName: 'A', innerText: 'See all offers & discounts', getAttribute: function () { return '#'; }, click: function () { clicksF.push('hashlink'); } },
    { tagName: 'BUTTON', innerText: 'Add to cart', click: function () { clicksF.push('cart'); } }]; } };
  var pF = mockPlugin({ doc: docF }), wF = W.createWebTabs(pF.api);
  var rF = await W.readPage(wF, 'https://www.amazon.in/dp/1', W.offerProbe, { settleMs: 5 }), dF = rF.result || {};
  ok(rF.ok && clicksF.join() === 'hashlink' && dF.clicked === 1, 'F1 offerProbe clicks a link-less offers control, never a link that leaves the page, never Add to cart');
  ok(dF.lines.join('|') === 'MRP \u20b91,34,900.00 (Inclusive of all taxes)4% OFF|10% up to Rs.15000 Instant Discount with IndusInd Bank Credit Card EMI|Flat Rs. 7000 Instant Discount with Kotak Bank Credit Card EMI|Save upto \u20b917,500|Amazon Pay ICICI Bank Credit Card|EMI \u20b926,118 x 6m|Extra 35% off on First Order|Premium EMI plans available', 'F2 offerProbe keeps offer lines and drops prose, titles and bare labels (premium is not EMI)');
  var viewF = { top: null, groups: [{ rows: [{ store: 'Reliance Digital', url: 'https://www.reliancedigital.in/product/x' }, { store: 'Amazon', url: 'http://www.amazon.in/dp/B0HTTP' }, { store: 'Amazon', url: 'https://www.amazon.in/dp/B0X' }] }, { rows: [{ store: 'Croma', url: 'https://evil.example/p' }] }] };
  ok(W.pickFromView(viewF, 'Amazon', 'https://www.amazon.in/s?k=a').url === 'https://www.amazon.in/dp/B0X' && W.pickFromView(viewF, 'Reliance Digital', 'https://www.reliancedigital.in/search').url === 'https://www.reliancedigital.in/product/x', 'F3 pickFromView takes the first https matched row of that store');
  ok(/W\.pickFromView\(view, r\.store, st\.url\(q\)\)/.test(read('src/app.js')) && !/W\.pickProduct\(/.test(read('src/app.js')), 'F3b app opens the product page of a matched row only');
  ok(W.pickFromView(viewF, 'Croma', 'https://www.croma.com/s') === null && W.pickFromView(viewF, 'Flipkart', 'https://www.flipkart.com/s') === null && W.pickFromView(null, 'Amazon', 'https://www.amazon.in/s') === null && W.pickFromView({ top: { rows: [{ store: 'Ajio', url: 'https://www.ajio.com/p/1' }] }, groups: [] }, 'Ajio', 'https://www.ajio.com/s').url === 'https://www.ajio.com/p/1', 'F3 no matched row, other site or no view gives null; the top table rows count');
  var pD = mockPlugin(), wD = W.createWebTabs(pD.api);
  await wD.tabs.create({ url: 'https://a.test/' }); var tD2 = await wD.tabs.create({ url: 'https://b.test/' }); await wD.tabs.remove(tD2.id); wD.dispose(); await sleep(5);
  ok(pD.closed.length === 2, 'F4 dispose closes a page that is still open, a removed page is closed once');
  ok(d8.linkSamples.length === 1 && d8.linkSamples[0] === '/p/apple-iphone-17-pro/itm1 "Apple iPhone 17 Pro"' && /Link 1: \/p\/apple/.test(W.structLines('Flipkart', { ok: true, result: d8 }).join('|')), 'F5 structure shows the first page links (href and text)');
  var deep = mk('span', 'p', [], '\u20b91,27,900'); for (var iD = 0; iD < 10; iD++) deep = mk('div', 'w' + iD, [deep]);
  var rootD = wire(mk('body', '', [mk('div', 'card', [mk('a', 'l', [], '', '/p/deep'), deep])]));
  global.document = { querySelectorAll: function (s) { return s === 'a[href]' ? allOf(rootD).filter(function (c) { return c.tagName === 'A'; }) : allOf(rootD); } };
  var dD = await W.structureProbe(); delete global.document;
  ok(dD.samples.length === 1 && dD.samples[0].href === '/p/deep' && dD.samples[0].chain.split(' < ').length === 12, 'F6 structure looks 14 levels up for the card link (was 8)');

  // G: S14-1e (one read answers every open question about an empty store; copy report)
  function wire2(n) { wire(n); (function w(x) { x.getAttribute = function (k) { return k === 'href' ? x._h : (x._a && Object.prototype.hasOwnProperty.call(x._a, k) ? x._a[k] : null); }; x.attributes = Object.keys(x._a || {}).map(function (k) { return { name: k }; }); x.children.forEach(w); })(n); return n; }
  var cardG = mk('div', 'card y', [mk('span', 't', [], 'Apple iPhone 17 Pro'), mk('span', 'now', [], '\u20b91,27,900')]); cardG._a = { onclick: 'go()' };
  var rootG = wire2(mk('body', '', [mk('div', 'grid', [cardG, mk('a', 'dead', [], 'x', '')])]));
  rootG.children[0].children[1]._h = '';
  var bodyG = { innerText: 'Access denied. Please verify you are human (captcha). Update pincode', scrollHeight: 0 };
  global.document = { body: bodyG, querySelectorAll: function (s) { return s === 'a[href]' ? allOf(rootG).filter(function (c) { return c.tagName === 'A'; }) : allOf(rootG); } };
  var dG = await W.structureProbe(); delete global.document;
  ok(dG.textLen === bodyG.innerText.length && dG.emptyHref === 1 && dG.clickable === 1 && dG.frames === 0 && dG.shadow === 0, 'G1 structureProbe counts text length, empty-href links, clickable non-links, iframes, shadow roots');
  ok(dG.markers.indexOf('captcha') >= 0 && dG.markers.indexOf('access denied') >= 0 && dG.markers.indexOf('pincode') >= 0 && dG.markers.indexOf('robot') < 0, 'G2 structureProbe lists page markers (captcha, access denied, pincode) and only those present');
  ok(/^body\(div\.grid/.test(dG.skeleton) && /div\.card\[onclick\]/.test(dG.skeleton) && /span\.now/.test(dG.skeleton) && dG.skeleton.indexOf('Apple') < 0 && dG.skeleton.indexOf('go()') < 0, 'G3 skeleton has tag, class and attribute names only, no page text and no attribute values');
  ok(Array.isArray(dG.scroll) && dG.scroll.length === 0 && dG.after === null && typeof dG.hints.productClass === 'number', 'G4 no window to scroll in Node: scroll list empty, no crash');
  var gridS = mk('div', 'grid', []), rootS = wire2(mk('body', '', [gridS])), scrolled = 0;
  global.window = { scrollTo: function () { scrolled++; if (scrolled === 1) { var c = mk('div', 'card z', [mk('span', 'now', [], '\u20b954,999')]); c.parentElement = gridS; gridS.children.push(c); wire2(c); } } };
  global.document = { body: { innerText: 'x', scrollHeight: 900 }, querySelectorAll: function (s) { return s === 'a[href]' ? [] : allOf(rootS); } };
  var dS = await W.structureProbe(); delete global.document; delete global.window;
  ok(scrolled === 3 && dS.priceLeaves === 0 && dS.scroll.length === 3 && dS.scroll[0].leaves === 1 && dS.after && dS.after.priceLeaves === 1 && dS.after.samples[0].price === '\u20b954,999', 'G5 scrolls 3 times, recounts, and reads the card shape again when the first read had no price element (late loading)');
  var docG = { title: 'T', body: { innerText: 'Hello pincode' }, querySelectorAll: function () { return []; } };
  var rG = await W.readPage(W.createWebTabs(mockPlugin({ doc: docG }).api), 'https://www.croma.com/s', W.structureProbe, { settleMs: 5 });
  ok(rG.ok && rG.result.textLen === 13 && rG.result.markers.join() === 'pincode' && rG.result.scroll.length === 0, 'G6 structureProbe runs as page source text through the bridge (async, no window.scrollTo)');
  var sl = W.structLines('Flipkart', { ok: true, result: dS }).join('|'), sl2 = W.structLines('Flipkart', { ok: true, result: dG }).join('|');
  ok(/After scrolling: 1\) price elements 1/.test(sl) && /After-scroll sample 1: \u20b954,999/.test(sl) && /Page text length: \d+, iframes: 0, shadow roots: 0, links with empty href: 1, clickable non-links: 1/.test(sl2) && /Markers on page: .*captcha/.test(sl2) && /Skeleton: body\(div\.grid/.test(sl2) && /Hints: product\/card classes \d+/.test(sl2), 'G7 structLines shows the new fields');
  var rpt = W.buildReport({ version: '0.6.0', query: 'iphone 17pro', seenAt: 'now', totalS: 400, ua: 'Chrome/140.0.0.0', error: 'boom', runs: [{ store: 'Amazon', state: 'ok', cards: 24, ms: 11200 }, { store: 'Flipkart', state: 'no_cards', cards: 0, ms: 61000, retried: true }], rows: [{ store: 'Reliance Digital', title: 'Apple iPhone 17 Pro 256 GB, Silver', price: '\u20b91,29,900' }], diag: ['Croma', 'Title: T'], struct: [], offers: ['Amazon product page'] });
  ok(/test build 0\.6\.0/.test(rpt) && /ERROR during the run: boom/.test(rpt) && /- Amazon \| ok \| 24 \| 11 \| 1st/.test(rpt) && /- Flipkart \| no_cards \| 0 \| 61 \| 2nd try \(desktop identity\)/.test(rpt) && /- Reliance Digital \| \u20b91,29,900 \| Apple iPhone 17 Pro 256 GB, Silver/.test(rpt) && /PAGE STRUCTURE\n- \(none\)/.test(rpt) && /OFFERS FROM PRODUCT PAGES\nAmazon product page/.test(rpt), 'G8 buildReport: stores with state, count, seconds and pass; rows; sections; empty section says none; error line');
  ok(W.buildReport().split('\n').length > 5 && /RESULT ROWS[^]*- \(none\)/.test(W.buildReport()), 'G9 buildReport with no data does not throw');

  // H: S14-1f (one final data round: every listing read is shown, long wait + scroll for a timed-out store, tile lines flagged)
  var stCroma = R.STORES.filter(function (s) { return s.label === 'Croma'; })[0];
  function pageCards(q) { return { v: 1, kind: 'search', query: q, url: location.href, cards: [{ link: 'https://www.croma.com/p/1', html: '<div>Apple iPhone 17 Pro</div>' }] }; }
  function pageEmpty(q) { return { v: 1, query: q, url: location.href, cards: [] }; }
  var runsH = [{ store: 'Amazon', state: 'ok', snapshot: fxSnap || { url: 'https://www.amazon.in/s?k=x', cards: [] } }, { store: 'Croma', state: 'timeout' }, { store: 'Ajio', state: 'ok', snapshot: { url: 'https://unknown.example/s', cards: [{ link: 'x', html: 'y' }] } }];
  var pAm = global.SmartSetu.parseSearch(runsH[0].snapshot), lh = W.listingLines(runsH, [], global.SmartSetu.parseSearch);
  ok(/^Store Amazon: \d+ cards read, \d+ parsed, skipped: /.test(lh[0]) && lh.filter(function (l) { return /^Store /.test(l); }).length === 2 && /^Store Ajio: 1 cards read, 0 parsed, skipped: none/.test(lh.filter(function (l) { return /^Store Ajio/.test(l); })[0]) && !lh.some(function (l) { return /^Store Croma/.test(l); }), 'H1 listingLines: a header for each store that has a snapshot, none for a store without one');
  if (pAm.cards.length > 1) {
    var lh2 = W.listingLines(runsH, [{ url: pAm.cards[0].url + '?ref=x' }], global.SmartSetu.parseSearch);
    ok(/^- in result \| (\u20b9[\d,]+|no price) \| (card|slug|aria-label) \| .+/.test(lh2[1]) && lh2.filter(function (l) { return /^- in result/.test(l); }).length === 1 && /^- not in result \| /.test(lh2[2]), 'H2 listingLines: each parsed listing has result flag, price, title source, title; the matched row is found even with a query string');
  } else console.log('SKIP H2: fixture has fewer than 2 parsed Amazon cards');
  var stub = function () { return { cards: [{ url: 'https://www.amazon.in/dp/B1', priceNow: 129900, titleSource: 'slug', title: 'T' }], skipped: { sponsored_or_ad: 7 } }; };
  var adCards = []; for (var iA = 0; iA < 8; iA++) adCards.push({ sponsored: true, html: '<div>Sponsored <b>Apple</b> iPhone 17 Pro ' + iA + '</div>' });
  var lh3 = W.listingLines([{ store: 'Amazon', snapshot: { cards: adCards } }], [{ url: 'https://www.amazon.in/dp/B1?x=1' }], stub);
  ok(lh3[0] === 'Store Amazon: 8 cards read, 1 parsed, skipped: sponsored_or_ad 7' && lh3[1] === '- in result | \u20b9129,900 | slug | T' && lh3.filter(function (l) { return /^- skipped ad \| /.test(l); }).length === 5 && lh3[2] === '- skipped ad | Sponsored Apple iPhone 17 Pro 0', 'H3 listingLines: skipped reasons, price format, at most 5 skipped ads with plain text');
  var many = []; for (var iM = 0; iM < 40; iM++) many.push({ url: 'https://www.amazon.in/dp/B' + iM, priceNow: 100 + iM, titleSource: 'card', title: 'Item ' + iM });
  var lhM = W.listingLines([{ store: 'Amazon', snapshot: { cards: [] } }], [], function () { return { cards: many, skipped: {} }; });
  ok(lhM.length === 31 && lhM[0] === 'Store Amazon: 0 cards read, 40 parsed, skipped: none' && /Item 29$/.test(lhM[30]), 'H3b listingLines: at most 30 listings per store, the header still gives the real count');
  ok(W.listingLines([{ store: 'X', snapshot: { cards: [] } }], [], function () { throw new Error('bad'); }).join('|') === 'Store X: could not parse (bad)' && W.listingLines(null, null, stub).length === 0, 'H4 listingLines: a parser error becomes one line, no runs gives nothing');
  var rH = W.buildReport({ version: '0.7.0', query: 'q', runs: [{ store: 'Croma', state: 'timeout', ms: 110000, stage: 'reading', stageMs: 41000, loaded: true, slow: true, retried: true }, { store: 'Nykaa', state: 'error', ms: 3000, error: 'no answer\nfrom page', loaded: false }, { store: 'Amazon', state: 'ok', cards: 3, ms: 9000, rereads: 1 }], rows: [], listings: ['Store Amazon: 3 cards read, 3 parsed, skipped: none', '- in result | x'] });
  ok(/- Croma \| timeout \| - \| 110 \| 3rd try \(long wait \+ scroll, desktop identity\) \| stopped at: reading \(41 s in that step\) \| page loaded: yes/.test(rH) && /- Nykaa \| error \| - \| 3 \| 1st \| page loaded: no \| error: no answer from page/.test(rH) && /- Amazon \| ok \| 3 \| 9 \| 1st \| rereads: 1/.test(rH) && /ALL LISTINGS READ[^\n]*\nStore Amazon: 3 cards read[^]*\n- in result \| x\n\nDIAGNOSTIC/.test(rH) && /ALL LISTINGS READ[^\n]*\n- \(none\)/.test(W.buildReport({ runs: [] })), 'H5 buildReport: stage and error of a failed store, 3rd try label, ALL LISTINGS section before DIAGNOSTIC');
  var oneTile = ['5% OFF', '\u20b985,999 with Bank offer', 'Rs. 52,249 with Bank offer', '\u20b939,999 with No Cost EMI offer', '18%  off'];
  var noTile = ['Save upto \u20b917,500', '10% up to Rs.15000 Instant Discount with IndusInd Bank Credit Card EMI', 'Flat Rs. 7000 Instant Discount with Kotak Bank Credit Card EMI', 'MRP \u20b91,34,900.00 (Inclusive of all taxes)4% OFF', '\u20b97,000 off', 'Bank offers', 'Extra 35% off on First Order'];
  ok(oneTile.every(function (l) { return W.isTileLine(l); }) && noTile.every(function (l) { return !W.isTileLine(l); }) && W.isTileLine(null) === false, 'H6 isTileLine: price-with-offer and bare percent lines only');
  var oH = W.offerLines('Flipkart', 'https://www.flipkart.com/p/1', { ok: true, result: { title: 'T', url: 'https://www.flipkart.com/p/1', total: 8, clicked: 1, lines: ['Bank offers', '\u20b97,000 off', '5% OFF', '\u20b917,499 with No Cost EMI offer', '18% OFF', '\u20b985,999 with Bank offer', 'Flat Rs. 7000 Instant Discount with Kotak Bank Credit Card EMI', 'MRP \u20b91,34,900.00 (Inclusive of all taxes)4% OFF'] } }).join('\n');
  ok(/Offer-like lines: 8 \(expanded 1\)\n- Bank offers\n- \u20b97,000 off\n- Flat Rs\. 7000 Instant Discount with Kotak Bank Credit Card EMI\n- MRP [^\n]*4% OFF\nTile-like lines \(probably other products, not offers of this product\): 4\n\? 5% OFF\n\? \u20b917,499 with No Cost EMI offer\n\? 18% OFF\n\? \u20b985,999 with Bank offer$/.test(oH) && !/\n- 5% OFF/.test(oH), 'H7 offerLines (all stores): tile-like lines are listed apart, real offers stay, nothing is hidden');
  ok(W.offerLines('Reliance Digital', 'https://x/', { ok: true, result: { total: 1, clicked: 0, lines: ['10% Instant Discount with Punjab National Bank Credit Card'] } }).join('|').indexOf('Tile-like') < 0, 'H7b a page with no tile lines has no Tile section');
  var pH = mockPlugin(), wH = W.createWebTabs(pH.api);
  var sH = await W.slowRead(wH, stCroma, 'iphone 17 pro', pageCards, { settleMs: 5, loadMs: 2000, totalMs: 4000 });
  ok(sH.state === 'ok' && sH.slow === true && sH.retried === true && sH.cards === 1 && sH.snapshot.cards.length === 1 && /croma/.test(sH.snapshot.url) && sH.store === 'Croma' && sH.key === stCroma.key && pH.execs === 2 && pH.opened.length === 1 && pH.opened[0].visible === false && pH.closed.length === 1 && pH.open === 0, 'H8 slowRead: one hidden page, scroll then collect, run shape as runner_core, page closed');
  var sH2 = await W.slowRead(W.createWebTabs(mockPlugin().api), stCroma, 'x', pageEmpty, { settleMs: 5, loadMs: 2000, totalMs: 4000 }), sH3 = await W.slowRead(W.createWebTabs(mockPlugin().api), stCroma, 'x', pageUndef, { settleMs: 5, loadMs: 2000, totalMs: 4000 });
  ok(sH2.state === 'no_cards' && sH2.snapshot && sH3.state === 'no_data' && !sH3.snapshot, 'H9 slowRead: empty list is no_cards, no answer object is no_data');
  var pT = mockPlugin({ dropExec: true }), wT = W.createWebTabs(pT.api, { execMs: 5000 });
  var sT = await W.slowRead(wT, stCroma, 'x', pageCards, { settleMs: 5, loadMs: 2000, totalMs: 700 }); await sleep(40);
  ok(sT.state === 'timeout' && sT.stage === 'scrolling' && sT.slow === true && sT.stageMs >= 0 && sT.loaded === true && pT.open === 0 && pT.closed.length === 1 && pT.execs === 1, 'H10 slowRead: over time it reports where it stopped, closes the page, starts no more page scripts');
  var pE2 = mockPlugin({ noBridge: true }), wE2 = W.createWebTabs(pE2.api, { execMs: 30 });
  var sE2 = await W.slowRead(wE2, stCroma, 'x', pageCards, { settleMs: 5, loadMs: 2000, totalMs: 3000 });
  ok(sE2.state === 'error' && /no answer/.test(sE2.error) && sE2.stage === 'reading' && pE2.open === 0, 'H11 slowRead: a silent page is an error with the step, page closed, no throw');
  var pL = mockPlugin(), wL = W.createWebTabs(pL.api), sL = await W.slowRead(wL, { label: 'Zed', key: 'zed', url: function () { return 'https://www.zed.test/s'; } }, 'x', pageCards, { settleMs: 5, loadMs: 20, totalMs: 4000 });
  ok(sL.state === 'ok' && sL.store === 'Zed', 'H12 slowRead works for any store config (not tied to Croma)');
  var runsM = [{ store: 'Croma', state: 'timeout' }, { store: 'Amazon', state: 'ok', snapshot: { cards: [1] } }, { store: 'Myntra', state: 'off' }, { store: 'Nykaa', state: 'no_cards' }], outM = { runs: runsM.slice(), snapshots: [] };
  ok(JSON.stringify(W.timedOutLabels(runsM)) === '["Croma"]' && JSON.stringify(W.timedOutLabels(null)) === '[]', 'H13 timedOutLabels: only timeout');
  W.mergeRuns(outM, { runs: [sH] });
  ok(outM.runs[0].state === 'ok' && outM.runs[0].slow === true && outM.snapshots.length === 2, 'H14 a slow run replaces the timed-out run and its snapshot is used');
  var appH = read('src/app.js');
  ok(/VERSION = '0\.8\.2'/.test(appH) && /W\.timedOutLabels\(out\.runs\)/.test(appH) && /W\.slowRead\(tabs2, storeOf\(slowL\[sl\]\), q, smartsetuCollect, \{\}\)/.test(appH) && /listings: W\.listingLines\(out \? out\.runs : \[\], view \? W\.rowsOf\(view\) : \[\], SmartSetu\.parseSearch\)/.test(appH) && /run\.slow \? '3rd try \(long wait\): '/.test(appH) && (appH.match(/\.runAll\(/g) || []).length === 2, 'H15 app wiring: slow third try, listings in report, 3rd-try label, still only 2 runAll calls');

  // B: the real runner_core with the shim: 9 stores, Myntra off, one webview at a time, all closed, Amazon read and compared
  if (fxSnap) {
    var pb = mockPlugin(), wb = W.createWebTabs(pb.api), seen = [];
    var out = await R.runAll(wb, { query: 'boat airdopes 141', enabled: W.enabledMap(), foreground: false, rereads: 0, loadMs: 2000, settleMs: 0, rereadMs: 0, collect: pageSnap, onUpdate: function (r) { seen.push(r.store + ':' + r.state); }, maxTabs: 1, perStoreMs: 5000, retryTimeouts: false });
    wb.dispose();
    var by = {}; out.runs.forEach(function (r) { by[r.store] = r; });
    ok(out.runs.length === 9 && by['Myntra'].state === 'off' && by['Amazon'].state === 'ok' && by['Amazon'].cards > 2, 'B1 9 stores, Myntra off, Amazon read');
    ok(pb.opened.length === 8 && pb.opened.every(function (o) { return o.visible === false; }) && !pb.opened.some(function (o) { return /myntra/.test(o.url); }), 'B2 8 hidden webviews, none for Myntra');
    ok(pb.maxOpen === 1 && pb.open === 0 && pb.closed.length === 8, 'B3 never 2 webviews at once, all closed at the end');
    var res = global.SmartSetu.compareAny({ query: 'boat airdopes 141', searches: out.snapshots, products: [], seenAt: out.seenAt });
    ok(res && out.snapshots.length >= 1, 'B4 compare engine accepts the read snapshots');
    // B5 a store whose page never answers is reported as an error with the reason, the others still run
    var pc = mockPlugin(), wc = W.createWebTabs(pc.api, { execMs: 60 });
    var out2 = await R.runAll(wc, { query: 'x', enabled: {}, foreground: false, rereads: 0, loadMs: 500, settleMs: 0, rereadMs: 0, collect: pageSnap, maxTabs: 1, perStoreMs: 3000, retryTimeouts: false });
    wc.dispose();
    ok(out2.runs.length === 9 && out2.runs.filter(function (r) { return r.state !== 'off'; }).length === 9, 'B5 all 9 stores run when none is switched off');
  } else console.log('SKIP B tests: no captured Amazon snapshot found next to the package');

  // C: screen text for off / error stores (pure)
  ok(W.lineText({ state: 'off', key: 'myntra' }, 'Switched off') === 'No data on the phone app yet', 'C1 Myntra off line says why');
  ok(W.lineText({ state: 'off', key: 'ajio' }, 'Switched off') === 'Switched off', 'C1 another store keeps the view text');
  ok(/^Could not open \(no answer from the page/.test(W.lineText({ state: 'error', key: 'amazon', error: 'no answer from the page (bridge missing)' }, 'Could not open')) && W.lineText({ state: 'ok', key: 'amazon' }, 'Read 5 listings') === 'Read 5 listings', 'C2 error line gets the short reason, ok line is unchanged');
  ok(W.lineText({ state: 'error', key: 'a', error: new Array(300).join('x') }, 'T').length <= 100, 'C2 error reason is cut short');
  ok(JSON.stringify(W.enabledMap()) === '{"Myntra":false}', 'C3 only Myntra is off');
  ok(W.lineText({ state: 'no_cards', key: 'flipkart' }, 'No listings found on the page (page complete, hidden tab, 4 links, read 3 times)') === 'No listings found on the page (page complete, hidden page, 4 links, read 3 times)', 'C4 hidden tab becomes hidden page');
  ok(W.diagLines('Croma', null)[0] === 'Croma: no page data came back' && W.diagLines('Croma', { title: 'T', url: 'https://x/', items: 2, text: 'hi' }).length === 5 && W.diagLines('Croma', { error: 'x' }).length === 1, 'C5 diagnostic lines');

  // J: S14-1g card rescue (page function + read + report), same function for every store (D-073)
  function jn(tag, cls, kids, text, href) { var n = { tagName: tag.toUpperCase(), className: cls || '', children: kids || [], parentElement: null, _t: text || '', _h: href || null, nodeType: 1 }; n.children.forEach(function (c) { c.parentElement = n; }); return n; }
  function jtx(n) { return n._t + n.children.map(jtx).join(' '); }
  function jall(n, o) { o = o || []; n.children.forEach(function (c) { o.push(c); jall(c, o); }); return o; }
  function jwire(n, host) {
    Object.defineProperty(n, 'textContent', { get: function () { return jtx(n); } });
    Object.defineProperty(n, 'innerText', { get: function () { return jtx(n); } });
    if (n._h) n.href = 'https://' + host + n._h;
    n.getAttribute = function (k) { return k === 'href' ? n._h : (k === 'class' ? n.className : null); };
    n.querySelectorAll = function (sel) { return sel === 'a[href]' ? jall(n).filter(function (c) { return c.tagName === 'A' && c._h; }) : jall(n); };
    n.children.forEach(function (c) { jwire(c, host); });
    return n;
  }
  function jdeep(depth, leaf) { var n = leaf; for (var i = 0; i < depth; i++) n = jn('div', 'w' + i, [n]); return n; }
  function jpage(host, root, href) {
    jwire(root, host);
    global.document = { body: root, title: 'Search', querySelectorAll: function () { return jall(root); } };
    global.window = { scrollTo: function () {} }; global.location = { hostname: host, href: href || 'https://' + host + '/search?q=x' };
    global.getComputedStyle = function (e) { return { textDecorationLine: e._struck ? 'line-through' : 'none' }; };
  }
  function jdone() { delete global.document; delete global.window; delete global.location; delete global.getComputedStyle; }
  function jcard(title, href, price, mrp, depth) {
    var pr = [jn('span', 'now', [], price)]; if (mrp) { var m = jn('span', 'was', [], mrp); m._struck = true; pr.push(m); }
    return jn('div', 'card', [jn('a', 'lnk', [jn('span', 't', [], title)], '', href), jdeep(depth, jn('div', 'pr', pr))]);
  }
  var jr1 = jn('body', '', [jn('div', 'grid', [jcard('Apple iPhone 17 Pro (Silver, 256 GB)', '/apple-iphone-17-pro/p/itm111?pid=A', '\u20b91,12,900', '\u20b91,29,900', 9), jcard('Apple iPhone 17 Pro (Blue, 512 GB)', '/apple-iphone-17-pro/p/itm222?pid=B', '\u20b91,34,900', null, 9)])]);
  jpage('www.flipkart.com', jr1);
  var cr1 = await W.cardRescue(1); jdone();
  ok(cr1.cards.length === 2 && cr1.outcome.picked === 2 && cr1.leaves === 2 && cr1.dump.length === 0, 'J1 rescue finds both deep cards (struck MRP not counted as a price element): ' + JSON.stringify(cr1.outcome));
  ok(/itm111/.test(cr1.cards[0].link) && cr1.cards[0].sponsored === false && /data-struck="1"/.test(cr1.cards[0].html) && /Apple iPhone 17 Pro \(Silver, 256 GB\)/.test(cr1.cards[0].html) && cr1.cards[0].html.indexOf('<script') < 0, 'J2 card html keeps title, link and the struck marker');
  var jps = SmartSetu.parseSearch({ v: 1, kind: 'search', query: 'iphone 17 pro', url: 'https://www.flipkart.com/search?q=x', cards: cr1.cards, probe: 'x' });
  ok(jps.status === 'ok' && jps.cards.length === 2 && jps.cards[0].priceNow === 112900 && jps.cards[0].mrp === 129900 && jps.cards[0].title === 'Apple iPhone 17 Pro (Silver, 256 GB)' && jps.cards[1].priceNow === 134900, 'J3 the same parser reads the rescued cards (price, MRP, title): ' + JSON.stringify(jps.cards.map(function (c) { return [c.title, c.priceNow, c.mrp]; })));
  var jr4 = jn('body', '', [jn('div', 'row', [jn('a', '', [jn('span', '', [], 'Phone one name here long')], '', '/a/p/itm1'), jn('span', '', [], '\u20b950,000'), jn('a', '', [jn('span', '', [], 'Phone two name here long')], '', '/b/p/itm2'), jn('a', '', [jn('span', '', [], 'Phone three name here')], '', '/c/p/itm3')])]);
  jpage('www.flipkart.com', jr4); var cr4 = await W.cardRescue(1); jdone();
  ok(cr4.cards.length === 0 && cr4.outcome.grid === 1 && cr4.dump.length === 1 && cr4.dump[0].why === 'grid' && /50,000/.test(cr4.dump[0].html), 'J4 a wrapper with 3 product links is not a card; its cut html goes into the dump');
  var jr5 = jn('body', '', [jn('div', 'hd', [jn('span', '', [], 'Update pincode'), jn('span', 'p', [], '\u20b9999')])]);
  jpage('www.croma.com', jr5); var cr5 = await W.cardRescue(1); jdone();
  ok(cr5.cards.length === 0 && cr5.outcome.nolink === 1 && cr5.dump[0].why === 'nolink', 'J5 no link above a price -> no card, honest nolink count');
  var jr6 = jn('body', '', [jn('div', 'c', [jn('a', '', [jn('span', '', [], 'Some long product name here again')], '', '/x/p/itm9'), jn('span', '', [], '\u20b95,000')])]);
  jpage('www.flipkart.com', jr6); jall(jr6).forEach(function (n) { if (n.href) n.href = 'https://evil.example.com/x/p/itm9'; });
  var cr6 = await W.cardRescue(1); jdone();
  ok(cr6.cards.length === 0, 'J6 links to another host are not used');
  jpage('www.nykaa.com', jn('body', '', [jn('div', '', [jcard('Nykaa Matte Lipstick Red Shade 3.7 g', '/nykaa-lipstick/p/123456', '\u20b9499', null, 3)])]));
  var jctx = { document: global.document, window: global.window, location: global.location, getComputedStyle: global.getComputedStyle, URL: URL, setTimeout: setTimeout };
  var cr7 = await vm.runInNewContext('(' + W.cardRescue.toString() + ')(1)', jctx); jdone();
  ok(cr7.cards.length === 1 && cr7.cards[0].link === 'https://www.nykaa.com/nykaa-lipstick/p/123456', 'J7 cardRescue has no outside references (runs from its source text)');
  function jwt(page, fail) { return { tabs: { create: async function () { return { id: 7 }; }, get: async function () { return { status: 'complete' }; }, remove: async function () {} }, scripting: { executeScript: async function (o) { if (fail) throw new Error('boom'); page(); var r = await o.func.apply(null, o.args); jdone(); return [{ result: r }]; } } }; }
  var jstore = { label: 'Flipkart', key: 'flipkart', url: function (q) { return 'https://www.flipkart.com/search?q=' + encodeURIComponent(q); } };
  var rr1 = await W.rescueRead(jwt(function () { jpage('www.flipkart.com', jn('body', '', [jn('div', '', [jcard('Apple iPhone 17 Pro (Silver, 256 GB)', '/apple-iphone-17-pro/p/itm111', '\u20b91,12,900', null, 9)])])); }), jstore, 'iphone 17 pro', { settleMs: 1, waitMs: 1 });
  ok(rr1.state === 'ok' && rr1.cards === 1 && rr1.rescued === true && rr1.snapshot.kind === 'search' && rr1.snapshot.cards.length === 1 && rr1.store === 'Flipkart' && rr1.key === 'flipkart' && SmartSetu.parseSearch(rr1.snapshot).cards.length === 1, 'J8 rescueRead returns an ok run with a snapshot the parser reads');
  var rr2 = await W.rescueRead(jwt(function () { jpage('www.flipkart.com', jn('body', '', [jn('div', '', [jn('span', '', [], 'hello')])])); }), jstore, 'x', { settleMs: 1, waitMs: 1 });
  ok(rr2.state === 'no_cards' && rr2.cards === 0 && rr2.rescue && rr2.snapshot === undefined, 'J9 no card -> no_cards run, no snapshot');
  var rr3 = await W.rescueRead(jwt(null, true), jstore, 'x', { settleMs: 1, waitMs: 1 });
  ok(rr3.state === 'error' && /boom/.test(rr3.error) && W.rescueLines('Flipkart', rr3)[0].indexOf('could not read') > 0, 'J10 a failing read gives an error run and a report line, never throws');
  var rl = W.rescueLines('Flipkart', { state: 'no_cards', rescue: { url: 'https://www.flipkart.com/search?q=x', leaves: 59, outcome: { picked: 0, grid: 40, nolink: 19, dup: 0 }, dump: [{ price: '\u20b91,12,900', why: 'grid', html: '<div class="a">x</div>' }] } });
  ok(rl.length === 2 && /still 0 cards/.test(rl[0]) && /price elements 59/.test(rl[0]) && /grid 40/.test(rl[0]) && /^Cut html 1 /.test(rl[1]), 'J11 rescue report lines show counts and the cut html');
  var jrep = W.buildReport({ version: 'v', rescue: ['Flipkart rescue: x'] });
  ok(/CARD RESCUE \(S14-1g\)/.test(jrep) && /Flipkart rescue: x/.test(jrep), 'J12 report has a CARD RESCUE section');
  ok(/W\.rescueRead\(tabs2, storeOf\(empty\[em\]\), q, \{\}\)/.test(appH) && /var empty = W\.failingLabels\(out\.runs\)/.test(appH) && /rescue: rep\.rescue/.test(appH) && /rr\.state === 'ok'/.test(appH) && (appH.match(/\.runAll\(/g) || []).length === 2, 'J13 app wiring: rescue only for stores still empty, an ok run replaces the empty one, report carries it, still 2 runAll');
  var rescSrc = W.cardRescue.toString();
  ok(rescSrc.indexOf('fetch(') < 0 && rescSrc.indexOf('XMLHttpRequest') < 0 && rescSrc.indexOf('localStorage') < 0 && rescSrc.indexOf('document.cookie') < 0 && rescSrc.indexOf('eval(') < 0, 'J14 page function reads only: no network, storage, cookie, eval');

  // J15-J17: limits of the climb (14 levels, 1500 characters) and the same card reached from two price elements
  jpage('www.flipkart.com', jn('body', '', [jn('div', '', [jcard('Far away card name long enough', '/far/p/itm5', '\u20b97,000', null, 16)])]));
  var cr15 = await W.cardRescue(1); jdone();
  ok(cr15.cards.length === 0 && cr15.outcome.nolink === 1, 'J15 the climb stops after 14 levels');
  jpage('www.flipkart.com', jn('body', '', [jn('div', '', [jn('a', '', [jn('span', '', [], 'Long text product name here')], '', '/long/p/itm6'), jn('p', '', [], new Array(400).join('word ')), jn('span', '', [], '\u20b98,000')])]));
  var cr16 = await W.cardRescue(1); jdone();
  ok(cr16.cards.length === 0, 'J16 a block with more than 1500 characters of text is not taken as one card');
  jpage('www.flipkart.com', jn('body', '', [jn('div', '', [jn('a', '', [jn('span', '', [], 'Two prices one card name')], '', '/two/p/itm7'), jn('span', '', [], '\u20b99,000'), jn('span', '', [], '\u20b98,500')])]));
  var cr17 = await W.cardRescue(1); jdone();
  ok(cr17.cards.length === 1 && cr17.outcome.picked === 1 && cr17.outcome.dup === 1, 'J17 two price elements of one card give one card');

  // K: S14-1h Croma line says what the page showed (option A, owner 9 Nov), other stores keep the view text
  ok(W.lineText({ state: 'no_cards', key: 'croma' }, 'No listings found on the page (page complete, hidden tab, 11 links, read 3 times)') === "No listings found on the page (page complete, hidden page, 11 links, read 3 times). Croma's page asks for a pincode, so no products were shown.", 'K1 Croma no-listings line adds the pincode note');
  ok(W.lineText({ state: 'no_cards', key: 'nykaa' }, 'No listings found on the page (x)') === 'No listings found on the page (x)', 'K2 another store keeps its own text');
  ok(W.lineText({ state: 'ok', key: 'croma' }, 'Read 5 listings') === 'Read 5 listings', 'K3 Croma with listings has no note');
  ok(W.lineText({ state: 'error', key: 'croma', error: 'boom' }, 'Could not open') === 'Could not open (boom)', 'K4 Croma error keeps the error text');

  // L: S14-1i the report shows the cut html of listings that have no price (every store), and every offers block is closed by a marker
  var lraw = function (id, extra) { return { link: 'https://www.amazon.in/dp/' + id, html: '<div class="s-card"><a href="/dp/' + id + '"><span>Apple iPhone 17 Pro 256 GB test listing</span></a>' + (extra || '') + '</div>' }; };
  var lstub = function (cards) { return function () { return { cards: cards, skipped: {} }; }; };
  var lc = function (id, price) { return { url: 'https://www.amazon.in/dp/' + id + '?ref=1', title: 'Apple iPhone 17 Pro 256 GB', priceNow: price, titleSource: 'card' }; };
  var l1 = W.listingLines([{ store: 'Amazon', snapshot: { cards: [lraw('B0AAAAAAA1'), lraw('B0AAAAAAA2'), lraw('B0AAAAAAA3'), lraw('B0AAAAAAA4')] } }], [], lstub([lc('B0AAAAAAA1', null), lc('B0AAAAAAA2', 99900), lc('B0AAAAAAA3', null), lc('B0AAAAAAA4', null)]));
  var lh1 = l1.filter(function (x) { return /^- no-price card html/.test(x); });
  ok(lh1.length === 2 && /^- no-price card html 1 \| Apple iPhone 17 Pro 256 GB \| <div class="s-card"><a href="\/dp\/B0AAAAAAA1">/.test(lh1[0]) && /html 2 .*B0AAAAAAA3/.test(lh1[1]), 'L1 first 2 price-less listings get their cut html, a priced one gets none');
  var l2 = W.listingLines([{ store: 'Ajio', snapshot: { cards: [lraw('B0BBBBBBB1')] } }], [], lstub([lc('B0ZZZZZZZZ', null)]));
  ok(l2.some(function (x) { return /no-price card html 1 .*\(raw card not found for this listing\)/.test(x); }), 'L2 a price-less listing without a raw card says so, no invented html');
  var l3 = W.listingLines([{ store: 'Amazon', snapshot: { cards: [lraw('B0CCCCCCC1', new Array(300).join('word '))] } }], [], lstub([lc('B0CCCCCCC1', null)]));
  ok(l3.filter(function (x) { return /no-price card html/.test(x); })[0].length < 1400, 'L3 the html is cut to 1200 characters');
  var l4 = W.listingLines([{ store: 'Amazon', snapshot: { cards: [{ link: 'https://www.amazon.in/dp/B0DDDDDDD1', html: '<div>Price \u20b999,900</div>' }] } }], [], lstub([lc('B0DDDDDDD1', 99900)]));
  ok(!l4.some(function (x) { return /no-price card html/.test(x); }), 'L4 priced listings add no html lines');
  var lreal = global.SmartSetu.parseSearch({ v: 1, kind: 'search', query: 'iphone', url: 'https://www.amazon.in/s?k=iphone', probe: 'x', cards: [{ link: 'https://www.amazon.in/dp/B0EEEEEEE1', sponsored: false, ad: false, html: '<div class="s-card"><a href="https://www.amazon.in/dp/B0EEEEEEE1"><h2>Apple iPhone 17 Pro 256 GB: 15.93 cm Display</h2></a></div>' }] });
  var l5 = W.listingLines([{ store: 'Amazon', snapshot: { cards: [{ link: 'https://www.amazon.in/dp/B0EEEEEEE1', sponsored: false, ad: false, html: '<div class="s-card"><a href="https://www.amazon.in/dp/B0EEEEEEE1"><h2>Apple iPhone 17 Pro 256 GB: 15.93 cm Display</h2></a></div>' }], v: 1, kind: 'search', query: 'iphone', url: 'https://www.amazon.in/s?k=iphone', probe: 'x' } }], [], global.SmartSetu.parseSearch);
  ok(lreal.cards.length === 1 && lreal.cards[0].priceNow == null && l5.some(function (x) { return /^- no-price card html 1 \| .*<h2>Apple iPhone 17 Pro 256 GB/.test(x); }), 'L5 with the real parser: a card without a price prints its own html');
  ok(/rep\.offers\.push\('--- end of ' \+ r\.store \+ ' block \(' \+ lines\.length \+ ' lines\) ---'\)/.test(appH), 'L6 each offers block ends with a marker line');

  // D: shipped files
  var ext = path.join(__dirname, '..', 'extension'), www = path.join(__dirname, 'www');
  if (fs.existsSync(ext)) ok(['pagesnap.js', 'bundle.js', 'runner_core.js', 'view.js', 'compare.css'].every(function (f) { return sha12(path.join(www, f)) === sha12(path.join(ext, f)); }), 'D1 www copies equal the extension files');
  var cfg = JSON.parse(read('capacitor.config.json')), pkg = JSON.parse(read('package.json')), appjs = read('src/app.js'), html = read('www/index.html'), yml = read('.github/workflows/apk.yml');
  ok(cfg.appId === 'in.smartsetu.app' && cfg.appName === 'SmartSetu' && cfg.webDir === 'www', 'D2 app id and name (D-080)');
  ok(pkg.version === '0.8.2' && /probe: true/.test(appjs) && (appjs.match(/showDiag\(\)/g) || []).length >= 2, 'D3b app version and diagnostic wired');
  ok(/test_app\.js/.test(pkg.scripts.test) && /test_spike\.js/.test(pkg.scripts.test), 'D3 npm test runs both test files');
  ok(appjs.indexOf('innerHTML') < 0 && appjs.indexOf('localStorage') < 0 && appjs.indexOf('fetch(') < 0 && appjs.indexOf('eval(') < 0, 'D4 app.js: no innerHTML, no storage, no network call, no eval');
  ok((appjs.match(/\.runAll\(/g) || []).length === 2 && appjs.indexOf('.runAll(') > appjs.indexOf('async function onSubmit') && /addEventListener\('submit', onSubmit\)/.test(appjs), 'D5 runAll only inside the Compare submit handler (D-010)');
  ok(/customUserAgent/.test(appjs) && /readOffers\(out, q, tabs, tabs2, view\)/.test(appjs) && /structureProbe/.test(appjs) && /offerProbe/.test(appjs) && /desktopUa\(navigator\.userAgent\)/.test(appjs) && /retry && run\.state === 'off'/.test(appjs), 'D6b second try, structure and offers are wired');
  ok(/maxTabs: 1/.test(appjs) && /foreground: false/.test(appjs) && /enabledMap\(\)/.test(appjs), 'D6 one store at a time, hidden, Myntra off');
  var order = ['bundle.js', 'pagesnap.js', 'runner_core.js', 'view.js', 'app.js'].map(function (f) { return html.indexOf('src="' + f + '"'); });
  ok(order.every(function (x, i) { return x >= 0 && (i === 0 || x > order[i - 1]); }), 'D7 index.html loads the 5 scripts in order');
  ok(html.indexOf('<form') >= 0 && html.indexOf('viewport-fit=cover') >= 0 && html.indexOf('SmartSetu') >= 0 && html.indexOf('Spike') < 0, 'D8 index.html is the app screen (form, safe area, no spike text)');
  ok(/workflow_dispatch/.test(yml) && !/^\s+push:/m.test(yml) && /smartsetu-debug-apk/.test(yml) && /npm test/.test(yml), 'D9 workflow is manual, runs tests, artifact name smartsetu-debug-apk');
  ok(/function showReport\(/.test(appjs) && /function copyReport\(/.test(appjs) && /W\.buildReport\(/.test(appjs) && /finally \{[^}]*showReport\(q, out, view, err, t0\)/.test(appjs) && /navigator\.clipboard/.test(appjs) && /execCommand\('copy'\)/.test(appjs) && /\.then\(function \(\) \{[^}]*\}, fallback\); else fallback\(\);/.test(appjs) && /addEventListener\('click', copyReport\)/.test(appjs), 'D11 app builds the report in finally (also after an error) and copies it by clipboard with a select fallback');
  ok(/id="report"[^>]*hidden/.test(html) && /id="copyrep"/.test(html) && /id="reptext"[^>]*readonly/.test(html), 'D12 index.html has the hidden report box, Copy button and read-only text box');
  ok(fs.existsSync(path.join(__dirname, '.gitignore')) && /www\/app\.js/.test(read('.gitignore')), 'D10 built www/app.js stays out of git');
  console.log('test_app: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
