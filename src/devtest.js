/* DEV-ONLY (D-096): hidden store test for the owner's phone. Remove this file and its require in app.js before the store release.
 * Opens only after 7 quick taps on the logo. Runs every store once the slow way and once the fast way, then shows ONE plain-text report the owner can copy.
 * Reads only what the store pages show (same page functions as before), sends nothing anywhere, stores nothing. */
'use strict';

function strip(html) { return String(html || '').replace(/<script[^]*?<\/script>/gi, ' ').replace(/<style[^]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }
function flags(text) {
  var f = [];
  if (/captcha|not a robot|unusual traffic|verify you are human|robot check/i.test(text)) f.push('robot-check words');
  if (/access denied|forbidden|blocked|request unsuccessful/i.test(text)) f.push('access-denied words');
  if (/pincode|pin code|delivery location|enter your location/i.test(text)) f.push('pincode words');
  if (/__myx|__INITIAL_STATE__|__NEXT_DATA__|application\/ld\+json/i.test(text)) f.push('script data present');
  return f;
}
function sec(ms) { return ms >= 1000 ? Math.round(ms / 100) / 10 + ' s' : (ms || 0) + ' ms'; }

// One line per store for the fast (no page) read. r = { label, status, finalUrl, bytes, sameSite, cards, ms, head, flags, error }
function fastLine(r) {
  if (r.error) return r.label + ' | fast read FAILED after ' + sec(r.ms) + ' | ' + String(r.error).replace(/\s+/g, ' ').slice(0, 140);
  return r.label + ' | fast read | HTTP ' + r.status + ' | ' + r.bytes + ' bytes | same site ' + (r.sameSite ? 'yes' : 'NO (' + String(r.finalUrl).slice(0, 80) + ')') + ' | cards read ' + r.cards + ' | ' + sec(r.ms) + (r.flags.length ? ' | ' + r.flags.join(', ') : '') + ' | page starts: ' + String(r.head).slice(0, 160);
}

async function runFull(env, log) {
  var R = env.R, W = env.W, V = env.V, C = env.C, M = env.M, q = env.query() || 'iphone 17 pro', t0 = Date.now(), ua = C.desktopUa(navigator.userAgent);
  var notes = [], fast = [], struct = [], rescue = [], listings = [], rows = [], runs = [], tabs = null, tabs2 = null, err = null;
  var pickInfo = M.pick(q, R.STORES);
  notes.push('Category pick: ' + (pickInfo.cats.join(', ') || 'none (every store is checked)') + ' | would open: ' + pickInfo.keys.join(', ') + ' | would skip: ' + (Object.keys(pickInfo.skip).join(', ') || 'none') + ' (this test opens ALL stores)');
  try { var pq = env.SmartSetu.query.parse(q); notes.push('ENGINE: query v' + env.SmartSetu.query.version + ' | parser v' + env.SmartSetu.parser.version + ' | app ' + (env.version || '?') + ' | parsed ' + JSON.stringify({ kidsQ: pq.kidsQ, sub: pq.sub, gender: pq.gender, age: pq.age, cat: pq.cat && pq.cat.term, winter: pq.winter, extras: pq.extras, models: pq.models, maxPrice: pq.maxPrice })); } catch (e) { notes.push('ENGINE line failed: ' + String(e && e.message).slice(0, 80)); }
  try {
    log('Step 1 of 3: fast read of every store...');
    var nf = env.NF.makeFetch(env.http, ua), fr = env.fetchRead;
    var lines = await Promise.all(R.STORES.map(async function (s) {
      var t1 = Date.now(), r = { label: s.label, ms: 0, flags: [], head: '', cards: 0 };
      try {
        var url = s.url(q), resp = await nf(url), txt = await resp.text(), snap = null;
        r.status = resp.status; r.finalUrl = resp.url; r.bytes = txt.length; r.sameSite = fr.sameSite(url, resp.url || url);
        r.head = strip(txt).slice(0, 160); r.flags = flags(txt);
        try { snap = env.SnapDoc.snapFromHtml(txt, resp.url || url, q); r.cards = snap && snap.cards ? snap.cards.length : 0; } catch (e) { r.flags.push('snapshot error: ' + String(e && e.message).slice(0, 60)); }
      } catch (e) { r.error = String((e && e.message) || e); }
      r.ms = Date.now() - t1; return fastLine(r);
    }));
    fast = lines;
    log('Step 2 of 3: every store in a hidden page, one after another (this takes minutes)...');
    tabs = W.createWebTabs(env.pluginApi());
    var out = await R.runAll(tabs, { query: q, enabled: {}, foreground: false, rereads: 2, rereadMs: 2500, collect: env.collect, maxTabs: 1, perStoreMs: 50000, retryTimeouts: false, onUpdate: function (r) { log('Step 2 of 3: ' + r.store + ' ' + r.state); } });
    runs = out.runs;
    var res = env.SmartSetu.compareAny({ query: q, searches: out.snapshots, products: [], seenAt: out.seenAt }), view = V.buildView(res, runs, out.seenAt);
    try { var tc = {}; (res.quarantine || []).forEach(function (x) { var k = tc[x.store] = tc[x.store] || { t3: 0, t2: 0, miss: 0 }; if (x.tier === 3) k.t3++; else if (x.tier === 2) { k.t2++; if (x.miss) k.miss++; } }); notes.push('TIERS per store (tier 3 / tier 2 / tier 2 close) ' + JSON.stringify(tc) + ' | counts ' + JSON.stringify(res.counts) + ' | similar ' + JSON.stringify(res.similar && res.similar.counts)); } catch (_) {}
    try { rows = (W.rowsOf(view) || []).map(function (r) { return { store: r.store, price: r.price, title: r.title }; }); } catch (_) {}
    try { listings = W.listingLines(runs, W.rowsOf(view), env.SmartSetu.parseSearch); } catch (e) { listings = ['(listing lines failed: ' + String(e && e.message).slice(0, 80) + ')']; }
    log('Step 3 of 3: page structure of every store that gave no listings...');
    var bad = runs.filter(function (r) { return r.state !== 'ok'; });
    tabs2 = W.createWebTabs(env.pluginApi(ua));
    for (var i = 0; i < bad.length; i++) {
      var st = R.STORES.filter(function (s) { return s.key === bad[i].key; })[0]; if (!st) continue;
      log('Step 3 of 3: ' + st.label + '...');
      var pr = await W.readPage(tabs2, st.url(q), W.structureProbe, { settleMs: 4000 });
      struct = struct.concat(W.structLines(st.label, pr));
      var rr = await W.rescueRead(tabs2, st, q, {});
      rescue = rescue.concat(W.rescueLines(st.label, rr));
    }
  } catch (e) { err = e; }
  finally { try { if (tabs) tabs.dispose(); if (tabs2) tabs2.dispose(); } catch (_) {} }
  var diag = notes.concat(['FAST READ (no page, phone network layer, desktop identity)'], fast, ['', 'HIDDEN PAGE (per store: page state when no listings)']);
  runs.forEach(function (r) { if (r.diag) diag.push(r.store + ' | ' + JSON.stringify(r.diag)); });
  return W.buildReport({ version: env.version, query: q, seenAt: new Date().toISOString(), totalS: Math.round((Date.now() - t0) / 1000), ua: navigator.userAgent, error: err && (err.message || err), runs: runs, rows: rows, diag: diag, struct: struct, rescue: rescue, listings: listings });
}

function attach(env) {
  var taps = [], panel = null;
  function build() {
    var main = document.querySelector('main') || document.body;
    panel = document.createElement('section'); panel.className = 'card devtest'; panel.id = 'devtest';
    var h = document.createElement('h2'); h.textContent = 'Store test'; panel.appendChild(h);
    var p = document.createElement('p'); p.className = 'note'; p.textContent = 'For the owner only. Opens every store and writes one report. It takes several minutes. Keep the app open.'; panel.appendChild(p);
    var go = document.createElement('button'); go.type = 'button'; go.className = 'btn'; go.textContent = 'Run full store test'; panel.appendChild(go);
    var status = document.createElement('p'); status.className = 'note'; panel.appendChild(status);
    var ta = document.createElement('textarea'); ta.readOnly = true; ta.rows = 12; ta.className = 'devout'; ta.hidden = true; panel.appendChild(ta);
    var cp = document.createElement('button'); cp.type = 'button'; cp.className = 'btn ghost'; cp.textContent = 'Copy report'; cp.hidden = true; panel.appendChild(cp);
    main.insertBefore(panel, main.firstChild);
    go.addEventListener('click', async function () {
      if (env.isBusy()) { status.textContent = 'A comparison is running. Wait for it to finish.'; return; }
      go.disabled = true; ta.hidden = true; cp.hidden = true; env.setBusy(true);
      try { var rep = await runFull(env, function (t) { status.textContent = t; }); ta.value = rep; ta.hidden = false; cp.hidden = false; status.textContent = 'Done. Tap Copy report and paste it to the AI.'; }
      catch (e) { status.textContent = 'The test could not finish: ' + String((e && e.message) || e).slice(0, 120); }
      finally { env.setBusy(false); go.disabled = false; }
    });
    cp.addEventListener('click', function () {
      var done = function () { status.textContent = 'Copied.'; };
      try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(ta.value).then(done, function () { ta.select(); status.textContent = 'Select all and copy by hand.'; }); return; } } catch (_) {}
      ta.select(); try { document.execCommand('copy'); done(); } catch (_) { status.textContent = 'Select all and copy by hand.'; }
    });
  }
  env.trigger.addEventListener('click', function () {
    var now = Date.now(); taps = taps.filter(function (t) { return now - t < 6000; }); taps.push(now);
    if (taps.length >= 7) { taps = []; if (!panel) { build(); panel.hidden = true; } panel.hidden = !panel.hidden; if (!panel.hidden) { try { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {} } }
  });
}

module.exports = { attach: attach, runFull: runFull, fastLine: fastLine, flags: flags, strip: strip };
