/* app-spike / test_s22i v1.0.0 (S22i, D-130). Run: node test_s22i.js
 * PROTOTYPE FROM THE SAME SEARCH: listings the words already confirmed are examples of what is meant; unconfirmed listings that look like them are shown as close.
 * The model is FAKE here (hand-made 3-number vectors, SYNTHETIC) so the numbers prove the wiring, not the real model quality (that is V-501, to be read from the phone). */
'use strict';
var S = require('./src/semantic.js'), Q = require('../query-engine/query_engine.js'), pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d)); } }
var V = { 'smartphone': [0.6, 0.6, 0], 'Phone A 4GB RAM Smartphone': [1, 0.1, 0], 'Phone B 6GB RAM Smartphone': [0.95, 0.15, 0], 'Phone C 8GB RAM Smartphone': [0.9, 0.2, 0],
  'Toy Learning Smartphone': [0.2, 1, 0], 'Apple iPhone Silver 256 GB': [0.98, 0.12, 0], 'Redmi Green 64 GB': [0.92, 0.18, 0], 'Women Kurta Set': [0, 0.05, 1], 'Mokobara Wallet': [0.1, 0.5, 0.3] };
function norm(v) { var n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; }
var keys = Object.keys(V);
var deps = { load: function () { return Promise.resolve(); }, tokenize: function (t) { return { ids: [keys.indexOf(t) + 1] }; },
  runModel: function (ids) { var v = norm(V[keys[ids[0] - 1]]); return Promise.resolve({ data: new Float32Array(v), seq: 1, dim: 3 }); } };
// the self-check texts must exist too
['dog food', 'puppy food', 'steel water bottle'].forEach(function (t, i) { V[t] = [[1, 0, 0], [0.95, 0.1, 0], [0, 0, 1]][i]; keys.push(t); });
function card(t, p) { return { title: t, link: '', priceNum: p || 5000 }; }
function cards(a) { return a.map(function (t, i) { return card(t, 5000 + i); }); }
var seeds = ['Phone A 4GB RAM Smartphone', 'Phone B 6GB RAM Smartphone', 'Phone C 8GB RAM Smartphone', 'Toy Learning Smartphone'];
var titles = ['Apple iPhone Silver 256 GB', 'Redmi Green 64 GB', 'Women Kurta Set', 'Mokobara Wallet'];
var m = S.make(deps, { deviceMemory: 8 });
m.prepare('smartphone', titles, null, seeds).then(function (sem) {
  ck('1a sem built, seeds counted, outlier seed (the toy) dropped', sem && sem.info.seeds === 4 && sem.info.seedsKept === 3, sem && sem.info);
  ck('1b agree: phones high, kurta and wallet low', sem.agree('Apple iPhone Silver 256 GB') > 0.9 && sem.agree('Redmi Green 64 GB') > 0.9 && sem.agree('Women Kurta Set') < 0.2 && sem.agree('Mokobara Wallet') < 0.55, [sem.agree('Apple iPhone Silver 256 GB'), sem.agree('Women Kurta Set'), sem.agree('Mokobara Wallet')]);
  ck('1c sim is the larger of query likeness and prototype likeness', sem.sim('Apple iPhone Silver 256 GB') >= sem.agree('Apple iPhone Silver 256 GB') - 1e-9 && sem.agreeMin === 0.55, 0);
  return m.prepare('smartphone', titles, null, []).then(function (s2) {
    ck('2 no seeds: no prototype, agree undefined, sim = query likeness only', s2 && s2.agree === undefined && Math.abs(s2.sim('Apple iPhone Silver 256 GB') - (function () { var a = norm(V['smartphone']), b = norm(V['Apple iPhone Silver 256 GB']); return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; })()) < 1e-6, s2 && s2.info);
    // 3 engine: Amazon confirmed by words; Flipkart / Reliance titles say nothing about phones (like the real ones); a kurta and a wallet are in the pool
    var per = { Amazon: cards(seeds.slice(0, 3)).concat([card('Amazon Plain Box', 9999)]), Flipkart: cards(['Apple iPhone Silver 256 GB', 'Redmi Green 64 GB']).concat([card('Women Kurta Set', 5002)]), Reliance: cards(['Apple iPhone Silver 256 GB', 'Redmi Green 64 GB']), Nykaa: cards(['Mokobara Wallet']) };
    var off = Q.rank('smartphone', per), on = Q.rank('smartphone', per, undefined, sem);
    function t2(r, st) { return r.stores[st][2].map(function (c) { return c.title; }); }
    ck('3a without the check the unconfirmed phones are not shown', t2(off, 'Flipkart').length === 0 && t2(off, 'Reliance').length === 0, t2(off, 'Flipkart'));
    ck('3b with the prototype check the phones of Flipkart and Reliance are shown as close, never exact', t2(on, 'Flipkart').length === 2 && t2(on, 'Reliance').length === 2 && on.stores.Flipkart[3].length === 0 && on.stores.Reliance[3].length === 0, [t2(on, 'Flipkart'), t2(on, 'Reliance')]);
    ck('3c kurta and wallet are not shown', t2(on, 'Flipkart').indexOf('Women Kurta Set') < 0 && t2(on, 'Nykaa').length === 0, [t2(on, 'Flipkart'), t2(on, 'Nykaa')]);
    // 4 a lone rescued card that the prototype does NOT like still needs the other stores to agree (the wallet case)
    var fakeSem = { sim: function (t) { return t === 'Mokobara Wallet' ? 0.9 : 0.3; }, agree: function (t) { return t === 'Mokobara Wallet' ? 0.2 : 0.3; }, agreeMin: 0.55, floor: 0.3, rel: 0.5 };
    var w = Q.rank('smartphone', per, undefined, fakeSem);
    ck('4 wallet liked by the query but far from the prototype: not shown', t2(w, 'Nykaa').length === 0, t2(w, 'Nykaa'));
    ck('5 engine 0.18', Q.version === '0.18', Q.version);
    var app = require('fs').readFileSync(require('path').join(__dirname, 'src/app.js'), 'utf8');
    ck('6 app passes the confirmed listings as seeds and records the sample', /prepare\(qt, titles, function \(\) \{ return gen !== runGen \|\| gaveUp; \}, seeds\)/.test(app) && /semLast\.sample = smp/.test(app), 0);
    console.log('test_s22i: ' + pass + ' pass, ' + fail + ' fail');
    process.exit(fail ? 1 : 0);
  });
}).catch(function (e) { console.log('CRASH ' + e.stack); process.exit(1); });
