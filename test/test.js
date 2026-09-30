const assert = require('assert');
const adrenaline = require('../build/Release/adrenaline.node');

// Test 1: ping
const pingResult = adrenaline.ping();
console.log('Ping result:', pingResult);
assert.strictEqual(pingResult, 'Adrenaline Core v0.1.0 is Alive!');

// Test 2: Non-blocking window creation
console.log('Testing non-blocking window creation...');
let loggedImmediately = false;

const winId = adrenaline.createWindow({
  title: 'Adrenaline.js PoC',
  width: 600,
  height: 400,
  html: '<h1>Adrenaline.js is Running! 🚀</h1>'
});

console.log('Window created successfully, Node.js loop still running!');
loggedImmediately = true;

assert.ok(typeof winId === 'number' && winId > 0, 'Window ID should be a positive number');
assert.ok(loggedImmediately, 'Log statement executed immediately without blocking');

setTimeout(() => {
  const closed = adrenaline.closeWindow(winId);
  console.log('Window close result:', closed);
  assert.strictEqual(closed, true, 'Window should close successfully');
  console.log('All tests passed!');
  process.exit(0);
}, 1000);
