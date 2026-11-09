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
function enabledMap() { return { Myntra: false }; }
// view.js gives the store line text; the app adds the plain reason for a store that is off and the short error for a store that failed.
function lineText(run, text) {
  text = String(text).replace(/(hidden|visible) tab/g, '$1 page'); // view.js says tab, the app has pages
  if (run && run.state === 'off' && OFF_TEXT[run.key]) return OFF_TEXT[run.key];
  if (run && run.state === 'error' && run.error) return text + ' (' + String(run.error).replace(/\s+/g, ' ').slice(0, 90) + ')';
  return text;
}

// Test-build diagnostic (D-082): what the page itself shows for a store that gave no listings. Shown only on the owner's screen, never stored or sent. Remove before the release APK.
var PROBE_SRC = 'function probeNow() { try { var t = String((document.body && document.body.innerText) || "").replace(/\\s+/g, " ").trim().slice(0, 200); return { title: String(document.title || "").slice(0, 100), url: String(location.href).slice(0, 200), text: t, items: document.querySelectorAll(\'[class*="rice"]\').length }; } catch (e) { return { error: String((e && e.message) || e) }; } }\n';
function diagLines(label, d) {
  if (!d) return [label + ': no page data came back'];
  if (d.error) return [label + ': ' + String(d.error).slice(0, 100)];
  return [label, 'Title: ' + (d.title || '(none)'), 'Page: ' + (d.url || '(none)'), 'Price-like items: ' + (Number(d.items) || 0), 'Text: ' + (d.text || '(none)')];
}

function createWebTabs(plugin, o) {
  o = o || {};
  var execMs = o.execMs == null ? 45000 : o.execMs;
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

  var tabs = {
    create: function (spec) {
      return init().then(function () {
        opening = true; earlyLoad = false; lastProbe = null;
        return Promise.resolve(plugin.open({ url: spec.url, visible: !!spec.active })).then(function (id) {
          current = id; loaded[id] = earlyLoad; opening = false; if (id != null) opened[id] = 1;
          return { id: id, status: earlyLoad ? 'complete' : 'loading' };
        }, function (e) { opening = false; throw e; });
      });
    },
    get: function (id) { return Promise.resolve({ id: id, status: loaded[id] ? 'complete' : 'loading' }); },
    remove: function (id) {
      failPending(id, 'tab closed');
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
    failPending(null, 'closed');
    Object.keys(opened).forEach(function (k) { try { Promise.resolve(plugin.close({ id: k })).catch(function () {}); } catch (_) {} }); opened = {}; // S14-1d: no page is left open after a run
    unsubs.forEach(function (u) { try { if (typeof u === 'function') u(); } catch (_) {} });
    unsubs = []; inited = null; listeners = [];
  }
  return { tabs: tabs, scripting: scripting, dispose: dispose, lastProbe: function () { return lastProbe; } };
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
function structureProbe() {
  function cls(e) { return String(e.tagName || '').toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/)[0].slice(0, 40) : ''); }
  var all = document.querySelectorAll('body *'), leaves = [], n = 0;
  for (var i = 0; i < all.length; i++) {
    var e = all[i];
    if (e.children && e.children.length === 0 && /^\s*\u20b9\s?[\d,]{3,}/.test(e.textContent || '')) { n++; if (leaves.length < 3) leaves.push(e); }
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
  var ls = [], as = document.querySelectorAll('a[href]');
  for (var j = 0; j < as.length && ls.length < 4; j++) { var h = String(as[j].getAttribute('href') || ''); if (h.length > 1 && h.charAt(0) !== '#') ls.push(h.slice(0, 80) + ' "' + String(as[j].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30) + '"'); }
  return { anchors: as.length, priceLeaves: n, samples: samples, linkSamples: ls };
}
function shortUrl(u) { try { var x = new URL(u); return (x.hostname + x.pathname).slice(0, 120); } catch (_) { return String(u).slice(0, 120); } }
function offerLines(label, url, res) {
  if (!res || !res.ok) return [label + ': could not read the product page (' + String((res && res.error) || 'no answer').slice(0, 80) + ')'];
  var d = res.result || {};
  return [label + ' product page', 'Page: ' + shortUrl(d.url || url), 'Title: ' + (d.title || '(none)'), 'Offer-like lines: ' + (Number(d.total) || 0) + ' (expanded ' + (Number(d.clicked) || 0) + ')']
    .concat((d.lines || []).map(function (l) { return '- ' + l; }));
}
function structLines(label, res) {
  if (!res || !res.ok) return [label + ' structure: could not read (' + String((res && res.error) || 'no answer').slice(0, 80) + ')'];
  var d = res.result || {};
  return [label + ' structure', 'Links: ' + (Number(d.anchors) || 0) + ', price elements: ' + (Number(d.priceLeaves) || 0)]
    .concat((d.samples || []).map(function (s, i) { return 'Sample ' + (i + 1) + ': ' + s.price + ' | ' + s.chain + ' | ' + s.href + ' | ' + s.text; }))
    .concat((d.linkSamples || []).map(function (l, i) { return 'Link ' + (i + 1) + ': ' + l; }));
}

var api = { createWebTabs: createWebTabs, detailOf: detailOf, enabledMap: enabledMap, lineText: lineText, diagLines: diagLines, OFF_TEXT: OFF_TEXT,
  sameSite: sameSite, failingLabels: failingLabels, enabledOnly: enabledOnly, mergeRuns: mergeRuns, pickProduct: pickProduct, pickFromView: pickFromView, rowsOf: rowsOf, readPage: readPage,
  offerProbe: offerProbe, structureProbe: structureProbe, offerLines: offerLines, structLines: structLines };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
