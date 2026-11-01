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

const before = configResolver.directorySize(distDir);
const { removed, savedBytes } = configResolver.stripRuntimeAssets(distDir, ROOT);
const after = configResolver.directorySize(distDir);

process.stdout.write(`[strip-runtime] dist: ${path.relative(ROOT, distDir) || distDir}\n`);
if (removed.length) {
  process.stdout.write(`[strip-runtime] removed: ${removed.join(', ')}\n`);
} else {
  process.stdout.write('[strip-runtime] no assets matched the current config\n');
}
process.stdout.write(
  `[strip-runtime] ${configResolver.mb(before)} MB -> ${configResolver.mb(after)} MB ` +
  `(reclaimed ${configResolver.mb(savedBytes)} MB)\n`
);
