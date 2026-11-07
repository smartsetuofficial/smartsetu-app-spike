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
    open: function (o) { calls.open.push(o.url); var id = 'w' + (++nextId); if (!opts.noLoad) setTimeout(function () { loadL.forEach(function (f) { f({ id: id }); }); }, 5); return Promise.resolve(id); },
    exec: function (o) {
      calls.exec++;
      var key = /var K = "([a-z]+)"/.exec(o.code)[1];
      if (opts.silent) return Promise.resolve();
      var sent = [];
      var fake = 'async function smartsetuCollect(q) { ' + (opts.pageError ? 'throw new Error("boom");' : 'return ' + JSON.stringify(opts.snap(key)) + ';') + ' }';
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
var fast = { pagesnapSrc: pagesnapSrc, loadMs: 200, settleMs: 5, readMs: 300 };

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
  // T10 empty query refused
  var thrown = false; try { await core.runAll(mockApi({}), '   ', fast); } catch (_) { thrown = true; }
  ok(thrown, 'T10 empty query refused');
  // T11 shipped copies are identical to the extension files
  var extDir = path.join(__dirname, '..', 'extension');
  if (fs.existsSync(extDir)) ok(sha12(path.join(__dirname, 'www', 'pagesnap.js')) === sha12(path.join(extDir, 'pagesnap.js')) && sha12(path.join(__dirname, 'www', 'bundle.js')) === sha12(path.join(extDir, 'bundle.js')), 'T11 pagesnap.js and bundle.js equal the extension copies');
  console.log('test_spike: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
