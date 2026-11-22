/* test_s22g.js 1.1.0 (S22g D-124 + S22h D-125: 7 3D slides): Why SmartSetu slider (carousel.js, fake page), search-cancel code in app.js, fit rules in app.css. Offline. */
'use strict';
var fs = require('fs'), path = require('path');
var Car = require('./src/carousel.js');
var pass = 0, fail = 0;
function ck(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name); } }

// pure helpers
ck('next wraps', Car.nextIndex(3, 4) === 0 && Car.nextIndex(0, 4) === 1 && Car.nextIndex(0, 0) === 0);
ck('indexAt rounds, clamps, safe', Car.indexAt(0, 300, 4) === 0 && Car.indexAt(310, 300, 4) === 1 && Car.indexAt(9999, 300, 4) === 3 && Car.indexAt(-50, 300, 4) === 0 && Car.indexAt(100, 0, 4) === 0 && Car.indexAt(100, 300, 0) === 0);

// fake page
function el(tag) {
  var cls = {}, attrs = {}, ls = {}, o = {
    tagName: tag, children: [], className: '', offsetLeft: 0, scrollLeft: 0, parentNode: null, scrolls: [],
    classList: { add: function (c) { cls[c] = 1; }, remove: function (c) { delete cls[c]; }, contains: function (c) { return !!cls[c]; } },
    setAttribute: function (k, v) { attrs[k] = String(v); }, getAttribute: function (k) { return attrs[k]; }, removeAttribute: function (k) { delete attrs[k]; },
    addEventListener: function (e, f) { (ls[e] = ls[e] || []).push(f); },
    fire: function (e) { (ls[e] || []).forEach(function (f) { f({}); }); },
    appendChild: function (c) { c.parentNode = o; o.children.push(c); return c; },
    insertBefore: function (c, ref) { c.parentNode = o; var i = o.children.indexOf(ref); if (i < 0) o.children.push(c); else o.children.splice(i, 0, c); return c; },
    scrollTo: function (a) { o.scrolls.push(a.left); o.scrollLeft = a.left; }
  };
  Object.defineProperty(o, 'nextSibling', { get: function () { if (!o.parentNode) return null; var s = o.parentNode.children; return s[s.indexOf(o) + 1] || null; } });
  o._attrs = attrs; o._cls = cls; o._ls = ls;
  return o;
}
function rig(opts) {
  opts = opts || {};
  var root = el('div'), ul = el('ul'), t = 0, timers = [], ivs = [];
  root.appendChild(ul);
  for (var i = 0; i < (opts.n || 4); i++) { var li = el('li'); li.offsetLeft = i * 310; ul.appendChild(li); }
  var doc = { hidden: false, createElement: el };
  var win = {
    matchMedia: function () { return { matches: !!opts.reduce }; },
    setInterval: function (f) { ivs.push({ f: f, on: true }); return ivs.length; },
    clearInterval: function (id) { if (ivs[id - 1]) ivs[id - 1].on = false; },
    setTimeout: function (f, ms) { timers.push({ f: f, at: t + ms, on: true }); return timers.length; },
    clearTimeout: function (id) { if (timers[id - 1]) timers[id - 1].on = false; },
    addEventListener: function () {}
  };
  function tick(ms) { t += ms; timers.forEach(function (x) { if (x.on && x.at <= t) { x.on = false; x.f(); } }); }
  function auto() { ivs.forEach(function (x) { if (x.on) x.f(); }); }
  return { ul: ul, root: root, doc: doc, win: win, tick: tick, auto: auto, ivs: ivs };
}
function on(x) { return x._cls.on === 1; }

var r = rig(), c = Car.make(r.ul, r.doc, r.win);
ck('built, 4 slides, auto on', c && c.count === 4 && c.auto === true && r.ivs.length === 1);
var bar = r.root.children[1];
ck('dots after the list, 4 buttons', bar && bar.className === 'pdots' && bar.children.length === 4 && bar.children[0].type === 'button');
ck('first slide + dot marked', on(r.ul.children[0]) && on(bar.children[0]) && !on(r.ul.children[1]) && bar.children[0].getAttribute('aria-current') === 'true');
ck('aria roles', r.ul.getAttribute('role') === 'region' && r.ul.getAttribute('aria-roledescription') === 'carousel' && r.ul.children[2].getAttribute('aria-label') === '3 of 4' && /Show card 2 of 4/.test(bar.children[1].getAttribute('aria-label')));
ck('js class added (css fallback needs it)', r.ul._cls.js === 1);
r.auto(); ck('auto goes to 2nd, scrolls to its offset', c.index() === 1 && r.ul.scrolls[0] === 310 && on(r.ul.children[1]) && !on(r.ul.children[0]));
r.auto(); r.auto(); r.auto(); ck('wraps back to first', c.index() === 0 && r.ul.scrolls[r.ul.scrolls.length - 1] === 0);

// touch pauses auto, resumes after rest
r.ul.fire('touchstart'); var before = c.index(); r.auto(); ck('no auto slide while touched', c.index() === before);
r.ul.fire('touchend'); r.auto(); ck('still held right after release', c.index() === before);
r.tick(6001); r.auto(); ck('auto resumes after the rest time', c.index() === (before + 1) % 4);

// dot tap
bar.children[3].fire('click'); ck('dot tap goes to that card and holds auto', c.index() === 3 && r.ul.scrolls[r.ul.scrolls.length - 1] === 930);
r.auto(); ck('held after dot tap', c.index() === 3);

// swipe by hand: scroll event moves the marker
r.ul.scrollLeft = 320; r.ul.fire('scroll'); ck('scroll event updates marker', c.index() === 1 && on(bar.children[1]) && !on(bar.children[3]));

// hidden page, reduced motion, too few slides
var h = rig(); var hc = Car.make(h.ul, h.doc, h.win); h.doc.hidden = true; h.auto(); ck('no auto while page hidden', hc.index() === 0);
var rm = rig({ reduce: true }), rc = Car.make(rm.ul, rm.doc, rm.win); ck('reduced motion: no timer, still swipeable', rc && rc.auto === false && rm.ivs.length === 0);
ck('fewer than 2 slides or no list: nothing built', Car.make(rig({ n: 1 }).ul, {}, {}) === null && Car.make(null, {}, {}) === null);
var nm = rig(); nm.win.matchMedia = function () { throw new Error('old webview'); }; ck('matchMedia failing does not stop it', Car.make(nm.ul, nm.doc, nm.win).auto === true);
c.stop(); r.auto(); ck('stop() clears the timer', r.ivs[0].on === false);

// source checks: search cancel (app.js), fit and slider (app.css), hook
var app = fs.readFileSync(path.join(__dirname, 'src/app.js'), 'utf8'), css = fs.readFileSync(path.join(__dirname, 'www/app.css'), 'utf8').replace(/([\d.]+)rem/g, function (m, n) { return +(n * 16).toFixed(3) + 'px'; }), html = fs.readFileSync(path.join(__dirname, 'www/index.html'), 'utf8');
ck('Compare button stays active while a search runs', /function setBusy\(b\) \{ busy = b; \$\('go'\)\.disabled = false;/.test(app) && !/\$\('go'\)\.disabled = b/.test(app));
ck('onSubmit no longer drops a second search', !/function onSubmit\(ev\) \{\s*ev\.preventDefault\(\);\s*if \(busy\) return;/.test(app));
ck('new search cancels the old (cancelRun, runGen)', /function cancelRun\(\)/.test(app) && /if \(busy\) \{ if \(only \|\| q === live\.q\)/.test(app) && /var gen = \+\+runGen;/.test(app));
ck('same search twice while running is ignored with a message', /Already comparing this search/.test(app));
var awaits = (app.match(/await W\.(rescueRead|pinRead|slowRead)\(|await runStores\(/g) || []).length, stale = (app.match(/if \(gen !== runGen\) return;/g) || []).length;
ck('every await in startRun is followed by a stale check (' + awaits + ' awaits, ' + stale + ' checks)', awaits === 6 && stale >= awaits + 2);
ck('late answers of a cancelled run are ignored (onUpdate, catch)', /onUpdate: function \(r\) \{ if \(gen !== runGen\) return;/.test(app) && /\} catch \(e\) \{\s*if \(gen !== runGen\) return;/.test(app));
ck('finally of a cancelled run does not touch the new run screen', /if \(gen === runGen\) \{[^]*?setBusy\(false\);/.test(app));
ck('all store pages of a run are tracked and closed on cancel', !/tabs2 = (tabs2 \|\| )?W\.createWebTabs/.test(app) && (app.match(/mkTabs\(/g) || []).length >= 7 && /offerWt/.test(app));
ck('slider hook in app.js', /var Car = require\('\.\/carousel\.js'\)/.test(app) && /Car\.make\(document\.querySelector\('\.perks'\), document, window\)/.test(app));
ck('app version 0.10.25', /VERSION = '0\.10\.25'/.test(app));
ck('header wraps instead of overflowing (every width and font size)', /\.top \.wrap\{flex-wrap:wrap/.test(css));
ck('slider css: snap scroll, one card per view, dots, reduced motion', /\.perks\{display:flex;[^}]*scroll-snap-type:x mandatory/.test(css) && /\.perks li\{flex:0 0 100%/.test(css) && /\.pdots button\.on\{width:24px/.test(css) && /prefers-reduced-motion:reduce\)\{\.perks\.js li/.test(css));
ck('card texts unchanged (owner texts)', ['Save More', 'Shop Smart', 'Check Fast', 'Privacy First', 'Get the lowest price across multiple stores.', 'Compare prices side-by-side in seconds.', 'Find the best deal quickly, no hassle.', 'No sign-in needed. We do not keep your searches.'].every(function (s) { return html.indexOf(s) >= 0; }) && html.indexOf('<ul class="perks">') >= 0);
// S22h (D-125): 7 slides, 3D look, real 3D pictures
ck('7 slides: 4 owner texts unchanged + 3 new true ones', ['Save More', 'Shop Smart', 'Check Fast', 'Privacy First', 'Get the lowest price across multiple stores.', 'Compare prices side-by-side in seconds.', 'Find the best deal quickly, no hassle.', 'No sign-in needed. We do not keep your searches.', 'Prices as stores finish', 'Results appear as each store finishes.', 'Direct store links', 'Stores open on your tap', 'Stores open only when you press Compare.'].every(function (s) { return html.indexOf(s) >= 0; }) && (html.match(/<li><img class="pic"/g) || []).length === 7);
var imgs = (html.match(/src="slides\/([a-z]+\.webp)"/g) || []).map(function (x) { return x.slice(11, -1); });
ck('every slide picture file exists and is small (< 20 KB each)', imgs.length === 7 && imgs.every(function (f) { var p = path.join(__dirname, 'www', 'slides', f); return fs.existsSync(p) && fs.statSync(p).size > 1000 && fs.statSync(p).size < 20000; }));
var lic = path.join(__dirname, 'www', 'slides', 'LICENSE-fluentui-emoji.txt');
ck('MIT licence notice of the 3D pictures is shipped', fs.existsSync(lic) && /MIT License/.test(fs.readFileSync(lic, 'utf8')) && /Microsoft Corporation/.test(fs.readFileSync(lic, 'utf8')));
ck('3D css: perspective, tilted neighbours, centred width, reduced motion', /\.perks\{--sw:min\(76vw,340px\)[^}]*perspective:900px/.test(css) && /\.perks\.js li\.prev\{transform:rotateY\(32deg\)/.test(css) && /\.perks\.js li\.next\{transform:rotateY\(-32deg\)/.test(css) && /\.perks li\{flex:0 0 var\(--sw\)/.test(css) && /prefers-reduced-motion:reduce\)\{\.perks li\.on \.pic\{animation:none\}/.test(css));
ck('no remote picture url in the html, no remote url() or @import in the css (offline)', !/https?:\/\/[^"')\s]*\.(png|webp|jpg)/i.test(html) && !/@import|url\(https?:/.test(css));
var r7 = rig({ n: 7 }), c7 = Car.make(r7.ul, r7.doc, r7.win);
function cl(i, k) { return r7.ul.children[i]._cls[k] === 1; }
ck('prev/next classes follow the current slide', c7.count === 7 && cl(0, 'on') && cl(1, 'next') && !cl(0, 'prev') && (r7.auto(), cl(1, 'on') && cl(0, 'prev') && cl(2, 'next') && !cl(1, 'next')));
r7.auto(); r7.auto(); r7.auto(); r7.auto(); r7.auto();
ck('last slide: only prev, no next, no stale class', c7.index() === 6 && cl(6, 'on') && cl(5, 'prev') && !cl(6, 'next') && !cl(0, 'next') && !cl(4, 'prev'));
r7.auto(); ck('wraps to first with 7 slides', c7.index() === 0 && cl(0, 'on') && cl(1, 'next') && !cl(6, 'prev'));
console.log('test_s22g: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
