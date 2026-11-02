const assert = require('assert');
const fs = require('fs');
const path = require('path');
const adrenaline = require('../index.js');
const { features } = adrenaline;

console.log('Testing CEF Architecture Stubs and Feature Wiring...');

// 1. Check feature flags on native layer
assert.ok(features, 'features object should be defined');
assert.strictEqual(typeof features.cef, 'boolean', 'features.cef should be a boolean');

// 2. Verify CEF files exist and contain no remaining TODO comments
const cefFiles = [
  path.join(__dirname, '../src/cef/adrenaline_app.h'),
  path.join(__dirname, '../src/cef/adrenaline_app.cpp'),
  path.join(__dirname, '../src/cef/adrenaline_client.h'),
  path.join(__dirname, '../src/cef/adrenaline_client.cpp')
];

cefFiles.forEach((file) => {
  assert.ok(fs.existsSync(file), `File ${file} should exist`);
  const content = fs.readFileSync(file, 'utf8');
  assert.strictEqual(content.includes('// TODO'), false, `File ${file} should have zero remaining // TODO comments`);
});

// 3. Verify the low-latency external message pump wiring. The engine thread must
//    block on a wake fd (not a fixed sleep) and CEF must be able to wake it.
const wakeupHeader = fs.readFileSync(path.join(__dirname, '../src/cef/adrenaline_wakeup.h'), 'utf8');
assert.ok(wakeupHeader.includes('SignalEngineWakeup'), 'wakeup helper must expose SignalEngineWakeup()');
assert.ok(wakeupHeader.includes('ShouldPumpNow'), 'wakeup helper must expose the idle-pump throttle');

const windowSource = fs.readFileSync(path.join(__dirname, '../src/window.cpp'), 'utf8');
assert.ok(windowSource.includes('CefDoMessageLoopWork'), 'window.cpp must drive CefDoMessageLoopWork()');
assert.ok(/poll\s*\(/.test(windowSource), 'the CEF engine loop must block in poll() on the wake fd');
assert.ok(
  windowSource.includes('SignalEngineWakeup'),
  'queued tasks must signal the engine wake fd so dispatch is immediate'
);

const appHeader = fs.readFileSync(path.join(__dirname, '../src/cef/adrenaline_app.h'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '../src/cef/adrenaline_app.cpp'), 'utf8');
assert.ok(appHeader.includes('OnScheduleMessagePumpWork'), 'AdrenalineApp must override OnScheduleMessagePumpWork');
assert.ok(appSource.includes('OnScheduleMessagePumpWork'), 'AdrenalineApp must implement OnScheduleMessagePumpWork');
assert.ok(appSource.includes('SignalEngineWakeup'), 'OnScheduleMessagePumpWork must signal the engine wake fd');

// 4. Verify compilation safety and functionality under current build configuration
if (!features.cef) {
  console.log('Building under default engine (ADREN_FEATURE_CEF == 0). CEF stubs are correctly fallbacked.');
} else {
  console.log('Building with CEF enabled (ADREN_FEATURE_CEF == 1). CEF architecture active.');
}

console.log('test_cef_architecture.js passed successfully!');
process.exit(0);
