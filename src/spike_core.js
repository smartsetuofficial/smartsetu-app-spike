/* smartsetu app-spike / spike_core v0.2 (S13-1, S13-2: reread, state report, visible/UA modes). TEST ONLY, not the product.
 * Reads ONE store search page in a hidden webview, one store after another (never in parallel), only when the owner taps the button.
 * The page is read with pagesnap.js (same file as the extension) and parsed with bundle.js parseSearch (same file as the extension).
 * No login, no cookies read, no storage, no network from here. Store list and URLs are copied from extension/runner_core.js (tab-only stores). */
'use strict';
var STORES = [
  { key: 'myntra', label: 'Myntra', url: function (q) { return 'https://www.myntra.com/' + encodeURIComponent(q.trim().replace(/\s+/g, '-')); } },
  { key: 'meesho', label: 'Meesho', url: function (q) { return 'https://www.meesho.com/search?q=' + encodeURIComponent(q); } },
  { key: 'tatacliq', label: 'Tata CLiQ', url: function (q) { return 'https://www.tatacliq.com/search/?searchCategory=all&text=' + encodeURIComponent(q); } }
];
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// Code that is injected into the store page: pagesnap source + a wrapper that sends the result back with window.mobileApp.postMessage.
// First a small 'meta' message (so a too-big payload can be told apart from a missing bridge), then the full 'snap'.
function buildInjectCode(pagesnapSrc, query, key) {
  return pagesnapSrc + '\n;(async function () {\n' +
    'var K = ' + JSON.stringify(key) + ';\n' +
    'function send(o) { try { window.mobileApp.postMessage({ detail: o }); } catch (e) {} }\n' +
    'try {\n' +
    '  var s = await smartsetuCollect(' + JSON.stringify(query) + ');\n' +
    '  send({ kind: "meta", key: K, cards: (s.cards || []).length, bytes: JSON.stringify(s).length, url: location.href, title: document.title });\n' +
    '  send({ kind: "snap", key: K, snap: s });\n' +
    '} catch (e) {\n' +
    '  send({ kind: "err", key: K, error: String((e && e.message) || e), url: location.href, title: document.title });\n' +
    '}\n})();\n';
}

function detailOf(ev) {
  if (ev && ev.detail && typeof ev.detail === 'object') return ev.detail;
  if (ev && typeof ev.rawMessage === 'string') { try { var j = JSON.parse(ev.rawMessage); return (j && j.detail) || j; } catch (_) {} }
  return null;
}

// Diagnostic only (no page text, no links): asks the page for its state so an empty result can be explained.
function buildDiagCode(key) {
  return ';(function () {\n' +
    'var K = ' + JSON.stringify(key) + ';\n' +
    'function send(o) { try { window.mobileApp.postMessage({ detail: o }); } catch (e) {} }\n' +
    'try {\n' +
    '  var pr = /^(?:Price\\s*:?\\s*)?(?:\\u20B9|Rs\\.?)\\s?\\d[\\d,]*(?:\\.\\d+)?\\.?$/i, n = 0, all = document.querySelectorAll("body *");\n' +
    '  for (var i = 0; i < all.length; i++) { if (all[i].children.length === 0 && pr.test((all[i].textContent || "").trim())) n++; }\n' +
    '  send({ kind: "diag", key: K, readyState: document.readyState, visibility: document.visibilityState, w: window.innerWidth, h: window.innerHeight, links: document.querySelectorAll("a[href]").length, priceLeaves: n, textLen: ((document.body && document.body.innerText) || "").length, url: location.href, title: document.title });\n' +
    '} catch (e) { send({ kind: "diag", key: K, error: String((e && e.message) || e) }); }\n' +
    '})();\n';
}
// Same shape as a Chrome Android user agent: the WebView marks ("; wv" and "Version/x.y") are removed. Derived from the real one, nothing invented.
function chromeUa(ua) { return String(ua || '').replace('; wv)', ')').replace(/ Version\/\d+(\.\d+)?/, ''); }

// api: { open({url, visible, ua}) -> id, exec({id, code}), close({id}), onMessage(fn) -> unsub, onLoaded(fn) -> unsub, parse(snap) -> parseSearch result }
// o: { pagesnapSrc, mode: 'hidden'|'visible'|'ua', ua, loadMs, settleMs, readMs, rereads, rereadMs, onStage(text) }
// General rule (D-073): a page that gives no cards is read again (o.rereads times, o.rereadMs apart) and, if still empty, described. Same for every store.
async function runStore(api, store, query, o) {
  var t0 = Date.now(), id = null, unsubM = null, unsubL = null, loaded = false, meta = null, stage = 'opening', waiter = null;
  var res = { key: store.key, store: store.label, state: 'error', ms: 0, mode: o.mode || 'hidden' };
  function st(s) { stage = s; if (o.onStage) o.onStage(store.label + ': ' + s); }
  function waitFor(kinds, ms) {
    return new Promise(function (resolve) {
      var timer = setTimeout(function () { waiter = null; resolve({ kind: 'timeout' }); }, ms);
      waiter = function (d) { if (kinds.indexOf(d.kind) < 0) return false; clearTimeout(timer); waiter = null; resolve(d); return true; };
    });
  }
  try {
    unsubM = await api.onMessage(function (ev) {
      var d = detailOf(ev);
      if (!d || d.key !== store.key) return;
      if (d.kind === 'meta') meta = d; else if (waiter) waiter(d);
    });
    unsubL = await api.onLoaded(function () { loaded = true; });
    st('opening ' + res.mode + ' page');
    id = await api.open({ url: store.url(query), visible: res.mode === 'visible', ua: res.mode === 'ua' ? chromeUa(o.ua) : null });
    st('loading');
    var t1 = Date.now(), loadMs = o.loadMs == null ? 30000 : o.loadMs;
    while (!loaded && Date.now() - t1 < loadMs) await sleep(100);
    res.loaded = loaded;
    st('settling');
    await sleep(o.settleMs == null ? 1500 : o.settleMs);
    var readMs = o.readMs == null ? 45000 : o.readMs, maxTries = 1 + (o.rereads > 0 ? o.rereads : 0), d2 = null, tries = 0;
    for (;;) {
      st('reading' + (tries ? ' again (' + (tries + 1) + ')' : ''));
      meta = null;
      var pending = waitFor(['snap', 'err'], readMs);
      await api.exec({ id: id, code: buildInjectCode(o.pagesnapSrc, query, store.key) });
      d2 = await pending; tries++;
      if (d2.kind === 'snap' && d2.snap && Array.isArray(d2.snap.cards) && d2.snap.cards.length) break;
      if (tries >= maxTries) break;
      st('empty, waiting before reading again');
      await sleep(o.rereadMs == null ? 3000 : o.rereadMs);
    }
    res.tries = tries;
    if (meta) { res.url = meta.url; res.title = meta.title; res.bytes = meta.bytes; res.pageCards = meta.cards; }
    if (d2.kind === 'timeout') {
      res.state = 'timeout'; res.stage = stage;
      res.reason = meta ? 'page was read (' + meta.cards + ' cards, ' + meta.bytes + ' bytes) but the full result never came back' : 'no message from the page (bridge missing, page blocked, or too slow)';
    } else if (d2.kind === 'err') {
      res.state = 'error'; res.reason = 'page script failed: ' + d2.error; res.url = d2.url; res.title = d2.title;
    } else {
      var snap = d2.snap, parsed = api.parse(snap);
      res.url = snap.url; res.title = snap.title; res.pageCards = (snap.cards || []).length;
      res.parsed = parsed.cards.length; res.parseStatus = parsed.status; res.skipped = parsed.skipped || {};
      res.first = parsed.cards.slice(0, 2).map(function (c) { return { title: c.title, priceNow: c.priceNow, mrp: c.mrp }; });
      res.state = parsed.cards.length ? 'ok' : 'no_listings';
      if (!parsed.cards.length) res.reason = res.pageCards ? 'page cards found but none parsed (' + parsed.status + ')' : 'no product cards on the page';
    }
    if (res.state !== 'ok' && res.state !== 'error') { // empty or stuck: ask for the page state (D-073, same for all stores)
      st('asking the page for its state');
      var dg = waitFor(['diag'], o.diagMs == null ? 8000 : o.diagMs);
      try { await api.exec({ id: id, code: buildDiagCode(store.key) }); } catch (_) {}
      var d3 = await dg;
      if (d3.kind === 'diag') res.diag = d3;
    }
  } catch (e) {
    res.state = 'error'; res.stage = stage; res.reason = String((e && e.message) || e);
  } finally {
    waiter = null;
    if (unsubM) { try { unsubM(); } catch (_) {} }
    if (unsubL) { try { unsubL(); } catch (_) {} }
    if (id != null) { try { await api.close({ id: id }); } catch (_) {} }
    res.ms = Date.now() - t0;
  }
  return res;
}

async function runAll(api, query, o) {
  var q = String(query || '').trim();
  if (!q) throw new Error('empty query');
  var out = [];
  for (var i = 0; i < STORES.length; i++) { var r = await runStore(api, STORES[i], q, o); out.push(r); if (o.onResult) o.onResult(r); }
  return out;
}

function describe(r) {
  var s = r.store + ': ' + (r.state === 'ok' ? 'OK, ' + r.parsed + ' listings read (page cards ' + r.pageCards + ')' : r.state.toUpperCase() + ' - ' + (r.reason || ''));
  s += ' [' + Math.round(r.ms / 1000) + ' s, ' + r.mode + ', load event ' + (r.loaded ? 'yes' : 'NO') + ', reads ' + (r.tries || 0) + ']';
  if (r.first && r.first.length) s += '\n   ' + r.first.map(function (c) { return (c.title || '?') + ' - Rs ' + c.priceNow; }).join('\n   ');
  if (r.state !== 'ok' && (r.url || r.title)) s += '\n   page: ' + (r.title || '?') + ' | ' + (r.url || '?');
  if (r.diag) { var d = r.diag; s += d.error ? '\n   state error: ' + d.error : '\n   state: ' + d.readyState + ', ' + d.visibility + ', ' + d.w + 'x' + d.h + ', links ' + d.links + ', price items ' + d.priceLeaves + ', text ' + d.textLen + ' chars'; }
  return s;
}

var api = { STORES: STORES, buildInjectCode: buildInjectCode, buildDiagCode: buildDiagCode, chromeUa: chromeUa, runStore: runStore, runAll: runAll, describe: describe, detailOf: detailOf };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
