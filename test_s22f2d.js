/* app-spike / test_s22f2d v0.1.0 (S22f-2 part 3, D-128). Run: node test_s22f2d.js
 * Checks the meaning-check hook in src/app.js. The semRefine block is cut out of app.js (between its two marker lines) and run in Node with a FAKE engine,
 * the REAL query engine (www/bundle.js) and SYNTHETIC titles. The real model, the WebView, the phone speed are NOT tested here (APK + phone, V-492). */
'use strict';
var fs = require('fs'), path = require('path'), pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d)); } }
var rd = function (p) { return fs.readFileSync(path.join(__dirname, p), 'utf8'); };
var app = rd('src/app.js'), dev = rd('src/devtest.js'), pkg = JSON.parse(rd('package.json'));
require('./www/bundle.js');
var SS = globalThis.SmartSetu;

// ---- 1 wiring (text) ----
var iStart = app.indexOf('// ---- S22f-2 part 3 (D-128)'), iEnd = app.indexOf('// ---- end S22f-2 part 3 ----');
ck('1a block markers exist once each', iStart > 0 && iEnd > iStart && app.split('// ---- S22f-2 part 3 (D-128)').length === 2 && app.split('// ---- end S22f-2 part 3 ----').length === 2, [iStart, iEnd]);
ck('1b tokenizer import + semantic + ortglue required in app.js', /^import \{ Tokenizer \} from '@huggingface\/tokenizers';/m.test(app) && /require\('\.\/semantic\.js'\)/.test(app) && /require\('\.\/ortglue\.js'\)/.test(app), 0);
ck('1c semRefine is called once, inside startRun, after the first final render and before runOffers', (app.match(/semRefine\(/g) || []).length === 2 && app.indexOf('await semRefine(') > app.indexOf('render(fin.view);') && app.indexOf('await semRefine(') < app.indexOf('runOffers(finView, myTok)') && app.indexOf('await semRefine(') > app.indexOf('async function startRun'), 0);
ck('1d the live renders and the first final render use no meaning check (buildNow without sem)', /buildNow\(new Date\(\)\.toISOString\(\)\)/.test(app) && /var fin = buildNow\(out\.seenAt\);/.test(app), 0);
ck('1e buildNow passes sem to compareAny and returns res', /seenAt: seenAt, sem: sem \}\)/.test(app) && /return \{ view: v, snaps: snaps\.length, res: res \};/.test(app), 0);
ck('1f nothing loads at start: the engine is made only inside semEngine(), which only semRefine calls', (app.match(/semEngine\(\)/g) || []).length >= 3 && (app.match(/SEM\.make\(/g) || []).length === 1 && app.indexOf('SEM.make(') > iStart && app.indexOf('SEM.make(') < iEnd, 0);
ck('1g cancelled search: render is skipped when gen changed (return before render)', /var sb = await semRefine\(out\.seenAt, gen\);\n\s+if \(gen !== runGen\) return;/.test(app), 0);
ck('1h devtest report has the MEANING CHECK line, the panel shows it on open (textContent), app passes semDiag', /MEANING CHECK/.test(dev) && /semDiag: semDiag/.test(app) && /semline\.className = 'note semline'/.test(dev) && /sl\.textContent = 'Meaning check: '/.test(dev), 0);
ck('1i version 0.10.21 in package.json and app.js', pkg.version === '0.10.21' && /VERSION = '0\.10\.21'/.test(app), pkg.version);
ck('1j no storage, no network call, no innerHTML in the new block', !/localStorage|sessionStorage|fetch\(|XMLHttpRequest|innerHTML/.test(app.slice(iStart, iEnd)), 0);
ck('1k package.json dependencies unchanged (tokenizers 0.2.0, onnxruntime-web 1.30.0, exact)', pkg.dependencies['@huggingface/tokenizers'] === '0.2.0' && pkg.dependencies['onnxruntime-web'] === '1.30.0', pkg.dependencies);

// ---- 2 behaviour of the block with a fake engine and the real query engine ----
function card(t, p) { return { title: t, link: '', priceNum: p || 400 }; }
var DOG = ['Pedigree Adult Dry Dog Food Chicken 3 kg', 'Royal Canin Maxi Dog Food 4 kg', 'Drools Puppy Dog Food Chicken 3 kg', 'Pedigree Puppy Dog Food 1.2 kg', 'Canine Creek Dog Food 2 kg'];
var JUNK = ['Cotton Bedsheet Double Bed Floral', 'Steel Water Bottle 1 L'];
function per() { return { Amazon: DOG.slice(0, 3).map(function (t) { return card(t); }).concat([card(JUNK[0])]), Flipkart: DOG.slice(3).map(function (t) { return card(t); }).concat([card(JUNK[1])]) }; }
var SIM = {}; DOG.forEach(function (t, i) { SIM[t] = 0.7 - i * 0.02; }); JUNK.forEach(function (t) { SIM[t] = 0.08; });

function harness(o) {
  o = o || {};
  var src = app.slice(iStart, iEnd).replace('SEM_WAIT_MS = 30000', 'SEM_WAIT_MS = ' + (o.waitMs || 30000));
  var env = { said: [], prepared: [], built: [], runGen: 1, live: { q: o.q || 'kutta ka khana' }, state: o.state || { status: 'idle', reason: '' }, staleSeen: [] };
  var fakeEngine = { state: function () { return env.state; }, prepare: function (qt, titles, isStale) {
    env.prepared.push({ qt: qt, titles: titles.slice() }); env.isStale = isStale;
    if (o.prepare) return o.prepare(env, qt, titles, isStale);
    return Promise.resolve({ sim: function (t) { return Object.prototype.hasOwnProperty.call(SIM, t) ? SIM[t] : 0; }, floor: 0.30, rel: 0.85, max: 8, info: { status: 'ready', titles: titles.length, embedded: titles.length } });
  } };
  var SEM = { make: function () { env.made = (env.made || 0) + 1; return fakeEngine; } };
  var OG = { makeDeps: function () { return {}; }, webConfig: function () { return {}; } };
  function buildNow(seenAt, sem) { var r = SS.query.rank(env.live.q, o.per ? o.per() : per(), undefined, sem); env.built.push(!!(sem && sem.info)); return { view: { strong: r.strong }, snaps: 2, res: { semInfo: r.sem } }; }
  var f = new Function('SEM', 'OG', 'Tokenizer', 'window', 'navigator', 'live', 'say', 'buildNow', 'SmartSetu', 'getRunGen', 'setTimeout', 'clearTimeout',
    'var runGen = getRunGen();\n' + src + '\nreturn { semRefine: semRefine, semDiag: semDiag, semEngine: semEngine, setGen: function (g) { runGen = g; } };');
  var api = f(SEM, OG, function () {}, {}, { deviceMemory: o.mem }, env.live, function (t) { env.said.push(t); }, buildNow, SS, function () { return 1; }, setTimeout, clearTimeout);
  env.api = api; return env;
}

(async function () {
  // 2a happy path: titles noted by the probe, query text = semText(parse(q)), second build has sem, rescued > 0 -> returns the new build
  var e = harness(); var r = await e.api.semRefine('t', 1);
  ck('2a happy: a new build is returned with the rescued close matches', r && r.view.strong === 5 && r.res.semInfo.rescued === 5, r);
  ck('2b the probe noted the soft titles (no more than the cap), query text is the meaning words', e.prepared.length === 1 && e.prepared[0].qt === 'kutta khana' && e.prepared[0].titles.length >= 5 && e.prepared[0].titles.length <= 120, e.prepared[0]);
  ck('2c first build is the probe (no similarity), second build carries sem', e.built.length === 2 && e.built[0] === false && e.built[1] === true, e.built);
  ck('2d message while checking, diag line says rescued 5', e.said.length === 1 && /Checking more matches/.test(e.said[0]) && /"rescued":5/.test(e.api.semDiag()), [e.said, e.api.semDiag()]);
  ck('2e the engine is made once and reused (lazy)', e.made === 1, e.made);

  // 2f failed / low memory engine: skipped, no probe call, nothing said
  var ef = harness({ state: { status: 'failed', reason: 'model 404' } }); ef.api.semEngine(); /* an earlier search made the engine and it failed */ var rf = await ef.api.semRefine('t', 1);
  ck('2f failed engine: null, prepare never called, no message', rf === null && ef.prepared.length === 0 && ef.said.length === 0 && /failed: model 404/.test(ef.api.semDiag()), [ef.prepared.length, ef.said, ef.api.semDiag()]);
  var el = harness({ state: { status: 'lowmem', reason: 'device memory 2 GB' } }); el.api.semEngine(); var rl = await el.api.semRefine('t', 1);
  ck('2g low-memory phone: skipped the same way', rl === null && el.prepared.length === 0, 0);

  // 2h prepare gives null: result stays
  var en = harness({ prepare: function () { return Promise.resolve(null); } }); var rn = await en.api.semRefine('t', 1);
  ck('2h prepare null: null back, no second build', rn === null && en.built.length === 1, en.built);
  // 2i prepare throws / rejects: no crash
  var ex = harness({ prepare: function () { return Promise.reject(new Error('boom')); } }); var rx = await ex.api.semRefine('t', 1);
  ck('2i prepare rejects: null, no crash', rx === null, 0);
  var ey = harness({ prepare: function () { throw new Error('sync boom'); } }); var ry = await ey.api.semRefine('t', 1);
  ck('2j prepare throws at once: null, error text kept for the report', ry === null && /sync boom/.test(ey.api.semDiag()), ey.api.semDiag());
  // 2k too slow: gives up after the wait, isStale turns true so the work stops
  var es = harness({ waitMs: 40, prepare: function () { return new Promise(function () { /* never answers */ }); } }); var t0 = Date.now(); var rs = await es.api.semRefine('t', 1);
  ck('2k slow model: null after the wait, gaveUp flagged, isStale true afterwards', rs === null && Date.now() - t0 < 1500 && es.isStale() === true && /"gaveUp":true/.test(es.api.semDiag()), [Date.now() - t0, es.api.semDiag()]);
  // 2l a newer search started while waiting: null, no second build
  var ea = harness({ prepare: function (env) { env.api.setGen(2); return Promise.resolve({ sim: function () { return 0.7; }, info: {} }); } }); var ra = await ea.api.semRefine('t', 1);
  ck('2l newer search: null, nothing drawn from the old one', ra === null && ea.built.length === 1, ea.built);
  // 2m rescued 0: null (screen not redrawn)
  var e0 = harness({ prepare: function () { return Promise.resolve({ sim: function () { return 0.01; }, floor: 0.30, rel: 0.85, max: 8, info: { status: 'ready' } }); } }); var r0 = await e0.api.semRefine('t', 1);
  ck('2m nothing rescued: null so the screen is not redrawn', r0 === null && e0.built.length === 2, e0.built);
  // 2n fewer than 3 titles: skipped, model never asked
  var e3 = harness({ per: function () { return { Amazon: [card(DOG[0])], Flipkart: [card(JUNK[0])] }; } }); var r3 = await e3.api.semRefine('t', 1);
  ck('2n fewer than 3 titles: skipped, prepare not called, no message', r3 === null && e3.prepared.length === 0 && e3.said.length === 0, [e3.prepared.length, e3.said]);
  // 2o cap: more than 120 titles are cut to 120
  var big = function () { var a = []; for (var i = 0; i < 200; i++) a.push(card('Pedigree Dog Food Chicken ' + i + ' kg')); return { Amazon: a.slice(0, 100), Flipkart: a.slice(100) }; };
  var eb = harness({ per: big, prepare: function () { return Promise.resolve(null); } }); await eb.api.semRefine('t', 1);
  ck('2o at most 120 titles go to the model', eb.prepared.length === 1 && eb.prepared[0].titles.length === 120, eb.prepared[0] && eb.prepared[0].titles.length);
  // 2p semDiag before any run
  var ed = harness(); ck('2p diag before a run says so', /no meaning check ran yet/.test(ed.api.semDiag()), ed.api.semDiag());

  console.log('TEST s22f2d: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
