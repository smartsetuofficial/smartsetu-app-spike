// test_s23_12: one-screen home (S23-12, D-157). Plain node, no packages. Mock page: the page height depends on the classes and --hf that fitguard.js sets.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } }
const www = path.join(__dirname, 'www');
const css = fs.readFileSync(path.join(www, 'app.css'), 'utf8');
const js = fs.readFileSync(path.join(www, 'fitguard.js'), 'utf8');
const n = (s, a) => s.split(a).length - 1;
ok(!/localStorage|sessionStorage|fetch\(|XMLHttpRequest|console\./.test(js), 'fitguard.js has no storage, network or console');
ok(n(css, 'S23-12 (D-157)') === 1, 'css block present once');
ok(css.indexOf('S23-12 (D-157)') > css.indexOf('S23-F-3 (D-138)'), 'css block comes after the S23-F-3 block');
['html.hfit .perks li{', 'html.hfrow .perks li{', 'html.hfpriv .privacy{display:none}', 'html.hflead .hero .lead{display:none}'].forEach(s => ok(n(css, s) === 1, 'css rule once: ' + s));
ok(n(js, 'try { fitHeight(); } catch') === 2, 'fitHeight is only called inside try (fit and the timer)');
ok(/idleHome/.test(js) && /vw > vh/.test(js) && /tagName === 'INPUT'/.test(js), 'idle, landscape and keyboard guards exist');
function run(o) {
  const cls = new Set(), vars = {};
  const lines = [{ scrollWidth: 200, clientWidth: 200 }];
  const h1 = { querySelectorAll: () => lines };
  const win = { innerHeight: o.vh, innerWidth: o.vw || 360, handlers: {}, addEventListener(e, f) { this.handlers[e] = f; } };
  const root = {
    classList: { add: c => cls.add(c), remove: c => cls.delete(c) },
    style: { setProperty: (k, v) => { vars[k] = v; }, removeProperty: k => { delete vars[k]; } },
    get scrollHeight() {
      const hf = vars['--hf'] === undefined ? 1 : parseFloat(vars['--hf']);
      let h = 1000;
      if (cls.has('hfit')) h -= 300 * (1 - hf);
      if (cls.has('hfrow')) h -= 150;
      if (cls.has('hfpriv')) h -= 60;
      if (cls.has('hflead')) h -= 50;
      return Math.max(h, win.innerHeight);
    }
  };
  const nodes = { progress: { hidden: true }, results: { firstChild: o.results ? {} : null }, empty: { hidden: true }, morebox: { hidden: true }, cardspanel: { hidden: true } };
  const doc = { documentElement: root, activeElement: o.focus ? { tagName: 'INPUT' } : null, getElementById: id => nodes[id] || null, querySelector: () => h1, fonts: { ready: { then: f => f() } } };
  vm.runInNewContext(js, { document: doc, window: win, setTimeout: f => 0, clearTimeout: () => 0 });
  return { cls, vars, win, root };
}
let r = run({ vh: 1100 });
ok(r.cls.size === 0 && r.vars['--hf'] === undefined, 'screen already tall enough: nothing changes');
r = run({ vh: 900 });
ok(r.cls.has('hfit') && r.cls.has('hfrow') && !r.cls.has('hfpriv') && r.vars['--hf'] === '1', 'needs compact card only: hfit + hfrow at full ratio, privacy and lead kept');
r = run({ vh: 700 });
ok(r.cls.has('hfpriv') && !r.cls.has('hflead') && r.vars['--hf'] === '0.68', 'very short: privacy note hidden, lead kept, largest ratio that fits (0.68)');
ok(r.root.scrollHeight <= 700, 'after the steps the page height is within the screen');
r = run({ vh: 700, vw: 800 });
ok(r.cls.size === 0, 'landscape: no height fit');
r = run({ vh: 700, focus: true });
ok(r.cls.size === 0, 'keyboard (input focused): no height fit');
r = run({ vh: 700, results: true });
ok(r.cls.size === 0, 'results on screen: no height fit');
r = run({ vh: 700 });
r.win.innerHeight = 1100; r.win.handlers.resize();
ok(r.cls.size === 0 && r.vars['--hf'] === undefined, 'screen grows (rotate/unfold): classes and ratio are removed again');
r = run({ vh: 340, vw: 330 });
ok(r.cls.has('hflead') && r.vars['--hf'] === '0.4', 'impossible height: ends at the strongest step, never throws');
console.log('test_s23_12: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
