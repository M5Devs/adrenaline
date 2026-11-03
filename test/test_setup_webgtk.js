const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const setupWebgtk = require('../scripts/setup-webgtk');

console.log('Testing scripts/setup-webgtk.js engine-mode resolver...');

// 1. An explicit source tree always wins.
assert.strictEqual(
  setupWebgtk.resolveEngineMode({ engineDir: '/tmp/chromium', prebuiltManifest: '/nope/manifest.env' }),
  'source'
);

// 2. A prebuilt archive is used when present.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webgtk-prebuilt-'));
const manifest = path.join(dir, 'manifest.env');
fs.writeFileSync(manifest, 'WEBGTK_ENGINE_ARCHIVE=webgtk-engine.tar.gz\n');
assert.strictEqual(setupWebgtk.resolveEngineMode({ engineDir: '', prebuiltManifest: manifest }), 'prebuilt');

// 3. Neither present degrades to the mock backend.
fs.rmSync(manifest);
assert.strictEqual(setupWebgtk.resolveEngineMode({ engineDir: '', prebuiltManifest: manifest }), 'mock');
fs.rmSync(dir, { recursive: true, force: true });

// 4. The pinned repository points at the sister project.
assert.ok(/github\.com\/M5Devs\/webgtk/.test(setupWebgtk.REPO), 'REPO should be the M5Devs/webgtk project');

console.log('test_setup_webgtk.js passed successfully!');
