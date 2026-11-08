/* smartsetu app / webtabs v1 (S14-1). Gives runner_core.js (the same file the Chrome extension uses) a chrome-like "tabs + scripting" object that is backed by the
 * hidden webview plugin. One store after another (the runner is started with maxTabs 1). Nothing is stored, no cookies or login are read, no network from here.
 * api for the plugin: { open({url, visible}) -> id, exec({id, code}), close({id}), onMessage(fn) -> Promise(unsub), onLoaded(fn) -> Promise(unsub) } */
'use strict';

function detailOf(ev) {
  if (ev && ev.detail && typeof ev.detail === 'object') return ev.detail;
  if (ev && typeof ev.rawMessage === 'string') { try { var j = JSON.parse(ev.rawMessage); return (j && j.detail) || j; } catch (_) {} }
  return null;
}

// Stores that are not read on the phone yet (shown honestly on the screen, D-078, D-081). Key = runner_core store key, label = runner_core store label.
var OFF_TEXT = { myntra: 'No data on the phone app yet' };
function enabledMap() { return { Myntra: false }; }
// view.js gives the store line text; the app adds the plain reason for a store that is off and the short error for a store that failed.
function lineText(run, text) {
  if (run && run.state === 'off' && OFF_TEXT[run.key]) return OFF_TEXT[run.key];
  if (run && run.state === 'error' && run.error) return text + ' (' + String(run.error).replace(/\s+/g, ' ').slice(0, 90) + ')';
  return text;
}

function createWebTabs(plugin, o) {
  o = o || {};
  var execMs = o.execMs == null ? 45000 : o.execMs;
  var listeners = [], pending = {}, loaded = {}, current = null, opening = false, earlyLoad = false, seq = 0, unsubs = [], inited = null;

  function onMsg(ev) {
    var d = detailOf(ev); if (!d || !d.cid) return;
    var p = pending[d.cid]; if (!p) return;
    if (d.kind === 'exec_ack') { p.acked = true; return; }
    if (d.kind !== 'exec') return;
    delete pending[d.cid]; clearTimeout(p.timer);
    if (d.ok) p.resolve([{ result: d.result }]); else p.reject(new Error(d.error || 'page script failed'));
  }
  function onLoad() {
    if (opening) { earlyLoad = true; return; } // the page finished loading before the plugin gave back the id
    if (current == null) return;
    loaded[current] = true;
    listeners.slice().forEach(function (l) { try { l(current, { status: 'complete' }); } catch (_) {} });
  }
  function init() {
    if (!inited) inited = Promise.all([plugin.onMessage(onMsg), plugin.onLoaded(onLoad)]).then(function (u) { unsubs = u; });
    return inited;
  }
  function failPending(tabId, why) {
    Object.keys(pending).forEach(function (k) { var p = pending[k]; if (tabId == null || p.tabId === tabId) { delete pending[k]; clearTimeout(p.timer); p.reject(new Error(why)); } });
  }

  var tabs = {
    create: function (spec) {
      return init().then(function () {
        opening = true; earlyLoad = false;
        return Promise.resolve(plugin.open({ url: spec.url, visible: !!spec.active })).then(function (id) {
          current = id; loaded[id] = earlyLoad; opening = false;
          return { id: id, status: earlyLoad ? 'complete' : 'loading' };
        }, function (e) { opening = false; throw e; });
      });
    },
    get: function (id) { return Promise.resolve({ id: id, status: loaded[id] ? 'complete' : 'loading' }); },
    remove: function (id) {
      failPending(id, 'tab closed');
      if (current === id) current = null;
      delete loaded[id];
      return Promise.resolve(plugin.close({ id: id }));
    },
    onUpdated: {
      addListener: function (fn) { listeners.push(fn); },
      removeListener: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }
    }
  };

  var scripting = {
    executeScript: function (spec) {
      var func = spec && spec.func, args = (spec && spec.args) || [], tabId = spec && spec.target && spec.target.tabId;
      if (typeof func !== 'function') return Promise.reject(new Error('func missing'));
      var cid = 'c' + (++seq);
      var code = '(async function () {\n' +
        'var C = ' + JSON.stringify(cid) + ';\n' +
        'function send(o) { try { window.mobileApp.postMessage({ detail: o }); } catch (e) {} }\n' +
        'send({ kind: "exec_ack", cid: C });\n' +
        'try {\n' +
        '  var r = await (' + func.toString() + ').apply(null, ' + JSON.stringify(args) + ');\n' +
        '  send({ kind: "exec", cid: C, ok: true, result: r === undefined ? null : r });\n' +
        '} catch (e) {\n' +
        '  send({ kind: "exec", cid: C, ok: false, error: String((e && e.message) || e) });\n' +
        '}\n})();\n';
      return init().then(function () {
        return new Promise(function (resolve, reject) {
          var p = { tabId: tabId, resolve: resolve, reject: reject, acked: false, timer: null };
          p.timer = setTimeout(function () {
            delete pending[cid];
            reject(new Error(p.acked ? 'page started but its answer did not come back in time' : 'no answer from the page (bridge missing or page too slow)'));
          }, execMs);
          pending[cid] = p;
          Promise.resolve().then(function () { return plugin.exec({ id: tabId, code: code }); }).catch(function (e) {
            if (pending[cid]) { delete pending[cid]; clearTimeout(p.timer); reject(e); }
          });
        });
      });
    }
  };

  function dispose() {
    failPending(null, 'closed');
    unsubs.forEach(function (u) { try { if (typeof u === 'function') u(); } catch (_) {} });
    unsubs = []; inited = null; listeners = [];
  }
  return { tabs: tabs, scripting: scripting, dispose: dispose };
}

var api = { createWebTabs: createWebTabs, detailOf: detailOf, enabledMap: enabledMap, lineText: lineText, OFF_TEXT: OFF_TEXT };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
