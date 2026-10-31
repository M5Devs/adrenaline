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
 * Apply the CEF-availability guard: the vendor tree is gitignored, so a fresh
 * checkout / CI has none. Rather than fail the build, fall back to the
 * always-available webview engine.
 */
function selectEngine(engine, cefAvailable) {
  if (engine === 'cef' && !cefAvailable) {
    return { selected: 'webview', fellBack: true };
  }
  return { selected: engine, fellBack: false };
}

function main() {
  const { engine, source } = resolveEngine();
  const { selected, fellBack } = selectEngine(engine, fs.existsSync(CEF_LIB));

  if (fellBack) {
    process.stderr.write(
      `[build] engine "cef" requested by ${source} but ${path.relative(ROOT, CEF_LIB)} is missing;\n` +
      '[build] falling back to webview. Run `npm run setup:cef` first to build against CEF.\n'
    );
  } else {
    process.stdout.write(`[build] engine: ${selected} (from ${source})\n`);
  }

  process.env.ADREN_ENGINE = selected;

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

module.exports = { resolveEngine, selectEngine, readFlag, CEF_LIB };

if (require.main === module) {
  main();
}
