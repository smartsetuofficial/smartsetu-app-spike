/* smartsetu fetchread v1 (S12-12, D-075). Reads a store SEARCH page with one plain request (no tab) and turns the raw HTML into the same search snapshot the tab
 * reader makes (snapdoc.js). Used by runner_core only for the stores in STORES_OK, only inside the Compare click (D-010). No cookies sent (credentials omit),
 * nothing stored. Returns null when the page is not a normal answer (HTTP not 200, redirected to another site, huge) so the caller falls back to a tab. */
(function (root) {
  'use strict';
  // Proven readable without a tab in the owner's Chrome (V-195, query iphone 17pro). Meesho, Tata CLiQ, Croma, Myntra, Ajio gave 0 cards and stay on tabs.
  var STORES_OK = ['amazon', 'flipkart', 'nykaa', 'reliancedigital'];
  // S23-13 (D-158): words a store page uses when a search found nothing (visible text only, any store). Used ONLY for a fetched page with 0 cards.
  var NO_RES = /\bno results?\b|\bno (?:products?|items?|matches|listings?) (?:found|available|matched)|did(?: not|n't) match any|(?:could not|couldn't|can't|cannot|unable to) find (?:any|a match)|\b0 results?\b|nothing (?:found|matched)/i;
  var NO_RES_URL = /no[-_]?search[-_]?results|no[-_]?results/i;
  var EXTRA = []; // S23-18 (D-163): extra no-results words from the store record (data only, lower case)
  function bare(h) { return String(h || '').toLowerCase().replace(/^www\./, ''); }
  function sameSite(a, b) { try { var x = bare(new URL(a).hostname), y = bare(new URL(b).hostname); return x === y || x.endsWith('.' + y) || y.endsWith('.' + x); } catch (_) { return false; } }

  // S23-16 (D-161, ALL stores): a store that has nothing for the search can answer with its HOME page (Reliance Digital, 0.10.27 report: 616 KB, title "Online Electronic Shopping Store in India", 0 cards, for shoes, lipstick, protein). That is "no results", not a failure: no 20 s tab. Two signs, both store independent: (1) the final address is the store root while the search address was not; (2) 0 cards, the page title has none of the search words AND the title is a shop-home title ("Online ... Store/Shopping"). A blank page with another title (Amazon, D-158) still goes to the tab.
  var STOP = { for: 1, and: 1, the: 1, with: 1, under: 1, over: 1, from: 1, best: 1, cheap: 1, buy: 1, online: 1, price: 1, ke: 1, ka: 1, ki: 1, andar: 1, sasta: 1, kam: 1 };
  var HOME_TITLE = /\bonline\s+(?:[a-z]+\s+){0,3}(?:store|shopping|shop)\b|\bshop online\b|\bofficial (?:site|store|website)\b|\bhome\s?page\b/i;
  function searchWords(q) { return String(q || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 3 && !STOP[w]; }); }
  function homeAnswer(reqUrl, finUrl, title, query) {
    try {
      var rp = new URL(reqUrl).pathname, fp = new URL(finUrl).pathname;
      if ((fp === '/' || fp === '') && rp !== '/' && rp !== '') return true;
    } catch (_) { /* fall through to the title sign */ }
    var words = searchWords(query), t = String(title || '');
    if (!words.length || !t) return false;
    var low = t.toLowerCase();
    if (words.some(function (w) { return low.indexOf(w) >= 0; })) return false;
    return HOME_TITLE.test(t);
  }

  function make(fetchFn, snapFromHtml) {
    // S23-9b (D-143): read.last[store.key] keeps what the LAST read of that store saw (HTTP status, bytes, first words, robot-check words, cards) for the owner report. No page text is stored beyond 60 characters, nothing is sent anywhere.
    var last = {};
    var read = async function read(store, query, signal) {
      var url = store.url(query), d = last[store.key] = { http: null, bytes: null, head: '', robot: false, cards: null, nr: false, title: '', fin: '' };
      var resp = await fetchFn(url, { credentials: 'omit', redirect: 'follow', cache: 'no-store', signal: signal });
      d.http = resp ? resp.status : null;
      if (!resp || resp.status !== 200) return null;
      try { d.fin = new URL(resp.url || url).pathname.slice(0, 60); } catch (_) { /* report only */ }
      if (!sameSite(url, resp.url || url)) { d.head = 'other site'; return null; }
      var txt = await resp.text();
      if (typeof txt !== 'string') return null;
      d.bytes = txt.length;
      try { var tm = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(txt.slice(0, 200000)); if (tm) d.title = tm[1].replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 80); } catch (_) { /* report only */ }
      try {
        var plain = txt.slice(0, 60000).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]*>/gi, ' ').replace(/\s+/g, ' ').trim();
        d.head = plain.slice(0, 60); d.robot = /robot|captcha|verify you are human|access denied|unusual traffic|are you a human/i.test(plain.slice(0, 3000));
      } catch (_) { /* diagnostics never block a read */ }
      if (txt.length < 1000 || txt.length > 6000000) return null;
      var snap = snapFromHtml(txt, resp.url || url, query);
      try { d.cards = snap && snap.cards ? snap.cards.length : null; } catch (_) { /* ignore */ }
      if (d.cards === 0) { // S23-13 (D-158): an empty list counts as "no results" only when the page itself says so (words in the visible text, or a no-results address); a blank or unknown page goes to the tab as before
        try {
          var byUrl = NO_RES_URL.test(String(resp.url || url).split('?')[0]);
          var vis = txt.slice(0, 1500000).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]*>/gi, ' ').replace(/\s+/g, ' ');
          var byText = NO_RES.test(vis); if (!byText && EXTRA.length) { var lv = vis.toLowerCase(); for (var xi = 0; xi < EXTRA.length; xi++) { if (lv.indexOf(EXTRA[xi]) >= 0) { byText = true; break; } } }
          d.nr = byUrl || byText; if (d.nr) d.nrWhy = byUrl ? 'url' : 'text';
          if (!d.nr && homeAnswer(url, resp.url || url, d.title, query)) { d.nr = true; d.nrWhy = 'home'; } // S23-16 (D-161)
        } catch (_) { d.nr = false; }
      }
      return snap;
    };
    read.last = last;
    return read;
  }

  var api = { setNrWords: function (a) { EXTRA = Array.isArray(a) ? a.slice() : []; }, STORES_OK: STORES_OK, make: make, sameSite: sameSite, homeAnswer: homeAnswer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    api.read = (typeof fetch === 'function' && root.SmartSetuSnapDoc) ? make(function (u, o) { return fetch(u, o); }, root.SmartSetuSnapDoc.snapFromHtml) : undefined;
    root.SmartSetuFetchRead = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
