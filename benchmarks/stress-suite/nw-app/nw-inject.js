'use strict';

/*
 * NW.js in-window bridge (injected via `inject_js_start` before any DOM script).
 *
 * NW.js has no ipcRenderer/ipcMain pair. The idiomatic equivalent is a Node
 * "background page" (nw-main.js) that opens the app window and bridges the two
 * JavaScript contexts. This file exposes the same `window.adrenaline` surface
 * the Adrenaline.js native layer injects and the Electron preload exposes, so
 * the shared renderer workload is byte-for-byte identical across runtimes.
 *
 *   window.adrenaline.send(channel, data)  -> window.__nwToNode (assigned by nw-main.js)
 *   window.__nwDeliver(channel, data)      <- called by nw-main.js
 */

(function () {
  var listeners = {};
  var queue = [];

  window.adrenaline = {
    send: function (channel, data) {
      if (typeof window.__nwToNode === 'function') window.__nwToNode(channel, data);
      else queue.push([channel, data]);
    },
    on: function (channel, cb) {
      (listeners[channel] = listeners[channel] || []).push(cb);
    },
    invoke: function () {
      return Promise.reject(new Error('invoke is not supported by the NW.js runner bridge'));
    },
  };

  window.__nwDeliver = function (channel, data) {
    var cbs = listeners[channel];
    if (!cbs) return;
    for (var i = 0; i < cbs.length; i++) {
      try { cbs[i](data); } catch (e) { /* keep the other listeners alive */ }
    }
  };

  // Drain anything the renderer sent before nw-main.js finished wiring up.
  window.__nwFlush = function () {
    if (typeof window.__nwToNode !== 'function') return;
    var q = queue;
    queue = [];
    for (var i = 0; i < q.length; i++) window.__nwToNode(q[i][0], q[i][1]);
  };
})();
