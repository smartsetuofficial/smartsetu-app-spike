/* S23-24 + S23-23 offline test (D-166). Run: node test_s23_24.js (from code/app-spike).
 * (1) the page's base font size is the same on every phone: fitguard.js cancels the system font size (--rootfs); (2) the privacy note is made smaller before it is hidden, the gaps under it are tight; (3) Myntra, Croma and the retry reads never hold the search longer than HI_CAP_MS. The real look is checked on the two phones (screenshots). */
'use strict';
var fs = require('fs'), path = require('path');
var pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d)); } }
var css = fs.readFileSync(path.join(__dirname, 'www', 'app.css'), 'utf8');
var fg = fs.readFileSync(path.join(__dirname, 'www', 'fitguard.js'), 'utf8');
var app = fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8');
// ---- CSS
ck('root font size can be overridden by --rootfs, same clamp as before', css.split('\n')[0].indexOf('html{font-size:var(--rootfs,clamp(13.5px,4.0712vw,17.5px));') === 0, css.split('\n')[0]);
ck('hfpsm makes the note smaller', /html\.hfpsm \.privacy\{[^}]*font-size:0\.625rem/.test(css));
ck('note is smaller on the idle home', /html\.navres \.privacy\{[^}]*font-size:0\.6875rem/.test(css));
ck('gaps under the note are tight', /html\.navres \.hero\{padding-bottom/.test(css) && /html\.navres \.foot\{padding-top:calc\(0\.2rem/.test(css) && /html\.navres \.slogan\{margin-top:calc\(0\.5rem/.test(css));
// ---- ladder: the note is made smaller BEFORE it is hidden
var i1 = fg.indexOf("['hfit', 'hfrow', 'hfpsm'], 0.6]"), i2 = fg.indexOf("['hfit', 'hfrow', 'hfpsm', 'hfpriv'], 0.6]");
ck('ladder: hfpsm step comes before the hfpriv step', i1 > 0 && i2 > i1, [i1, i2]);
ck('HF_CLS has hfpsm', /var HF_CLS = \['hfit', 'hfrow', 'hfpsm', 'hfpriv', 'hftry', 'hflead'\]/.test(fg));
ck('fit() calls normFont first', /function fit\(\) \{\n    try \{ normFont\(\); \}/.test(fg));
ck('diag prints rfs and pgap', /rfs: root\.style\.getPropertyValue\('--rootfs'\)/.test(fg) && /pgap:/.test(fg));
// ---- normFont, run on a fake page: computed size = (--rootfs or clamp base) * system zoom
var m = fg.match(/function normFont\(\) \{[\s\S]*?\n  \}\n/);
ck('normFont found', !!m);
function run(vw, zoom, screenW) {
  var props = {};
  var root = { clientWidth: vw, style: { setProperty: function (k, v) { props[k] = v; }, removeProperty: function (k) { delete props[k]; }, getPropertyValue: function (k) { return props[k] || ''; } } };
  var win = { innerWidth: vw, screen: { width: screenW || vw } };
  var gcs = function () { var base = Math.min(17.5, Math.max(13.5, vw * 0.040712)); var b = props['--rootfs'] ? parseFloat(props['--rootfs']) : base; return { fontSize: (b * zoom) + 'px' }; };
  var f = new Function('root', 'window', 'getComputedStyle', m[0] + '; return normFont;')(root, win, gcs);
  f();
  return { props: props, size: parseFloat(gcs().fontSize), base: Math.min(17.5, Math.max(13.5, vw * 0.040712)) };
}
[320, 360, 393, 412, 433, 480].forEach(function (vw) {
  [1, 1.15, 1.3, 1.5].forEach(function (z) {
    var r = run(vw, z);
    ck('size back to base at width ' + vw + ' zoom ' + z, Math.abs(r.size - r.base) < r.base * 0.01, r);
    ck('no override at zoom 1 (width ' + vw + ')', z !== 1 || !r.props['--rootfs'], r);
  });
});
var wide = run(360, 1.3, 360); ck('layout viewport that grew wider does not spoil the base (uses screen.width)', Math.abs(wide.size - wide.base) < wide.base * 0.01, wide);
var odd = run(360, 3.2); ck('absurd zoom is left alone', !odd.props['--rootfs'], odd);
// ---- S23-23: the hard limit on one read
var cm = app.match(/var HI_CAP_MS = 45000;\n    function capRead\([\s\S]*?\n/);
ck('HI_CAP_MS is 45000 and capRead exists', !!cm);
ck('all four slow reads go through capRead', (app.match(/await capRead\(/g) || []).length === 4, (app.match(/await capRead\(/g) || []).length);
ck('no uncapped Myntra or Croma read is left', !/await W\.(rescueRead|pinRead|slowRead)\(/.test(app));
function capTest() {
  var src = cm[0].replace('var HI_CAP_MS = 45000;', 'var HI_CAP_MS = 30;');
  var capRead = new Function('Promise', 'setTimeout', 'clearTimeout', src + '; return capRead;')(Promise, setTimeout, clearTimeout);
  var st = { label: 'Myntra', key: 'myntra' };
  var never = new Promise(function () {});
  var fast = new Promise(function (r) { setTimeout(function () { r({ state: 'ok', store: 'Myntra' }); }, 5); });
  var boom = new Promise(function (_, rej) { setTimeout(function () { rej(new Error('x')); }, 5); });
  var t0 = Date.now();
  return Promise.all([capRead(st, never), capRead(st, fast), capRead(st, boom).then(function () { return 'noerr'; }, function (e) { return 'err:' + e.message; })]).then(function (a) {
    ck('a read that never ends becomes a timeout, stage reading', a[0].state === 'timeout' && a[0].stage === 'reading' && a[0].key === 'myntra' && a[0].capped === true && a[0].store === 'Myntra', a[0]);
    ck('it returns after about the limit, not never', Date.now() - t0 < 1500, Date.now() - t0);
    ck('a read that ends in time is returned unchanged', a[1].state === 'ok', a[1]);
    ck('an error of the read is still thrown', a[2] === 'err:x', a[2]);
  });
}
// ---- version
ck('app version 0.10.31', /VERSION = '0\.10\.31'/.test(app) && JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version === '0.10.31', 0);
capTest().then(function () {
  console.log('test_s23_24: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
