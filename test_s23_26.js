/* S23-26 offline test (D-170). Run: node test_s23_26.js (from code/app-spike).
 * The WebView text zoom is set to 100 in both workflows (so rem boxes and text scale together on every phone), version 0.10.32, normFont stays as a fallback. */
'use strict';
var fs = require('fs'), path = require('path');
var pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d)); } }
var wf = ['apk.yml', 'release-apk.yml'];
wf.forEach(function (f) {
  var s = fs.readFileSync(path.join(__dirname, '.github', 'workflows', f), 'utf8');
  var iAdd = s.indexOf('- name: Add Android project'), iStep = s.indexOf('- name: Keep WebView text at 100 percent (S23-26, D-170)'), iIcon = s.indexOf('- name: Apply SmartSetu icon and splash');
  ck(f + ' step exists once', iStep > 0 && s.split('Keep WebView text at 100 percent').length === 2, iStep);
  ck(f + ' step sits after Add Android project and before the icon step', iAdd > 0 && iAdd < iStep && iStep < iIcon, [iAdd, iStep, iIcon]);
  ck(f + ' sets text zoom 100 through the bridge web view', /getBridge\(\)\.getWebView\(\)\.getSettings\(\)/.test(s) && /setTextZoom\(100\)/.test(s));
  ck(f + ' does it in onCreate and onResume, inside try/catch', /public void onCreate\(Bundle savedInstanceState\)/.test(s) && /public void onResume\(\)/.test(s) && /catch \(Throwable t\)/.test(s));
  ck(f + ' stops loudly: no file, not a BridgeActivity, own onCreate/onResume', /MainActivity\.java not found"; exit 1/.test(s) && /does not extend BridgeActivity, stop"; exit 1/.test(s) && /already has its own onCreate\/onResume, stop/.test(s));
  ck(f + ' keeps the package line of the generated file', /PKG=\$\(grep -m1 '\^package '/.test(s) && /sed -i "s\|\^PKGLINE\$\|\$PKG\|"/.test(s));
  ck(f + ' checks the result with grep', /grep -q 'setTextZoom\(100\)' "\$F"/.test(s) || /grep -q 'setTextZoom\(100\)'/.test(s));
});
var app = fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8');
var pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
ck('app version 0.10.32', /VERSION = '0\.10\.32'/.test(app) && pkg.version === '0.10.32', pkg.version);
var lock = JSON.parse(fs.readFileSync(path.join(__dirname, 'package-lock.json'), 'utf8'));
ck('lock version 0.10.32 in both places', lock.version === '0.10.32' && lock.packages[''].version === '0.10.32');
var fg = fs.readFileSync(path.join(__dirname, 'www', 'fitguard.js'), 'utf8');
ck('normFont stays as a fallback and does nothing at zoom 1 (|z-1| < 0.02)', /function normFont\(\)/.test(fg) && /Math\.abs\(z - 1\) < 0\.02/.test(fg));
var css = fs.readFileSync(path.join(__dirname, 'www', 'app.css'), 'utf8');
ck('root size rule unchanged', css.split('\n')[0].indexOf('html{font-size:var(--rootfs,clamp(13.5px,4.0712vw,17.5px));') === 0);
console.log('S23-26: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
