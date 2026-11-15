/* app-spike / test_s21e v1.0.0 (S21e, V-385..V-388). Run: node test_s21e.js
 * Croma pincode steps (page function, same-page read, report lines), the "why not in result" column, devtest = normal run wiring.
 * The page function is run in jsdom when it is installed (sandbox only, skipped on the owner PC like test_pricedom). */
'use strict';
var fs = require('fs'), path = require('path');
require('./www/bundle.js');
var W = require('./src/webtabs.js'), pass = 0, fail = 0, skipped = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d)); } }
(async function () {
  // 1. pinRead: same page, pincode step first, cards second; run shape for the engine
  var calls = [], wt = { tabs: { create: async function () { return { id: 7 }; }, get: async function () { return { status: 'complete' }; }, remove: async function () { calls.push('remove'); } },
    scripting: { executeScript: async function (o) { calls.push(o.func.name + ':' + JSON.stringify(o.args)); return [{ result: o.func.name === 'pincodeSet' ? { found: true, steps: ['field found: placeholder Enter Pincode', 'clicked: Apply'], after: 'Delivering to 400001', fieldStill: false } : { url: 'https://www.croma.com/searchB?q=x', title: 't', leaves: 3, outcome: { picked: 1 }, cards: [{ link: 'https://www.croma.com/p/1', html: '<div>Samsung TV \u20B91,000</div>' }], dump: [] } }]; } } };
  var store = { label: 'Croma', key: 'croma', url: function (q) { return 'https://www.croma.com/searchB?q=' + q; } };
  var r = await W.pinRead(wt, store, 'x', '400001', {});
  ck('1 pincode step runs first with the pincode, cards read second, one page', calls[0] === 'pincodeSet:["400001"]' && /^cardRescue:/.test(calls[1]) && calls.filter(function (c) { return c === 'remove'; }).length === 1, calls);
  ck('2 run is ok with a snapshot and says what was typed', r.state === 'ok' && r.cards === 1 && r.snapshot.cards.length === 1 && r.pin.used === '400001' && r.pin.found === true, r);
  var pl = W.pinLines(r).join('|');
  ck('3 report lines: pincode, result, every step, text after', /Croma pincode 400001 \| result: FOUND 1 cards/.test(pl) && /step: clicked: Apply/.test(pl) && /page text after: Delivering to 400001/.test(pl), pl);
  var wt2 = { tabs: wt.tabs, scripting: { executeScript: async function (o) { if (o.func.name === 'pincodeSet') throw new Error('page navigated'); return [{ result: { url: 'u', cards: [], leaves: 0, outcome: {}, dump: [] } }]; } } };
  var r2 = await W.pinRead(wt2, store, 'x', '400001', {});
  ck('4 if the pincode step fails the plain read still runs and the error is in the report', r2.state === 'no_cards' && /page navigated/.test(r2.pin.error) && /page script failed: page navigated/.test(W.pinLines(r2).join('|')), r2.pin);
  ck('5 no pin info is not an error', W.pinLines({ store: 'Croma' })[0] === 'Croma pincode: not tried in this run' && W.CROMA_PIN === '400001', W.CROMA_PIN);
  // 2. report: why a listing is not in the result (every store)
  var snap = { v: 1, kind: 'search', query: 'x', url: 'https://www.meesho.com/search?q=x', probe: 'x', cards: [{ link: 'https://www.meesho.com/a/p/3abc', html: '<div><a href="https://www.meesho.com/a/p/3abc">Designer Trendy Men Tracksuits</a> \u20B9467 \u20B9399 with 2 Special Offers</div>' }] };
  var P = SmartSetu.parseSearch, key = W.normUrl('https://www.meesho.com/a/p/3abc'), why = {}; why[key] = 'tier 3, no_brand_in_query, eligible: beyond the top 5 or a duplicate';
  var withWhy = W.listingLines([{ store: 'Meesho', snapshot: snap }], [], P, why).join('|'), without = W.listingLines([{ store: 'Meesho', snapshot: snap }], [], P).join('|');
  ck('6 listing line carries the engine reason', /- not in result \(tier 3, no_brand_in_query, eligible: beyond the top 5 or a duplicate\) \| /.test(withWhy), withWhy.slice(0, 300));
  ck('7 without a reason the old line is unchanged', /- not in result \| /.test(without), without.slice(0, 200));
  var inRes = W.listingLines([{ store: 'Meesho', snapshot: snap }], [{ url: 'https://www.meesho.com/a/p/3abc' }], P, why).join('|');
  ck('8 a listing that is in the result says only that', /- in result \| /.test(inRes) && !/in result \(/.test(inRes), inRes.slice(0, 200));
  // 3. devtest wiring = normal run path
  var dv = fs.readFileSync(path.join(__dirname, 'src', 'devtest.js'), 'utf8');
  ck('9 test reads like a normal Compare: fast read first, Myntra and Croma on their own, ready probe, why map, timing, insets', /fetchFirst: fr\.STORES_OK/.test(dv) && /enabled: \{ Myntra: false, Croma: false \}/.test(dv) && /W\.pinRead\(tabs2, cst, q, W\.CROMA_PIN/.test(dv) && /createWebTabs\(env\.pluginApi\(\), \{ ready: true \}\)/.test(dv) && /listingLines\(runs, W\.rowsOf\(view\), env\.SmartSetu\.parseSearch, why\)/.test(dv) && /TIMING \(s\)/.test(dv) && /INSETS:/.test(dv), 'devtest wiring');
  // 4. the page function itself, in jsdom
  var JSDOM = null; try { JSDOM = require('jsdom').JSDOM; } catch (_) {}
  if (!JSDOM) { skipped = 1; console.log('SKIP pincodeSet DOM checks: jsdom not installed (sandbox-only tool)'); }
  else {
    var realST = global.setTimeout;
    async function run(html, pin) {
      var dom = new JSDOM(html, { runScripts: 'dangerously' }), w = dom.window; w.Element.prototype.getBoundingClientRect = function () { return { width: 10, height: 10 }; };
      global.document = w.document; global.HTMLInputElement = w.HTMLInputElement; global.Event = w.Event; global.KeyboardEvent = w.KeyboardEvent; global.setTimeout = function (f) { return realST(f, 1); };
      try { return { res: await W.pincodeSet(pin), doc: w.document }; } finally { global.setTimeout = realST; }
    }
    var a = await run('<body><div id="d"><input placeholder="Enter Pincode" maxlength="0"><button id="b">Apply</button></div></body>', '400001');
    var inp = a.doc.querySelector('input');
    ck('10 field found, pincode typed, apply button clicked, Enter sent', a.res.found && inp.value === '400001' && a.res.steps.some(function (s) { return /clicked: Apply/.test(s); }) && a.res.steps.indexOf('Enter sent') >= 0, a.res);
    var b = await run('<body><p>nothing here</p></body>', '400001');
    ck('11 no field and no opener: found false and says so', b.res.found === false && /no pincode opener/.test(b.res.steps.join()), b.res);
    var b2 = await run('<body><span id="o">Add Pincode</span></body>', '400001');
    ck('11b an opener that shows no field: opened is reported, found false', b2.res.found === false && /opened: Add Pincode/.test(b2.res.steps.join()), b2.res);
    var b3 = await run('<body><span id="o">Add Pincode</span><div id="m"></div><script>document.getElementById("o").addEventListener("click",function(){var i=document.createElement("input");i.placeholder="Enter Pincode";document.getElementById("m").appendChild(i);});</script></body>', '400001');
    ck('11c an opener that reveals the field: the field is found and typed', b3.res.found === true && b3.doc.querySelector('input') && b3.doc.querySelector('input').value === '400001', b3.res);
    var c = await run('<body><input placeholder="Search" value="tv"><input placeholder="Enter Pincode"></body>', '110001');
    ck('12 only the pincode field is touched, the search box keeps its text', c.doc.querySelectorAll('input')[0].value === 'tv' && c.doc.querySelectorAll('input')[1].value === '110001' && c.res.steps.some(function (s) { return /no apply button/.test(s); }), c.res);
  }
  console.log('test_s21e: ' + pass + ' pass, ' + fail + ' fail' + (skipped ? ' (DOM checks skipped)' : '')); process.exit(fail ? 1 : 0);
})();
