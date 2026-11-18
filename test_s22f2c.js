/* app-spike / test_s22f2c v0.1.0 (S22f-2 part 2c). Run: node test_s22f2c.js
 * Checks the release workflow text: the meaning model + ort files are bundled into www BEFORE cap sync, from the pinned commit, with the sha256 pins (V-448), and never committed. The real build runs on GitHub. */
'use strict';
var fs = require('fs'), path = require('path'), pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d)); } }
var rd = function (p) { return fs.readFileSync(path.join(__dirname, p), 'utf8'); };
var ry = rd('.github/workflows/release-apk.yml'), sm = rd('.github/workflows/smoke-semantic.yml'), gi = rd('.gitignore'), ortg = require('./src/ortglue.js');
var PIN = '018218219718cc217663562b0a65b5ffd1339d47';
var SUMS = ['66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc', 'b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441', '3f5961b9ac86288cccdb97f32fb848d6187c78e1603958c53f3ea1f296b7d8a2'];
var iB = ry.indexOf('name: Bundle the meaning model'), iC = ry.indexOf('name: Add Android project'), iS = ry.indexOf('cap sync android'), iT = ry.indexOf('npm run build');
ck('1 bundle step exists, after build and before Add Android project / cap sync', iB > 0 && iB > iT && iB < iC && iC < iS, [iT, iB, iC, iS]);
ck('2 model files come from the pinned commit only', ry.indexOf(PIN) > 0 && !/resolve\/main/.test(ry) && ry.split('curl -fL').length - 1 === 3, null);
ck('3 all three sha256 pins are in the release workflow and equal the smoke workflow', SUMS.every(function (s) { return ry.indexOf(s) > 0 && sm.indexOf(s) > 0; }), null);
ck('4 sha256sum -c runs after the downloads (set -e: a mismatch stops the build)', /set -e/.test(ry.slice(iB, iC)) && ry.indexOf('sha256sum -c', iB) > ry.indexOf('curl -fL', iB) && ry.indexOf('sha256sum -c', iB) < iC, null);
ck('5 the three ort files named in ortglue.PATHS are the ones copied, into www/ort', ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'].every(function (f) { return ry.slice(iB, iC).indexOf(f) > 0; }) && ortg.PATHS.ortMjs === 'ort/ort.wasm.min.mjs' && /www\/ort/.test(ry.slice(iB, iC)), ortg.PATHS);
ck('6 model, tokenizer.json, tokenizer_config.json land where ortglue.PATHS reads them (www/models)', ['model_quantized.onnx', 'tokenizer.json', 'tokenizer_config.json'].every(function (f) { return ry.slice(iB, iC).indexOf('www/models/' + f) > 0 && ortg.PATHS.model.concat(ortg.PATHS.tokJson, ortg.PATHS.tokCfg).indexOf('models/' + f) >= 0; }), ortg.PATHS);
ck('7 generated folders stay out of git', /^\/www\/ort\/$/m.test(gi) && /^\/www\/models\/$/m.test(gi), gi);
ck('8 APK artifact kept 2 days only (GitHub Free artifact storage is 500 MB, V-490)', /retention-days: 2\b/.test(ry) && !/retention-days: 14/.test(ry), null);
ck('9 old guarantees intact: manual only, no push trigger, signing check, secrets only as env', /workflow_dispatch/.test(ry) && !/^\s+push:/m.test(ry) && /EXPECTED_CERT_SHA256/.test(ry) && ry.split('\n').filter(function (l) { return /secrets\./.test(l); }).length === 2, null);
console.log('TEST s22f2c: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
