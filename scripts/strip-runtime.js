#!/usr/bin/env node
'use strict';

/**
 * Applies the Modular Config Stripping Engine to an already-built CEF runtime
 * distribution (the folder that ships next to the native addon). Used after
 * packaging, or standalone to verify that `adrenaline.config.js` physically
 * removes unrequested assets such as `devtools_resources.pak`.
 *
 *   node scripts/strip-runtime.js [distDir]   # default: vendor/cef
 */

const fs = require('fs');
const path = require('path');
const configResolver = require('../lib/config-resolver');

const ROOT = path.resolve(__dirname, '..');
const distDir = path.resolve(ROOT, process.argv[2] || path.join('vendor', 'cef'));

if (!fs.existsSync(distDir)) {
  process.stderr.write(`[strip-runtime] distribution not found: ${distDir}\n`);
  process.exit(1);
}

/** Shared libraries and addons in the distribution worth stripping. */
function collectStrippable(distDir) {
  const targets = [];
  const releaseDir = path.join(distDir, 'Release');
  for (const name of ['libcef.so', 'libEGL.so', 'libGLESv2.so', 'libvk_swiftshader.so']) {
    const file = path.join(releaseDir, name);
    if (fs.existsSync(file)) targets.push(file);
  }
  // The native addon normally sits next to (or inside) the distribution.
  for (const candidate of [path.join(distDir, 'adrenaline.node'), path.join(distDir, '..', 'adrenaline.node')]) {
    if (fs.existsSync(candidate)) targets.push(candidate);
  }
  return targets;
}

const before = configResolver.directorySize(distDir);
const { removed, savedBytes } = configResolver.stripRuntimeAssets(distDir, ROOT);

let stripSavedBytes = 0;
const stripped = [];
for (const file of collectStrippable(distDir)) {
  const res = configResolver.stripBinary(file);
  if (res.stripped) {
    stripped.push(path.relative(distDir, file));
    stripSavedBytes += res.savedBytes;
  }
}
const after = configResolver.directorySize(distDir);

process.stdout.write(`[strip-runtime] dist: ${path.relative(ROOT, distDir) || distDir}\n`);
if (removed.length) {
  process.stdout.write(`[strip-runtime] removed: ${removed.join(', ')}\n`);
} else {
  process.stdout.write('[strip-runtime] no assets matched the current config\n');
}
if (stripped.length) {
  process.stdout.write(`[strip-runtime] debug symbols stripped from: ${stripped.join(', ')}\n`);
} else {
  process.stdout.write('[strip-runtime] no strippable binaries (or already stripped)\n');
}
process.stdout.write(
  `[strip-runtime] ${configResolver.mb(before)} MB -> ${configResolver.mb(after)} MB ` +
  `(assets ${configResolver.mb(savedBytes)} MB, symbols ${configResolver.mb(stripSavedBytes)} MB)\n`
);
