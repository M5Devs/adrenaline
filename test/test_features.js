const assert = require('assert');
const path = require('path');
const adrenaline = require('../index.js');
const { features, BrowserWindow } = adrenaline;
const resolver = require('../lib/config-resolver');

console.log('Testing features object and feature flags...');

const resolved = resolver.resolve(path.join(__dirname, '..'));

// 1. Verify feature object structure and types
assert.ok(features, 'features object should exist');
['devtools', 'localFiles', 'pdf', 'webrtc', 'cleanPrivacy', 'cef', 'webview'].forEach((key) => {
    assert.strictEqual(typeof features[key], 'boolean', `features.${key} should be boolean`);
});

// 2. The compiled-in features must match the resolved adrenaline.config.js
assert.strictEqual(features.devtools, resolved.modules.devtools, 'compiled devtools should match config');
assert.strictEqual(features.webrtc, resolved.modules.webrtc, 'compiled webrtc should match config');
assert.strictEqual(features.cleanPrivacy, resolved.modules.cleanPrivacy, 'compiled cleanPrivacy should match config');
assert.strictEqual(features.pdf, resolved.modules.pdf, 'compiled pdf should match config');
assert.strictEqual(features.localFiles, resolved.modules.localFiles, 'compiled localFiles should match config');

// Engine selection: exactly one engine is compiled in, and the requested
// engine is surfaced on features.config.
assert.notStrictEqual(features.cef, features.webview, 'exactly one engine should be compiled in');
assert.strictEqual(features.config.engine, resolved.engine, 'features.config.engine should reflect the requested engine');

// 3. The resolver snapshot is surfaced on the features object
assert.ok(features.config, 'features.config should expose the resolved config');
assert.strictEqual(features.config.engine, resolved.engine, 'features.config.engine should match');

// 4. Test BrowserWindow openDevTools behavior when devtools feature is enabled vs disabled
const win = Object.create(BrowserWindow.prototype);

const original = features.devtools;
features.devtools = true;
assert.doesNotThrow(() => {
    win.openDevTools();
}, 'openDevTools should not throw when devtools feature is enabled');

features.devtools = false;
assert.throws(() => {
    win.openDevTools();
}, (err) => {
    return err instanceof Error && err.message === '[Adrenaline] DevTools module was excluded at build time. Rebuild with devtools enabled.';
}, 'openDevTools should throw descriptive error when devtools is false');

features.devtools = original;

console.log('test_features.js passed successfully!');
process.exit(0);
