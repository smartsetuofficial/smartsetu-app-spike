// test_s23f2a: home screen fit guard (S23-F-2a, D-133). Plain node, no packages.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } }
const www = path.join(__dirname, 'www');
const html = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(www, 'app.css'), 'utf8');
const js = fs.readFileSync(path.join(www, 'fitguard.js'), 'utf8');
const n = (s, a) => s.split(a).length - 1;
ok(n(html, '<script src="fitguard.js"></script>') === 1, 'index.html loads fitguard.js once');
ok(html.indexOf('src="fitguard.js"') > html.indexOf('src="app.js"'), 'fitguard.js loads after app.js');
ok(!/localStorage|sessionStorage|fetch\(|XMLHttpRequest|console\./.test(js), 'fitguard.js has no storage, network or console');
ok(n(css, 'S23-F-2a (D-133)') === 1, 'css block present once');
ok(n(css, 'html.fitwrap .hero h1 span{white-space:normal}') === 1, 'css wrap rule present');
ok(css.indexOf('S23-F-2a') > css.indexOf('S22'), 'css block is the last override');
function run(over) {
  const cls = new Set();
  const lines = [{ scrollWidth: 200 + over, clientWidth: 200 }, { scrollWidth: 190, clientWidth: 200 }, { scrollWidth: 200, clientWidth: 200 }];
  const h1 = { querySelectorAll: () => lines };
  const vars = {};
  const root = { classList: { add: c => cls.add(c), remove: c => cls.delete(c) }, style: { setProperty: (k, v) => { vars[k] = v; }, removeProperty: k => { delete vars[k]; } } };
  const ev = {};
  const doc = { documentElement: root, querySelector: () => h1, fonts: { ready: { then: f => f() } } };
  const win = { addEventListener: (e, f) => { ev[e] = f; } };
  vm.runInNewContext(js, { document: doc, window: win });
  return { has: cls.has('fitwrap'), ev, cls, lines, vars };
}
ok(run(0).has === false, 'no overflow: no class');
ok(run(3).has === false, 'overflow 3 px (normal font): no class');
ok(run(8).has === false, 'overflow 8 px: still no class');
ok(run(30).has === true, 'overflow 30 px (big font): class set');
const r = run(30); r.lines[0].scrollWidth = 200; r.ev.resize();
ok(r.cls.has('fitwrap') === false, 'resize with fitting text removes the class');
const none = vm.runInNewContext(js + ';1', { document: { documentElement: {}, querySelector: () => null }, window: { addEventListener() {} } });
ok(none === 1, 'no heading: script exits quietly');
// S23-F-3 (D-138): measured ratio for the display texts
ok(run(30).vars['--fitk'] === '0.84', 'overflow 30 on 200: ratio 0.84 (floor of 200/230 x 0.97)');
ok(run(0).vars['--fitk'] === undefined, 'no overflow: no ratio variable');
ok(run(8).vars['--fitk'] === undefined, 'overflow 8: no ratio variable');
ok(run(2000).vars['--fitk'] === '0.55', 'huge overflow: ratio never below 0.55');
ok(n(css, 'S23-F-3 (D-138)') === 1, 'css block S23-F-3 present once');
ok(n(css, 'html.fitwrap .top .wrap{flex-wrap:nowrap}') === 1, 'header stays in one row at big font');
ok(n(css, 'html.fitwrap .hero h1{font-size:calc(min(8.2vw,2rem)*var(--fitk,1))}') === 1, 'heading size uses the measured ratio');
ok(css.indexOf('S23-F-3 (D-138)') > css.indexOf('S23-F-2a (D-133)'), 'S23-F-3 block comes after S23-F-2a');
console.log('test_s23f2a: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
