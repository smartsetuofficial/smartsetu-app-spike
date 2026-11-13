/* smartsetu extension / view v1 (S12-2, D-063, D-061, D-024). Pure: turns the compare engine result into a plain "view model" the page draws.
 * No DOM, no network, no storage. Rules: no "best pick" wording; "Lowest price found" only when 2+ stores show the SAME product;
 * different products are labelled "similar, not the same item"; nothing is invented (missing = not shown). */
(function (root) {
  'use strict';
  var NAMES = { amazon: 'Amazon', flipkart: 'Flipkart', myntra: 'Myntra', ajio: 'Ajio', nykaa: 'Nykaa', meesho: 'Meesho', tatacliq: 'Tata CLiQ', croma: 'Croma', reliancedigital: 'Reliance Digital' };
  var STATE_TEXT = { ok: 'Results read', no_cards: 'No listings found on the page', no_data: 'Page gave no readable data', error: 'Could not open the page', timeout: 'Took too long', off: 'Switched off', retrying: 'Trying once more...' };
  // Where a timed-out store got stuck (runner_core stage names). Unknown or missing stage = plain wording, nothing guessed.
  var STAGE_TEXT = { opening: 'opening the tab', loading: 'loading the page', settling: 'waiting after the page loaded', reading: 'reading the page' };
  // S12-13 (D-073): how a store was read. via 'fetch' = plain request, no tab. fetchFallback = the plain request failed and a tab was used (reason from runner_core). Same for every store; stores never tried by fetch show nothing here (tab only).
  var FALLBACK_TEXT = { no_cards: 'tab used, plain read found no listings', error: 'tab used, plain read failed', timeout: 'tab used, plain read was slow' };
  function storeName(k) { return NAMES[k] || k; }
  function secs(ms) { return ms >= 1000 ? Math.round(ms / 1000) + ' s' : ''; }
  function rupees(paise) {
    if (!(paise > 0)) return null;
    var r = paise / 100;
    return '\u20B9' + r.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  function availNote(x) { return x.availability === 'unavailable' ? 'Looks unavailable' : null; } // unknown stock is not repeated on every row: search pages do not show stock, the footer says so once

  function row(store, title, url, pricePaise, mrpPaise, availability, isLowest, odd) {
    var mrp = mrpPaise > pricePaise ? rupees(mrpPaise) : null;
    return { store: store, title: title, url: url, price: rupees(pricePaise), pricePaise: pricePaise, storeMrp: mrp, note: odd ? 'Price looks wrong, not counted' : availNote({ availability: availability }), isLowest: !!isLowest && !odd, odd: !!odd };
  }

  function storeLines(runs, status) {
    return (runs || []).map(function (r) {
      var text = STATE_TEXT[r.state] || r.state;
      if (r.state === 'ok' && r.cards != null) text = 'Read ' + r.cards + ' listing' + (r.cards === 1 ? '' : 's') + (secs(r.ms) ? ' in ' + secs(r.ms) : '');
      if (r.state === 'timeout' && STAGE_TEXT[r.stage] && r.ms > 0) text = 'Took too long (stuck while ' + STAGE_TEXT[r.stage] + ', ' + Math.round(r.ms / 1000) + ' s)';
      if (r.retried && r.state !== 'off' && r.state !== 'retrying') text += r.state === 'timeout' ? ' (tried twice)' : ' (after trying once more)';
      if (r.state === 'ok' && r.rereads) text += ' (read again ' + r.rereads + (r.rereads === 1 ? ' time' : ' times') + ')';
      if (r.via === 'fetch') text += ' (no tab)';
      else if (r.fetchFallback && FALLBACK_TEXT[r.fetchFallback] && r.state !== 'off' && r.state !== 'retrying') text += ' (' + FALLBACK_TEXT[r.fetchFallback] + ')';
      if ((r.state === 'no_cards' || r.state === 'no_data') && r.diag) text += ' (page ' + r.diag.readyState + ', ' + (r.diag.visibility === 'hidden' ? 'hidden tab' : r.diag.visibility + ' tab') + ', ' + r.diag.links + ' links, read ' + ((r.rereads || 0) + 1) + ' times)';
      return { store: r.store, state: r.state, text: text };
    });
  }

  // One plain line about time: total, and (only if a store was tried again) the first round and the second try. Numbers come from runAll, nothing guessed.
  function timeLine(out) {
    if (!out || !(out.totalMs >= 1000)) return '';
    var t = 'Stores checked in ' + secs(out.totalMs);
    var again = (out.runs || []).some(function (r) { return r.retried; });
    if (again && out.firstRoundMs >= 1000 && out.totalMs > out.firstRoundMs) t += ' (first round ' + secs(out.firstRoundMs) + ', second try ' + secs(out.totalMs - out.firstRoundMs) + ')';
    return t + '.';
  }

  // result = SmartSetu.compareAny(...) ; runs = runAll().runs ; seenAt = ISO string
  function buildView(result, runs, seenAt) {
    var q = (result && result.query) || {}, specific = !!(q.models && q.models.length && q.brand); // D-071: model but no known brand cannot be merged safely -> similar products view
    var v = { mode: 'none', headline: '', note: '', groups: [], stores: storeLines(runs), seenAt: seenAt || null,
      footer: 'Prices are what your browser saw at the time shown and can change. Stock is not shown on store search pages. Check the store before you buy.' };
    if (specific) {
      var cl = (result.clusters || []).filter(function (c) { return c.queryMatch; });
      if (!cl.length) { v.headline = 'No matching listing found'; v.note = 'None of the stores showed a listing that matches every part of your search.'; return v; }
      v.mode = 'specific'; v.headline = 'Matching listings';
      cl.forEach(function (c) {
        var pick = c.pick, comparable = !!(pick && pick.comparable);
        var isOdd = function (m) { return (m.flags || []).indexOf('E_PRICE_BAND') >= 0 ? 1 : 0; }; // D-073: a price far from its peers (any store) goes last and is never shown as lowest
        var members = c.members.slice().sort(function (a, b) { return (isOdd(a) - isOdd(b)) || (a.pricePaise - b.pricePaise) || (a.store < b.store ? -1 : 1); });
        v.groups.push({
          title: members[0].title, stores: members.map(function (m) { return storeName(m.store); }).filter(function (x, i, a) { return a.indexOf(x) === i; }),
          comparable: comparable,
          label: comparable ? 'Lowest price found' : null,
          note: comparable ? 'Lowest of the stores checked for this listing. This is about price only, not quality.' : 'Only one store showed this listing, so there is nothing to compare it with.',
          rows: members.map(function (m) { return row(storeName(m.store), m.title, m.url, m.pricePaise, m.mrpPaise, m.availability, comparable && pick.member && pick.member.url === m.url, isOdd(m) === 1); })
        });
      });
      return v;
    }
    var s = result.similar;
    if ((!s || !s.stores || !s.stores.length) && q.models && q.models.length && result.counts && result.counts.listings > 0) { v.headline = 'No matching listing found'; v.note = 'None of the stores showed a listing that matches every part of your search.'; return v; } // D-071
    if (!s || !s.stores || !s.stores.length) { v.headline = 'No usable listings'; v.note = 'The stores did not return listings we can show for this search.'; return v; }
    v.mode = 'similar'; v.headline = 'Similar products'; v.note = s.note || 'Different products from each store. Not the same item, so no best price is claimed.';
    s.stores.forEach(function (st) {
      v.groups.push({
        title: storeName(st.store), stores: [storeName(st.store)], comparable: false, label: null,
        note: st.total > 0 ? 'Showing ' + st.shown + ' of ' + st.total + ' listings, cheapest first.' : 'No exact match here. Close matches are listed below.',
        rows: st.items.map(function (m) { var r = row(storeName(st.store), m.title, m.url, m.pricePaise, null, m.availability, false); if (m.low) r.note = 'Much cheaper than the other listings. Check it before you buy (it may be a part or an accessory). Not counted as the lowest.'; return r; })
      });
    });
    // Step 2b: the cheapest listing each store showed, side by side. Different products, so not ranked and no best claim (D-061, D-024).
    var topRows = [];
    s.stores.forEach(function (st) { var m = st.cheapest !== undefined ? st.cheapest : (st.items && st.items[0]); if (m) topRows.push(row(storeName(st.store), m.title, m.url, m.pricePaise, null, m.availability, false)); });
    s.stores.forEach(function (st) { if (st.close && st.close.length) v.groups.push({ title: storeName(st.store) + ': close matches', stores: [storeName(st.store)], comparable: false, label: null, note: 'These may not match every part of your search (for example the material). Check the listing before you buy.', rows: st.close.map(function (m) { return row(storeName(st.store), m.title, m.url, m.pricePaise, null, m.availability, false); }) }); });
    if (topRows.length >= 2) v.top = { title: 'Lowest listed price per store', note: 'The cheapest listing each store showed. These are different products, so they are not ranked against each other.', rows: topRows };
    return v;
  }

  // Stock labels (D-067). Only a product page that said "in stock" gets "In stock"; everything else is "not confirmed". Unavailable rows are hidden (D-060) and counted.
  // Why a row is "not confirmed" (S12-6, V-173): only what the product page or the run really showed.
  var NC_WHY = { page_empty: 'the page showed no readable details', no_stock_signal: 'the page showed no stock or buy button', conflicting_signals: 'the page showed both out of stock and buy', other_store: 'the page opened on a different store', timeout: 'the page took too long', error: 'the page could not be read' };
  function stockView(state, reason) {
    if (state === 'unavailable') return { text: null, cls: 'oos', hide: true };
    if (state === 'in_stock') return { text: 'In stock (checked on the product page)', cls: 'in', hide: false };
    if (state === 'pending') return { text: 'Checking stock...', cls: 'wait', hide: false };
    var why = NC_WHY[reason || state];
    return { text: why ? 'Stock not confirmed (' + why + ')' : 'Stock not confirmed', cls: 'nc', hide: false };
  }
  // jobs = [{state}], plain counts and the real seconds, nothing estimated
  function stockSummary(done) {
    var jobs = (done && done.jobs) || [], n = { in_stock: 0, unavailable: 0, other: 0 };
    jobs.forEach(function (j) { if (j.state === 'in_stock') n.in_stock++; else if (j.state === 'unavailable') n.unavailable++; else n.other++; });
    var secs = Math.round(((done && done.ms) || 0) / 1000);
    return (done && done.stopped ? 'Stock check stopped. ' : 'Stock check done. ') + jobs.length + ' product page' + (jobs.length === 1 ? '' : 's') + ' checked in ' + secs + ' s. In stock: ' + n.in_stock + '. Hidden because they look unavailable: ' + n.unavailable + '. Stock not confirmed: ' + n.other + '.';
  }

  var api = { buildView: buildView, rupees: rupees, storeName: storeName, NAMES: NAMES, stockView: stockView, stockSummary: stockSummary, timeLine: timeLine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SmartSetuView = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
