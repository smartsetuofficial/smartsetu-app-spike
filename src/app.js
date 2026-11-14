/* smartsetu app v0.5 (S15). Glue only: plugin calls + the Compare screen. The logic is in runner_core.js, view.js, bundle.js (same files as the Chrome extension),
 * webtabs.js, storemap.js, nativefetch.js and uihelp.js (tested in Node). Compare runs ONLY from a button the owner taps (D-010). Draws with textContent only.
 * Speed (D-096): stores the Chrome extension could read without a page (fetchread.js) are read by the phone's network layer, all at once; the rest in hidden pages, one at a time.
 * Only stores that can sell the product are opened (storemap.js); the screen offers the others. Results are drawn as soon as the first store is read. */
import { InAppBrowser, InvisibilityMode } from '@capgo/capacitor-inappbrowser';
import { CapacitorHttp } from '@capacitor/core';
var W = require('./webtabs.js');
var C = require('./spike_core.js');
var U = require('./uihelp.js');
var M = require('./storemap.js');
var NF = require('./nativefetch.js');
var Dev = require('./devtest.js');

var R = SmartSetuRunner, V = SmartSetuView, busy = false, plistItems = {}, pstates = {}, pactive = {}, maxDone = 0, retry = false, VERSION = '0.10.9';
var live = { runs: {}, q: '', scrolled: false, timer: 0, firstAt: 0, t0: 0, skipped: [] };
var PAUSED = { Croma: 'Not available yet' };
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
function setBusy(b) { busy = b; $('go').disabled = b; $('golabel').textContent = b ? 'Comparing...' : 'Compare'; }

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
  top.appendChild(el('span', 'badge', 'Lowest price found')); top.appendChild(el('span', 'bstore', r.store)); b.appendChild(top);
  var pr = el('div', 'bprice'); pr.appendChild(el('span', 'bnum', r.price || 'Price not shown'));
  if (r.storeMrp) pr.appendChild(el('span', 'm', 'Store MRP ' + r.storeMrp));
  b.appendChild(pr);
  if (sv) b.appendChild(el('p', 'save', U.inr(sv.amount) + ' less than ' + sv.store));
  if (r.note) b.appendChild(el('p', 'note', r.note));
  var a = linkTo(r, 'go', 'Go to ' + r.store); if (a) b.appendChild(a);
  return b;
}
function addRow(ul, r) {
  var li = el('li', r.isLowest ? 'low' : null), left = el('span', 'l'), right = el('span', 'p');
  left.appendChild(el('span', 's', r.store)); left.appendChild(el('span', 't', r.title));
  if (r.note) left.appendChild(el('span', 'x', r.note));
  right.appendChild(el('span', 'pn', r.price || 'Price not shown'));
  if (r.storeMrp) right.appendChild(el('span', 'm', 'Store MRP ' + r.storeMrp));
  var a = linkTo(r, 'lk', 'Go to store'); if (a) right.appendChild(a);
  li.appendChild(left); li.appendChild(right); ul.appendChild(li);
}
function groupCard(g, hideNote) {
  var card = el('article', 'card'), low = g.rows.filter(function (r) { return r.isLowest; })[0];
  card.appendChild(el('h3', null, g.title));
  if (low) card.appendChild(bestBlock(low, U.savings(g.rows)));
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
  var box = $('results'); box.textContent = '';
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
    d.appendChild(sm);
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
function buildNow(seenAt) {
  var runs = allRuns(), snaps = runs.filter(function (r) { return r.snapshot; }).map(function (r) { return r.snapshot; });
  var res = SmartSetu.compareAny({ query: live.q, searches: snaps, products: [], seenAt: seenAt }), v = V.buildView(res, runs, seenAt);
  return { view: v, snaps: snaps.length };
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
function plan(q, only) {
  var kill = W.enabledMap(), pick = M.pick(q, R.STORES), enabled = {}, why = {}, skipped = [];
  kill.Croma = false;
  R.STORES.forEach(function (s) {
    var on = kill[s.label] !== false;
    if (on && pick.skip[s.key]) { why[s.label] = pick.skip[s.key]; skipped.push(s.label); on = false; }
    if (only) on = kill[s.label] !== false && only.indexOf(s.label) >= 0;
    enabled[s.label] = on;
  });
  return { enabled: enabled, why: only ? {} : why, skipped: skipped, pick: pick };
}

async function startRun(q, only) {
  if (busy) return;
  say(''); setBusy(true);
  var tabs = null, tabs2 = null, out = null, pl = plan(q, only), extra = !!only;
  var fr = SmartSetuFetchRead.make(NF.makeFetch(CapacitorHttp, C.desktopUa(navigator.userAgent)), SmartSetuSnapDoc.snapFromHtml);
  function late() { return Date.now() - live.t0 > 100000; }
  try {
    live.q = q; live.t0 = Date.now(); live.scrolled = extra; live.firstAt = 0;
    if (!extra) { live.runs = {}; skeleton(); $('morebox').hidden = true; initProgress(pl); }
    else { only.forEach(function (l) { if (pl.enabled[l]) setRow(l, 'wait', 'Waiting...', true); }); $('progress').classList.add('running'); maxDone = 0; refreshBar(); }
    retry = false;
    function opts(enabled) { return { query: q, enabled: enabled, foreground: false, rereads: 2, rereadMs: 2500, collect: smartsetuCollect, onUpdate: function (r) { updateProgress(r); adopt([r]); if (r.snapshot) liveRender(); }, maxTabs: 1, perStoreMs: 50000, retryTimeouts: false }; }
    var pass1 = Object.assign({}, pl.enabled); pass1.Myntra = false; // S20b: Myntra is read on its own after the others (card rescue, below), it does not hold up the rest
    var o1 = opts(pass1); o1.fetchFirst = SmartSetuFetchRead.STORES_OK; o1.fetchRead = fr; o1.fetchMs = 9000;
    tabs = W.createWebTabs(pluginApi(), { ready: true });
    out = await runStores(tabs, o1);
    adopt(out.runs);
    if (pl.enabled.Myntra) {
      say('Checking Myntra...');
      tabs2 = tabs2 || W.createWebTabs(pluginApi(C.desktopUa(navigator.userAgent)), { ready: true });
      var mr = await W.rescueRead(tabs2, storeOf('Myntra'), q, {});
      W.mergeRuns(out, { runs: [mr] }); updateProgress(mr); adopt([mr]); liveRender();
    }
    var notMyntra = function (l) { return l !== 'Myntra'; };
    var bad = W.failingLabels(out.runs).filter(notMyntra);
    if (bad.length) {
      say('Checking ' + bad.join(', ') + ' again...');
      retry = true;
      tabs2 = W.createWebTabs(pluginApi(C.desktopUa(navigator.userAgent)), { ready: true });
      W.mergeRuns(out, await runStores(tabs2, opts(W.enabledOnly(R.STORES, bad))));
      retry = false; adopt(out.runs); liveRender();
    }
    var slowL = late() ? [] : W.timedOutLabels(out.runs); // a store that timed out gets one more try with a long wait and scrolling (every store, D-073)
    if (slowL.length) {
      tabs2 = tabs2 || W.createWebTabs(pluginApi(C.desktopUa(navigator.userAgent)), { ready: true });
      for (var sl = 0; sl < slowL.length; sl++) {
        say('Still checking ' + slowL[sl] + '...');
        var sr = await W.slowRead(tabs2, storeOf(slowL[sl]), q, smartsetuCollect, {});
        W.mergeRuns(out, { runs: [sr] }); updateProgress(sr); adopt([sr]); liveRender();
      }
    }
    var empty = W.failingLabels(out.runs).filter(notMyntra); // a store that is still empty gets a card rescue read (every store, D-073)
    if (late()) empty = []; // the run has already taken long: show what is there instead of more tries
    if (empty.length) {
      tabs2 = tabs2 || W.createWebTabs(pluginApi(C.desktopUa(navigator.userAgent)), { ready: true });
      for (var em = 0; em < empty.length; em++) {
        say('Still checking ' + empty[em] + '...');
        var rr = await W.rescueRead(tabs2, storeOf(empty[em]), q, {});
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
  } catch (e) {
    say('Something went wrong, nothing was compared. Please try again.');
    if (!allRuns().length) { $('results').textContent = ''; $('empty').hidden = false; }
  } finally {
    if (live.timer) { clearTimeout(live.timer); live.timer = 0; }
    if (tabs) tabs.dispose(); if (tabs2) tabs2.dispose(); retry = false; $('progress').classList.remove('running'); setBusy(false);
  }
}

function onSubmit(ev) {
  ev.preventDefault();
  if (busy) return;
  var q = $('q').value.trim();
  if (!q) { say('Type what you want to buy, for example "boAt Airdopes 141".'); return; }
  startRun(q, null);
}

document.addEventListener('DOMContentLoaded', function () {
  $('form').addEventListener('submit', onSubmit);
  var qi = $('q'), qc = $('qclear');
  function syncClear() { qc.hidden = !qi.value; }
  qi.addEventListener('input', syncClear); qc.addEventListener('click', function () { qi.value = ''; syncClear(); qi.focus(); }); syncClear();
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
  Dev.attach({ trigger: $('logo'), isBusy: function () { return busy; }, setBusy: setBusy, query: function () { return $('q').value.trim(); }, version: VERSION, R: R, V: V, W: W, C: C, M: M, NF: NF, http: CapacitorHttp, pluginApi: pluginApi, collect: smartsetuCollect, SmartSetu: SmartSetu, SnapDoc: SmartSetuSnapDoc, fetchRead: SmartSetuFetchRead });
});
