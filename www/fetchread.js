/* smartsetu fetchread v1 (S12-12, D-075). Reads a store SEARCH page with one plain request (no tab) and turns the raw HTML into the same search snapshot the tab
 * reader makes (snapdoc.js). Used by runner_core only for the stores in STORES_OK, only inside the Compare click (D-010). No cookies sent (credentials omit),
 * nothing stored. Returns null when the page is not a normal answer (HTTP not 200, redirected to another site, huge) so the caller falls back to a tab. */
(function (root) {
  'use strict';
  // Proven readable without a tab in the owner's Chrome (V-195, query iphone 17pro). Meesho, Tata CLiQ, Croma, Myntra, Ajio gave 0 cards and stay on tabs.
  var STORES_OK = ['amazon', 'flipkart', 'nykaa', 'reliancedigital'];
  function bare(h) { return String(h || '').toLowerCase().replace(/^www\./, ''); }
  function sameSite(a, b) { try { var x = bare(new URL(a).hostname), y = bare(new URL(b).hostname); return x === y || x.endsWith('.' + y) || y.endsWith('.' + x); } catch (_) { return false; } }

  function make(fetchFn, snapFromHtml) {
    // S23-9b (D-143): read.last[store.key] keeps what the LAST read of that store saw (HTTP status, bytes, first words, robot-check words, cards) for the owner report. No page text is stored beyond 60 characters, nothing is sent anywhere.
    var last = {};
    var read = async function read(store, query, signal) {
      var url = store.url(query), d = last[store.key] = { http: null, bytes: null, head: '', robot: false, cards: null };
      var resp = await fetchFn(url, { credentials: 'omit', redirect: 'follow', cache: 'no-store', signal: signal });
      d.http = resp ? resp.status : null;
      if (!resp || resp.status !== 200) return null;
      if (!sameSite(url, resp.url || url)) { d.head = 'other site'; return null; }
      var txt = await resp.text();
      if (typeof txt !== 'string') return null;
      d.bytes = txt.length;
      try {
        var plain = txt.slice(0, 60000).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]*>/gi, ' ').replace(/\s+/g, ' ').trim();
        d.head = plain.slice(0, 60); d.robot = /robot|captcha|verify you are human|access denied|unusual traffic|are you a human/i.test(plain.slice(0, 3000));
      } catch (_) { /* diagnostics never block a read */ }
      if (txt.length < 1000 || txt.length > 6000000) return null;
      var snap = snapFromHtml(txt, resp.url || url, query);
      try { d.cards = snap && snap.cards ? snap.cards.length : null; } catch (_) { /* ignore */ }
      return snap;
    };
    read.last = last;
    return read;
  }

  var api = { STORES_OK: STORES_OK, make: make, sameSite: sameSite };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    api.read = (typeof fetch === 'function' && root.SmartSetuSnapDoc) ? make(function (u, o) { return fetch(u, o); }, root.SmartSetuSnapDoc.snapFromHtml) : undefined;
    root.SmartSetuFetchRead = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
