const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const resolver = require('../lib/config-resolver');

console.log('Testing Modular Config Stripping Engine (lib/config-resolver.js)...');

const ROOT = path.resolve(__dirname, '..');

// 1. Reads the project root adrenaline.config.js
const resolved = resolver.resolve(ROOT);
assert.strictEqual(resolved.engine, 'cef', 'project config should select the cef engine');
assert.strictEqual(typeof resolved.configFile, 'string', 'configFile should be reported');
assert.ok(resolved.configFile.endsWith('adrenaline.config.js'), 'configFile should point at adrenaline.config.js');

// 2. gypDefines is a space-separated list of ADREN_FEATURE_* defines
const defines = resolver.gypDefines(ROOT);
for (const key of ['ADREN_FEATURE_WEBRTC', 'ADREN_FEATURE_CLEAN_PRIVACY', 'ADREN_FEATURE_PDF', 'ADREN_FEATURE_DEVTOOLS']) {
  assert.ok(defines.includes(`${key}=`), `gypDefines must include ${key}`);
}

// 3. Defaults apply when no config file is present
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adren-cfg-'));
const defaults = resolver.resolve(tmp);
assert.strictEqual(defaults.engine, 'webview', 'default engine should be webview');
assert.strictEqual(defaults.modules.devtools, true, 'devtools default should be true');
assert.strictEqual(defaults.modules.webrtc, true, 'webrtc default should be true');
assert.strictEqual(defaults.modules.cleanPrivacy, false, 'cleanPrivacy default should be false');
assert.strictEqual(defaults.configFile, null, 'no config file should be reported for an empty dir');

// 4. Physical asset elimination honours the config
const fakeCef = path.join(tmp, 'cef');
fs.mkdirSync(path.join(fakeCef, 'Resources', 'locales'), { recursive: true });
fs.mkdirSync(path.join(fakeCef, 'Resources', 'devtools'), { recursive: true });
fs.writeFileSync(path.join(fakeCef, 'devtools_resources.pak'), Buffer.alloc(1024));
fs.writeFileSync(path.join(fakeCef, 'Resources', 'devtools_resources.pak'), Buffer.alloc(2048));
fs.writeFileSync(path.join(fakeCef, 'Resources', 'devtools', 'inspector.js'), Buffer.alloc(512));
fs.writeFileSync(path.join(fakeCef, 'Resources', 'pdf_resources.pak'), Buffer.alloc(256));
fs.writeFileSync(path.join(fakeCef, 'Resources', 'locales', 'en-US.pak'), Buffer.alloc(64));

fs.writeFileSync(
  path.join(tmp, 'adrenaline.config.js'),
  "module.exports = { engine: 'cef', modules: { devtools: false, pdf: false } };\n"
);

const before = resolver.directorySize(fakeCef);
const { removed, savedBytes } = resolver.applyAssetStripping(fakeCef, tmp);
const after = resolver.directorySize(fakeCef);

assert.ok(removed.includes('devtools_resources.pak'), 'root devtools_resources.pak should be removed');
assert.ok(removed.includes('Resources/devtools_resources.pak'), 'Resources devtools_resources.pak should be removed');
assert.ok(removed.includes('Resources/pdf_resources.pak'), 'pdf resources should be removed');
assert.strictEqual(fs.existsSync(path.join(fakeCef, 'devtools_resources.pak')), false, 'devtools_resources.pak should be gone');
assert.strictEqual(fs.existsSync(path.join(fakeCef, 'Resources', 'pdf_resources.pak')), false, 'pdf_resources.pak should be gone');
assert.strictEqual(fs.existsSync(path.join(fakeCef, 'Resources', 'locales', 'en-US.pak')), true, 'locales must be preserved');
assert.strictEqual(savedBytes, before - after, 'savedBytes should equal the measured size delta');
assert.ok(savedBytes > 0, 'some bytes should be reclaimed');

// 5. With devtools enabled, the asset is preserved
fs.writeFileSync(path.join(tmp, 'adrenaline.config.js'), "module.exports = { modules: { devtools: true } };\n");
fs.writeFileSync(path.join(fakeCef, 'devtools_resources.pak'), Buffer.alloc(1024));
resolver.applyAssetStripping(fakeCef, tmp);
assert.strictEqual(fs.existsSync(path.join(fakeCef, 'devtools_resources.pak')), true, 'devtools_resources.pak must survive when devtools:true');

fs.rmSync(tmp, { recursive: true, force: true });

console.log('test_config_resolver.js passed successfully!');
process.exit(0);
