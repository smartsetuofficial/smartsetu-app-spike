// S22f-2 smoke test #2 (CI only, Node, NOT the WebView). Question: how useful is the meaning model for Hinglish / English / Devanagari queries, and is a small Hindi->English word list needed?
// All queries and titles below are my own made-up examples, NOT store data and NOT facts about products. Run: node smoke/smoke_pairs.mjs
// Parent: loads the model once per ort variant (v1..v4, all of them, no stop at the first) and runs the evaluation on the first variant that works.
import fs from 'node:fs'; import path from 'node:path'; import cp from 'node:child_process';
import { createRequire } from 'node:module'; import { pathToFileURL, fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url), here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..');
const dist = path.join(root, 'node_modules', 'onnxruntime-web', 'dist'), M = (f) => path.join(root, 'models', f);

// [group, query, english gloss or '', close title, far title 1, far title 2]
const DATA = [
  ['en', 'running shoes for men', '', 'Men Sports Running Shoes Mesh Black', 'Stainless Steel Pressure Cooker 5 L', 'Wireless Bluetooth Earbuds with Mic'],
  ['en', 'laptop bag', '', 'Water Resistant Laptop Backpack 15.6 inch', 'Cotton Bedsheet Double Bed Floral', 'Basmati Rice 5 kg'],
  ['en', 'protein powder', '', 'Whey Protein Powder Chocolate 1 kg', 'Kids School Bag with Pencil Box', 'LED Ceiling Light 12W'],
  ['en', 'smart watch', '', 'Smartwatch with Heart Rate Monitor and Bluetooth Calling', 'Cotton Kurta Set for Women', 'Non Stick Frying Pan 26 cm'],
  ['en', 'baby diapers', '', 'Baby Diapers Medium Size 72 Count Pants', 'Gaming Mouse RGB 6400 DPI', 'Men Leather Wallet Brown'],
  ['en', 'office chair', '', 'Ergonomic Mesh Office Chair with Headrest', 'Face Wash for Oily Skin 100 ml', 'USB C Fast Charger 33W'],
  ['en', 'cotton t shirt men', '', 'Men Round Neck Cotton T-Shirt Pack of 2', 'Digital Kitchen Weighing Scale', 'Yoga Mat 6 mm Anti Slip'],
  ['en', 'induction cooktop', '', 'Induction Cooktop 2000W with Push Button', 'Women Gold Plated Earrings', 'Notebook A4 Ruled 200 Pages'],
  ['en', 'power bank 10000mah', '', 'Power Bank 10000 mAh Fast Charging Dual USB', 'Cotton Bath Towel Set of 3', 'Hair Oil Coconut 500 ml'],
  ['en', 'washing machine', '', 'Fully Automatic Front Load Washing Machine 7 kg', 'Hardcover Diary 2027 Planner', 'Kids Cycle 16 inch'],
  ['en', 'wireless mouse', '', 'Wireless Optical Mouse 2.4 GHz with USB Receiver', 'Mustard Oil 1 L', 'Women Cotton Saree with Blouse'],
  ['en', 'sunscreen spf 50', '', 'Sunscreen Lotion SPF 50 PA+++ 100 ml', 'Bluetooth Speaker Portable 10W', 'Pressure Cooker 3 L'],
  ['en', 'cricket bat', '', 'Kashmir Willow Cricket Bat Full Size', 'Mixer Grinder 750W 3 Jars', 'Face Mask Pack of 50'],
  ['en', 'gas stove', '', 'Glass Top 3 Burner Gas Stove Manual Ignition', 'Running Shorts Men Quick Dry', 'Phone Tripod Stand 1.5 m'],
  ['mixed', 'sasta mobile under 10000', '', 'Redmi 5G Smartphone 6GB RAM 128GB Storage', 'Cotton Bedsheet Double Bed Floral', 'Steel Water Bottle 1 L'],
  ['mixed', 'best earphones under 500', '', 'Wired Earphones with Mic and Deep Bass', 'Stainless Steel Tawa 28 cm', 'Kids Storybook Set'],
  ['mixed', 'men ke shoes', '', 'Men Casual Sneakers White', 'Silicone Spatula Set', 'Baby Lotion 200 ml'],
  ['mixed', 'ladies purse', '', 'Women Handbag Faux Leather Brown', 'Mobile Charger 20W', 'Rice Cooker 1.8 L'],
  ['mixed', 'bike helmet', '', 'ISI Certified Full Face Helmet for Bike Riders', 'Face Cream Aloe Vera', 'Cotton Pillow Cover Pack of 2'],
  ['mixed', 'tv 43 inch', '', '43 inch Full HD Smart LED TV', 'Women Yoga Pants', 'Dog Food Chicken 3 kg'],
  ['mixed', 'kids toys', '', 'Building Blocks Set for Kids 200 Pieces', 'Laptop Cooling Pad', 'Men Formal Trousers'],
  ['mixed', 'bedsheet double', '', 'Cotton Double Bedsheet with 2 Pillow Covers', 'Gaming Keyboard Mechanical', 'Protein Bar Pack of 12'],
  ['mixed', 'cooking oil 5 litre', '', 'Refined Sunflower Oil 5 L Pouch', 'Wireless Earbuds Bluetooth 5.3', 'Kids School Shoes Black'],
  ['mixed', 'party wear saree', '', 'Women Embroidered Silk Saree with Blouse Piece', 'Cricket Ball Leather', 'Smart LED Bulb 9W'],
  ['rom', 'kutta ka khana', 'dog food', 'Adult Dry Dog Food Chicken and Rice 3 kg', 'Cotton Bedsheet Double Bed Floral', 'LED Ceiling Light 12W'],
  ['rom', 'bachon ke joote', 'kids shoes', 'Kids Sports Shoes Black Velcro', 'Men Formal Shirt Blue', 'Steel Water Bottle 1 L'],
  ['rom', 'mahilaon ki kurti', 'women kurti', 'Women Cotton Straight Kurta', 'Pedigree Dog Food 3 kg', 'Wireless Mouse 2.4 GHz'],
  ['rom', 'pani ki bottle', 'water bottle', 'Stainless Steel Water Bottle 1 L Insulated', 'Wireless Mouse 2.4 GHz', 'Baby Diapers Medium 72 Count'],
  ['rom', 'bijli ka bulb', 'led bulb', 'LED Bulb 9W Cool Daylight Pack of 2', 'Cotton Bath Towel Set of 3', 'Women Handbag Faux Leather Brown'],
  ['rom', 'kapde dhone ki machine', 'washing machine', 'Semi Automatic Washing Machine 8 kg Top Load', 'Kids Toy Building Blocks', 'Yoga Mat 6 mm Anti Slip'],
  ['rom', 'baalon ka tel', 'hair oil', 'Hair Oil Coconut and Amla 500 ml', 'Gas Stove 3 Burner', 'Laptop Backpack 15.6 inch'],
  ['rom', 'chawal 5 kilo', 'rice 5 kg', 'Basmati Rice 5 kg Long Grain', 'Bluetooth Headphones Over Ear', 'Cotton Pillow Cover Pack of 2'],
  ['rom', 'bachon ki doodh ki bottle', 'baby feeding bottle', 'Baby Feeding Bottle 250 ml BPA Free', 'Men Running Shoes Black', 'Induction Cooktop 2000W'],
  ['rom', 'mobile ka charger', 'mobile charger', 'Fast Charger 33W USB C Adapter with Cable', 'Cotton Double Bedsheet', 'Dog Food Chicken 3 kg'],
  ['rom', 'farsh ki jhadu', 'floor broom', 'Soft Bristle Floor Broom with Long Handle', 'Smart Watch Bluetooth Calling', 'Whey Protein Powder 1 kg'],
  ['rom', 'chhat ka pankha', 'ceiling fan', 'Ceiling Fan 1200 mm 5 Star Rated', 'Women Cotton Saree', 'Gaming Mouse RGB'],
  ['rom', 'sone ki chain', 'gold chain', 'Gold Plated Chain Necklace for Women', 'Pressure Cooker 5 L', 'Kids School Bag'],
  ['rom', 'mehendi', 'henna', 'Natural Henna Powder Mehendi 200 g', 'USB C Cable 1 m', 'Steel Water Bottle 1 L'],
  ['dev', 'कुत्ते का खाना', 'dog food', 'Adult Dry Dog Food Chicken and Rice 3 kg', 'Cotton Bedsheet Double Bed Floral', 'LED Ceiling Light 12W'],
  ['dev', 'बच्चों के जूते', 'kids shoes', 'Kids Sports Shoes Black Velcro', 'Men Formal Shirt Blue', 'Steel Water Bottle 1 L'],
  ['dev', 'महिलाओं की कुर्ती', 'women kurti', 'Women Cotton Straight Kurta', 'Pedigree Dog Food 3 kg', 'Wireless Mouse 2.4 GHz'],
  ['dev', 'पानी की बोतल', 'water bottle', 'Stainless Steel Water Bottle 1 L Insulated', 'Wireless Mouse 2.4 GHz', 'Baby Diapers Medium 72 Count'],
  ['dev', 'वाशिंग मशीन', 'washing machine', 'Fully Automatic Front Load Washing Machine 7 kg', 'Hardcover Diary 2027 Planner', 'Kids Cycle 16 inch'],
  ['dev', 'सस्ता मोबाइल', 'cheap mobile phone', 'Redmi 5G Smartphone 6GB RAM 128GB Storage', 'Cotton Bedsheet Double Bed Floral', 'Steel Water Bottle 1 L'],
  ['dev', 'हेडफोन', 'headphones', 'Wireless Over Ear Bluetooth Headphones', 'Basmati Rice 5 kg', 'Women Cotton Saree with Blouse'],
  ['dev', 'चावल 5 किलो', 'rice 5 kg', 'Basmati Rice 5 kg Long Grain', 'Bluetooth Headphones Over Ear', 'Cotton Pillow Cover Pack of 2'],
  ['dev', 'बालों का तेल', 'hair oil', 'Hair Oil Coconut and Amla 500 ml', 'Gas Stove 3 Burner', 'Laptop Backpack 15.6 inch'],
  ['dev', 'लैपटॉप बैग', 'laptop bag', 'Water Resistant Laptop Backpack 15.6 inch', 'Cotton Bedsheet Double Bed Floral', 'Basmati Rice 5 kg']
];
const MARGIN = 0.05; // same as smoke test #1
const CONFIGS = [[0.25, 0.85], [0.30, 0.85], [0.35, 0.85], [0.30, 0.80], [0.30, 0.90]]; // [floor, rel]. 0.30 / 0.85 are the engine start values (D-123)
const GROUPS = [['en', 'English'], ['mixed', 'English + Hinglish'], ['rom', 'Hindi in Roman letters'], ['rom+gloss', 'Roman Hindi, English word added'], ['dev', 'Devanagari'], ['dev+gloss', 'Devanagari, English word added']];
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// embed(text) -> Float32Array | null. Pure logic, tested in the sandbox with a fake embed.
export async function evaluate(embed) {
  const titles = []; for (const r of DATA) for (const t of r.slice(3)) if (!titles.includes(t)) titles.push(t);
  const tv = new Map(); let missing = 0;
  for (const t of titles) { const v = await embed(t); if (v) tv.set(t, v); else missing++; }
  const rows = [], metrics = {};
  for (const g of GROUPS) metrics[g[0]] = { n: 0, pairOk: 0, top1: 0, top3: 0, cfg: CONFIGS.map(() => ({ hit: 0, wrong: 0 })) };
  const one = async (gkey, q, close, fars) => {
    const vq = await embed(q); const m = metrics[gkey]; m.n++;
    if (!vq || !tv.has(close) || fars.some((f) => !tv.has(f))) { missing++; return { q, miss: true }; }
    const sc = dot(vq, tv.get(close)), fmax = Math.max(...fars.map((f) => dot(vq, tv.get(f))));
    const pairOk = sc > fmax + MARGIN; if (pairOk) m.pairOk++;
    const pool = [...tv.keys()].map((t) => ({ t, s: dot(vq, tv.get(t)) })).sort((a, b) => b.s - a.s);
    const rank = pool.findIndex((p) => p.t === close) + 1; if (rank === 1) m.top1++; if (rank <= 3) m.top3++;
    const mean5 = pool.slice(0, 5).reduce((a, p) => a + p.s, 0) / 5;
    CONFIGS.forEach(([floor, rel], i) => { const pass = pool.filter((p) => p.s >= floor && p.s >= rel * mean5); if (pass.some((p) => p.t === close)) m.cfg[i].hit++; m.cfg[i].wrong += pass.filter((p) => p.t !== close).length; });
    return { q, close: +sc.toFixed(3), far: +fmax.toFixed(3), ok: pairOk, rank };
  };
  for (const [g, q, gloss, close, f1, f2] of DATA) {
    const row = { g, q, gloss, plain: await one(g, q, close, [f1, f2]) };
    if (gloss) row.withGloss = await one(g + '+gloss', q + ' ' + gloss, close, [f1, f2]);
    rows.push(row);
  }
  return { rows, metrics, missing, titles: titles.length };
}

const pct = (a, n) => (n ? Math.round(100 * a / n) + '%' : '-');
export function report(ev) {
  const L = [], MD = [];
  L.push('GROUP SUMMARY (pair ok = close title beats both far titles by 0.05; top1/top3 = own close title rank among all ' + ev.titles + ' titles; STRESS pool: all categories mixed, harder than a real store result)');
  MD.push('| Group | queries | pair ok | top1 | top3 |', '|---|---|---|---|---|');
  for (const [k, name] of GROUPS) { const m = ev.metrics[k]; if (!m.n) continue; const line = name.padEnd(34) + 'n=' + m.n + '  pair ok ' + pct(m.pairOk, m.n) + '  top1 ' + pct(m.top1, m.n) + '  top3 ' + pct(m.top3, m.n); L.push('  ' + line); MD.push('| ' + name + ' | ' + m.n + ' | ' + pct(m.pairOk, m.n) + ' | ' + pct(m.top1, m.n) + ' | ' + pct(m.top3, m.n) + ' |'); }
  L.push('', 'FLOOR / REL GRID (hit = own close title passes the engine rule; wrong = average number of OTHER titles that also pass, in the stress pool)');
  MD.push('', '| Group | ' + CONFIGS.map((c) => 'floor ' + c[0] + ' rel ' + c[1] + ' (hit / wrong)').join(' | ') + ' |', '|---|' + CONFIGS.map(() => '---').join('|') + '|');
  for (const [k, name] of GROUPS) { const m = ev.metrics[k]; if (!m.n) continue; const cells = m.cfg.map((c) => pct(c.hit, m.n) + ' / ' + (c.wrong / m.n).toFixed(1)); L.push('  ' + name.padEnd(34) + CONFIGS.map((c, i) => ('f' + c[0] + ' r' + c[1] + ': ' + cells[i]).padEnd(24)).join('')); MD.push('| ' + name + ' | ' + cells.join(' | ') + ' |'); }
  const fails = ev.rows.filter((r) => r.plain.miss || !r.plain.ok);
  L.push('', 'PAIRS THAT FAILED (plain query): ' + fails.length + ' of ' + ev.rows.length);
  fails.forEach((r) => L.push('  ' + r.g.padEnd(6) + JSON.stringify(r.q) + (r.plain.miss ? ' no vector' : ' close ' + r.plain.close + ' vs far ' + r.plain.far + ' rank ' + r.plain.rank) + (r.withGloss && !r.withGloss.miss ? '  | with gloss close ' + r.withGloss.close + ' vs far ' + r.withGloss.far + (r.withGloss.ok ? ' OK' : ' still FAIL') : '')));
  MD.push('', '| Group | Query | gloss | plain close / far / rank | with gloss close / far / rank |', '|---|---|---|---|---|');
  ev.rows.forEach((r) => MD.push('| ' + r.g + ' | ' + r.q + ' | ' + (r.gloss || '') + ' | ' + (r.plain.miss ? 'no vector' : r.plain.close + ' / ' + r.plain.far + ' / ' + r.plain.rank + (r.plain.ok ? '' : ' FAIL')) + ' | ' + (r.withGloss ? (r.withGloss.miss ? 'no vector' : r.withGloss.close + ' / ' + r.withGloss.far + ' / ' + r.withGloss.rank + (r.withGloss.ok ? '' : ' FAIL')) : '') + ' |'));
  return { text: L.join('\n'), md: MD.join('\n') };
}

const VARIANTS = {
  v1: (ort) => { ort.env.wasm.wasmPaths = { mjs: pathToFileURL(path.join(dist, 'ort-wasm-simd-threaded.mjs')).href, wasm: pathToFileURL(path.join(dist, 'ort-wasm-simd-threaded.wasm')).href }; },
  v2: (ort) => { ort.env.wasm.wasmPaths = dist + path.sep; }, // folder string = what ortglue.webConfig uses
  v3: (ort) => { ort.env.wasm.wasmPaths = { mjs: pathToFileURL(path.join(dist, 'ort-wasm-simd-threaded.mjs')).href }; ort.env.wasm.wasmBinary = fs.readFileSync(path.join(dist, 'ort-wasm-simd-threaded.wasm')); },
  v4: (ort) => { ort.env.wasm.wasmPaths = pathToFileURL(dist).href + '/'; }
};
const mb = (n) => Math.round(n / 1048576);
async function child(v, doEval) {
  const semantic = require('../src/semantic.js'), glue = require('../src/ortglue.js');
  const { Tokenizer } = await import('@huggingface/tokenizers');
  const tok = new Tokenizer(JSON.parse(fs.readFileSync(M('tokenizer.json'), 'utf8')), JSON.parse(fs.readFileSync(M('tokenizer_config.json'), 'utf8')));
  const rss0 = process.memoryUsage().rss, t0 = Date.now();
  const cfg = { loadOrt: () => import(pathToFileURL(path.join(dist, 'ort.wasm.min.mjs')).href), configure: (ort) => { ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false; VARIANTS[v](ort); }, loadTokenizer: async () => tok, loadModelBytes: async () => new Uint8Array(fs.readFileSync(M('model_quantized.onnx'))) };
  const sem = semantic.make(glue.makeDeps(cfg), {}), st = await sem.ensure(), s = sem.state();
  const res = { variant: v, status: st, reason: s.reason, loadMs: s.loadMs, rssLoadMB: mb(process.memoryUsage().rss - rss0) };
  console.log('RESULT ' + JSON.stringify(res));
  if (st === 'ready' && doEval) {
    const t1 = Date.now(), ev = await evaluate((t) => sem.embed(t));
    ev.ms = Date.now() - t1; ev.modelCalls = sem.state().modelCalls; ev.variant = v;
    console.log('EVAL ' + JSON.stringify(ev));
  }
}
async function parent() {
  for (const f of ['model_quantized.onnx', 'tokenizer.json', 'tokenizer_config.json']) if (!fs.existsSync(M(f))) { console.log('MISSING models/' + f); process.exit(1); }
  const out = [], vlines = []; let ev = null;
  for (const v of Object.keys(VARIANTS)) {
    const r = cp.spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'ort', v, ev ? '0' : '1'], { encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
    const lines = (r.stdout || '').split('\n'), rl = lines.filter((l) => l.startsWith('RESULT ')).pop(), el = lines.filter((l) => l.startsWith('EVAL ')).pop();
    if (!rl) { vlines.push(v + ': NO RESULT (exit ' + r.status + ') ' + ((r.stderr || '') + (r.stdout || '')).split('\n').slice(-4).join(' | ').slice(0, 300)); continue; }
    const x = JSON.parse(rl.slice(7)); vlines.push(v + ': ' + x.status + (x.reason ? ' (' + x.reason + ')' : '') + ' load ' + x.loadMs + ' ms, rss +' + x.rssLoadMB + ' MB');
    if (el) ev = JSON.parse(el.slice(5));
  }
  out.push('ORT VARIANTS (v2 = the folder-string form that ortglue.webConfig uses on the phone):'); vlines.forEach((l) => out.push('  ' + l)); out.push('');
  let md = '## Semantic smoke test #2 (Node, not WebView)\n\nORT variants:\n\n' + vlines.map((l) => '- ' + l).join('\n') + '\n\n';
  if (ev) { const rp = report(ev); out.push(rp.text, '', 'EVAL: variant ' + ev.variant + ', ' + ev.rows.length + ' queries, ' + ev.titles + ' titles, ' + ev.modelCalls + ' model calls, ' + ev.ms + ' ms, missing vectors ' + ev.missing); md += rp.md + '\n'; }
  else out.push('NO VARIANT WORKED: no evaluation');
  out.push('', 'SUMMARY: ort variants ready: ' + (vlines.filter((l) => / ready /.test(l)).map((l) => l.split(':')[0]).join(',') || 'NONE'));
  console.log(out.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  process.exit(ev ? 0 : 1);
}
if (process.argv[2] === 'ort') child(process.argv[3], process.argv[4] === '1').catch((e) => { console.log('RESULT ' + JSON.stringify({ variant: process.argv[3], status: 'crash', reason: String(e && e.stack || e).slice(0, 600) })); });
else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) parent();
