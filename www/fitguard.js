/* S23-F-2a (D-133) + S23-F-3 (D-138): when the system font size makes the big heading wider than its box, the display texts (heading, logo name, motto, tag) are made smaller by the measured ratio so they look as at normal font size, and the heading wraps only as a last resort. At normal font size the heading overflows its box by only 0 to 3 px (measured, 6 widths), so nothing changes there. No storage, no network. */
(function () {
  'use strict';
  var root = document.documentElement;
  var h = document.querySelector('.hero h1');
  if (!h) return;
  var LIMIT = 8, MINK = 0.55;
  function fit() {
    try {
      root.classList.remove('fitwrap');
      root.style.removeProperty('--fitk');
      var lines = h.querySelectorAll('.l1,.l2,.l3');
      var over = 0, k = 1;
      for (var i = 0; i < lines.length; i++) {
        var sw = lines[i].scrollWidth, cw = lines[i].clientWidth;
        if (sw - cw > over) over = sw - cw;
        if (sw > cw && cw > 0) k = Math.min(k, cw / sw);
      }
      if (over > LIMIT) {
        k = Math.max(MINK, Math.floor(k * 97) / 100);
        root.style.setProperty('--fitk', String(k));
        root.classList.add('fitwrap');
      }
    } catch (e) { /* never block the app */ }
    try { fitHeader(); } catch (e) { /* never block the app */ }
    try { fitPlaceholder(); } catch (e) { /* never block the app */ }
    try { fitOneLine(); } catch (e) { /* never block the app */ }
    try { fitHeight(); } catch (e) { /* never block the app */ }
  }
  /* S23-9 (D-142): the logo row (logo + motto + tag) is measured too, not only the heading. If the tag would touch the logo text or leave the screen, the row texts shrink step by step; if even 0.5 does not fit, the tag drops to its own row. */
  function fitHeader() {
    var wrap = document.querySelector('.top .wrap'), tag = document.querySelector('.top .tag');
    var brand = document.querySelector('.top .brand'), motto = document.querySelector('.top .motto');
    if (!wrap || !tag || !brand || !motto) return;
    root.classList.remove('hdrfit'); root.classList.remove('hdrwrap'); root.style.removeProperty('--hk');
    function bad() {
      var wr = wrap.getBoundingClientRect(), cs = getComputedStyle(wrap), tr = tag.getBoundingClientRect(), right = 0, rg = document.createRange();
      [brand, motto].forEach(function (n) { rg.selectNodeContents(n); right = Math.max(right, rg.getBoundingClientRect().right); });
      var limit = wr.right - parseFloat(cs.paddingRight);
      return tr.left < right + 6 || tr.right > limit + 0.5 || wrap.scrollWidth > wrap.clientWidth + 1;
    }
    if (!bad()) return;
    var k = root.classList.contains('fitwrap') ? (parseFloat(root.style.getPropertyValue('--fitk')) || 1) : 1;
    root.classList.add('hdrfit');
    for (var i = 0; i < 14; i++) {
      root.style.setProperty('--hk', String(Math.round(k * 100) / 100));
      if (!bad()) return;
      k = k * 0.93;
      if (k < 0.5) break;
    }
    root.classList.remove('hdrfit'); root.style.removeProperty('--hk'); root.classList.add('hdrwrap');
  }
  /* S23-9 (D-142): if the search hint is wider than the box (big font, narrow phone) it is shortened instead of ending in '...'. What the person types is never changed. */
  function fitPlaceholder() {
    var inp = document.querySelector('.search input');
    if (!inp) return;
    if (!inp.getAttribute('data-ph')) inp.setAttribute('data-ph', inp.getAttribute('placeholder') || '');
    var full = inp.getAttribute('data-ph');
    var cs = getComputedStyle(inp), ps = getComputedStyle(inp, '::placeholder');
    var c = document.createElement('canvas').getContext('2d');
    if (!c) return;
    c.font = (ps.fontWeight || '500') + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    var have = inp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2;
    var opts = [full, 'Search a product', 'Search product', 'Search', ''];
    var pick = '';
    for (var i = 0; i < opts.length; i++) { if (c.measureText(opts[i]).width <= have) { pick = opts[i]; break; } }
    if (inp.getAttribute('placeholder') !== pick) inp.setAttribute('placeholder', pick);
  }
  /* S23-12 (D-157): the idle home screen (no results, no progress, no card panel) must show everything from the logo to the slogan on one screen, on any phone height. Steps from the least to the most visible change, each tested by measuring the real page height: (1) gaps, card height and footer space shrink by a ratio, (2) the 'Why SmartSetu' card turns into a compact row, (3) the privacy note (it is also a slide) is hidden, (4) the lead line is hidden. Heading, logo, search and Compare button are never made smaller by this step. Not applied in landscape or while the keyboard is open. No storage, no network. */
  var HF_CLS = ['hfit', 'hfrow', 'hfpriv', 'hftry', 'hflead'];
  /* S23-15 (D-160): every measurement starts from the plain page. Classes and variables of the last measurement never stay behind (they spoiled the next one). */
  var VCLS = HF_CLS.concat(['hgrow', 'hx', 'idlehome', 'navres']), VVARS = ['--hf', '--hft', '--hg', '--hx', '--navres'];
  function resetVertical() {
    VCLS.forEach(function (c) { root.classList.remove(c); });
    VVARS.forEach(function (v) { root.style.removeProperty(v); });
  }
  /* The bottom safe area as the page really gets it (px). Some phones with the 3 button bar report 0 although the page runs under the bar. */
  function sabPx() {
    try { return sabPx1(); } catch (e) { return 0; }
  }
  function sabPx1() {
    var p = document.createElement('div');
    p.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:0;visibility:hidden;padding-bottom:var(--sab,0px)';
    document.body.appendChild(p);
    var v = parseFloat(getComputedStyle(p).paddingBottom) || 0;
    document.body.removeChild(p);
    return v;
  }
  function idleHome() {
    var ids = ['progress', 'empty', 'morebox', 'cardspanel'];
    for (var i = 0; i < ids.length; i++) { var n = document.getElementById(ids[i]); if (n && !n.hidden) return false; }
    var r = document.getElementById('results');
    return !(r && r.firstChild);
  }
  function fitHeight() {
    resetVertical();
    try { fitHeightCore(); } catch (e) { /* never block the app */ }
    try { fitGrow(); } catch (e) { /* never block the app */ }
  }
  /* S23-15 (D-160): the slogan must stay above the system bar. The page keeps at least 52 px (or the reported safe area, if larger) free under the slogan; the steps then only have to fit what is left. Steps from the least to the most: smaller Why cards, one compact row per card, privacy note hidden, Why heading and dots hidden, lead hidden. */
  function fitHeightCore() {
    var vh = window.innerHeight, vw = window.innerWidth;
    if (!vh || !vw || vw > vh || !idleHome()) return;
    var ae = document.activeElement;
    if (ae && ae.tagName === 'INPUT') { return; }
    root.style.setProperty('--navres', Math.max(0, Math.round(52 - sabPx())) + 'px'); root.classList.add('navres');
    function over() { return root.scrollHeight - vh; }
    if (over() <= 1) return;
    var sets = [[['hfit'], 0.76], [['hfit', 'hfrow'], 0.6], [['hfit', 'hfrow', 'hfpriv'], 0.6], [['hfit', 'hfrow', 'hfpriv', 'hftry'], 0.6], [['hfit', 'hfrow', 'hfpriv', 'hftry', 'hflead'], 0.4]];
    for (var s = 0; s < sets.length; s++) {
      HF_CLS.forEach(function (c) { root.classList.remove(c); });
      sets[s][0].forEach(function (c) { root.classList.add(c); });
      for (var hf = 1; hf >= sets[s][1] - 0.001; hf -= 0.04) {
        root.style.setProperty('--hf', String(Math.round(hf * 100) / 100));
        root.style.setProperty('--hft', String(Math.max(Math.round(hf * 100) / 100, 0.82)));
        if (over() <= 1) return;
      }
    }
  }
  /* S23-14 (D-159): (a) the eyebrow, the card-offers hint and the slogan stay on ONE line: the text shrinks step by step (measured, never below its minimum); only if even the minimum does not fit does that one text wrap as before. (b) idle home taller than its content: the slogan is pinned to the bottom of the screen (class idlehome) and the Why cards take part of the spare height (class hgrow, --hg), so every phone height looks the same. Nothing changes when the page already fills the screen. No storage, no network. */
  var OL = [['eb', '.eyebrow', 0.55], ['cs', '.cardsrow .cr-s', 0.6], ['ld', '.hero .lead', 0.65], ['sl', '.slogan', 0.62]];
  function fitOneLine() {
    for (var i = 0; i < OL.length; i++) {
      var key = OL[i][0], el = document.querySelector(OL[i][1]);
      root.classList.remove('ol-' + key); root.style.removeProperty('--o-' + key);
      if (!el) continue;
      root.classList.add('ol-' + key);
      var k = 1, fit1 = false;
      for (;;) {
        root.style.setProperty('--o-' + key, String(Math.round(k * 100) / 100));
        if (el.scrollWidth <= el.clientWidth + 1) { fit1 = true; break; }
        k -= 0.04;
        if (k < OL[i][2] - 0.001) break;
      }
      if (!fit1) { root.classList.remove('ol-' + key); root.style.removeProperty('--o-' + key); }
    }
  }
  /* S23-15 (D-160): what is left over after the steps is given back to the page, not left empty: first the Why card grows (up to a cap, its picture with it), then the gaps between the blocks grow a little (--hx); the slogan is pinned to the bottom (idlehome). Every growth is checked (page never taller than the window) and halved when it does not fit. */
  function fitGrow() {
    var vh = window.innerHeight, vw = window.innerWidth;
    if (!vh || !vw || vw > vh || !idleHome()) return;
    var ae = document.activeElement;
    if (ae && ae.tagName === 'INPUT') return;
    var foot = document.querySelector('.foot'), li = document.querySelector('.perks li');
    if (!foot || !li) return;
    function over() { return root.scrollHeight - vh; }
    var spare = vh - foot.getBoundingClientRect().bottom;
    root.classList.add('idlehome');
    if (spare < 6) return;
    var rem = parseFloat(getComputedStyle(root).fontSize) || 16, row = root.classList.contains('hfrow');
    var cur = li.offsetHeight, cap = (row ? 11 : 15.5) * rem;
    var grow = Math.min(Math.floor(spare - 2), Math.max(0, Math.floor(cap - cur)));
    var used = 0;
    for (var i = 0; i < 6 && grow >= 6; i++) {
      root.style.setProperty('--hg', (cur + grow) + 'px'); root.classList.add('hgrow');
      if (over() <= 1) { used = grow; break; }
      grow = Math.floor(grow / 2);
    }
    if (!used) { root.classList.remove('hgrow'); root.style.removeProperty('--hg'); }
    var left = spare - used - 2;
    if (left >= 14) {
      var hx = Math.min(Math.floor(left / 7), Math.round(1.4 * rem));
      for (var j = 0; j < 6 && hx >= 2; j++) {
        root.style.setProperty('--hx', hx + 'px'); root.classList.add('hx');
        if (over() <= 1) return;
        hx = Math.floor(hx / 2);
      }
      root.classList.remove('hx'); root.style.removeProperty('--hx');
    }
  }
  /* S23-15 (D-160): what the Full Test report prints on its HOME line, so that a screen that still looks wrong can be read in numbers. */
  window.smartsetuHomeDiag = function () {
    var f = document.querySelector('.foot'), s = document.querySelector('.slogan'), li = document.querySelector('.perks li'), m = document.querySelector('.mark');
    var vv = window.visualViewport;
    return { iw: window.innerWidth, ih: window.innerHeight, ch: root.clientHeight, vv: vv ? Math.round(vv.height) : null, sh: root.scrollHeight, sab: Math.round(sabPx()), dpr: window.devicePixelRatio, rem: parseFloat(getComputedStyle(root).fontSize), cls: root.className, foot: f ? Math.round(f.getBoundingClientRect().bottom) : null, slog: s ? Math.round(s.getBoundingClientRect().bottom) : null, card: li ? li.offsetHeight : null, mark: m ? Math.round(m.getBoundingClientRect().width) : null, hg: root.style.getPropertyValue('--hg') || null, hf: root.style.getPropertyValue('--hf') || null, hx: root.style.getPropertyValue('--hx') || null };
  };
  var hfTimer = 0;
  function hfSoon() { if (hfTimer) clearTimeout(hfTimer); hfTimer = setTimeout(function () { hfTimer = 0; try { fitHeight(); } catch (e) { /* never block the app */ } }, 60); }
  try {
    if (typeof MutationObserver === 'function') {
      var mo = new MutationObserver(hfSoon);
      ['progress', 'results', 'empty', 'morebox', 'cardspanel'].forEach(function (id) {
        var n = document.getElementById(id); if (n) mo.observe(n, { attributes: true, attributeFilter: ['hidden'], childList: true });
      });
    }
    window.addEventListener('focusout', function () { setTimeout(hfSoon, 350); });
  } catch (e) { /* never block the app */ }
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
  window.addEventListener('load', fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
})();
