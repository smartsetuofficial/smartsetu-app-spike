/* smartsetu app-spike / test_spike v0.1 (S13-1). Run: node test_spike.js. Mock plugin + captured fixture; no network, no phone. */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
var core = require('./src/spike_core.js');
require('./www/bundle.js');
var pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } }
function sha12(f) { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 12); }
var pagesnapSrc = fs.readFileSync(path.join(__dirname, 'www', 'pagesnap.js'), 'utf8');

// fixture: a captured search snapshot (any store the parser knows); relabel its url as each spike store
var fxDir = path.join(__dirname, '..', '..', 'tests', 'fixtures'), fxSnap = null;
if (fs.existsSync(fxDir)) {
  fs.readdirSync(fxDir).filter(function (f) { return /^snap_.*search|^snap_iphone17pro|^snap_boat/.test(f); }).forEach(function (f) {
    if (fxSnap) return;
    try { var j = JSON.parse(fs.readFileSync(path.join(fxDir, f), 'utf8')); (j.snapshots || []).forEach(function (s) { if (!fxSnap && s.snapshot && s.snapshot.cards && s.snapshot.cards.length > 2 && /amazon/i.test(s.store)) fxSnap = s.snapshot; }); } catch (_) {}
  });
}
var HOST = { myntra: 'https://www.myntra.com/x', meesho: 'https://www.meesho.com/search?q=x', tatacliq: 'https://www.tatacliq.com/search/?text=x' };

// T1 generated code compiles with the REAL pagesnap source
ok((function () { try { new vm.Script(core.buildInjectCode(pagesnapSrc, 'boat "airdopes" 141\n</script>', 'myntra')); return true; } catch (e) { console.log(e.message); return false; } })(), 'T1 inject code compiles with real pagesnap and a hostile query');

// mock page runner: runs the generated wrapper with a fake smartsetuCollect and captures postMessage calls
function mockApi(opts) {
  opts = opts || {};
  var listeners = [], loadL = [], calls = { open: [], close: [], exec: 0 }, nextId = 0;
  return {
    calls: calls, listenersLeft: function () { return listeners.length + loadL.length; },
    open: function (o) { calls.open.push(o.url); (calls.openOpts = calls.openOpts || []).push(o); var id = 'w' + (++nextId); if (!opts.noLoad) setTimeout(function () { loadL.forEach(function (f) { f({ id: id }); }); }, 5); return Promise.resolve(id); },
    exec: function (o) {
      calls.exec++;
      var key = /var K = "([a-z]+)"/.exec(o.code)[1];
      if (/kind: "diag"/.test(o.code)) {
        if (opts.silent) return Promise.resolve();
        setTimeout(function () { listeners.forEach(function (f) { f({ detail: { kind: 'diag', key: key, readyState: 'complete', visibility: 'visible', w: 412, h: 900, links: 33, priceLeaves: 0, textLen: 1234, url: 'u', title: 't' } }); }); }, 5);
        return Promise.resolve();
      }
      calls.snapN = (calls.snapN || 0) + 1;
      if (opts.silent) return Promise.resolve();
      var sent = [];
      var fake = 'async function smartsetuCollect(q) { ' + (opts.pageError ? 'throw new Error("boom");' : 'return ' + JSON.stringify(opts.snap(key, calls.snapN)) + ';') + ' }';
      var code = o.code.replace(pagesnapSrc, fake);
      var ctx = { window: { mobileApp: { postMessage: function (m) { sent.push(m); } } }, location: { href: HOST[key] }, document: { title: 'T' }, JSON: JSON, String: String };
      vm.runInNewContext(code, ctx);
      setTimeout(function () { if (opts.stray) listeners.forEach(function (f) { f({ detail: { kind: 'snap', key: 'other', snap: { url: 'https://x', cards: [] } } }); });
      sent.forEach(function (m) { if (opts.dropSnap && m.detail.kind === 'snap') return; listeners.forEach(function (f) { f(opts.raw ? { rawMessage: JSON.stringify(m) } : { id: o.id, detail: m.detail }); }); }); }, 5);
      return Promise.resolve();
    },
    close: function (o) { calls.close.push(o.id); return Promise.resolve(); },
    onMessage: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
    onLoaded: function (fn) { loadL.push(fn); return function () { loadL = loadL.filter(function (x) { return x !== fn; }); }; },
    parse: function (s) { return global.SmartSetu.parseSearch(s); }
  };
}
var fast = { pagesnapSrc: pagesnapSrc, loadMs: 200, settleMs: 5, readMs: 300, diagMs: 150, rereadMs: 5 };

(async function () {
  if (!fxSnap) { console.log('SKIP fixture-based tests: no captured snapshot found next to the package'); }
  else {
    // T2 happy path: all 3 stores, listings parsed, webview closed every time, listeners removed
    var snapFor = function (key) { var s = JSON.parse(JSON.stringify(fxSnap)); s.url = 'https://www.amazon.in/s?k=x'; return s; };
    var a = mockApi({ snap: snapFor });
    var r = await core.runAll(a, 'boat airdopes 141', fast);
    ok(r.length === 3 && r.map(function (x) { return x.key; }).join() === 'myntra,meesho,tatacliq', 'T2 three stores in order');
    ok(r.every(function (x) { return x.state === 'ok' && x.parsed > 0 && x.first.length === 2 && x.loaded === true; }), 'T2 each store ok with listings and first 2');
    ok(a.calls.close.length === 3 && a.calls.exec === 3 && a.listenersLeft() === 0, 'T2 closed 3 webviews, 3 scripts, listeners removed');
    ok(a.calls.open[0] === 'https://www.myntra.com/boat-airdopes-141' && /meesho\.com\/search\?q=boat%20airdopes%20141$/.test(a.calls.open[1]) && /text=boat%20airdopes%20141$/.test(a.calls.open[2]), 'T2 urls');
    ok(/OK, \d+ listings/.test(core.describe(r[0])), 'T2 describe ok');
    // T3 rawMessage path
    var r3 = await core.runStore(mockApi({ snap: snapFor, raw: true }), core.STORES[0], 'x', fast);
    ok(r3.state === 'ok', 'T3 rawMessage form accepted');
    // T4 meta arrives but full snap dropped -> timeout names the size problem
    var r4 = await core.runStore(mockApi({ snap: snapFor, dropSnap: true }), core.STORES[1], 'x', fast);
    ok(r4.state === 'timeout' && /never came back/.test(r4.reason) && r4.bytes > 0, 'T4 meta without snap = timeout with size reason');
  }
  // T5 bridge missing: nothing comes back
  var a5 = mockApi({ silent: true }), r5 = await core.runStore(a5, core.STORES[2], 'x', fast);
  ok(r5.state === 'timeout' && /no message from the page/.test(r5.reason) && a5.calls.close.length === 1, 'T5 silent page = timeout, webview still closed');
  // T6 page script error
  var r6 = await core.runStore(mockApi({ pageError: true, snap: function () {} }), core.STORES[0], 'x', fast);
  ok(r6.state === 'error' && /boom/.test(r6.reason), 'T6 page error reported');
  // T7 page never loads: still reads, loaded=false
  var r7 = await core.runStore(mockApi({ noLoad: true, silent: true }), core.STORES[0], 'x', fast);
  ok(r7.loaded === false && r7.state === 'timeout', 'T7 no load event is recorded');
  // T8 empty page (blocked/login page): no_listings with title+url shown
  var r8 = await core.runStore(mockApi({ snap: function () { return { v: 1, url: 'https://www.myntra.com/x', title: 'Access Denied', cards: [] }; } }), core.STORES[0], 'x', fast);
  ok(r8.state === 'no_listings' && /Access Denied/.test(core.describe(r8)), 'T8 blocked page shows its title');
  // T9 plugin open fails
  var a9 = mockApi({}); a9.open = function () { return Promise.reject(new Error('open failed')); };
  var r9 = await core.runStore(a9, core.STORES[0], 'x', fast);
  ok(r9.state === 'error' && /open failed/.test(r9.reason) && a9.listenersLeft() === 0, 'T9 open error, listeners cleaned');
  // T12 a message from another store key is ignored
  if (fxSnap) { var r12 = await core.runStore(mockApi({ stray: true, snap: function () { var s = JSON.parse(JSON.stringify(fxSnap)); s.url = 'https://www.amazon.in/s?k=x'; return s; } }), core.STORES[0], 'x', fast); ok(r12.state === 'ok' && r12.parsed > 0, 'T12 stray message of another key ignored'); }
  // T13 first read empty, second read has cards (late-drawing page): read again, state ok
  if (fxSnap) {
    var late = function (key, n) { if (n === 1) return { v: 1, url: 'https://www.myntra.com/x', title: 'T', cards: [] }; var s = JSON.parse(JSON.stringify(fxSnap)); s.url = 'https://www.amazon.in/s?k=x'; return s; };
    var a13 = mockApi({ snap: late }), r13 = await core.runStore(a13, core.STORES[0], 'x', Object.assign({}, fast, { rereads: 2 }));
    ok(r13.state === 'ok' && r13.tries === 2 && a13.calls.exec === 2 && !r13.diag, 'T13 empty then cards on 2nd read = ok, no state report needed');
  }
  // T14 always empty: 3 reads, then the page state is shown
  var a14 = mockApi({ snap: function () { return { v: 1, url: 'https://www.tatacliq.com/', title: 'Home', cards: [] }; } });
  var r14 = await core.runStore(a14, core.STORES[2], 'x', Object.assign({}, fast, { rereads: 2 }));
  ok(r14.state === 'no_listings' && r14.tries === 3 && r14.diag && r14.diag.links === 33 && /price items 0/.test(core.describe(r14)) && /reads 3/.test(core.describe(r14)), 'T14 empty 3 times then state report');
  // T15 chromeUa from the real phone user agent
  var wv = 'Mozilla/5.0 (Linux; Android 17; motorola edge 60 fusion Build/A171VCH.41-15; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/156.0.8078.47 Mobile Safari/537.36';
  ok(core.chromeUa(wv) === 'Mozilla/5.0 (Linux; Android 17; motorola edge 60 fusion Build/A171VCH.41-15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.47 Mobile Safari/537.36', 'T15 chromeUa drops wv and Version only');
  // T16 modes reach the plugin open call
  var sil = function (mode) { var a = mockApi({ silent: true }); return core.runStore(a, core.STORES[0], 'x', Object.assign({}, fast, { mode: mode, ua: wv })).then(function () { return a.calls.openOpts[0]; }); };
  var mh = await sil('hidden'), mv = await sil('visible'), mu = await sil('ua');
  ok(mh.visible === false && !mh.ua && mv.visible === true && !mv.ua && mu.visible === false && mu.ua && mu.ua.indexOf('wv') < 0, 'T16 hidden/visible/ua modes passed to open');
  // T17/T18 page structure dump (S13-3): the injected code runs against a tiny fake page for EVERY store host (D-073)
  var Node17 = function (tag, cls, kids, o) {
    var n = { tagName: tag.toUpperCase(), className: cls || '', children: [], parentElement: null, href: (o && o.href) || null, struck: !!(o && o.struck), text: typeof kids === 'string' ? kids : null };
    (Array.isArray(kids) ? kids : []).forEach(function (k) { k.parentElement = n; n.children.push(k); });
    n.desc = function () { var out = []; n.children.forEach(function (c) { out.push(c); out = out.concat(c.desc()); }); return out; };
    Object.defineProperty(n, 'textContent', { get: function () { return n.text != null ? n.text : n.children.map(function (c) { return c.textContent; }).join(' '); } });
    Object.defineProperty(n, 'innerText', { get: function () { return n.text != null ? n.text : n.children.map(function (c) { return c.innerText; }).join('\n'); } });
    n.querySelector = function () { var f = n.desc().filter(function (x) { return x.tagName === 'A' && x.href; }); return f[0] || null; };
    return n;
  };
  var runDiag17 = function (host, body) {
    var sent = [], all = body.desc();
    var ctx = { URL: URL, String: String, JSON: JSON, setTimeout: function (f) { f(); }, window: { scrollTo: function () { if (body.grow) all.push(body.grow); }, innerWidth: 433, innerHeight: 870, mobileApp: { postMessage: function (m) { sent.push(m.detail); } } },
      location: { hostname: 'www.' + host, href: 'https://www.' + host + '/s' }, getComputedStyle: function (e) { return { textDecorationLine: e.struck ? 'line-through' : 'none' }; },
      document: { readyState: 'complete', visibilityState: 'hidden', title: 'T', body: body, querySelectorAll: function (q) { return q === 'body *' ? all : q === 'script' ? all.filter(function (x) { return x.tagName === 'SCRIPT'; }) : all.filter(function (x) { return x.tagName === 'A' && x.href; }); } } };
    vm.runInNewContext(core.buildDiagCode('k'), ctx);
    return sent[0];
  };
  var cardPage = function (host) { return Node17('body', '', [Node17('ul', 'list', [Node17('li', 'card', [Node17('a', '', 'Boat Airdopes 141 true wireless earbuds', { href: 'https://www.' + host + '/boat/p/1' }), Node17('div', 'pw', [Node17('span', 'price', 'Rs. 999'), Node17('span', 'mrp', 'Rs. 1999', { struck: true })])])])]); };
  var okAll = true;
  core.STORES.forEach(function (st) {
    var host = new URL(st.url('x')).hostname.replace(/^www\./, ''), d = runDiag17(host, cardPage(host));
    var line = core.describe({ store: st.label, state: 'no_listings', reason: 'x', ms: 1000, mode: 'hidden', loaded: true, tries: 3, diag: d });
    if (!(d.kind === 'diag' && d.key === 'k' && d.priceLeaves === 2 && d.nonStruck === 1 && d.sameLinks === 1 && d.chains.length === 2 && d.chains[0].stop === 2 && d.chains[1].struck === true && /card at step 2/.test(line) && /price items 2/.test(line) && /same-site links 1/.test(line))) { okAll = false; console.log('T17 detail', st.key, JSON.stringify(d)); }
  });
  ok(okAll, 'T17 structure dump finds the card box on every store host');
  var noPrice = Node17('body', '', [Node17('div', 'hero', 'Welcome to the store, shop the latest deals and offers today')]);
  var d18 = runDiag17('tatacliq.com', noPrice), l18 = core.describe({ store: 'Tata CLiQ', state: 'no_listings', reason: 'x', ms: 1000, mode: 'hidden', loaded: false, tries: 3, diag: d18 });
  ok(d18.priceLeaves === 0 && d18.chains.length === 0 && d18.sameLinks === 0 && /price items 0/.test(l18) && /text: Welcome to the store/.test(l18) && d18.sample.length <= 200, 'T18 page without prices shows counts and a text sample (max 200 chars)');
  var noLink = Node17('body', '', [Node17('div', 'a1', [Node17('div', 'a2', [Node17('span', 'price', 'Rs. 50')])])]);
  var d19 = runDiag17('myntra.com', noLink);
  ok(d19.chains.length === 1 && d19.chains[0].stop === -1 && /no card box in 7 steps/.test(core.describe({ store: 'Myntra', state: 'no_listings', reason: 'x', ms: 1, mode: 'hidden', tries: 3, diag: d19 })), 'T19 price without any link above it is reported as no card box');
  // T20/T21 link box text + inline script check (S13-4): same code on every store host (D-073)
  var okBox = true;
  core.STORES.forEach(function (st) {
    var host = new URL(st.url('x')).hostname.replace(/^www\./, '');
    var page = Node17('body', '', [
      Node17('a', '', 'Share', { href: 'https://www.' + host + '/share' }),
      Node17('div', 'g', [Node17('a', '', 'Boat Rockerz Zen ANC Wireless Neckband Earphones', { href: 'https://www.' + host + '/boat-rockerz-zen-anc-wireless-neckband/p-mp000000001' }), Node17('span', '', 'Rs 1,299'), Node17('span', '', 'Free delivery by tomorrow evening')]),
      Node17('a', '', 'Boat Bassheads 55 Wired Earphones with 10mm Drivers', { href: 'https://www.' + host + '/bassheads-55-wired-earphones-with-10mm-drivers/p-mp000000003' })
    ]);
    var d = runDiag17(host, page);
    var line = core.describe({ store: st.label, state: 'no_listings', reason: 'x', ms: 1, mode: 'hidden', tries: 3, diag: d });
    if (!(d.boxes.length === 2 && d.boxes[0].up === 1 && /Boat Rockerz Zen ANC.*Rs 1,299/.test(d.boxes[0].box) && /bassheads-55/.test(d.boxes[1].path) && /link box \/boat-rockerz/.test(line) && /scripts 0 /.test(line))) { okBox = false; console.log('T20 detail', st.key, JSON.stringify(d.boxes)); }
  });
  ok(okBox, 'T20 product-like link boxes (skips short nav links) on every store host');
  var jsPage = Node17('body', '', [Node17('span', 'p', 'Rs. 1,099'), Node17('span', 'm', 'Rs. 3,990', { struck: true }), Node17('script', '', 'window.__state = {"products":[{"price":1099}]};' + ' '.repeat(2100)), Node17('script', '', 'var x = 1;')]);
  jsPage.children[3].type = 'application/ld+json';
  var d21 = runDiag17('myntra.com', jsPage), l21 = core.describe({ store: 'Myntra', state: 'no_listings', reason: 'x', ms: 1, mode: 'hidden', tries: 3, diag: d21 });
  ok(d21.scripts.n === 2 && d21.scripts.ld === 1 && d21.scripts.big === 1 && d21.scripts.pd === '1099' && d21.scripts.hit === 1 && /^\d+:window\.__state/.test(d21.scripts.head[0]) && /no product-like link/.test(l21) && /price digits 1099 found in 1/.test(l21), 'T21 inline scripts: count, ld+json, big head, price digits found');
  // T22 Myntra-style JSON state: keys tree + scroll recount (S13-6), same code on every store host (D-073)
  var st22 = { layout: { pages: { p1: { response: { page: { layout: { components: [ { id: 'a', itemType: 'PRODUCT', itemData: { data: { productInfo: { price: 1099, title: 'SECRETTITLE', url: 'y' } } }, hash: 'h' }, { id: 'b', itemType: 'GRID', itemData: { data: { items: [ { price: 2, title: 'n' }, {} ] } }, hash: 'h2' }, { id: 'c', itemType: 'BANNER', itemData: {}, hash: 'h3' } ] } } } } } } };
  var page22 = function () { var b = Node17('body', '', [Node17('span', 'p', 'Rs. 1,099'), Node17('span', 'm', 'Rs. 3,990', { struck: true }), Node17('script', '', 'window.__REDUX_STATE__ = ' + JSON.stringify(st22) + ' '.repeat(2100))]); b.grow = Node17('span', 'p2', 'Rs. 499'); return b; };
  var okT = true;
  core.STORES.forEach(function (st) {
    var host = new URL(st.url('x')).hostname.replace(/^www\./, ''), d = runDiag17(host, page22()), tr = d.tree || [];
    var line = core.describe({ store: st.label, state: 'no_listings', reason: 'x', ms: 1, mode: 'hidden', tries: 3, diag: d });
    if (!(tr[0] === 'ARR components[3] hit at 0' && tr[1] === 'i0 id,itemType,itemData,hash=PRODUCT' && tr[3] === 'i2 id,itemType,itemData,hash=BANNER' && tr.indexOf('3 price:number') >= 0 && tr.indexOf('OTHER i1') >= 0 && tr.indexOf('2 items[2]') >= 0 && d.scroll && d.scroll.before === 2 && d.scroll.after === 3 && /json tree: ARR components\[3\]/.test(line) && /after one scroll: price items 2 -> 3/.test(line))) { okT = false; console.log('T22 detail', st.key, JSON.stringify(tr.slice(0, 12)), JSON.stringify(d.scroll)); }
  });
  ok(okT, 'T22 JSON keys tree (list, items, hit item, other item) and scroll recount on every store host');
  ok(runDiag17('myntra.com', page22()).tree.join('|').indexOf('SECRETTITLE') < 0, 'T23 tree shows keys, types and lengths only: product text never shown')
  // T10 empty query refused
  var thrown = false; try { await core.runAll(mockApi({}), '   ', fast); } catch (_) { thrown = true; }
  ok(thrown, 'T10 empty query refused');
  // T11 shipped copies are identical to the extension files
  var extDir = path.join(__dirname, '..', 'extension');
  if (fs.existsSync(extDir)) ok(sha12(path.join(__dirname, 'www', 'pagesnap.js')) === sha12(path.join(extDir, 'pagesnap.js')) && sha12(path.join(__dirname, 'www', 'bundle.js')) === sha12(path.join(extDir, 'bundle.js')), 'T11 pagesnap.js and bundle.js equal the extension copies');
  console.log('test_spike: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
