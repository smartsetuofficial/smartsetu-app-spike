/* smartsetu app v0.5 (S15). Glue only: plugin calls + the Compare screen. The logic is in runner_core.js, view.js, bundle.js (same files as the Chrome extension),
 * webtabs.js, storemap.js, nativefetch.js and uihelp.js (tested in Node). Compare runs ONLY from a button the owner taps (D-010). Draws with textContent only.
 * Speed (D-096): stores the Chrome extension could read without a page (fetchread.js) are read by the phone's network layer, all at once; the rest in hidden pages, one at a time.
 * Only stores that can sell the product are opened (storemap.js); the screen offers the others. Results are drawn as soon as the first store is read. */
import { InAppBrowser, InvisibilityMode } from '@capgo/capacitor-inappbrowser';
import { CapacitorHttp } from '@capacitor/core';
import { Tokenizer } from '@huggingface/tokenizers'; // S22f-2 part 3 (D-128): tokenizer of the meaning model, runs on the phone
var W = require('./webtabs.js');
var C = require('./spike_core.js');
var U = require('./uihelp.js');
var M = require('./storemap.js');
var NF = require('./nativefetch.js');
var Dev = require('./devtest.js');
var Car = require('./carousel.js'); // S22g: Why SmartSetu cards slide one by one
var SEM = require('./semantic.js'), OG = require('./ortglue.js'); // S22f-2 part 3 (D-128): meaning check + glue to onnxruntime-web
var OF = require('./offerflow.js').make({ parser: SmartSetu.parser, adapter: SmartSetu.adapter, offers: SmartSetu.offers, isTileLine: W.isTileLine }); // S22b-2: offers under result rows (D-117)

var R = SmartSetuRunner, V = SmartSetuView, busy = false, runGen = 0, activeTabs = [], offerWt = null, plistItems = {}, pstates = {}, pactive = {}, maxDone = 0, retry = false, VERSION = '0.10.22';
var cards = [], offerRaw = {}, offerTok = 0, lastView = null; // member's own cards (phone only), offer lines read from product pages (by listing url), run token, last drawn view
var live = { runs: {}, q: '', scrolled: false, timer: 0, firstAt: 0, t0: 0, skipped: [] };
var PAUSED = {};
// ---- S22f-2 part 3 (D-128): MEANING check, AFTER the result is on screen (nothing runs before the tap, the first result never waits for it) ----
// Start values, NOT measured on a phone (V-492): at most SEM_TITLES titles are embedded and this search waits at most SEM_WAIT_MS for the model. If the model is slow, loading goes on in the background and the NEXT search uses it.
// Any failure = null = the result stays exactly as it was drawn. The model files come from the app folder (ort/, models/), nothing from the network.
var semEng = null, semLast = null, SEM_TITLES = 120, SEM_WAIT_MS = 30000;
function semEngine() {
  if (!semEng) semEng = SEM.make(OG.makeDeps(OG.webConfig(window, Tokenizer)), { deviceMemory: navigator.deviceMemory });
  return semEng;
}
function semDiag() { // one plain line for the owner-only store test report (devtest.js)
  try { return semLast ? JSON.stringify({ last: semLast, engine: semEng ? semEng.state() : null }) : 'no meaning check ran yet (do a normal Compare first)'; } catch (e) { return 'unreadable'; }
}
async function semRefine(seenAt, gen) { // -> { view, ... } when the meaning check added close matches, else null
  var t0 = Date.now(), titles = [], gaveUp = false, st = semEng ? semEng.state() : null;
  semLast = { q: live.q, at: new Date(t0).toISOString() };
  if (st && (st.status === 'failed' || st.status === 'lowmem')) { semLast.skipped = st.status + ': ' + st.reason; return null; }
  try {
    // 1) a probe that knows no similarity: the engine output is the same as without the check, the probe only notes which titles the engine would ask about
    var p0 = buildNow(seenAt, { sim: function (t) { if (typeof t === 'string' && titles.length < SEM_TITLES && titles.indexOf(t) < 0) titles.push(t); } }), seeds = [];
    try { var s0 = SmartSetu.similar(p0.res, {}); (s0.stores || []).forEach(function (s) { (s.items || []).forEach(function (i) { if (i && i.title && seeds.length < 40) seeds.push(i.title); }); }); } catch (_) { seeds = []; } // S22i: listings the words already confirmed = examples of what is meant
    semLast.asked = titles.length;
    if (titles.length < 3) { semLast.skipped = 'fewer than 3 titles to check'; return null; }
    var Qe = SmartSetu.query, qt = Qe.semText(Qe.parse(live.q));
    say('Checking more matches...');
    var sem = await new Promise(function (resolve) {
      var timer = setTimeout(function () { gaveUp = true; resolve(null); }, SEM_WAIT_MS);
      semEngine().prepare(qt, titles, function () { return gen !== runGen || gaveUp; }, seeds).then(function (s) { clearTimeout(timer); resolve(s); }, function () { clearTimeout(timer); resolve(null); });
    });
    semLast.ms = Date.now() - t0; semLast.gaveUp = gaveUp; semLast.engine = semEngine().state();
    if (!sem || gen !== runGen) return null;
    semLast.info = sem.info;
    var b = buildNow(seenAt, sem), si = b.res && b.res.semInfo;
    semLast.pool = si ? si.pool : 0; semLast.rescued = si ? si.rescued : 0; semLast.seeds = sem.info.seeds || 0; semLast.seedsKept = sem.info.seedsKept || 0;
    try { var s1 = SmartSetu.similar(b.res, {}), smp = []; (s1.stores || []).forEach(function (s) { (s.closeItems || s.close || []).forEach(function (i) { if (smp.length < 8 && i && i.title) smp.push([s.store, String(i.title).slice(0, 34), Math.round(100 * (sem.sim(i.title) || 0)) / 100, sem.agree ? Math.round(100 * (sem.agree(i.title) || 0)) / 100 : null]); }); }); semLast.sample = smp; } catch (_) { /* the sample is only for reading */ }
    return si && si.rescued > 0 ? b : null;
  } catch (e) { semLast.error = String((e && e.message) || e).slice(0, 120); return null; }
}
// ---- end S22f-2 part 3 ----
function $(id) { return document.getElementById(id); }
function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function pluginApi(ua) {
  return {
    open: function (o) {
      var opt = { url: o.url };
      if (ua) opt.customUserAgent = ua;
      if (!o.visible) { opt.hidden = true; opt.invisibilityMode = InvisibilityMode.FAKE_VISIBLE; }
      return InAppBrowser.openWebView(opt).then(function (r) { return r && r.id; });
    },
    exec: function (o) { return InAppBrowser.executeScript({ id: o.id, code: o.code }); },
    close: function (o) { return InAppBrowser.close({ id: o.id }); },
    onMessage: function (fn) { return InAppBrowser.addListener('messageFromWebview', fn).then(function (h) { return function () { h.remove(); }; }); },
    onLoaded: function (fn) { return InAppBrowser.addListener('browserPageLoaded', fn).then(function (h) { return function () { h.remove(); }; }); }
  };
}

function say(t) { $('msg').textContent = t || ''; }
function setBusy(b) { busy = b; $('go').disabled = false; /* S22g: the button stays active, a new search cancels the running one */ $('golabel').textContent = b ? 'Comparing...' : 'Compare'; }

// ---- progress ----
function setRow(label, kind, text, active) {
  var it = plistItems[label]; if (!it) return;
  it.ic.className = 'ic ' + kind; it.st.className = 'st ' + kind; it.st.textContent = text;
  if (active) { pactive[label] = 1; delete pstates[label]; } else { delete pactive[label]; delete pstates[label]; }
}
function refreshBar() {
  var total = Object.keys(pactive).length || 1, n = U.doneCount(pstates);
  if (n > maxDone) maxDone = n; // never goes backwards when a store is tried again
  $('pcount').textContent = maxDone + ' of ' + Object.keys(pactive).length + ' stores checked';
  $('pfill').style.width = Math.round(maxDone * 100 / total) + '%';
  $('pbar').setAttribute('aria-valuenow', String(maxDone));
  $('pbar').setAttribute('aria-valuemax', String(total));
}
function initProgress(pl) {
  var ul = $('plist'); ul.textContent = ''; plistItems = {}; pstates = {}; pactive = {}; maxDone = 0;
  R.STORES.forEach(function (s) {
    var li = el('li'), av = el('span', 'av', s.label.charAt(0)), mid = el('span', 'mid'), nm = el('span', 'nm', s.label), st = el('span', 'st wait', 'Waiting...'), ic = el('span', 'ic wait');
    av.setAttribute('aria-hidden', 'true'); ic.setAttribute('aria-hidden', 'true');
    mid.appendChild(nm); mid.appendChild(st); li.appendChild(av); li.appendChild(mid); li.appendChild(ic); ul.appendChild(li);
    plistItems[s.label] = { ic: ic, st: st, li: li };
    if (PAUSED[s.label]) setRow(s.label, 'off', PAUSED[s.label], false);
    else if (pl.why[s.label]) setRow(s.label, 'skip', 'Skipped: ' + pl.why[s.label], false);
    else if (pl.enabled[s.label]) setRow(s.label, 'wait', 'Waiting...', true);
  });
  $('progress').classList.add('running'); $('progress').hidden = false; refreshBar();
}
function updateProgress(run) {
  if (retry && run.state === 'off') return; // second pass: stores that are not retried keep their first-pass line
  if (run.state === 'off') return; // stores that are not checked are drawn by initProgress
  var it = plistItems[run.store]; if (!it) return;
  var line = V.buildView({ query: {} }, [run]).stores[0];
  var s = U.shortLine(run, W.lineText(run, line.text));
  s.text = U.memberText(s.text); // R13 (D-105): no seconds, no try labels, no read method on the member screen
  it.st.textContent = s.text;
  it.st.className = 'st ' + s.kind; it.ic.className = 'ic ' + s.kind;
  pactive[run.store] = 1; pstates[run.store] = run.state; refreshBar();
}

// ---- results ----
function safeUrl(u) { try { var x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch (_) { return null; } }

function linkTo(r, cls, label) {
  var href = safeUrl(r.url); if (!href) return null;
  var a = el('a', cls, label); a.href = href; a.rel = 'noopener noreferrer'; return a;
}
function bestBlock(r, sv) {
  var b = el('div', 'best'), top = el('div', 'btop');
  top.appendChild(el('span', 'badge', 'Lowest listed price')); top.appendChild(el('span', 'bstore', r.store)); b.appendChild(top);
  var pr = el('div', 'bprice'); pr.appendChild(el('span', 'bnum', r.price || 'Price not shown'));
  if (r.storeMrp) pr.appendChild(el('span', 'm', 'Store MRP ' + r.storeMrp));
  b.appendChild(pr);
  if (sv) b.appendChild(el('p', 'save', U.inr(sv.amount) + ' less than ' + sv.store));
  if (r.note) b.appendChild(el('p', 'note', r.note));
  var a = linkTo(r, 'go', 'Go to ' + r.store); if (a) b.appendChild(a);
  return b;
}
function offerRes(r) { return offerRaw[r.url] ? OF.assess(r.store, offerRaw[r.url], r.pricePaise, cards) : null; }
function addRow(ul, r) {
  var li = el('li', r.isLowest ? 'low' : null), left = el('span', 'l'), right = el('span', 'p');
  left.appendChild(el('span', 's', r.store)); left.appendChild(el('span', 't', r.title));
  if (r.note) left.appendChild(el('span', 'x', r.note));
  OF.rowLines(offerRes(r)).forEach(function (o) { left.appendChild(el('span', 'of of-' + o.kind, o.text)); });
  right.appendChild(el('span', 'pn', r.price || 'Price not shown'));
  if (r.storeMrp) right.appendChild(el('span', 'm', 'Store MRP ' + r.storeMrp));
  var a = linkTo(r, 'lk', 'Go to store'); if (a) right.appendChild(a);
  li.appendChild(left); li.appendChild(right); ul.appendChild(li);
}
function groupCard(g, hideNote) {
  var card = el('article', 'card'), low = g.rows.filter(function (r) { return r.isLowest; })[0];
  card.appendChild(el('h3', null, g.title));
  if (low) card.appendChild(bestBlock(low, U.savings(g.rows)));
  var gl = OF.groupLowest(g.rows, offerRes); if (gl) card.appendChild(el('p', 'gl', gl.text));
  else if (g.label) card.appendChild(el('span', 'badge', g.label));
  if (g.note && !hideNote && !low) card.appendChild(el('p', 'note', g.note));
  var rest = g.rows.filter(function (r) { return r !== low; });
  if (rest.length) { if (low) card.appendChild(el('p', 'sub-h', 'Other stores')); var ul = el('ul', 'rows'); rest.forEach(function (r) { addRow(ul, r); }); card.appendChild(ul); }
  return card;
}

function skeleton() {
  var box = $('results'); box.textContent = '';
  for (var i = 0; i < 2; i++) { var c = el('div', 'card sk'); c.appendChild(el('div', 'sk-l w60')); c.appendChild(el('div', 'sk-l w90')); c.appendChild(el('div', 'sk-l w40')); box.appendChild(c); }
}

function render(view, o) {
  o = o || {};
  lastView = view;
  var box = $('results'), wasOpen = !!box.querySelector('details.more[open]'); box.textContent = '';
  $('empty').hidden = true;
  box.appendChild(el('h2', null, view.headline));
  if (o.live) box.appendChild(el('p', 'live', 'Still checking some stores. Prices below can change as more stores finish.'));
  if (view.note) box.appendChild(el('p', 'note', view.note));
  var sp = U.splitGroups(view.groups, view.mode);
  if (sp.multiNote) box.appendChild(el('p', 'note', sp.multiNote));
  if (view.top) {
    var tc = el('article', 'card toplow'), tu = el('ul', 'rows');
    tc.appendChild(el('h3', null, view.top.title)); tc.appendChild(el('p', 'note', view.top.note));
    view.top.rows.forEach(function (r) { addRow(tu, r); });
    tc.appendChild(tu); box.appendChild(tc);
  }
  sp.multi.forEach(function (g) { box.appendChild(groupCard(g, !!sp.multiNote)); });
  if (sp.single.length) {
    var d = el('details', 'more'), sm = el('summary', null, 'Listed at one store only (' + sp.single.length + ')');
    d.appendChild(sm); if (wasOpen) d.open = true;
    if (sp.singleNote) d.appendChild(el('p', 'note', sp.singleNote));
    sp.single.forEach(function (g) {
      var sub = el('article', 'sub'), ul = el('ul', 'rows');
      sub.appendChild(el('h3', null, g.title));
      if (g.note && !sp.singleNote) sub.appendChild(el('p', 'note', g.note));
      g.rows.forEach(function (r) { addRow(ul, r); });
      sub.appendChild(ul); d.appendChild(sub);
    });
    box.appendChild(d);
  }
  $('footnote').textContent = U.memberFooter(view.seenAt ? new Date(view.seenAt).toLocaleString() : '');
  if (!live.scrolled) { live.scrolled = true; try { box.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) { /* older webview: stay where we are */ } }
}

function adopt(runs) { (runs || []).forEach(function (r) { if (r && r.state !== 'off' && r.state !== 'retrying') live.runs[r.store] = r; }); }
function allRuns() { return Object.keys(live.runs).map(function (k) { return live.runs[k]; }); }
// S21b (D-110): after the engine has counted, a store line says how many listings MATCH the search (or "No matching products"), not how many cards the page had. Only stores that finished with state ok; a failure here never stops the run.
function paintRelevance(res, runs) {
  try {
    var rel = U.relevantByStore(res); if (!rel) return;
    runs.forEach(function (run) {
      var it = plistItems[run.store];
      if (!it || run.state !== 'ok' || !Object.prototype.hasOwnProperty.call(rel, run.key)) return;
      var s = U.relevanceLine(rel[run.key]);
      it.st.textContent = s.text; it.st.className = 'st ' + s.kind; it.ic.className = 'ic ' + s.kind;
    });
  } catch (_) { /* the plain store line stays */ }
}
function buildNow(seenAt, sem) { // sem is optional (S22f-2 part 3); left out = the engine ranks exactly as before
  var runs = allRuns(), snaps = runs.filter(function (r) { return r.snapshot; }).map(function (r) { return r.snapshot; });
  var res = SmartSetu.compareAny({ query: live.q, searches: snaps, products: [], seenAt: seenAt, sem: sem }), v = V.buildView(res, runs, seenAt);
  paintRelevance(res, runs);
  return { view: v, snaps: snaps.length, res: res };
}
// Results are drawn as soon as a store has listings, and again (at most every 0.4 s) when more stores finish. A failure here never stops the run.
function liveRender() {
  if (live.timer) return;
  live.timer = setTimeout(function () {
    live.timer = 0;
    try { var b = buildNow(new Date().toISOString()); if (b.snaps) { if (!live.firstAt) live.firstAt = Date.now(); render(b.view, { live: true }); } } catch (_) { /* wait for the next store */ }
  }, live.firstAt ? 400 : 0);
}

function storeOf(label) { return R.STORES.filter(function (s) { return s.label === label; })[0]; }

// One place that starts the stores. Called only from startRun, which only a tap can reach (D-010).
function runStores(tabs, o) { return R.runAll(tabs, o); }

// Which stores to open. only = labels of an "also check the other stores" tap. Croma is paused and never opened here.
// S21b (D-110): which stores to open is NOT decided from a word list any more (the table in storemap.js is a guess, V-271, and cannot cover thousands of searches). Every store is read; the store line then says how many listings match (paintRelevance). Set true to bring the old skip back.
var SKIP_BY_WORDS = false;
function plan(q, only) {
  var kill = W.enabledMap(), pick = M.pick(q, R.STORES), enabled = {}, why = {}, skipped = [];
  R.STORES.forEach(function (s) {
    var on = kill[s.label] !== false;
    if (SKIP_BY_WORDS && on && pick.skip[s.key]) { why[s.label] = pick.skip[s.key]; skipped.push(s.label); on = false; }
    if (only) on = kill[s.label] !== false && only.indexOf(s.label) >= 0;
    enabled[s.label] = on;
  });
  return { enabled: enabled, why: only ? {} : why, skipped: skipped, pick: pick };
}

// S22g (D-124): a new search while one is running cancels the old one (its pages are closed, its late answers are ignored), the person never waits.
function mkTabs(ua) { var t = W.createWebTabs(ua ? pluginApi(ua) : pluginApi(), { ready: true }); activeTabs.push(t); return t; }
function cancelRun() {
  runGen++; offerTok++; retry = false;
  var a = activeTabs; activeTabs = [];
  a.forEach(function (t) { try { t.dispose(); } catch (_) { /* closed already */ } });
  if (offerWt) { try { offerWt.dispose(); } catch (_) { /* closed already */ } offerWt = null; }
}
async function startRun(q, only) {
  if (busy) { if (only || q === live.q) { if (!only) say('Already comparing this search...'); return; } cancelRun(); } else if (offerWt) cancelRun();
  var gen = ++runGen;
  offerTok++; if (!only) offerRaw = {};
  say(''); setBusy(true);
  var tabs = null, tabs2 = null, out = null, pl = plan(q, only), extra = !!only;
  var fr = SmartSetuFetchRead.make(NF.makeFetch(CapacitorHttp, C.desktopUa(navigator.userAgent)), SmartSetuSnapDoc.snapFromHtml);
  function late() { return Date.now() - live.t0 > 100000; }
  try {
    live.q = q; live.t0 = Date.now(); live.scrolled = extra; live.firstAt = 0;
    if (!extra) { live.runs = {}; skeleton(); $('morebox').hidden = true; initProgress(pl); }
    else { only.forEach(function (l) { if (pl.enabled[l]) setRow(l, 'wait', 'Waiting...', true); }); $('progress').classList.add('running'); maxDone = 0; refreshBar(); }
    retry = false;
    function opts(enabled) { return { query: q, enabled: enabled, foreground: false, rereads: 2, rereadMs: 2500, collect: smartsetuCollect, onUpdate: function (r) { if (gen !== runGen) return; updateProgress(r); adopt([r]); if (r.snapshot) liveRender(); }, maxTabs: 1, perStoreMs: 50000, retryTimeouts: false }; }
    var pass1 = Object.assign({}, pl.enabled); pass1.Myntra = false; pass1.Croma = false; // S20b: Myntra is read on its own after the others (card rescue, below), it does not hold up the rest
    var o1 = opts(pass1); o1.fetchFirst = SmartSetuFetchRead.STORES_OK; o1.fetchRead = fr; o1.fetchMs = 9000;
    tabs = mkTabs();
    out = await runStores(tabs, o1);
    if (gen !== runGen) return;
    adopt(out.runs);
    if (pl.enabled.Myntra) {
      say('Checking Myntra...');
      tabs2 = tabs2 || mkTabs(C.desktopUa(navigator.userAgent));
      var mr = await W.rescueRead(tabs2, storeOf('Myntra'), q, {});
      if (gen !== runGen) return;
      W.mergeRuns(out, { runs: [mr] }); updateProgress(mr); adopt([mr]); liveRender();
    }
    if (pl.enabled.Croma) { // S21e: Croma needs a pincode before it shows products; the app types a fixed one (owner: the listing does not change), see W.pincodeSet
      say('Checking Croma...');
      tabs2 = tabs2 || mkTabs(C.desktopUa(navigator.userAgent));
      var cr = await W.pinRead(tabs2, storeOf('Croma'), q, W.CROMA_PIN, {});
      if (gen !== runGen) return;
      W.mergeRuns(out, { runs: [cr] }); updateProgress(cr); adopt([cr]); liveRender();
    }
    var notMyntra = function (l) { return l !== 'Myntra' && l !== 'Croma'; };
    var bad = W.failingLabels(out.runs).filter(notMyntra);
    if (bad.length) {
      say('Checking ' + bad.join(', ') + ' again...');
      retry = true;
      tabs2 = mkTabs(C.desktopUa(navigator.userAgent));
      var rb = await runStores(tabs2, opts(W.enabledOnly(R.STORES, bad)));
      if (gen !== runGen) return;
      W.mergeRuns(out, rb);
      retry = false; adopt(out.runs); liveRender();
    }
    var slowL = late() ? [] : W.timedOutLabels(out.runs); // a store that timed out gets one more try with a long wait and scrolling (every store, D-073)
    if (slowL.length) {
      tabs2 = tabs2 || mkTabs(C.desktopUa(navigator.userAgent));
      for (var sl = 0; sl < slowL.length; sl++) {
        say('Still checking ' + slowL[sl] + '...');
        var sr = await W.slowRead(tabs2, storeOf(slowL[sl]), q, smartsetuCollect, {});
        if (gen !== runGen) return;
        W.mergeRuns(out, { runs: [sr] }); updateProgress(sr); adopt([sr]); liveRender();
      }
    }
    var empty = W.failingLabels(out.runs).filter(notMyntra); // a store that is still empty gets a card rescue read (every store, D-073)
    if (late()) empty = []; // the run has already taken long: show what is there instead of more tries
    if (empty.length) {
      tabs2 = tabs2 || mkTabs(C.desktopUa(navigator.userAgent));
      for (var em = 0; em < empty.length; em++) {
        say('Still checking ' + empty[em] + '...');
        var rr = await W.rescueRead(tabs2, storeOf(empty[em]), q, {});
        if (gen !== runGen) return;
        if (rr.state === 'ok') { W.mergeRuns(out, { runs: [rr] }); updateProgress(rr); adopt([rr]); }
      }
    }
    if (live.timer) { clearTimeout(live.timer); live.timer = 0; }
    var fin = buildNow(out.seenAt);
    render(fin.view);
    if (!extra) live.skipped = pl.skipped;
    var left = live.skipped.filter(function (l) { return !live.runs[l]; });
    if (left.length) { $('morebtn').textContent = 'Also check ' + left.length + ' other store' + (left.length > 1 ? 's' : '') + ' (' + left.join(', ') + ')'; $('morebox').hidden = false; live.skipped = left; } else $('morebox').hidden = true;
    say('');
    var finView = fin.view; // S22f-2 part 3: meaning check after the result is shown; if it adds close matches the screen is drawn once more
    var sb = await semRefine(out.seenAt, gen);
    if (gen !== runGen) return;
    if (sb) { finView = sb.view; render(finView); }
    say('');
    var myTok = offerTok; setTimeout(function () { runOffers(finView, myTok); }, 0); // after the result is on screen, never before the owner taps Compare (D-010)
  } catch (e) {
    if (gen !== runGen) return;
    say('Something went wrong, nothing was compared. Please try again.');
    if (!allRuns().length) { $('results').textContent = ''; $('empty').hidden = false; }
  } finally {
    if (tabs) { try { tabs.dispose(); } catch (_) { /* closed already */ } } if (tabs2) { try { tabs2.dispose(); } catch (_) { /* closed already */ } }
    if (gen === runGen) { // a cancelled run must not touch the screen of the newer run
      if (live.timer) { clearTimeout(live.timer); live.timer = 0; }
      activeTabs = []; retry = false; $('progress').classList.remove('running'); setBusy(false);
    }
  }
}

// S22b-2: offers of the top listings of each store, read from the store's own product page, one page at a time, after the result is shown. A failure here never touches the result.
async function runOffers(view, tok) {
  var t = OF.pickTargets(view).filter(function (x) { return !offerRaw[x.url]; }), wt = null;
  if (!t.length) return;
  try {
    wt = W.createWebTabs(pluginApi(C.desktopUa(navigator.userAgent)), { ready: true }); offerWt = wt;
    for (var i = 0; i < t.length; i++) {
      if (tok !== offerTok) break;
      say('Reading store offers (' + (i + 1) + ' of ' + t.length + ')...');
      var res = await W.readPage(wt, t[i].url, W.offerProbe, { settleMs: 3500, loadMs: 25000 });
      if (tok !== offerTok) break;
      var lines = res && res.ok && res.result && Array.isArray(res.result.lines) ? res.result.lines : [];
      offerRaw[t[i].url] = lines;
      if (lines.length && lastView) render(lastView);
    }
  } catch (_) { /* offers are optional */ } finally {
    if (wt) { try { wt.dispose(); } catch (_) { /* closed already */ } } if (offerWt === wt) offerWt = null;
    if (tok === offerTok && !busy) say('');
  }
}
function cardsLabel(list) { return list.length <= 2 ? list.join(', ') : list.slice(0, 2).join(', ') + ' +' + (list.length - 2) + ' more'; }
function refreshCardsBtn() {
  $('cardsub').textContent = cards.length ? cardsLabel(cards) : 'Add your cards to estimate bank offers';
  $('cardcount').textContent = cards.length ? cards.length + ' selected' : 'None selected';
  $('cardsclear').hidden = !cards.length;
}
function initCards() {
  var ul = $('cardlist'), store = null;
  try { store = window.localStorage; } catch (_) { store = null; }
  if (store) cards = OF.loadCards(store);
  function apply(on) { cards = store ? OF.saveCards(store, on) : OF.validCards(on); refreshCardsBtn(); if (lastView) render(lastView); }
  function ticked() { return Array.prototype.filter.call(ul.querySelectorAll('input'), function (x) { return x.checked; }).map(function (x) { return x.value; }); }
  OF.BANKS.forEach(function (b) {
    var li = el('li'), lb = el('label', 'chip'), cb = el('input'); cb.type = 'checkbox'; cb.value = b; cb.checked = cards.indexOf(b) >= 0;
    cb.addEventListener('change', function () { apply(ticked()); });
    lb.appendChild(cb); lb.appendChild(el('span', null, b)); li.appendChild(lb); ul.appendChild(li);
  });
  function setOpen(open) { var p = $('cardspanel'); p.hidden = !open; $('cardsbtn').setAttribute('aria-expanded', open ? 'true' : 'false'); if (open) { try { p.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) { /* older webview */ } } }
  $('cardsbtn').addEventListener('click', function () { setOpen($('cardspanel').hidden); });
  $('cardsdone').addEventListener('click', function () { setOpen(false); });
  $('cardsclear').addEventListener('click', function () { Array.prototype.forEach.call(ul.querySelectorAll('input'), function (x) { x.checked = false; }); apply([]); });
  refreshCardsBtn();
}
function onSubmit(ev) {
  ev.preventDefault();
  var q = $('q').value.trim();
  if (!q) { say('Type what you want to buy, for example "boAt Airdopes 141".'); return; }
  startRun(q, null);
}

document.addEventListener('DOMContentLoaded', function () {
  initCards();
  try { Car.make(document.querySelector('.perks'), document, window); } catch (_) { /* the slider is only decoration */ }
  $('form').addEventListener('submit', onSubmit);
  var qi = $('q'), qc = $('qclear');
  function syncClear() { qc.hidden = !qi.value; }
  qi.addEventListener('input', function () { syncClear(); if (busy) $('golabel').textContent = (qi.value.trim() && qi.value.trim() !== live.q) ? 'Compare this instead' : 'Comparing...'; }); qc.addEventListener('click', function () { qi.value = ''; syncClear(); qi.focus(); }); syncClear();
  $('morebtn').addEventListener('click', function () { if (!busy && live.skipped.length) startRun(live.q, live.skipped.slice()); });
  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) { c.addEventListener('click', function () { $('q').value = c.getAttribute('data-q') || ''; $('q').focus(); }); });
  // A store link opens in the phone's own browser window (Chrome Custom Tab), not inside the app page.
  $('results').addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a) return;
    var u = safeUrl(a.href); if (!u) return;
    ev.preventDefault();
    InAppBrowser.open({ url: u });
  });
  Dev.attach({ trigger: $('logo'), isBusy: function () { return busy; }, setBusy: setBusy, query: function () { return $('q').value.trim(); }, version: VERSION, R: R, V: V, W: W, C: C, M: M, NF: NF, http: CapacitorHttp, pluginApi: pluginApi, collect: smartsetuCollect, SmartSetu: SmartSetu, SnapDoc: SmartSetuSnapDoc, fetchRead: SmartSetuFetchRead, semDiag: semDiag });
});
