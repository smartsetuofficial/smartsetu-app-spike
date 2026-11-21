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
  }
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
  window.addEventListener('load', fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
})();
