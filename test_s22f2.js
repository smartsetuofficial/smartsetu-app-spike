/* app-spike / test_s22f2 v0.1.0 (S22f-2 part 1). Run: node test_s22f2.js
 * Tests src/semantic.js with a FAKE tokenizer and a FAKE model (a word -> concept table, written for this test). All numbers are SYNTHETIC, not model output.
 * The real model, the real tokenizer and the WebView are NOT tested here (they are checked in CI and on the phone). */
'use strict';
var S = require('./src/semantic.js'), pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d)); } }

var CONCEPT = { dog: 0, kutta: 0, puppy: 0, food: 1, khana: 1, steel: 2, water: 3, bottle: 3, cotton: 4, bedsheet: 4, chicken: 5, pedigree: 6, adult: 7, dry: 7, kg: 8, royal: 9, canin: 9 };
var DIM = 12, END = 99;
function words(t) { return String(t).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }
function fakeTokenize(t) { var ids = [98]; words(t).forEach(function (w) { ids.push(Object.prototype.hasOwnProperty.call(CONCEPT, w) ? 100 + CONCEPT[w] : 200); }); ids.push(END); return { ids: ids }; }
function fakeRun(ids) { // one-hot per token (concept = id-100), special tokens get a small constant
  var data = new Float32Array(ids.length * DIM);
  ids.forEach(function (id, t) { if (id >= 100 && id < 200) data[t * DIM + (id - 100)] = 1; else if (id === 200) data[t * DIM + 11] = 0.2; else data[t * DIM + 10] = 0.1; });
  return Promise.resolve({ data: data, seq: ids.length, dim: DIM });
}
function deps(extra) { var d = { loads: 0, runs: 0, lastIds: null, load: function () { d.loads++; return Promise.resolve(); }, tokenize: fakeTokenize, runModel: function (ids, m) { d.runs++; d.lastIds = ids; return fakeRun(ids, m); } }; return Object.assign(d, extra || {}); }

var DOG = ['Pedigree Adult Dry Dog Food Chicken 3 kg', 'Royal Canin Dog Food 4 kg', 'Pedigree Puppy Food 1 kg'], JUNK = ['Cotton Bedsheet Double Bed', 'Steel Water Bottle 1 L'];

(async function () {
  // 1 mean pool: mask honoured, length 1
  var p = S.meanPool(new Float32Array([3, 0, 0, 4, 9, 9]), 3, 2, [1, 1, 0]);
  ck('1a pool average then unit length', Math.abs(p[0] - 0.6) < 1e-6 && Math.abs(p[1] - 0.8) < 1e-6, Array.from(p));
  ck('1b all-zero input gives zeros, no NaN', S.meanPool(new Float32Array(4), 2, 2, [1, 1]).every(function (x) { return x === 0; }), 0);
  ck('1c okVec rejects zeros and NaN', !S.okVec(new Float32Array(3)) && !S.okVec(new Float32Array([NaN, 1, 0])) && S.okVec(new Float32Array([1, 0, 0])), 0);
  ck('1d clip keeps the last token', JSON.stringify(S.clip([1, 2, 3, 4, 5], 3)) === '[1,2,5]' && JSON.stringify(S.clip([1, 2], 3)) === '[1,2]', S.clip([1, 2, 3, 4, 5], 3));
  ck('1e lowMemory: 2 GB low, 6 GB ok, unknown ok', S.lowMemory(2, 4) && !S.lowMemory(6, 4) && !S.lowMemory(undefined, 4), 0);

  // 2 happy path
  var d = deps(), m = S.make(d), sem = await m.prepare('kutta ka khana', DOG.concat(JUNK));
  ck('2a ready after prepare, loaded once', m.state().status === 'ready' && d.loads === 1, m.state());
  ck('2b sem has sim, floor, rel, max', sem && typeof sem.sim === 'function' && sem.floor === 0.3 && sem.rel === 0.85 && sem.max === 8, sem && Object.keys(sem));
  var sd = sem.sim(DOG[1]), sj = sem.sim(JUNK[0]);
  ck('2c dog title closer than junk (synthetic)', sd > 0.3 && sj < 0.1 && sd > sj, [sd, sj]);
  ck('2d unknown title gives undefined', sem.sim('never embedded') === undefined, 0);
  ck('2e info counts', sem.info.titles === 5 && sem.info.embedded === 5 && !sem.info.partial && sem.info.status === 'ready', sem.info);
  var runs = d.runs; await m.prepare('kutta ka khana', DOG);
  ck('2f same titles again: no new model calls (cache)', d.runs === runs + 0 || d.runs === runs, [d.runs, runs]);
  ck('2f2 and load not repeated', d.loads === 1, d.loads);

  // 3 no work without need
  var d3 = deps(), m3 = S.make(d3);
  ck('3a empty query or titles: null, nothing loaded', (await m3.prepare('', DOG)) === null && (await m3.prepare('x', [])) === null && d3.loads === 0, d3.loads);

  // 4 low memory: never loads
  var d4 = deps(), m4 = S.make(d4, { deviceMemory: 2 });
  ck('4a low memory: null, status lowmem, load never called', (await m4.prepare('kutta ka khana', DOG)) === null && m4.state().status === 'lowmem' && d4.loads === 0, m4.state());
  var d4b = deps(), m4b = S.make(d4b, { deviceMemory: 8 });
  ck('4b enough memory loads', (await m4b.prepare('kutta ka khana', DOG)) !== null && d4b.loads === 1, m4b.state());

  // 5 failures = fallback, load tried once
  var d5 = deps({ load: function () { d5.loads++; return Promise.reject(new Error('boom')); } }), m5 = S.make(d5);
  var a5 = await m5.prepare('kutta ka khana', DOG), b5 = await m5.prepare('kutta ka khana', DOG);
  ck('5a load error: null twice, load called once, reason kept', a5 === null && b5 === null && d5.loads === 1 && m5.state().status === 'failed' && /boom/.test(m5.state().reason), m5.state());
  var d6 = deps({ load: function () { return new Promise(function () {}); } }), m6 = S.make(d6, { loadMs: 30 });
  ck('5b load that never ends: timeout, failed', (await m6.prepare('kutta ka khana', DOG)) === null && /timeout/.test(m6.state().reason), m6.state());
  var d7 = deps({ runModel: function (ids) { return Promise.resolve({ data: new Float32Array(ids.length * DIM).fill(1), seq: ids.length, dim: DIM }); } }), m7 = S.make(d7);
  ck('5c model that gives the same vector for everything fails the self-check', (await m7.prepare('kutta ka khana', DOG)) === null && /self-check/.test(m7.state().reason), m7.state());
  var d8 = deps({ runModel: function () { return Promise.reject(new Error('wasm')); } }), m8 = S.make(d8);
  ck('5d model run error: null, failed (self-check cannot pass)', (await m8.prepare('kutta ka khana', DOG)) === null && m8.state().status === 'failed', m8.state());

  // 6 one bad title does not hurt the rest
  var bad = DOG[1], d9 = deps({ runModel: function (ids) { d9.runs++; if (ids.length === fakeTokenize(bad).ids.length && ids.join() === fakeTokenize(bad).ids.join()) return Promise.reject(new Error('x')); return fakeRun(ids); } }), m9 = S.make(d9);
  var s9 = await m9.prepare('kutta ka khana', DOG);
  ck('6a failed title: sim undefined, others fine', s9 && s9.sim(bad) === undefined && s9.sim(DOG[0]) > 0.3 && s9.info.embedded === 2, s9 && s9.info);

  // 7 stale: a newer search stops the work
  var d10 = deps(), m10 = S.make(d10, { yieldEvery: 1 }), many = []; for (var i = 0; i < 30; i++) many.push('Pedigree Dog Food ' + i + ' kg');
  var n10 = 0, s10 = await m10.prepare('kutta ka khana', many, function () { n10++; return n10 > 3; });
  ck('7a stale search: no sem returned, work stopped early', s10 === null && d10.runs < 20, d10.runs);

  // 8 long title is cut to maxLen, closing token kept
  var d11 = deps(), m11 = S.make(d11, { maxLen: 6 }); await m11.embed('dog dog dog dog dog dog dog dog food');
  ck('8a ids cut to 6, last id kept', d11.lastIds.length === 6 && d11.lastIds[5] === END, d11.lastIds);

  // 9 cache is bounded
  var d12 = deps(), m12 = S.make(d12, { cacheMax: 4 }); await m12.prepare('kutta ka khana', many.slice(0, 10));
  ck('9a cache never above cacheMax', m12.state().cached <= 4, m12.state());

  // 10 with the real rank() when the engine folder is next to this one (sandbox / owner PC only; the app repo alone skips this)
  var Q = null; try { Q = require('../query-engine/query_engine.js'); } catch (_) { Q = null; }
  if (Q) {
    var per = { Amazon: [{ title: DOG[0], link: '', priceNum: 400 }, { title: DOG[1], link: '', priceNum: 500 }, { title: JUNK[0], link: '', priceNum: 400 }], Flipkart: [{ title: DOG[2], link: '', priceNum: 300 }, { title: 'Drools Puppy Dog Food 2 kg', link: '', priceNum: 350 }, { title: JUNK[1], link: '', priceNum: 200 }] };
    var m13 = S.make(deps()), all = []; Object.keys(per).forEach(function (k) { per[k].forEach(function (c) { all.push(c.title); }); });
    var s13 = await m13.prepare(Q.semText(Q.parse('kutta ka khana')), all), r13 = Q.rank('kutta ka khana', per, undefined, s13), shown = [];
    Object.keys(r13.stores).forEach(function (k) { shown = shown.concat(r13.stores[k][2].map(function (c) { return c.title; })); });
    ck('10a rank + sem: dog food cards rescued to close, junk not', shown.indexOf(DOG[1]) >= 0 && shown.indexOf(JUNK[0]) < 0 && shown.indexOf(JUNK[1]) < 0 && r13.sem && r13.sem.rescued >= 3, [shown, r13.sem]);
    var r13b = Q.rank('kutta ka khana', per, undefined, null);
    ck('10b rank with sem null = no sem key (old behaviour)', !('sem' in r13b), Object.keys(r13b));
  } else console.log('NOTE: ../query-engine not found, test 10 skipped');

  console.log('TEST s22f2: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
