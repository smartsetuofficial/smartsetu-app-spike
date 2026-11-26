// test_s23_15: fluid home (S23-15, D-160). Plain node, no packages. Step logic against a height model; the real look was measured in headless Chromium (sandbox only).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } }
const www = path.join(__dirname, 'www');
const css = fs.readFileSync(path.join(www, 'app.css'), 'utf8'), js = fs.readFileSync(path.join(www, 'fitguard.js'), 'utf8'), ds = fs.readFileSync(path.join(__dirname, 'src', 'devsuite.js'), 'utf8');
const n = (s, a) => s.split(a).length - 1;
// static
ok(n(css, 'S23-15 (D-160)') === 1 && css.indexOf('S23-15 (D-160)') > css.indexOf('S23-14 (D-159)'), 'css block S23-15 once, after S23-14');
['html.navres .foot{padding-bottom:calc(var(--sab) + var(--navres,0px) + 1rem)}', '.eyebrow svg{flex:none}', 'html.ol-ld .hero .lead{', 'html.hftry .try,html.hftry .pdots{display:none}', 'html.hfit.hfrow .perks li{min-height:5.6rem}', 'html.hgrow.hfrow .perks .pic{', 'html.hx .hero{', 'html.navres .msg:empty{min-height:0;margin-top:0}'].forEach(s => ok(css.indexOf(s) > 0, 'css has ' + s));
ok(n(css, 'html.hdrfit .mark{width:calc(3.125rem*max(var(--hk,1),0.9));height:calc(3.125rem*max(var(--hk,1),0.9))}') === 1, 'logo picture never below 90 percent in the header fit');
ok(/\['ld', '\.hero \.lead', 0\.65\]/.test(js) && /\['eb', '\.eyebrow', 0\.55\]/.test(js) && /\['cs', '\.cardsrow \.cr-s', 0\.6\]/.test(js), 'one-line list has the lead and the lower minimums');
ok(!/localStorage|sessionStorage|fetch\(|XMLHttpRequest|console\./.test(js), 'fitguard.js has no storage, network or console');
ok(n(js, 'window.smartsetuHomeDiag = function') === 1 && /HOME: ' \+ homeLine\(p\)/.test(ds), 'HOME diagnostics function and report line exist');
// behaviour (model)
function run(o) {
  const cls = new Set(), vars = {}, ev = {};
  const win = { innerHeight: o.vh, innerWidth: o.vw || 360, addEventListener(e, f) { ev[e] = f; } };
  const li = { offsetHeight: 100 }, foot = { getBoundingClientRect: () => ({ bottom: 700 }) };
  const root = {
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) },
    style: { setProperty: (k, v) => { vars[k] = v; }, removeProperty: k => { delete vars[k]; }, getPropertyValue: k => vars[k] || '' },
    get scrollHeight() { let h = o.base - (cls.has('hfit') ? 100 : 0); if (cls.has('hfrow')) h -= 100; if (cls.has('hfpriv')) h -= 60; if (cls.has('hftry')) h -= 30; if (cls.has('hflead')) h -= 40; if (cls.has('hgrow')) h += parseFloat(vars['--hg']) - 100; if (cls.has('hx')) h += 7 * parseFloat(vars['--hx']); if (cls.has('navres')) h += parseFloat(vars['--navres'] || 0); return Math.max(h, win.innerHeight); }
  };
  const h1 = { querySelectorAll: () => [] };
  const nodes = { progress: { hidden: true }, results: { firstChild: o.results ? {} : null }, empty: { hidden: true }, morebox: { hidden: true }, cardspanel: { hidden: true } };
  const doc = { documentElement: root, activeElement: null, getElementById: id => nodes[id] || null, fonts: { ready: { then: f => f() } }, body: { appendChild() {}, removeChild() {} }, createElement: () => ({ style: {} }), querySelector: s => s === '.hero h1' ? h1 : s === '.foot' ? foot : s === '.perks li' ? li : null };
  vm.runInNewContext(js, { document: doc, window: win, getComputedStyle: () => ({ paddingBottom: (o.sab || 0) + 'px', fontSize: '16px' }), setTimeout: f => 0, clearTimeout: () => 0 });
  return { cls, vars, win, ev, root };
}
let r = run({ vh: 900, base: 800, sab: 0 });
ok(r.vars['--navres'] === '52px' && r.cls.has('navres'), 'no safe area reported: 52 px room under the slogan for the system bar');
r = run({ vh: 900, base: 800, sab: 48 });
ok(r.vars['--navres'] === '4px', 'safe area 48 reported: only the missing 4 px are added');
r = run({ vh: 900, base: 800, sab: 80 });
ok(r.vars['--navres'] === '0px', 'safe area larger than 52: nothing added');
r = run({ vh: 900, base: 800, sab: 0 });
ok(r.cls.has('hgrow') && r.cls.has('idlehome'), 'room left over: the Why card grows, slogan pinned');
r = run({ vh: 680, base: 900, sab: 0 });
ok(r.cls.has('hfit') && r.cls.has('hfrow') && r.cls.has('hfpriv') && r.cls.has('hftry') && !r.cls.has('hflead') && r.root.scrollHeight <= 680, 'short: steps up to hide the Why heading and dots, lead kept, page fits');
r = run({ vh: 520, base: 1000, sab: 0 });
ok(r.cls.has('hflead'), 'very short: lead hidden as the last step');
// no stale classes: a second measurement on a tall window starts clean
r = run({ vh: 650, base: 1000, sab: 0 });
r.win.innerHeight = 1200; r.ev.resize();
ok(!['hfit', 'hfrow', 'hfpriv', 'hftry', 'hflead'].some(c => r.cls.has(c)) && r.vars['--hf'] === undefined, 'resize to a tall window: no step class and no ratio left over');
r.win.innerHeight = 650; r.ev.resize();
ok(r.cls.has('hfit') && r.cls.has('hfrow'), 'resize back: steps again');
r = run({ vh: 650, base: 1000, sab: 0, results: true });
ok(!r.cls.has('navres') && !r.cls.has('hfit'), 'results on screen: nothing applied');
const hd = (function () { const w = {}; vm.runInNewContext(js, { document: { documentElement: { classList: { add() {}, remove() {}, contains: () => false }, style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }, clientHeight: 800, scrollHeight: 800 }, querySelector: () => null, getElementById: () => null, createElement: () => ({ style: {} }), body: { appendChild() {}, removeChild() {} }, fonts: { ready: { then() {} } } }, window: Object.assign(w, { innerHeight: 800, innerWidth: 360, devicePixelRatio: 2, addEventListener() {} }), getComputedStyle: () => ({ fontSize: '15px', paddingBottom: '0px' }), setTimeout() { return 0; }, clearTimeout() {} }); return typeof w.smartsetuHomeDiag === 'function' ? w.smartsetuHomeDiag() : null; })();
ok(hd === null || (hd.ih === 800 && hd.iw === 360 && hd.dpr === 2), 'HOME diagnostics returns the window numbers (or fitguard exits early without a heading)');
console.log('test_s23_15: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
