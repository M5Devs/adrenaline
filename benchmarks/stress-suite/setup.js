'use strict';

/*
 * Royal Rumble provisioning.
 *
 * The harness compares five runtimes, so a fresh clone needs all five payloads
 * present before `run.js` can work. This script fetches the ones that are not
 * already produced by `npm install` / `npm run build`:
 *
 *   - Adrenaline.js addons for BOTH engines. `npm run build` produces one engine
 *     at a time (the engine is a compile-time define), so we build the webview
 *     addon, stash it, then build the CEF addon and stash it. The runners pick
 *     the right one up via ADREN_ADDON_PATH.
 *   - The Neutralinojs standalone binary from GitHub releases, plus its client
 *     library, into `neu-app/`.
 *
 * NW.js and Electron come from `npm install` (they are devDependencies), and the
 * pruned CEF distribution comes from `npm run setup:cef`.
 *
 * Every step is idempotent: already-present artifacts are left alone unless
 * --force is given.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const SUITE_DIR = __dirname;
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ARTIFACTS = path.join(REPO_ROOT, '.bench-artifacts');
const NEU_APP = path.join(SUITE_DIR, 'neu-app');

const NEU_VERSION = process.env.NEUTRALINO_VERSION || '6.10.0';
const NEU_BIN_URL = `https://github.com/neutralinojs/neutralinojs/releases/download/v${NEU_VERSION}/neutralinojs-linux_x64.zip`;
const NEU_CLIENT_URL = `https://raw.githubusercontent.com/neutralinojs/neutralino.js/v6.10.0/dist/neutralino.js`;

const FORCE = process.argv.includes('--force');

function log(msg) { process.stdout.write('[rumble-setup] ' + msg + '\n'); }

function exists(p) { return fs.existsSync(p); }

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: REPO_ROOT, ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${res.status}`);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'adrenaline-rumble-setup' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`GET ${url} -> ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
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
  const bin = path.join(NEU_APP, 'neutralino-linux_x64');
  const client = path.join(NEU_APP, 'resources', 'neutralino.js');
  fs.mkdirSync(NEU_APP, { recursive: true });

  if (!exists(bin) || FORCE) {
    log(`Downloading Neutralinojs v${NEU_VERSION} binary...`);
    const zip = path.join(SUITE_DIR, 'neutralinojs.zip');
    await download(NEU_BIN_URL, zip);
    run('unzip', ['-o', zip, 'neutralino-linux_x64', '-d', NEU_APP]);
    fs.rmSync(zip, { force: true });
    fs.chmodSync(bin, 0o755);
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
  buildAdrenaline('cef', path.join(ARTIFACTS, 'adrenaline-cef.node'));

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
