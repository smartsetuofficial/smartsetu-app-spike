/* app-spike / test_s23_17 v1.0.0 (S23-17; D-162, V-605). Run: node test_s23_17.js
 * 0.10.28 Full Test: Tata CLiQ no_cards 3 of 11 (page saw: /search/, home title, 0 cards), Croma no_cards 1, each about 18 s.
 * Rules (ALL stores, no store word): (1) an empty tab page that SAYS no results is not read again and is no_results; (2) an empty tab page with the store's home title gets ONE fresh tab. */
'use strict';
var R = require('./www/runner_core.js');
var pass = 0, fail = 0;
function ck(n, c, x) { if (c) pass++; else { fail++; console.log('FAIL ' + n + (x ? ' ' + JSON.stringify(x) : '')); } }
var TC = R.STORES.filter(function (s) { return s.key === 'tatacliq'; })[0];
var HOME = 'Online Fashion & Lifestyle Shopping for Women, Men & Kids in India - Tata CLiQ';

// mock api: script(n, which) gives what the n-th collect (1 based, counted over all tabs) returns; info gives the pageInfo answer
function mk(opt) {
  var s = { created: [], removed: [], collects: 0, infos: 0 };
  s.tabs = { create: function (o) { var id = s.created.length + 1; s.created.push({ id: id, url: o.url }); return Promise.resolve({ id: id }); }, remove: function (id) { s.removed.push(id); return Promise.resolve(); }, get: function (id) { return Promise.resolve({ id: id, status: 'complete' }); }, onUpdated: { addListener: function () {}, removeListener: function () {} } };
  s.scripting = { executeScript: function (a) {
    if (a.func && a.func.name === 'pageInfo') { s.infos++; return Promise.resolve([{ result: opt.info ? opt.info(a.target.tabId, s.infos) : { readyState: 'complete', visibility: 'hidden', links: 5, nr: false } }]); }
    s.collects++; return Promise.resolve([{ result: opt.collect(a.target.tabId, s.collects) }]);
  } };
  return s;
}
function one(api, extra) {
  var en = {}; R.STORES.forEach(function (x) { en[x.label] = x.key === 'tatacliq'; });
  return R.runAll(api, Object.assign({ query: 'washing machine 7 kg front load', enabled: en, collect: function () {}, settleMs: 0, loadMs: 60, rereads: 2, rereadMs: 5, retryTimeouts: false }, extra || {})).then(function (o) { return o.runs.filter(function (x) { return x.key === 'tatacliq'; })[0]; });
}
function card(i) { return { link: 'https://www.tatacliq.com/p-' + i, text: 'x' + i }; }

(async function () {
  // 1 homeLike (pure)
  ck('1a Tata CLiQ home title, no search word', R.homeLike(HOME, 'washing machine 7 kg front load') === true);
  ck('1b a title with a search word is not home', R.homeLike('Washing machine - Buy online - Tata CLiQ', 'washing machine 7 kg front load') === false);
  ck('1c a plain unknown title is not home', R.homeLike('Tata CLiQ', 'washing machine') === false && R.homeLike('', 'washing machine') === false && R.homeLike('Online Store', '') === false);
  ck('1d other shop-home titles', R.homeLike('Online Electronic Shopping Store in India - Reliance Digital', 'shoes') === true && R.homeLike('Shop online for mobiles', 'shoes') === true);

  // 2 page SAYS no results: not read again, no_cards + noResults, no fresh tab
  var a = mk({ collect: function () { return { cards: [], url: 'u', title: 'Search results' }; }, info: function () { return { readyState: 'complete', visibility: 'hidden', links: 8, nr: true }; } });
  var r2 = await one(a);
  ck('2a said no results: collect only once, state no_cards, noResults true', a.collects === 1 && r2.state === 'no_cards' && r2.noResults === true && r2.nrWhy === 'tab text', { c: a.collects, r: r2 && r2.state });
  ck('2b one tab only', a.created.length === 1 && r2.freshRetry !== true, a.created.length);
  ck('2c diag keeps nr', r2.diag && r2.diag.nr === true, r2.diag);

  // 3 empty page, nothing said, normal title: reread as before (3 collects), no_cards, NOT noResults, no fresh tab
  var b = mk({ collect: function () { return { cards: [], url: 'u', title: 'washing machine - Tata CLiQ' }; } });
  var r3 = await one(b);
  ck('3a unknown empty page: 3 collects (1 + 2 rereads), failure kept', b.collects === 3 && r3.state === 'no_cards' && !r3.noResults && r3.rereads === 2, { c: b.collects, r: r3 });
  ck('3b no fresh tab for a normal title', b.created.length === 1, b.created.length);

  // 4 empty page with the home title: ONE fresh tab; the second read finds cards
  var c = mk({ collect: function (tab) { return tab === 1 ? { cards: [], url: 'u', title: HOME } : { cards: [card(1), card(2)], url: 'u', title: 'washing machine - Tata CLiQ' }; } });
  var r4 = await one(c);
  ck('4a fresh tab found cards: state ok, freshRetry, first try kept', r4.state === 'ok' && r4.freshRetry === true && r4.firstTry && r4.firstTry.state === 'no_cards' && r4.cards === 2, r4);
  ck('4b exactly 2 tabs opened and both closed', c.created.length === 2 && c.removed.length === 2, { cr: c.created.length, rm: c.removed.length });

  // 5 home title twice: only ONE fresh try, then the failure stays visible
  var d = mk({ collect: function () { return { cards: [], url: 'u', title: HOME }; } });
  var r5 = await one(d);
  ck('5a still empty after the fresh tab: no_cards, no third tab, freshRetry marked', d.created.length === 2 && r5.state === 'no_cards' && r5.freshRetry === true && !r5.noResults, { cr: d.created.length, r: r5 });

  // 6 the deadline: no time left = no fresh tab
  var e = mk({ collect: function () { return { cards: [], url: 'u', title: HOME }; } });
  var r6 = await one(e, { deadlineAt: Date.now() + 1 });
  ck('6a no time budget: no tab opened at all (skipped)', e.created.length === 0 && r6.state === 'skipped', { cr: e.created.length, r: r6.state });
  var e2 = mk({ collect: function () { return { cards: [], url: 'u', title: HOME }; } });
  var r6b = await one(e2, { freshRetry: false });
  ck('6b freshRetry false switches it off', e2.created.length === 1 && r6b.freshRetry !== true, e2.created.length);

  // 7 a page with cards never asks pageInfo and is untouched
  var f = mk({ collect: function () { return { cards: [card(1)], url: 'u', title: HOME }; } });
  var r7 = await one(f);
  ck('7a cards on the first read: ok, pageInfo never asked, one tab', r7.state === 'ok' && f.infos === 0 && f.created.length === 1 && !r7.freshRetry, { i: f.infos, r: r7.state });

  // 8 stopOnNoResults false: old behaviour (reads again)
  var g = mk({ collect: function () { return { cards: [], url: 'u', title: 'x' }; }, info: function () { return { readyState: 'complete', visibility: 'hidden', links: 1, nr: true }; } });
  var r8 = await one(g, { stopOnNoResults: false });
  ck('8a switch off: 3 collects as before', g.collects === 3, g.collects);

  // 9 pageInfo itself in a fake page (the function is sent into the tab)
  global.document = { body: { innerText: 'Sorry, no results found for your search' }, readyState: 'complete', visibilityState: 'hidden', querySelectorAll: function () { return [1, 2, 3]; } };
  var pi = R.pageInfo(); ck('9a says no results: nr true, links 3', pi.nr === true && pi.links === 3 && pi.readyState === 'complete', pi);
  global.document.body.innerText = 'Washing machines 24 products found. Filters: brand';
  pi = R.pageInfo(); ck('9b normal words: nr false', pi.nr === false, pi);
  global.document.body = null; pi = R.pageInfo(); ck('9c no body: nr false, no throw', pi.nr === false, pi);
  var src = String(R.pageInfo); ck('9d pageInfo is self contained (no outer names)', !/\bNO_RES\b|\bHOME_TITLE_TAB\b|\bSTOP_TAB\b/.test(src));
  delete global.document;

  // 10 pageInfo that never answers must not stall the read
  var h = mk({ collect: function () { return { cards: [], url: 'u', title: 'x' }; } });
  h.scripting.executeScript = (function (orig) { return function (a) { if (a.func && a.func.name === 'pageInfo') return new Promise(function () {}); return orig(a); }; })(h.scripting.executeScript);
  var t0 = Date.now(), r10 = await one(h, { pageInfoMs: 30 });
  ck('10a a silent pageInfo: still 3 collects, finished fast, no hang', h.collects === 3 && Date.now() - t0 < 3000, { c: h.collects, ms: Date.now() - t0 });

  console.log('test_s23_17: ' + pass + ' pass, ' + fail + ' fail'); process.exit(fail ? 1 : 0);
})();
