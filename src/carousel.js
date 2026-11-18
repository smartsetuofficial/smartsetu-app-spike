/* smartsetu app / carousel v1.1.0 (S22g D-124, S22h D-125: 3D look = class prev/next on the neighbours).  The "Why SmartSetu?" cards on Home slide one by one (auto, and by swipe or dot tap).
 * Only scrolling, class names and dots. No network, no storage, no data read. Auto slide stops when the person touches it, when the page is hidden,
 * and never starts when the phone asks for reduced motion. Tested in Node with a fake page (test_s22g.js). */
'use strict';

function nextIndex(i, n) { return n > 0 ? (i + 1) % n : 0; }
function indexAt(left, step, n) {
  if (!(step > 0) || !(n > 0)) return 0;
  var i = Math.round(left / step);
  return i < 0 ? 0 : (i > n - 1 ? n - 1 : i);
}

function make(ul, doc, win, opt) {
  if (!ul || !ul.children || ul.children.length < 2) return null;
  opt = opt || {};
  var items = Array.prototype.slice.call(ul.children), n = items.length, cur = 0, ticker = 0, resumer = 0, held = false;
  var every = opt.every || 4200, rest = opt.rest || 6000, dots = [], reduce = false;
  try { reduce = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { reduce = false; }

  ul.classList.add('js');
  ul.setAttribute('role', 'region'); ul.setAttribute('aria-roledescription', 'carousel'); ul.setAttribute('aria-label', 'Why SmartSetu');
  items.forEach(function (it, k) { it.setAttribute('role', 'group'); it.setAttribute('aria-roledescription', 'slide'); it.setAttribute('aria-label', (k + 1) + ' of ' + n); });

  var bar = doc.createElement('div'); bar.className = 'pdots';
  items.forEach(function (_, k) {
    var b = doc.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', 'Show card ' + (k + 1) + ' of ' + n);
    b.addEventListener('click', function () { go(k, true); });
    bar.appendChild(b); dots.push(b);
  });
  if (ul.parentNode) ul.parentNode.insertBefore(bar, ul.nextSibling);

  function step() { return items[1].offsetLeft - items[0].offsetLeft; }
  function mark(i) {
    cur = i;
    items.forEach(function (it, k) {
      if (k === i) it.classList.add('on'); else it.classList.remove('on');
      if (k === i - 1) it.classList.add('prev'); else it.classList.remove('prev');
      if (k === i + 1) it.classList.add('next'); else it.classList.remove('next');
    });
    dots.forEach(function (d, k) { if (k === i) { d.classList.add('on'); d.setAttribute('aria-current', 'true'); } else { d.classList.remove('on'); d.removeAttribute('aria-current'); } });
  }
  function go(i, byPerson) {
    var x = i * step();
    try { ul.scrollTo({ left: x, behavior: 'smooth' }); } catch (_) { ul.scrollLeft = x; }
    mark(i);
    if (byPerson) { hold(); release(); }
  }
  function hold() { held = true; if (resumer) { win.clearTimeout(resumer); resumer = 0; } }
  function release() { if (resumer) win.clearTimeout(resumer); resumer = win.setTimeout(function () { held = false; resumer = 0; }, rest); }
  function tick() { if (held || (doc && doc.hidden)) return; go(nextIndex(cur, n), false); }
  function stop() { if (ticker) { win.clearInterval(ticker); ticker = 0; } if (resumer) { win.clearTimeout(resumer); resumer = 0; } }

  ['touchstart', 'pointerdown', 'mousedown', 'focusin'].forEach(function (e) { ul.addEventListener(e, hold, { passive: true }); });
  ['touchend', 'touchcancel', 'pointerup', 'mouseup', 'focusout'].forEach(function (e) { ul.addEventListener(e, release, { passive: true }); });
  ul.addEventListener('scroll', function () { var i = indexAt(ul.scrollLeft, step(), n); if (i !== cur) mark(i); }, { passive: true });
  if (win.addEventListener) win.addEventListener('resize', function () { ul.scrollLeft = cur * step(); });

  mark(0);
  if (!reduce) ticker = win.setInterval(tick, every);
  return { go: go, stop: stop, index: function () { return cur; }, count: n, auto: !reduce };
}

module.exports = { make: make, nextIndex: nextIndex, indexAt: indexAt };
