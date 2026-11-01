#!/usr/bin/env node
'use strict';

/**
 * Automated CEF Minimal Resolver & Surgical Gastric Sleeve
 *
 * 1. Resolves the newest official *stable* linux64 *minimal* CEF build from
 *    Spotify's CDN index (https://cef-builds.spotifycdn.com/index.json).
 * 2. Downloads + extracts it into `vendor/cef/`.
 * 3. Physically prunes bloat: redundant locales, tests, and build intermediates.
 * 4. Compiles `libcef_dll_wrapper.a` and keeps only the archive.
 * 5. Applies the Modular Config Stripping Engine (`adrenaline.config.js`) so
 *    unrequested assets (devtools/pdf) are deleted from the distribution.
 *
 * Every step is idempotent: re-running reuses the cached tarball / wrapper.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const configResolver = require('../lib/config-resolver');

const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor');
const CEF_ROOT = path.join(VENDOR, 'cef');
const TARBALL = path.join(VENDOR, 'cef_minimal.tar.bz2');
const BUILD_DIR = path.join(CEF_ROOT, 'build');
const WRAPPER_SRC = path.join(BUILD_DIR, 'libcef_dll_wrapper', 'libcef_dll_wrapper.a');
const WRAPPER_DEST_DIR = path.join(CEF_ROOT, 'libcef_dll_wrapper');
const WRAPPER_DEST = path.join(WRAPPER_DEST_DIR, 'libcef_dll_wrapper.a');

const INDEX_URL = 'https://cef-builds.spotifycdn.com/index.json';
const CDN_BASE = 'https://cef-builds.spotifycdn.com/';

// Locale paks that are always retained. `en-US.pak` is the base dictionary; the
// `en-US_*` gendered variants must ship alongside it or Chromium aborts on
// gendered-string lookups.
const LOCALE_KEEP = /^en-US(_[A-Z]+)?\.pak$/;

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);
const SKIP_DOWNLOAD = hasFlag('--skip-download');
const SKIP_BUILD = hasFlag('--skip-build');
const SKIP_STRIP = hasFlag('--skip-strip');

function log(msg) {
  process.stdout.write(`[setup-cef] ${msg}\n`);
}

function mb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: opts.cwd || ROOT, ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with code ${res.status}`);
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(fetchJson(res.headers.location));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`GET ${url} -> HTTP ${res.statusCode}`));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.part';
    const file = fs.createWriteStream(tmp);
    const fail = (err) => {
      file.close(() => {
        try { fs.rmSync(tmp, { force: true }); } catch (e) { /* ignore */ }
        reject(err);
      });
    };
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          file.close(() => {
            try { fs.rmSync(tmp, { force: true }); } catch (e) { /* ignore */ }
            resolve(download(res.headers.location, dest));
          });
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          return fail(new Error(`GET ${url} -> HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => fs.renameSync(tmp, dest)));
        file.on('error', fail);
      })
      .on('error', fail);
  });
}

/** Newest stable version, ranked by the freshest file modification timestamp. */
function selectLatestStableMinimal(index) {
  const versions = index && index.linux64 && index.linux64.versions;
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error('index.json did not contain linux64.versions');
  }

  const stable = versions.filter((v) => v.channel === 'stable');
  if (stable.length === 0) throw new Error('no stable linux64 CEF versions found');

  const ranked = stable
    .map((v) => ({
      version: v,
      ts: Math.max(0, ...v.files.map((f) => Date.parse(f.last_modified || 0) || 0))
    }))
    .sort((a, b) => b.ts - a.ts);

  for (const entry of ranked) {
    const file = entry.version.files.find((f) => f.type === 'minimal');
    if (file) {
      return { version: entry.version, file, ts: entry.ts };
    }
  }
  throw new Error('no minimal distribution found for any stable linux64 version');
}

function pruneLocales(cefRoot) {
  const localesDir = path.join(cefRoot, 'Resources', 'locales');
  if (!fs.existsSync(localesDir)) {
    return { removed: 0, savedBytes: 0, kept: [] };
  }

  const kept = [];
  let removed = 0;
  let savedBytes = 0;
  for (const name of fs.readdirSync(localesDir)) {
    const full = path.join(localesDir, name);
    if (!fs.statSync(full).isFile()) continue;
    if (LOCALE_KEEP.test(name)) {
      kept.push(name);
      continue;
    }
    savedBytes += fs.statSync(full).size;
    fs.rmSync(full, { force: true });
    removed += 1;
  }
  return { removed, savedBytes, kept };
}

function removeTests(cefRoot) {
  const testsDir = path.join(cefRoot, 'tests');
  if (!fs.existsSync(testsDir)) return { removed: false, savedBytes: 0 };
  const savedBytes = configResolver.directorySize(testsDir);
  fs.rmSync(testsDir, { recursive: true, force: true });
  return { removed: true, savedBytes };
}

/**
 * CEF resolves `icudtl.dat` relative to `libcef.so` (module dir), not the
 * executable, and neither `resources_dir_path` nor `--icu-data-file` overrides
 * it. Move it next to libcef.so so the runtime finds it. The remaining `.pak`
 * bundles stay in `Resources/` and are located via `resources_dir_path`.
 */
function relocateIcuData(cefRoot) {
  const releaseDir = path.join(cefRoot, 'Release');
  const src = path.join(cefRoot, 'Resources', 'icudtl.dat');
  const dest = path.join(releaseDir, 'icudtl.dat');
  if (!fs.existsSync(src) || fs.existsSync(dest)) {
    return { moved: false };
  }
  if (!fs.existsSync(releaseDir)) {
    return { moved: false };
  }
  fs.renameSync(src, dest);
  return { moved: true };
}

function ensureWrapper() {
  if (fs.existsSync(WRAPPER_DEST)) {
    log(`Reusing existing ${path.relative(ROOT, WRAPPER_DEST)}`);
    return;
  }

  log('Configuring CMake build (Release)...');
  run('cmake', ['-B', 'build', '-DCMAKE_BUILD_TYPE=Release'], { cwd: CEF_ROOT });
  log('Compiling libcef_dll_wrapper...');
  run('cmake', ['--build', 'build', '--target', 'libcef_dll_wrapper', '-j', String(os.cpus().length)], {
    cwd: CEF_ROOT
  });

  if (!fs.existsSync(WRAPPER_SRC)) {
    throw new Error(`expected ${WRAPPER_SRC} after build`);
  }
  fs.mkdirSync(WRAPPER_DEST_DIR, { recursive: true });
  fs.copyFileSync(WRAPPER_SRC, WRAPPER_DEST);
  log(`Published ${path.relative(ROOT, WRAPPER_DEST)}`);
}

/** Delete object files and the CMake cache, retaining only the wrapper archive. */
function pruneBuildIntermediates(cefRoot) {
  if (!fs.existsSync(BUILD_DIR)) return { savedBytes: 0 };
  const savedBytes = configResolver.directorySize(BUILD_DIR);
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  return { savedBytes };
}

/**
 * Strip debug symbols from the shipped CEF shared libraries.
 *
 * The official linux64 CEF binaries are built with full DWARF debug info:
 * libcef.so alone carries ~1 GB of `.debug_*` / `.symtab` sections that no
 * end-user application ever reads. Stripping them (keeping the dynamic symbol
 * table, which the dynamic linker needs) shrinks the shipped payload by more
 * than half without changing runtime behaviour. Idempotent: already-stripped
 * files report 0 bytes reclaimed.
 */
function stripDebugSymbols(cefRoot) {
  const releaseDir = path.join(cefRoot, 'Release');
  const libs = ['libcef.so', 'libEGL.so', 'libGLESv2.so', 'libvk_swiftshader.so'];
  const stripped = [];
  let savedBytes = 0;
  for (const name of libs) {
    const file = path.join(releaseDir, name);
    if (!fs.existsSync(file)) continue;
    const before = fs.statSync(file).size;
    const res = spawnSync('strip', ['--strip-debug', file], { stdio: 'ignore' });
    if (res.error || res.status !== 0) continue;
    const after = fs.statSync(file).size;
    if (after < before) {
      stripped.push(name);
      savedBytes += before - after;
    }
  }
  return { stripped, savedBytes };
}

function writeManifest(cefRoot, manifest) {
  fs.writeFileSync(path.join(cefRoot, 'cef-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

async function main() {
  fs.mkdirSync(VENDOR, { recursive: true });

  const resolved = configResolver.resolve(ROOT);
  log(`Engine: ${resolved.engine} | modules: ${JSON.stringify(resolved.modules)}`);

  // 1. Resolve + download -----------------------------------------------------
  let selection = null;
  if (!SKIP_DOWNLOAD) {
    log(`Fetching CEF index: ${INDEX_URL}`);
    const index = await fetchJson(INDEX_URL);
    selection = selectLatestStableMinimal(index);
    const { version, file } = selection;
    log(`Selected stable CEF ${version.cef_version} (chromium ${version.chromium_version})`);
    log(`Minimal file: ${file.name} (${mb(file.size)} MB)`);

    if (fs.existsSync(TARBALL) && fs.statSync(TARBALL).size === file.size) {
      log('Cached tarball already present and complete; skipping download.');
    } else {
      log(`Downloading ${CDN_BASE + file.name}`);
      await download(CDN_BASE + file.name, TARBALL);
      log(`Downloaded ${mb(fs.statSync(TARBALL).size)} MB`);
    }
  } else {
    log('--skip-download: assuming tarball/cef tree already present.');
  }

  // 2. Extract ----------------------------------------------------------------
  const freshExtract = !fs.existsSync(path.join(CEF_ROOT, 'Release', 'libcef.so'));
  if (freshExtract) {
    if (!fs.existsSync(TARBALL)) {
      throw new Error(`tarball missing at ${TARBALL}; run without --skip-download`);
    }
    log(`Extracting into ${path.relative(ROOT, CEF_ROOT)}/ ...`);
    fs.mkdirSync(CEF_ROOT, { recursive: true });
    run('tar', ['-xjf', TARBALL, '--strip-components=1', '-C', CEF_ROOT], { cwd: VENDOR });
  } else {
    log('CEF tree already extracted; skipping extraction.');
  }

  const sizeBefore = configResolver.directorySize(CEF_ROOT);
  log(`vendor/cef size before pruning: ${mb(sizeBefore)} MB`);

  // 3. Surgical gastric sleeve ------------------------------------------------
  const locales = pruneLocales(CEF_ROOT);
  log(`Locales stripped: removed ${locales.removed} .pak files, kept [${locales.kept.join(', ')}] ` +
      `(${mb(locales.savedBytes)} MB)`);

  const tests = removeTests(CEF_ROOT);
  if (tests.removed) {
    log(`Removed vendor/cef/tests/ (${mb(tests.savedBytes)} MB)`);
  } else {
    log('No vendor/cef/tests/ directory present (minimal distribution).');
  }

  const icu = relocateIcuData(CEF_ROOT);
  if (icu.moved) {
    log('Relocated icudtl.dat next to libcef.so (CEF resolves it from the module dir).');
  }

  // 4. Build wrapper + prune intermediates ------------------------------------
  let intermediates = { savedBytes: 0 };
  if (!SKIP_BUILD) {
    ensureWrapper();
    intermediates = pruneBuildIntermediates(CEF_ROOT);
    log(`Build intermediates pruned, keeping libcef_dll_wrapper.a (${mb(intermediates.savedBytes)} MB reclaimed)`);
  } else {
    log('--skip-build: leaving CMake build tree untouched.');
  }

  // 5. Modular Config Stripping Engine ----------------------------------------
  let strip = { removed: [], savedBytes: 0 };
  if (!SKIP_STRIP) {
    strip = configResolver.applyAssetStripping(CEF_ROOT, ROOT);
    if (strip.removed.length) {
      log(`Config stripping removed: ${strip.removed.join(', ')} (${mb(strip.savedBytes)} MB)`);
    } else {
      log('Config stripping: no removable assets matched the current config.');
    }

    const debugStrip = stripDebugSymbols(CEF_ROOT);
    if (debugStrip.stripped.length) {
      log(`Debug symbols stripped from: ${debugStrip.stripped.join(', ')} (${mb(debugStrip.savedBytes)} MB)`);
    } else {
      log('Debug symbol stripping: nothing to strip (already stripped).');
    }
    strip.debugSymbols = debugStrip;
  } else {
    log('--skip-strip: leaving distribution assets untouched.');
  }

  const sizeAfter = configResolver.directorySize(CEF_ROOT);
  const saved = sizeBefore - sizeAfter;
  log('------------------------------------------------------------');
  log(`vendor/cef size before pruning: ${mb(sizeBefore)} MB`);
  log(`vendor/cef size after pruning:  ${mb(sizeAfter)} MB`);
  log(`Total reclaimed:                ${mb(saved)} MB`);
  log('------------------------------------------------------------');

  if (selection) {
    writeManifest(CEF_ROOT, {
      cefVersion: selection.version.cef_version,
      chromiumVersion: selection.version.chromium_version,
      channel: selection.version.channel,
      minimalFile: selection.file.name,
      sizeBeforePruning: sizeBefore,
      sizeAfterPruning: sizeAfter,
      bytesReclaimed: saved,
      localesRemoved: locales.removed,
      localesKept: locales.kept,
      testsRemoved: tests.removed,
      strippedAssets: strip.removed,
      debugSymbolsStripped: strip.debugSymbols ? strip.debugSymbols.stripped : [],
      modules: resolved.modules,
      generatedAt: new Date().toISOString()
    });
  }

  log('setup-cef complete.');
}

module.exports = {
  selectLatestStableMinimal,
  pruneLocales,
  removeTests,
  stripDebugSymbols,
  LOCALE_KEEP,
  INDEX_URL,
  CDN_BASE
};

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[setup-cef] ERROR: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
