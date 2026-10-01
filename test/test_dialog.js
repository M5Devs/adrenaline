const assert = require('assert');
const adrenaline = require('../index.js');
const { dialog } = adrenaline;

console.log('Testing dialog module existence and methods...');

assert.ok(dialog, 'dialog module should exist');
assert.strictEqual(typeof dialog.showOpenDialog, 'function', 'showOpenDialog should be a function');
assert.strictEqual(typeof dialog.showSaveDialog, 'function', 'showSaveDialog should be a function');
assert.strictEqual(typeof dialog.showMessageBox, 'function', 'showMessageBox should be a function');

async function runTests() {
    console.log('Testing showMessageBox with empty options...');
    const boxPromise = dialog.showMessageBox({ _testTimeout: 50 });
    assert.ok(boxPromise instanceof Promise, 'showMessageBox should return a Promise');
    const boxRes = await boxPromise;
    assert.strictEqual(typeof boxRes, 'object', 'showMessageBox should resolve to an object');
    assert.strictEqual(typeof boxRes.response, 'number', 'boxRes.response should be a number');
    assert.strictEqual(typeof boxRes.checkboxChecked, 'boolean', 'boxRes.checkboxChecked should be a boolean');

    console.log('Testing showOpenDialog with default options...');
    const openPromise = dialog.showOpenDialog({
        title: 'Test Open Dialog',
        filters: [{ name: 'Text Files', extensions: ['txt'] }],
        properties: ['openFile'],
        _testTimeout: 50
    });
    assert.ok(openPromise instanceof Promise, 'showOpenDialog should return a Promise');
    const openRes = await openPromise;
    assert.strictEqual(typeof openRes, 'object', 'showOpenDialog should resolve to an object');
    assert.strictEqual(typeof openRes.canceled, 'boolean', 'openRes.canceled should be a boolean');
    assert.ok(Array.isArray(openRes.filePaths), 'openRes.filePaths should be an array');

    console.log('Testing showSaveDialog with default options...');
    const savePromise = dialog.showSaveDialog({
        title: 'Test Save Dialog',
        filters: [{ name: 'All Files', extensions: ['*'] }],
        _testTimeout: 50
    });
    assert.ok(savePromise instanceof Promise, 'showSaveDialog should return a Promise');
    const saveRes = await savePromise;
    assert.strictEqual(typeof saveRes, 'object', 'showSaveDialog should resolve to an object');
    assert.strictEqual(typeof saveRes.canceled, 'boolean', 'saveRes.canceled should be a boolean');
    assert.strictEqual(typeof saveRes.filePath, 'string', 'saveRes.filePath should be a string');

    console.log('dialog unit tests passed successfully!');
}

runTests().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
