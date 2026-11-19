/* smartsetu app / semantic v0.1.0 (S22f-2 part 1, D-123). The MEANING check helper for rank(q, perStore, lexicon, sem).
 * This file is pure logic: it has no model, no network, no storage. The real tokenizer and the real ONNX model are handed in by the caller (deps),
 * so everything here is tested in Node with a fake model (test_s22f2.js, SYNTHETIC numbers). The glue to onnxruntime-web is a later part.
 * deps = { load(): Promise, tokenize(text) -> { ids: number[] }, runModel(ids, mask) -> Promise<{ data: Float32Array, seq, dim }> }
 * Rules: lazy (nothing loads until prepare() is called), loads once, any failure = status 'failed' for the rest of the run and prepare() gives null
 * (the app then ranks exactly as before), low-memory phones never load the model, a new search stops the old work. Start values below are NOT measured. */
'use strict';

var DEFAULTS = { maxLen: 128, cacheMax: 600, floor: 0.30, rel: 0.85, max: 8, minMemGb: 4, loadMs: 60000, yieldEvery: 4, selfMargin: 0.05, agreeMin: 0.55, seedMax: 12 };
var SELF = { a: 'dog food', b: 'puppy food', c: 'steel water bottle' }; // load check: a must be closer to b than to c

function meanPool(data, seq, dim, mask) { // mean of the token vectors where mask = 1, then length 1
  var out = new Float32Array(dim), n = 0, t, d;
  for (t = 0; t < seq; t++) {
    if (!mask[t]) continue;
    n++;
    for (d = 0; d < dim; d++) out[d] += data[t * dim + d];
  }
  if (!n) return out;
  var s = 0; for (d = 0; d < dim; d++) { out[d] /= n; s += out[d] * out[d]; }
  s = Math.sqrt(s);
  if (!(s > 0) || !isFinite(s)) return new Float32Array(dim);
  for (d = 0; d < dim; d++) out[d] /= s;
  return out;
}
function dot(a, b) { var s = 0, n = a.length < b.length ? a.length : b.length; for (var i = 0; i < n; i++) s += a[i] * b[i]; return s; }
function clip(ids, maxLen) { return ids.length <= maxLen ? ids : ids.slice(0, maxLen - 1).concat([ids[ids.length - 1]]); } // keep the closing token
function okVec(v) { var s = 0; if (!v || !v.length) return false; for (var i = 0; i < v.length; i++) { if (!isFinite(v[i])) return false; s += v[i] * v[i]; } return s > 0.5 && s < 1.5; }
function lowMemory(deviceMemory, minGb) { return typeof deviceMemory === 'number' && deviceMemory > 0 && deviceMemory < minGb; } // navigator.deviceMemory is in GB, undefined = unknown = allowed
function msg(e) { return String((e && e.message) || e || 'error').slice(0, 160); }
function yieldNow() { return new Promise(function (r) { setTimeout(r, 0); }); }

function make(deps, opt) {
  opt = Object.assign({}, DEFAULTS, opt || {});
  var now = opt.now || Date.now;
  var status = 'idle', reason = '', loadMs = 0, loadP = null, cache = new Map(), calls = 0;

  function embed(text) { // -> Float32Array or null; cached
    var key = String(text);
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    var ids = null;
    try { var tk = deps.tokenize(key); ids = tk && tk.ids ? Array.prototype.slice.call(tk.ids) : null; } catch (_) { ids = null; }
    if (!ids || !ids.length) return Promise.resolve(null);
    ids = clip(ids, opt.maxLen);
    var mask = ids.map(function () { return 1; });
    calls++;
    return Promise.resolve().then(function () { return deps.runModel(ids, mask); }).then(function (o) {
      if (!o || !o.data || !(o.seq > 0) || !(o.dim > 0)) return null;
      var v = meanPool(o.data, o.seq, o.dim, mask);
      if (!okVec(v)) return null;
      if (cache.size >= opt.cacheMax) cache.delete(cache.keys().next().value); // oldest out
      cache.set(key, v);
      return v;
    }).catch(function () { return null; });
  }

  function selfCheck() {
    return Promise.all([embed(SELF.a), embed(SELF.b), embed(SELF.c)]).then(function (v) {
      if (!v[0] || !v[1] || !v[2]) return 'self-check: a vector is missing';
      var ab = dot(v[0], v[1]), ac = dot(v[0], v[2]);
      return ab > ac + opt.selfMargin ? '' : 'self-check: dog/puppy ' + ab.toFixed(3) + ' not above dog/bottle ' + ac.toFixed(3);
    });
  }

  function ensure() {
    if (status === 'ready' || status === 'failed' || status === 'lowmem') return Promise.resolve(status);
    if (loadP) return loadP;
    if (lowMemory(opt.deviceMemory, opt.minMemGb)) { status = 'lowmem'; reason = 'device memory ' + opt.deviceMemory + ' GB'; return Promise.resolve(status); }
    status = 'loading';
    var t0 = now(), timer = 0;
    var timeout = new Promise(function (_, rej) { timer = setTimeout(function () { rej(new Error('load timeout')); }, opt.loadMs); });
    loadP = Promise.race([Promise.resolve().then(function () { return deps.load(); }), timeout]).then(function () { return selfCheck(); }).then(function (bad) {
      if (bad) { status = 'failed'; reason = bad; } else status = 'ready';
    }).catch(function (e) { status = 'failed'; reason = msg(e); }).then(function () {
      clearTimeout(timer); loadMs = now() - t0; loadP = null; return status;
    });
    return loadP;
  }

  // prepare(queryText, titles, isStale, seeds) -> Promise<sem | null>. sem = { sim(title), agree(title) | undefined, agreeMin, floor, rel, max, info }. null = rank without the meaning check.
  // S22i (D-130): the listings the WORDS already confirmed in this same search are examples of what the person means. Their average vector is the prototype, listings that look like it are
  // the same kind of product in any language and any wording. Members below the average likeness are dropped once (a toy or an accessory among phones). No seeds = no prototype.
  function protoOf(seeds, info) {
    var list = []; (Array.isArray(seeds) ? seeds : []).forEach(function (t) { if (typeof t === 'string' && t && list.indexOf(t) < 0 && list.length < opt.seedMax) list.push(t); });
    if (!list.length) return Promise.resolve(null);
    return Promise.all(list.map(function (t) { return embed(t); })).then(function (vs) {
      vs = vs.filter(Boolean); info.seeds = vs.length; if (!vs.length) return null;
      function mean(arr) { var d = arr[0].length, m = new Float32Array(d), k, n = 0; arr.forEach(function (v) { for (k = 0; k < d; k++) m[k] += v[k]; }); for (k = 0; k < d; k++) n += m[k] * m[k]; n = Math.sqrt(n) || 1; for (k = 0; k < d; k++) m[k] /= n; return m; }
      var p = mean(vs);
      if (vs.length >= 3) { var ds = vs.map(function (v) { return dot(p, v); }), avg = ds.reduce(function (a, b) { return a + b; }, 0) / ds.length, keep = vs.filter(function (v, i) { return ds[i] >= avg; }); if (keep.length >= 2) { p = mean(keep); info.seedsKept = keep.length; } }
      return p;
    });
  }

  function prepare(queryText, titles, isStale, seeds) {
    var info = { status: status, reason: reason, query: String(queryText || ''), titles: 0, embedded: 0, partial: false, loadMs: 0, embedMs: 0 };
    if (!queryText || !Array.isArray(titles) || !titles.length) return Promise.resolve(null);
    return ensure().then(function (st) {
      info.status = st; info.reason = reason; info.loadMs = loadMs;
      if (st !== 'ready') return null;
      var t0 = now(), seen = {}, list = [];
      titles.forEach(function (t) { if (typeof t === 'string' && t && !seen[t]) { seen[t] = 1; list.push(t); } });
      info.titles = list.length;
      return embed(queryText).then(function (qv) {
        if (!qv) { info.reason = 'query vector missing'; return null; }
        return protoOf(seeds, info).then(function (proto) {
        var i = 0;
        function step() {
          if (i >= list.length) return Promise.resolve();
          if (isStale && isStale()) { info.partial = true; return Promise.resolve(); }
          var chunk = list.slice(i, i + opt.yieldEvery); i += chunk.length;
          return Promise.all(chunk.map(function (t) { return embed(t); })).then(function (vs) {
            vs.forEach(function (v) { if (v) info.embedded++; });
            return yieldNow();
          }).then(step);
        }
        return step().then(function () {
          info.embedMs = now() - t0;
          if (isStale && isStale()) return null; // a newer search started: this answer is not wanted
          return {
            sim: function (title) { var v = cache.get(String(title)); if (!v) return undefined; var a = dot(qv, v); return proto ? Math.max(a, dot(proto, v)) : a; },
            agree: proto ? function (title) { var v = cache.get(String(title)); return v ? dot(proto, v) : undefined; } : undefined,
            agreeMin: opt.agreeMin, floor: opt.floor, rel: opt.rel, max: opt.max, info: info
          };
        });
        });
      });
    }).catch(function (e) { info.status = 'failed'; info.reason = msg(e); return null; });
  }

  return {
    prepare: prepare, ensure: ensure, embed: embed,
    state: function () { return { status: status, reason: reason, loadMs: loadMs, cached: cache.size, modelCalls: calls }; }
  };
}

module.exports = { make: make, meanPool: meanPool, dot: dot, clip: clip, okVec: okVec, lowMemory: lowMemory, DEFAULTS: DEFAULTS, SELF: SELF };
