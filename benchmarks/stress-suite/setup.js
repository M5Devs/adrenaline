'use strict';

/*
 * Royal Rumble provisioning (cross-platform).
 *
 * The harness compares the desktop runtimes available on the current platform, so
 * a fresh clone needs those payloads present before `run.js` can work. This
 * script fetches the ones that are not already produced by `npm install` /
 * `npm run build`:
 *
 *   - Adrenaline.js addon(s). `npm run build` produces one engine at a time (the
 *     engine is a compile-time define), so we build the webview addon and stash
 *     it. On Linux the CEF and WebGTK addons are built too (the vendored CEF
 *     distribution is linux64-only, and WebGTK is a GTK3 view); on
 *     Windows/macOS they are skipped. The runners pick the right addon up via
 *     ADREN_ADDON_PATH.
 *   - The Neutralinojs standalone binary from GitHub releases, plus its client
 *     library, into `neu-app/`. The release zip carries every platform's binary,
 *     so the same URL works everywhere and the platform-specific binary is
 *     extracted by name.
 *
 * Electron comes from `npm install` (it is a devDependency), the pruned CEF
 * distribution (Linux) comes from `npm run setup:cef`, and the WebGTK library
 * (Linux) comes from `npm run setup:webgtk`.
 *
 * Every step is idempotent: already-present artifacts are left alone unless
 * --force is given.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { download } = require('../../scripts/lib/net');
const { extractZipMember } = require('../../scripts/lib/zip');

const SUITE_DIR = __dirname;
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ARTIFACTS = path.join(REPO_ROOT, '.bench-artifacts');
const NEU_APP = path.join(SUITE_DIR, 'neu-app');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

const NEU_VERSION = process.env.NEUTRALINO_VERSION || '6.10.0';
// The release zip bundles every platform's binary (neutralino-linux_x64,
// neutralino-win_x64.exe, neutralino-mac_x64, neutralino-mac_arm64, ...), so one
// URL serves all platforms.
const NEU_BIN_URL = `https://github.com/neutralinojs/neutralinojs/releases/download/v${NEU_VERSION}/neutralinojs-v${NEU_VERSION}.zip`;
const NEU_CLIENT_URL = `https://cdn.jsdelivr.net/npm/@neutralinojs/lib@${NEU_VERSION}/dist/neutralino.js`;

const FORCE = process.argv.includes('--force');

function log(msg) { process.stdout.write('[rumble-setup] ' + msg + '\n'); }

function exists(p) { return fs.existsSync(p); }

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: REPO_ROOT, ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${res.status}`);
  return res;
}

/** Name of the shipped Neutralinojs binary for this platform/arch. */
function neutralinoBinaryName() {
  if (IS_WIN) return 'neutralino-win_x64.exe';
  if (IS_MAC) return process.arch === 'arm64' ? 'neutralino-mac_arm64' : 'neutralino-mac_x64';
  return 'neutralino-linux_x64';
}

function buildAdrenaline(engine, dest) {
  if (exists(dest) && !FORCE) {
    log(`Adrenaline ${engine} addon already present: ${path.relative(REPO_ROOT, dest)}`);
    return;
  }
  log(`Building Adrenaline ${engine} addon...`);
  run('node', ['scripts/build.js', '--adren_engine=' + engine]);
  const built = path.join(REPO_ROOT, 'build', 'Release', 'adrenaline.node');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(built, dest);
  log(`Stashed ${engine} addon at ${path.relative(REPO_ROOT, dest)}`);
}

async function provisionNeutralino() {
  const binName = neutralinoBinaryName();
  const bin = path.join(NEU_APP, binName);
  const client = path.join(NEU_APP, 'resources', 'neutralino.js');
  fs.mkdirSync(NEU_APP, { recursive: true });
  fs.mkdirSync(path.join(NEU_APP, 'resources'), { recursive: true });

  if (!exists(bin) || FORCE) {
    log(`Downloading Neutralinojs v${NEU_VERSION} (${binName})...`);
    const zip = path.join(SUITE_DIR, 'neutralinojs.zip');
    await download(NEU_BIN_URL, zip);
    extractZipMember(zip, binName, bin);
    fs.rmSync(zip, { force: true });
    if (!IS_WIN) fs.chmodSync(bin, 0o755);
    log('Neutralinojs binary ready.');
  } else {
    log('Neutralinojs binary already present.');
  }

  if (!exists(client) || FORCE) {
    log('Downloading Neutralinojs client library...');
    await download(NEU_CLIENT_URL, client);
    log('Neutralinojs client library ready.');
  }
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });

  buildAdrenaline('webview', path.join(ARTIFACTS, 'adrenaline-webview.node'));
  // The vendored CEF distribution is linux64-only, so the CEF addon is only
  // built where it can actually run.
  if (process.platform === 'linux') {
    buildAdrenaline('cef', path.join(ARTIFACTS, 'adrenaline-cef.node'));
    // WebGTK is a GTK3 view; only build it once its library has been provisioned
    // by `npm run setup:webgtk` (otherwise build.js falls back to webview).
    const webgtkLib = path.join(REPO_ROOT, 'vendor', 'webgtk', 'lib', 'libwebgtk.so');
    if (exists(webgtkLib)) {
      buildAdrenaline('webgtk', path.join(ARTIFACTS, 'adrenaline-webgtk.node'));
    } else {
      log('libwebgtk.so not found; skipping the WebGTK addon (run `npm run setup:webgtk`).');
    }
  }

  await provisionNeutralino();

  // Restore the default build output to the webview engine so the repository is
  // left in the state a normal `npm run build` would produce.
  const built = path.join(REPO_ROOT, 'build', 'Release', 'adrenaline.node');
  const webview = path.join(ARTIFACTS, 'adrenaline-webview.node');
  if (exists(webview)) {
    fs.mkdirSync(path.dirname(built), { recursive: true });
    fs.copyFileSync(webview, built);
  }

  log('All runtimes provisioned. Run: node benchmarks/stress-suite/run.js');
}

main().catch((err) => {
  process.stderr.write('[rumble-setup] ERROR: ' + (err.stack || err.message) + '\n');
  process.exit(1);
});
