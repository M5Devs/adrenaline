const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const resolver = require('../lib/config-resolver');

console.log('Testing Modular Config Stripping Engine (lib/config-resolver.js)...');

/**
 * Compile a tiny shared object carrying debug info. Returns its path, or null
 * when no C compiler is available (the strip assertions are then skipped rather
 * than failed, since the strip path itself is still exercised on any machine
 * that has one).
 */
function buildDebugElf(dir) {
  const src = path.join(dir, 'probe.c');
  const out = path.join(dir, 'libprobe.so');
  fs.writeFileSync(src, 'int adrenaline_probe(int x) { return x * 2; }\n');
  const cc = spawnSync('cc', ['-g', '-shared', '-fPIC', '-o', out, src], { stdio: 'ignore' });
  if (cc.error || cc.status !== 0 || !fs.existsSync(out)) return null;
  return out;
}

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

// 6. The heavy software rasterizers are pruned by default (disable-gpu build)
fs.mkdirSync(path.join(fakeCef, 'Release'), { recursive: true });
for (const rel of resolver.SOFTWARE_RASTERIZER_ASSETS) {
  fs.writeFileSync(path.join(fakeCef, rel), Buffer.alloc(4096));
}
fs.writeFileSync(path.join(tmp, 'adrenaline.config.js'), "module.exports = { engine: 'cef' };\n");
const raster = resolver.applyAssetStripping(fakeCef, tmp);
assert.ok(
  raster.removed.includes('Release/libvk_swiftshader.so'),
  'libvk_swiftshader.so should be pruned by default'
);
assert.strictEqual(
  fs.existsSync(path.join(fakeCef, 'Release', 'libvulkan.so.1')),
  false,
  'libvulkan.so.1 should be gone by default'
);

// 7. Opting into the software rasterizer keeps the assets
for (const rel of resolver.SOFTWARE_RASTERIZER_ASSETS) {
  fs.writeFileSync(path.join(fakeCef, rel), Buffer.alloc(4096));
}
fs.writeFileSync(path.join(tmp, 'adrenaline.config.js'), "module.exports = { engine: 'cef', modules: { softwareRasterizer: true } };\n");
resolver.applyAssetStripping(fakeCef, tmp);
assert.strictEqual(
  fs.existsSync(path.join(fakeCef, 'Release', 'libvk_swiftshader.so')),
  true,
  'libvk_swiftshader.so must survive when softwareRasterizer:true'
);

// 8. stripBinary reclaims debug info from an ELF and preserves its dynamic symbols
const elf = buildDebugElf(tmp);
if (elf) {
  const beforeStrip = fs.statSync(elf).size;
  const stripResult = resolver.stripBinary(elf);
  assert.strictEqual(stripResult.stripped, true, 'stripBinary should report the file was stripped');
  assert.strictEqual(fs.statSync(elf).size, beforeStrip - stripResult.savedBytes, 'savedBytes must equal the size delta');
  assert.ok(stripResult.savedBytes > 0, 'debug build should shrink after stripping');
  // A second pass is a no-op (idempotent).
  assert.strictEqual(resolver.stripBinary(elf).stripped, false, 'stripping an already-stripped file should be a no-op');
  // The symbol the linker needs must survive (`nm -D` reads the dynamic table).
  const nm = spawnSync('nm', ['-D', '--defined-only', elf], { encoding: 'utf8' });
  if (nm.status === 0) {
    assert.ok(nm.stdout.includes('adrenaline_probe'), 'dynamic symbol table must survive stripping');
  }
  assert.strictEqual(resolver.stripBinary(path.join(tmp, 'does-not-exist.so')).stripped, false, 'missing files are a no-op');
} else {
  console.log('  (skipping ELF strip assertions: no C compiler available)');
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log('test_config_resolver.js passed successfully!');
process.exit(0);
