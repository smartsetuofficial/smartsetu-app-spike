/* smartsetu app v0.3 (S14-1). Glue only: plugin calls + the Compare screen. The logic is in runner_core.js, view.js, bundle.js (same files as the Chrome extension)
 * and webtabs.js (tested in Node). Compare runs ONLY from the Compare button (D-010). Draws with textContent only. */
import { InAppBrowser, InvisibilityMode } from '@capgo/capacitor-inappbrowser';
var W = require('./webtabs.js');

var R = SmartSetuRunner, V = SmartSetuView, busy = false, plistItems = {};
function $(id) { return document.getElementById(id); }
function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function pluginApi() {
  return {
    open: function (o) {
      var opt = { url: o.url };
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
  var ul = $('plist'); ul.textContent = ''; plistItems = {}; var oldT = $('ptime'); if (oldT) oldT.remove();
  R.STORES.forEach(function (s) {
    var li = el('li'), st = el('span', 'st', kill[s.label] === false ? (W.OFF_TEXT[s.key] || 'Switched off') : 'Waiting...');
    li.appendChild(el('span', null, s.label)); li.appendChild(st); ul.appendChild(li); plistItems[s.label] = st;
  });
  $('progress').hidden = false;
}
function updateProgress(run) {
  var st = plistItems[run.store]; if (!st) return;
  var line = V.buildView({ query: {} }, [run]).stores[0];
  st.textContent = W.lineText(run, line.text);
  st.className = 'st ' + (run.state === 'ok' ? 'ok' : (run.state === 'off' || run.state === 'retrying' ? '' : 'bad'));
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

async function onSubmit(ev) {
  ev.preventDefault();
  if (busy) return;
  var q = $('q').value.trim();
  if (!q) { say('Type what you want to buy, for example "boAt Airdopes 141".'); return; }
  say(''); setBusy(true); $('results').textContent = '';
  var tabs = null;
  try {
    var kill = W.enabledMap();
    initProgress(kill);
    tabs = W.createWebTabs(pluginApi());
    var out = await R.runAll(tabs, { query: q, enabled: kill, foreground: false, rereads: 2, rereadMs: 2500, collect: smartsetuCollect, onUpdate: updateProgress, maxTabs: 1, perStoreMs: 50000, retryTimeouts: false });
    var tl = V.timeLine(out); if (tl) { var pt = el('p', 'note', tl); pt.id = 'ptime'; $('progress').appendChild(pt); }
    var res = SmartSetu.compareAny({ query: q, searches: out.snapshots, products: [], seenAt: out.seenAt });
    render(V.buildView(res, out.runs, out.seenAt));
  } catch (e) {
    say('Something went wrong, nothing was compared. Please try again.');
    $('empty').hidden = false;
  } finally { if (tabs) tabs.dispose(); setBusy(false); }
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
