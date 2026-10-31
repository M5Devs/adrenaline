'use strict';

/*
 * Electron execution runner (baseline).
 *
 * Boots the shared heavy workload with Electron's own app / BrowserWindow /
 * ipcMain. Everything below the runStress() call is runtime-agnostic and
 * identical to adrenaline-runner.js, so the comparison is apples-to-apples.
 */

const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { runStress } = require('./app/backend');
const { createHarness } = require('./app/harness');

const INDEX_HTML = path.join(__dirname, 'app', 'index.html');
const PRELOAD = path.join(__dirname, 'app', 'preload.js');
const RUNTIME = 'electron';

// Headless-container friendly flags. `--no-sandbox` is also passed on argv by
// the profiler; these switches remove GPU/dbus noise that is irrelevant to the
// workload and would otherwise pollute the CPU samples.
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.disableHardwareAcceleration();

const H = createHarness({
  runtime: RUNTIME,
  resultFile: process.env.STRESS_RESULT_FILE || path.join(__dirname, 'results-electron.json'),
  phaseFile: process.env.STRESS_PHASE_FILE || path.join(__dirname, 'phase-electron.json'),
});

H.setPhase('boot');

app.whenReady().then(() => {
  H.log('electron ready, creating window');
  const winRef = { win: null };
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true,
    title: 'Adrenaline Stress Suite',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      offscreen: false,
    },
  });
  winRef.win = win;

  const stress = runStress({ runtime: RUNTIME, ipcMain, winRef, log: H.log, onPhase: H.onPhase });
  H.attach(stress);

  win.loadFile(INDEX_HTML);
  win.webContents.on('did-finish-load', () => H.log('did-finish-load'));

  const poll = setInterval(() => {
    if (H.stressStartEpoch) {
      clearInterval(poll);
      H.log('stress started; scheduling finish in ' + H.durationMs + 'ms');
      setTimeout(() => H.finish(() => app.exit(0)), H.durationMs);
    }
  }, 100);
});

app.on('window-all-closed', () => {
  // Keep the process alive until the runner decides to exit.
});

process.on('SIGTERM', () => { H.log('SIGTERM received'); H.finish(() => app.exit(0)); });
process.on('SIGINT', () => { H.log('SIGINT received'); H.finish(() => app.exit(0)); });
process.on('uncaughtException', (err) => {
  H.log('uncaughtException: ' + (err && err.stack ? err.stack : err));
  H.finish(() => app.exit(1));
});
