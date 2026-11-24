/* app-spike / test_s23_10i v1.0.0 (S23-10 item i, D-152). Run: node test_s23_10i.js   (list of stores x registries: node test_s23_10i.js --list)
 * Store onboarding self-test. Every store key must be present, and agree, in every place the app and the extension keep a store list (see 09_STORE_ONBOARDING.md).
 * Offline, reads source files only, changes nothing. A new store that is missing in one place makes this test FAIL with the exact place.
 * NOT checked here: that the real store page works (needs a saved snapshot + parser test + Full Test Mode report). */
'use strict';
var fs = require('fs'), path = require('path');
var ROOT = path.join(__dirname, '..');            // code/
var APP = __dirname, EXT = path.join(ROOT, 'extension'), PARSER = path.join(ROOT, 'parser-core');
var DOC = path.join(ROOT, '..', '09_STORE_ONBOARDING.md');
var REG_FILES = ['parser-core/parser.js', 'app-spike/www/runner_core.js', 'extension/runner_core.js', 'app-spike/www/view.js', 'extension/view.js', 'app-spike/src/storemap.js',
  'app-spike/www/fetchread.js', 'extension/stock_core.js', 'extension/manifest.json', 'app-spike/www/bundle.js', 'extension/bundle.js', 'app-spike/src/app.js'];

function rd(p) { return fs.readFileSync(p, 'utf8'); }
function same(a, b) { return fs.readFileSync(a).equals(fs.readFileSync(b)); }
function listIn(src, re, what) { var m = re.exec(src); if (!m) throw new Error('cannot find ' + what); return m[1]; }
function strs(txt) { var o = [], r = /'([^']+)'|"([^"]+)"/g, m; while ((m = r.exec(txt))) o.push(m[1] || m[2]); return o; }
function keysOf(txt) { var o = [], r = /(?:'([^']+)'|"([^"]+)"|([A-Za-z_]\w*))\s*:/g, m; while ((m = r.exec(txt))) o.push(m[1] || m[2] || m[3]); return o; }

// ---- load every registry from the real files ----
function load() {
  var P = require(path.join(PARSER, 'parser.js')), RC = require(path.join(APP, 'www', 'runner_core.js')), SM = require(path.join(APP, 'src', 'storemap.js'));
  var view = rd(path.join(APP, 'www', 'view.js')), fr = rd(path.join(APP, 'www', 'fetchread.js')), sc = rd(path.join(EXT, 'stock_core.js')), app = rd(path.join(APP, 'src', 'app.js'));
  var names = (new Function('return {' + listIn(view, /var NAMES = \{([^}]*)\}/, 'NAMES') + '}'))();
  var man = JSON.parse(rd(path.join(EXT, 'manifest.json'))), hp = [];
  (function walk(x) { if (typeof x === 'string') { if (/^https:\/\/\*\./.test(x)) hp.push(x); } else if (x && typeof x === 'object') Object.keys(x).forEach(function (k) { walk(x[k]); }); })(man);
  var pm = /var PAUSED = \{([^}]*)\}/.exec(app);
  return {
    canon: P.STORES, status: P.STORE_STATUS || null,
    runner: RC.STORES.map(function (s) { return { key: s.key, label: s.label, url: s.url }; }),
    names: names, sells: SM.SELLS, catWord: SM.CAT_WORD,
    fetchOk: strs(listIn(fr, /var STORES_OK = \[([^\]]*)\]/, 'STORES_OK in fetchread.js')),
    tested: strs(listIn(sc, /var TESTED = \[([^\]]*)\]/, 'TESTED in stock_core.js')), partial: strs(listIn(sc, /PARTIAL = \[([^\]]*)\]/, 'PARTIAL in stock_core.js')),
    manifest: hp, paused: pm ? keysOf(pm[1]) : [], bundle: rd(path.join(APP, 'www', 'bundle.js')),
    same: { runner: same(path.join(APP, 'www', 'runner_core.js'), path.join(EXT, 'runner_core.js')), view: same(path.join(APP, 'www', 'view.js'), path.join(EXT, 'view.js')),
      fetchread: same(path.join(APP, 'www', 'fetchread.js'), path.join(EXT, 'fetchread.js')), bundle: same(path.join(APP, 'www', 'bundle.js'), path.join(EXT, 'bundle.js')) },
    doc: fs.existsSync(DOC) ? rd(DOC) : null
  };
}

// ---- the checker: returns a list of problems, [] = every store is complete everywhere ----
function check(R) {
  var bad = [], keys = Object.keys(R.canon), rk = R.runner.map(function (s) { return s.key; }), labels = R.runner.map(function (s) { return s.label; });
  function extra(list, where) { list.forEach(function (k) { if (keys.indexOf(k) < 0) bad.push(where + ': store "' + k + '" is not in parser.js STORES'); }); }
  rk.forEach(function (k, i) { if (rk.indexOf(k) !== i) bad.push('runner_core.js: store "' + k + '" is listed twice'); });
  keys.forEach(function (k) {
    var c = R.canon[k], r = R.runner[rk.indexOf(k)];
    if (!c.name || !Array.isArray(c.hosts) || !c.hosts.length) bad.push('parser.js: store "' + k + '" needs name and hosts');
    if (!(c.linkRe instanceof RegExp)) bad.push('parser.js: store "' + k + '" needs linkRe (a RegExp)');
    if (!r) bad.push('runner_core.js (app-spike/www and extension): store "' + k + '" is missing in STORES');
    else {
      if (r.label !== c.name) bad.push('runner_core.js: label of "' + k + '" is "' + r.label + '" but parser.js name is "' + c.name + '"');
      var u = ''; try { u = String(r.url('zzprobe shoes')); } catch (e) { u = ''; }
      var host = ''; try { host = new URL(u).hostname.replace(/^www\./, ''); } catch (e) { host = ''; }
      if (!/^https:\/\//.test(u) || !/zzprobe/.test(u)) bad.push('runner_core.js: url() of "' + k + '" is not an https address that contains the query');
      else if (!(c.hosts || []).some(function (h) { return host === h || host.slice(-h.length - 1) === '.' + h; })) bad.push('runner_core.js: url() host "' + host + '" of "' + k + '" is not in parser.js hosts');
    }
    if (R.names[k] === undefined) bad.push('view.js: store "' + k + '" is missing in NAMES (app-spike/www and extension)');
    else if (R.names[k] !== c.name) bad.push('view.js: NAMES of "' + k + '" is "' + R.names[k] + '" but parser.js name is "' + c.name + '"');
    var s = R.sells[k];
    if (!Array.isArray(s) || !s.length) bad.push('storemap.js: store "' + k + '" is missing in SELLS (or empty)');
    else s.forEach(function (cat) { if (R.catWord[cat] === undefined) bad.push('storemap.js: SELLS of "' + k + '" has unknown category "' + cat + '"'); });
    var inT = R.tested.indexOf(k) >= 0, inP = R.partial.indexOf(k) >= 0;
    if (!inT && !inP) bad.push('stock_core.js: store "' + k + '" is in neither TESTED nor PARTIAL');
    if (inT && inP) bad.push('stock_core.js: store "' + k + '" is in both TESTED and PARTIAL');
    (c.hosts || []).forEach(function (h) {
      if (R.manifest.indexOf('https://*.' + h + '/*') < 0) bad.push('manifest.json: host permission https://*.' + h + '/* is missing for "' + k + '"');
      if (R.bundle.indexOf("'" + h + "'") < 0) bad.push('bundle.js: host "' + h + '" of "' + k + '" is not inside the bundle (rebuild the bundle: extension/build_bundle.js)');
    });
  });
  extra(rk, 'runner_core.js'); extra(Object.keys(R.names), 'view.js NAMES'); extra(Object.keys(R.sells), 'storemap.js SELLS');
  extra(R.tested, 'stock_core.js TESTED'); extra(R.partial, 'stock_core.js PARTIAL'); extra(R.fetchOk, 'fetchread.js STORES_OK');
  if (R.status) { Object.keys(R.status).forEach(function (k) { if (keys.indexOf(k) < 0) bad.push('parser.js STORE_STATUS: store "' + k + '" is not in STORES'); }); keys.forEach(function (k) { if (!R.status[k]) bad.push('parser.js: store "' + k + '" is missing in STORE_STATUS'); }); }
  R.paused.forEach(function (l) { if (labels.indexOf(l) < 0) bad.push('app.js PAUSED: "' + l + '" is not a store label'); });
  if (!R.same.runner) bad.push('runner_core.js differs between app-spike/www and extension (copy the file)');
  if (!R.same.view) bad.push('view.js differs between app-spike/www and extension (copy the file)');
  if (!R.same.fetchread) bad.push('fetchread.js differs between app-spike/www and extension (copy the file)');
  if (!R.same.bundle) bad.push('bundle.js differs between app-spike/www and extension (copy the file)');
  if (R.doc === null) bad.push('09_STORE_ONBOARDING.md is missing');
  else REG_FILES.forEach(function (f) { if (R.doc.indexOf(f) < 0) bad.push('09_STORE_ONBOARDING.md does not mention ' + f); });
  return bad;
}

// ---- helpers for the deliberate-breakage cases ----
function cp(R) {
  return { canon: Object.assign({}, R.canon), status: R.status ? Object.assign({}, R.status) : null, runner: R.runner.slice(), names: Object.assign({}, R.names), sells: Object.assign({}, R.sells), catWord: R.catWord,
    fetchOk: R.fetchOk.slice(), tested: R.tested.slice(), partial: R.partial.slice(), manifest: R.manifest.slice(), paused: R.paused.slice(), bundle: R.bundle, same: Object.assign({}, R.same), doc: R.doc };
}
function addFull(R, skip) {
  var x = cp(R);
  x.canon.newshop = { name: 'New Shop', hosts: ['newshop.in'], linkRe: /\/p\/(\d+)/ };
  if (x.status) x.status.newshop = { search: 'tested' };
  if (skip !== 'runner') x.runner.push({ key: 'newshop', label: 'New Shop', url: function (q) { return 'https://www.newshop.in/search?q=' + encodeURIComponent(q); } });
  if (skip !== 'names') x.names.newshop = 'New Shop';
  if (skip !== 'sells') x.sells.newshop = ['gadget'];
  if (skip !== 'stock') x.partial.push('newshop');
  if (skip !== 'manifest') x.manifest.push('https://*.newshop.in/*');
  if (skip !== 'bundle') x.bundle += " hosts: ['newshop.in']";
  return x;
}
function has(list, s) { return list.some(function (p) { return p.indexOf(s) >= 0; }); }

if (require.main === module) {
  var pass = 0, fail = 0;
  var ck = function (n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + (d === undefined ? '' : ' ' + JSON.stringify(d))); } };
  var R = load(), real = check(R), keys = Object.keys(R.canon);
  if (process.argv.indexOf('--list') >= 0) {
    console.log('store            parser runner view  sells stock manifest bundle');
    keys.forEach(function (k) { var c = R.canon[k], rk = R.runner.some(function (s) { return s.key === k; }); function t(b) { return b ? 'yes   ' : 'NO    '; }
      console.log((k + '                ').slice(0, 16) + ' yes    ' + t(rk) + t(R.names[k] !== undefined) + t(!!R.sells[k]) + t(R.tested.indexOf(k) >= 0 || R.partial.indexOf(k) >= 0) + '  ' + t(c.hosts.every(function (h) { return R.manifest.indexOf('https://*.' + h + '/*') >= 0; })) + ' ' + t(c.hosts.every(function (h) { return R.bundle.indexOf("'" + h + "'") >= 0; }))); });
    console.log(real.length ? real.join('\n') : 'ALL STORES COMPLETE IN EVERY PLACE');
    process.exit(real.length ? 1 : 0);
  }
  // A. the real files
  ck('1 real files: no gaps', real.length === 0, real);
  ck('2 nine stores in parser.js', keys.length === 9 && keys.join() === 'amazon,ajio,tatacliq,croma,flipkart,myntra,nykaa,meesho,reliancedigital', keys);
  ck('3 runner_core has the same nine keys', R.runner.map(function (s) { return s.key; }).sort().join() === keys.slice().sort().join(), 0);
  ck('4 view NAMES, storemap SELLS, stock_core cover the same nine keys', [Object.keys(R.names), Object.keys(R.sells), R.tested.concat(R.partial)].every(function (l) { return l.slice().sort().join() === keys.slice().sort().join(); }), 0);
  ck('5 fetchread STORES_OK is a subset', R.fetchOk.length > 0 && R.fetchOk.every(function (k) { return keys.indexOf(k) >= 0; }), R.fetchOk);
  ck('6 four shared files are byte-identical in app-spike/www and extension', R.same.runner && R.same.view && R.same.fetchread && R.same.bundle, R.same);
  ck('7 PAUSED keys (if any) are store labels', R.paused.every(function (l) { return R.runner.some(function (s) { return s.label === l; }); }), R.paused);
  ck('8 the checklist file exists and names all 12 registry files', R.doc !== null && REG_FILES.every(function (f) { return R.doc.indexOf(f) >= 0; }), 0);
  ck('9 every runner url() puts the query in an https address on a parser host', R.runner.every(function (s) { var u = s.url('red shoes'); return /^https:\/\//.test(u) && /red(%20|\+|-)shoes/.test(u); }), 0);
  // B. a complete new store passes; missing one place is reported with the place
  ck('10 a complete new store in all places = no gaps', check(addFull(R)).length === 0, check(addFull(R)));
  var cases = [['runner', 'runner_core.js'], ['names', 'view.js'], ['sells', 'storemap.js'], ['stock', 'stock_core.js'], ['manifest', 'manifest.json'], ['bundle', 'bundle.js']];
  cases.forEach(function (c, i) { var p = check(addFull(R, c[0])); ck((11 + i) + ' new store missing only in ' + c[1] + ': reported, and only there', p.length >= 1 && p.every(function (s) { return s.indexOf(c[1]) >= 0; }) && has(p, 'newshop'), p); });
  // C. other deliberate breakages
  var b;
  b = cp(R); b.runner = b.runner.slice(1); ck('17 amazon removed from runner_core: reported', has(check(b), 'store "amazon" is missing'), check(b));
  b = cp(R); b.runner[1] = { key: 'flipkart', label: 'Flipkart Mall', url: b.runner[1].url }; ck('18 wrong label: reported', has(check(b), 'label of "flipkart"'), check(b));
  b = cp(R); b.runner[2] = { key: 'myntra', label: 'Myntra', url: function (q) { return 'https://www.example.com/' + q; } }; ck('19 url on a foreign host: reported', has(check(b), 'is not in parser.js hosts'), check(b));
  b = cp(R); b.runner[2] = { key: 'myntra', label: 'Myntra', url: function (q) { return 'https://www.myntra.com/shoes'; } }; ck('20 url without the query: reported', has(check(b), 'does not contain') || has(check(b), 'contains the query'), check(b));
  b = cp(R); b.runner[2] = { key: 'myntra', label: 'Myntra', url: function (q) { return 'http://www.myntra.com/' + q; } }; ck('21 http (not https) url: reported', has(check(b), 'https address'), check(b));
  b = cp(R); b.tested = b.tested.concat(['amazon']); ck('22 store in both TESTED and PARTIAL: reported', has(check(b), 'in both TESTED and PARTIAL'), check(b));
  b = cp(R); b.sells.croma = []; ck('23 empty SELLS: reported', has(check(b), 'SELLS (or empty)'), check(b));
  b = cp(R); b.sells.croma = ['mobile', 'cars']; ck('24 unknown category in SELLS: reported', has(check(b), 'unknown category "cars"'), check(b));
  b = cp(R); b.manifest = b.manifest.filter(function (m) { return m.indexOf('croma') < 0; }); ck('25 croma host permission removed: reported', has(check(b), 'https://*.croma.com/*'), check(b));
  b = cp(R); b.names.ajio = 'AJIO'; ck('26 wrong NAMES text: reported', has(check(b), 'NAMES of "ajio"'), check(b));
  b = cp(R); b.paused = ['Nothing Mart']; ck('27 PAUSED label that is no store: reported', has(check(b), 'PAUSED'), check(b));
  b = cp(R); b.same.bundle = false; ck('28 bundles differ: reported', has(check(b), 'bundle.js differs'), check(b));
  b = cp(R); b.fetchOk = ['amazon', 'ghost']; ck('29 fetchread lists an unknown store: reported', has(check(b), 'STORES_OK'), check(b));
  b = cp(R); b.doc = 'short'; ck('30 checklist file without the registry list: reported', has(check(b), '09_STORE_ONBOARDING.md does not mention'), check(b));
  b = cp(R); b.doc = null; ck('31 checklist file missing: reported', has(check(b), '09_STORE_ONBOARDING.md is missing'), check(b));
  b = cp(R); b.runner = b.runner.concat([b.runner[0]]); ck('32 same store twice in runner_core: reported', has(check(b), 'listed twice'), check(b));
  b = cp(R); b.runner = b.runner.concat([{ key: 'ghost', label: 'Ghost', url: function (q) { return 'https://ghost.in/' + q; } }]); ck('33 runner_core store unknown to the parser: reported', has(check(b), 'store "ghost" is not in parser.js STORES'), check(b));
  b = cp(R); b.canon.croma = { name: 'Croma', hosts: ['croma.com'] }; ck('34 parser record without linkRe: reported', has(check(b), 'needs linkRe'), check(b));
  if (R.status) { b = cp(R); delete b.status.myntra; ck('35 STORE_STATUS missing a store: reported', has(check(b), 'STORE_STATUS'), check(b)); }
  // D. the checker did not change the real data
  ck('36 the real data is unchanged by the cases above', check(R).length === 0 && R.runner.length === 9 && Object.keys(R.canon).length === 9, 0);
  console.log('test_s23_10i: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
module.exports = { load: load, check: check, REG_FILES: REG_FILES };
