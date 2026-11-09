/* smartsetu app v0.3 (S14-1). Glue only: plugin calls + the Compare screen. The logic is in runner_core.js, view.js, bundle.js (same files as the Chrome extension)
 * and webtabs.js (tested in Node). Compare runs ONLY from the Compare button (D-010). Draws with textContent only. */
import { InAppBrowser, InvisibilityMode } from '@capgo/capacitor-inappbrowser';
var W = require('./webtabs.js');
var C = require('./spike_core.js');

var R = SmartSetuRunner, V = SmartSetuView, busy = false, plistItems = {}, wt = null, diag = {}, struct = {}, retry = false, VERSION = '0.8.0', rep = { diag: [], struct: [], offers: [], rescue: [] };
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
function setBusy(b) { busy = b; $('go').disabled = b; $('go').textContent = b ? 'Comparing...' : 'Compare'; }

function initProgress(kill) {
  var ul = $('plist'); ul.textContent = ''; plistItems = {}; var oldT = $('ptime'); if (oldT) oldT.remove(); var oldD = $('pdiag'); if (oldD) oldD.remove(); var oldO = $('poffers'); if (oldO) oldO.remove(); $('report').hidden = true;
  R.STORES.forEach(function (s) {
    var li = el('li'), st = el('span', 'st', kill[s.label] === false ? (W.OFF_TEXT[s.key] || 'Switched off') : 'Waiting...');
    li.appendChild(el('span', null, s.label)); li.appendChild(st); ul.appendChild(li); plistItems[s.label] = st;
  });
  $('progress').hidden = false;
}
function updateProgress(run) {
  if (retry && run.state === 'off') return; // second pass: stores that are not retried keep their first-pass line
  var st = plistItems[run.store]; if (!st) return;
  var line = V.buildView({ query: {} }, [run]).stores[0];
  st.textContent = (run.slow ? '3rd try (long wait): ' : retry && run.state !== 'off' ? '2nd try: ' : '') + W.lineText(run, line.text);
  st.className = 'st ' + (run.state === 'ok' ? 'ok' : (run.state === 'off' || run.state === 'retrying' ? '' : 'bad'));
  if (run.state === 'ok') delete diag[run.store];
  if (wt && (run.state === 'no_cards' || run.state === 'no_data' || run.state === 'error')) { var pr = wt.lastProbe(); diag[run.store] = pr ? pr.d : null; }
}

// Test-build diagnostic (D-082): shown only on this screen, never stored or sent.
function showDiag() {
  var names = Object.keys(diag); if (!names.length && !Object.keys(struct).length) return;
  var box = el('div'); box.id = 'pdiag';
  box.appendChild(el('h3', null, 'Diagnostic (test build, shown only here)'));
  names.forEach(function (n) { W.diagLines(n, diag[n]).forEach(function (l) { rep.diag.push(l); box.appendChild(el('p', 'note', l)); }); });
  Object.keys(struct).forEach(function (n) { W.structLines(n, struct[n]).forEach(function (l) { rep.struct.push(l); box.appendChild(el('p', 'note', l)); }); });
  $('progress').appendChild(box);
}

function safeUrl(u) { try { var x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch (_) { return null; } }

function addRow(ul, r) {
  var li = el('li', r.isLowest ? 'low' : null);
  li.appendChild(el('span', 's', r.store));
  li.appendChild(el('span', 't', r.title));
  var p = el('span', 'p', r.price || 'Price not shown');
  if (r.storeMrp) p.appendChild(el('span', 'm', 'Store MRP ' + r.storeMrp));
  li.appendChild(p);
  var x = el('span', 'x'), href = safeUrl(r.url);
  if (r.note) x.appendChild(document.createTextNode(r.note + '. '));
  if (href) { var a = el('a', null, 'Go to store'); a.href = href; a.rel = 'noopener noreferrer'; x.appendChild(a); }
  li.appendChild(x); ul.appendChild(li);
}

function render(view) {
  var box = $('results'); box.textContent = '';
  $('empty').hidden = true;
  box.appendChild(el('h2', null, view.headline));
  if (view.note) box.appendChild(el('p', 'note', view.note));
  if (view.top) {
    var tc = el('article', 'card toplow'), tu = el('ul', 'rows');
    tc.appendChild(el('h3', null, view.top.title)); tc.appendChild(el('p', 'note', view.top.note));
    view.top.rows.forEach(function (r) { addRow(tu, r); });
    tc.appendChild(tu); box.appendChild(tc);
  }
  view.groups.forEach(function (g) {
    var card = el('article', 'card'), h = el('h3', null, g.title);
    if (g.label) h.appendChild(el('span', 'badge', g.label));
    card.appendChild(h);
    if (g.note) card.appendChild(el('p', 'note', g.note));
    var ul = el('ul', 'rows');
    g.rows.forEach(function (r) { addRow(ul, r); });
    card.appendChild(ul); box.appendChild(card);
  });
  $('footnote').textContent = (view.seenAt ? 'Seen at ' + new Date(view.seenAt).toLocaleString() + '. ' : '') + view.footer;
}

function storeOf(label) { return R.STORES.filter(function (s) { return s.label === label; })[0]; }

// Test build (D-083): one product page per store that read listings, offer-like text lines only. Shown only on this screen, never stored or sent.
async function readOffers(out, q, tabs, tabs2, view) {
  var box = el('div'); box.id = 'poffers';
  box.appendChild(el('h3', null, 'Offers read from product pages (test build, shown only here)'));
  $('progress').appendChild(box);
  var todo = out.runs.filter(function (r) { return r.state === 'ok' && r.snapshot; });
  for (var i = 0; i < todo.length; i++) {
    var r = todo[i], st = storeOf(r.store), lines;
    say('Reading offers: ' + r.store + ' (' + (i + 1) + ' of ' + todo.length + ')...');
    var pick = st ? W.pickFromView(view, r.store, st.url(q)) : null;
    if (!pick) lines = [r.store + ': offers not read (no listing of this store matched the search, so no product page was opened)'];
    else {
      var tb = r.retried && tabs2 ? tabs2 : tabs, rd = await W.readPage(tb, pick.url, W.offerProbe, { settleMs: 3000 });
      if (!rd.ok) rd = await W.readPage(tb, pick.url, W.offerProbe, { settleMs: 6000 }); // one more try for a slow page
      lines = W.offerLines(r.store, pick.url, rd);
    }
    lines.forEach(function (l) { rep.offers.push(l); box.appendChild(el('p', 'note', l)); });
  }
}

// S14-1e (test build): one text report of the whole run, copied only when the owner taps the button. Nothing is sent by the app.
function showReport(q, out, view, err, t0) {
  var box = $('report'); if (!box) return;
  var text = W.buildReport({ version: VERSION, query: q, seenAt: out && out.seenAt ? new Date(out.seenAt).toLocaleString() : '', totalS: Math.round((Date.now() - t0) / 1000), ua: (/Chrome\/[\d.]+/.exec(navigator.userAgent) || ['?'])[0], runs: out ? out.runs : [], rows: view ? W.rowsOf(view) : [], listings: W.listingLines(out ? out.runs : [], view ? W.rowsOf(view) : [], SmartSetu.parseSearch), diag: rep.diag, struct: rep.struct, rescue: rep.rescue, offers: rep.offers, error: err });
  $('reptext').value = text; $('repmsg').textContent = 'Tap Copy, then paste the whole report in the chat. Nothing is sent by the app.'; box.hidden = false;
}
function copyReport() {
  var ta = $('reptext'), msg = $('repmsg'), t = ta.value, hint = 'Could not copy by itself. Press and hold inside the box, choose Select all, then Copy.';
  function fallback() {
    try { ta.focus(); ta.select(); ta.setSelectionRange(0, t.length); msg.textContent = document.execCommand && document.execCommand('copy') ? 'Copied. Paste it in the chat.' : hint; } catch (_) { msg.textContent = hint; }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { msg.textContent = 'Copied. Paste it in the chat.'; }, fallback); else fallback();
}

async function onSubmit(ev) {
  ev.preventDefault();
  if (busy) return;
  var q = $('q').value.trim();
  if (!q) { say('Type what you want to buy, for example "boAt Airdopes 141".'); return; }
  say(''); setBusy(true); $('results').textContent = '';
  var tabs = null, tabs2 = null, out = null, view = null, err = null, t0 = Date.now();
  rep = { diag: [], struct: [], offers: [], rescue: [] };
  try {
    var kill = W.enabledMap();
    function opts(enabled) { return { query: q, enabled: enabled, foreground: false, rereads: 2, rereadMs: 2500, collect: smartsetuCollect, onUpdate: updateProgress, maxTabs: 1, perStoreMs: 50000, retryTimeouts: false }; }
    initProgress(kill); diag = {}; struct = {}; retry = false;
    tabs = W.createWebTabs(pluginApi(), { probe: true }); wt = tabs;
    out = await R.runAll(tabs, opts(kill));
    var bad = W.failingLabels(out.runs);
    if (bad.length) {
      say('Second try for ' + bad.join(', ') + ' with a desktop identity...');
      retry = true;
      tabs2 = W.createWebTabs(pluginApi(C.desktopUa(navigator.userAgent)), { probe: true }); wt = tabs2;
      W.mergeRuns(out, await R.runAll(tabs2, opts(W.enabledOnly(R.STORES, bad))));
      retry = false;
      var still = W.failingLabels(out.runs);
      for (var k = 0; k < still.length; k++) {
        say('Reading page structure: ' + still[k] + '...');
        struct[still[k]] = await W.readPage(tabs2, storeOf(still[k]).url(q), W.structureProbe, { settleMs: 4000 });
      }
    }
    var slowL = W.timedOutLabels(out.runs); // S14-1f: a store that timed out gets one more try with a long wait and scrolling (every store, D-073)
    if (slowL.length) {
      tabs2 = tabs2 || W.createWebTabs(pluginApi(C.desktopUa(navigator.userAgent)), { probe: true }); wt = tabs2;
      for (var sl = 0; sl < slowL.length; sl++) {
        say('Third try for ' + slowL[sl] + ': long wait and scrolling...');
        var sr = await W.slowRead(tabs2, storeOf(slowL[sl]), q, smartsetuCollect, {});
        W.mergeRuns(out, { runs: [sr] }); updateProgress(sr);
      }
      var still2 = W.failingLabels(out.runs);
      for (var k2 = 0; k2 < still2.length; k2++) {
        if (struct[still2[k2]]) continue;
        say('Reading page structure: ' + still2[k2] + '...');
        struct[still2[k2]] = await W.readPage(tabs2, storeOf(still2[k2]).url(q), W.structureProbe, { settleMs: 4000 });
      }
    }
    var empty = W.failingLabels(out.runs); // S14-1g (D-089): a store that is still empty gets a card rescue read (every store, D-073)
    if (empty.length) {
      tabs2 = tabs2 || W.createWebTabs(pluginApi(C.desktopUa(navigator.userAgent)), { probe: true }); wt = tabs2;
      for (var em = 0; em < empty.length; em++) {
        say('Card rescue for ' + empty[em] + '...');
        var rr = await W.rescueRead(tabs2, storeOf(empty[em]), q, {});
        W.rescueLines(empty[em], rr).forEach(function (l) { rep.rescue.push(l); });
        if (rr.state === 'ok') { W.mergeRuns(out, { runs: [rr] }); updateProgress(rr); }
      }
    }
    var tl = V.timeLine(out); if (tl) { var pt = el('p', 'note', tl); pt.id = 'ptime'; $('progress').appendChild(pt); }
    var res = SmartSetu.compareAny({ query: q, searches: out.snapshots, products: [], seenAt: out.seenAt });
    view = V.buildView(res, out.runs, out.seenAt);
    render(view);
    showDiag();
    await readOffers(out, q, tabs, tabs2, view);
    say('');
  } catch (e) {
    err = String((e && e.message) || e);
    say('Something went wrong, nothing was compared. Please try again.');
    $('empty').hidden = false;
  } finally { if (tabs) tabs.dispose(); if (tabs2) tabs2.dispose(); retry = false; try { showReport(q, out, view, err, t0); } catch (_) {} setBusy(false); }
}

document.addEventListener('DOMContentLoaded', function () {
  $('form').addEventListener('submit', onSubmit);
  $('copyrep').addEventListener('click', copyReport);
  // A store link opens in the phone's own browser window (Chrome Custom Tab), not inside the app page.
  $('results').addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a) return;
    var u = safeUrl(a.href); if (!u) return;
    ev.preventDefault();
    InAppBrowser.open({ url: u });
  });
});
