#!/usr/bin/env node
'use strict';

/*
 * Fetch the Microsoft WebView2 SDK header (WebView2.h).
 *
 * `src/vendor/webview.h` includes "WebView2.h" on Windows, but Microsoft's SDK
 * header is not redistributable inside this repository, so it is fetched on
 * demand instead of committed. The header is only needed to *compile* the
 * webview engine on Windows; the runtime (the Evergreen WebView2 runtime) is
 * already present on Windows 10/11 and on the GitHub `windows-latest` image.
 *
 * The official distribution is the `Microsoft.Web.WebView2` NuGet package. We
 * download the package (a zip) and extract just `build/native/include/WebView2.h`
 * to `src/vendor/WebView2.h`.
 *
 *   node scripts/fetch-webview2.js            # fetch if missing
 *   node scripts/fetch-webview2.js --force    # always re-fetch
 */

const fs = require('fs');
const path = require('path');
const { download } = require('./lib/net');
const { extractZipMember } = require('./lib/zip');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'src', 'vendor', 'WebView2.h');
const TMP = path.join(ROOT, 'src', 'vendor', 'WebView2.sdk.zip');

// Pinned SDK version. Bump deliberately: newer SDKs add interfaces, and the
// header must stay compatible with the WebView2 runtime shipped by Windows.
const SDK_VERSION = process.env.WEBVIEW2_SDK_VERSION || '1.0.2903.40';
const SDK_URL = `https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/${SDK_VERSION}`;

async function main() {
  const force = process.argv.includes('--force');
  if (fs.existsSync(DEST) && !force) {
    process.stdout.write(`[webview2] header already present: ${path.relative(ROOT, DEST)}\n`);
    return;
  }
  process.stdout.write(`[webview2] downloading SDK ${SDK_VERSION}...\n`);
  await download(SDK_URL, TMP);
  try {
    extractZipMember(TMP, 'build/native/include/WebView2.h', DEST);
  } finally {
    fs.rmSync(TMP, { force: true });
  }
  process.stdout.write(`[webview2] wrote ${path.relative(ROOT, DEST)}\n`);
}

main().catch((e) => {
  process.stderr.write('[webview2] ERROR: ' + (e.stack || e.message) + '\n');
  process.exit(1);
});
