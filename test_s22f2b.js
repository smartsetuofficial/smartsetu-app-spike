/* app-spike / test_s22f2b v0.1.0 (S22f-2 part 2b). Run: node test_s22f2b.js
 * Tests src/ortglue.js with a FAKE onnxruntime, FAKE tokenizer, FAKE fetch (synthetic). The real ort, model and WebView are checked by smoke/ (CI) and on the phone. */
'use strict';
var G = require('./src/ortglue.js'), S = require('./src/semantic.js'), pass = 0, fail = 0;
function ck(n, c, d) { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(d, function (k, v) { return typeof v === 'bigint' ? Number(v) : v; })); } }
var CON = { dog: 0, kutta: 0, puppy: 0, food: 1, khana: 1, steel: 2, bottle: 3, water: 3 }, DIM = 8;
function toks(t) { var ids = [0]; String(t).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).forEach(function (w) { ids.push(Object.prototype.hasOwnProperty.call(CON, w) ? 10 + CON[w] : 50); }); ids.push(2); return ids; }
function fakeOrt(opt) {
  opt = opt || {}; var seen = { feeds: null, created: 0 };
  var ort = { seen: seen, env: { wasm: {} }, Tensor: function (type, data, dims) { this.type = type; this.data = data; this.dims = dims; },
    InferenceSession: { create: function (bytes) { seen.created++; seen.bytes = bytes; return Promise.resolve({
      inputNames: opt.inputs || ['input_ids', 'attention_mask', 'token_type_ids'], outputNames: opt.outputs || ['last_hidden_state'],
      run: function (feeds) { seen.feeds = feeds; var ids = Array.prototype.slice.call(feeds.input_ids.data).map(Number), n = ids.length, d = new Float32Array(n * DIM);
        ids.forEach(function (id, t) { if (id >= 10 && id < 49) d[t * DIM + (id - 10)] = 1; else d[t * DIM + 7] = 0.1; });
        var out = {}; out[(opt.outputs || ['last_hidden_state'])[0]] = { data: d, dims: opt.dims || [1, n, DIM] }; return Promise.resolve(out); } }); } } };
  return ort;
}
function cfgOf(ort) { return { loadOrt: function () { return Promise.resolve(ort); }, configure: function (o) { o.configured = true; }, loadTokenizer: function () { return Promise.resolve({ encode: function (t) { return { ids: toks(t) }; } }); }, loadModelBytes: function () { return Promise.resolve(new Uint8Array([1, 2, 3])); } }; }

(async function () {
  // 1 feeds follow the model's input names
  var o1 = fakeOrt(), d1 = G.makeDeps(cfgOf(o1)); await d1.load();
  ck('1a configure was called, session made once with the bytes', o1.configured === true && o1.seen.created === 1 && o1.seen.bytes.length === 3, o1.seen.created);
  var r1 = await d1.runModel([0, 10, 2], [1, 1, 1]);
  ck('1b three feeds, int64, dims [1,3]', Object.keys(o1.seen.feeds).join() === 'input_ids,attention_mask,token_type_ids' && o1.seen.feeds.input_ids.type === 'int64' && o1.seen.feeds.input_ids.data instanceof BigInt64Array && o1.seen.feeds.input_ids.dims.join() === '1,3', Object.keys(o1.seen.feeds));
  ck('1c token_type_ids all zero, ids kept', Array.prototype.every.call(o1.seen.feeds.token_type_ids.data, function (x) { return x === 0n; }) && o1.seen.feeds.input_ids.data[1] === 10n, 0);
  ck('1d output {data, seq 3, dim 8}', r1.seq === 3 && r1.dim === DIM && r1.data.length === 24, [r1.seq, r1.dim]);
  var o2 = fakeOrt({ inputs: ['input_ids', 'attention_mask'] }), d2 = G.makeDeps(cfgOf(o2)); await d2.load(); await d2.runModel([0, 2], [1, 1]);
  ck('1e model without token_type_ids gets two feeds', Object.keys(o2.seen.feeds).join() === 'input_ids,attention_mask', Object.keys(o2.seen.feeds));
  // 2 refusals
  var bad = G.makeDeps(cfgOf(fakeOrt({ inputs: ['input_ids', 'pixel_values'] }))), e2 = null; try { await bad.load(); } catch (e) { e2 = e; }
  ck('2a unknown model input: load throws', e2 && /unknown model input/.test(e2.message), e2 && e2.message);
  var noIds = G.makeDeps(cfgOf(fakeOrt({ inputs: ['attention_mask'] }))), e3 = null; try { await noIds.load(); } catch (e) { e3 = e; }
  ck('2b no input_ids: load throws', !!e3, 0);
  var d4 = G.makeDeps(cfgOf(fakeOrt({ dims: [1, 8] }))); await d4.load(); var e4 = null; try { await d4.runModel([0, 2], [1, 1]); } catch (e) { e4 = e; }
  ck('2c output that is not [1, seq, dim]: runModel throws', e4 && /output shape/.test(e4.message), e4 && e4.message);
  var d5 = G.makeDeps(cfgOf(fakeOrt({ outputs: ['sentence_embedding'] }))); await d5.load();
  ck('2d first output used when last_hidden_state is absent', (await d5.runModel([0, 11, 2], [1, 1, 1])).dim === DIM, 0);
  var e6 = null; try { await G.makeDeps({ loadOrt: function () { return Promise.resolve({}); }, loadTokenizer: function () { }, loadModelBytes: function () { } }).load(); } catch (e) { e6 = e; }
  ck('2e ort without InferenceSession: throws', !!e6, 0);
  // 3 whole chain: semantic.js on top of ortglue (synthetic)
  var o7 = fakeOrt(), m = S.make(G.makeDeps(cfgOf(o7)), { deviceMemory: 8 });
  var sem = await m.prepare('kutta ka khana', ['Pedigree Dog Food 3 kg', 'Steel Water Bottle 1 L']);
  ck('3a chain works: ready, dog title above bottle title', m.state().status === 'ready' && sem && sem.sim('Pedigree Dog Food 3 kg') > sem.sim('Steel Water Bottle 1 L') + 0.3, m.state());
  // 4 phone config: urls inside the app folder, nothing else
  var urls = [], win = { document: { baseURI: 'https://localhost/index.html' }, fetch: function (u) { urls.push(u); var ok = !/missing/.test(u); return Promise.resolve({ ok: ok, status: ok ? 200 : 404, json: function () { return Promise.resolve({ u: u }); }, arrayBuffer: function () { return Promise.resolve(new Uint8Array([9, 9]).buffer); } }); } };
  function Tk(j, c) { this.j = j; this.c = c; }
  var imp = []; var wc = G.webConfig(win, Tk, { importer: function (u) { imp.push(u); return Promise.resolve({ env: { wasm: {} } }); } });
  var mod = await wc.loadOrt(); wc.configure(mod);
  ck('4a ort module url and wasm folder', imp[0] === 'https://localhost/ort/ort.wasm.min.mjs' && mod.env.wasm.wasmPaths === 'https://localhost/ort/' && mod.env.wasm.numThreads === 1 && mod.env.wasm.proxy === false, [imp, mod.env]);
  var tk = await wc.loadTokenizer(), by = await wc.loadModelBytes();
  ck('4b tokenizer from two json files, model bytes as Uint8Array', tk instanceof Tk && tk.j.u === 'https://localhost/models/tokenizer.json' && tk.c.u === 'https://localhost/models/tokenizer_config.json' && by instanceof Uint8Array && by.length === 2, urls);
  ck('4c every url is inside the app (https://localhost/)', urls.concat(imp).every(function (u) { return u.indexOf('https://localhost/') === 0; }), urls);
  var win2 = { document: win.document, fetch: function () { return Promise.resolve({ ok: false, status: 404 }); } }, e8 = null; try { await G.webConfig(win2, Tk).loadModelBytes(); } catch (e) { e8 = e; }
  ck('4d missing model file: rejects with the status', e8 && /404/.test(e8.message), e8 && e8.message);
  console.log('TEST s22f2b: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
