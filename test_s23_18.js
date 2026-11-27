/* app-spike / test_s23_18 v1.0.0 (S23-18; D-163, V-608..V-611). Run: node test_s23_18.js
 * The store record: a data file that can change search address, link pattern, on/off, fetch-first and no-results words for ANY store without a new APK.
 * Checks: (1) the record that says what the app already does changes nothing, for EVERY store; (2) every bad field is refused; (3) good changes apply, a newer record
 * resets older changes; (4) network / saved copy / timeout / downgrade; (5) health memory; (6) the real tab and fetch paths use the extra words; (7) wiring + shipped file. */
'use strict';
var fs = require('fs'), path = require('path');
var R = require('./www/runner_core.js'), FR = require('./www/fetchread.js'), P = require('../parser-core/parser.js'), SR = require('./www/storerecord.js');
var pass = 0, fail = 0;
function ck(n, c, x) { if (c) pass++; else { fail++; console.log('FAIL ' + n + (x ? ' ' + JSON.stringify(x) : '')); } }
var QS = ['iphone 17 pro', 'a&b c', '\u0932\u093f\u092a\u0938\u094d\u091f\u093f\u0915', '  spaced   out ', 'boat airdopes 141', 'samsung galaxy s24'];
function fresh(o) { return SR.make(Object.assign({ runner: R, fetchRead: FR, parser: P }, o || {})); }
function store(k) { return R.STORES.filter(function (s) { return s.key === k; })[0]; }
function memStore() { var d = {}; return { d: d, getItem: function (k) { return k in d ? d[k] : null; }, setItem: function (k, v) { d[k] = String(v); } }; }
function rec(v, stores, words) { return JSON.stringify({ schema: 1, version: v, noResultsWords: words || [], stores: stores || {} }); }

(async function () {
  var origUrls = {}, origRe = {}, origOk = FR.STORES_OK.slice(), okRef = FR.STORES_OK;
  R.STORES.forEach(function (s) { origUrls[s.key] = QS.map(function (q) { return s.url(q); }); });
  Object.keys(P.STORES).forEach(function (k) { origRe[k] = P.STORES[k].linkRe; });

  // 1 the built-in record changes nothing, every store
  var m = fresh(), b = m.builtinRecord(), v = SR.validate(b, m.built);
  ck('1a built-in record is valid, no ignored field', v.ok && v.errors.length === 0, v.errors);
  ck('1b it names all ' + R.STORES.length + ' stores', Object.keys(b.stores).length === R.STORES.length && R.STORES.every(function (s) { return !!b.stores[s.key]; }));
  var t = m.take(JSON.stringify(b), 'test');
  ck('1c it is taken', t.ok === true, t);
  R.STORES.forEach(function (s) {
    ck('1d ' + s.key + ' address identical for ' + QS.length + ' queries', QS.every(function (q, i) { return s.url(q) === origUrls[s.key][i]; }), { a: s.url('a&b c'), b: origUrls[s.key][1] });
    ck('1e ' + s.key + ' link pattern same', P.STORES[s.key].linkRe.source === origRe[s.key].source && P.STORES[s.key].linkRe.flags === origRe[s.key].flags);
  });
  ck('1f fetch-first list same and the SAME array', FR.STORES_OK === okRef && FR.STORES_OK.join() === origOk.join(), FR.STORES_OK);
  ck('1g nothing is off', Object.keys(m.enabledMap()).length === 0);
  ck('1h Myntra keeps the slug style (built-in value, not typed here)', store('myntra').url('red  shoes') === 'https://www.myntra.com/red-shoes' && b.stores.myntra.encode === 'slug', store('myntra').url('red  shoes'));
  ck('1i Croma {q} used twice', b.stores.croma.searchUrl.split('{q}').length === 3, b.stores.croma.searchUrl);
  m.resetAll();

  // 2 bad input
  var bt = fresh();
  function bad(n, r) { var x = SR.validate(r, bt.built); return x; }
  ck('2a not an object', SR.validate('x', bt.built).ok === false && SR.validate(null, bt.built).ok === false && SR.validate([], bt.built).ok === false);
  ck('2b wrong schema', SR.validate({ schema: 2, version: 1, stores: {} }, bt.built).ok === false);
  [0, 1.5, '3', -1, 2000000, null].forEach(function (x) { ck('2c version ' + JSON.stringify(x) + ' refused', SR.validate({ schema: 1, version: x, stores: {} }, bt.built).ok === false); });
  var cases = [
    ['other site', { searchUrl: 'https://evil.example.com/s?q={q}' }], ['lookalike host', { searchUrl: 'https://croma.com.evil.com/s?q={q}' }],
    ['http', { searchUrl: 'http://www.croma.com/s?q={q}' }], ['no q', { searchUrl: 'https://www.croma.com/search' }],
    ['4 q', { searchUrl: 'https://www.croma.com/{q}{q}{q}{q}' }], ['user part', { searchUrl: 'https://a@www.croma.com/s?q={q}' }],
    ['port', { searchUrl: 'https://www.croma.com:8443/s?q={q}' }], ['space', { searchUrl: 'https://www.croma.com/s ?q={q}' }],
    ['long', { searchUrl: 'https://www.croma.com/s?q={q}' + new Array(300).join('a') }], ['number', { searchUrl: 5 }],
    ['lookahead', { linkPattern: '\\/p\\/(?=1)(\\d+)' }], ['back ref', { linkPattern: '(a)\\1' }], ['group repeat', { linkPattern: '(a+)+' }],
    ['no group', { linkPattern: '\\/p\\/\\d+' }], ['bad syntax', { linkPattern: '\\/p\\/(' }], ['bad char', { linkPattern: '\\/p\\/(\\d+)<script>' }],
    ['long pattern', { linkPattern: '(' + new Array(130).join('a') + ')' }], ['flag g', { linkPattern: '\\/p\\/(\\d+)', linkFlags: 'g' }],
    ['enabled str', { enabled: 'no' }], ['fetchFirst num', { fetchFirst: 1 }], ['encode odd', { encode: 'base64' }], ['flag str', { mrpStruck: 'yes' }], ['store not object', 'x']
  ];
  cases.forEach(function (c) {
    var r = SR.validate({ schema: 1, version: 5, stores: { croma: c[1] } }, bt.built);
    ck('2d ' + c[0] + ': whole record still usable, field dropped, error listed', r.ok === true && r.errors.length >= 1 && JSON.stringify(r.rec.stores.croma || {}) === '{}', { r: r.rec && r.rec.stores, e: r.errors });
  });
  var r2 = SR.validate({ schema: 1, version: 5, noResultsWords: ['OK words', 'x'], stores: { nostore: { enabled: false } } }, bt.built);
  ck('2e unknown store and bad words ignored', r2.ok && r2.errors.length === 2 && r2.rec.noResultsWords.length === 0 && !r2.rec.stores.nostore, r2);
  ck('2f a bad store does not hurt another store', (function () { var r = SR.validate({ schema: 1, version: 5, stores: { croma: { searchUrl: 'http://x' }, flipkart: { enabled: false } } }, bt.built); return r.rec.stores.flipkart.enabled === false && !r.rec.stores.croma.searchUrl; })());
  ck('2g not JSON / too big refused', bt.take('{oops', 'x').ok === false && bt.take(new Array(25000).join('a'), 'x').ok === false && bt.take(5, 'x').ok === false);
  ck('2h nothing changed by the refusals', R.STORES.every(function (s) { return s.url('a&b c') === origUrls[s.key][1]; }));

  // 3 good changes
  var g = fresh(), spyR = [], spyF = [], oR = R.setNrWords, oF = FR.setNrWords;
  R.setNrWords = function (w) { spyR.push(w.slice()); }; FR.setNrWords = function (w) { spyF.push(w.slice()); };
  var rr = g.take(rec(10, {
    croma: { searchUrl: 'https://www.croma.com/new/find?term={q}&x=1', encode: 'slug', enabled: false, linkPattern: '\\/pp\\/(\\d+)', linkFlags: 'i', offersGap: false },
    tatacliq: { fetchFirst: true }, amazon: { fetchFirst: false }, ajio: { encode: 'slug' }
  }, ['nothing for you', "we couldn't find it"]), 'test');
  ck('3a taken', rr.ok === true && g.status().version === 10, rr);
  ck('3b new address + slug', store('croma').url('red  shoes 7') === 'https://www.croma.com/new/find?term=red-shoes-7&x=1', store('croma').url('red  shoes 7'));
  ck('3c switch off by label', JSON.stringify(g.enabledMap()) === '{"Croma":false}', g.enabledMap());
  ck('3d fetch-first on and off, same array', FR.STORES_OK === okRef && FR.STORES_OK.indexOf('tatacliq') >= 0 && FR.STORES_OK.indexOf('amazon') < 0, FR.STORES_OK);
  ck('3e link pattern read by the parser object', P.STORES.croma.linkRe.exec('https://www.croma.com/x/PP/777')[1] === '777' && P.STORES.croma.offersGap === false);
  ck('3f encode only: Ajio keeps its own address with the slug style', store('ajio').url('a b') === 'https://www.ajio.com/search/?text=a-b', store('ajio').url('a b'));
  ck('3g extra words handed to both readers', JSON.stringify(spyR[spyR.length - 1]) === JSON.stringify(["nothing for you", "we couldn't find it"]) && spyF.length === spyR.length);
  ck('3h other stores untouched', store('nykaa').url('a&b c') === origUrls.nykaa[1] && P.STORES.nykaa.linkRe === origRe.nykaa);
  ck('3i status names the changed stores', g.status().applied.sort().join() === 'ajio,amazon,croma,tatacliq', g.status().applied);
  // newer record without those fields: all old changes are gone
  var rr2 = g.take(rec(11, { flipkart: { enabled: false } }), 'test');
  ck('4a newer record resets the older changes', rr2.ok && store('croma').url('a&b c') === origUrls.croma[1] && P.STORES.croma.linkRe === origRe.croma && P.STORES.croma.offersGap === true && FR.STORES_OK.join() === origOk.join() && JSON.stringify(g.enabledMap()) === '{"Flipkart":false}' && g.nrWords().length === 0, { e: g.enabledMap(), ok: FR.STORES_OK });
  ck('4b downgrade refused', g.take(rec(5, { croma: { enabled: false } }), 'test').ok === false && g.status().version === 11 && !g.enabledMap().Croma);
  ck('4c same version accepted', g.take(rec(11, {}), 'test').ok === true);
  g.resetAll(); R.setNrWords = oR; FR.setNrWords = oF;
  ck('4d resetAll gives the built-in values back', R.STORES.every(function (s) { return QS.every(function (q, i) { return s.url(q) === origUrls[s.key][i]; }); }) && FR.STORES_OK.join() === origOk.join());

  // 5 network, saved copy, timeout
  var ms = memStore(), calls = [];
  var n1 = fresh({ storage: ms, getText: function (u, t) { calls.push([u, t]); return Promise.resolve(rec(20, { croma: { enabled: false } })); } });
  var ok1 = await n1.start();
  ck('5a fetched, applied, saved, right address', ok1 === true && n1.status().source === 'smartsetu.in' && n1.status().net === 'ok' && JSON.parse(ms.d.ss_storerecord_v1).version === 20 && calls[0][0] === 'https://smartsetu.in/app-config/stores.json' && calls[0][1] === 4000, { s: n1.status(), c: calls });
  n1.resetAll();
  var n2 = fresh({ storage: ms, getText: function () { return Promise.reject(new Error('offline')); } });
  var ok2 = await n2.start();
  ck('5b offline: the saved copy still works', ok2 === false && n2.status().source === 'saved copy' && n2.status().version === 20 && n2.enabledMap().Croma === false && /failed: offline/.test(n2.status().net), n2.status());
  n2.resetAll();
  var n3 = fresh({ storage: ms, getText: function () { return Promise.resolve('<html>blocked</html>'); } });
  await n3.start();
  ck('5c a page that is not the record is ignored, saved copy stays', n3.status().version === 20 && /ignored: not JSON/.test(n3.status().net) && JSON.parse(ms.d.ss_storerecord_v1).version === 20, n3.status());
  n3.resetAll();
  var n4 = fresh({ storage: memStore(), timeoutMs: 40, getText: function () { return new Promise(function () {}); } });
  var t0 = Date.now(); var ok4 = await n4.start();
  ck('5d a call that never answers is given up on, built-in stays', ok4 === false && Date.now() - t0 < 3000 && n4.status().source === 'built-in' && /failed: timeout/.test(n4.status().net), { ms: Date.now() - t0, s: n4.status() });
  var n5 = fresh({ storage: null, getText: function () { throw new Error('sync boom'); } });
  ck('5e a throwing getText and no storage are safe', (await n5.start()) === false && n5.status().version === 0);
  var n6 = fresh({});
  ck('5f no network function is safe', (await n6.start()) === false && /no network/.test(n6.status().net));
  var clock = 1000, cnt = 0, n7 = fresh({ storage: memStore(), now: function () { return clock; }, refreshMs: 100, getText: function () { cnt++; return Promise.resolve(rec(30, {})); } });
  await n7.start(); clock += 50; var a1 = n7.maybeRefresh(); clock += 100; var a2 = n7.maybeRefresh(); await new Promise(function (r) { setTimeout(r, 20); });
  ck('5g maybeRefresh only after the wait', a1 === false && a2 === true && cnt === 2, { a1: a1, a2: a2, cnt: cnt });
  n7.resetAll();
  var ms2 = memStore(); ms2.d.ss_storerecord_v1 = rec(7, { croma: { searchUrl: 'http://bad' } });
  var n8 = fresh({ storage: ms2 }); await n8.start();
  ck('5h a saved copy is checked again like any record', n8.status().version === 7 && n8.status().errors.length === 1 && store('croma').url('a&b c') === origUrls.croma[1], n8.status());
  n8.resetAll();

  // 6 health memory (report only)
  var hs = memStore(), h = fresh({ storage: hs });
  function run(k, st, nr) { return { key: k, store: k, state: st, noResults: !!nr }; }
  h.noteRuns([run('tatacliq', 'no_cards'), run('croma', 'no_cards', true), run('amazon', 'ok')]);
  h.noteRuns([run('tatacliq', 'no_cards'), run('croma', 'no_cards', true), run('amazon', 'ok')]);
  ck('6a two bad reads: not suspect yet', /no store has 3/.test(h.healthLine()), h.healthLine());
  h.noteRuns([run('tatacliq', 'timeout'), run('croma', 'no_cards', true), run('amazon', 'off')]);
  ck('6b three bad reads in a row: tatacliq named, croma (said no results) and amazon not', /SUSPECT/.test(h.healthLine()) && /tatacliq 3/.test(h.healthLine()) && !/croma/.test(h.healthLine()) && !/amazon/.test(h.healthLine()), h.healthLine());
  h.noteRuns([run('tatacliq', 'ok')]);
  ck('6c one good read clears the streak', /no store has 3/.test(h.healthLine()), h.healthLine());
  h.noteRuns(null); h.noteRuns([null, {}, { key: 'x' }]); fresh({ storage: null }).noteRuns([run('croma', 'error')]);
  ck('6d odd input and no storage never throw', true);
  var dl = h.diagLine();
  ck('6e report line has version, source, network, stores', /record version 0 \| source built-in \| network not tried \| stores changed none \| stores off none/.test(dl), dl);

  // 7 the real tab path and the real fetch path use the extra words
  var savedDoc = global.document;
  global.document = { body: { innerText: 'Sorry, zero matches for you here' }, readyState: 'complete', visibilityState: 'visible', querySelectorAll: function () { return []; } };
  function mkApi() {
    var s = { created: [], collects: 0 };
    s.tabs = { create: function (o) { s.created.push(o.url); return Promise.resolve({ id: s.created.length }); }, remove: function () { return Promise.resolve(); }, get: function () { return Promise.resolve({ status: 'complete' }); }, onUpdated: { addListener: function (l) { setTimeout(function () { l(1, { status: 'complete' }, { id: 1 }); }, 1); }, removeListener: function () {} } };
    s.scripting = { executeScript: function (a) {
      if (a.func && a.func.name === 'pageInfo') return Promise.resolve([{ result: a.func.apply(null, a.args || []) }]);
      s.collects++; return Promise.resolve([{ result: { cards: [], url: 'u', title: 'results - Tata CLiQ' } }]);
    } };
    return s;
  }
  async function tabRun() { var en = {}; R.STORES.forEach(function (x) { en[x.label] = x.key === 'tatacliq'; }); var a = mkApi(); var o = await R.runAll(a, { query: 'washing machine', enabled: en, collect: function () {}, settleMs: 0, loadMs: 60, rereads: 2, rereadMs: 5, retryTimeouts: false }); return { a: a, r: o.runs.filter(function (x) { return x.key === 'tatacliq'; })[0] }; }
  R.setNrWords([]);
  var w0 = await tabRun();
  ck('7a words not known: the page is read again 3 times, not no-results', w0.a.collects === 3 && !w0.r.noResults, { c: w0.a.collects });
  R.setNrWords(['zero matches']);
  var w1 = await tabRun();
  ck('7b extra word from the record: said no results, read once', w1.a.collects === 1 && w1.r.noResults === true, { c: w1.a.collects, r: w1.r.state });
  R.setNrWords([]); global.document = savedDoc;
  var html = '<html><body>' + new Array(60).join('<p>filler text here</p>') + '<div>Oops, we have nothing like that</div></body></html>';
  function fetchOne(words) { FR.setNrWords(words); var rd = FR.make(function () { return Promise.resolve({ status: 200, url: 'https://www.nykaa.com/search/result/?q=zz', text: function () { return Promise.resolve(html); } }); }, function () { return { cards: [], title: 'Search - Nykaa' }; }); return rd(store('nykaa'), 'zz').then(function () { return rd.last.nykaa; }); }
  var f0 = await fetchOne([]), f1 = await fetchOne(['nothing like that']);
  ck('7c fetch path: unknown wording is not no-results, extra word is', f0.nr === false && f1.nr === true && f1.nrWhy === 'text', { f0: f0.nr, f1: f1.nr });
  FR.setNrWords([]);

  // 8 wiring and the shipped file
  var app = fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8'), idx = fs.readFileSync(path.join(__dirname, 'www', 'index.html'), 'utf8');
  ck('8a index loads storerecord.js after runner_core.js and before app.js', idx.indexOf('runner_core.js') < idx.indexOf('storerecord.js') && idx.indexOf('storerecord.js') < idx.indexOf('src="app.js"'));
  ck('8b app.js: record made with the phone network (native, no CORS), started, off-map and health wired', /SmartSetuStoreRecord\.make/.test(app) && /CapacitorHttp\.get/.test(app) && /SRX\.start\(\)/.test(app) && /SRX\.enabledMap\(\)/.test(app) && /SRX\.noteRuns\(out\.runs\)/.test(app) && /SRX\.maybeRefresh\(\)/.test(app) && /smartsetuRecordDiag/.test(app));
  var ds = require('./src/devsuite.js'), rpt = ds.buildReport({ version: 'x', sums: [], recordDiag: function () { return 'record version 9'; } });
  ck('8c Full Test report has a STORE RECORD line', /STORE RECORD: record version 9/.test(rpt), rpt.slice(0, 300));
  var sf = path.join(__dirname, '..', '..', '..', 'smartsetu-site', 'public', 'app-config', 'stores.json'), hf = path.join(__dirname, '..', '..', '..', 'smartsetu-site', 'public', '_headers');
  if (fs.existsSync(sf)) {
    var sm = fresh(), sj = JSON.parse(fs.readFileSync(sf, 'utf8')), sv = SR.validate(sj, sm.built);
    ck('8d shipped record valid, nothing ignored, schema 1', sv.ok && sv.errors.length === 0 && sj.schema === 1 && sj.version >= 1, sv.errors);
    ck('8e shipped record still says what the app does (version 1 changes nothing)', sj.version > 1 || JSON.stringify(sj.stores) === JSON.stringify(sm.builtinRecord().stores));
    var hd = fs.readFileSync(hf, 'utf8');
    ck('8f site headers: /app-config/ has Allow-Origin * and a short cache', /\/app-config\/\*\n\s+Access-Control-Allow-Origin: \*\n\s+Cache-Control: public, max-age=300/.test(hd) && /X-Robots-Tag: noindex/.test(hd));
  } else console.log('note: smartsetu-site not next to this folder, shipped-file checks 8d to 8f skipped');
  console.log('test_s23_18: ' + pass + ' pass, ' + fail + ' fail'); process.exit(fail ? 1 : 0);
})();
