'use strict';

/*
 * NW.js backend (Node "background page", set as `main` in package.json).
 *
 * NW.js keeps the Node.js context separate from the window's DOM context by
 * default. The idiomatic bridge is what a real NW.js app would do: this
 * background page opens the app window, then relays messages between the two
 * contexts. `nw.window.get()` is intentionally NOT used here: it returns the
 * background page itself, not the app window, so a fresh `Window.open(...,
 * callback)` handle is the correct one to bridge.
 *
 * Backend -> UI : win.window.__nwDeliver(channel, data)
 * UI -> backend : win.window.__nwToNode(channel, data)  (assigned here)
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const nw = global.nw || require('nw.gui');
const { createHarness } = require('../app/harness');
const { createStressCore } = require('../app/stress-core');

const RUNTIME = 'nw';
const INDEX_HTML = pathToFileURL(path.join(__dirname, '..', 'app', 'index.html')).href;

const H = createHarness({
  runtime: RUNTIME,
  resultFile: process.env.STRESS_RESULT_FILE || path.join(__dirname, '..', 'results-nw.json'),
  phaseFile: process.env.STRESS_PHASE_FILE || path.join(__dirname, '..', 'phase-nw.json'),
});

H.setPhase('boot');

let stress = null;
const winRef = { win: null };

const transport = {
  _handlers: new Map(),
  on(channel, handler) { this._handlers.set(channel, handler); },
  _deliver(channel, data) {
    const h = this._handlers.get(channel);
    if (h) h(data);
  },
  send(channel, data) {
    const w = winRef.win;
    if (!w) return;
    try { w.window.__nwDeliver(channel, data); } catch (e) { /* window closing */ }
  },
};

stress = createStressCore({ runtime: RUNTIME, transport, log: H.log, onPhase: H.onPhase });
H.attach(stress);

nw.Window.open(INDEX_HTML, {
  width: 1280,
  height: 800,
  show: true,
  title: 'NW.js Royal Rumble',
}, function (win) {
  winRef.win = win;
  win.window.__nwToNode = function (channel, data) { transport._deliver(channel, data); };
  try { win.window.__nwFlush(); } catch (e) { H.log('flush failed: ' + e.message); }

  const poll = setInterval(function () {
    if (H.stressStartEpoch) {
      clearInterval(poll);
      setTimeout(function () { H.finish(function () { nw.App.quit(); }); }, H.durationMs);
    }
  }, 100);
});

process.on('SIGTERM', function () { H.finish(function () { nw.App.quit(); }); });
process.on('SIGINT', function () { H.finish(function () { nw.App.quit(); }); });
process.on('uncaughtException', function (err) {
  H.log('uncaughtException: ' + (err && err.stack ? err.stack : err));
  H.finish(function () { process.exit(1); });
});
