'use strict';

/*
 * Runtime registry — the single place that knows how to launch each of the
 * five competing desktop runtimes. `run.js` and the standalone profiler both
 * resolve their launch command from here so there is exactly one definition of
 * "how does this runtime start".
 *
 * Each entry returns:
 *   command : [binary, ...args] passed verbatim to spawn()
 *   cwd     : working directory for the process
 *   env     : extra environment for the process
 *   footprintRuntime : which footprint layout measureFootprint() should use
 *   label   : human-readable name for the report
 */

const fs = require('fs');
const path = require('path');

function electronBinary(repoRoot) {
  const pkg = path.join(repoRoot, 'node_modules', 'electron');
  const rel = fs.readFileSync(path.join(pkg, 'path.txt'), 'utf8').trim();
  return path.join(pkg, 'dist', rel);
}

function nwBinary(repoRoot) {
  const base = path.join(repoRoot, 'node_modules', 'nw');
  const dir = fs.readdirSync(base).find((n) => n.startsWith('nwjs-'));
  return path.join(base, dir, 'nw');
}

const RUNTIMES = {
  'adrenaline-webview': {
    label: 'Adrenaline.js (WebView)',
    footprintRuntime: 'adrenaline-webview',
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
    command({ repoRoot, suiteDir }) {
      const appDir = path.join(suiteDir, 'neu-app');
      return {
        command: [path.join(appDir, 'neutralino-linux_x64'), '--load-dir-res', '--path=.'],
        cwd: appDir,
        env: {},
      };
    },
  },
};

const ORDER = ['electron', 'nw', 'neutralino', 'adrenaline-webview', 'adrenaline-cef'];

function commandFor(runtime, ctx) {
  const entry = RUNTIMES[runtime];
  if (!entry) throw new Error('Unknown runtime: ' + runtime);
  const spec = entry.command(ctx);
  return { ...spec, label: entry.label, footprintRuntime: entry.footprintRuntime };
}

function footprintRuntimeFor(runtime) {
  return (RUNTIMES[runtime] || {}).footprintRuntime || runtime;
}

module.exports = { RUNTIMES, ORDER, commandFor, footprintRuntimeFor };
