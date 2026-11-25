// test_s23_14: one-line texts and bottom-pinned slogan on the idle home (S23-14, D-159). Plain node, no packages. Mock page, the real layout was measured in headless Chromium (V-601).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } }
const www = path.join(__dirname, 'www');
const css = fs.readFileSync(path.join(www, 'app.css'), 'utf8');
const js = fs.readFileSync(path.join(www, 'fitguard.js'), 'utf8');
const n = (s, a) => s.split(a).length - 1;
ok(!/localStorage|sessionStorage|fetch\(|XMLHttpRequest|console\./.test(js), 'fitguard.js has no storage, network or console');
ok(n(css, 'S23-14 (D-159)') === 1 && css.indexOf('S23-14 (D-159)') > css.indexOf('S23-12 (D-157)'), 'css block once, after the S23-12 block');
['html.ol-eb .eyebrow{', 'html.ol-cs .cardsrow .cr-s{', 'html.ol-sl .slogan{', 'html.idlehome body{', 'html.idlehome .foot{margin-top:auto', 'html.hgrow .perks li{min-height:var(--hg)}', 'html.hfit .perks{padding-bottom:max('].forEach(s => ok(n(css, s) === 1, 'css rule once: ' + s));
ok(/html\.ol-sl \.slogan\{white-space:nowrap/.test(css) && /html\.ol-cs \.cardsrow \.cr-s\{white-space:nowrap/.test(css) && /html\.ol-eb \.eyebrow\{white-space:nowrap/.test(css), 'eyebrow, card hint and slogan are one line in the css');
ok(n(js, 'try { fitOneLine(); } catch') === 1 && n(js, 'try { fitGrow(); } catch') === 1 && n(js, 'try { fitHeight(); } catch') === 2, 'new steps run only inside try');
function run(o) {
  const cls = new Set(), vars = {};
  const win = { innerHeight: o.vh || 900, innerWidth: o.vw || 360, handlers: {}, addEventListener(e, f) { this.handlers[e] = f; } };
  const mk = key => {
    const w = o.need[key];
    return w === undefined ? null : { get scrollWidth() { const k = cls.has('ol-' + key) ? parseFloat(vars['--o-' + key] === undefined ? 1 : vars['--o-' + key]) : 0; return k ? w * k : o.avail; }, clientWidth: o.avail };
  };
  const els = { '.eyebrow': mk('eb'), '.cardsrow .cr-s': mk('cs'), '.slogan': mk('sl') };
  const h1 = { querySelectorAll: () => [{ scrollWidth: 200, clientWidth: 200 }] };
  const foot = { getBoundingClientRect: () => ({ bottom: o.footBottom === undefined ? 700 : o.footBottom }) };
  const li = { offsetHeight: 100 };
  const root = {
    classList: { add: c => cls.add(c), remove: c => cls.delete(c) },
    style: { setProperty: (k, v) => { vars[k] = v; }, removeProperty: k => { delete vars[k]; } },
    get scrollHeight() { return Math.max(win.innerHeight, (o.footBottom === undefined ? 700 : o.footBottom) + (cls.has('hgrow') ? (o.growExtra === undefined ? parseFloat(vars['--hg']) - 100 : o.growExtra) : 0)); }
  };
  const nodes = { progress: { hidden: true }, results: { firstChild: o.results ? {} : null }, empty: { hidden: true }, morebox: { hidden: true }, cardspanel: { hidden: true } };
  const doc = { documentElement: root, activeElement: o.focus ? { tagName: 'INPUT' } : null, getElementById: id => nodes[id] || null, fonts: { ready: { then: f => f() } },
    querySelector: s => s === '.hero h1' ? h1 : s === '.foot' ? foot : s === '.perks li' ? li : (els[s] || null) };
  vm.runInNewContext(js, { document: doc, window: win, setTimeout: f => 0, clearTimeout: () => 0 });
  return { cls, vars, win, root };
}
let r = run({ need: { eb: 300, cs: 300, sl: 300 }, avail: 250 });
['eb', 'cs', 'sl'].forEach(k => { const v = parseFloat(r.vars['--o-' + k]); ok(r.cls.has('ol-' + k) && v >= 0.8 && v <= 0.85, k + ': text wider than its box shrinks until it fits (' + v + ')'); });
r = run({ need: { eb: 200, cs: 200, sl: 200 }, avail: 250 });
ok(r.cls.has('ol-eb') && r.vars['--o-eb'] === '1', 'text that already fits keeps ratio 1');
r = run({ need: { eb: 600, cs: 600, sl: 600 }, avail: 250 });
ok(!r.cls.has('ol-eb') && !r.cls.has('ol-cs') && !r.cls.has('ol-sl') && r.vars['--o-eb'] === undefined, 'text that cannot fit even at the minimum wraps as before, no half state');
r = run({ need: {}, avail: 250 });
ok(!r.cls.has('ol-eb') && !r.cls.has('ol-sl'), 'missing element: nothing is added');
r = run({ need: {}, avail: 250, footBottom: 800, vh: 900 });
ok(r.cls.has('idlehome') && r.cls.has('hgrow') && r.vars['--hg'] === '155px', 'spare 100: slogan pinned and the card grows by 55 (to 155px)');
r = run({ need: {}, avail: 250, footBottom: 890, vh: 900 });
ok(r.cls.has('idlehome') && !r.cls.has('hgrow'), 'spare only 10: slogan pinned, card unchanged');
r = run({ need: {}, avail: 250, footBottom: 400, vh: 900 });
ok(r.vars['--hg'] === '172px', 'card growth is capped at 72');
r = run({ need: {}, avail: 250, footBottom: 700, vh: 900, growExtra: 300 });
ok(r.cls.has('idlehome') && !r.cls.has('hgrow') && r.vars['--hg'] === undefined, 'if the grown page would be taller than the screen the growth is undone');
r = run({ need: {}, avail: 250, vh: 900, results: true });
ok(!r.cls.has('idlehome') && !r.cls.has('hgrow'), 'results on screen: no pinning');
r = run({ need: {}, avail: 250, vh: 600, vw: 900 });
ok(!r.cls.has('idlehome'), 'landscape: no pinning');
r = run({ need: {}, avail: 250, vh: 900, focus: true });
ok(!r.cls.has('idlehome'), 'keyboard (input focused): no pinning');
r = run({ need: {}, avail: 250, footBottom: 700, vh: 900 });
r.win.innerHeight = 700; r.win.handlers.resize();
ok(!r.cls.has('hgrow') && r.vars['--hg'] === undefined, 'screen gets shorter: growth is removed again');
console.log('test_s23_14: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
