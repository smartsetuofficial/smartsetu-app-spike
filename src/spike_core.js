/* smartsetu app-spike / spike_core v0.5 (S13-1, S13-2: reread, state report, visible/UA modes; S13-3: page structure dump; S13-4: link box text + inline script check; S13-5: split/label price items, JSON key path dump, box leaf dump). TEST ONLY, not the product.
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

// Diagnostic only, shown on the owner's own screen, never stored or sent anywhere. Explains an empty result (S13-3, same for every store, D-073):
// price items, same-site links, how pagesnap would climb from the first 2 price items (tag.class textLen/hasLink), and a 200 char page text sample.
function diagFn(K) {
  function send(o) { try { window.mobileApp.postMessage({ detail: o }); } catch (e) {} }
  try {
    var pr = /^(?:(?:(?:Discount|Offer|Sale|Selling|Special|Deal|Our|Final|Current)\s+)?Price\s*:?\s*)?(?:\u20B9|Rs\.?)\s?\d[\d,]*(?:\.\d+)?\.?$/i, leaves = [], all = document.querySelectorAll("body *"), i;
    function tx1(e) { return (e.textContent || "").replace(/\s+/g, " ").trim(); }
    function isP(e) { var n = e.children.length, c, j; if (n === 0) return pr.test(tx1(e)); if (n > 4) return false; for (j = 0; j < n; j++) { c = e.children[j]; if (c.children.length !== 0 || pr.test(tx1(c))) return false; } return pr.test(tx1(e)); }
    for (i = 0; i < all.length; i++) { if (isP(all[i])) leaves.push(all[i]); }
    var host = location.hostname.replace(/^www\./, ""), as = document.querySelectorAll("a[href]"), same = 0, paths = [], sameEls = [];
    for (i = 0; i < as.length; i++) {
      try { var u = new URL(as[i].href); if (u.pathname !== "/" && (u.hostname === host || u.hostname === "www." + host || u.hostname.slice(-host.length - 1) === "." + host)) { same++; sameEls.push(as[i]); if (paths.length < 3) paths.push(u.pathname.slice(0, 60)); } } catch (e) {}
    }
    function struck1(e) { try { return getComputedStyle(e).textDecorationLine.indexOf("line-through") >= 0; } catch (e2) { return false; } }
    function struck(e) { var j; if (struck1(e)) return true; for (j = 0; j < e.children.length; j++) { if (e.children[j].children.length === 0 && struck1(e.children[j])) return true; } return false; }
    var nonStruck = 0, chains = [];
    for (i = 0; i < leaves.length; i++) { if (!struck(leaves[i])) nonStruck++; }
    for (i = 0; i < leaves.length && chains.length < 2; i++) {
      var p = leaves[i], up = [], stop = -1, k;
      for (k = 0; k < 7 && p.parentElement; k++) {
        p = p.parentElement;
        var len = p.innerText ? p.innerText.length : 0, hasA = p.querySelector("a[href]") ? 1 : 0;
        up.push(String(p.tagName || "").toLowerCase() + "." + String(typeof p.className === "string" ? p.className : "").split(" ")[0].slice(0, 16) + " " + len + "/" + hasA);
        if (stop < 0 && hasA && len > 30 && len < 700) { stop = k + 1; break; }
      }
      chains.push({ price: (leaves[i].textContent || "").trim().slice(0, 14), struck: struck(leaves[i]), up: up, stop: stop });
    }
    var boxes = [], node, k2, pth;
    for (i = 0; i < sameEls.length && boxes.length < 2; i++) {
      try { pth = new URL(sameEls[i].href).pathname; } catch (e3) { continue; }
      if (pth.length < 25) continue;
      node = sameEls[i]; k2 = 0;
      while ((node.innerText || "").length < 80 && k2 < 5 && node.parentElement) { node = node.parentElement; k2++; }
      boxes.push({ path: pth.slice(0, 40), up: k2, box: (node.innerText || "").replace(/\s+/g, " ").trim().slice(0, 120) });
    }
    var pd = "", scs = document.querySelectorAll("script"), hit = 0, big = 0, ld = 0, head = [], hits = [], tx;
    for (i = 0; i < leaves.length; i++) { if (!struck(leaves[i])) { pd = (leaves[i].textContent || "").replace(/[^0-9]/g, ""); break; } }
    if (!pd) { for (i = 0; i < boxes.length; i++) { var bm = /(?:\u20B9|Rs\.?)\s?(\d[\d,]*)/.exec(boxes[i].box); if (bm) { pd = bm[1].replace(/,/g, ""); break; } } }
    for (i = 0; i < scs.length; i++) {
      tx = scs[i].textContent || "";
      if (scs[i].type === "application/ld+json") ld++;
      if (tx.length > 2000) { big++; if (head.length < 3) head.push(tx.length + ":" + tx.replace(/\s+/g, " ").trim().slice(0, 50)); }
      if (pd.length > 2 && tx.indexOf(pd) >= 0) { hit++; if (hits.length < 3) hits.push({ ld: scs[i].type === "application/ld+json", len: tx.length, head: tx.replace(/\s+/g, " ").trim().slice(0, 40), tx: tx }); }
    }
    var J = [], LF = [], ldInfo = [], kk;
    var jparse = function (t, isLd) {
      var st = 0, m, d = 0, inS = false, esc = false, c, z, op;
      if (isLd) { st = t.search(/\S/); if (st < 0) st = 0; } else { m = /^\s*(?:window\.[\w$.]+|self\.[\w$.]+|var\s+[\w$]+|let\s+[\w$]+|const\s+[\w$]+)\s*=\s*/.exec(t); st = m ? m[0].length : 0; }
      op = t.charAt(st);
      if (op !== "{" && op !== "[") return { fail: "shape " + t.slice(st, st + 12).replace(/\s+/g, " ") };
      for (z = st; z < t.length; z++) {
        c = t.charAt(z);
        if (inS) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inS = false; continue; }
        if (c === '"') inS = true; else if (c === "{" || c === "[") d++; else if (c === "}" || c === "]") { d--; if (d === 0) break; }
      }
      try { return { v: JSON.parse(t.slice(st, z + 1)) }; } catch (e7) { return { fail: String((e7 && e7.message) || e7).slice(0, 60) }; }
    };
    var wk = function (o, path, want, out) {
      var ks, j;
      if (out.length >= 2 || path.length > 16) return;
      if (o !== null && typeof o === "object") { ks = Object.keys(o); for (j = 0; j < ks.length && out.length < 2; j++) wk(o[ks[j]], path.concat([ks[j]]), want, out); }
      else if ((typeof o === "number" && String(o) === want) || (typeof o === "string" && o.length < 16 && /\d/.test(o) && o.replace(/[^0-9]/g, "") === want)) out.push(path);
    };
    var arrOf = function (root, path) {
      var cur = root, best = null, j, acc = [];
      for (j = 0; j < path.length; j++) { cur = cur[path[j]]; acc.push(path[j]); if (Array.isArray(cur)) best = { p: acc.join(".").slice(0, 90), n: cur.length, keys: (cur[0] && typeof cur[0] === "object") ? Object.keys(cur[0]).slice(0, 14).map(function (s) { return s.slice(0, 18); }) : [] }; }
      return best;
    };
    for (i = 0; i < hits.length; i++) {
      var hj = jparse(hits[i].tx, hits[i].ld), item = { len: hits[i].len, head: hits[i].head, ld: hits[i].ld }, outp = [];
      if (hj.fail) item.fail = hj.fail; else { wk(hj.v, [], pd, outp); item.paths = outp.map(function (p) { return { p: p.join(".").slice(0, 120), arr: arrOf(hj.v, p) }; }); }
      J.push(item);
    }
    for (i = 0; i < scs.length && ldInfo.length < 4; i++) {
      if (scs[i].type !== "application/ld+json") continue;
      var lj = jparse(scs[i].textContent || "", true);
      if (lj.fail) { ldInfo.push({ fail: lj.fail }); continue; }
      var ln = Array.isArray(lj.v) ? lj.v : (lj.v && lj.v["@graph"] ? lj.v["@graph"] : [lj.v]);
      for (kk = 0; kk < ln.length && ldInfo.length < 4; kk++) {
        var lo = ln[kk];
        if (lo && lo["@type"]) { var ie = lo.itemListElement, it0 = Array.isArray(ie) && ie[0]; ldInfo.push({ t: String(lo["@type"]).slice(0, 20), n: Array.isArray(ie) ? ie.length : -1, k: it0 && typeof it0 === "object" ? Object.keys(it0).slice(0, 10) : [], ik: it0 && it0.item && typeof it0.item === "object" ? Object.keys(it0.item).slice(0, 12) : [] }); }
      }
    }
    try {
      for (i = 0; i < sameEls.length && LF.length === 0; i++) {
        pth = ""; try { pth = new URL(sameEls[i].href).pathname; } catch (e4) { continue; }
        if (pth.length < 25) continue;
        node = sameEls[i]; k2 = 0;
        while ((node.innerText || "").length < 80 && k2 < 5 && node.parentElement) { node = node.parentElement; k2++; }
        var ls = node.querySelectorAll("*"), q, cs, b4, a4;
        for (q = 0; q < ls.length && LF.length < 12; q++) {
          if (ls[q].children.length === 0 && /[\d\u20B9]/.test(ls[q].textContent || "")) {
            b4 = ""; a4 = "";
            try { cs = getComputedStyle(ls[q], "::before").content; if (cs && cs !== "none" && cs !== "normal") b4 = cs.slice(0, 10); cs = getComputedStyle(ls[q], "::after").content; if (cs && cs !== "none" && cs !== "normal") a4 = cs.slice(0, 10); } catch (e5) {}
            LF.push(String(ls[q].tagName || "").toLowerCase() + "." + String(typeof ls[q].className === "string" ? ls[q].className : "").split(" ")[0].slice(0, 14) + "=" + (ls[q].textContent || "").replace(/\s+/g, " ").trim().slice(0, 16) + (b4 ? " b:" + b4 : "") + (a4 ? " a:" + a4 : ""));
          }
        }
      }
    } catch (e6) {}
    send({ kind: "diag", key: K, boxes: boxes, json: J, ld: ldInfo, lf: LF, scripts: { n: scs.length, ld: ld, big: big, pd: pd, hit: hit, head: head }, readyState: document.readyState, visibility: document.visibilityState, w: window.innerWidth, h: window.innerHeight, links: as.length, sameLinks: same, paths: paths, priceLeaves: leaves.length, nonStruck: nonStruck, chains: chains, textLen: ((document.body && document.body.innerText) || "").length, sample: ((document.body && document.body.innerText) || "").replace(/\s+/g, " ").trim().slice(0, 200), url: location.href, title: document.title });
  } catch (e) { send({ kind: "diag", key: K, error: String((e && e.message) || e) }); }
}
function buildDiagCode(key) { return 'var K = ' + JSON.stringify(key) + ';\n(' + diagFn.toString() + ')(K);\n'; }
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
  if (r.diag && !r.diag.error && r.diag.chains) {
    var g = r.diag;
    s += '\n   same-site links ' + g.sameLinks + (g.paths && g.paths.length ? ' e.g. ' + g.paths.join(' , ') : '') + ', price items not struck ' + g.nonStruck;
    g.chains.forEach(function (c) { s += '\n   price ' + c.price + (c.struck ? ' (struck)' : '') + ' -> ' + c.up.join(' > ') + (c.stop > 0 ? ' [card at step ' + c.stop + ']' : ' [no card box in 7 steps]'); });
    if (g.sample) s += '\n   text: ' + g.sample;
  }
  if (r.diag && !r.diag.error && r.diag.boxes) {
    var h2 = r.diag;
    if (!h2.boxes.length) s += '\n   no product-like link (path 25+ chars)';
    h2.boxes.forEach(function (b) { s += '\n   link box ' + b.path + ' (up ' + b.up + '): ' + b.box; });
    if (h2.scripts) s += '\n   scripts ' + h2.scripts.n + ' (ld+json ' + h2.scripts.ld + ', big ' + h2.scripts.big + '), price digits ' + (h2.scripts.pd || '-') + ' found in ' + h2.scripts.hit + (h2.scripts.head.length ? ', big: ' + h2.scripts.head.join(' | ') : '');
    if (h2.json) h2.json.forEach(function (j) { s += '\n   json in script (' + j.len + (j.ld ? ', ld+json' : '') + ') ' + j.head + ' -> ' + (j.fail ? 'not parsed: ' + j.fail : (j.paths.length ? j.paths.map(function (p) { return 'path ' + p.p + (p.arr ? ' [list ' + p.arr.p + ' n=' + p.arr.n + ' keys ' + p.arr.keys.join(',') + ']' : ''); }).join(' ; ') : 'digits not found as a value')); });
    if (h2.ld) h2.ld.forEach(function (j) { s += '\n   ld+json ' + (j.fail ? 'not parsed: ' + j.fail : j.t + ' items ' + j.n + ' keys ' + j.k.join(',') + (j.ik.length ? ' item keys ' + j.ik.join(',') : '')); });
    if (h2.lf && h2.lf.length) s += '\n   box leaves: ' + h2.lf.join(' | ');
  }
  return s;
}

var api = { STORES: STORES, buildInjectCode: buildInjectCode, buildDiagCode: buildDiagCode, diagFn: diagFn, chromeUa: chromeUa, runStore: runStore, runAll: runAll, describe: describe, detailOf: detailOf };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
