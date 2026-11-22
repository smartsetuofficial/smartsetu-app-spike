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
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
  window.addEventListener('load', fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
})();
