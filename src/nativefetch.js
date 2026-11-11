/* smartsetu app / nativefetch v1 (S15, D-096). A fetch-like function that asks the phone's own network layer (Capacitor "CapacitorHttp", bundled with @capacitor/core,
 * official docs: capacitorjs.com/docs/apis/http, V-272) for a store SEARCH page, so no browser page is needed and no CORS rule applies.
 * Used with fetchread.js + snapdoc.js (same files as the Chrome extension, V-195). Only inside the Compare click. No cookies are sent, nothing is stored.
 * Returns what fetchread.js needs: { status, url, text() }. It never throws for an HTTP error status, only for a network failure. */
'use strict';

function makeFetch(http, ua, o) {
  o = o || {};
  return function (url) {
    var headers = { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'en-IN,en;q=0.9' };
    if (ua) headers['User-Agent'] = ua;
    return Promise.resolve(http.get({ url: url, headers: headers, responseType: 'text', connectTimeout: o.connectMs || 6000, readTimeout: o.readMs || 9000 })).then(function (r) {
      var d = r && r.data, text = typeof d === 'string' ? d : (d == null ? '' : JSON.stringify(d));
      return { status: Number(r && r.status) || 0, url: (r && r.url) || url, text: function () { return Promise.resolve(text); } };
    });
  };
}

module.exports = { makeFetch: makeFetch };
