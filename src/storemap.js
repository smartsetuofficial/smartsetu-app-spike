/* smartsetu app / storemap v1 (S15, D-096). Which store sells what, so a search only opens the stores that can have the product.
 * Pure functions, no DOM, no network. The table below is the AI's general knowledge of what each store sells (UNVERIFIED, V-271): it is used only to
 * SKIP stores, never to hide results, and the screen always offers "also check the other stores". A query that matches nothing opens every store. */
'use strict';

// Categories: mobile, laptop (laptops, tablets, TVs, cameras, monitors), gadget (small electronics and accessories), appliance, fashion, beauty (beauty, personal care, wellness), home.
var SELLS = {
  amazon: ['mobile', 'laptop', 'gadget', 'appliance', 'fashion', 'beauty', 'home'],
  flipkart: ['mobile', 'laptop', 'gadget', 'appliance', 'fashion', 'beauty', 'home'],
  myntra: ['fashion', 'beauty', 'home'],
  ajio: ['fashion', 'beauty'],
  nykaa: ['beauty', 'fashion'],
  meesho: ['fashion', 'beauty', 'home', 'gadget'],
  tatacliq: ['mobile', 'laptop', 'gadget', 'appliance', 'fashion', 'beauty', 'home'],
  croma: ['mobile', 'laptop', 'gadget', 'appliance'],
  reliancedigital: ['mobile', 'laptop', 'gadget', 'appliance']
};
var ALWAYS = { amazon: 1, flipkart: 1 };
var CAT_WORD = { mobile: 'phones', laptop: 'electronics', gadget: 'gadgets', appliance: 'appliances', fashion: 'fashion', beauty: 'beauty products', home: 'home items' };

// word or phrase -> categories. Matched on whole words, lower case. Brands count too.
var TERMS = {
  mobile: 'iphone smartphone mobile phone phones galaxy redmi poco oneplus realme pixel vivo oppo iqoo motorola moto infinix tecno lava narzo nothing',
  laptop: 'laptop laptops macbook notebook tablet ipad tv television monitor camera dslr projector printer playstation xbox console soundbar gopro nikon canon',
  gadget: 'earphone earphones earbuds earbud headphone headphones airpods airdopes neckband tws speaker charger cable adapter powerbank smartwatch keyboard mouse router ssd pendrive webcam case cover tempered boat jbl bose sony logitech noise fastrack',
  appliance: 'fridge refrigerator washing microwave oven otg mixer grinder juicer blender airfryer geyser fan cooler vacuum iron kettle toaster purifier chimney hob induction cooktop dishwasher heater inverter stabilizer lg whirlpool haier voltas philips bajaj prestige',
  fashion: 'cloths cloth clothes clothing garments apparel outfit frock frocks romper rompers winterwear girls girl boys boy kids kid baby toddler infant shirt shirts tshirt tshirts polo jeans trousers pants shorts kurta kurti saree sari lehenga dress dresses top tops gown jacket hoodie sweatshirt sweater blazer suit coat shoes shoe sneakers sandals slippers heels boots loafers bag bags backpack handbag wallet belt cap hat scarf socks innerwear bra lingerie nightwear pyjama tracksuit leggings jewellery earrings necklace bracelet sunglasses watch watches nike adidas puma reebok skechers asics levis wrangler zara allen solly peter england bata woodland campus crocs titan casio fossil',
  beauty: 'lipstick lip balm foundation concealer kajal eyeliner mascara eyeshadow blush primer makeup nail polish serum moisturizer moisturiser sunscreen cleanser toner scrub shampoo conditioner lotion cream perfume deodorant deo fragrance soap razor shaving trimmer protein whey vitamin lakme maybelline loreal nivea ponds dove himalaya garnier olay neutrogena cetaphil biotique mamaearth minimalist tresemme pantene',
  home: 'bedsheet curtain curtains pillow mattress blanket quilt towel sofa table chair desk wardrobe shelf lamp bulb cookware pan kadhai cooker tawa utensil bottle flask lunchbox container glass mug plate organizer mop broom bucket hanger clock mirror rug carpet doormat vase decor knife'
};
// Two-word terms are written with a space inside these lists.
var PHRASES = {
  mobile: ['nothing phone', 'galaxy s', 'mobile phone'],
  laptop: ['smart tv', 'led tv', 'hard disk', 'memory card'],
  gadget: ['power bank', 'smart watch', 'fitness band', 'mi band', 'screen guard', 'phone case', 'back cover', 'ear buds'],
  appliance: ['washing machine', 'air conditioner', 'split ac', 'air fryer', 'water heater', 'ceiling fan', 'air cooler', 'water purifier', 'ro purifier', 'room heater', 'gas stove', 'sewing machine', 'robot vacuum'],
  fashion: ['t shirt', 'sports shoes', 'running shoes', 'flip flops', 'red tape', 'van heusen', 'louis philippe', 'h&m', 'w for woman'],
  beauty: ['face wash', 'face cream', 'face mask', 'hair oil', 'hair serum', 'hair colour', 'hair color', 'hair dye', 'body lotion', 'body wash', 'nail polish', 'lip balm', 'dot and key', 'head and shoulders', 'vitamin c'],
  home: ['bed sheet', 'pressure cooker', 'dinner set', 'wall clock', 'led light', 'water bottle', 'lunch box', 'dinner set']
};

var INDEX = null;
function index() {
  if (INDEX) return INDEX;
  INDEX = { words: {}, phrases: [] };
  Object.keys(TERMS).forEach(function (cat) { TERMS[cat].split(' ').forEach(function (w) { if (w) (INDEX.words[w] = INDEX.words[w] || {})[cat] = 1; }); });
  Object.keys(PHRASES).forEach(function (cat) { PHRASES[cat].forEach(function (p) { INDEX.phrases.push([p, cat]); }); });
  return INDEX;
}

function norm(q) { return ' ' + String(q == null ? '' : q).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9+ ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' '; }

// Categories the query points to, in order of how many words matched. [] means unknown (every store is checked).
function classify(q) {
  var s = norm(q), ix = index(), score = {}, bump = function (c) { score[c] = (score[c] || 0) + 1; };
  var hp = norm(q).replace(/ and /g, ' & ');
  ix.phrases.forEach(function (pc) { var p = ' ' + pc[0].replace(/ and /g, ' & ') + ' '; if (hp.indexOf(p) >= 0 || s.indexOf(' ' + pc[0] + ' ') >= 0) bump(pc[1]); });
  s.trim().split(' ').forEach(function (w) {
    var cats = ix.words[w] || ix.words[w.replace(/s$/, '')];
    if (cats) Object.keys(cats).forEach(bump);
  });
  return Object.keys(score).sort(function (a, b) { return (score[b] - score[a]) || (a < b ? -1 : 1); });
}

// stores = runner_core STORES ({key,label}). Returns { cats, keys: [stores to open], skip: { key: 'short reason' } }.
function pick(q, stores) {
  var cats = classify(q), keys = [], skip = {};
  (stores || []).forEach(function (s) {
    var sells = SELLS[s.key] || [], hit = !cats.length || ALWAYS[s.key] || cats.some(function (c) { return sells.indexOf(c) >= 0; });
    if (hit) keys.push(s.key); else skip[s.key] = 'does not usually sell ' + (CAT_WORD[cats[0]] || 'this');
  });
  return { cats: cats, keys: keys, skip: skip };
}

module.exports = { classify: classify, pick: pick, SELLS: SELLS, CAT_WORD: CAT_WORD, TERMS: TERMS };
