'use strict';

/*
 * Adrenaline.js execution runner.
 *
 * Boots the *same* shared heavy workload as electron-runner.js using the
 * adrenaline-js `app` / `BrowserWindow` / `ipcMain` surface. The native layer
 * injects the `window.adrenaline` bridge into the WebKitGTK webview, so the
 * renderer file is byte-for-byte identical to the Electron one.
 */

const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, ipcMain } = require('../../index.js');
const { runStress } = require('./app/backend');
const { createHarness } = require('./app/harness');

const INDEX_HTML = path.join(__dirname, 'app', 'index.html');
const RUNTIME = 'adrenaline';

const H = createHarness({
  runtime: RUNTIME,
  resultFile: process.env.STRESS_RESULT_FILE || path.join(__dirname, 'results-adrenaline.json'),
  phaseFile: process.env.STRESS_PHASE_FILE || path.join(__dirname, 'phase-adrenaline.json'),
});

H.setPhase('boot');

app.whenReady().then(() => {
  H.log('adrenaline ready, creating window');
  const winRef = { win: null };

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Adrenaline Stress Suite',
    lowEndDeviceMode: false,
    privacyShield: false,
    url: pathToFileURL(INDEX_HTML).href,
  });
  winRef.win = win;

  const stress = runStress({ runtime: RUNTIME, ipcMain, winRef, log: H.log, onPhase: H.onPhase });
  H.attach(stress);

  const poll = setInterval(() => {
    if (H.stressStartEpoch) {
      clearInterval(poll);
      H.log('stress started; scheduling finish in ' + H.durationMs + 'ms');
      setTimeout(() => H.finish(() => app.quit()), H.durationMs);
    }
  }, 100);
});

app.on('window-all-closed', (event) => {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
});

process.on('SIGTERM', () => { H.log('SIGTERM received'); H.finish(() => app.quit()); });
process.on('SIGINT', () => { H.log('SIGINT received'); H.finish(() => app.quit()); });
process.on('uncaughtException', (err) => {
  H.log('uncaughtException: ' + (err && err.stack ? err.stack : err));
  H.finish(() => process.exit(1));
});
