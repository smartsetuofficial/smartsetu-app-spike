/* smartsetu app / test_s23_2c v1.0.0 (S23-2c, D-132). Run: node test_s23_2c.js (from code/app-spike). FAKE worker, no network, no phone.
 * Part 1: src/aiflow.js (rewrite, classify, pause after failure, refine loop). Part 2: the loop on the REAL engine with REAL saved Red Tape snapshots (the fake worker decides which titles are "A", nothing here says how well the real AI labels).
 * Part 3: source checks on src/app.js (hooks in place, AI_URL is the deployed Worker address, nothing the older tests forbid). */
'use strict';
var fs = require('fs'), path = require('path'), AIF = require('./src/aiflow.js'), G = require('../compare-engine/generic.js'), V = require('../extension/view.js'), pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d)); } }
var URL = 'https://w.example.workers.dev/';
function fake(handler) { var log = []; var post = function (u, body, ms) { log.push({ u: u, body: body, ms: ms }); return Promise.resolve().then(function () { return handler(body, log.length); }); }; post.log = log; return post; }
function clock() { var t = 1000; var f = function () { return t; }; f.add = function (ms) { t += ms; }; return f; }
function mk(post, extra) { return AIF.make(Object.assign({ url: URL, post: post, now: (extra && extra.now) || clock() }, extra || {})); }
function lab(body) { return { ok: true, labels: body.titles.map(function (t) { return /BAD/.test(t) ? 'A' : 'P'; }) }; }
(async function () {
  // 1 off
  var p0 = fake(function () { return { ok: true }; });
  ck('1a no url / http url / no post = off', !AIF.make({ post: p0 }).on() && !AIF.make({ url: 'http://x.example/', post: p0 }).on() && !AIF.make({ url: URL }).on() && AIF.make({ url: URL, post: p0 }).on(), 0);
  var off = AIF.make({ post: p0 });
  var r0 = await off.rewrite('dog food'), c0 = await off.classify('dog food', ['a']);
  ck('1b off: rewrite and classify answer not ok and never call the network', !r0.ok && r0.reason === 'off' && !c0.ok && p0.log.length === 0, [r0, c0, p0.log.length]);
  // 2 rewrite
  var p1 = fake(function (b) { return { ok: true, search: 'dog food', max_price: null, usage: { prompt: 1 } }; }), a1 = mk(p1);
  var r1 = await a1.rewrite('  Kutta   ka khana ');
  ck('2a rewrite sends the action and the cleaned query, wait 6000 ms', r1.ok && r1.search === 'dog food' && r1.max_price === null && !r1.cached && p1.log.length === 1 && p1.log[0].body.action === 'rewrite' && p1.log[0].body.q === 'Kutta ka khana' && p1.log[0].ms === 6000 && p1.log[0].u === URL, [r1, p1.log]);
  var r1b = await a1.rewrite('kutta KA khana');
  ck('2b same query (case and spaces ignored) comes from memory, no second call', r1b.ok && r1b.cached && p1.log.length === 1, r1b);
  var bads = [null, 'x', { ok: false, reason: 'unparsable' }, { ok: true }, { ok: true, search: '' }, { ok: true, search: 'x'.repeat(121) }, { ok: true, search: 'tv', max_price: 0 }, { ok: true, search: 'tv', max_price: -5 }, { ok: true, search: 'tv', max_price: 'abc' }, { ok: true, search: 'tv', max_price: 1e8 }, { ok: true, search: 'tv', max_price: null, extra: 1, labels: 'x' }.search === 'tv' ? { ok: 1, search: 'tv' } : null];
  var okAll = true, why = [];
  for (var i = 0; i < bads.length; i++) { var pb = fake(function () { return bads[i]; }), ab = mk(pb), rb = await ab.rewrite('mobile ' + i); if (rb.ok) { okAll = false; why.push(i); } }
  ck('2c every wrong answer shape = not ok (null, text, ok false, no search, long search, bad price, ok:1)', okAll, why);
  var pu = fake(function () { return { ok: false, reason: 'unparsable' }; }), au = mk(pu);
  await au.rewrite('a b c'); var ru2 = await au.rewrite('d e f');
  ck('2d a model hiccup (unparsable) does NOT pause the AI', pu.log.length === 2 && ru2.reason === 'unparsable', pu.log.length);
  var ck0 = clock(), pe = fake(function (b, n) { if (n === 1) throw new Error('boom'); return { ok: true, search: 'tv', max_price: null }; }), ae = mk(pe, { now: ck0 });
  var re1 = await ae.rewrite('tv one'), re2 = await ae.rewrite('tv two');
  ck('2e a thrown error pauses the AI: next call is not ok and makes no network call', !re1.ok && re1.reason === 'error' && !re2.ok && re2.reason === 'paused' && pe.log.length === 1, [re1, re2]);
  ck('2f the pause is announced in state()', ae.state().downForMs > 0 && ae.state().failed === 1 && ae.state().paused === 1, ae.state());
  ck0.add(60001); var re3 = await ae.rewrite('tv two');
  ck('2g after the pause the AI is tried again', re3.ok && pe.log.length === 2, re3);
  var ph = fake(function () { return new Promise(function () { }); }), ah = mk(ph, { rewriteMs: 25 }), t0 = Date.now(), rh = await ah.rewrite('slow one');
  ck('2h a Worker that never answers = not ok after the wait (no hang), then paused', !rh.ok && Date.now() - t0 < 1500 && (await ah.rewrite('slow two')).reason === 'paused', rh);
  var ph2 = fake(function () { return { ok: false, reason: 'ai_error' }; }), ah2 = mk(ph2); await ah2.rewrite('q one'); 
  ck('2i Worker says ai_error (daily limit or AI down) = pause', (await ah2.rewrite('q two')).reason === 'paused' && ph2.log.length === 1, ph2.log.length);
  var pp = fake(function () { return { ok: true, search: 'mobile phone', max_price: 10000 }; }), apx = mk(pp), rp = await apx.rewrite('mobile phones under 10000');
  ck('2j price comes through as a number', rp.ok && rp.max_price === 10000, rp);
  // 3 classify
  var T = ['Phone A 64GB', 'BAD Power Bank 20000mAh', 'Phone B 128GB'];
  var pc = fake(function (b) { return lab(b); }), ac = mk(pc), c1 = await ac.classify('mobile phones under 10000', T.concat(['Phone A 64GB', 7, '', null]));
  ck('3a labels by the original title; duplicates and non-text skipped; one call; wait 8000 ms', c1.ok && c1.asked === 3 && c1.labels['BAD Power Bank 20000mAh'] === 'A' && c1.labels['Phone A 64GB'] === 'P' && Object.keys(c1.labels).length === 3 && pc.log.length === 1 && pc.log[0].ms === 8000 && pc.log[0].body.action === 'classify' && pc.log[0].body.search === 'mobile phones under 10000' && pc.log[0].body.titles.length === 3, [c1, pc.log[0]]);
  var c2 = await ac.classify('mobile phones under 10000', T.concat(['Phone C']));
  ck('3b only new titles are asked (Phone C), the others come from memory', c2.ok && c2.asked === 1 && pc.log[1].body.titles.length === 1 && c2.labels['BAD Power Bank 20000mAh'] === 'A' && c2.labels['Phone C'] === 'P', [c2, pc.log[1]]);
  var c3 = await ac.classify('mobile phones under 10000', T);
  ck('3c everything known: no call', c3.ok && c3.asked === 0 && pc.log.length === 2, c3);
  var c4 = await ac.classify('laptop', ['Phone A 64GB']);
  ck('3d a label belongs to its search phrase: another phrase asks again', c4.asked === 1 && pc.log.length === 3, c4);
  var many = []; for (var m = 0; m < 70; m++) many.push('Item number ' + m);
  var pm = fake(function (b) { return lab(b); }), am = mk(pm), cm = await am.classify('x', many);
  ck('3e at most 45 titles are sent in one call', cm.ok && cm.asked === 45 && pm.log[0].body.titles.length === 45, cm.asked);
  var cl = await am.classify('x', ['  Spaced   title \n with newline  ']);
  ck('3f titles are cleaned the way the Worker cleans them, label still on the ORIGINAL title', cl.ok && pm.log[1].body.titles[0] === 'Spaced title with newline' && cl.labels['  Spaced   title \n with newline  '] === 'P', pm.log[1].body);
  var badC = [null, { ok: false, reason: 'unparsable' }, { ok: true, labels: ['P'] }, { ok: true, labels: ['P', 'X', 'P'] }, { ok: true, labels: 'PPP' }, { ok: true }];
  var allBad = true;
  for (var k = 0; k < badC.length; k++) { var pk = fake(function () { return badC[k]; }), ak = mk(pk), ck2 = await ak.classify('s', T); if (ck2.ok) allBad = false; if (AIF.make({ url: URL, post: pk }).isAFor('s')(T[1])) allBad = false; }
  ck('3g every wrong answer shape (null, ok false, wrong count, bad letter, text, missing) = not ok, no label kept', allBad, 0);
  var pt = fake(function () { throw new Error('net'); }), at = mk(pt), ct = await at.classify('s', T), ct2 = await at.classify('s', T);
  ck('3h network error = not ok, then paused', !ct.ok && ct.reason === 'error' && !ct2.ok && ct2.reason === 'paused' && pt.log.length === 1, [ct, ct2]);
  ck('3i bad search phrase (empty or over 120) = not ok without a call', !(await ac.classify('', T)).ok && !(await ac.classify('y'.repeat(121), T)).ok && pc.log.length === 3, pc.log.length);
  // 4 isAFor
  var isA = ac.isAFor('mobile phones under 10000');
  ck('4a isAFor is true ONLY for an A of that phrase', isA('BAD Power Bank 20000mAh') === true && isA('Phone A 64GB') === false && isA('never seen') === false && isA(null) === false && isA(5) === false && ac.isAFor('laptop')('BAD Power Bank 20000mAh') === false, 0);
  // 5 shownTitles
  var view = { groups: [{ title: 'Amazon', rows: [{ title: 'T1' }, { title: 'T2' }, { title: 'T1' }, { nope: 1 }] }, { title: 'Ajio', rows: [{ title: 'T3' }] }, { title: 'x' }], top: { rows: [{ title: 'T3' }, { title: 'T4' }] } };
  ck('5a titles in screen order, each once, store names not included', JSON.stringify(AIF.shownTitles(view)) === JSON.stringify(['T1', 'T2', 'T3', 'T4']), AIF.shownTitles(view));
  ck('5b cap respected', AIF.shownTitles(view, 2).length === 2, 0);
  ck('5c garbage view = empty list, no throw', AIF.shownTitles(null).length === 0 && AIF.shownTitles({ groups: 'x' }).length === 0 && AIF.shownTitles({ groups: [null, { rows: 5 }] }).length === 0, 0);
  // 6 refine on the REAL engine with REAL saved snapshots
  var FX = path.join(__dirname, '..', '..', 'tests', 'fixtures');
  function load(f) { return JSON.parse(fs.readFileSync(path.join(FX, 'snap_' + f + '_2026-11-03.json'), 'utf8')).snapshots.map(function (x) { return x.snapshot || x; }); }
  var RED = load('redtape_search').concat(load('redtape2_search'), load('amazon_redtape3'));
  var hook = null;
  function rebuild() { var res = G.compareAny({ query: 'shoes', searches: RED, products: [], seenAt: '2026-11-03T00:00:00Z', ai: hook || undefined }); return { view: V.buildView(res, [], 'T'), res: res }; }
  var first = rebuild(), shown0 = AIF.shownTitles(first.view, 45);
  ck('6a the screen without labels shows listings (REAL snapshots)', shown0.length >= 5, shown0.length);
  var kill = shown0.slice(0, 2);
  var pr = fake(function (b) { return { ok: true, labels: b.titles.map(function (t) { return kill.indexOf(t) >= 0 ? 'A' : 'P'; }) }; }), ar = mk(pr);
  var rf = await ar.refine('shoes', first, rebuild, null, function (f) { hook = { isA: f }; });
  var after = AIF.shownTitles(rf.next.view, 100);
  ck('6b the two titles the fake worker calls A are gone from the new screen, the rest stay', rf.next && kill.every(function (t) { return after.indexOf(t) < 0; }) && shown0.slice(2).every(function (t) { return after.indexOf(t) >= 0; }) && rf.info.dropped >= 2, [rf.info, after.length]);
  ck('6c at most 2 calls, the second one asks only titles that appeared in place of the dropped ones', rf.info.rounds <= 2 && pr.log.length <= 2 && (pr.log.length < 2 || pr.log[1].body.titles.every(function (t) { return shown0.indexOf(t) < 0; })), [pr.log.length, rf.info]);
  hook = null; var firstB = rebuild(); var pall = fake(function (b) { return { ok: true, labels: b.titles.map(function () { return 'P'; }) }; }), aall = mk(pall);
  var rn = await aall.refine('shoes', firstB, rebuild, null, function (f) { hook = { isA: f }; });
  ck('6d nothing is A: next is null (the screen is not drawn again)', rn.next === null && rn.info.dropped === 0, rn.info);
  hook = null; var firstC = rebuild(), pbad = fake(function () { throw new Error('down'); }), abad = mk(pbad);
  var rbd = await abad.refine('shoes', firstC, rebuild, null, function (f) { hook = { isA: f }; });
  ck('6e Worker down: next is null, hook never set, the old screen stays', rbd.next === null && hook === null && rbd.info.reason === 'error', [rbd.info, hook]);
  hook = null; var firstD = rebuild(), n1 = 0, pcan = fake(function (b) { return lab(b); }), acan = mk(pcan);
  var rcn = await acan.refine('shoes', firstD, rebuild, function () { return true; }, function (f) { hook = { isA: f }; });
  ck('6f run cancelled while waiting: next is null, hook never set', rcn.next === null && rcn.cancelled === true && hook === null, rcn);
  ck('6g input snapshots are not changed by the AI labels (REAL snapshots, same JSON before and after)', (function () { var s = JSON.stringify(RED); hook = { isA: function () { return true; } }; rebuild(); hook = null; return JSON.stringify(RED) === s; })(), 0);
  // 7 app.js source
  var app = fs.readFileSync(path.join(__dirname, 'src/app.js'), 'utf8');
  ck('7a app.js requires aiflow and builds it from AI_URL, which is the deployed Worker address (S23-4c-2)', /var AIF = require\('\.\/aiflow\.js'\)/.test(app) && /var AI_URL = 'https:\/\/smartsetu-ai\.smartsetuofficial\.workers\.dev', aiLast/.test(app) && /AIF\.make\(\{ url: AI_URL,/.test(app), 0);
  ck('7b network call is the documented CapacitorHttp.post with data, headers and timeouts', /CapacitorHttp\.post\(\{ url: u, headers: \{ 'Content-Type': 'application\/json' \}, data: body, connectTimeout: ms, readTimeout: ms \}\)/.test(app), 0);
  ck('7c buildNow passes the labels; labels are cleared at the start of every new search', /query: live\.q, ai: aiLabels \|\| undefined, searches/.test(app) && /var gen = \+\+runGen;\s*if \(!only\) aiLabels = null;/.test(app), 0);
  ck('7d rewrite happens after the skeleton is drawn and before the stores start; effective query comes from Q.aiQuery', /AIX\.rewrite\(userQ\)/.test(app) && /SmartSetu\.query\.aiQuery\(aiR\.search, aiR\.max_price\)/.test(app) && app.indexOf('AIX.rewrite(userQ)') > app.indexOf("skeleton(); $('morebox').hidden = true; initProgress(pl);") && app.indexOf('AIX.rewrite(userQ)') < app.indexOf('function opts(enabled)'), 0);
  ck('7e classify loop runs after the result is on screen; a newer screen is drawn only when something was dropped', app.indexOf('AIX.refine(') > app.indexOf("$('morebox').hidden = true;") && app.indexOf('AIX.refine(') > app.indexOf('var fin = buildNow('), 0);
  ck('7f the busy check compares with the member own text', /if \(busy && !only && q === live\.userQ\) q = live\.q;/.test(app), 0);
  ck('7g owner report line for the AI check is wired', /aiDiag: aiDiag/.test(app) && /function aiDiag\(\)/.test(app), 0);
  ck('7h nothing the older tests forbid: no fetch( , no innerHTML, one localStorage, no eval(, runAll once', app.indexOf('fetch(') < 0 && app.indexOf('innerHTML') < 0 && (app.match(/localStorage/g) || []).length === 1 && app.indexOf('eval(') < 0 && (app.match(/\.runAll\(/g) || []).length === 1, 0);
  var af = fs.readFileSync(path.join(__dirname, 'src/aiflow.js'), 'utf8');
  ck('7j the address in app.js is the one the Worker was deployed at (V-562) and passes the strict https check of aiflow, so the AI is ON in this build', (function () { var m = /var AI_URL = '([^']*)'/.exec(app); return !!m && m[1] === 'https://smartsetu-ai.smartsetuofficial.workers.dev' && AIF.make({ url: m[1], post: function () {} }).on() === true; })(), 0);
  ck('7i aiflow touches no storage and no page: no localStorage, no document, no window, no fetch(', !/localStorage|sessionStorage|indexedDB|document\.|window\.|fetch\(/.test(af), 0);
  // 8 S23-3a: the on-device meaning model is gone
  var pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')), wf = fs.readFileSync(path.join(__dirname, '.github/workflows/release-apk.yml'), 'utf8'), dv = fs.readFileSync(path.join(__dirname, 'src/devtest.js'), 'utf8');
  ck('8a app.js and devtest.js have no trace of the on-device model', !/semRefine|semEng|semDiag|SEM\.make|Tokenizer|ortglue|semantic\.js|MEANING CHECK/.test(app + dv), 0);
  ck('8b the model files and their packages are gone: no src/semantic.js, no src/ortglue.js, no smoke folder, no smoke-semantic workflow', !fs.existsSync(path.join(__dirname, 'src/semantic.js')) && !fs.existsSync(path.join(__dirname, 'src/ortglue.js')) && !fs.existsSync(path.join(__dirname, 'smoke')) && !fs.existsSync(path.join(__dirname, '.github/workflows/smoke-semantic.yml')), 0);
  ck('8c package.json has no onnxruntime-web and no tokenizers; the release workflow downloads no model', !pkg.dependencies['onnxruntime-web'] && !pkg.dependencies['@huggingface/tokenizers'] && !/huggingface|onnx|models\//i.test(wf), Object.keys(pkg.dependencies));
  ck('8d package-lock.json matches package.json (no model packages left)', !/onnxruntime|huggingface|flatbuffers|guid-typescript/.test(fs.readFileSync(path.join(__dirname, 'package-lock.json'), 'utf8')), 0);
  console.log('test_s23_2c: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
