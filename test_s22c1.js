/* app-spike / test_s22c1 v1.0.0 (S22c-1, D-119). Run: node test_s22c1.js
 * "My cards" was a floating pill and a checkbox grid (owner: looks unprofessional). Now: a Card offers row as wide as Compare (icon, name, the chosen banks), the panel opens right under it
 * with tick chips, a count, Clear all and Done. Layout checked in Chromium at 434 and 360 px (no sideways scroll, screenshots viewed) in the session that wrote this. This file checks the markup,
 * the css rules and the label logic that decides what the row says. */
'use strict';
var fs = require('fs'), path = require('path'), pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d)); } }
var html = fs.readFileSync(path.join(__dirname, 'www/index.html'), 'utf8'), css = fs.readFileSync(path.join(__dirname, 'www/app.css'), 'utf8'), js = fs.readFileSync(path.join(__dirname, 'src/app.js'), 'utf8');
ck('1a row with icon, title, subtitle and chevron; the old floating pill is gone', /id="cardsbtn" class="cardsrow"/.test(html) && /class="cr-t">Card offers/.test(html) && /id="cardsub"/.test(html) && /class="cr-chev"/.test(html) && !/class="cardsbtn"/.test(html), 0);
ck('1b the panel sits directly under the row, inside the first screen, not at the bottom', html.indexOf('id="cardspanel"') > html.indexOf('id="cardsbtn"') && html.indexOf('id="cardspanel"') < html.indexOf('class="try"') && html.indexOf('id="cardspanel"') < html.indexOf('<main'), [html.indexOf('id="cardspanel"'), html.indexOf('<main')]);
ck('1c panel has chips list, count, Clear all, Done and the phone-only note', /id="cardlist" class="cardchips"/.test(html) && /id="cardcount"/.test(html) && /id="cardsclear"/.test(html) && /id="cardsdone"/.test(html) && /stays on this phone/.test(html), 0);
ck('2a css: row as wide as Compare, chips, ticked chip, 360 px rule, nothing left of the old grid', /\.cardsrow\{display:flex[^}]*width:100%/.test(css) && /\.chip input:checked\+span\{/.test(css) && /max-width:389px\)\{\.cardspanel \.cardchips/.test(css) && !/\.cardlist/.test(css) && !/\.cardsbtn\{/.test(css), 0);
var m = /function cardsLabel\(list\) \{[^\n]*\}/.exec(js), label = m ? new Function(m[0] + '; return cardsLabel;')() : null;
ck('3a label: one, two, many banks', label && label(['HDFC']) === 'HDFC' && label(['HDFC', 'ICICI']) === 'HDFC, ICICI' && label(['HDFC', 'ICICI', 'SBI']) === 'HDFC, ICICI +1 more' && label(['a', 'b', 'c', 'd', 'e', 'f', 'g']) === 'a, b +5 more', m && m[0]);
ck('3b app.js: subtitle, count and Clear all follow the saved cards; Clear all saves an empty list; Done closes', /cardsub'\)\.textContent = cards\.length \? cardsLabel\(cards\)/.test(js) && /cardsclear'\)\.hidden = !cards\.length/.test(js) && /\$\('cardsclear'\)\.addEventListener\('click'/.test(js) && /apply\(\[\]\)/.test(js) && /\$\('cardsdone'\)\.addEventListener\('click', function \(\) \{ setOpen\(false\)/.test(js), 0);
console.log('test_s22c1: ' + pass + ' pass, ' + fail + ' fail'); process.exit(fail ? 1 : 0);
