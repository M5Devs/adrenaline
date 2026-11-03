#!/usr/bin/env node
'use strict';

/**
 * Engine-aware build wrapper.
 *
 * `node-gyp` runs its own argument parser (nopt) which silently drops unknown
 * `-D`/`--flag` style arguments before gyp ever sees them, so
 * `npm run build -- --adren_engine=cef` cannot be forwarded verbatim. This
 * wrapper translates those flags into `ADREN_ENGINE`, which binding.gyp reads,
 * and then invokes node-gyp with a clean argument list.
 *
 * Engine selection precedence:
 *   1. `--adren_engine=cef` / `--engine cef`   (explicit command line)
 *   2. `ADREN_ENGINE=cef`                       (explicit environment)
 *   3. `engine` in `adrenaline.config.js`       (project configuration)
 *   4. `webview`                                (default)
 *
 *   npm run build                          # config-driven (webview by default)
 *   npm run build -- --adren_engine=cef    # CEF, overriding the config
 *   ADREN_ENGINE=cef npm run build         # CEF via environment
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CEF_LIB = path.join(ROOT, 'vendor', 'cef', 'Release', 'libcef.so');
// libwebgtk.so is built from the sister project (github.com/M5Devs/webgtk).
// Vendored here by `scripts/setup-webgtk.js`; WEBGTK_ROOT overrides the root.
const WEBGTK_ROOT = path.resolve(process.env.WEBGTK_ROOT || path.join(ROOT, 'vendor', 'webgtk'));
const WEBGTK_LIB = path.join(process.env.WEBGTK_LIB_DIR || path.join(WEBGTK_ROOT, 'lib'), 'libwebgtk.so');

const argv = process.argv.slice(2);

function readFlag(name) {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = argv.indexOf(`--${name}`);
  if (idx !== -1 && argv[idx + 1] && !argv[idx + 1].startsWith('-')) return argv[idx + 1];
  return null;
}

/**
 * Resolve the engine to build and where the choice came from, without touching
 * the filesystem. The config is consulted only when no explicit override exists.
 */
function resolveEngine() {
  const flag = readFlag('adren_engine') || readFlag('engine');
  if (flag) return { engine: String(flag).toLowerCase(), source: 'command line' };
  if (process.env.ADREN_ENGINE) {
    return { engine: String(process.env.ADREN_ENGINE).toLowerCase(), source: 'ADREN_ENGINE' };
  }
  const resolved = require('../lib/config-resolver').resolve(ROOT);
  return { engine: resolved.engine, source: 'adrenaline.config.js' };
}

/**
 * Apply the engine-availability guard: the CEF vendor tree and the WebGTK
 * library are gitignored, so a fresh checkout / CI has neither. Rather than fail
 * the build, fall back to the always-available webview engine.
 */
function selectEngine(engine, cefAvailable, webgtkAvailable) {
  if (engine === 'cef' && !cefAvailable) {
    return { selected: 'webview', fellBack: true };
  }
  if (engine === 'webgtk' && !webgtkAvailable) {
    return { selected: 'webview', fellBack: true };
  }
  return { selected: engine, fellBack: false };
}

/**
 * The webview engine compiles against Microsoft's WebView2 SDK header on
 * Windows. It is fetched (not vendored) because the SDK is not redistributable,
 * so make sure it is present before node-gyp runs. A no-op on other platforms.
 */
function ensureWebView2Sdk(engine) {
  if (engine !== 'webview' || process.platform !== 'win32') return;
  const header = path.join(ROOT, 'src', 'vendor', 'WebView2.h');
  if (fs.existsSync(header)) return;
  process.stdout.write('[build] fetching WebView2 SDK header...\n');
  const res = spawnSync(process.execPath, [path.join(__dirname, 'fetch-webview2.js')], { stdio: 'inherit' });
  if (res.status !== 0) {
    process.stderr.write('[build] warning: could not fetch WebView2.h; the webview engine build will fail.\n');
  }
}

function main() {
  const { engine, source } = resolveEngine();
  const { selected, fellBack } = selectEngine(engine, fs.existsSync(CEF_LIB), fs.existsSync(WEBGTK_LIB));

  if (fellBack) {
    const missing = engine === 'webgtk'
      ? `libwebgtk.so is missing (looked in ${path.relative(ROOT, path.dirname(WEBGTK_LIB))})`
      : `${path.relative(ROOT, CEF_LIB)} is missing`;
    process.stderr.write(
      `[build] engine "${engine}" requested by ${source} but ${missing};\n` +
      `[build] falling back to webview. Run \`npm run setup:${engine === 'webgtk' ? 'webgtk' : 'cef'}\` first to build against ${engine}.\n`
    );
  } else {
    process.stdout.write(`[build] engine: ${selected} (from ${source})\n`);
  }

  process.env.ADREN_ENGINE = selected;

  ensureWebView2Sdk(selected);

  const passthrough = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--adren_engine') || a.startsWith('--engine')) {
      if (!a.includes('=')) i++; // skip the separate value token
      continue;
    }
    passthrough.push(a);
  }

  const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js');
  const res = spawnSync(process.execPath, [nodeGyp, 'rebuild', ...passthrough], {
    stdio: 'inherit',
    env: process.env
  });

  process.exit(res.status === null ? 1 : res.status);
}

module.exports = { resolveEngine, selectEngine, readFlag, CEF_LIB, WEBGTK_LIB, WEBGTK_ROOT };

if (require.main === module) {
  main();
}
