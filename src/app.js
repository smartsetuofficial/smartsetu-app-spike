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
var Car = require('./carousel.js'); // S22g: Why SmartSetu cards slide one by one
var AIF = require('./aiflow.js'); // S23-2c (D-132): glue to the AI Worker (query meaning + accessory labels), tested in Node with a fake worker
var OF = require('./offerflow.js').make({ parser: SmartSetu.parser, adapter: SmartSetu.adapter, offers: SmartSetu.offers, isTileLine: W.isTileLine }); // S22b-2: offers under result rows (D-117)

var R = SmartSetuRunner, V = SmartSetuView, busy = false, runGen = 0, activeTabs = [], offerWt = null, plistItems = {}, pstates = {}, pactive = {}, maxDone = 0, retry = false, VERSION = '0.10.31';
var cards = [], offerRaw = {}, offerTok = 0, lastView = null; // member's own cards (phone only), offer lines read from product pages (by listing url), run token, last drawn view
var live = { runs: {}, q: '', scrolled: false, timer: 0, firstAt: 0, t0: 0, skipped: [] };
var PAUSED = {};
// ---- S23-2c (D-132): AI Worker = query meaning + accessory labels. AI_URL is the deployed Worker address (public, no secret; S23-4c-2); empty = the AI is off and the app runs exactly as before.
// Any problem (no network, slow, bad answer, daily limit) = the old behaviour, never an error screen. Answers are kept in memory for this app run only. Start waits are NOT measured on a phone (V-531). ----
var AI_URL = 'https://smartsetu-ai.smartsetuofficial.workers.dev', aiLast = null, aiLabels = null; // aiLabels = { isA } hook for the engine while a search that used the AI is on screen
var AIX = AIF.make({ url: AI_URL, post: function (u, body, ms) { return Promise.resolve(CapacitorHttp.post({ url: u, headers: { 'Content-Type': 'application/json' }, data: body, connectTimeout: ms, readTimeout: ms })).then(function (r) { if (!r || r.status !== 200) throw new Error('http ' + (r && r.status)); var d = r.data; return typeof d === 'string' ? JSON.parse(d) : d; }); } });
var SRX = SmartSetuStoreRecord.make({ runner: R, fetchRead: SmartSetuFetchRead, parser: SmartSetu.parser, getText: function (u, ms) { return Promise.resolve(CapacitorHttp.get({ url: u, headers: { Accept: 'application/json' }, responseType: 'text', connectTimeout: ms, readTimeout: ms })).then(function (r) { if (!r || r.status !== 200) throw new Error('HTTP ' + (r && r.status)); return typeof r.data === 'string' ? r.data : JSON.stringify(r.data); }); } }); // S23-18 (D-163): the store record (data only, from smartsetu.in); any problem = the built-in values
window.smartsetuRecordDiag = function () { return SRX.diagLine(); };
try { SRX.start(); } catch (_) { /* the built-in values stay */ }
var lastStores = null; // S23-6c: state, stage and seconds of every store of the last normal Compare (for the owner-only report)
var STORE_MS = 20000, GATE_MS = 50000, MAX_TABS = 2; // S23-6c time cap, S23-13 (D-158) values (NOT measured on the phone): a store gets 20 s, no new store tab and no extra try after 50 s (30 s skipped Myntra, Ajio, Meesho, Croma in the 2nd Full Test); at most MAX_TABS hidden pages open at once (V-599: the plugin supports several)
function storesDiag() { try { return lastStores ? ' | STORES ' + JSON.stringify(lastStores) : ' | STORES none yet'; } catch (e) { return ''; } }
function aiDiag() { // one plain line for the owner-only store test report (devtest.js)
  try { return (aiLast ? JSON.stringify({ last: aiLast, state: AIX.state() }) : (AIX.on() ? 'no AI check ran yet (do a normal Compare first)' : 'AI is off (this build has no Worker address)')) + storesDiag(); } catch (e) { return 'unreadable'; }
}
// ---- end S23-2c ----
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
    var rel = U.relevantByStore(res), cls = U.closeByStore(res); if (!rel) return;
    runs.forEach(function (run) {
      var it = plistItems[run.store];
      if (!it || run.state !== 'ok' || !Object.prototype.hasOwnProperty.call(rel, run.key)) return;
      var s = U.relevanceLine(rel[run.key], cls[run.key] || 0);
      it.st.textContent = s.text; it.st.className = 'st ' + s.kind; it.ic.className = 'ic ' + s.kind;
    });
  } catch (_) { /* the plain store line stays */ }
}
function buildNow(seenAt, sem) { // sem is optional (S22f-2 part 3); left out = the engine ranks exactly as before
  var runs = allRuns(), snaps = runs.filter(function (r) { return r.snapshot; }).map(function (r) { return r.snapshot; });
  var res = SmartSetu.compareAny({ query: live.q, ai: aiLabels || undefined, searches: snaps, products: [], seenAt: seenAt, sem: sem }), v = V.buildView(res, runs, seenAt);
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
  try { SRX.maybeRefresh(); } catch (_) { /* optional */ }
  var kill = Object.assign({}, W.enabledMap(), SRX.enabledMap()), pick = M.pick(q, R.STORES), enabled = {}, why = {}, skipped = [];
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
  if (busy && !only && q === live.userQ) q = live.q; // S23-2c: the same words again while the AI-cleaned search runs = the same search
  if (busy) { if (only || q === live.q) { if (!only) say('Already comparing this search...'); return; } cancelRun(); } else if (offerWt) cancelRun();
  var gen = ++runGen;
  if (!only) aiLabels = null; // labels of the search before must never touch this one
  offerTok++; if (!only) offerRaw = {};
  say(''); setBusy(true);
  var tabs = null, tabs2 = null, out = null, pl = plan(q, only), extra = !!only;
  var fbPrio = {}; try { var rkk = M.rank(q, R.STORES); Object.keys(rkk).forEach(function (k) { fbPrio[k] = rkk[k] === 1 ? 3 : 0; }); } catch (_) { fbPrio = {}; } // S23-11 (D-155): a fetch store that does not usually sell this search gets its fallback tab after the likely stores
  var fr = SmartSetuFetchRead.make(NF.makeFetch(CapacitorHttp, C.desktopUa(navigator.userAgent)), SmartSetuSnapDoc.snapFromHtml);
  function late() { return Date.now() - live.t0 > GATE_MS; }
  var slots = R.makeSlots(MAX_TABS); // S23-13 (D-158): one pool of hidden pages for the whole search (first pass, Myntra and Croma, deferred stores)
  try {
    live.q = q; live.t0 = Date.now(); live.scrolled = extra; live.firstAt = 0;
    if (!extra) { live.runs = {}; skeleton(); $('morebox').hidden = true; initProgress(pl); }
    else { only.forEach(function (l) { if (pl.enabled[l]) setRow(l, 'wait', 'Waiting...', true); }); $('progress').classList.add('running'); maxDone = 0; refreshBar(); }
    retry = false;
    var userQ = q; // S23-2c: the member's own words; the AI may turn them into a clean search phrase + price cap, then THAT is what every store gets
    if (!extra) {
      live.userQ = userQ; live.aiSearch = ''; aiLast = { q: userQ, at: new Date().toISOString() };
      if (AIX.on() && !noAI) { // S23-10h: Full Test Mode switches the AI off for 9 of its 12 searches
        say('Understanding your search...');
        var aiR = await AIX.rewrite(userQ);
        if (gen !== runGen) return;
        say('');
        aiLast.rewrite = aiR.ok ? { search: aiR.search, max_price: aiR.max_price, cached: !!aiR.cached, ms: aiR.ms || 0 } : { reason: aiR.reason };
        var aq = aiR.ok ? SmartSetu.query.aiQuery(aiR.search, aiR.max_price) : '';
        if (aq) { q = aq; live.q = aq; live.aiSearch = aiR.search; aiLabels = { isA: AIX.isAFor(aiR.search), isP: AIX.isPFor(aiR.search) }; } // S23-5: the first draw already asks the engine which cards it could not confirm (aiInfo.unsure); labels of the same phrase from memory apply at once
      }
    }
    function opts(enabled) { return { query: q, enabled: enabled, foreground: false, rereads: 2, rereadMs: 2500, collect: smartsetuCollect, onUpdate: function (r) { if (gen !== runGen) return; updateProgress(r); adopt([r]); if (r.snapshot) liveRender(); }, slots: slots, fallbackPrio: fbPrio, perStoreMs: STORE_MS, deadlineAt: live.t0 + GATE_MS, retryTimeouts: false }; }
    var pass1 = Object.assign({}, pl.enabled); pass1.Myntra = false; pass1.Croma = false; var ord = M.order(q, R.STORES, pl.enabled, SmartSetuFetchRead.STORES_OK, ['myntra', 'croma']); ord.defer.forEach(function (l) { pass1[l] = false; }); /* S23-10e (D-150): tab stores that do not usually sell this kind of product wait until the likely stores are done; none is dropped */ // S20b: Myntra is read on its own after the others (card rescue, below), it does not hold up the rest
    var o1 = opts(pass1); o1.fetchFirst = SmartSetuFetchRead.STORES_OK; o1.fetchRead = fr; o1.fetchMs = 9000; o1.fetchDiag = function (s) { return fr.last && fr.last[s.key] ? JSON.parse(JSON.stringify(fr.last[s.key])) : null; };
    // S23-13 (D-158): Myntra and Croma start at once on their own slot with their own page identity (they were read last and the time gate skipped them: 11 of 11 and 4 of 11 in the 2nd Full Test). Results are kept here and put into out after the other stages.
    var hiRuns = [];
    function skipRun(label) { var st = storeOf(label); return { store: st.label, key: st.key, state: 'skipped', stage: 'waiting', ms: 0 }; }
    /* S23-23 (D-166): one read of Myntra, Croma or a retry never holds the whole search longer than HI_CAP_MS (the Full Test of 27 Nov 2026 had Myntra at 70 s and 224.8 s with 0 results and 7 stores skipped). Over the limit the store counts as timed out, the other stores show their rows. The value is NOT measured on a phone. */
    var HI_CAP_MS = 45000;
    function capRead(st, p) { var t, lim = new Promise(function (res) { t = setTimeout(function () { res({ store: st.label, key: st.key, state: 'timeout', stage: 'reading', ms: HI_CAP_MS, capped: true }); }, HI_CAP_MS); }); return Promise.race([p, lim]).then(function (r) { clearTimeout(t); return r; }, function (e) { clearTimeout(t); throw e; }); }
    async function stepMyntra() {
      if (!pl.enabled.Myntra) return;
      if (late()) { var ms0 = skipRun('Myntra'); hiRuns.push(ms0); updateProgress(ms0); adopt([ms0]); return; }
      tabs2 = tabs2 || mkTabs(C.desktopUa(navigator.userAgent));
      var mr = await capRead(storeOf('Myntra'), W.rescueRead(tabs2, storeOf('Myntra'), q, {}));
      if (gen !== runGen) return;
      hiRuns.push(mr); updateProgress(mr); adopt([mr]); liveRender();
    }
    async function stepCroma() {
      if (!pl.enabled.Croma) return;
      if (late()) { var cs0 = skipRun('Croma'); hiRuns.push(cs0); updateProgress(cs0); adopt([cs0]); return; }
      tabs2 = tabs2 || mkTabs(C.desktopUa(navigator.userAgent)); // S21e: Croma needs a pincode before it shows products; the app types a fixed one (owner: the listing does not change), see W.pincodeSet
      var cr = await capRead(storeOf('Croma'), W.pinRead(tabs2, storeOf('Croma'), q, W.CROMA_PIN, {}));
      if (gen !== runGen) return;
      hiRuns.push(cr); updateProgress(cr); adopt([cr]); liveRender();
    }
    var stepOf = { Myntra: stepMyntra, Croma: stepCroma };
    var hiDone = (async function () { var seq = ord.hi.concat(ord.lo); for (var si = 0; si < seq.length; si++) { await slots.run(si < ord.hi.length ? 1 : 4, stepOf[seq[si]]); if (gen !== runGen) return; } })().catch(function () {});
    tabs = mkTabs();
    out = await runStores(tabs, o1);
    if (gen !== runGen) return;
    adopt(out.runs);
    if (ord.defer.length) { // S23-10e: the deferred tab stores, same kind of tab as the first pass (no desktop user agent)
      if (late()) { ord.defer.forEach(function (l) { var r0 = skipRun(l); W.mergeRuns(out, { runs: [r0] }); r0.retried = false; updateProgress(r0); adopt([r0]); }); }
      else {
        say('Checking ' + ord.defer.join(', ') + '...');
        var tabs3 = mkTabs();
        var rdf = await runStores(tabs3, opts(W.enabledOnly(R.STORES, ord.defer)));
        if (gen !== runGen) return;
        W.mergeRuns(out, rdf); ord.defer.forEach(function (l) { var rr0 = out.runs.filter(function (x) { return x.store === l; })[0]; if (rr0) rr0.retried = false; });
        adopt(out.runs); liveRender();
      }
    }
    await hiDone; if (gen !== runGen) return; // S23-13: Myntra and Croma ran beside the other stages
    if (hiRuns.length) { W.mergeRuns(out, { runs: hiRuns }); hiRuns.forEach(function (r) { if (r.state === 'skipped') r.retried = false; }); }
    var notMyntra = function (l) { return l !== 'Myntra' && l !== 'Croma'; };
    var bad = late() ? [] : W.failingLabels(out.runs).filter(notMyntra); // S23-6c: no second try after the time gate
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
        var sr = await capRead(storeOf(slowL[sl]), W.slowRead(tabs2, storeOf(slowL[sl]), q, smartsetuCollect, {}));
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
        var rr = await capRead(storeOf(empty[em]), W.rescueRead(tabs2, storeOf(empty[em]), q, {}));
        if (gen !== runGen) return;
        if (rr.state === 'ok') { W.mergeRuns(out, { runs: [rr] }); updateProgress(rr); adopt([rr]); }
      }
    }
    if (live.timer) { clearTimeout(live.timer); live.timer = 0; }
    if (!extra) { try { SRX.noteRuns(out.runs); } catch (_) { /* optional */ } try { lastStores = (out.runs || []).map(function (r) { return { s: r.store, st: r.state, g: r.stage || null, ms: r.ms || 0, at: r.doneAt || null, fb: r.fetchFallback || null, ft: r.fetchTries || null, fd: r.fetchDiag || null, fd1: r.fetchDiag1 || null, via: r.via || null, nr: r.noResults ? 1 : null, n: r.cards == null ? null : r.cards }; }); } catch (_) { lastStores = null; } }
    var fin = buildNow(out.seenAt);
    render(fin.view);
    if (!extra) live.skipped = pl.skipped;
    var left = live.skipped.filter(function (l) { return !live.runs[l]; });
    if (left.length) { $('morebtn').textContent = 'Also check ' + left.length + ' other store' + (left.length > 1 ? 's' : '') + ' (' + left.join(', ') + ')'; $('morebox').hidden = false; live.skipped = left; } else $('morebox').hidden = true;
    say('');
    var finView = fin.view;
    if (live.aiSearch && AIX.on()) { // S23-2c: the AI labels the cards on screen; accessories, parts and toys are taken out and the screen is drawn once more only if something was dropped
      say('Checking the results...');
      var rf = await AIX.refine(live.aiSearch, fin, function () { return buildNow(out.seenAt); }, function () { return gen !== runGen; }, function (f, p) { aiLabels = { isA: f, isP: p }; });
      if (gen !== runGen) return;
      aiLast.refine = rf.info; say('');
      if (rf.next) { fin = rf.next; finView = fin.view; render(finView); }
    }
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
// ---- S23-10h (D-151): Full Test Mode hook, used ONLY by the owner panel (devsuite.js via devtest.js), after the owner taps its button (D-010). One normal Compare per call; the AI only when asked; no offer pages. ----
var testing = false, noAI = false;
async function fullRun(q, useAI) {
  var t0 = Date.now(); lastStores = null; lastView = null; noAI = !useAI;
  try { await startRun(q, null); offerTok++; } finally { noAI = false; }
  var rows = []; try { rows = W.rowsOf(lastView).map(function (r) { return { store: r.store, price: r.price, title: r.title, url: r.url }; }); } catch (_) { rows = []; }
  return { ms: Date.now() - t0, stores: lastStores || [], rows: rows, ai: aiLast, runs: allRuns().map(function (r) { return { store: r.store, state: r.state, snapshot: r.snapshot || null }; }) };
}
// ---- end S23-10h ----
function onSubmit(ev) {
  ev.preventDefault();
  if (testing) { say('Full Test Mode is running. Wait for it to finish.'); return; }
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
  $('morebtn').addEventListener('click', function () { if (!busy && !testing && live.skipped.length) startRun(live.q, live.skipped.slice()); });
  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) { c.addEventListener('click', function () { $('q').value = c.getAttribute('data-q') || ''; $('q').focus(); }); });
  // A store link opens in the phone's own browser window (Chrome Custom Tab), not inside the app page.
  $('results').addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a) return;
    var u = safeUrl(a.href); if (!u) return;
    ev.preventDefault();
    InAppBrowser.open({ url: u });
  });
  Dev.attach({ trigger: $('logo'), isBusy: function () { return busy; }, setBusy: setBusy, query: function () { return $('q').value.trim(); }, version: VERSION, R: R, V: V, W: W, C: C, M: M, NF: NF, http: CapacitorHttp, pluginApi: pluginApi, collect: smartsetuCollect, SmartSetu: SmartSetu, SnapDoc: SmartSetuSnapDoc, fetchRead: SmartSetuFetchRead, aiDiag: aiDiag, fullRun: fullRun, testMode: function (on) { testing = !!on; } });
});
