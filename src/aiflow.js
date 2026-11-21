/* smartsetu app / aiflow v1 (S23-2c, D-132). The glue between the app and the AI Worker (rewrite + classify). Pure: every outside thing (network, clock) comes in through deps,
 * so the Node tests use a FAKE worker. Rules: any problem (off, timeout, error, bad answer, daily limit) = a plain "not ok" answer and the app runs the old behaviour, never an error screen.
 * Start values NOT measured on a phone (V-531): rewrite wait 6000 ms, classify wait 8000 ms, 60 s pause after a network or Worker failure. Answers are kept in memory for this app run only
 * (no storage, nothing written to the phone). The Worker keeps and logs nothing (see code/worker). Only a card the AI called exactly "A" is ever dropped. */
'use strict';
var ASK_CAP = 300, MAX_TITLES = 45, MAX_TITLE_CHARS = 200, MAX_SEARCH_CHARS = 120, MAX_PRICE = 10000000, MEM_CAP = 400;

function norm(s) { return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().toLowerCase() : ''; }
function oneLine(s, max) { return typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim() : ''; }
function withTimeout(p, ms) {
  return new Promise(function (resolve, reject) {
    var done = false, t = setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')); } }, ms);
    Promise.resolve(p).then(function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } }, function (e) { if (!done) { done = true; clearTimeout(t); reject(e); } });
  });
}

function make(deps) {
  deps = deps || {};
  var url = typeof deps.url === 'string' && /^https:\/\/[^\s]+$/.test(deps.url) ? deps.url : '';
  var post = typeof deps.post === 'function' ? deps.post : null, now = typeof deps.now === 'function' ? deps.now : Date.now;
  var rwMs = deps.rewriteMs > 0 ? deps.rewriteMs : 6000, clMs = deps.classifyMs > 0 ? deps.classifyMs : 8000, cool = deps.cooldownMs >= 0 ? deps.cooldownMs : 60000;
  var memR = {}, memC = {}, nR = 0, nC = 0, downUntil = 0, stat = { calls: 0, failed: 0, cached: 0, paused: 0 };
  function on() { return !!(url && post); }
  function trip(why) { stat.failed++; stat.lastFail = why; downUntil = now() + cool; }
  function call(body, ms) { stat.calls++; return withTimeout(post(url, body, ms), ms + 500); }

  // q -> { ok:true, search, max_price, cached } | { ok:false, reason }
  function rewrite(q) {
    var key = norm(q);
    if (!on() || !key) return Promise.resolve({ ok: false, reason: 'off' });
    if (memR[key]) { stat.cached++; return Promise.resolve({ ok: true, search: memR[key].search, max_price: memR[key].max_price, cached: true }); }
    if (now() < downUntil) { stat.paused++; return Promise.resolve({ ok: false, reason: 'paused' }); }
    var t0 = now();
    return call({ action: 'rewrite', q: oneLine(q, 200) }, rwMs).then(function (r) {
      if (!r || typeof r !== 'object') { trip('bad_reply'); return { ok: false, reason: 'bad_reply' }; }
      if (r.ok !== true) { var hard = r.reason === 'ai_error' || r.reason === 'no_ai'; if (hard) trip(r.reason); else stat.failed++; return { ok: false, reason: String(r.reason || 'not_ok').slice(0, 30) }; }
      var s = oneLine(r.search, MAX_SEARCH_CHARS + 1), mp = r.max_price;
      if (!s || s.length > MAX_SEARCH_CHARS) { stat.failed++; return { ok: false, reason: 'bad_search' }; }
      if (mp === undefined || mp === null) mp = null; else if (typeof mp !== 'number' || !isFinite(mp) || mp <= 0 || mp > MAX_PRICE) { stat.failed++; return { ok: false, reason: 'bad_price' }; }
      if (nR >= MEM_CAP) { memR = {}; nR = 0; } memR[key] = { search: s, max_price: mp }; nR++;
      return { ok: true, search: s, max_price: mp, cached: false, ms: now() - t0 };
    }, function (e) { trip(String((e && e.message) || e).slice(0, 40)); return { ok: false, reason: 'error' }; });
  }

  function ckey(search, title) { return norm(search) + '\u0001' + title; }
  // search phrase + titles -> { ok, asked, labels:{title:'P'|'A'} } ; labels hold every title that has an answer (this call or an earlier one). ok:false = nothing new learned.
  function classify(search, titles) {
    var s = oneLine(search, MAX_SEARCH_CHARS + 1), labels = {}, ask = [], seen = {};
    if (!on() || !s || s.length > MAX_SEARCH_CHARS || !Array.isArray(titles)) return Promise.resolve({ ok: false, reason: 'off', asked: 0, labels: labels });
    titles.forEach(function (t) {
      if (typeof t !== 'string' || seen[t]) return; seen[t] = 1;
      var c = oneLine(t, MAX_TITLE_CHARS); if (!c) return;
      var k = memC[ckey(s, t)];
      if (k) labels[t] = k; else if (ask.length < MAX_TITLES) ask.push({ orig: t, sent: c });
    });
    if (!ask.length) return Promise.resolve({ ok: true, asked: 0, labels: labels, cached: true });
    if (now() < downUntil) { stat.paused++; return Promise.resolve({ ok: false, reason: 'paused', asked: 0, labels: labels }); }
    var t0 = now();
    return call({ action: 'classify', search: s, titles: ask.map(function (a) { return a.sent; }) }, clMs).then(function (r) {
      if (!r || typeof r !== 'object' || r.ok !== true || !Array.isArray(r.labels) || r.labels.length !== ask.length || !r.labels.every(function (l) { return l === 'P' || l === 'A'; })) {
        var hard = !r || r.reason === 'ai_error' || r.reason === 'no_ai' || typeof r !== 'object'; if (hard) trip('bad_reply'); else stat.failed++;
        return { ok: false, reason: String((r && r.reason) || 'bad_reply').slice(0, 30), asked: ask.length, labels: labels };
      }
      ask.forEach(function (a, i) { if (nC >= MEM_CAP * 4) { memC = {}; nC = 0; } memC[ckey(s, a.orig)] = r.labels[i]; nC++; labels[a.orig] = r.labels[i]; });
      return { ok: true, asked: ask.length, labels: labels, ms: now() - t0 };
    }, function (e) { trip(String((e && e.message) || e).slice(0, 40)); return { ok: false, reason: 'error', asked: ask.length, labels: labels }; });
  }

  // the hook for the engine: true ONLY for a title the AI called A for this search phrase
  function isAFor(search) { var s = oneLine(search, MAX_SEARCH_CHARS + 1); return function (title) { return typeof title === 'string' && memC[ckey(s, title)] === 'A'; }; }

  // S23-5 (D-137): true ONLY for a title the AI answered P (the searched product) for this search phrase; the engine may then confirm a card whose title never names the type (Flipkart 'Galaxy A06 (Black, 64 GB)'), still only as a close match
  function isPFor(search) { var s = oneLine(search, MAX_SEARCH_CHARS + 1); return function (title) { return typeof title === 'string' && memC[ckey(s, title)] === 'P'; }; }

  // cur = { view, res } already drawn WITHOUT labels. rebuild() builds the same screen again with the labels this module now holds (the app sets its engine hook before calling it).
  // At most 2 rounds: round 1 labels the cards on screen; if accessories left, cards from further down take their place and round 2 labels those. gone() = the run was cancelled.
  // -> { next: the newer { view, res } or null when nothing was dropped, info }
  function refine(search, cur, rebuild, gone, setHook) {
    var info = { rounds: 0, asked: 0, dropped: 0, rescued: 0, ms: 0 }, last = cur;
    return (async function () {
      for (var i = 0; i < 2; i++) {
        var shown = askTitles(last.res, last.view, ASK_CAP); // S23-5: the cards the word checks could not confirm first, then the cards on screen
        if (!shown.length) break;
        var t0 = now(), cr = await classify(search, shown);
        if (gone && gone()) return { next: null, info: info, cancelled: true };
        info.rounds++; info.asked += cr.asked || 0; info.ms += now() - t0;
        if (!cr.ok) { info.reason = cr.reason || 'not_ok'; break; }
        if (cr.asked === 0 && i > 0) break;
        if (typeof setHook === 'function') setHook(isAFor(search), isPFor(search));
        var b = rebuild(); if (!b || !b.view) break;
        last = b; info.dropped = (b.res && b.res.aiInfo && b.res.aiInfo.dropped) || 0; info.rescued = (b.res && b.res.aiInfo && b.res.aiInfo.rescued) || 0;
        if (cr.asked === 0) break;
      }
      return { next: (info.dropped > 0 || info.rescued > 0) ? last : null, info: info };
    })();
  }
  function state() { return { on: on(), downForMs: Math.max(0, downUntil - now()), calls: stat.calls, failed: stat.failed, cached: stat.cached, paused: stat.paused, lastFail: stat.lastFail || null }; }
  return { on: on, rewrite: rewrite, classify: classify, refine: refine, isAFor: isAFor, isPFor: isPFor, state: state };
}

// titles of the cards the member can see in a drawn view (view.groups[].rows[] and view.top.rows[]), in screen order, each once, at most cap
function shownTitles(view, cap) {
  var out = [], seen = {}; cap = cap > 0 ? cap : MAX_TITLES;
  function add(rows) { (Array.isArray(rows) ? rows : []).forEach(function (r) { var t = r && r.title; if (typeof t === 'string' && t && !seen[t] && out.length < cap) { seen[t] = 1; out.push(t); } }); }
  try { ((view && view.groups) || []).forEach(function (g) { add(g && g.rows); }); if (view && view.top) add(view.top.rows); } catch (_) { /* nothing to classify */ }
  return out;
}

// S23-5 (D-137): the titles to ask the AI about, in this order: (1) the listings the engine could not confirm by words (res.aiInfo.unsure = { store: [titles] }), one store after the other in turns so every store is heard,
// (2) the cards on screen. classify() skips titles it already knows and sends at most MAX_TITLES new ones, so a long list is fine (round 2 takes the next ones).
function askTitles(res, view, cap) {
  var out = [], seen = {}; cap = cap > 0 ? cap : ASK_CAP;
  function add(t) { if (typeof t === 'string' && t && !seen[t] && out.length < cap) { seen[t] = 1; out.push(t); } }
  try {
    var u = res && res.aiInfo && res.aiInfo.unsure, lists = [];
    if (u && typeof u === 'object') Object.keys(u).forEach(function (k) { if (Array.isArray(u[k])) lists.push(u[k]); });
    for (var i = 0, more = true; more && out.length < cap; i++) { more = false; lists.forEach(function (l) { if (i < l.length) { more = true; add(l[i]); } }); }
  } catch (_) { /* only the cards on screen then */ }
  shownTitles(view, cap).forEach(add);
  return out;
}

module.exports = { make: make, shownTitles: shownTitles, askTitles: askTitles, MAX_TITLES: MAX_TITLES, version: '1' };
