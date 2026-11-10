/* smartsetu app v0.3 (S14-1). Glue only: plugin calls + the Compare screen. The logic is in runner_core.js, view.js, bundle.js (same files as the Chrome extension)
 * and webtabs.js (tested in Node). Compare runs ONLY from the Compare button (D-010). Draws with textContent only. */
import { InAppBrowser, InvisibilityMode } from '@capgo/capacitor-inappbrowser';
var W = require('./webtabs.js');
var C = require('./spike_core.js');
var U = require('./uihelp.js');

var R = SmartSetuRunner, V = SmartSetuView, busy = false, plistItems = {}, pstates = {}, maxDone = 0, retry = false, VERSION = '0.9.1';
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

function refreshBar() {
  var total = R.STORES.length, n = U.doneCount(pstates);
  if (n > maxDone) maxDone = n; // never goes backwards when a store is tried again
  $('pcount').textContent = maxDone + ' of ' + total + ' stores checked';
  $('pfill').style.width = Math.round(maxDone * 100 / total) + '%';
  $('pbar').setAttribute('aria-valuenow', String(maxDone));
  $('pbar').setAttribute('aria-valuemax', String(total));
}
function initProgress(kill) {
  var ul = $('plist'); ul.textContent = ''; plistItems = {}; pstates = {}; maxDone = 0; var oldT = $('ptime'); if (oldT) oldT.remove();
  R.STORES.forEach(function (s) {
    var off = kill[s.label] === false, li = el('li'), ic = el('span', 'ic ' + (off ? 'off' : 'wait')), nm = el('span', 'nm', s.label);
    var st = el('span', 'st' + (off ? ' off' : ''), off ? (W.OFF_TEXT[s.key] || 'Switched off') : 'Waiting...');
    ic.setAttribute('aria-hidden', 'true');
    li.appendChild(ic); li.appendChild(nm); li.appendChild(st); ul.appendChild(li);
    plistItems[s.label] = { ic: ic, st: st }; if (off) pstates[s.label] = 'off';
  });
  $('progress').classList.add('running'); $('progress').hidden = false; refreshBar();
}
function updateProgress(run) {
  if (retry && run.state === 'off') return; // second pass: stores that are not retried keep their first-pass line
  var it = plistItems[run.store]; if (!it) return;
  var line = V.buildView({ query: {} }, [run]).stores[0];
  var s = U.shortLine(run, W.lineText(run, line.text)), tag = run.slow ? '3rd try' : (retry && run.state !== 'off' ? '2nd try' : '');
  if (s.kind === 'skip') tag = ''; // a store skipped for a notice needs no try label
  it.st.textContent = (tag ? tag + ': ' : '') + s.text;
  it.st.className = 'st ' + s.kind; it.ic.className = 'ic ' + s.kind;
  pstates[run.store] = run.state; refreshBar();
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

function groupCard(g, hideNote) {
  var card = el('article', 'card'), h = el('h3', null, g.title);
  card.appendChild(h);
  if (g.label) card.appendChild(el('span', 'badge', g.label));
  if (g.note && !hideNote) card.appendChild(el('p', 'note', g.note));
  var ul = el('ul', 'rows');
  g.rows.forEach(function (r) { addRow(ul, r); });
  card.appendChild(ul); return card;
}

function render(view) {
  var box = $('results'); box.textContent = '';
  $('empty').hidden = true;
  box.appendChild(el('h2', null, view.headline));
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
  $('footnote').textContent = (view.seenAt ? 'Seen at ' + new Date(view.seenAt).toLocaleString() + '. ' : '') + view.footer;
  try { box.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) { /* older webview: stay where we are */ }
}

function storeOf(label) { return R.STORES.filter(function (s) { return s.label === label; })[0]; }

async function onSubmit(ev) {
  ev.preventDefault();
  if (busy) return;
  var q = $('q').value.trim();
  if (!q) { say('Type what you want to buy, for example "boAt Airdopes 141".'); return; }
  say(''); setBusy(true); $('results').textContent = '';
  var tabs = null, tabs2 = null, out = null, view = null;
  try {
    var kill = W.enabledMap();
    function opts(enabled) { return { query: q, enabled: enabled, foreground: false, rereads: 2, rereadMs: 2500, collect: smartsetuCollect, onUpdate: updateProgress, maxTabs: 1, perStoreMs: 50000, retryTimeouts: false }; }
    initProgress(kill); retry = false;
    tabs = W.createWebTabs(pluginApi());
    out = await R.runAll(tabs, opts(kill));
    var bad = W.failingLabels(out.runs);
    if (bad.length) {
      say('Checking ' + bad.join(', ') + ' again...');
      retry = true;
      tabs2 = W.createWebTabs(pluginApi(C.desktopUa(navigator.userAgent)));
      W.mergeRuns(out, await R.runAll(tabs2, opts(W.enabledOnly(R.STORES, bad))));
      retry = false;
    }
    var slowL = W.timedOutLabels(out.runs); // S14-1f: a store that timed out gets one more try with a long wait and scrolling (every store, D-073)
    if (slowL.length) {
      tabs2 = tabs2 || W.createWebTabs(pluginApi(C.desktopUa(navigator.userAgent)));
      for (var sl = 0; sl < slowL.length; sl++) {
        say('Checking ' + slowL[sl] + ' once more, it is slow...');
        var sr = await W.slowRead(tabs2, storeOf(slowL[sl]), q, smartsetuCollect, {});
        W.mergeRuns(out, { runs: [sr] }); updateProgress(sr);
      }
    }
    var empty = W.failingLabels(out.runs); // S14-1g (D-089): a store that is still empty gets a card rescue read (every store, D-073)
    if (empty.length) {
      tabs2 = tabs2 || W.createWebTabs(pluginApi(C.desktopUa(navigator.userAgent)));
      for (var em = 0; em < empty.length; em++) {
        say('Checking ' + empty[em] + ' one last way...');
        var rr = await W.rescueRead(tabs2, storeOf(empty[em]), q, {});
        if (rr.state === 'ok') { W.mergeRuns(out, { runs: [rr] }); updateProgress(rr); }
      }
    }
    var tl = V.timeLine(out); if (tl) { var pt = el('p', 'note', tl); pt.id = 'ptime'; $('progress').appendChild(pt); }
    var res = SmartSetu.compareAny({ query: q, searches: out.snapshots, products: [], seenAt: out.seenAt });
    view = V.buildView(res, out.runs, out.seenAt);
    render(view);
    say('');
  } catch (e) {
    say('Something went wrong, nothing was compared. Please try again.');
    $('empty').hidden = false;
  } finally { if (tabs) tabs.dispose(); if (tabs2) tabs2.dispose(); retry = false; $('progress').classList.remove('running'); setBusy(false); }
}

document.addEventListener('DOMContentLoaded', function () {
  $('form').addEventListener('submit', onSubmit);
  // A store link opens in the phone's own browser window (Chrome Custom Tab), not inside the app page.
  $('results').addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a) return;
    var u = safeUrl(a.href); if (!u) return;
    ev.preventDefault();
    InAppBrowser.open({ url: u });
  });
});
