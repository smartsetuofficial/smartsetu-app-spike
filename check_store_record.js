/* smartsetu app / check_store_record v1 (S23-18, D-163). Run BEFORE every site push that changes the store record:
 *   node code\app-spike\check_store_record.js            (from smartsetu-handoff-v4; reads ..\smartsetu-site\public\app-config\stores.json)
 * Exit 0 only if the file is valid AND has no ignored field (a field the app would drop is a mistake here). Prints what the file changes against the built-in values. */
'use strict';
var fs = require('fs'), path = require('path');
var R = require('./www/runner_core.js'), FR = require('./www/fetchread.js'), P = require('../parser-core/parser.js'), SR = require('./www/storerecord.js');
var file = process.argv[2] || path.join(__dirname, '..', '..', '..', 'smartsetu-site', 'public', 'app-config', 'stores.json');
var m = SR.make({ runner: R, fetchRead: FR, parser: P });
var txt = fs.readFileSync(file, 'utf8'), res = m.take(txt, 'file');
if (!res.ok) { console.log('NOT OK: ' + res.why); process.exit(1); }
var st = m.status(), b = m.builtinRecord(), j = JSON.parse(txt), diff = [];
Object.keys(j.stores || {}).forEach(function (k) { Object.keys(j.stores[k]).forEach(function (f) { if (JSON.stringify(j.stores[k][f]) !== JSON.stringify(b.stores[k][f])) diff.push(k + '.' + f); }); });
console.log('record version ' + st.version + ' | stores in file ' + Object.keys(j.stores || {}).length + ' | differs from built-in: ' + (diff.join(', ') || 'nothing') + ' | extra no-results words ' + st.words);
if (st.errors.length) { console.log('NOT OK, ignored fields: ' + st.errors.join('; ')); process.exit(1); }
console.log('RECORD OK');
