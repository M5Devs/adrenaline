'use strict';

/*
 * Neutralinojs in-page bridge.
 *
 * Neutralino has no ipcRenderer equivalent. The idiomatic bridge is the
 * extension event protocol: the UI calls `extensions.dispatch` to send, and
 * listens with `events.on` to receive broadcasts. This file exposes the same
 * `window.adrenaline` surface the Adrenaline.js native layer injects and the
 * Electron preload exposes, so the shared renderer workload is unchanged.
 *
 * Sends are queued until the extension reports it is connected, because
 * `extensions.dispatch` rejects outright if the extension is not yet loaded.
 */

Neutralino.init();
Neutralino.events.on('windowClose', function () { Neutralino.app.exit(); });

(function () {
  var EXT_ID = 'js.royalrumble.backend';
  var ready = false;
  var queue = [];

  function flush() {
    var q = queue;
    queue = [];
    for (var i = 0; i < q.length; i++) {
      Neutralino.extensions.dispatch(EXT_ID, q[i][0], q[i][1]);
    }
  }

  Neutralino.events.on('stress:done', function () { Neutralino.app.exit(0); });

  Neutralino.events.on('extensionReady', function (e) {
    if (e.detail === EXT_ID) { ready = true; flush(); }
  });

  window.adrenaline = {
    send: function (channel, data) {
      if (!ready) { queue.push([channel, data]); return; }
      return Neutralino.extensions.dispatch(EXT_ID, channel, data);
    },
    on: function (channel, cb) {
      Neutralino.events.on(channel, function (e) { cb(e.detail); });
    },
    invoke: function () {
      return Promise.reject(new Error('invoke is not supported by the Neutralino runner bridge'));
    },
  };
})();
