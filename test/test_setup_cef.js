const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const setupCef = require('../scripts/setup-cef');

console.log('Testing scripts/setup-cef.js resolver & pruner logic...');

// 1. Version selection: newest stable version wins, and the minimal file is chosen
const index = {
  linux64: {
    versions: [
      {
        cef_version: '120.0.1',
        channel: 'stable',
        files: [
          { type: 'minimal', name: 'old_minimal.tar.bz2', size: 1, last_modified: '2026-01-01T00:00:00Z' },
          { type: 'standard', name: 'old_standard.tar.bz2', size: 9, last_modified: '2026-01-01T00:00:00Z' }
        ]
      },
      {
        cef_version: '150.0.23',
        channel: 'stable',
        files: [
          { type: 'standard', name: 'new_standard.tar.bz2', size: 9, last_modified: '2026-10-31T05:00:00Z' },
          { type: 'minimal', name: 'new_minimal.tar.bz2', size: 2, last_modified: '2026-10-31T05:00:00Z' }
        ]
      },
      {
        cef_version: '151.0.0',
        channel: 'beta',
        files: [
          { type: 'minimal', name: 'beta_minimal.tar.bz2', size: 3, last_modified: '2026-12-01T00:00:00Z' }
        ]
      }
    ]
  }
};

const selection = setupCef.selectLatestStableMinimal(index);
assert.strictEqual(selection.version.cef_version, '150.0.23', 'newest stable version should be selected (beta excluded)');
assert.strictEqual(selection.file.type, 'minimal', 'minimal distribution should be selected');
assert.strictEqual(selection.file.name, 'new_minimal.tar.bz2', 'the minimal file name should match');

// 2. Locale pruning keeps only en-US family paks
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adren-cef-'));
const localesDir = path.join(tmp, 'Resources', 'locales');
fs.mkdirSync(localesDir, { recursive: true });
const make = (name, size) => fs.writeFileSync(path.join(localesDir, name), Buffer.alloc(size));

['en-US.pak', 'en-US_FEMININE.pak', 'en-US_MASCULINE.pak', 'en-US_NEUTER.pak'].forEach((n) => make(n, 100));
['de.pak', 'fr.pak', 'ja.pak', 'zh-CN.pak', 'ar.pak', 'ru.pak'].forEach((n) => make(n, 200));

const result = setupCef.pruneLocales(tmp);
const remaining = fs.readdirSync(localesDir).sort();

assert.strictEqual(result.removed, 6, 'six non en-US locales should be removed');
assert.deepStrictEqual(remaining, ['en-US.pak', 'en-US_FEMININE.pak', 'en-US_MASCULINE.pak', 'en-US_NEUTER.pak'], 'only en-US family paks should remain');
assert.strictEqual(result.savedBytes, 6 * 200, 'saved bytes should equal removed locale sizes');

// 3. Test directory removal
const testsDir = path.join(tmp, 'tests');
fs.mkdirSync(path.join(testsDir, 'cefclient'), { recursive: true });
fs.writeFileSync(path.join(testsDir, 'cefclient', 'main.cc'), 'x'.repeat(500));
const removedTests = setupCef.removeTests(tmp);
assert.strictEqual(removedTests.removed, true, 'tests directory should be reported removed');
assert.strictEqual(fs.existsSync(testsDir), false, 'tests directory should be gone');
assert.ok(removedTests.savedBytes >= 500, 'saved bytes should cover the test payload');

fs.rmSync(tmp, { recursive: true, force: true });

console.log('test_setup_cef.js passed successfully!');
process.exit(0);
