/* DEV-ONLY (D-151, S23-10 item h): Full Test Mode for the owner's phone. Opened from the 7-tap owner panel (devtest.js), never from the member screen.
 * Runs 12 fixed searches one after another, each one exactly like a normal Compare (env.run), the AI on only 3 of them. After every search a partial report is handed out,
 * so a cut session still leaves text. The report has a per-store quality gate (part 1) and a per-search view (part 2). Reads and sends nothing by itself; no storage.
 * The limits below are FIRST VALUES, not measured on a phone (04_VERIFY_LOG V-590). */
'use strict';

var LIMITS = { price: 60, link: 90, repeat: 25, off: 60, productive: 80, nonsense: 5 };

// id, the words typed, ai = the AI may help on this one (3 of 12), on = words that make a listing on-topic for this search (used only for the off-topic share), tag = what the search tests.
var QUERIES = [
  { id: 1, q: 'boat airdopes 141', ai: false, tag: 'brand and model', on: 'boat|airdopes|earbud|earphone|tws' },
  { id: 2, q: 'iphone 17 pro', ai: false, tag: 'model', on: 'iphone|apple' },
  { id: 3, q: 'smartphones under 10000', ai: true, tag: 'budget', on: 'phone|mobile|redmi|realme|samsung|poco|moto|vivo|oppo|itel|lava|infinix|tecno|iqoo|nokia|5g|4g| gb' },
  { id: 4, q: 'red tape shoes for women', ai: false, tag: 'fashion', on: 'shoe|sneaker|sandal|loafer|boot|slipper|flat|heel|footwear|red tape' },
  { id: 5, q: 'lakme lipstick', ai: false, tag: 'beauty', on: 'lakme|lakm|lipstick|lip ' },
  { id: 6, q: 'samsung galaxi s24', ai: true, tag: 'wrong spelling', on: 'samsung|galaxy|s24' },
  { id: 7, q: 'sasta earphones 1000 ke andar', ai: true, tag: 'Hinglish', on: 'earphone|earbud|headphone|neckband|headset|tws|airdopes|wired|wireless|bluetooth' },
  { id: 8, q: 'protein powder', ai: false, tag: 'grocery and health', on: 'protein|whey|isolate|gainer|nutrition|powder|supplement' },
  { id: 9, q: 'kids school bag', ai: false, tag: 'kids', on: 'bag|backpack|school|trolley' },
  { id: 10, q: 'washing machine 7 kg front load', ai: false, tag: 'large appliance', on: 'washing|washer|front load|top load|laundry' },
  { id: 11, q: 'best budget gaming laptop with 16gb ram and rtx graphics card under 70000 for students', ai: false, tag: 'very long', on: 'laptop|notebook|gaming|rtx|nvidia|ideapad|vivobook|inspiron|thinkpad|victus|loq|tuf|nitro|legion' },
  { id: 12, q: 'xqzvtn blorptex', ai: false, tag: 'no result', on: '', nores: true }
];

function pct(a, b) { return b > 0 ? Math.round(a * 100 / b) : null; }
function pcs(v) { return v == null ? '-' : v + '%'; }
function secs(ms) { return ms == null ? '-' : (Math.round(ms / 100) / 10) + ' s'; }
function titleKey(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 50); }
function oneLine(x, n) { return String(x == null ? '' : x).replace(/\s+/g, ' ').slice(0, n); }

// One store of one search -> small numbers. snapshot is dropped afterwards (108 snapshots would not fit in phone memory).
function analyseRun(run, parse, item) {
  var o = { parsed: 0, priced: 0, linked: 0, dups: 0, on: 0, off: 0, readCards: 0, parseError: null };
  try { o.readCards = run && run.snapshot && run.snapshot.cards ? run.snapshot.cards.length : 0; } catch (_) { /* counted as 0 */ }
  if (!run || !run.snapshot) return o;
  var p = null;
  try { p = parse(run.snapshot) || {}; } catch (e) { o.parseError = oneLine(e && e.message, 60); return o; }
  var re = item && item.on ? new RegExp(item.on, 'i') : null, seen = {};
  (p.cards || []).forEach(function (c) {
    o.parsed++;
    if (c.priceNow != null && isFinite(c.priceNow) && c.priceNow > 0) o.priced++;
    if (/^https:\/\/[^\s/]+\.[^\s/]+/i.test(String(c.url || ''))) o.linked++;
    var k = titleKey(c.title); if (k) { if (seen[k]) o.dups++; else seen[k] = 1; }
    if (re) { if (re.test(' ' + String(c.title || '').toLowerCase() + ' ')) o.on++; else o.off++; }
  });
  return o;
}

// One finished search (the object env.run gave back) -> the small record the report keeps.
function summarise(item, one, parse) {
  var lines = (one && one.stores) || [], byLabel = {}, order = [];
  lines.forEach(function (l) { if (l && l.s && !byLabel[l.s]) { byLabel[l.s] = { label: l.s, state: l.st, stage: l.g || null, ms: l.ms == null ? null : l.ms, n: l.n == null ? null : l.n }; order.push(l.s); } });
  ((one && one.runs) || []).forEach(function (r) {
    if (!r || !r.store) return;
    if (!byLabel[r.store]) { byLabel[r.store] = { label: r.store, state: r.state, stage: null, ms: null, n: null }; order.push(r.store); }
    var a = analyseRun(r, parse, item), s = byLabel[r.store];
    Object.keys(a).forEach(function (k) { s[k] = a[k]; });
    if (s.n == null) s.n = a.readCards;
  });
  var stores = order.map(function (l) { var s = byLabel[l]; ['parsed', 'priced', 'linked', 'dups', 'on', 'off'].forEach(function (k) { if (s[k] == null) s[k] = 0; }); return s; });
  var ai = one && one.ai ? { rewrite: one.ai.rewrite || null, refine: one.ai.refine || null } : null;
  return { item: item, ms: one && one.ms != null ? one.ms : null, error: one && one.error ? oneLine(one.error, 120) : null, ai: ai, rows: ((one && one.rows) || []).slice(0, 6).map(function (r) { return { store: r.store, price: r.price, title: oneLine(r.title, 70) }; }), rowCount: ((one && one.rows) || []).length, stores: stores };
}

// Part 1: per store over all searches. Verdict is FAIL / WARN / PASS with the reasons in words.
function gate(sums) {
  var agg = {}, order = [];
  sums.forEach(function (s) {
    s.stores.forEach(function (st) {
      var a = agg[st.label]; if (!a) { a = agg[st.label] = { label: st.label, counted: 0, productive: 0, off: 0, skipped: 0, failed: 0, parsed: 0, priced: 0, linked: 0, dups: 0, on: 0, offTopic: 0, onTested: 0, msSum: 0, msN: 0, msMax: 0, nonsense: null, stages: {} }; order.push(st.label); }
      if (st.state === 'off') { a.off++; return; }
      if (s.item.nores) { a.nonsense = st.parsed; return; }
      a.counted++;
      if (st.state === 'skipped') a.skipped++; else if (st.state !== 'ok') { a.failed++; a.stages[st.stage || st.state] = 1; }
      if (st.parsed > 0) a.productive++;
      a.parsed += st.parsed; a.priced += st.priced; a.linked += st.linked; a.dups += st.dups; a.on += st.on; a.offTopic += st.off; a.onTested += st.on + st.off;
      if (st.ms != null && st.state !== 'skipped') { a.msSum += st.ms; a.msN++; if (st.ms > a.msMax) a.msMax = st.ms; }
    });
  });
  return order.map(function (l) {
    var a = agg[l], why = [], v = 'PASS';
    var prod = pct(a.productive, a.counted), price = pct(a.priced, a.parsed), link = pct(a.linked, a.parsed), rep = pct(a.dups, a.parsed), off = pct(a.offTopic, a.onTested);
    if (a.counted === 0) { v = a.off ? 'OFF' : 'NODATA'; why.push(a.off ? 'switched off in every search' : 'no search reached this store'); }
    else {
      if (prod != null && prod < 50) { v = 'FAIL'; why.push('listings in only ' + a.productive + ' of ' + a.counted + ' searches'); }
      else if (prod != null && prod < LIMITS.productive) { v = 'WARN'; why.push('listings in ' + a.productive + ' of ' + a.counted + ' searches (limit ' + LIMITS.productive + '%)'); }
      if (a.parsed > 0) {
        var w = [];
        if (price < LIMITS.price) w.push('price ' + price + '% under ' + LIMITS.price + '%');
        if (link < LIMITS.link) w.push('links ' + link + '% under ' + LIMITS.link + '%');
        if (rep > LIMITS.repeat) w.push('repeated titles ' + rep + '% over ' + LIMITS.repeat + '%');
        if (off != null && off > LIMITS.off) w.push('off-topic ' + off + '% over ' + LIMITS.off + '%');
        if (w.length) { if (v === 'PASS') v = 'WARN'; why = why.concat(w); }
      }
      if (a.skipped) why.push('skipped by the time gate in ' + a.skipped + ' searches');
      if (a.failed) why.push('failed in ' + a.failed + ' searches (' + Object.keys(a.stages).join(', ') + ')');
    }
    if (a.nonsense != null && a.nonsense >= LIMITS.nonsense) why.push('gave ' + a.nonsense + ' listings for the nonsense search');
    return { label: l, verdict: v, why: why, counted: a.counted, productive: a.productive, skipped: a.skipped, failed: a.failed, parsed: a.parsed, price: price, link: link, repeat: rep, off: off, avgMs: a.msN ? Math.round(a.msSum / a.msN) : null, maxMs: a.msN ? a.msMax : null };
  });
}

function buildReport(p) {
  var sums = p.sums || [], total = (p.queries || QUERIES).length, g = gate(sums), aiOn = sums.filter(function (s) { return s.item.ai; }).length;
  var L = ['SmartSetu FULL TEST MODE report (test build ' + (p.version || '?') + ')', 'Searches done: ' + sums.length + ' of ' + total + (p.partial ? ' (PARTIAL, the run is still going or was stopped)' : '') + ' | AI allowed on ' + aiOn + ' | Total: ' + (p.totalS == null ? '?' : p.totalS) + ' s | Seen at: ' + (p.seenAt || ''), 'Browser: ' + (p.ua || '?'),
    'Gate limits are first values, NOT measured on a phone: price >= ' + LIMITS.price + '%, links >= ' + LIMITS.link + '%, repeated titles <= ' + LIMITS.repeat + '%, off-topic <= ' + LIMITS.off + '%, stores with listings >= ' + LIMITS.productive + '% of searches. Off-topic = the title has none of the words chosen for that search (a rough check).',
    '', 'PART 1: STORE QUALITY GATE (all searches except the nonsense one)'];
  if (!g.length) L.push('- (no search finished yet)');
  g.forEach(function (x) {
    L.push('- ' + x.label + ' | ' + x.verdict + ' | listings in ' + x.productive + ' of ' + x.counted + ' | skipped ' + x.skipped + ' | failed ' + x.failed + ' | parsed ' + x.parsed + ' | price ' + pcs(x.price) + ' | links ' + pcs(x.link) + ' | repeated ' + pcs(x.repeat) + ' | off-topic ' + pcs(x.off) + ' | avg ' + secs(x.avgMs) + ' | max ' + secs(x.maxMs) + (x.why.length ? ' | ' + x.why.join('; ') : ''));
  });
  L.push('', 'PART 2: EVERY SEARCH (store | state | cards read | parsed | with price | seconds | stopped at; then the first 6 result rows)');
  sums.forEach(function (s) {
    var it = s.item;
    L.push('', '=== ' + it.id + '/' + total + ' | ' + it.q + ' | ' + it.tag + ' | AI ' + (it.ai ? 'allowed' : 'off') + ' | ' + secs(s.ms) + ' | result rows ' + s.rowCount + (s.error ? ' | ERROR ' + s.error : ''));
    if (s.ai && s.ai.rewrite) L.push('AI rewrite: ' + oneLine(JSON.stringify(s.ai.rewrite), 200));
    if (s.ai && s.ai.refine) L.push('AI refine: ' + oneLine(JSON.stringify(s.ai.refine), 200));
    s.stores.forEach(function (st) { L.push('- ' + st.label + ' | ' + st.state + ' | ' + (st.n == null ? '-' : st.n) + ' | ' + st.parsed + ' | ' + st.priced + ' | ' + secs(st.ms) + (st.stage ? ' | ' + st.stage : '') + (st.parseError ? ' | parse error ' + st.parseError : '')); });
    s.rows.forEach(function (r) { L.push('  row: ' + r.store + ' | ' + (r.price || '-') + ' | ' + r.title); });
    if (!s.rows.length) L.push('  row: (none)');
  });
  return L.join('\n');
}

// env: { run(q, useAI) -> Promise<{ ms, stores, rows, runs, ai }>, parse, version, ua, queries? }   hooks: { log(text), partial(reportText), stop() }
async function runSuite(env, hooks) {
  hooks = hooks || {};
  var list = env.queries || QUERIES, sums = [], t0 = Date.now(), seenAt = new Date().toISOString();
  function rep(partial) { return buildReport({ version: env.version, ua: env.ua, seenAt: seenAt, totalS: Math.round((Date.now() - t0) / 1000), sums: sums, queries: list, partial: partial }); }
  for (var i = 0; i < list.length; i++) {
    if (hooks.stop && hooks.stop()) break;
    var it = list[i];
    if (hooks.log) hooks.log('Search ' + (i + 1) + ' of ' + list.length + ': ' + it.q + (it.ai ? ' (AI allowed)' : ''));
    var one = null;
    try { one = await env.run(it.q, !!it.ai); } catch (e) { one = { error: (e && e.message) || String(e) }; }
    var s; try { s = summarise(it, one, env.parse); } catch (e2) { s = summarise(it, { error: 'report error: ' + ((e2 && e2.message) || e2) }, env.parse); }
    sums.push(s); one = null;
    var last = i === list.length - 1;
    if (hooks.partial) { try { hooks.partial(rep(!last)); } catch (_) { /* the screen must not stop the run */ } }
  }
  var stopped = sums.length < list.length;
  return rep(stopped);
}

module.exports = { QUERIES: QUERIES, LIMITS: LIMITS, runSuite: runSuite, buildReport: buildReport, gate: gate, summarise: summarise, analyseRun: analyseRun, titleKey: titleKey };
