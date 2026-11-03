'use strict';

/*
 * Runtime registry — the single place that knows how to launch each competing
 * desktop runtime on the current platform. `run.js` and the standalone profiler
 * both resolve their launch command from here so there is exactly one definition
 * of "how does this runtime start".
 *
 * Each entry returns:
 *   command : [binary, ...args] passed verbatim to spawn()
 *   cwd     : working directory for the process
 *   env     : extra environment for the process
 *   footprintRuntime : which footprint layout measureFootprint() should use
 *   label   : human-readable name for the report
 *
 * Platform availability:
 *   - adrenaline-webview : Linux (WebKitGTK), macOS (Cocoa/WebKit), Windows (WebView2)
 *   - adrenaline-cef     : Linux only. The vendored CEF build + setup-cef.js are
 *                          linux64-only, so it is omitted elsewhere.
 *   - electron / nw      : all three (their npm installers fetch the right binary)
 *   - neutralino         : all three (the release zip carries every platform binary)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

function electronBinary(repoRoot) {
  const pkg = path.join(repoRoot, 'node_modules', 'electron');
  const rel = fs.readFileSync(path.join(pkg, 'path.txt'), 'utf8').trim();
  return path.join(pkg, 'dist', rel);
}

function nwDistributionDir(repoRoot) {
  const base = path.join(repoRoot, 'node_modules', 'nw');
  const dir = fs.readdirSync(base).find((n) => n.startsWith('nwjs-'));
  return path.join(base, dir);
}

/** Path to the NW.js executable inside its distribution directory. */
function nwBinary(repoRoot) {
  const dist = nwDistributionDir(repoRoot);
  if (IS_WIN) return path.join(dist, 'nw.exe');
  if (IS_MAC) return path.join(dist, 'nwjs.app', 'Contents', 'MacOS', 'nwjs');
  return path.join(dist, 'nw');
}

/** Name of the shipped Neutralinojs runtime binary for this platform/arch. */
function neutralinoBinaryName() {
  if (IS_WIN) return 'neutralino-win_x64.exe';
  if (IS_MAC) return os.arch() === 'arm64' ? 'neutralino-mac_arm64' : 'neutralino-mac_x64';
  return 'neutralino-linux_x64';
}

const RUNTIMES = {
  'adrenaline-webview': {
    label: 'Adrenaline.js (WebView)',
    footprintRuntime: 'adrenaline-webview',
    platforms: ['linux', 'darwin', 'win32'],
    command({ repoRoot, suiteDir }) {
      return {
        command: [process.execPath, path.join(suiteDir, 'adrenaline-runner.js')],
        cwd: repoRoot,
        env: { ADREN_ADDON_PATH: path.join(repoRoot, '.bench-artifacts', 'adrenaline-webview.node') },
      };
    },
  },

  'adrenaline-cef': {
    label: 'Adrenaline.js (CEF)',
    footprintRuntime: 'adrenaline-cef',
    platforms: ['linux'],
    command({ repoRoot, suiteDir }) {
      const cef = path.join(repoRoot, 'vendor', 'cef');
      // Give CEF an explicit cache directory inside the suite. CEF would
      // otherwise create ~/.cache/adrenaline/cef-<pid> and rely on its own
      // shutdown path to remove it; under the profiler that path races the
      // SIGTERM, so the benchmark owns the directory and deletes it after the
      // run (see cleanupRuntime in run.js).
      const cacheDir = path.join(suiteDir, '.cef-cache');
      return {
        command: [process.execPath, path.join(suiteDir, 'adrenaline-runner.js')],
        cwd: repoRoot,
        cacheDir,
        env: {
          ADREN_ADDON_PATH: path.join(repoRoot, '.bench-artifacts', 'adrenaline-cef.node'),
          ADREN_CEF_RESOURCES: path.join(cef, 'Resources'),
          ADREN_CEF_LOCALES: path.join(cef, 'Resources', 'locales'),
          ADREN_CEF_CACHE: cacheDir,
        },
      };
    },
  },

  electron: {
    label: 'Electron',
    footprintRuntime: 'electron',
    platforms: ['linux', 'darwin', 'win32'],
    command({ repoRoot, suiteDir }) {
      return {
        command: [electronBinary(repoRoot), path.join(suiteDir, 'electron-runner.js'), '--no-sandbox', '--disable-gpu'],
        cwd: repoRoot,
        env: {},
      };
    },
  },

  nw: {
    label: 'NW.js',
    footprintRuntime: 'nw',
    platforms: ['linux', 'darwin', 'win32'],
    command({ repoRoot, suiteDir }) {
      return {
        command: [nwBinary(repoRoot), path.join(suiteDir, 'nw-app')],
        cwd: path.join(suiteDir, 'nw-app'),
        env: {},
      };
    },
  },

  neutralino: {
    label: 'Neutralinojs',
    footprintRuntime: 'neutralino',
    platforms: ['linux', 'darwin', 'win32'],
    command({ repoRoot, suiteDir }) {
      const appDir = path.join(suiteDir, 'neu-app');
      return {
        command: [path.join(appDir, neutralinoBinaryName()), '--load-dir-res', '--path=.'],
        cwd: appDir,
        env: {},
      };
    },
  },
};

// Linux runs the full five-way showdown; other platforms run the subset that is
// actually provisionable there (CEF is linux64-only). The order groups the two
// Adrenaline engines last so the report reads identically to the Linux one.
const LINUX_ORDER = ['electron', 'nw', 'neutralino', 'adrenaline-webview', 'adrenaline-cef'];
const PORTABLE_ORDER = ['electron', 'nw', 'neutralino', 'adrenaline-webview'];

function runtimeOrder() {
  if (process.platform === 'linux') return LINUX_ORDER;
  return PORTABLE_ORDER;
}

function isAvailable(runtime) {
  const entry = RUNTIMES[runtime];
  if (!entry) return false;
  return entry.platforms.includes(process.platform);
}

function commandFor(runtime, ctx) {
  const entry = RUNTIMES[runtime];
  if (!entry) throw new Error('Unknown runtime: ' + runtime);
  const spec = entry.command(ctx);
  return { ...spec, label: entry.label, footprintRuntime: entry.footprintRuntime };
}

function footprintRuntimeFor(runtime) {
  return (RUNTIMES[runtime] || {}).footprintRuntime || runtime;
}

module.exports = {
  RUNTIMES,
  ORDER: runtimeOrder(),
  runtimeOrder,
  isAvailable,
  commandFor,
  footprintRuntimeFor,
  neutralinoBinaryName,
};
