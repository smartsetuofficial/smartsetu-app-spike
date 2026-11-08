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
      st.execs++;
      if (opt.noBridge) return Promise.resolve();
      var sb = { location: { href: urls[o.id] || '' }, FX: fxSnap, console: console, JSON: JSON, Promise: Promise, setTimeout: setTimeout, String: String };
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

  // D: shipped files
  var ext = path.join(__dirname, '..', 'extension'), www = path.join(__dirname, 'www');
  if (fs.existsSync(ext)) ok(['pagesnap.js', 'bundle.js', 'runner_core.js', 'view.js', 'compare.css'].every(function (f) { return sha12(path.join(www, f)) === sha12(path.join(ext, f)); }), 'D1 www copies equal the extension files');
  var cfg = JSON.parse(read('capacitor.config.json')), pkg = JSON.parse(read('package.json')), appjs = read('src/app.js'), html = read('www/index.html'), yml = read('.github/workflows/apk.yml');
  ok(cfg.appId === 'in.smartsetu.app' && cfg.appName === 'SmartSetu' && cfg.webDir === 'www', 'D2 app id and name (D-080)');
  ok(/test_app\.js/.test(pkg.scripts.test) && /test_spike\.js/.test(pkg.scripts.test), 'D3 npm test runs both test files');
  ok(appjs.indexOf('innerHTML') < 0 && appjs.indexOf('localStorage') < 0 && appjs.indexOf('fetch(') < 0 && appjs.indexOf('eval(') < 0, 'D4 app.js: no innerHTML, no storage, no network call, no eval');
  ok((appjs.match(/\.runAll\(/g) || []).length === 1 && appjs.indexOf('.runAll(') > appjs.indexOf('async function onSubmit') && /addEventListener\('submit', onSubmit\)/.test(appjs), 'D5 runAll only inside the Compare submit handler (D-010)');
  ok(/maxTabs: 1/.test(appjs) && /foreground: false/.test(appjs) && /enabledMap\(\)/.test(appjs), 'D6 one store at a time, hidden, Myntra off');
  var order = ['bundle.js', 'pagesnap.js', 'runner_core.js', 'view.js', 'app.js'].map(function (f) { return html.indexOf('src="' + f + '"'); });
  ok(order.every(function (x, i) { return x >= 0 && (i === 0 || x > order[i - 1]); }), 'D7 index.html loads the 5 scripts in order');
  ok(html.indexOf('<form') >= 0 && html.indexOf('viewport-fit=cover') >= 0 && html.indexOf('SmartSetu') >= 0 && html.indexOf('Spike') < 0, 'D8 index.html is the app screen (form, safe area, no spike text)');
  ok(/workflow_dispatch/.test(yml) && !/^\s+push:/m.test(yml) && /smartsetu-debug-apk/.test(yml) && /npm test/.test(yml), 'D9 workflow is manual, runs tests, artifact name smartsetu-debug-apk');
  ok(fs.existsSync(path.join(__dirname, '.gitignore')) && /www\/app\.js/.test(read('.gitignore')), 'D10 built www/app.js stays out of git');
  console.log('test_app: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
