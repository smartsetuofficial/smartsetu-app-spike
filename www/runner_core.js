/* smartsetu extension / runner_core v1.1 (S12-2, D-063; S12-12 D-075 hybrid fetch-first). Opens ONE search tab per enabled store (stores in o.fetchFirst are tried by a plain request first), only when runAll() is called
 * (the page calls it only from the owner's Compare click, D-010). Reads each tab with the injected collect function, closes the tab.
 * Works with any "api" that has chrome-like tabs + scripting (real chrome in the extension page, a mock in test_extension.js).
 * No network, no storage, no cookies. */
(function (root) {
  'use strict';
  var STORES = [
    { key: 'amazon', label: 'Amazon', url: function (q) { return 'https://www.amazon.in/s?k=' + encodeURIComponent(q); } },
    { key: 'flipkart', label: 'Flipkart', url: function (q) { return 'https://www.flipkart.com/search?q=' + encodeURIComponent(q); } },
    { key: 'myntra', label: 'Myntra', url: function (q) { return 'https://www.myntra.com/' + encodeURIComponent(q.trim().replace(/\s+/g, '-')); } },
    { key: 'ajio', label: 'Ajio', url: function (q) { return 'https://www.ajio.com/search/?text=' + encodeURIComponent(q); } },
    { key: 'nykaa', label: 'Nykaa', url: function (q) { return 'https://www.nykaa.com/search/result/?q=' + encodeURIComponent(q); } },
    { key: 'meesho', label: 'Meesho', url: function (q) { return 'https://www.meesho.com/search?q=' + encodeURIComponent(q); } },
    { key: 'tatacliq', label: 'Tata CLiQ', url: function (q) { return 'https://www.tatacliq.com/search/?searchCategory=all&text=' + encodeURIComponent(q); } },
    { key: 'croma', label: 'Croma', url: function (q) { return 'https://www.croma.com/searchB?q=' + encodeURIComponent(q) + '%3Arelevance&text=' + encodeURIComponent(q); } },
    { key: 'reliancedigital', label: 'Reliance Digital', url: function (q) { return 'https://www.reliancedigital.in/products?q=' + encodeURIComponent(q); } }
  ];
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function waitLoad(api, tabId, ms) {
    return new Promise(function (res) {
      var t = null, l = null;
      function done(ok) { clearTimeout(t); api.tabs.onUpdated.removeListener(l); res(ok === true); }
      t = setTimeout(function () { done(false); }, ms);
      l = function (id, info) { if (id === tabId && info && info.status === 'complete') done(true); };
      api.tabs.onUpdated.addListener(l);
      Promise.resolve(api.tabs.get(tabId)).then(function (tab) { if (tab && tab.status === 'complete') done(true); }, function () {});
    });
  }

  // Stage tracking (S12-4 diagnostic): ctx.stage says where a store's job is right now, so a timeout can name the place it got stuck.
  function setStage(ctx, s) { ctx.stage = s; ctx.stageAt = Date.now(); }

  // Runs inside the store page (diagnostic only): page state, tab visibility, number of links. Reads no text, no login, no cookies.
  function pageInfo() { return { readyState: document.readyState, visibility: document.visibilityState, links: document.querySelectorAll('a[href]').length }; }

  async function runStore(api, store, query, o, ctx) {
    var t0 = Date.now(), tab = null;
    function ms() { return Date.now() - t0; }
    try {
      setStage(ctx, 'opening');
      tab = await api.tabs.create({ url: store.url(query), active: !!o.foreground });
      ctx.tabId = tab.id;
      setStage(ctx, 'loading');
      ctx.loaded = await waitLoad(api, tab.id, o.loadMs == null ? 30000 : o.loadMs);
      setStage(ctx, 'settling');
      await sleep(o.settleMs == null ? 1500 : o.settleMs);
      setStage(ctx, 'reading');
      var snap = null, tries = 0, maxTries = 1 + (o.rereads > 0 ? o.rereads : 0);
      for (;;) { // S12-8 (D-073, all stores): a list that is empty or unreadable is read again in the same tab (o.rereads times, o.rereadMs apart), so a page that draws late is not reported as empty
        var res = await api.scripting.executeScript({ target: { tabId: tab.id }, func: o.collect, args: [query] });
        snap = res && res[0] && res[0].result; tries++;
        if ((snap && Array.isArray(snap.cards) && snap.cards.length) || tries >= maxTries) break;
        setStage(ctx, 'settling'); await sleep(o.rereadMs == null ? 2500 : o.rereadMs); setStage(ctx, 'reading');
      }
      var extra = tries > 1 ? { rereads: tries - 1 } : {};
      if (!(snap && Array.isArray(snap.cards) && snap.cards.length) && o.rereads > 0) { // still empty: ask the page only for its state (no text, no links), so the cause can be seen
        try {
          var dg = await api.scripting.executeScript({ target: { tabId: tab.id }, func: pageInfo, args: [] });
          dg = dg && dg[0] && dg[0].result;
          if (dg && typeof dg.readyState === 'string') extra.diag = { readyState: dg.readyState, visibility: String(dg.visibility), links: Number(dg.links) || 0 };
        } catch (_) {}
      }
      if (!snap || !Array.isArray(snap.cards)) return Object.assign({ store: store.label, key: store.key, state: 'no_data', ms: ms() }, extra);
      return Object.assign({ store: store.label, key: store.key, state: snap.cards.length ? 'ok' : 'no_cards', cards: snap.cards.length, snapshot: snap, ms: ms() }, extra);
    } catch (e) {
      return { store: store.label, key: store.key, state: 'error', error: String((e && e.message) || e), stage: ctx.stage, ms: ms() };
    } finally {
      if (tab) { try { await api.tabs.remove(tab.id); } catch (_) {} }
    }
  }

  // o: { query, enabled:{label:bool}, foreground, collect(fn), onUpdate(run), perStoreMs, loadMs, settleMs }
  async function runAll(api, o) {
    var query = String((o && o.query) || '').trim();
    if (!query) throw new Error('empty query');
    if (typeof o.collect !== 'function') throw new Error('collect function missing');
    var enabled = o.enabled || {}, perStore = o.perStoreMs == null ? 60000 : o.perStoreMs;
    var runs = [], tStart = Date.now(), tFirst = 0;
    function guarded(store) {
      var ctx = { tabId: null, stage: 'opening', stageAt: Date.now(), loaded: null }, timer = null;
      var guard = new Promise(function (res) {
        timer = setTimeout(function () {
          if (ctx.tabId != null) { try { Promise.resolve(api.tabs.remove(ctx.tabId)).catch(function () {}); } catch (_) {} }
          res({ store: store.label, key: store.key, state: 'timeout', stage: ctx.stage, stageMs: Date.now() - ctx.stageAt, loaded: ctx.loaded, ms: perStore });
        }, perStore);
      });
      return Promise.race([runStore(api, store, query, o, ctx), guard]).then(function (r) { clearTimeout(timer); return r; });
    }
    // S12-12 (D-075): optional hybrid. A store listed in o.fetchFirst is read by ONE plain request (o.fetchRead, no tab). If that gives no cards, fails or is slow,
    // the same store is read by a tab exactly as before. o.maxTabs limits how many tabs are open at the same time (default: no limit, as before).
    var fetchSet = {}; (o.fetchFirst || []).forEach(function (k) { fetchSet[k] = 1; });
    var useFetch = typeof o.fetchRead === 'function', maxTabs = o.maxTabs > 0 ? o.maxTabs : Infinity, activeTabs = 0, waiting = [];
    function acquire() { if (maxTabs === Infinity) return Promise.resolve(); return new Promise(function (res) { if (activeTabs < maxTabs) { activeTabs++; res(); } else waiting.push(res); }); }
    function release() { if (maxTabs === Infinity) return; activeTabs--; var w = waiting.shift(); if (w) { activeTabs++; w(); } }
    function tabJob(store, extra) {
      return acquire().then(function () { return guarded(store); }).then(function (r) { release(); if (extra) Object.assign(r, extra); return r; }, function (e) { release(); throw e; });
    }
    function fetchJob(store) {
      var t0 = Date.now(), timer = null, ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null, fetchMs = o.fetchMs == null ? 15000 : o.fetchMs;
      var guard = new Promise(function (res) { timer = setTimeout(function () { if (ctl) { try { ctl.abort(); } catch (_) {} } res({ fail: 'timeout' }); }, fetchMs); });
      var work = Promise.resolve().then(function () { return o.fetchRead(store, query, ctl ? ctl.signal : undefined); })
        .then(function (snap) { return (snap && Array.isArray(snap.cards) && snap.cards.length) ? { snap: snap } : { fail: 'no_cards' }; }, function () { return { fail: 'error' }; });
      return Promise.race([work, guard]).then(function (w) {
        clearTimeout(timer);
        if (w.snap) return { store: store.label, key: store.key, state: 'ok', cards: w.snap.cards.length, snapshot: w.snap, ms: Date.now() - t0, via: 'fetch' };
        return tabJob(store, { fetchFallback: w.fail, fetchMs: Date.now() - t0 });
      });
    }
    var jobs = STORES.map(function (store) {
      if (enabled[store.label] === false) {
        var off = { store: store.label, key: store.key, state: 'off', ms: 0 };
        runs.push(off); if (o.onUpdate) o.onUpdate(off); return Promise.resolve(off);
      }
      return ((useFetch && fetchSet[store.key]) ? fetchJob(store) : tabJob(store)).then(function (r) { runs.push(r); if (o.onUpdate) o.onUpdate(r); return r; });
    });
    await Promise.all(jobs);
    tFirst = Date.now() - tStart;
    // D-069: a store that timed out gets ONE more try, alone, after the other stores are done (never 2 tabs of the same store, no extra load while others run).
    if (o.retryTimeouts !== false) {
      var firstTry = runs.filter(function (r) { return r.state === 'timeout'; });
      for (var i = 0; i < firstTry.length; i++) {
        var failed = firstTry[i], store2 = STORES.filter(function (s) { return s.key === failed.key; })[0];
        if (!store2) continue;
        if (o.onUpdate) o.onUpdate({ store: failed.store, key: failed.key, state: 'retrying' });
        var again = await guarded(store2); again.retried = true; again.firstTry = { state: failed.state, stage: failed.stage, ms: failed.ms };
        runs[runs.indexOf(failed)] = again;
        if (o.onUpdate) o.onUpdate(again);
      }
    }
    var order = {}; STORES.forEach(function (s, i) { order[s.label] = i; });
    runs.sort(function (a, b) { return order[a.store] - order[b.store]; });
    return {
      query: query, seenAt: new Date().toISOString(), totalMs: Date.now() - tStart, firstRoundMs: tFirst, runs: runs,
      snapshots: runs.filter(function (r) { return r.snapshot; }).map(function (r) { return r.snapshot; })
    };
  }

  var api = { STORES: STORES, runAll: runAll, runStore: runStore, waitLoad: waitLoad };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SmartSetuRunner = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
