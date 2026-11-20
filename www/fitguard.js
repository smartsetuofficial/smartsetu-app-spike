/* S23-F-2a (D-133): when the system font size makes the big heading wider than its box, let it wrap so it never runs under the cart picture.
   At normal font size the heading overflows its box by only 0 to 3 px (measured, 6 widths), so nothing changes there. No storage, no network. */
(function () {
  'use strict';
  var root = document.documentElement;
  var h = document.querySelector('.hero h1');
  if (!h) return;
  var LIMIT = 8;
  function fit() {
    try {
      root.classList.remove('fitwrap');
      var lines = h.querySelectorAll('.l1,.l2,.l3');
      var over = 0;
      for (var i = 0; i < lines.length; i++) {
        var d = lines[i].scrollWidth - lines[i].clientWidth;
        if (d > over) over = d;
      }
      if (over > LIMIT) root.classList.add('fitwrap');
    } catch (e) { /* never block the app */ }
  }
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
  window.addEventListener('load', fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
})();
