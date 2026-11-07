/* smartsetu app-spike / app v0.1 (S13-1). Glue only: plugin calls + screen. Logic is in spike_core.js (tested in Node). */
import { InAppBrowser, InvisibilityMode } from '@capgo/capacitor-inappbrowser';
var core = require('./spike_core.js');

var $ = function (id) { return document.getElementById(id); };
var running = false;

function pluginApi() {
  return {
    open: function (o) { return InAppBrowser.openWebView({ url: o.url, hidden: true, invisibilityMode: InvisibilityMode.FAKE_VISIBLE }).then(function (r) { return r && r.id; }); },
    exec: function (o) { return InAppBrowser.executeScript({ id: o.id, code: o.code }); },
    close: function (o) { return InAppBrowser.close({ id: o.id }); },
    onMessage: function (fn) { return InAppBrowser.addListener('messageFromWebview', fn).then(function (h) { return function () { h.remove(); }; }); },
    onLoaded: function (fn) { return InAppBrowser.addListener('browserPageLoaded', fn).then(function (h) { return function () { h.remove(); }; }); },
    parse: function (snap) { return window.SmartSetu.parseSearch(snap); }
  };
}

async function go() {
  if (running) return;
  running = true; $('go').disabled = true; $('out').textContent = ''; $('stage').textContent = 'starting...';
  var t0 = Date.now();
  try {
    var src = await (await fetch('pagesnap.js')).text();
    var all = await core.runAll(pluginApi(), $('q').value, {
      pagesnapSrc: src,
      onStage: function (t) { $('stage').textContent = t; },
      onResult: function (r) { $('out').textContent += core.describe(r) + '\n\n'; }
    });
    var ok = all.filter(function (r) { return r.state === 'ok'; }).length;
    $('stage').textContent = 'Done: ' + ok + ' of ' + all.length + ' stores gave listings, ' + Math.round((Date.now() - t0) / 1000) + ' s. Take a screenshot of this screen.';
  } catch (e) {
    $('stage').textContent = 'Failed: ' + String((e && e.message) || e);
  }
  running = false; $('go').disabled = false;
}

document.addEventListener('DOMContentLoaded', function () {
  $('ua').textContent = 'WebView: ' + navigator.userAgent;
  $('go').addEventListener('click', go);
});
