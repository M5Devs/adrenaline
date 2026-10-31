const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('../index.js');

console.log('Testing Performance & Privacy Flags Optimization Engine...');

// 1. Check CEF C++ source file flags and zero TODOs
const cefHeaderPath = path.join(__dirname, '../src/cef/adrenaline_app.h');
const cefCppPath = path.join(__dirname, '../src/cef/adrenaline_app.cpp');

assert.ok(fs.existsSync(cefHeaderPath), 'adrenaline_app.h must exist');
assert.ok(fs.existsSync(cefCppPath), 'adrenaline_app.cpp must exist');

const headerContent = fs.readFileSync(cefHeaderPath, 'utf8');
const cppContent = fs.readFileSync(cefCppPath, 'utf8');

assert.ok(headerContent.includes('OnBeforeCommandLineProcessing'), 'header must declare OnBeforeCommandLineProcessing');
assert.ok(cppContent.includes('OnBeforeCommandLineProcessing'), 'cpp must implement OnBeforeCommandLineProcessing');

// Every switch is gated on a compile-time feature macro sourced from
// adrenaline.config.js (Modular Feature Elimination Engine).
const requiredSwitches = [
  'enable-low-end-device-mode',
  'no-pings',
  'disable-background-networking',
  'webrtc-ip-handling-policy',
  'disable_non_proxied_udp',
  'hide-crashed-bubble'
];

requiredSwitches.forEach((sw) => {
  assert.ok(cppContent.includes(sw), `adrenaline_app.cpp must contain switch/value '${sw}'`);
});

// Feature-elimination gates must be present.
['ADREN_FEATURE_WEBRTC', 'ADREN_FEATURE_CLEAN_PRIVACY', 'ADREN_FEATURE_PDF'].forEach((macro) => {
  assert.ok(cppContent.includes(macro), `adrenaline_app.cpp must gate switches on ${macro}`);
});

assert.strictEqual(headerContent.includes('// TODO'), false, 'adrenaline_app.h must contain zero TODOs');
assert.strictEqual(cppContent.includes('// TODO'), false, 'adrenaline_app.cpp must contain zero TODOs');

// 2. Check BrowserWindow options default values and custom options forwarding
const defaultWin = new BrowserWindow();
assert.strictEqual(defaultWin._options.lowEndDeviceMode, true, 'lowEndDeviceMode should default to true');
assert.strictEqual(defaultWin._options.privacyShield, true, 'privacyShield should default to true');

const customWin = new BrowserWindow({
  lowEndDeviceMode: false,
  privacyShield: false,
  width: 600,
  height: 400
});

assert.strictEqual(customWin._options.lowEndDeviceMode, false, 'custom lowEndDeviceMode should be false');
assert.strictEqual(customWin._options.privacyShield, false, 'custom privacyShield should be false');

console.log('test_flags_optimization.js passed successfully!');
process.exit(0);
