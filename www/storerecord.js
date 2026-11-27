/* smartsetu app / storerecord v1 (S23-18, D-163). The store record is a small DATA file (JSON, schema 1) that the app reads from smartsetu.in/app-config/stores.json.
 * It can change, per store: on/off, the search address, how the query is put in it, the product link pattern, three parser flags, whether the store is read by a plain
 * fetch first, and the words that mean "no results". It is DATA only (Play rule, V-608): nothing in it is ever run as code. Every field is checked here;
 * a bad field is ignored (that store keeps its built-in value), a bad file is ignored (the built-in record stays). The store HOST is never taken from the record:
 * the new address must stay on the same site as the built-in address, so a wrong record can never send a person to another site.
 * Pure logic, no DOM. The caller gives: runner (SmartSetuRunner), fetchRead (SmartSetuFetchRead), parser (SmartSetu.parser), getText(url, ms) -> Promise<string>, storage (localStorage or null). */
(function (root) {
  'use strict';
  var SCHEMA = 1, MAX_FILE = 20000, KEY_REC = 'ss_storerecord_v1', KEY_HEALTH = 'ss_health_v1';
  var URL_DEFAULT = 'https://smartsetu.in/app-config/stores.json';
  var BOOLS = ['mrpStruck', 'dupBrand', 'offersGap'];

  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function hostOf(u) { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return ''; } }
  function sameSiteHost(h, base) { return !!h && !!base && (h === base || h.slice(-(base.length + 1)) === '.' + base); }
  function encodeQ(q, mode) { q = String(q == null ? '' : q); return mode === 'slug' ? encodeURIComponent(q.trim().replace(/\s+/g, '-')) : encodeURIComponent(q); }

  // A search address template: https only, no user name or port, 1 to 3 {q}, and the same site as the built-in address.
  function checkTemplate(t, baseHost) {
    if (typeof t !== 'string' || t.length < 12 || t.length > 300) return 'searchUrl length';
    var n = t.split('{q}').length - 1;
    if (n < 1 || n > 3) return 'searchUrl needs 1 to 3 {q}';
    if (!/^https:\/\//.test(t)) return 'searchUrl must be https';
    if (/[\s<>"'\\]/.test(t.replace(/\{q\}/g, ''))) return 'searchUrl has a bad character';
    var u; try { u = new URL(t.split('{q}').join('x')); } catch (_) { return 'searchUrl does not parse'; }
    if (u.username || u.password || u.port) return 'searchUrl has user or port';
    if (!sameSiteHost(u.hostname.toLowerCase(), baseHost)) return 'searchUrl is not on the store site';
    return null;
  }
  // A product link pattern: plain pattern text, 1 to 120 chars, a safe character set, at least one capture group, no look-around, no back reference,
  // no group followed by a repeat (the usual slow-pattern shape).
  function checkPattern(p, flags) {
    if (typeof p !== 'string' || p.length < 1 || p.length > 120) return 'linkPattern length';
    if (flags != null && flags !== '' && flags !== 'i') return 'linkFlags must be empty or i';
    if (!/^[A-Za-z0-9\\\/\[\]\(\)\{\}\-_.,+*?:|^$ ]+$/.test(p)) return 'linkPattern has a bad character';
    if (/\(\?[=!<]/.test(p) || /\\[1-9]/.test(p)) return 'linkPattern has look-around or back reference';
    if (/\)\s*[+*{]/.test(p)) return 'linkPattern repeats a group';
    var re; try { re = new RegExp(p, flags || ''); } catch (_) { return 'linkPattern does not compile'; }
    if (new RegExp(p + '|', flags || '').exec('').length < 2) return 'linkPattern needs a capture group';
    var t0 = Date.now(); try { re.test('/' + new Array(400).join('a1/') + 'p/'); } catch (_) { return 'linkPattern fails'; }
    if (Date.now() - t0 > 50) return 'linkPattern is slow';
    return null;
  }
  function checkWords(a) {
    if (!Array.isArray(a) || a.length > 30) return 'noResultsWords list';
    for (var i = 0; i < a.length; i++) if (typeof a[i] !== 'string' || !/^[a-z0-9' ]{3,40}$/.test(a[i])) return 'noResultsWords item ' + i;
    return null;
  }

  // validate(rec, built) -> { ok, rec (clean copy), errors[] }. built = { key: { baseHost } } from the built-in stores.
  function validate(rec, built) {
    var errors = [], clean = { schema: SCHEMA, version: 0, stores: {}, noResultsWords: [] };
    if (!isObj(rec)) return { ok: false, rec: null, errors: ['record is not an object'] };
    if (rec.schema !== SCHEMA) return { ok: false, rec: null, errors: ['schema must be ' + SCHEMA] };
    if (typeof rec.version !== 'number' || rec.version % 1 !== 0 || rec.version < 1 || rec.version > 1000000) return { ok: false, rec: null, errors: ['version must be a whole number 1 to 1000000'] };
    clean.version = rec.version;
    if (rec.noResultsWords != null) { var ew = checkWords(rec.noResultsWords); if (ew) errors.push(ew); else clean.noResultsWords = rec.noResultsWords.slice(); }
    if (rec.stores != null && !isObj(rec.stores)) { errors.push('stores is not an object'); }
    else Object.keys(rec.stores || {}).forEach(function (k) {
      if (!built[k]) { errors.push('unknown store ' + k + ' ignored'); return; }
      var s = rec.stores[k], c = {}, bad = [];
      if (!isObj(s)) { errors.push(k + ': not an object'); return; }
      if (s.enabled != null) { if (typeof s.enabled === 'boolean') c.enabled = s.enabled; else bad.push('enabled'); }
      if (s.fetchFirst != null) { if (typeof s.fetchFirst === 'boolean') c.fetchFirst = s.fetchFirst; else bad.push('fetchFirst'); }
      if (s.encode != null) { if (s.encode === 'uri' || s.encode === 'slug') c.encode = s.encode; else bad.push('encode'); }
      if (s.searchUrl != null) { var e1 = checkTemplate(s.searchUrl, built[k].baseHost); if (e1) bad.push(e1); else c.searchUrl = s.searchUrl; }
      if (s.linkPattern != null) { var e2 = checkPattern(s.linkPattern, s.linkFlags); if (e2) bad.push(e2); else { c.linkPattern = s.linkPattern; c.linkFlags = s.linkFlags || ''; } }
      BOOLS.forEach(function (b) { if (s[b] != null) { if (typeof s[b] === 'boolean') c[b] = s[b]; else bad.push(b); } });
      bad.forEach(function (b) { errors.push(k + ': ' + b + ' ignored'); });
      clean.stores[k] = c;
    });
    return { ok: true, rec: clean, errors: errors };
  }

  function defaultStorage() { try { return (typeof window !== 'undefined' && window.localStorage) || null; } catch (_) { return null; } } // the phone page; null in Node and when the page forbids it
  function make(o) {
    var R = o.runner, FR = o.fetchRead, P = o.parser, storage = o.storage !== undefined ? o.storage : defaultStorage(), now = o.now || function () { return Date.now(); };
    var url = o.url || URL_DEFAULT, getText = o.getText, refreshMs = o.refreshMs == null ? 6 * 3600 * 1000 : o.refreshMs;
    var built = {}, orig = {}, origOk = FR && FR.STORES_OK ? FR.STORES_OK.slice() : [], origP = {};
    var st = { version: 0, source: 'built-in', fetchedAt: 0, tried: 0, applied: [], errors: [], net: 'not tried', words: [] };
    var disabled = {};
    R.STORES.forEach(function (s) { built[s.key] = { baseHost: hostOf(s.url('q')) }; orig[s.key] = s.url; });
    if (P && P.STORES) Object.keys(P.STORES).forEach(function (k) { origP[k] = Object.assign({}, P.STORES[k]); });

    function resetAll() {
      R.STORES.forEach(function (s) { s.url = orig[s.key]; });
      if (P && P.STORES) Object.keys(origP).forEach(function (k) { if (P.STORES[k]) { P.STORES[k].linkRe = origP[k].linkRe; BOOLS.forEach(function (b) { if (origP[k][b] === undefined) delete P.STORES[k][b]; else P.STORES[k][b] = origP[k][b]; }); } });
      if (FR && FR.STORES_OK) { FR.STORES_OK.length = 0; origOk.forEach(function (x) { FR.STORES_OK.push(x); }); }
      disabled = {}; st.words = []; pushWords([]);
    }
    function pushWords(w) { try { if (R.setNrWords) R.setNrWords(w); if (FR && FR.setNrWords) FR.setNrWords(w); } catch (_) { /* optional */ } }
    function tpl(t, mode) { return function (q) { var e = encodeQ(q, mode); return t.split('{q}').join(e); }; }
    function applyClean(rec) {
      resetAll(); var ap = [];
      R.STORES.forEach(function (s) {
        var c = rec.stores[s.key]; if (!c) return; var did = false;
        if (c.searchUrl || c.encode) {
          if (c.searchUrl) s.url = tpl(c.searchUrl, c.encode || 'uri');
          else { var base = toTemplate(orig[s.key]); if (base) s.url = tpl(base, c.encode); }
          did = true;
        }
        if (c.enabled === false) { disabled[s.label] = false; did = true; }
        if (c.fetchFirst !== undefined && FR && FR.STORES_OK) { var i = FR.STORES_OK.indexOf(s.key); if (c.fetchFirst && i < 0) FR.STORES_OK.push(s.key); if (!c.fetchFirst && i >= 0) FR.STORES_OK.splice(i, 1); did = true; }
        var ps = P && P.STORES && P.STORES[s.key];
        if (ps) {
          if (c.linkPattern) { ps.linkRe = new RegExp(c.linkPattern, c.linkFlags || ''); did = true; }
          BOOLS.forEach(function (b) { if (c[b] !== undefined) { ps[b] = c[b]; did = true; } });
        }
        if (did) ap.push(s.key);
      });
      st.words = rec.noResultsWords.slice(); pushWords(st.words); st.applied = ap; st.version = rec.version;
    }
    // built-in address as a template (the query is replaced by a marker and put back as {q}); null if the address does not use the marker
    function toTemplate(fn) { var m = 'QQMARKQQ', t = fn(m); return t.indexOf(m) >= 0 ? t.split(m).join('{q}') : null; }

    function modeOf(fn, t) { var q = 'a b&c', want = fn(q); return tpl(t, 'uri')(q) === want ? 'uri' : (tpl(t, 'slug')(q) === want ? 'slug' : 'uri'); }
    // The record that says exactly what the app already does: a first release of the file has no effect (used by the tests and by check_store_record.js).
    function builtinRecord() {
      var rec = { schema: SCHEMA, version: 1, noResultsWords: [], stores: {} };
      R.STORES.forEach(function (s) {
        var t = toTemplate(orig[s.key]), c = { enabled: true, searchUrl: t, encode: modeOf(orig[s.key], t), fetchFirst: origOk.indexOf(s.key) >= 0 };
        var ps = origP[s.key];
        if (ps) { c.linkPattern = ps.linkRe.source; c.linkFlags = ps.linkRe.flags.replace(/[^i]/g, ''); BOOLS.forEach(function (b) { c[b] = !!ps[b]; }); }
        rec.stores[s.key] = c;
      });
      return rec;
    }

    function save(txt) { try { if (storage) storage.setItem(KEY_REC, txt); } catch (_) { /* optional */ } }
    function take(txt, source) {
      if (typeof txt !== 'string' || txt.length > MAX_FILE) return { ok: false, why: 'file too big or not text' };
      var j; try { j = JSON.parse(txt); } catch (_) { return { ok: false, why: 'not JSON' }; }
      var v = validate(j, built); if (!v.ok) return { ok: false, why: v.errors[0] };
      if (v.rec.version < st.version) return { ok: false, why: 'older version ' + v.rec.version + ' than ' + st.version };
      applyClean(v.rec); st.source = source; st.errors = v.errors; return { ok: true, version: v.rec.version, text: txt };
    }
    // start(): the saved last good copy is applied at once (no waiting), then a fresh copy is asked for in the background.
    function start() {
      try { var c = storage && storage.getItem(KEY_REC); if (c) take(c, 'saved copy'); } catch (_) { /* optional */ }
      return refresh();
    }
    function refresh() {
      if (typeof getText !== 'function') { st.net = 'no network function'; return Promise.resolve(false); }
      st.tried = now();
      var ms = o.timeoutMs || 4000, timer = null;
      var guard = new Promise(function (_, rej) { timer = setTimeout(function () { rej(new Error('timeout')); }, ms + 1000); });
      return Promise.race([Promise.resolve().then(function () { return getText(url, ms); }), guard]).then(function (txt) { clearTimeout(timer); return txt; }, function (e) { clearTimeout(timer); throw e; }).then(function (txt) {
        var r = take(txt, 'smartsetu.in'); st.fetchedAt = now();
        if (r.ok) { st.net = 'ok'; save(r.text); return true; }
        st.net = 'ignored: ' + r.why; return false;
      }).catch(function (e) { st.net = 'failed: ' + String((e && e.message) || e).slice(0, 60); return false; });
    }
    function maybeRefresh() { if (now() - st.tried > refreshMs) { refresh(); return true; } return false; }
    function enabledMap() { return Object.assign({}, disabled); }
    function nrWords() { return st.words.slice(); }
    function status() { return { version: st.version, source: st.source, fetchedAt: st.fetchedAt, net: st.net, applied: st.applied.slice(), errors: st.errors.slice(), words: st.words.length, off: Object.keys(disabled) }; }

    // ---- health memory (report only, never switches a store off): a store that gave 0 cards WITHOUT saying no results, or an error / timeout, in the last runs ----
    function loadH() { try { var t = storage && storage.getItem(KEY_HEALTH); var j = t ? JSON.parse(t) : {}; return isObj(j) ? j : {}; } catch (_) { return {}; } }
    function noteRuns(runs, queryIsNonsense) {
      if (queryIsNonsense || !Array.isArray(runs)) return;
      var h = loadH();
      runs.forEach(function (r) {
        if (!r || !r.key || r.state === 'off' || r.state === 'skipped') return;
        var e = h[r.key] || { n: 0, bad: 0, streak: 0 }, bad = (r.state === 'no_cards' && !r.noResults) || r.state === 'error' || r.state === 'timeout' || r.state === 'no_data';
        e.n = Math.min(e.n + 1, 20); if (bad) { e.bad = Math.min(e.bad + 1, 20); e.streak++; } else { e.streak = 0; if (e.bad > 0 && r.state === 'ok') e.bad--; }
        e.last = String(r.state); h[r.key] = e;
      });
      try { if (storage) storage.setItem(KEY_HEALTH, JSON.stringify(h)); } catch (_) { /* optional */ }
    }
    function healthLine() {
      var h = loadH(), sus = Object.keys(h).filter(function (k) { return h[k].streak >= 3; });
      return sus.length ? 'SUSPECT stores (3 or more bad reads in a row, fix by record or parser): ' + sus.map(function (k) { return k + ' ' + h[k].streak; }).join(', ') : 'no store has 3 bad reads in a row';
    }
    function diagLine() {
      var s = status();
      return 'record version ' + s.version + ' | source ' + s.source + ' | network ' + s.net + ' | stores changed ' + (s.applied.join(',') || 'none') + ' | stores off ' + (s.off.join(',') || 'none') + ' | extra no-results words ' + s.words + (s.errors.length ? ' | ignored: ' + s.errors.join('; ').slice(0, 200) : '') + ' | ' + healthLine();
    }
    return { start: start, refresh: refresh, maybeRefresh: maybeRefresh, enabledMap: enabledMap, nrWords: nrWords, status: status, diagLine: diagLine, noteRuns: noteRuns, healthLine: healthLine, builtinRecord: builtinRecord, take: take, resetAll: resetAll, built: built };
  }

  var api = { SCHEMA: SCHEMA, URL_DEFAULT: URL_DEFAULT, validate: validate, make: make, checkTemplate: checkTemplate, checkPattern: checkPattern, encodeQ: encodeQ };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SmartSetuStoreRecord = api;
})(typeof window !== 'undefined' ? window : this);
