/* smartsetu snapdoc v1 (S12-11, D-075). Builds a "search snapshot" (same shape the tab snap makes: {v,kind,query,url,title,cards:[{link,sponsored,ad,html}]})
 * from RAW store HTML text, with NO DOM, NO layout and NO tab. Mirrors the search branch of pagesnap.js snap(), with these known differences:
 * (1) page text = text nodes minus script/style/svg/etc (no CSS, so hidden text still counts); (2) "struck" price = the price element or a parent
 * (up to 3 levels) is <s>/<del>/<strike> or has inline line-through, class-based strike cannot be seen; (3) cards come from the HTML the server sent,
 * not from the page after its JS ran. Pure string work: no network, no storage, no eval. */
(function (root) {
  'use strict';
  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };
  var RAW = { script: 1, style: 1 };
  var DROP = { script: 1, style: 1, noscript: 1, svg: 1, iframe: 1, form: 1, input: 1, textarea: 1, select: 1, link: 1, template: 1, canvas: 1, video: 1, audio: 1, source: 1 };
  var KEEP = { href: 1, 'class': 1, id: 1, role: 1, 'aria-label': 1, title: 1, alt: 1, itemprop: 1, 'data-testid': 1, 'data-struck': 1 };
  var NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201D', ldquo: '\u201C', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', copy: '\u00A9', reg: '\u00AE', trade: '\u2122', times: '\u00D7', middot: '\u00B7', bull: '\u2022', deg: '\u00B0' };
  var priceRe = /^(?:Price\s*:?\s*)?(?:\u20B9|Rs\.?)\s?\d[\d,]*(?:\.\d+)?\.?$/i;

  function decode(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/g, function (m, d, h, n) {
      if (n) return Object.prototype.hasOwnProperty.call(NAMED, n) ? NAMED[n] : m;
      var c = d ? parseInt(d, 10) : parseInt(h, 16);
      if (!(c > 0 && c < 0x110000) || (c >= 0xD800 && c < 0xE000)) return m;
      return String.fromCodePoint(c);
    });
  }
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escAttr(s) { return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

  /* tolerant tree: {tag, attrs, kids, parent} elements and {tx} text nodes. Unknown or misnested closing tags are ignored. */
  function build(html) {
    html = String(html || '');
    var rootEl = { tag: '#root', attrs: {}, kids: [], parent: null }, cur = rootEl, i = 0, n = html.length, depth = 0, nodes = 0;
    function text(s) { if (s) cur.kids.push({ tx: decode(s) }); }
    while (i < n && nodes < 400000) {
      var lt = html.indexOf('<', i);
      if (lt < 0) { text(html.slice(i)); break; }
      if (lt > i) text(html.slice(i, lt));
      i = lt;
      if (html.startsWith('<!--', i)) { var ce = html.indexOf('-->', i + 4); i = ce < 0 ? n : ce + 3; continue; }
      var c1 = html.charCodeAt(i + 1);
      if (c1 === 33 || c1 === 63) { var de = html.indexOf('>', i + 2); i = de < 0 ? n : de + 1; continue; }
      if (c1 === 47) {
        var cm = /^<\/([a-zA-Z][a-zA-Z0-9:-]*)[^>]*>/.exec(html.slice(i, i + 80));
        if (!cm) { var ge = html.indexOf('>', i + 2); i = ge < 0 ? n : ge + 1; continue; }
        var nm = cm[1].toLowerCase(), p = cur, d = 0;
        while (p && p.tag !== '#root' && p.tag !== nm) { p = p.parent; d++; }
        if (p && p.tag === nm && d < 40) { cur = p.parent || rootEl; depth -= (d + 1); }
        i += cm[0].length; continue;
      }
      if (!((c1 >= 65 && c1 <= 90) || (c1 >= 97 && c1 <= 122))) { text('<'); i++; continue; }
      var j = i + 1, q = 0;
      while (j < n) { var ch = html.charCodeAt(j); if (q) { if (ch === q) q = 0; } else if (ch === 34 || ch === 39) q = ch; else if (ch === 62) break; j++; }
      var raw = html.slice(i + 1, j), self = /\/\s*$/.test(raw);
      var tm = /^([a-zA-Z][a-zA-Z0-9:-]*)/.exec(raw);
      var tag = tm[1].toLowerCase(), attrs = {}, am, are = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g, rest = raw.slice(tm[0].length);
      while ((am = are.exec(rest)) !== null) { var an = am[1].toLowerCase(); if (!Object.prototype.hasOwnProperty.call(attrs, an)) attrs[an] = decode(am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : ''); }
      var el = { tag: tag, attrs: attrs, kids: [], parent: cur }; cur.kids.push(el); nodes++;
      i = j + 1;
      if (RAW[tag]) { var re2 = new RegExp('</' + tag + '[\\s>]', 'i'), mm = re2.exec(html.slice(i)); i = mm ? i + mm.index + mm[0].length : n; continue; }
      if (VOID[tag] || self) continue;
      if (depth < 400) { cur = el; depth++; }
    }
    return rootEl;
  }

  function elKids(e) { return e.kids.filter(function (k) { return !k.tx && k.tag; }); }
  function walk(e, fn) { var st = [e]; while (st.length) { var x = st.pop(); if (x.tag && x !== e) fn(x); if (x.kids) for (var k = x.kids.length - 1; k >= 0; k--) st.push(x.kids[k]); } }
  function textOf(e, sep) {
    var out = [];
    (function rec(x) { if (x.tx !== undefined) { var t = x.tx.replace(/\s+/g, ' ').trim(); if (t) out.push(t); return; } if (DROP[x.tag]) return; for (var k = 0; k < x.kids.length; k++) rec(x.kids[k]); })(e);
    return out.join(sep);
  }
  function selfStruck(e) { return e.tag === 's' || e.tag === 'del' || e.tag === 'strike' || /line-through/i.test(e.attrs.style || ''); }
  function struck(e) { var p = e, k = 0; while (p && p.tag !== '#root' && k < 4) { if (selfStruck(p)) return true; p = p.parent; k++; } return false; }
  function closestAttr(e, name, val) { var p = e; while (p && p.tag !== '#root') { if (p.attrs && p.attrs[name] === val) return p; p = p.parent; } return null; }
  function absHref(h, base) { try { return new URL(h, base).href; } catch (_) { return ''; } }

  function serialize(e, mark, base) {
    var out = [];
    (function rec(x, isTop) {
      if (x.tx !== undefined) { out.push(esc(x.tx)); return; }
      if (DROP[x.tag] && !isTop) return;
      var a = '';
      Object.keys(x.attrs).forEach(function (k) { if (KEEP[k]) { var v = x.attrs[k]; if (k === 'href') v = (absHref(v, base) || v).slice(0, 300); a += ' ' + k + '="' + escAttr(v) + '"'; } });
      if (mark.has(x)) a += ' data-struck="1"';
      out.push('<' + x.tag + a + '>');
      if (!VOID[x.tag]) { for (var k = 0; k < x.kids.length; k++) rec(x.kids[k], false); out.push('</' + x.tag + '>'); }
    })(e, true);
    return out.join('').replace(/\s+/g, ' ');
  }

  function snapFromHtml(html, pageUrl, query) {
    var tree = build(html), url, host = '';
    try { url = new URL(pageUrl); host = url.hostname.replace(/^www\./, ''); } catch (_) { url = null; }
    var out = { v: 1, kind: 'search', query: query || null, url: pageUrl, title: '', time: new Date().toISOString(), cards: [], probe: 'snapdoc-1' };
    if (!url) return out;
    var all = [], body = null;
    walk(tree, function (e) { all.push(e); if (e.tag === 'body' && !body) body = e; if (e.tag === 'title' && !out.title) out.title = textOf(e, ' ').slice(0, 120); });
    var leaves = all.filter(function (e) { return elKids(e).length === 0 && !DROP[e.tag] && priceRe.test(textOf(e, ' ').trim()); });
    function sameSite(a) { var h = a.attrs.href || ''; if (/^\s*javascript/i.test(h)) return false; try { var u = new URL(h, pageUrl); return u.pathname !== '/' && (u.hostname === host || u.hostname === 'www.' + host || u.hostname.endsWith('.' + host)); } catch (_) { return false; } }
    function links(p) { var r = []; walk(p, function (e) { if (e.tag === 'a' && e.attrs.href !== undefined && sameSite(e)) r.push(e); }); return r; }
    var seen = new Set(), markAll = new Set();
    leaves.forEach(function (l) { if (struck(l)) markAll.add(l); });
    for (var li = 0; li < leaves.length; li++) {
      var n = leaves[li];
      if (struck(n)) continue;
      var p = n;
      for (var s = 0; s < 7 && p.parent && p.parent.tag !== '#root'; s++) {
        p = p.parent;
        var len = textOf(p, ' ').length, hasA = false;
        walk(p, function (e) { if (e.tag === 'a' && e.attrs.href !== undefined) hasA = true; });
        if (hasA && len > 30 && len < 700) break;
      }
      var az = host === 'amazon.in' ? closestAttr(n, 'data-component-type', 's-search-result') : null;
      if (az) p = az;
      if (seen.has(p) || p === body || p.tag === '#root') continue;
      var as = links(p), a = (az && as.filter(function (x) { return /\/dp\/[A-Z0-9]{10}/.test(absHref(x.attrs.href, pageUrl)); })[0]) || as[0];
      if (!a) continue;
      seen.add(p);
      var ptext = textOf(p, '\n'), link = absHref(a.attrs.href, pageUrl);
      var mark = new Set(); walk(p, function (e) { if (markAll.has(e)) mark.add(e); });
      out.cards.push({ link: link.slice(0, 300), sponsored: /\/sspa\/click|sponsored/i.test(link) || /sponsored/i.test(ptext), ad: /(^|\n)\s*AD\s*(\n|$)/.test(ptext), html: (function () { var h = serialize(p, mark, pageUrl); return h.length > 6000 ? h.slice(0, 6000) + '<!--TRUNCATED-->' : h; })() });
      if (out.cards.length >= 24) break;
    }
    return out;
  }

  var api = { build: build, snapFromHtml: snapFromHtml, decode: decode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SmartSetuSnapDoc = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
