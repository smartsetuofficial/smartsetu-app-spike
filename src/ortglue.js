/* smartsetu app / ortglue v0.1.0 (S22f-2 part 2b, D-123). Glue between semantic.js and the real parts: onnxruntime-web, the tokenizer, the model bytes.
 * makeDeps(cfg) gives { load, tokenize, runModel } for semantic.make(). cfg = { loadOrt(), configure(ort), loadTokenizer(), loadModelBytes() } (all injected, so this file is tested in Node with fakes, test_s22f2b.js).
 * webConfig(win, Tokenizer, opt) is the phone version: files come from the app's own folder (ort/ and models/ inside www), nothing from the network.
 * File names come from the REAL dist list of onnxruntime-web 1.30.0 (V-469): ort.wasm.min.mjs + ort-wasm-simd-threaded.mjs/.wasm (plain wasm build, no webgpu/jsep). Whether the WebView runs it is NOT verified. */
'use strict';

var PATHS = { ortMjs: 'ort/ort.wasm.min.mjs', ortDir: 'ort/', model: 'models/model_quantized.onnx', tokJson: 'models/tokenizer.json', tokCfg: 'models/tokenizer_config.json' };

function int64Tensor(ort, arr) { var b = new BigInt64Array(arr.length); for (var i = 0; i < arr.length; i++) b[i] = BigInt(arr[i]); return new ort.Tensor('int64', b, [1, arr.length]); }

function makeDeps(cfg) {
  var ort = null, session = null, tok = null, inNames = [], outNames = [];
  return {
    load: async function () {
      ort = await cfg.loadOrt();
      if (!ort || !ort.InferenceSession || !ort.Tensor) throw new Error('ort module has no InferenceSession/Tensor');
      if (cfg.configure) cfg.configure(ort);
      tok = await cfg.loadTokenizer();
      if (!tok || typeof tok.encode !== 'function') throw new Error('tokenizer has no encode');
      var bytes = await cfg.loadModelBytes();
      session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
      bytes = null; // the session keeps its own copy: do not hold a second 118 MB
      inNames = Array.prototype.slice.call(session.inputNames || []); outNames = Array.prototype.slice.call(session.outputNames || []);
      if (inNames.indexOf('input_ids') < 0) throw new Error('model inputs: ' + inNames.join(','));
      inNames.forEach(function (n) { if (n !== 'input_ids' && n !== 'attention_mask' && n !== 'token_type_ids') throw new Error('unknown model input ' + n); });
    },
    tokenize: function (text) { var e = tok.encode(String(text)); return { ids: Array.prototype.slice.call(e.ids) }; },
    runModel: async function (ids, mask) {
      var feeds = {};
      inNames.forEach(function (n) {
        if (n === 'input_ids') feeds[n] = int64Tensor(ort, ids);
        else if (n === 'attention_mask') feeds[n] = int64Tensor(ort, mask);
        else feeds[n] = int64Tensor(ort, ids.map(function () { return 0; }));
      });
      var res = await session.run(feeds), key = outNames.indexOf('last_hidden_state') >= 0 ? 'last_hidden_state' : outNames[0], o = res && res[key];
      if (!o || !o.data || !o.dims || o.dims.length !== 3 || o.dims[0] !== 1) throw new Error('model output shape ' + (o && o.dims));
      return { data: o.data, seq: o.dims[1], dim: o.dims[2] };
    },
    info: function () { return { inputs: inNames.slice(), outputs: outNames.slice() }; }
  };
}

// The phone version. win = window, Tokenizer = class from @huggingface/tokenizers (passed in so this file stays testable), opt.importer = how to import an ES module by URL.
function webConfig(win, Tokenizer, opt) {
  opt = opt || {};
  var abs = function (p) { return new URL(p, win.document.baseURI).href; };
  var importer = opt.importer || function (u) { return import(u); };
  function getOk(p) { return win.fetch(abs(p)).then(function (r) { if (!r.ok) throw new Error(p + ' HTTP ' + r.status); return r; }); }
  return {
    loadOrt: function () { return importer(abs(PATHS.ortMjs)); },
    configure: function (ort) { ort.env.wasm.wasmPaths = abs(PATHS.ortDir); ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false; },
    loadTokenizer: function () { return Promise.all([getOk(PATHS.tokJson).then(function (r) { return r.json(); }), getOk(PATHS.tokCfg).then(function (r) { return r.json(); })]).then(function (x) { return new Tokenizer(x[0], x[1]); }); },
    loadModelBytes: function () { return getOk(PATHS.model).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return new Uint8Array(b); }); }
  };
}

module.exports = { makeDeps: makeDeps, webConfig: webConfig, PATHS: PATHS, int64Tensor: int64Tensor };
