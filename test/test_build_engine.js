const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const build = require('../scripts/build');
const ROOT = path.resolve(__dirname, '..');

console.log('Testing config-driven engine selection (scripts/build.js)...');

// 1. The project adrenaline.config.js selects cef, and no explicit override wins.
const resolved = build.resolveEngine();
assert.strictEqual(resolved.engine, 'cef', 'engine should come from adrenaline.config.js');
assert.strictEqual(resolved.source, 'adrenaline.config.js', 'source should be the config file');

// 2. CEF availability guard: missing vendor tree degrades to webview, not a hard fail.
assert.deepStrictEqual(build.selectEngine('cef', false), { selected: 'webview', fellBack: true });
assert.deepStrictEqual(build.selectEngine('cef', true), { selected: 'cef', fellBack: false });
assert.deepStrictEqual(build.selectEngine('webview', false), { selected: 'webview', fellBack: false });

// 3. Explicit command line beats the config.
const cli = spawnSync(process.execPath, ['-e', "console.log(require('./scripts/build').resolveEngine().engine)"], {
  cwd: ROOT,
  env: { ...process.env, ADREN_ENGINE: '' }
});
assert.strictEqual(cli.stdout.toString().trim(), 'cef', 'no override -> config engine');

// 4. ADREN_ENGINE beats the config.
const env = spawnSync(process.execPath, ['-e', "console.log(require('./scripts/build').resolveEngine().engine)"], {
  cwd: ROOT,
  env: { ...process.env, ADREN_ENGINE: 'webview' }
});
assert.strictEqual(env.stdout.toString().trim(), 'webview', 'ADREN_ENGINE should override the config');

console.log('test_build_engine.js passed successfully!');
process.exit(0);
