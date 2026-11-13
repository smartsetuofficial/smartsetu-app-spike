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
  ok(!/readOffers|W\.pickFromView|W\.offerProbe|W\.pickProduct\(/.test(read('src/app.js')), 'F3b release app opens no product page and reads no offers (D-093)');
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
  ok(lhM.length === 32 && /^- cheapest card html /.test(lhM[31]) && lhM[0] === 'Store Amazon: 0 cards read, 40 parsed, skipped: none' && /Item 29$/.test(lhM[30]), 'H3b listingLines: at most 30 listings per store, the header still gives the real count');
  ok(W.listingLines([{ store: 'X', snapshot: { cards: [] } }], [], function () { throw new Error('bad'); }).join('|') === 'Store X: could not parse (bad)' && W.listingLines(null, null, stub).length === 0, 'H4 listingLines: a parser error becomes one line, no runs gives nothing');
  var rH = W.buildReport({ version: '0.7.0', query: 'q', runs: [{ store: 'Croma', state: 'timeout', ms: 110000, stage: 'reading', stageMs: 41000, loaded: true, slow: true, retried: true }, { store: 'Nykaa', state: 'error', ms: 3000, error: 'no answer\nfrom page', loaded: false }, { store: 'Amazon', state: 'ok', cards: 3, ms: 9000, rereads: 1 }], rows: [], listings: ['Store Amazon: 3 cards read, 3 parsed, skipped: none', '- in result | x'] });
  ok(/- Croma \| timeout \| - \| 110 \| 3rd try \(long wait \+ scroll, desktop identity\) \| stopped at: reading \(41 s in that step\) \| page loaded: yes/.test(rH) && /- Nykaa \| error \| - \| 3 \| 1st \| page loaded: no \| error: no answer from page/.test(rH) && /- Amazon \| ok \| 3 \| 9 \| 1st \| rereads: 1/.test(rH) && /\nDIAGNOSTIC[^]*\n\nALL LISTINGS READ[^\n]*\nStore Amazon: 3 cards read[^]*\n- in result \| x/.test(rH) && /ALL LISTINGS READ[^\n]*\n- \(none\)/.test(W.buildReport({ runs: [] })), 'H5 buildReport: stage and error of a failed store, 3rd try label, DIAGNOSTIC section before ALL LISTINGS (V-307: short parts first, the report can be cut when pasted)');
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
  ok(/VERSION = '0\.10\.6'/.test(appH) && /W\.timedOutLabels\(out\.runs\)/.test(appH) && /W\.slowRead\(tabs2, storeOf\(slowL\[sl\]\), q, smartsetuCollect, \{\}\)/.test(appH) && /run\.slow \? '3rd try'/.test(appH) && (appH.match(/\.runAll\(/g) || []).length === 1 && (appH.match(/runStores\(/g) || []).length === 3, 'H15 app wiring: slow third try, 3rd-try label, one runAll inside runStores, 2 callers');

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
  ok(/W\.rescueRead\(tabs2, storeOf\(empty\[em\]\), q, \{\}\)/.test(appH) && /var empty = W\.failingLabels\(out\.runs\)/.test(appH) && /rr\.state === 'ok'/.test(appH) && (appH.match(/\.runAll\(/g) || []).length === 1 && (appH.match(/runStores\(/g) || []).length === 3, 'J13 app wiring: rescue only for stores still empty, an ok run replaces the empty one, one runAll inside runStores');
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
  ok(!/\brep\b|diag\[|struct\[|lastProbe|probe: true/.test(appH), 'L6 release app keeps no diagnostic state (D-093)');

  // D: shipped files
  var ext = path.join(__dirname, '..', 'extension'), www = path.join(__dirname, 'www');
  if (fs.existsSync(ext)) ok(['pagesnap.js', 'bundle.js', 'runner_core.js', 'view.js', 'compare.css'].every(function (f) { return sha12(path.join(www, f)) === sha12(path.join(ext, f)); }), 'D1 www copies equal the extension files');
  var cfg = JSON.parse(read('capacitor.config.json')), pkg = JSON.parse(read('package.json')), appjs = read('src/app.js'), html = read('www/index.html'), yml = read('.github/workflows/apk.yml');
  ok(cfg.appId === 'in.smartsetu.app' && cfg.appName === 'SmartSetu' && cfg.webDir === 'www', 'D2 app id and name (D-080)');
  ok(pkg.version === '0.10.6' && !/probe: true/.test(appjs) && !/showDiag|showReport|copyReport/.test(appjs), 'D3b app version 0.10.6, no diagnostic or report wired in app.js (the hidden store test lives in devtest.js, D-096)');
  ok(/test_app\.js/.test(pkg.scripts.test) && /test_spike\.js/.test(pkg.scripts.test), 'D3 npm test runs both test files');
  ok(appjs.indexOf('innerHTML') < 0 && appjs.indexOf('localStorage') < 0 && appjs.indexOf('fetch(') < 0 && appjs.indexOf('eval(') < 0, 'D4 app.js: no innerHTML, no storage, no network call, no eval');
  ok((appjs.match(/\.runAll\(/g) || []).length === 1 && (appjs.match(/runStores\(/g) || []).length === 3 && appjs.indexOf('await runStores(') > appjs.indexOf('async function startRun') && (appjs.match(/startRun\(/g) || []).length === 3 && /addEventListener\('submit', onSubmit\)/.test(appjs) && /getElementById\('morebtn'\)|\$\('morebtn'\)\.addEventListener\('click'/.test(appjs), 'D5 stores start only inside startRun, reached only from the Compare submit or the also-check tap (D-010)');
  ok(/customUserAgent/.test(appjs) && !/readOffers|structureProbe|offerProbe/.test(appjs) && /desktopUa\(navigator\.userAgent\)/.test(appjs) && /retry && run\.state === 'off'/.test(appjs), 'D6b second try kept, structure and offers reads gone');
  ok(/maxTabs: 1/.test(appjs) && /foreground: false/.test(appjs) && /enabledMap\(\)/.test(appjs), 'D6 one store at a time, hidden, Myntra off');
  var order = ['bundle.js', 'pagesnap.js', 'runner_core.js', 'view.js', 'app.js'].map(function (f) { return html.indexOf('src="' + f + '"'); });
  ok(order.every(function (x, i) { return x >= 0 && (i === 0 || x > order[i - 1]); }), 'D7 index.html loads the 5 scripts in order');
  ok(html.indexOf('<form') >= 0 && html.indexOf('viewport-fit=cover') >= 0 && html.indexOf('SmartSetu') >= 0 && html.indexOf('Spike') < 0, 'D8 index.html is the app screen (form, safe area, no spike text)');
  ok(/workflow_dispatch/.test(yml) && !/^\s+push:/m.test(yml) && /smartsetu-debug-apk/.test(yml) && /npm test/.test(yml), 'D9 workflow is manual, runs tests, artifact name smartsetu-debug-apk');
  ok(!/showReport|copyReport|buildReport|navigator\.clipboard|execCommand/.test(appjs), 'D11 release app has no report builder and no clipboard code');
  ok(!/id="report"|copyrep|reptext/.test(html) && !/test build|test version|owner's own phone|diagnostic/i.test(html + appjs), 'D12 no report box and no test-build wording in index.html or app.js (D-082)');
  var relPath = path.join(__dirname, '.github', 'workflows', 'release-apk.yml');
  ok(fs.existsSync(relPath), 'D14 signed release workflow file exists');
  var ry = fs.existsSync(relPath) ? fs.readFileSync(relPath, 'utf8') : '';
  var secretLines = ry.split('\n').filter(function (l) { return /secrets\./.test(l); });
  ok(/workflow_dispatch/.test(ry) && !/^\s+push:/m.test(ry) && secretLines.length === 2 && secretLines.every(function (l) { return /^\s+KS_(B64|PASS): \$\{\{ secrets\.SMARTSETU_KEYSTORE_(B64|PASS) \}\}$/.test(l); }) && !/echo[^\n]*\$\{?KS_PASS/.test(ry) && !/--ks-pass pass:/.test(ry), 'D14b release workflow: manual only, secrets only as env, password never echoed or put on the command line');
  var iz = ry.indexOf('zipalign" -P 16 -f'), isg = ry.indexOf('apksigner" sign'), iv = ry.indexOf('apksigner" verify');
  ok(iz > 0 && isg > iz && iv > isg && /--ks-pass env:KS_PASS/.test(ry) && /EXPECTED_CERT_SHA256: '[0-9a-f]{64}'/.test(ry) && /smartsetu-release-apk/.test(ry) && /npm test/.test(ry) && /if: always\(\)/.test(ry) && /rm -f "\$RUNNER_TEMP\/release\.pfx"/.test(ry) && /package: name='in\.smartsetu\.app'/.test(ry), 'D14c release workflow: zipalign before apksigner, then verify, expected certificate pinned, key file removed, package name checked');
  var gi = read('.gitignore');
  ok(/\*\.pfx/.test(gi) && /\*\.jks/.test(gi) && /\*\.keystore/.test(gi) && /\*\.p12/.test(gi), 'D14d .gitignore keeps key files out of git');
  ok(fs.existsSync(path.join(__dirname, '.gitignore')) && /www\/app\.js/.test(read('.gitignore')), 'D10 built www/app.js stays out of git');

  // U: S14-4 app look (D-095). Pure helpers, shipped css and html, icon and splash files, workflow step.
  var U = require('./src/uihelp.js'), Wt = require('./src/webtabs.js');
  ok(U.shortLine({ state: 'ok', key: 'amazon' }, 'Read 24 listings in 10 s (read again 2 times)').text === 'Read 24 listings in 10 s' && U.shortLine({ state: 'ok' }, 'Read 24 listings in 10 s').kind === 'ok', 'U1 ok line loses the technical bracket, kind ok');
  var uc = U.shortLine({ state: 'no_cards', key: 'croma' }, "No listings found on the page (page complete, hidden page, 11 links, read 3 times). Croma's page asks for a pincode, so no products were shown.");
  ok(uc.kind === 'skip' && uc.text === 'Skipped: asks for a pincode' && !/links|hidden page|read 3 times/.test(uc.text), 'U2 Croma pincode line is short and plain');
  ok(Object.keys(U.SKIP_TEXT).every(function (k) { return Wt.NOCARDS_NOTE[k]; }), 'U3 every short skip text has its webtabs note (same store keys)');
  ok(U.shortLine({ state: 'no_cards', key: 'ajio' }, 'x').text === 'No listings found' && U.shortLine({ state: 'timeout' }, 'Took too long (stuck while loading, 50 s)').text === 'Took too long' && U.shortLine({ state: 'error' }, 'Could not open the page (net::ERR)').kind === 'bad' && U.shortLine({ state: 'no_data' }, 'x').text === 'No readable data', 'U4 other failures: one short plain line each, no error codes');
  ok(U.shortLine({ state: 'off', key: 'myntra' }, 'No data on the phone app yet').text === 'No data on the phone app yet' && U.shortLine({ state: 'off' }, 'Switched off').kind === 'off' && U.shortLine({ state: 'retrying' }, 'x').text === 'Trying once more...', 'U5 off and retrying lines');
  ok(U.doneCount({ A: 'ok', B: 'off', C: 'retrying', D: 'timeout', E: undefined }) === 3 && U.doneCount({}) === 0, 'U6 progress counts only finished stores (retrying and waiting do not count)');
  var gA = { comparable: true, note: 'N1', rows: [1, 2] }, gB = { comparable: true, note: 'N1', rows: [1, 2] }, gC = { comparable: false, note: 'N2', rows: [1] }, gD = { comparable: false, note: 'N2', rows: [1] };
  var sg = U.splitGroups([gA, gC, gB, gD], 'specific');
  ok(sg.multi.length === 2 && sg.single.length === 2 && sg.multiNote === 'N1' && sg.singleNote === 'N2', 'U7 compared listings first with one shared note, one-store listings folded with one shared note');
  var sg1 = U.splitGroups([gA, gC], 'specific');
  ok(sg1.multi.length === 1 && sg1.multiNote === '' && sg1.single.length === 1 && sg1.singleNote === '', 'U8 one compared listing keeps its own note, nothing shared');
  var sg2 = U.splitGroups([gC, gD], 'specific'), sg3 = U.splitGroups([gA, gC], 'similar');
  ok(sg2.multi.length === 2 && sg2.single.length === 0 && sg3.multi.length === 2 && sg3.single.length === 0, 'U9 nothing is hidden when no listing was compared, or for similar-products results');
  ok(U.splitGroups(null, 'specific').multi.length === 0 && U.splitGroups([gA, { comparable: true, note: 'N9', rows: [1, 2] }], 'specific').multiNote === '', 'U10 empty input is safe, different notes are not merged');
  var css = read('www/app.css'), cmpCss = read('www/compare.css');
  ok(html.indexOf('href="compare.css"') >= 0 && html.indexOf('href="app.css"') > html.indexOf('href="compare.css"') && html.indexOf('name="theme-color"') > 0 && /id="pbar"[^>]*role="progressbar"/.test(html) && html.indexOf('id="pcount"') > 0 && html.indexOf('id="pfill"') > 0, 'U11 index.html loads app.css after compare.css, has the progress bar and theme colour');
  ok(!/https?:\/\//.test(css) && !/https?:\/\/(?!www\.w3\.org)/.test(html) && !/@import/.test(css) && !/url\((?!fonts\/Inter-(Regular|Medium|Bold)\.woff2\))/.test(css), 'U12 app.css and index.html call no other host (only the 3 bundled Inter files)');
  ok(/prefers-reduced-motion/.test(css) && cmpCss.indexOf('.ic') < 0, 'U13 reduced motion respected, shared compare.css left alone');
  ok(/require\('\.\/uihelp\.js'\)/.test(appjs) && /U\.shortLine\(/.test(appjs) && /U\.splitGroups\(/.test(appjs) && /U\.doneCount\(/.test(appjs) && /classList\.remove\('running'\)/.test(appjs) && /VERSION = '0\.10\.6'/.test(appjs), 'U14 app.js uses the helpers, stops the progress animation in finally');
  function pngSize(f) { var b = fs.readFileSync(f); return b.slice(0, 8).toString('hex') === '89504e470d0a1a0a' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; }
  var resDir = path.join(__dirname, 'resources', 'android', 'res'), fgS = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 }, lgS = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  var iconsOk = Object.keys(fgS).every(function (d) {
    var f = pngSize(path.join(resDir, 'mipmap-' + d, 'ic_launcher_foreground.png')), l = pngSize(path.join(resDir, 'mipmap-' + d, 'ic_launcher.png')), r = pngSize(path.join(resDir, 'mipmap-' + d, 'ic_launcher_round.png'));
    return f && l && r && f[0] === fgS[d] && f[1] === fgS[d] && l[0] === lgS[d] && l[1] === lgS[d] && r[0] === lgS[d] && r[1] === lgS[d];
  });
  ok(iconsOk, 'U15 launcher icons: 15 PNG files, right pixel size for every density');
  var spDirs = ['drawable', 'drawable-port-mdpi', 'drawable-port-hdpi', 'drawable-port-xhdpi', 'drawable-port-xxhdpi', 'drawable-port-xxxhdpi', 'drawable-land-mdpi', 'drawable-land-hdpi', 'drawable-land-xhdpi', 'drawable-land-xxhdpi', 'drawable-land-xxxhdpi'];
  ok(spDirs.every(function (d) { var z = pngSize(path.join(resDir, d, 'splash.png')); return z && z[0] > 0 && z[1] > 0; }) && pngSize(path.join(resDir, 'drawable-port-xhdpi', 'splash.png')).join('x') === '720x1280' && pngSize(path.join(resDir, 'drawable-land-xhdpi', 'splash.png')).join('x') === '1280x720', 'U16 splash: 11 PNG files, same sizes as the Capacitor template');
  ok(/#0F766E/.test(read('resources/android/res/values/ic_launcher_background.xml')) && /name="ic_launcher_background"/.test(read('resources/android/res/values/ic_launcher_background.xml')), 'U17 adaptive icon background colour is the brand teal');
  var ryml = read('.github/workflows/release-apk.yml'), dyml = read('.github/workflows/apk.yml');
  function stepOrder(y) { var a = y.indexOf('cap sync android'), b = y.indexOf('name: Apply SmartSetu icon and splash'), c = y.indexOf('cp -R resources/android/res/. android/app/src/main/res/'), d = y.indexOf('./gradlew assemble'); return a > 0 && b > a && c > b && d > c; }
  ok(stepOrder(ryml) && stepOrder(dyml), 'U18 both workflows copy the icon and splash files after cap sync and before Gradle');

  // S15 (D-096): which store sells what, native fast read, live results, hidden store test, Inter font, new screen.
  var SM = require('./src/storemap.js'), NFm = require('./src/nativefetch.js'), DT = require('./src/devtest.js'), Rn = require('./www/runner_core.js');
  var stK = Rn.STORES.map(function (x) { return x.key; }), pk = function (q) { return SM.pick(q, Rn.STORES); };
  ok(Object.keys(SM.SELLS).sort().join() === stK.slice().sort().join() && SM.SELLS.amazon.length === 7 && SM.SELLS.flipkart.length === 7, 'S1 every runner store has an entry in the store map, Amazon and Flipkart sell everything');
  ok(SM.classify('iPhone 17 Pro')[0] === 'mobile' && SM.classify('boAt Airdopes 141')[0] === 'gadget' && SM.classify('red tape shoes for men')[0] === 'fashion' && SM.classify('Ponds cream')[0] === 'beauty' && SM.classify('Samsung washing machine')[0] === 'appliance' && SM.classify('xyz widget').length === 0 && SM.classify('').length === 0 && SM.classify(null).length === 0, 'S2 query kinds: phone, gadget, fashion, beauty, appliance, unknown, empty');
  var pI = pk('iPhone 17 Pro');
  ok(pI.keys.join() === 'amazon,flipkart,tatacliq,croma,reliancedigital' && !!pI.skip.myntra && !!pI.skip.ajio && !!pI.skip.nykaa && !!pI.skip.meesho && /phones/.test(pI.skip.myntra), 'S3 a phone search skips the fashion and beauty stores and says why');
  ok(pk('xyz widget').keys.length === 9 && Object.keys(pk('xyz widget').skip).length === 0, 'S4 an unknown search opens every store (nothing is guessed)');
  ok(['iphone 15','red tape shoes','ponds cream','laptop','samsung tv','nike air max','lipstick','bedsheet','boat earbuds','mixer grinder','watch','cricket bat','t shirt','h&m dress','vitamin c serum','prestige cooker','whey protein','mi band 8','iphone 15 case','xyz'].every(function (q) { var r = pk(q); return r.keys.indexOf('amazon') >= 0 && r.keys.indexOf('flipkart') >= 0 && r.keys.length >= 2; }), 'S5 Amazon and Flipkart are never skipped');
  ok(pk('iphone 15 case').keys.indexOf('meesho') >= 0 && pk('red tape shoes').keys.indexOf('myntra') >= 0 && pk('ponds cream').keys.indexOf('nykaa') >= 0 && pk('mixer grinder').keys.indexOf('croma') >= 0 && pk('mixer grinder').keys.indexOf('ajio') < 0, 'S6 mixed and shared categories reach the right stores');
  var nfCalls = [], nfHttp = { get: function (o) { nfCalls.push(o); return Promise.resolve({ status: 200, url: o.url, data: '<html>' + 'x'.repeat(10) }); } };
  var nfRes = await NFm.makeFetch(nfHttp, 'UA/1', { readMs: 7000 })('https://www.example.in/s?k=a');
  ok(nfCalls.length === 1 && nfCalls[0].headers['User-Agent'] === 'UA/1' && nfCalls[0].responseType === 'text' && nfCalls[0].readTimeout === 7000 && nfCalls[0].connectTimeout === 6000 && !nfCalls[0].headers.Cookie && nfRes.status === 200 && (await nfRes.text()).length === 16, 'N1 native read: identity header, text, timeouts, no cookie header, status and text back');
  var nfObj = await NFm.makeFetch({ get: function () { return Promise.resolve({ status: 503, data: { a: 1 } }); } }, '')('https://x.in/');
  var nfErr = null; try { await NFm.makeFetch({ get: function () { return Promise.reject(new Error('net down')); } }, '')('https://x.in/'); } catch (e) { nfErr = e; }
  ok(nfObj.status === 503 && nfObj.url === 'https://x.in/' && (await nfObj.text()) === '{"a":1}' && nfErr && /net down/.test(nfErr.message), 'N2 object body becomes text, HTTP status passes through, a network failure rejects');
  var FRm = require('./www/fetchread.js'), frSnap = { cards: [{ link: 'https://www.example.in/p/1', html: '<a>x</a>' }] };
  var frRead = FRm.make(NFm.makeFetch({ get: function (o) { return Promise.resolve({ status: 200, url: o.url, data: '<html>' + 'y'.repeat(1200) }); } }, 'UA'), function (txt, url) { return frSnap; });
  var frOut = await frRead({ url: function (q) { return 'https://www.example.in/s?k=' + q; } }, 'abc');
  var frRedirect = await FRm.make(NFm.makeFetch({ get: function (o) { return Promise.resolve({ status: 200, url: 'https://other.com/login', data: '<html>' + 'y'.repeat(1200) }); } }, 'UA'), function () { return frSnap; })({ url: function (q) { return 'https://www.example.in/s?k=' + q; } }, 'abc');
  ok(frOut === frSnap && frRedirect === null && FRm.STORES_OK.join() === 'amazon,flipkart,nykaa,reliancedigital', 'N3 fetchread works on top of the native read: same-site page gives the snapshot, a redirect to another site gives null (falls back to a page)');
  ok(U.inr(5000) === '\u20b95,000' && U.inr(125000) === '\u20b91,25,000' && U.inr(999) === '\u20b9999' && U.rupeesOf('\u20b91,29,900') === 129900 && U.rupeesOf('Price not shown') === null, 'X1 rupee helpers');
  var svA = U.savings([{ store: 'Reliance Digital', price: '\u20b91,29,900', isLowest: true }, { store: 'Flipkart', price: '\u20b91,34,900' }, { store: 'Tata CLiQ', price: '\u20b91,31,000' }]);
  ok(svA && svA.amount === 1100 && svA.store === 'Tata CLiQ' && U.savings([{ store: 'A', price: '\u20b9100', isLowest: true }]) === null && U.savings([{ store: 'A', price: '\u20b9100', isLowest: true }, { store: 'B', price: '\u20b9100' }]) === null && U.savings([{ store: 'A', price: '\u20b9100', isLowest: true }, { store: 'B', price: '\u20b9900', odd: true }]) === null && U.savings([]) === null, 'X2 savings = plain difference to the next cheapest store, none when equal, odd or alone');
  ok(DT.flags('Enter the characters you see below. Sorry, we just need to make sure you are not a robot. captcha').indexOf('robot-check words') >= 0 && DT.flags('Enter pincode to see products').indexOf('pincode words') >= 0 && DT.flags('hello').length === 0 && DT.strip('<style>a{}</style><p>Hi&nbsp;there</p><script>x()</script>') === 'Hi there', 'T1 store test helpers: page notices are recognised, html is stripped');
  ok(/^Amazon \| fast read \| HTTP 200 \| 1200 bytes \| same site yes \| cards read 24 \| 2\.5 s/.test(DT.fastLine({ label: 'Amazon', status: 200, bytes: 1200, sameSite: true, cards: 24, ms: 2500, flags: [], head: 'x' })) && /FAILED after 300 ms \| net down/.test(DT.fastLine({ label: 'Ajio', error: 'net down', ms: 300 })), 'T2 store test report lines');
  var devSrc = read('src/devtest.js');
  ok(/DEV-ONLY/.test(devSrc) && (appjs.match(/require\('\.\/devtest\.js'\)/g) || []).length === 1 && !/devtest|Store test/i.test(html) && /taps\.length >= 7/.test(devSrc) && devSrc.indexOf('localStorage') < 0 && devSrc.indexOf('fetch(') < 0 && devSrc.indexOf('eval(') < 0, 'T3 store test is separate (devtest.js), opens only after 7 taps on the logo, not named in index.html, no storage, no fetch, no eval');
  ok(/fetchFirst = SmartSetuFetchRead\.STORES_OK/.test(appjs) && /fetchMs = 9000/.test(appjs) && /NF\.makeFetch\(CapacitorHttp, C\.desktopUa\(navigator\.userAgent\)\)/.test(appjs) && /M\.pick\(q, R\.STORES\)/.test(appjs) && /kill\.Croma = false/.test(appjs) && /maxTabs: 1/.test(appjs) && /liveRender\(\)/.test(appjs) && /First results after/.test(appjs), 'W1 app wiring: fast read for the proven stores, store pick, Croma paused, live results, first-result time');
  ok(html.indexOf('src="snapdoc.js"') > html.indexOf('src="pagesnap.js"') && html.indexOf('src="fetchread.js"') > html.indexOf('src="snapdoc.js"') && html.indexOf('src="app.js"') > html.indexOf('src="view.js"') && ['id="logo"', 'id="morebox"', 'id="morebtn"', 'class="chips"', 'id="plist"', 'id="results"', 'id="empty"'].every(function (x) { return html.indexOf(x) > 0; }), 'W2 index.html: scripts in order, all ids the app needs');
  if (fs.existsSync(ext)) ok(['snapdoc.js', 'fetchread.js'].every(function (f) { return sha12(path.join(www, f)) === sha12(path.join(ext, f)); }), 'W3 www snapdoc.js and fetchread.js equal the extension files');
  var fontOk = ['Regular', 'Medium', 'Bold'].every(function (w) { var f = path.join(www, 'fonts', 'Inter-' + w + '.woff2'), b = fs.existsSync(f) ? fs.readFileSync(f) : null; return b && b.length > 3000 && b.length < 60000 && b.slice(0, 4).toString() === 'wOF2' && css.indexOf('fonts/Inter-' + w + '.woff2') > 0; });
  ok(fontOk && /Inter 4\.1/.test(fs.readFileSync(path.join(www, 'fonts', 'Inter-LICENSE.txt'), 'utf8') + css) && /SIL Open Font License/i.test(fs.readFileSync(path.join(www, 'fonts', 'Inter-LICENSE.txt'), 'utf8')), 'F1 Inter Regular, Medium, Bold bundled (woff2, small), licence file next to them');
  ok(!/innerHTML/.test(devSrc) && (devSrc.match(/clipboard/g) || []).length >= 1 && !/clipboard|buildReport|execCommand/.test(appjs), 'T4 clipboard and report code are only in devtest.js, not in app.js');

  // R: S15b (D-097) a page whose load event never comes is read as soon as its price amounts show and stay the same (every store, not Tata CLiQ only)
  function noLoadPlugin(doc) { var pn = mockPlugin({ doc: doc }); pn.api.onLoaded = function () { return Promise.resolve(function () {}); }; return pn; }
  function priceDoc(textFn) { return { title: 'x', body: { get innerText() { return textFn(); } }, querySelectorAll: function () { return []; } }; }
  var tenP = new Array(11).join('\u20b91,199 ').trim(), rOpts = { ready: true, readyAfterMs: 15, readyEveryMs: 15, readyProbeMs: 200, execMs: 1500 };
  var pr1 = noLoadPlugin(priceDoc(function () { return tenP; })), wr1 = W.createWebTabs(pr1.api, rOpts), tr1 = await wr1.tabs.create({ url: 'https://a.test/' });
  await sleep(300);
  ok((await wr1.tabs.get(tr1.id)).status === 'complete' && wr1.earlyCount() === 1, 'R1 no load event, page shows 10 prices, stable: the tab counts as complete early'); wr1.dispose();
  var pr2 = noLoadPlugin(priceDoc(function () { return '\u20b9100 \u20b9200 \u20b9300 text'; })), wr2 = W.createWebTabs(pr2.api, rOpts), tr2 = await wr2.tabs.create({ url: 'https://a.test/' });
  await sleep(300);
  ok((await wr2.tabs.get(tr2.id)).status === 'loading' && wr2.earlyCount() === 0 && pr2.execs >= 3, 'R2 only 3 price amounts (below the minimum): keeps waiting for the real load event, exactly as before'); wr2.dispose();
  var calls3 = 0, pr3 = noLoadPlugin(priceDoc(function () { calls3++; return new Array(Math.min(calls3 * 3, 12) + 1).join('\u20b9500 ').trim(); })), wr3 = W.createWebTabs(pr3.api, rOpts), tr3 = await wr3.tabs.create({ url: 'https://a.test/' });
  await sleep(500);
  ok((await wr3.tabs.get(tr3.id)).status === 'complete' && calls3 >= 5 && calls3 <= 8, 'R3 a list that is still growing (3, 6, 9, 12 prices) is not read until the count stops changing (probes: ' + calls3 + ')'); wr3.dispose();
  var pr4 = noLoadPlugin(priceDoc(function () { return tenP; })), wr4 = W.createWebTabs(pr4.api, { readyAfterMs: 15, readyEveryMs: 15 }), tr4 = await wr4.tabs.create({ url: 'https://a.test/' });
  await sleep(150);
  ok((await wr4.tabs.get(tr4.id)).status === 'loading' && pr4.execs === 0, 'R4 without the ready option nothing changes: no probe, still waits for the load event'); wr4.dispose();
  var pr5 = mockPlugin({ doc: priceDoc(function () { return tenP; }) }), wr5 = W.createWebTabs(pr5.api, { ready: true, readyAfterMs: 30, readyEveryMs: 15, execMs: 1500 }), fired5 = 0;
  wr5.tabs.onUpdated.addListener(function () { fired5++; }); var tr5 = await wr5.tabs.create({ url: 'https://a.test/' });
  await sleep(200);
  ok((await wr5.tabs.get(tr5.id)).status === 'complete' && fired5 === 1 && pr5.execs === 0 && wr5.earlyCount() === 0, 'R5 the real load event wins: complete once, no probe was run, not counted as early'); wr5.dispose();
  var pr6 = noLoadPlugin(priceDoc(function () { return '\u20b91'; })), wr6 = W.createWebTabs(pr6.api, rOpts), tr6 = await wr6.tabs.create({ url: 'https://a.test/' });
  await sleep(100); var ex6 = pr6.execs; await wr6.tabs.remove(tr6.id); await sleep(30); var ex6b = pr6.execs; await sleep(120);
  ok(ex6 >= 2 && pr6.execs <= ex6b, 'R6 closing the tab stops the probes'); wr6.dispose();
  if (fxSnap) {
    var onlyAz = { Myntra: false, Ajio: false, Nykaa: false, Meesho: false, 'Tata CLiQ': false, Croma: false, 'Reliance Digital': false, Flipkart: false };
    var pr7 = noLoadPlugin(priceDoc(function () { return tenP; })), wr7 = W.createWebTabs(pr7.api, rOpts), t7 = Date.now();
    var or7 = await R.runAll(wr7, { query: 'x', enabled: onlyAz, foreground: false, rereads: 0, loadMs: 4000, settleMs: 0, rereadMs: 0, collect: pageSnap, maxTabs: 1, perStoreMs: 6000, retryTimeouts: false });
    var az7 = or7.runs.filter(function (r) { return r.store === 'Amazon'; })[0];
    ok(az7 && az7.state === 'ok' && az7.ms < 1500 && Date.now() - t7 < 2000 && wr7.earlyCount() === 1, 'R7 real runner: a store whose load event never comes is read in ' + (az7 && az7.ms) + ' ms, not after the 4000 ms load limit'); wr7.dispose();
  }
  ok(/createWebTabs\(pluginApi\(\), \{ ready: true \}\)/.test(appjs) && (appjs.match(/\{ ready: true \}/g) || []).length === 4 && /function readyCount/.test(read('src/webtabs.js')), 'R8 app turns the ready option on for all four webtabs objects (first pass, second try, slow read, rescue)');

  // L: S15b (D-097) premium look: bigger type, glow, trust strip, stronger cards. Every claim on the screen is checked against the real code.
  var SMq = require('./src/storemap.js'), cssL = read('www/app.css'), htmlL = read('www/index.html');
  ok(/\.hero h1\{font-size:clamp\(26px,7\.8vw,32px\)[^}]*font-style:italic/.test(cssL) && /\.lead\{[^}]*font-size:14px/.test(cssL) && /min-height:50px/.test(cssL) && /\.search \.btn\{[^}]*min-height:52px/.test(cssL) && /\.bnum\{font-size:38px/.test(cssL) && /\.card h3\{font-size:18px/.test(cssL), 'L1 type scale is bigger (headline 34 to 50, search 62 high, button 60 high, best price 38)');
  ok(/class="glow g1"/.test(htmlL) && /class="glow g2"/.test(htmlL) && /<span class="hl">lowest price<\/span>/.test(htmlL) && /\.hl\{color:#FCD34D/.test(cssL) && /\.glow\{position:absolute/.test(cssL), 'L2 hero has the two soft glows and the highlighted headline words');
  ok((htmlL.match(/<ul class="trust">[\s\S]*?<\/ul>/) || [''])[0].split('<li>').length === 4 && /\.trustwrap\{[^}]*margin-top:-30px/.test(cssL) && /\.trust\{[^}]*box-shadow/.test(cssL), 'L3 trust strip with 3 points overlaps the hero');
  var skipPhone = SMq.pick('iPhone 17 Pro', R.STORES).skip, skipShoe = SMq.pick('Red Tape shoes for men', R.STORES).skip;
  ok(skipPhone.ajio && skipPhone.nykaa && skipShoe.croma && skipShoe.reliancedigital && /skips fashion stores/.test(htmlL) && /skips electronics stores/.test(htmlL), 'L4 the claim "a phone search skips fashion stores, a shoe search skips electronics stores" is what storemap really does');
  ok(!/background:linear-gradient\([^)]*#14917F/.test(cssL) && /\.go\{[^}]*linear-gradient\(180deg,var\(--teal\),var\(--teal-dark\)\)/.test(cssL) && /\.steps \.n\{[^}]*linear-gradient\(160deg,var\(--teal\),var\(--teal-dark\)\)/.test(cssL), 'L5 white text on the green buttons and step badges stays on teal or darker (contrast 5.47 or more, measured)');
  // S18b (V-298): the store test report shows the cut html of the cheapest listing of every store
  var runsC = [{ store: 'Flipkart', snapshot: { cards: [{ link: 'https://www.flipkart.com/a/p/itm1', html: '<a href="https://www.flipkart.com/a/p/itm1">Mixer A \u20B91,340 \u20B92,999</a>' }, { link: 'https://www.flipkart.com/b/p/itm2', html: '<a href="https://www.flipkart.com/b/p/itm2">Mixer B \u20B93,000 \u20B94,000</a>' }] } }];
  var lc = W.listingLines(runsC, [], function (snap) { return { cards: [{ url: 'https://www.flipkart.com/a/p/itm1', priceNow: 1340, mrp: 2999, title: 'Mixer A', notes: ['tiny_amount_ignored'] }, { url: 'https://www.flipkart.com/b/p/itm2', priceNow: 3000, mrp: 4000, title: 'Mixer B', notes: [] }], skipped: {} }; });
  var ch = lc.filter(function (l) { return /^- cheapest card html /.test(l); });
  ok(ch.length === 1 && /1,340/.test(ch[0]) && /tiny_amount_ignored/.test(ch[0]) && /Mixer A/.test(ch[0]) && ch[0].length < 900, 'R1 report: one cheapest-card html line per store with price, MRP, notes and the html around the price');
  // S18d (V-301): the report also shows the html around the first price word of the first 2 no-price cards
  var runsP = [{ store: 'Amazon', snapshot: { cards: [{ link: 'https://www.amazon.in/a/dp/B000000001', html: '<div class="x">' + 'y'.repeat(400) + '<span class="a-price"><span class="a-offscreen">\u20B9362.00</span></span></div>' }] } }];
  var lp = W.listingLines(runsP, [], function (snap) { return { cards: [{ url: 'https://www.amazon.in/a/dp/B000000001', priceNow: null, title: 'Ponds', notes: [] }], skipped: {} }; });
  var pr = lp.filter(function (l) { return /^- no-price price-region 1 \| /.test(l); });
  ok(pr.length === 1 && /a-price/.test(pr[0]) && /362\.00/.test(pr[0]) && pr[0].length < 900, 'R2 report: no-price cards show the html around the first price word');
  // S18d (V-302): theme from the owner mockup (same palette)
  var hT = read('www/index.html'), cT = read('www/app.css'), aT = read('src/app.js');
  ok(/class="motto">Compare \u2022 Save \u2022 Shop Smart</.test(hT) && /<svg class="art"[^>]*aria-hidden="true"/.test(hT) && /\.hero \.wrap>\.art\{position:absolute;z-index:0;[^}]*pointer-events:none/.test(cT), 'T1 logo motto and hero art (decorative, behind the text, no taps)');
  ok(/id="go"[^>]*><svg class="bi"[\s\S]*<span id="golabel">Compare<\/span><svg class="bchev"/.test(hT) && /\$\('golabel'\)\.textContent = b \? 'Comparing\.\.\.' : 'Compare'/.test(aT) && !/\$\('go'\)\.textContent/.test(aT), 'T2 Compare button keeps its icons while busy (only the label span changes)');
  var chipsT = hT.match(/<button type="button" class="chip" data-q="[^"]+"><svg class="ci"[\s\S]*?<span>[^<]+<\/span><\/button>/g) || [];
  ok(chipsT.length === 4 && /data-q="iPhone 17 Pro"/.test(chipsT[0]) && /data-q="Ponds cream"/.test(chipsT[3]) && !/apple|boat logo|trademark/i.test(chipsT.join('')), 'T3 four example cards with plain icons (no brand logos), same search texts');
  ok(/\.chips\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(cT) && /@media \(min-width:360px\)\{\.chips\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}\}/.test(cT) && /\.privacy\{[^}]*background:rgba\(11,31,58,\.55\)/.test(cT), 'T4 example cards grid and the privacy shield banner');
  ok(/<p class="privacy"><svg[^>]*><path d="M12 3l7 3v5/.test(hT) && /Stores open only when you press Compare\. Nothing is sent to our servers; the results stay on your phone\./.test(hT) && !/Store test|devtest/i.test(hT), 'T5 privacy text unchanged, owner-only store test still hidden (7 taps on the logo)');
  // S18f (V-308): exact mockup sizes and pills
  ok(/<span class="tag"><svg[^>]*>[\s\S]*?<\/svg>Ek Click, Best Deal<\/span>/.test(hT) && /<p class="eyebrow"><svg[^>]*>[\s\S]*?<\/svg>Price comparison for India<\/p>/i.test(hT) && /<p class="try"><svg[^>]*>[\s\S]*?<\/svg>Try one of these<\/p>/.test(hT) && /class="mark" viewBox="8 8 80 80" width="46" height="46"/.test(hT), 'T6 pills with icons (Ek Click, eyebrow, Try one of these) and the bigger logo mark');
  ok(/\.tag\{display:inline-flex;[^}]*border:1px solid rgba\(255,255,255,\.3\)/.test(cT) && /\.try::after\{content:"";flex:1;height:1px/.test(cT) && /\.chip\{[^}]*min-height:76px/.test(cT) && /\.privacy\{[^}]*font-size:12px/.test(cT) && !/min-height:86px/.test(cT), 'T7 pill, rule line, 76px example cards and 12px privacy text from the mockup');
  console.log('test_app: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
