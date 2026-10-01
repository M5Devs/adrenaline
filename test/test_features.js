const assert = require('assert');
const adrenaline = require('../index.js');
const { features, BrowserWindow } = adrenaline;

console.log('Testing features object and feature flags...');

// 1. Verify feature object structure and types
assert.ok(features, 'features object should exist');
assert.strictEqual(typeof features.devtools, 'boolean', 'features.devtools should be boolean');
assert.strictEqual(typeof features.localFiles, 'boolean', 'features.localFiles should be boolean');
assert.strictEqual(typeof features.pdf, 'boolean', 'features.pdf should be boolean');
assert.strictEqual(typeof features.cef, 'boolean', 'features.cef should be boolean');
assert.strictEqual(typeof features.webview, 'boolean', 'features.webview should be boolean');

// Defaults check for standard build
assert.strictEqual(features.devtools, true, 'Default devtools should be true');
assert.strictEqual(features.localFiles, true, 'Default localFiles should be true');
assert.strictEqual(features.pdf, false, 'Default pdf should be false');
assert.strictEqual(features.cef, false, 'Default cef should be false');
assert.strictEqual(features.webview, true, 'Default webview should be true');

// 2. Test BrowserWindow openDevTools behavior when devtools feature is enabled vs disabled
// Prototype call without creating background webview thread
const win = Object.create(BrowserWindow.prototype);

// Should succeed when devtools === true
assert.doesNotThrow(() => {
    win.openDevTools();
}, 'openDevTools should not throw when devtools feature is enabled');

// Simulate devtools disabled behavior
features.devtools = false;
assert.throws(() => {
    win.openDevTools();
}, (err) => {
    return err instanceof Error && err.message === '[Adrenaline] DevTools module was excluded at build time. Rebuild with devtools enabled.';
}, 'openDevTools should throw descriptive error when devtools is false');

// Restore feature flag
features.devtools = true;

console.log('test_features.js passed successfully!');
process.exit(0);
