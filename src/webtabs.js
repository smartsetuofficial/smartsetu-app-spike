/* smartsetu app / webtabs v1 (S14-1). Gives runner_core.js (the same file the Chrome extension uses) a chrome-like "tabs + scripting" object that is backed by the
 * hidden webview plugin. One store after another (the runner is started with maxTabs 1). Nothing is stored, no cookies or login are read, no network from here.
 * api for the plugin: { open({url, visible}) -> id, exec({id, code}), close({id}), onMessage(fn) -> Promise(unsub), onLoaded(fn) -> Promise(unsub) } */
'use strict';

function detailOf(ev) {
  if (ev && ev.detail && typeof ev.detail === 'object') return ev.detail;
  if (ev && typeof ev.rawMessage === 'string') { try { var j = JSON.parse(ev.rawMessage); return (j && j.detail) || j; } catch (_) {} }
  return null;
}

// Stores that are not read on the phone yet (shown honestly on the screen, D-078, D-081). Key = runner_core store key, label = runner_core store label.
var OFF_TEXT = { myntra: 'No data on the phone app yet' };
var NOCARDS_NOTE = { croma: "Croma's page asks for a pincode, so no products were shown." }; // seen on the page (V-242); the cause of the empty result stays unverified (V-243)
function enabledMap() { return { Myntra: false }; }
// view.js gives the store line text; the app adds the plain reason for a store that is off and the short error for a store that failed.
function lineText(run, text) {
  text = String(text).replace(/(hidden|visible) tab/g, '$1 page'); // view.js says tab, the app has pages
  if (run && run.state === 'off' && OFF_TEXT[run.key]) return OFF_TEXT[run.key];
  if (run && run.state === 'error' && run.error) return text + ' (' + String(run.error).replace(/\s+/g, ' ').slice(0, 90) + ')';
  if (run && run.state === 'no_cards' && NOCARDS_NOTE[run.key]) return text + '. ' + NOCARDS_NOTE[run.key];
  return text;
}

// Test-build diagnostic (D-082): what the page itself shows for a store that gave no listings. Shown only on the owner's screen, never stored or sent. Remove before the release APK.
var PROBE_SRC = 'function probeNow() { try { var t = String((document.body && document.body.innerText) || "").replace(/\\s+/g, " ").trim().slice(0, 200); return { title: String(document.title || "").slice(0, 100), url: String(location.href).slice(0, 200), text: t, items: document.querySelectorAll(\'[class*="rice"]\').length }; } catch (e) { return { error: String((e && e.message) || e) }; } }\n';
function diagLines(label, d) {
  if (!d) return [label + ': no page data came back'];
  if (d.error) return [label + ': ' + String(d.error).slice(0, 100)];
  return [label, 'Title: ' + (d.title || '(none)'), 'Page: ' + (d.url || '(none)'), 'Price-like items: ' + (Number(d.items) || 0), 'Text: ' + (d.text || '(none)')];
}

// Page function (self-contained, runs inside the store page): how many price amounts the page text shows right now. Reads nothing else, sends nothing.
function readyCount() { try { var t = String((document.body && document.body.innerText) || ''), m = t.match(/(?:\u20b9|Rs\.?)\s?\d[\d,]*/g); return m ? m.length : 0; } catch (e) { return 0; } }

function createWebTabs(plugin, o) {
  o = o || {};
  var execMs = o.execMs == null ? 45000 : o.execMs;
  // S15b (D-097, ALL stores): o.ready = true. A page whose load event never comes (Tata CLiQ on the phone, 'load event NO', V-212; Ajio and others sometimes) is not waited for the full limit: when the page text shows at least readyMin price amounts and the count stays the same on two checks in a row, the tab counts as complete. The real load event, when it comes first, wins. Without o.ready nothing changes.
  var readyOn = o.ready === true, readyAfter = o.readyAfterMs == null ? 3000 : o.readyAfterMs, readyEvery = o.readyEveryMs == null ? 1500 : o.readyEveryMs, readyMin = o.readyMin == null ? 6 : o.readyMin, readyProbeMs = o.readyProbeMs == null ? 3000 : o.readyProbeMs, readyStops = {}, earlyIds = {};
  var listeners = [], pending = {}, loaded = {}, current = null, opening = false, earlyLoad = false, seq = 0, unsubs = [], inited = null, probe = o.probe === true, lastProbe = null, opened = {};

  function onMsg(ev) {
    var d = detailOf(ev); if (!d || !d.cid) return;
    var p = pending[d.cid]; if (!p) return;
    if (d.kind === 'exec_ack') { p.acked = true; return; }
    if (d.kind === 'probe') { lastProbe = { tabId: p.tabId, d: d.d }; return; }
    if (d.kind !== 'exec') return;
    delete pending[d.cid]; clearTimeout(p.timer);
    if (d.ok) p.resolve([{ result: d.result }]); else p.reject(new Error(d.error || 'page script failed'));
  }
  function onLoad() {
    if (opening) { earlyLoad = true; return; } // the page finished loading before the plugin gave back the id
    if (current == null) return;
    loaded[current] = true;
    listeners.slice().forEach(function (l) { try { l(current, { status: 'complete' }); } catch (_) {} });
  }
  function init() {
    if (!inited) inited = Promise.all([plugin.onMessage(onMsg), plugin.onLoaded(onLoad)]).then(function (u) { unsubs = u; });
    return inited;
  }
  function failPending(tabId, why) {
    Object.keys(pending).forEach(function (k) { var p = pending[k]; if (tabId == null || p.tabId === tabId) { delete pending[k]; clearTimeout(p.timer); p.reject(new Error(why)); } });
  }

  function stopReady(id) { var f = readyStops[id]; if (f) { delete readyStops[id]; f(); } }
  function startReady(id) {
    var last = -1, stopped = false, timer = null;
    readyStops[id] = function () { stopped = true; clearTimeout(timer); };
    function next() { if (!stopped) timer = setTimeout(step, readyEvery); }
    function step() {
      if (stopped || loaded[id]) { stopReady(id); return; }
      var done = false, guard = setTimeout(function () { if (!done) { done = true; next(); } }, readyProbeMs); // a probe that gets no answer never blocks the next one
      scripting.executeScript({ target: { tabId: id }, func: readyCount }).then(function (r) {
        if (done) return; done = true; clearTimeout(guard);
        if (stopped || loaded[id]) { stopReady(id); return; }
        var n = Number(r && r[0] && r[0].result) || 0, steady = n >= readyMin && n === last; last = n;
        if (steady) { loaded[id] = true; earlyIds[id] = 1; stopReady(id); listeners.slice().forEach(function (l) { try { l(id, { status: 'complete' }); } catch (_) {} }); return; }
        next();
      }, function () { if (done) return; done = true; clearTimeout(guard); next(); });
    }
    timer = setTimeout(step, readyAfter);
  }

  var tabs = {
    create: function (spec) {
      return init().then(function () {
        opening = true; earlyLoad = false; lastProbe = null;
        return Promise.resolve(plugin.open({ url: spec.url, visible: !!spec.active })).then(function (id) {
          current = id; loaded[id] = earlyLoad; opening = false; if (id != null) opened[id] = 1;
          if (readyOn && id != null && !earlyLoad) startReady(id);
          return { id: id, status: earlyLoad ? 'complete' : 'loading' };
        }, function (e) { opening = false; throw e; });
      });
    },
    get: function (id) { return Promise.resolve({ id: id, status: loaded[id] ? 'complete' : 'loading' }); },
    remove: function (id) {
      failPending(id, 'tab closed'); stopReady(id);
      if (current === id) current = null;
      delete loaded[id]; delete opened[id];
      return Promise.resolve(plugin.close({ id: id }));
    },
    onUpdated: {
      addListener: function (fn) { listeners.push(fn); },
      removeListener: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }
    }
  };

  var scripting = {
    executeScript: function (spec) {
      var func = spec && spec.func, args = (spec && spec.args) || [], tabId = spec && spec.target && spec.target.tabId;
      if (typeof func !== 'function') return Promise.reject(new Error('func missing'));
      var cid = 'c' + (++seq);
      var code = '(async function () {\n' +
        'var C = ' + JSON.stringify(cid) + ';\n' +
        'function send(o) { try { window.mobileApp.postMessage({ detail: o }); } catch (e) {} }\n' +
        (probe ? PROBE_SRC : '') +
        'send({ kind: "exec_ack", cid: C });\n' +
        'try {\n' +
        '  var r = await (' + func.toString() + ').apply(null, ' + JSON.stringify(args) + ');\n' +
        (probe ? '  send({ kind: "probe", cid: C, d: probeNow() });\n' : '') +
        '  send({ kind: "exec", cid: C, ok: true, result: r === undefined ? null : r });\n' +
        '} catch (e) {\n' +
        (probe ? '  send({ kind: "probe", cid: C, d: probeNow() });\n' : '') +
        '  send({ kind: "exec", cid: C, ok: false, error: String((e && e.message) || e) });\n' +
        '}\n})();\n';
      return init().then(function () {
        return new Promise(function (resolve, reject) {
          var p = { tabId: tabId, resolve: resolve, reject: reject, acked: false, timer: null };
          p.timer = setTimeout(function () {
            delete pending[cid];
            reject(new Error(p.acked ? 'page started but its answer did not come back in time' : 'no answer from the page (bridge missing or page too slow)'));
          }, execMs);
          pending[cid] = p;
          Promise.resolve().then(function () { return plugin.exec({ id: tabId, code: code }); }).catch(function (e) {
            if (pending[cid]) { delete pending[cid]; clearTimeout(p.timer); reject(e); }
          });
        });
      });
    }
  };

  function dispose() {
    failPending(null, 'closed'); Object.keys(readyStops).forEach(stopReady);
    Object.keys(opened).forEach(function (k) { try { Promise.resolve(plugin.close({ id: k })).catch(function () {}); } catch (_) {} }); opened = {}; // S14-1d: no page is left open after a run
    unsubs.forEach(function (u) { try { if (typeof u === 'function') u(); } catch (_) {} });
    unsubs = []; inited = null; listeners = [];
  }
  return { tabs: tabs, scripting: scripting, dispose: dispose, lastProbe: function () { return lastProbe; }, earlyCount: function () { return Object.keys(earlyIds).length; } };
}

// ---- S14-1c data build (D-083): second try with a Chrome identity, page structure of still-empty stores, offers read from one product page per store.
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function sameSite(a, b) { var x = String(a).toLowerCase().split('.').slice(-2).join('.'), y = String(b).toLowerCase().split('.').slice(-2).join('.'); return x === y; }
function failingLabels(runs) { return (runs || []).filter(function (r) { return r.state === 'no_cards' || r.state === 'no_data'; }).map(function (r) { return r.store; }); }
function enabledOnly(stores, labels) { var m = {}; stores.forEach(function (s) { m[s.label] = labels.indexOf(s.label) >= 0; }); return m; }
// Put the runs of the second pass into the first result (same store label), then rebuild the snapshot list. Stores that were off in the second pass are skipped.
function mergeRuns(out, out2) {
  (out2.runs || []).forEach(function (r2) {
    if (r2.state === 'off') return;
    for (var i = 0; i < out.runs.length; i++) if (out.runs[i].store === r2.store) { r2.retried = true; out.runs[i] = r2; }
  });
  out.snapshots = out.runs.filter(function (r) { return r.snapshot; }).map(function (r) { return r.snapshot; });
  return out;
}
// First usable listing of a store: not an ad, https, same site as the search page, the one that contains the first word of the query wins.
function pickProduct(cards, query, searchUrl) {
  var base; try { base = new URL(searchUrl); } catch (_) { return null; }
  var word = String(query || '').toLowerCase().split(/\s+/)[0] || '', best = null;
  (cards || []).forEach(function (c) {
    if (!c || c.ad || c.sponsored || !c.link) return;
    var u; try { u = new URL(c.link, base); } catch (_) { return; }
    if (u.protocol !== 'https:' || !sameSite(u.hostname, base.hostname)) return;
    var rel = !!word && String(c.html || '').toLowerCase().indexOf(word) >= 0;
    if (!best || (rel && !best.rel)) best = { url: u.href, rel: rel };
  });
  return best ? { url: best.url } : null;
}
// S14-1d: the offers are read only from a listing that really matched the search (a row of the result), never from the first card of the store page.
function rowsOf(view) {
  var rows = [];
  if (view && view.top && view.top.rows) rows = rows.concat(view.top.rows);
  ((view && view.groups) || []).forEach(function (g) { rows = rows.concat((g && g.rows) || []); });
  return rows;
}
function pickFromView(view, label, searchUrl) {
  var base; try { base = new URL(searchUrl); } catch (_) { return null; }
  var rows = rowsOf(view);
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i]; if (!r || !r.url || String(r.store).toLowerCase() !== String(label).toLowerCase()) continue;
    var u; try { u = new URL(r.url, base); } catch (_) { continue; }
    if (u.protocol === 'https:' && sameSite(u.hostname, base.hostname)) return { url: u.href };
  }
  return null;
}
// Open one page, wait, run one page function, always close. Never throws.
async function readPage(wt, url, func, o) {
  o = o || {};
  var loadMs = o.loadMs == null ? 30000 : o.loadMs, settleMs = o.settleMs == null ? 3000 : o.settleMs, id = null;
  try {
    var t = await wt.tabs.create({ url: url, active: false }); id = t.id;
    var t0 = Date.now();
    while (Date.now() - t0 < loadMs) { var g = await wt.tabs.get(id); if (g.status === 'complete') break; await sleep(250); }
    await sleep(settleMs);
    var r = await wt.scripting.executeScript({ target: { tabId: id }, func: func, args: o.args || [] });
    return { ok: true, result: r && r[0] ? r[0].result : null };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    if (id != null) { try { await wt.tabs.remove(id); } catch (_) {} }
  }
}
// Page functions (self-contained, they run inside the store page). They only read text that is on the page.
async function offerProbe() {
  // Offer-like lines only (S14-1d): bank/card/EMI/cashback/coupon words or a saving amount. Prose (reviews, descriptions) is dropped, nothing is stored or sent.
  var rxBtn = /^(view |see |all |more |show )?(bank |all )?(offers?|coupons?)( (&|and) discounts?)?( \(\d+\))?$|view all offers|view more offers|see all offers|\+\s?\d+ (more )?offers?|^\d+ offers?$|more offers?/i;
  var info = /\b(bank|credit cards?|debit cards?|cards?|upi|wallet|cashback|coupons?|emi|instant discount|no cost)\b/i;
  var money = /(\u20b9|rs\.?\s?)\s?\d|\d\s?%/i;
  var saveAmt = /\bsave\s+(up ?to\s+)?(\u20b9|rs\.?\s?)?\d/i;
  var offerWord = /\b(off|discount|savings?|offers?|extra|flat|upto|up to)\b/i;
  function keep(s) {
    if (s.length < 6 || s.length > 140) return false;
    if (s.split(' ').length > 16) return false;
    if (/[.!?]\s+[A-Z]/.test(s)) return false;
    return info.test(s) || saveAmt.test(s) || (money.test(s) && offerWord.test(s));
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var clicked = 0;
  try {
    var btns = document.querySelectorAll('button, [role="button"], summary, a, [tabindex]');
    for (var i = 0; i < btns.length && clicked < 3; i++) {
      var tx = String(btns[i].innerText || btns[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (!(tx.length > 0 && tx.length < 40 && rxBtn.test(tx))) continue;
      if (String(btns[i].tagName || '').toUpperCase() === 'A') { var h = btns[i].getAttribute ? btns[i].getAttribute('href') : null; if (h && h !== '#' && !/^javascript/i.test(h)) continue; }
      try { btns[i].click(); clicked++; await wait(900); } catch (e) {}
    }
  } catch (e) {}
  var t = String((document.body && (document.body.innerText || document.body.textContent)) || ''), seen = {}, out = [];
  t.split(/\n+/).forEach(function (s) {
    s = s.replace(/\s+/g, ' ').trim();
    if (seen[s] || !keep(s)) return;
    seen[s] = 1; out.push(s);
  });
  return { title: String(document.title || '').slice(0, 100), url: String(location.href).slice(0, 200), clicked: clicked, total: out.length, lines: out.slice(0, 40) };
}
async function structureProbe() {
  // S14-1e: one read answers every open question about an empty store (same page function for every store, D-073). Only counts, tag/class names and short text; nothing is stored or sent.
  function cls(e) { return String(e.tagName || '').toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/)[0].slice(0, 40) : ''); }
  var priceRx = /^\s*\u20b9\s?[\d,]{3,}/;
  function grab() {
    var all = document.querySelectorAll('body *'), leaves = [], n = 0;
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (e.children && e.children.length === 0 && priceRx.test(e.textContent || '')) { n++; if (leaves.length < 3) leaves.push(e); }
    }
    var samples = leaves.map(function (leaf) {
      var chain = [cls(leaf)], a = leaf.parentElement, link = null;
      for (var k = 0; k < 14 && a; k++) {
        chain.push(cls(a));
        link = a.querySelector ? a.querySelector('a[href]') : null;
        if (link && String(a.textContent || '').length < 400) break;
        link = null; a = a.parentElement;
      }
      return { price: String(leaf.textContent || '').trim().slice(0, 20), chain: chain.join(' < '), href: link ? String(link.getAttribute('href') || '').slice(0, 90) : '', text: a ? String(a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100) : '' };
    });
    return { all: all, leaves: leaves, n: n, samples: samples };
  }
  function bodyText() { try { return String((document.body && (document.body.innerText || document.body.textContent)) || ''); } catch (e) { return ''; } }
  function skel(e, d, st) {
    if (!e || st.n >= 30 || d > 4) return '';
    st.n++;
    var at = [], as2 = e.attributes || [];
    try { for (var i2 = 0; i2 < as2.length && at.length < 6; i2++) { var nm = as2[i2].name; if (nm !== 'class' && nm !== 'style') at.push(nm); } } catch (x) {}
    var kids = e.children || [], parts = [];
    for (var k2 = 0; k2 < kids.length && k2 < 6; k2++) { var c = skel(kids[k2], d + 1, st); if (c) parts.push(c); }
    return cls(e) + (at.length ? '[' + at.join(',') + ']' : '') + (parts.length ? '(' + parts.join(' ') + ')' : '');
  }
  var g0 = grab(), all = g0.all;
  var ls = [], as = document.querySelectorAll('a[href]');
  for (var j = 0; j < as.length && ls.length < 4; j++) { var h = String(as[j].getAttribute('href') || ''); if (h.length > 1 && h.charAt(0) !== '#') ls.push(h.slice(0, 80) + ' "' + String(as[j].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30) + '"'); }
  var emptyHref = 0, clickable = 0, shadow = 0, frames = 0;
  try {
    for (var q = 0; q < all.length; q++) {
      var e2 = all[q], tg = String(e2.tagName || '').toUpperCase();
      if (tg === 'IFRAME') frames++;
      if (e2.shadowRoot) shadow++;
      if (e2.getAttribute) {
        if (tg === 'A') { var hh = e2.getAttribute('href'); if (hh == null || hh === '' || hh === '#' || /^javascript/i.test(hh)) emptyHref++; }
        if (e2.getAttribute('onclick') != null || e2.getAttribute('data-href') != null || e2.getAttribute('data-url') != null || e2.getAttribute('role') === 'link') clickable++;
      }
    }
  } catch (e) {}
  var txt = bodyText(), low = txt.toLowerCase(), marks = [], mk = ['captcha', 'access denied', 'verify you are human', 'unusual traffic', 'robot', 'blocked', 'pincode', 'pin code', 'select location', 'enable cookies', 'something went wrong', 'no results'];
  for (var m = 0; m < mk.length; m++) if (low.indexOf(mk[m]) >= 0) marks.push(mk[m]);
  var hints = { productClass: 0, images: 0, loading: 0 };
  try {
    hints.productClass = document.querySelectorAll('[class*="product"], [class*="plp"], [class*="card"]').length;
    hints.images = document.querySelectorAll('img').length;
    hints.loading = document.querySelectorAll('[class*="skeleton"], [class*="shimmer"], [class*="loader"], [class*="spinner"]').length;
  } catch (e) {}
  var sk = '';
  try { var sb = g0.leaves[0]; for (var u = 0; u < 6 && sb && sb.parentElement; u++) sb = sb.parentElement; if (sb) sk = skel(sb, 0, { n: 0 }).slice(0, 700); } catch (e) {}
  var sc = [], after = null;
  try {
    if (typeof window !== 'undefined' && window.scrollTo && document.body) {
      for (var s = 0; s < 3; s++) {
        window.scrollTo(0, document.body.scrollHeight || 100000);
        await new Promise(function (r) { setTimeout(r, 1500); });
        var gs = grab();
        sc.push({ leaves: gs.n, anchors: document.querySelectorAll('a[href]').length, text: bodyText().length, height: Number(document.body.scrollHeight) || 0 });
        if (g0.n === 0 && gs.n > 0) after = { priceLeaves: gs.n, samples: gs.samples };
      }
    }
  } catch (e) {}
  return { anchors: as.length, priceLeaves: g0.n, samples: g0.samples, linkSamples: ls, textLen: txt.length, emptyHref: emptyHref, clickable: clickable, shadow: shadow, frames: frames, markers: marks, hints: hints, skeleton: sk, scroll: sc, after: after };
}
function shortUrl(u) { try { var x = new URL(u); return (x.hostname + x.pathname).slice(0, 120); } catch (_) { return String(u).slice(0, 120); } }
// S14-1f (D-073, every store): a line that is only "<price> with Bank offer" or "<n>% OFF" is the tile of ANOTHER product on the page (seen on Flipkart 9 Nov 2026), not an offer of this product. It is flagged, not hidden.
var TILE_PRICE = /^(?:\u20b9|Rs\.?)\s?[\d,]+(?:\.\d+)?\s+with\s+(?:no cost emi|bank|emi|exchange|coupon)\s+offers?$/i, TILE_PCT = /^\d{1,2}%\s*off$/i;
function isTileLine(s) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return TILE_PRICE.test(s) || TILE_PCT.test(s); }
function offerLines(label, url, res) {
  if (!res || !res.ok) return [label + ': could not read the product page (' + String((res && res.error) || 'no answer').slice(0, 80) + ')'];
  var d = res.result || {}, main = [], tiles = [];
  (d.lines || []).forEach(function (l) { (isTileLine(l) ? tiles : main).push(l); });
  var out = [label + ' product page', 'Page: ' + shortUrl(d.url || url), 'Title: ' + (d.title || '(none)'), 'Offer-like lines: ' + (Number(d.total) || 0) + ' (expanded ' + (Number(d.clicked) || 0) + ')']
    .concat(main.map(function (l) { return '- ' + l; }));
  if (tiles.length) out = out.concat(['Tile-like lines (probably other products, not offers of this product): ' + tiles.length]).concat(tiles.map(function (l) { return '? ' + l; }));
  return out;
}
function sampleLine(s, i, tag) { return tag + ' ' + (i + 1) + ': ' + s.price + ' | ' + s.chain + ' | ' + s.href + ' | ' + s.text; }
function structLines(label, res) {
  if (!res || !res.ok) return [label + ' structure: could not read (' + String((res && res.error) || 'no answer').slice(0, 80) + ')'];
  var d = res.result || {}, h = d.hints || {}, out = [label + ' structure', 'Links: ' + (Number(d.anchors) || 0) + ', price elements: ' + (Number(d.priceLeaves) || 0)]
    .concat((d.samples || []).map(function (s, i) { return sampleLine(s, i, 'Sample'); }))
    .concat((d.linkSamples || []).map(function (l, i) { return 'Link ' + (i + 1) + ': ' + l; }));
  if (d.textLen != null) out.push('Page text length: ' + d.textLen + ', iframes: ' + (d.frames || 0) + ', shadow roots: ' + (d.shadow || 0) + ', links with empty href: ' + (d.emptyHref || 0) + ', clickable non-links: ' + (d.clickable || 0));
  if (d.markers) out.push('Markers on page: ' + (d.markers.length ? d.markers.join(', ') : 'none'));
  if (d.hints) out.push('Hints: product/card classes ' + (h.productClass || 0) + ', images ' + (h.images || 0) + ', loading placeholders ' + (h.loading || 0));
  if (d.skeleton) out.push('Skeleton: ' + d.skeleton);
  if (d.scroll && d.scroll.length) out.push('After scrolling: ' + d.scroll.map(function (x, i) { return (i + 1) + ') price elements ' + x.leaves + ', links ' + x.anchors + ', text ' + x.text + ', height ' + x.height; }).join('; '));
  else if (d.scroll) out.push('After scrolling: not possible on this page');
  if (d.after) out = out.concat([('After scrolling, price elements: ' + d.after.priceLeaves)]).concat((d.after.samples || []).map(function (s, i) { return sampleLine(s, i, 'After-scroll sample'); }));
  return out;
}
// S14-1e: one plain-text report of the whole run (the owner taps Copy and pastes it). Pure function, text only. p = { version, query, seenAt, totalS, ua, runs, rows, diag, struct, offers, error }
function buildReport(p) {
  p = p || {};
  var L = ['SmartSetu app report (test build ' + (p.version || '?') + ')', 'Query: ' + (p.query || '') + ' | Seen at: ' + (p.seenAt || '') + ' | Total: ' + (p.totalS == null ? '?' : p.totalS) + ' s', 'Browser: ' + (p.ua || '?')];
  if (p.error) L.push('ERROR during the run: ' + String(p.error).slice(0, 200));
  L.push('', 'STORES (state | listings | seconds | pass)');
  (p.runs || []).forEach(function (r) {
    var more = '';
    if (r.stage) more += ' | stopped at: ' + r.stage + (r.stageMs != null ? ' (' + Math.round(r.stageMs / 1000) + ' s in that step)' : '');
    if (r.loaded != null) more += ' | page loaded: ' + (r.loaded ? 'yes' : 'no');
    if (r.error) more += ' | error: ' + String(r.error).replace(/\s+/g, ' ').slice(0, 120);
    if (r.rereads) more += ' | rereads: ' + r.rereads;
    L.push('- ' + r.store + ' | ' + r.state + ' | ' + (r.cards == null ? '-' : r.cards) + ' | ' + (r.ms >= 1000 ? Math.round(r.ms / 1000) : (r.ms || 0)) + ' | ' + (r.slow ? '3rd try (long wait + scroll, desktop identity)' : r.retried ? '2nd try (desktop identity)' : '1st') + more);
  });
  L.push('', 'RESULT ROWS (store | price | title)');
  (p.rows || []).forEach(function (r) { L.push('- ' + r.store + ' | ' + (r.price || '-') + ' | ' + String(r.title || '').slice(0, 70)); });
  if (!(p.rows || []).length) L.push('- (none)');
  [['ALL LISTINGS READ (per store: in result or not | price | where the title came from | title)', p.listings], ['DIAGNOSTIC', p.diag], ['PAGE STRUCTURE', p.struct], ['CARD RESCUE (S14-1g)', p.rescue], ['OFFERS FROM PRODUCT PAGES', p.offers]].forEach(function (x) { L.push('', x[0]); (x[1] && x[1].length ? x[1] : ['- (none)']).forEach(function (l) { L.push(l); }); });
  return L.join('\n');
}

// ---- S14-1f (final data build): every listing the phone read, long wait + scroll for a store that timed out, one report.
function timedOutLabels(runs) { return (runs || []).filter(function (r) { return r.state === 'timeout'; }).map(function (r) { return r.store; }); }
function normUrl(u) { try { var x = new URL(u); return x.hostname.replace(/^www\./, '') + x.pathname; } catch (_) { return String(u || '').split('?')[0]; } }
function plainText(html) { return String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }
function money(n) { return '\u20b9' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
// Pure. One block per store that gave a snapshot: header (cards read, parsed, skipped by reason), every parsed listing (in result or not | price | title source | title, max 30), up to 5 skipped ads with their text. parse = SmartSetu.parseSearch (the same parser for every store).
function listingLines(runs, rows, parse) {
  var inRes = {}, out = [];
  (rows || []).forEach(function (r) { if (r && r.url) inRes[normUrl(r.url)] = 1; });
  (runs || []).forEach(function (r) {
    if (!r || !r.snapshot) return;
    var cards = r.snapshot.cards || [], p = null;
    try { p = parse(r.snapshot) || {}; } catch (e) { out.push('Store ' + r.store + ': could not parse (' + String((e && e.message) || e).slice(0, 80) + ')'); return; }
    var sk = Object.keys(p.skipped || {}).map(function (k) { return k + ' ' + p.skipped[k]; }).join(', ');
    out.push('Store ' + r.store + ': ' + cards.length + ' cards read, ' + (p.cards || []).length + ' parsed, skipped: ' + (sk || 'none'));
    (p.cards || []).slice(0, 30).forEach(function (c) {
      out.push('- ' + (inRes[normUrl(c.url)] ? 'in result' : 'not in result') + ' | ' + (c.priceNow == null ? 'no price' : money(c.priceNow)) + ' | ' + (c.titleSource || '?') + ' | ' + String(c.title || '(no title)').slice(0, 90));
    });
    var np = 0; // S14-1i (D-091): the cut html of the first 2 parsed listings without a price, every store, so the real card shape is visible
    (p.cards || []).forEach(function (c) {
      if (np >= 2 || c.priceNow != null) return;
      var raw = cards.filter(function (x) { return x && normUrl(x.link) === normUrl(c.url); })[0]; np++;
      out.push('- no-price card html ' + np + ' | ' + String(c.title || '(no title)').slice(0, 60) + ' | ' + (raw ? String(raw.html || '').replace(/\s+/g, ' ').slice(0, 1200) : '(raw card not found for this listing)'));
      var rh = raw ? String(raw.html || '').replace(/\s+/g, ' ') : '', pi = rh.search(/a-price|a-offscreen|\u20B9|&#8377;|price/i);
      out.push('- no-price price-region ' + np + ' | ' + (pi >= 0 ? 'html around the first price word (char ' + pi + '): ' + rh.slice(Math.max(0, pi - 150), pi + 650) : 'no price word anywhere in the card html'));
    });
    var n = 0;
    cards.forEach(function (c) { if (n >= 5 || !c || !(c.sponsored || c.ad)) return; n++; out.push('- skipped ad | ' + plainText(c.html).slice(0, 90)); });
    // S18b (V-298): the cut html of the CHEAPEST parsed listing of every store, so a wrong price (Rs 2 for a Rs 1,340 mixer) can be traced to the real card text
    var cheap = (p.cards || []).filter(function (c) { return c.priceNow != null; }).sort(function (a, b) { return a.priceNow - b.priceNow; })[0];
    if (cheap) {
      var rawC = cards.filter(function (x) { return x && normUrl(x.link) === normUrl(cheap.url); })[0];
      out.push('- cheapest card html | ' + money(cheap.priceNow) + (cheap.mrp ? ' (MRP ' + money(cheap.mrp) + ')' : '') + ' | ' + (cheap.notes || []).join(',') + ' | ' + String(cheap.title || '(no title)').slice(0, 60) + ' | ' + (rawC ? String(rawC.html || '').replace(/\s+/g, ' ').slice(0, 1200) : '(raw card not found for this listing)'));
    }
  });
  return out;
}
// Page function: scroll to the bottom 4 times so a lazy page draws its cards. Reads nothing, sends nothing.
async function scrollPage() {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var steps = [];
  try {
    for (var i = 0; i < 4; i++) {
      window.scrollTo(0, (document.body && document.body.scrollHeight) || 100000);
      await wait(1500);
      steps.push({ h: Number(document.body && document.body.scrollHeight) || 0, a: document.querySelectorAll('a[href]').length });
    }
    window.scrollTo(0, 0);
  } catch (e) {}
  return steps;
}
// Third try for a store that timed out (any store, D-073): one page, long wait, scroll, then the same collect function as the first read. Never throws. Returns a run (runner_core shape) with slow: true.
async function slowRead(wt, store, query, collect, o) {
  o = o || {};
  var totalMs = o.totalMs == null ? 110000 : o.totalMs, loadMs = o.loadMs == null ? 40000 : o.loadMs, settleMs = o.settleMs == null ? 4000 : o.settleMs;
  var t0 = Date.now(), id = null, stage = 'opening', stageAt = Date.now(), loadedFlag = null, timer = null, over = false;
  function at(s) { stage = s; stageAt = Date.now(); }
  function base(state, extra) { return Object.assign({ store: store.label, key: store.key, state: state, ms: Date.now() - t0, slow: true, retried: true }, extra || {}); }
  var guard = new Promise(function (res) { timer = setTimeout(function () { over = true; res(base('timeout', { stage: stage, stageMs: Date.now() - stageAt, loaded: loadedFlag })); }, totalMs); });
  var work = (async function () {
    try {
      var t = await wt.tabs.create({ url: store.url(query), active: false }); id = t.id; at('loading');
      var tl = Date.now();
      while (Date.now() - tl < loadMs && !over) { var g = await wt.tabs.get(id); if (g.status === 'complete') { loadedFlag = true; break; } await sleep(250); }
      if (loadedFlag !== true) loadedFlag = false;
      at('settling'); await sleep(settleMs); if (over) return null;
      at('scrolling'); var sc = null;
      try { var r1 = await wt.scripting.executeScript({ target: { tabId: id }, func: scrollPage, args: [] }); sc = r1 && r1[0] ? r1[0].result : null; } catch (e) { sc = null; }
      if (over) return null;
      at('reading');
      var r2 = await wt.scripting.executeScript({ target: { tabId: id }, func: collect, args: [query] }), snap = r2 && r2[0] && r2[0].result;
      if (!snap || !Array.isArray(snap.cards)) return base('no_data', { scroll: sc });
      return base(snap.cards.length ? 'ok' : 'no_cards', { cards: snap.cards.length, snapshot: snap, scroll: sc });
    } catch (e) { return base('error', { error: String((e && e.message) || e), stage: stage }); }
  })();
  var res = await Promise.race([work, guard]);
  clearTimeout(timer); over = true;
  if (id != null) { try { await wt.tabs.remove(id); } catch (_) {} }
  return res;
}

// ---- S14-1g (D-089): card rescue for a store that stays empty (every store, D-073). Page function: price elements -> climb to the smallest ancestor that has one product link (and not a whole grid).
// Reads only visible page text/attributes, sends nothing. If it still finds no card, it returns the first 3 price elements' cut html so the real page shape is visible in the report.
async function cardRescue(waitMs) {
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var gap = waitMs == null ? 1200 : waitMs;
  try { for (var sc = 1; sc <= 3; sc++) { window.scrollTo(0, ((document.body && document.body.scrollHeight) || 3000) * sc / 3); await wait(gap); } window.scrollTo(0, 0); await wait(gap); } catch (e) {}
  var priceRx = /^(?:(?:(?:Discount|Offer|Sale|Selling|Special|Deal|Our|Final|Current)\s+)?Price\s*:?\s*)?(?:\u20b9|Rs\.?)\s?\d[\d,]*(?:\.\d+)?\.?$/i;
  var KEEP = ['class', 'id', 'role', 'aria-label', 'title', 'alt', 'itemprop', 'data-testid', 'href'];
  var DROP = /^(script|style|noscript|svg|iframe|form|input|textarea|select|link|template|canvas|video|audio|source)$/i;
  var host = String(location.hostname || '').replace(/^www\./, '');
  function txt(e) { return String(e.textContent || '').replace(/\s+/g, ' ').trim(); }
  function inner(e) { return String(e.innerText != null ? e.innerText : e.textContent || ''); }
  function struck1(e) { try { return String(getComputedStyle(e).textDecorationLine || '').indexOf('line-through') >= 0; } catch (_) { return false; } }
  function isStruck(e) { if (struck1(e)) return true; var k = e.children || []; for (var i = 0; i < k.length; i++) if (k[i].children.length === 0 && struck1(k[i])) return true; return false; }
  function same(a) { try { var u = new URL(a.href); return u.pathname !== '/' && (u.hostname === host || u.hostname === 'www.' + host || u.hostname.endsWith('.' + host)); } catch (_) { return false; } }
  function links(p) { var o = [], q = p.querySelectorAll ? p.querySelectorAll('a[href]') : []; for (var i = 0; i < q.length; i++) if (!/^javascript/.test(q[i].href || '') && same(q[i])) o.push(q[i]); return o; }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function ser(e, d) {
    if (d > 14) return '';
    var tag = String(e.tagName || 'x').toLowerCase(), a = '';
    if (DROP.test(tag)) return '';
    for (var i = 0; i < KEEP.length; i++) {
      var v = KEEP[i] === 'class' && typeof e.className === 'string' ? e.className : (e.getAttribute ? e.getAttribute(KEEP[i]) : null);
      if (v) a += ' ' + KEEP[i] + '="' + String(v).slice(0, KEEP[i] === 'href' ? 300 : 120).replace(/"/g, '&quot;') + '"';
    }
    if ((e.children || []).length === 0 && /(?:\u20b9|Rs\.?)\s?\d/.test(e.textContent || '') && isStruck(e)) a += ' data-struck="1"';
    var inside = '', nodes = e.childNodes && e.childNodes.length ? e.childNodes : (e.children || []);
    if ((e.children || []).length === 0) inside = esc(txt(e));
    else for (var j = 0; j < nodes.length; j++) { var n = nodes[j]; inside += n.nodeType === 3 ? esc(String(n.nodeValue || '').replace(/\s+/g, ' ')) : (n.tagName ? ser(n, d + 1) : ''); }
    return '<' + tag + a + '>' + inside + '</' + tag + '>';
  }
  function clean(e, cap) { var h = ser(e, 0).replace(/\s+/g, ' '); return h.length > cap ? h.slice(0, cap) + '<!--TRUNCATED-->' : h; }
  function pathOf(a) { return String(a.href || '').split('#')[0].split('?')[0]; }
  var all = document.querySelectorAll('body *'), leaves = [];
  for (var i = 0; i < all.length; i++) { var e = all[i]; if (e.children && e.children.length === 0 && priceRx.test(txt(e)) && !isStruck(e)) leaves.push(e); }
  var seen = [], cards = [], out = { picked: 0, grid: 0, nolink: 0, dup: 0 }, dump = [], body = document.body;
  for (var li = 0; li < leaves.length && cards.length < 24; li++) {
    var p = leaves[li], got = null, why = 'nolink';
    for (var up = 0; up < 14 && p.parentElement; up++) {
      p = p.parentElement; if (p === body) break;
      var ls = links(p), distinct = {}; ls.forEach(function (a) { distinct[pathOf(a)] = 1; });
      var nd = Object.keys(distinct).length;
      if (nd > 2) { why = 'grid'; break; }
      if (nd >= 1 && inner(p).length > 30 && inner(p).length < 1500) { got = { p: p, ls: ls }; break; }
    }
    if (!got) { out[why]++; if (dump.length < 3) { var d = leaves[li], k = 0; while (k < 4 && d.parentElement && d.parentElement !== body) { d = d.parentElement; k++; } dump.push({ price: txt(leaves[li]).slice(0, 20), why: why, html: clean(d, 1500) }); } continue; }
    if (seen.indexOf(got.p) >= 0) { out.dup++; continue; }
    seen.push(got.p); out.picked++;
    var lk = got.ls.filter(function (a) { return /\/dp\/[A-Z0-9]{10}/.test(a.href); })[0] || got.ls[0], t = inner(got.p);
    cards.push({ link: String(lk.href).slice(0, 300), sponsored: /\/sspa\/click|sponsored/i.test(lk.href) || /sponsored/i.test(t), ad: /(^|\n)\s*AD\s*(\n|$)/.test(t), html: clean(got.p, 6000) });
  }
  return { url: String(location.href || ''), title: String(document.title || '').slice(0, 100), leaves: leaves.length, outcome: out, cards: cards, dump: cards.length ? [] : dump };
}
// One more read of a store that is still empty: a fresh page, long wait, cardRescue. Never throws. Returns a run (runner_core shape): ok with a snapshot the same parser reads, or no_cards with rescue data for the report.
async function rescueRead(wt, store, query, o) {
  o = o || {};
  var t0 = Date.now(), res = await readPage(wt, store.url(query), cardRescue, { settleMs: o.settleMs == null ? 5000 : o.settleMs, args: [o.waitMs == null ? 1200 : o.waitMs] });
  var base = { store: store.label, key: store.key, ms: Date.now() - t0, slow: true, retried: true, rescued: true };
  if (!res || !res.ok || !res.result) return Object.assign(base, { state: 'error', error: String((res && res.error) || 'no answer').slice(0, 120), rescue: null });
  var r = res.result, cards = Array.isArray(r.cards) ? r.cards : [];
  if (!cards.length) return Object.assign(base, { state: 'no_cards', cards: 0, rescue: r });
  var snap = { v: 1, kind: 'search', query: query, url: r.url, title: r.title, time: new Date().toISOString(), metas: [], ldJson: [], cards: cards, priceBoxes: [], struckBoxes: [], clickTexts: [], offerBoxes: [], pageOfferLines: [], pageAvailLines: [], probe: 'app-rescue-0.8.0' };
  return Object.assign(base, { state: 'ok', cards: cards.length, snapshot: snap, rescue: { url: r.url, leaves: r.leaves, outcome: r.outcome, dump: [] } });
}
function rescueLines(label, run) {
  var r = run && run.rescue;
  if (!r) return [label + ' rescue: ' + (run && run.error ? 'could not read (' + String(run.error).slice(0, 80) + ')' : 'no answer')];
  var o = r.outcome || {}, out = [label + ' rescue: ' + (run.state === 'ok' ? 'FOUND ' + run.cards + ' cards' : 'still 0 cards') + ' | price elements ' + (Number(r.leaves) || 0) + ' | card found ' + (o.picked || 0) + ', stopped at a grid ' + (o.grid || 0) + ', no link above ' + (o.nolink || 0) + ', same card again ' + (o.dup || 0) + (r.url ? ' | page ' + String(r.url).slice(0, 90) : '')];
  (r.dump || []).forEach(function (d, i) { out.push('Cut html ' + (i + 1) + ' (' + d.price + ', ' + d.why + '): ' + String(d.html || '').slice(0, 1500)); });
  return out;
}

var api = { readyCount: readyCount, createWebTabs: createWebTabs, detailOf: detailOf, enabledMap: enabledMap, lineText: lineText, diagLines: diagLines, OFF_TEXT: OFF_TEXT, NOCARDS_NOTE: NOCARDS_NOTE,
  sameSite: sameSite, failingLabels: failingLabels, enabledOnly: enabledOnly, mergeRuns: mergeRuns, pickProduct: pickProduct, pickFromView: pickFromView, rowsOf: rowsOf, readPage: readPage,
  offerProbe: offerProbe, structureProbe: structureProbe, offerLines: offerLines, structLines: structLines, buildReport: buildReport,
  timedOutLabels: timedOutLabels, listingLines: listingLines, scrollPage: scrollPage, slowRead: slowRead, isTileLine: isTileLine,
  cardRescue: cardRescue, rescueRead: rescueRead, rescueLines: rescueLines };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
