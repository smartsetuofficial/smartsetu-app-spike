/* app-spike / test_s23_10h v1.0.0 (S23-10 item h, D-151). Run: node test_s23_10h.js
 * Full Test Mode: 12 fixed searches, the AI on exactly 3, one copyable report with a per-store quality gate (part 1) and a per-search view (part 2).
 * Uses the REAL saved store snapshots (tests/fixtures/snap_iphone17pro_2026-11-05.json), the real parser (www/bundle.js), a FAKE store runner and a FAKE AI. No phone, no network. */
'use strict';
var fs = require('fs'), path = require('path');
require('./www/bundle.js'); // global SmartSetu (real parser)
var S = require('./src/devsuite.js'), DT = require('./src/devtest.js');
var SNAPS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tests', 'fixtures', 'snap_iphone17pro_2026-11-05.json'), 'utf8')).snapshots;
var pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d === undefined ? null : d).slice(0, 400)); } }
var parse = SmartSetu.parseSearch;
function real(store) { return SNAPS.filter(function (x) { return x.store === store; })[0].snapshot; }
function line(label, st, n, ms, g) { return { s: label, st: st, g: g || null, ms: ms, n: n }; }

// ---- 1. the 12 searches ----
var Q = S.QUERIES;
ck('1a twelve searches, ids 1 to 12, all different words', Q.length === 12 && Q.every(function (x, i) { return x.id === i + 1; }) && new Set(Q.map(function (x) { return x.q; })).size === 12, Q.length);
ck('1b the AI is allowed on exactly 3 searches: budget, wrong spelling, Hinglish', Q.filter(function (x) { return x.ai; }).map(function (x) { return x.tag; }).join('|') === 'budget|wrong spelling|Hinglish', Q.filter(function (x) { return x.ai; }).map(function (x) { return x.tag; }));
ck('1c exactly one nonsense search and it has no on-topic words', Q.filter(function (x) { return x.nores; }).length === 1 && Q.filter(function (x) { return x.nores; })[0].on === '', 0);
ck('1d every other search has on-topic words that compile', Q.filter(function (x) { return !x.nores; }).every(function (x) { try { return !!new RegExp(x.on, 'i'); } catch (_) { return false; } }), 0);
var tags = Q.map(function (x) { return x.tag; }).join(' ');
ck('1e the plan categories are covered (brand, budget, model, spelling, Hinglish, fashion, beauty, grocery, kids, very long, no result)', ['brand', 'budget', 'model', 'wrong spelling', 'Hinglish', 'fashion', 'beauty', 'grocery', 'kids', 'very long', 'no result'].every(function (t) { return tags.indexOf(t) >= 0; }), tags);

// ---- 2. numbers from the real snapshots ----
function direct(snap, re) { var p = parse(snap), c = p.cards || [], o = { parsed: c.length, priced: 0, linked: 0 }; c.forEach(function (k) { if (k.priceNow != null && k.priceNow > 0) o.priced++; if (/^https:\/\//.test(k.url || '')) o.linked++; }); return o; }
var anchors = { Amazon: 15, Flipkart: 23, Ajio: 24, Nykaa: 20, Meesho: 20, 'Tata CLiQ': 24, Croma: 0, 'Reliance Digital': 12 };
Object.keys(anchors).forEach(function (st) {
  var a = S.analyseRun({ store: st, snapshot: real(st) }, parse, Q[1]), d = direct(real(st));
  ck('2 ' + st + ': parsed ' + anchors[st] + ' like the parser, priced and linked match an independent count', a.parsed === anchors[st] && a.parsed === d.parsed && a.priced === d.priced && a.linked === d.linked, [a, d]);
});
var fk = S.analyseRun({ store: 'Flipkart', snapshot: real('Flipkart') }, parse, Q[1]);
ck('2b on-topic plus off-topic = parsed', fk.on + fk.off === fk.parsed && fk.on > 0, fk);
var nm = S.analyseRun({ store: 'Flipkart', snapshot: real('Flipkart') }, parse, Q[3]);
ck('2c phone listings judged against the shoes search are all off-topic (the check can see junk)', nm.off === nm.parsed && nm.on === 0 && nm.parsed === 23, nm);
var noItem = S.analyseRun({ store: 'Amazon', snapshot: real('Amazon') }, parse, Q[11]);
ck('2d the nonsense search has no off-topic judgement', noItem.on === 0 && noItem.off === 0 && noItem.parsed === 15, noItem);
ck('2e a run without a snapshot gives zeros, a parser that throws gives parseError and no crash', S.analyseRun({ store: 'X' }, parse, Q[0]).parsed === 0 && S.analyseRun({ store: 'X', snapshot: { cards: [] } }, function () { throw new Error('boom'); }, Q[0]).parseError === 'boom', 0);
var dupSnap = { cards: [1, 2, 3].map(function (i) { return { html: '<a href="https://www.flipkart.com/p/' + i + '"><span>Apple iPhone 17 Pro</span></a><span>\u20b9' + (100000 + i) + '</span>', link: 'https://www.flipkart.com/p/' + i, title: 'Apple iPhone 17 Pro' }; }) };
var dupRun = S.analyseRun({ store: 'Flipkart', snapshot: dupSnap }, function () { return { cards: [{ title: 'Apple iPhone 17 Pro', priceNow: 1, url: 'https://a.in/1' }, { title: 'apple  iphone 17 PRO', priceNow: null, url: 'http://a.in/2' }, { title: 'Other', priceNow: 5, url: 'https://a.in/3' }] }; }, Q[1]);
ck('2f repeated titles (case and spaces ignored), http link and missing price are counted', dupRun.parsed === 3 && dupRun.dups === 1 && dupRun.priced === 2 && dupRun.linked === 2, dupRun);

// ---- 3. the gate ----
function sum(item, stores, extra) { return Object.assign({ item: item, ms: 30000, error: null, ai: null, rows: [], rowCount: 0, stores: stores }, extra || {}); }
function st(label, o) { return Object.assign({ label: label, state: 'ok', stage: null, ms: 5000, n: 20, parsed: 20, priced: 20, linked: 20, dups: 0, on: 18, off: 2 }, o || {}); }
var items = Q.slice(0, 5), nores = Q[11];
var good = items.map(function (it) { return sum(it, [st('Good'), st('LowPrice', { priced: 8 }), st('Empty', { parsed: 0, priced: 0, linked: 0, on: 0, off: 0, n: 0 }), st('Dupes', { dups: 9 }), st('Junk', { on: 4, off: 16 }), st('Gated', { state: 'skipped', parsed: 0, priced: 0, linked: 0, on: 0, off: 0, n: 0, ms: 0 }), st('Killed', { state: 'off', parsed: 0, priced: 0, linked: 0, on: 0, off: 0 }), st('BadLinks', { linked: 10 })]); });
good.push(sum(nores, [st('Good', { parsed: 6, on: 0, off: 0 }), st('Empty', { parsed: 0 })]));
var g = S.gate(good), by = {}; g.forEach(function (x) { by[x.label] = x; });
ck('3a clean store = PASS', by.Good.verdict === 'PASS' && by.Good.counted === 5 && by.Good.productive === 5 && by.Good.price === 100 && by.Good.link === 100, by.Good);
ck('3b price parse rate 40% = WARN with the reason', by.LowPrice.verdict === 'WARN' && by.LowPrice.price === 40 && /price 40% under 60%/.test(by.LowPrice.why.join(';')), by.LowPrice);
ck('3c a store with no listings in any search = FAIL', by.Empty.verdict === 'FAIL' && /listings in only 0 of 5/.test(by.Empty.why.join(';')), by.Empty);
ck('3d repeated titles 45% = WARN', by.Dupes.verdict === 'WARN' && by.Dupes.repeat === 45, by.Dupes);
ck('3e off-topic 80% = WARN', by.Junk.verdict === 'WARN' && by.Junk.off === 80, by.Junk);
ck('3f time-gate skips are counted as skipped and make the store FAIL', by.Gated.skipped === 5 && by.Gated.verdict === 'FAIL' && /skipped by the time gate in 5/.test(by.Gated.why.join(';')), by.Gated);
ck('3g a store switched off in every search = OFF, not FAIL', by.Killed.verdict === 'OFF' && by.Killed.counted === 0, by.Killed);
ck('3h link rate 50% = WARN', by.BadLinks.verdict === 'WARN' && by.BadLinks.link === 50, by.BadLinks);
ck('3i listings on the nonsense search are reported but do not count in the rates', /gave 6 listings for the nonsense search/.test(by.Good.why.join(';')) && by.Good.counted === 5 && by.Good.verdict === 'PASS', by.Good);
var one = S.gate([sum(items[0], [st('Solo', { state: 'timeout', stage: 'page load', parsed: 0, priced: 0, linked: 0, on: 0, off: 0 })])])[0];
ck('3j a failed store shows the step it stopped at', one.failed === 1 && /page load/.test(one.why.join(';')), one);
ck('3k no search at all = empty gate and the report says so', S.gate([]).length === 0 && /no search finished yet/.test(S.buildReport({ sums: [], version: 'x' })), 0);

// ---- 4. the whole run with a fake store runner and a fake AI ----
var STORES = Object.keys(anchors);
var calls = [], aiCalls = 0;
function fakeEnv(opts) {
  opts = opts || {};
  return {
    version: '0.10.25', ua: 'FakeWebView', parse: parse,
    run: async function (q, useAI) {
      calls.push({ q: q, ai: useAI });
      if (opts.throwOn && q === opts.throwOn) throw new Error('store pages crashed');
      if (useAI) aiCalls++;
      var runs = STORES.map(function (s) { return { store: s, state: s === 'Croma' ? 'ok' : 'ok', snapshot: real(s) }; });
      var stores = STORES.map(function (s) { return line(s, s === 'Ajio' && q === 'protein powder' ? 'skipped' : 'ok', real(s).cards.length, s === 'Ajio' ? 14000 : 4000); });
      return { ms: 31000, stores: stores, runs: runs, rows: [1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return { store: 'Flipkart', price: '\u20b9' + (1000 * i), title: 'Row ' + i + ' of ' + q, url: 'https://www.flipkart.com/p' + i }; }), ai: useAI ? { q: q, rewrite: { search: 'clean ' + q, max_price: 10000, cached: false, ms: 900 }, refine: { labelled: 12 } } : { q: q } };
    }
  };
}
(async function () {
  var partials = [], logs = [];
  var rep = await S.runSuite(fakeEnv(), { log: function (t) { logs.push(t); }, partial: function (t) { partials.push(t); } });
  ck('4a all 12 searches ran, in order', calls.length === 12 && calls.every(function (c, i) { return c.q === Q[i].q; }), calls.map(function (c) { return c.q; }));
  ck('4b the AI was asked for on exactly 3 searches (budget, spelling, Hinglish)', calls.filter(function (c) { return c.ai; }).map(function (c) { return c.q; }).join('|') === 'smartphones under 10000|samsung galaxi s24|sasta earphones 1000 ke andar', calls.filter(function (c) { return c.ai; }));
  ck('4c a partial report after every search, only the last one is not partial', partials.length === 12 && partials.slice(0, 11).every(function (p) { return /PARTIAL/.test(p); }) && !/PARTIAL/.test(partials[11]) && !/PARTIAL/.test(rep), partials.map(function (p) { return /PARTIAL/.test(p); }));
  ck('4d partial reports grow search by search', partials.every(function (p, i) { return p.indexOf('Searches done: ' + (i + 1) + ' of 12') >= 0; }), 0);
  ck('4e progress text names the search and when the AI is allowed', logs.length === 12 && /Search 3 of 12: smartphones under 10000 \(AI allowed\)/.test(logs[2]) && !/AI allowed/.test(logs[0]), logs.slice(0, 3));
  ck('4f report has part 1 and part 2 and every search', /PART 1: STORE QUALITY GATE/.test(rep) && /PART 2: EVERY SEARCH/.test(rep) && Q.every(function (x) { return rep.indexOf('=== ' + x.id + '/12 | ' + x.q) >= 0; }), 0);
  ck('4g part 1 has a line for each of the 8 fake stores with a verdict', STORES.every(function (s) { return new RegExp('- ' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\| (PASS|WARN|FAIL|OFF|NODATA) \\|').test(rep); }), 0);
  ck('4h Croma gave no listings anywhere = FAIL in the report', /- Croma \| FAIL \|/.test(rep), rep.split('\n').filter(function (l) { return /^- Croma/.test(l); }));
  ck('4i the Ajio skip on one search shows in part 1 and part 2', /- Ajio \|[^\n]*skipped 1 \|/.test(rep) && /- Ajio \| skipped \|/.test(rep), 0);
  ck('4j AI searches show the rewrite and refine lines, others do not', (rep.match(/AI rewrite:/g) || []).length === 3 && (rep.match(/AI refine:/g) || []).length === 3 && /AI rewrite: \{"search":"clean smartphones under 10000","max_price":10000/.test(rep), (rep.match(/AI rewrite:/g) || []).length);
  ck('4k only the first 6 result rows of a search are printed', (rep.match(/  row: /g) || []).length === 12 * 6 && /result rows 8/.test(rep), (rep.match(/  row: /g) || []).length);
  ck('4l the report stays pasteable (under 30000 characters) for 12 searches x 8 stores', rep.length < 30000, rep.length);
  ck('4m no snapshot html survives in the report', !/<div|<span|<a href/.test(rep), 0);
  var sm = S.summarise(Q[0], { ms: 1, stores: [line('Flipkart', 'ok', 24, 1000)], runs: [{ store: 'Flipkart', state: 'ok', snapshot: real('Flipkart') }], rows: [], ai: null }, parse);
  ck('4n the kept record is small (no snapshot is kept)', JSON.stringify(sm).length < 1500 && JSON.stringify(sm).indexOf('"cards"') < 0, JSON.stringify(sm).length);
  // a search that crashes does not stop the rest
  calls = [];
  var rep2 = await S.runSuite(fakeEnv({ throwOn: 'lakme lipstick' }), {});
  ck('4o one crashing search is reported and the other 11 still run', calls.length === 12 && /=== 5\/12 \| lakme lipstick[^\n]*ERROR store pages crashed/.test(rep2) && /Searches done: 12 of 12/.test(rep2) && !/PARTIAL/.test(rep2), calls.length);
  // stop button
  calls = []; var n = 0;
  var rep3 = await S.runSuite(fakeEnv(), { stop: function () { return n++ >= 5; } });
  ck('4p Stop after search 5: 5 searches done, report says PARTIAL', calls.length === 5 && /Searches done: 5 of 12 \(PARTIAL/.test(rep3), calls.length);
  // a screen that throws while showing a partial report does not stop the run
  calls = [];
  var rep4 = await S.runSuite(fakeEnv(), { partial: function () { throw new Error('screen gone'); } });
  ck('4q a failing screen update does not stop the run', calls.length === 12 && /Searches done: 12 of 12/.test(rep4), calls.length);
  // a store line with no run (store never started) and a run with no line
  var sm2 = S.summarise(Q[0], { ms: 5, stores: [line('Ajio', 'skipped', null, 0)], runs: [{ store: 'Amazon', state: 'ok', snapshot: real('Amazon') }], rows: [], ai: null }, parse);
  ck('4r a store with only a line and a run with only a snapshot are both kept', sm2.stores.length === 2 && sm2.stores[0].label === 'Ajio' && sm2.stores[1].parsed === 15, sm2.stores);
  var sm3 = S.summarise(Q[0], null, parse);
  ck('4s a missing answer becomes an empty record, not a crash', sm3.stores.length === 0 && sm3.rows.length === 0, sm3);

  // ---- 5. wiring (static) ----
  var app = fs.readFileSync(path.join(__dirname, 'src/app.js'), 'utf8'), dev = fs.readFileSync(path.join(__dirname, 'src/devtest.js'), 'utf8'), suite = fs.readFileSync(path.join(__dirname, 'src/devsuite.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, 'www/index.html'), 'utf8');
  ck('5a app.js: the AI gate and the Full Test hook', /if \(AIX\.on\(\) && !noAI\) \{/.test(app) && /async function fullRun\(q, useAI\) \{/.test(app) && /noAI = !useAI;/.test(app) && /finally \{ noAI = false; \}/.test(app), 0);
  ck('5b app.js: fullRun runs a normal startRun, then cancels the offer pages, and clears the old lines first', /lastStores = null; lastView = null; noAI = !useAI;\s*try \{ await startRun\(q, null\); offerTok\+\+; \}/.test(app), 0);
  ck('5c app.js: a normal Compare or the also-check tap is refused while the test runs', /function onSubmit\(ev\) \{\s*ev\.preventDefault\(\);\s*if \(testing\) \{ say\('Full Test Mode is running/.test(app) && /if \(!busy && !testing && live\.skipped\.length\)/.test(app), 0);
  ck('5d app.js: handed only to the owner panel, no report or clipboard code in app.js', /fullRun: fullRun, testMode: function \(on\) \{ testing = !!on; \} \}\);/.test(app) && !/clipboard|buildReport|execCommand/.test(app) && (app.match(/fullRun/g) || []).length === 3, (app.match(/fullRun/g) || []).length);
  ck('5e app.js: still one runAll, four runStores, seven awaits with stale checks (counts of the old guards)', (app.match(/\.runAll\(/g) || []).length === 1 && (app.match(/runStores\(/g) || []).length === 4, 0);
  ck('5f devtest.js: requires devsuite, has the button text, stop button, partial report and the DEV-ONLY mark', /require\('\.\/devsuite\.js'\)/.test(dev) && /Run Full Test Mode \(12 searches\)/.test(dev) && /Stop after this search/.test(dev) && /partial: function \(t\)/.test(dev) && /DEV-ONLY/.test(dev) && /taps\.length >= 7/.test(dev), 0);
  ck('5g devtest.js calls the suite with the real parser and the app hook, and always switches test mode off again', /run: env\.fullRun, parse: env\.SmartSetu\.parseSearch/.test(dev) && /finally \{ if \(env\.testMode\) env\.testMode\(false\);/.test(dev), 0);
  ck('5h devsuite.js and devtest.js: no storage, no network call, no eval, no innerHTML', [dev, suite].every(function (t) { return !/localStorage|sessionStorage|fetch\(|eval\(|innerHTML|XMLHttpRequest/.test(t); }), 0);
  ck('5i index.html does not name the test (owner panel only)', !/Full Test|devsuite|devtest/i.test(html), 0);
  ck('5j devtest exports the suite and its old functions still work', DT.Suite === S && typeof DT.attach === 'function' && typeof DT.runFull === 'function' && DT.flags('hello').length === 0, 0);

  // ---- 6. the owner panel itself in a fake page: 7 taps, tap the button, partial text appears, test mode goes on and off ----
  function node(tag) { var e = { tag: tag, children: [], L: {}, style: {}, hidden: false, disabled: false, textContent: '', value: '', className: '', rows: 0 }; e.appendChild = function (c) { e.children.push(c); return c; }; e.insertBefore = function (c) { e.children.unshift(c); return c; }; e.addEventListener = function (n, f) { (e.L[n] = e.L[n] || []).push(f); }; e.click = async function () { var r = []; (e.L.click || []).forEach(function (f) { r.push(f()); }); await Promise.all(r); }; e.select = function () {}; e.scrollIntoView = function () {}; e.querySelector = function () { return null; }; Object.defineProperty(e, 'firstChild', { get: function () { return e.children[0]; } }); return e; }
  var mainEl = node('main'); global.document = { createElement: node, querySelector: function (q) { return q === 'main' ? mainEl : null; }, body: mainEl, execCommand: function () { return true; } };
  Object.defineProperty(global, 'navigator', { value: { userAgent: 'FakeWebView', clipboard: { writeText: function () { return Promise.resolve(); } } }, configurable: true, writable: true });
  var trig = node('div'), modeLog = [], busy = false, partialSeen = 0, env6 = Object.assign(fakeEnv(), { trigger: trig, isBusy: function () { return busy; }, setBusy: function () {}, query: function () { return ''; }, SmartSetu: SmartSetu, version: '0.10.25', testMode: function (on) { modeLog.push(!!on); } });
  env6.fullRun = env6.run; calls = [];
  DT.attach(env6); for (var t = 0; t < 7; t++) await trig.click();
  var panel = mainEl.children[0], kids = panel.children;
  function btn(txt) { return kids.filter(function (k) { return k.tag === 'button' && k.textContent === txt; })[0]; }
  var fullB = btn('Run Full Test Mode (12 searches)'), stopB = btn('Stop after this search'), oldB = btn('Run full store test'), taE = kids.filter(function (k) { return k.tag === 'textarea'; })[0], cpB = btn('Copy report');
  ck('6a panel opens after 7 taps with the old button, the new button and a hidden stop button', !!fullB && !!stopB && !!oldB && panel.hidden === false && stopB.hidden === true && taE.hidden === true, [!!fullB, !!stopB, !!oldB]);
  busy = true; await fullB.click(); ck('6b a normal comparison running blocks the test', calls.length === 0 && modeLog.length === 0, calls.length); busy = false;
  var plain = env6.run; env6.fullRun = async function (q, ai) { await new Promise(function (r) { setTimeout(r, 8); }); return plain(q, ai); };
  var done = fullB.click(); await new Promise(function (r) { setTimeout(r, 20); });
  ck('6c while it runs: both start buttons off, stop visible, test mode on', fullB.disabled === true && oldB.disabled === true && stopB.hidden === false && modeLog[0] === true, [fullB.disabled, stopB.hidden, modeLog]);
  await done;
  ck('6d after it ends: 12 searches ran, report in the box and copy visible, buttons back, test mode off', calls.length === 12 && /PART 1: STORE QUALITY GATE/.test(taE.value) && !/PARTIAL/.test(taE.value) && taE.hidden === false && cpB.hidden === false && fullB.disabled === false && oldB.disabled === false && stopB.hidden === true && modeLog.join() === 'true,false', [calls.length, modeLog]);
  var stBox = kids.filter(function (k) { return k.tag === 'p' && /Done/.test(k.textContent); })[0];
  ck('6e the status line says Done', !!stBox, kids.map(function (k) { return k.textContent; }));
  // stop button in the middle
  calls = []; modeLog = []; var runP, firstRun = env6.run, gate1 = null;
  env6.fullRun = async function (q, ai) { var r = await firstRun(q, ai); if (calls.length === 3) await stopB.click(); return r; };
  await fullB.click();
  ck('6f Stop after search 3: 3 searches, PARTIAL report kept, status says Stopped, test mode off again', calls.length === 3 && /PARTIAL/.test(taE.value) && kids.filter(function (k) { return k.tag === 'p' && /Stopped/.test(k.textContent); }).length === 1 && modeLog.join() === 'true,false', [calls.length, modeLog]);
  // a crash of the whole suite call
  env6.fullRun = async function () { throw new Error('webview died'); }; modeLog = [];
  await fullB.click();
  ck('6g a search that throws is shown in the report, the panel recovers', /ERROR webview died/.test(taE.value) && fullB.disabled === false && modeLog.join() === 'true,false', modeLog);

  console.log('test_s23_10h: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('FAIL crash ' + (e && e.stack)); process.exit(1); });
