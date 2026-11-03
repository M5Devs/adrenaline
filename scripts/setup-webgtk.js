#!/usr/bin/env node
'use strict';

/**
 * WebGTK engine setup.
 *
 * The `webgtk` engine links the sister project (github.com/M5Devs/webgtk),
 * which is not vendored. This script clones it at a pinned revision, builds
 * `libwebgtk.so` (GTK3) and installs the shared library plus its public
 * headers into `vendor/webgtk/`, which binding.gyp links against.
 *
 * The Blink/V8 backend additionally needs a Chromium engine archive. Point
 * `WEBGTK_ENGINE_DIR` at one (or drop it in the WebGTK checkout's
 * `engine/prebuilt/`) to build the real engine; otherwise the mock backend is
 * built, which is enough to exercise the Adrenaline wiring but cannot run
 * page JavaScript.
 *
 * Every step is idempotent: re-running reuses the clone and the build tree.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor');
const WEBGTK_ROOT = path.join(VENDOR, 'webgtk');
const SRC = path.join(VENDOR, 'webgtk-src');
const BUILD = path.join(SRC, 'build');

const REPO = process.env.WEBGTK_REPO || 'https://github.com/M5Devs/webgtk.git';
const REV = process.env.WEBGTK_REV || 'main';

const argv = process.argv.slice(2);
const SKIP_CLONE = argv.includes('--skip-clone');
const SKIP_BUILD = argv.includes('--skip-build');

function log(msg) {
  process.stdout.write(`[setup-webgtk] ${msg}\n`);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: opts.cwd || ROOT, ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with ${res.status}`);
  }
}

function has(cmd) {
  return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
}

// Mirrors WebGTK's own CMake precedence: an explicit source tree wins, then a
// prebuilt archive, then the JavaScript-less mock backend.
function resolveEngineMode({ engineDir, prebuiltManifest }) {
  if (engineDir) return 'source';
  if (prebuiltManifest && fs.existsSync(prebuiltManifest)) return 'prebuilt';
  return 'mock';
}

function cloneOrUpdate() {
  if (fs.existsSync(path.join(SRC, '.git'))) {
    log(`reusing clone at ${path.relative(ROOT, SRC)}`);
    run('git', ['fetch', '--depth', '1', 'origin', REV], { cwd: SRC });
    run('git', ['checkout', 'FETCH_HEAD'], { cwd: SRC });
    return;
  }
  log(`cloning ${REPO} @ ${REV}`);
  run('git', ['clone', '--depth', '1', '--branch', REV, REPO, SRC]);
}

function buildLibrary() {
  const engineDir = process.env.WEBGTK_ENGINE_DIR || '';
  const prebuiltManifest = path.join(SRC, 'engine', 'prebuilt', 'manifest.env');
  const mode = resolveEngineMode({ engineDir, prebuiltManifest });
  const args = [
    '-S', SRC,
    '-B', BUILD,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DGTK_VERSION=3',
    '-DWEBGTK_BUILD_TESTS=OFF',
    '-DWEBGTK_BUILD_DEMOS=OFF',
    '-DWEBGTK_ENABLE_SANITIZERS=OFF'
  ];
  if (mode === 'source') {
    args.push(`-DWEBGTK_ENGINE_DIR=${path.resolve(engineDir)}`);
  } else if (mode === 'prebuilt') {
    args.push('-DWEBGTK_USE_PREBUILT_ENGINE=ON');
  } else {
    log('no WEBGTK_ENGINE_DIR and no engine/prebuilt; building the mock backend');
  }

  log('configuring + building libwebgtk.so');
  run('cmake', args);
  run('cmake', ['--build', BUILD, '--target', 'webgtk', '-j', String(require('os').cpus().length)]);
}

function install() {
  const candidates = [
    path.join(BUILD, 'libwebgtk.so'),
    path.join(BUILD, 'webgtk', 'libwebgtk.so'),
    path.join(BUILD, 'src', 'libwebgtk.so')
  ];
  const lib = candidates.find((p) => fs.existsSync(p));
  if (!lib) {
    throw new Error(`libwebgtk.so not found under ${path.relative(ROOT, BUILD)}`);
  }

  const libDir = path.join(WEBGTK_ROOT, 'lib');
  const incDir = path.join(WEBGTK_ROOT, 'include');
  fs.mkdirSync(libDir, { recursive: true });
  fs.rmSync(incDir, { recursive: true, force: true });
  fs.mkdirSync(incDir, { recursive: true });

  fs.copyFileSync(lib, path.join(libDir, 'libwebgtk.so'));
  fs.cpSync(path.join(SRC, 'include'), incDir, { recursive: true });

  log(`installed libwebgtk.so + headers into ${path.relative(ROOT, WEBGTK_ROOT)}`);
}

function main() {
  if (process.platform !== 'linux') {
    throw new Error('the WebGTK engine is Linux/GTK only');
  }
  if (!has('cmake')) {
    throw new Error('cmake is required (apt install cmake)');
  }
  if (!has('pkg-config') || spawnSync('pkg-config', ['--exists', 'gtk+-3.0']).status !== 0) {
    throw new Error('GTK3 development files are required (apt install libgtk-3-dev)');
  }

  fs.mkdirSync(VENDOR, { recursive: true });
  if (!SKIP_CLONE) cloneOrUpdate();
  if (!SKIP_BUILD) buildLibrary();
  install();

  log('setup-webgtk complete. Rebuild Adrenaline with `ADREN_ENGINE=webgtk npm run build`.');
}

module.exports = { REPO, REV, WEBGTK_ROOT, SRC, BUILD, resolveEngineMode };

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`[setup-webgtk] ERROR: ${err.stack || err.message}\n`);
    process.exit(1);
  }
}
