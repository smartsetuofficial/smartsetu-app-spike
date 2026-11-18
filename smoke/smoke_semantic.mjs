// S22f-2 smoke test on the REAL model (CI only, Node). Not the WebView: it proves the files, the tokenizer ids, the model and our code (semantic.js + ortglue.js) work together.
// Run: node smoke/smoke_semantic.mjs            (parent: tokenizer parity, then one child per ort loading variant)
//      node smoke/smoke_semantic.mjs ort <v>    (child)
import fs from 'node:fs'; import path from 'node:path'; import cp from 'node:child_process';
import { createRequire } from 'node:module'; import { pathToFileURL, fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url), here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..');
const semantic = require('../src/semantic.js'), glue = require('../src/ortglue.js');
const dist = path.join(root, 'node_modules', 'onnxruntime-web', 'dist'), M = (f) => path.join(root, 'models', f);
const sentences = JSON.parse(fs.readFileSync(path.join(here, 'sentences.json'), 'utf8'));
const QUERY = 'kutta ka khana';
const PAIRS = [ // [query, should be close, should be far]; Hinglish and English, my own examples, NOT store data
  ['kutta ka khana', 'Pedigree Adult Dry Dog Food Chicken 3 kg', 'Cotton Bedsheet Double Bed Floral'],
  ['mobile cover', 'Silicone Back Case for iPhone 15', 'Basmati Rice 5 kg'],
  ['sasta headphone', 'boAt Rockerz 450 Bluetooth Headphones', 'Steel Water Bottle 1 L'],
  ['bachon ke joote', 'Kids Sports Shoes Black', 'Men Formal Shirt Blue'],
  ['ladies kurti', 'Women Cotton Straight Kurta', 'Pedigree Dog Food 3 kg'],
  ['dog food', 'Pedigree Adult Dry Dog Food Chicken 3 kg', 'Steel Water Bottle 1 L']
];
async function loadTok() { const { Tokenizer } = await import('@huggingface/tokenizers'); return new Tokenizer(JSON.parse(fs.readFileSync(M('tokenizer.json'), 'utf8')), JSON.parse(fs.readFileSync(M('tokenizer_config.json'), 'utf8'))); }
const VARIANTS = {
  v1: (ort) => { ort.env.wasm.wasmPaths = { mjs: pathToFileURL(path.join(dist, 'ort-wasm-simd-threaded.mjs')).href, wasm: pathToFileURL(path.join(dist, 'ort-wasm-simd-threaded.wasm')).href }; },
  v2: (ort) => { ort.env.wasm.wasmPaths = dist + path.sep; },
  v3: (ort) => { ort.env.wasm.wasmPaths = { mjs: pathToFileURL(path.join(dist, 'ort-wasm-simd-threaded.mjs')).href }; ort.env.wasm.wasmBinary = fs.readFileSync(path.join(dist, 'ort-wasm-simd-threaded.wasm')); },
  v4: (ort) => { ort.env.wasm.wasmPaths = pathToFileURL(dist).href + '/'; }
};
const mb = (n) => Math.round(n / 1048576);

async function child(v) {
  const tok = await loadTok(), t0 = Date.now(), rss0 = process.memoryUsage().rss;
  const cfg = { loadOrt: () => import(pathToFileURL(path.join(dist, 'ort.wasm.min.mjs')).href), configure: (ort) => { ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false; VARIANTS[v](ort); }, loadTokenizer: async () => tok, loadModelBytes: async () => new Uint8Array(fs.readFileSync(M('model_quantized.onnx'))) };
  const deps = glue.makeDeps(cfg), sem = semantic.make(deps, {});
  const st = await sem.ensure(), s = sem.state(), res = { variant: v, status: st, reason: s.reason, loadMs: s.loadMs, rssLoadMB: mb(process.memoryUsage().rss - rss0) };
  if (st !== 'ready') { console.log('RESULT ' + JSON.stringify(res)); return; }
  res.io = deps.info();
  const dot = (a, b) => { let x = 0; for (let i = 0; i < a.length; i++) x += a[i] * b[i]; return x; };
  const rows = []; let good = 0;
  for (const [q, a, b] of PAIRS) { const [vq, va, vb] = await Promise.all([sem.embed(q), sem.embed(a), sem.embed(b)]); const sa = dot(vq, va), sb = dot(vq, vb); if (sa > sb + 0.05) good++; rows.push({ q, close: +sa.toFixed(3), far: +sb.toFixed(3), ok: sa > sb + 0.05 }); }
  res.pairs = rows; res.pairsOk = good + '/' + PAIRS.length;
  const titles = []; for (const p of PAIRS) { titles.push(p[1], p[2]); } for (let i = 0; i < 40; i++) titles.push('Pedigree Adult Dry Dog Food Chicken ' + (i + 1) + ' kg pack');
  const t1 = Date.now(), pr = await sem.prepare(QUERY, titles); res.prepare = pr ? { titles: pr.info.titles, embedded: pr.info.embedded, ms: Date.now() - t1, msPerTitle: +((Date.now() - t1) / Math.max(1, pr.info.embedded)).toFixed(1) } : 'null';
  res.rssTotalMB = mb(process.memoryUsage().rss); res.totalMs = Date.now() - t0;
  console.log('RESULT ' + JSON.stringify(res));
}

async function parent() {
  let bad = 0;
  for (const f of ['model_quantized.onnx', 'tokenizer.json', 'tokenizer_config.json']) { if (!fs.existsSync(M(f))) { console.log('MISSING models/' + f); process.exit(1); } console.log('FILE ' + f + ' ' + fs.statSync(M(f)).size + ' bytes'); }
  const tok = await loadTok(), mine = {}; for (const s of sentences) mine[s] = Array.from(tok.encode(s).ids);
  console.log('JS TOKEN IDS'); for (const s of sentences) console.log('  ' + JSON.stringify(s) + ' -> ' + mine[s].join(','));
  if (process.env.REF && fs.existsSync(process.env.REF)) {
    const ref = JSON.parse(fs.readFileSync(process.env.REF, 'utf8')); let same = 0;
    for (const s of sentences) { const r = ref.ids[s].join(','), m = mine[s].join(','); if (r === m) same++; else { bad++; console.log('  MISMATCH ' + JSON.stringify(s) + '\n    python: ' + r + '\n    js:     ' + m); } }
    console.log('TOKEN PARITY (js vs python tokenizers ' + ref.tokenizers_version + '): ' + same + '/' + sentences.length);
  } else console.log('TOKEN PARITY: no reference file, not checked');
  console.log('ORT dist: ' + fs.readdirSync(dist).filter((n) => /^ort-wasm-simd-threaded\.(mjs|wasm)$|^ort\.wasm\.min\.mjs$/.test(n)).join(', '));
  let ready = null;
  for (const v of Object.keys(VARIANTS)) {
    console.log('--- ort variant ' + v);
    const r = cp.spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'ort', v], { encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
    const line = (r.stdout || '').split('\n').filter((l) => l.startsWith('RESULT ')).pop();
    if (!line) { console.log('NO RESULT (exit ' + r.status + ')\n' + ((r.stderr || '') + (r.stdout || '')).split('\n').slice(-8).join('\n')); continue; }
    const res = JSON.parse(line.slice(7)); console.log(JSON.stringify(res, null, 1));
    if (res.status === 'ready') { ready = v; break; }
  }
  console.log('\nSUMMARY: token parity mismatches ' + bad + ', ort variant that works: ' + (ready || 'NONE'));
  process.exit(bad || !ready ? 1 : 0);
}
if (process.argv[2] === 'ort') child(process.argv[3]).catch((e) => { console.log('RESULT ' + JSON.stringify({ variant: process.argv[3], status: 'crash', reason: String(e && e.stack || e).slice(0, 600) })); }); else parent();
