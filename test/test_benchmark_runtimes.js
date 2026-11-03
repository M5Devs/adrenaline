const assert = require('assert');
const path = require('path');
const fs = require('fs');

const runtimes = require('../benchmarks/stress-suite/runtimes');

console.log('Testing benchmark runtime roster (NW.js evicted, WebGTK added)...');

// NW.js is gone: no registry entry, no launcher module.
assert.ok(!runtimes.RUNTIMES.nw, 'the nw runtime must be evicted from the registry');
assert.ok(runtimes.RUNTIMES['adrenaline-webgtk'], 'adrenaline-webgtk must be registered');
assert.ok(!fs.existsSync(path.join(__dirname, '..', 'benchmarks', 'stress-suite', 'nw-app')), 'nw-app/ must be deleted');

// The Linux showdown is exactly the five requested runtimes, WebGTK last. On
// other platforms the two Linux-only engines drop out.
const expected = process.platform === 'linux'
  ? ['electron', 'neutralino', 'adrenaline-webview', 'adrenaline-cef', 'adrenaline-webgtk']
  : ['electron', 'neutralino', 'adrenaline-webview'];
assert.deepStrictEqual(runtimes.runtimeOrder(), expected);

// WebGTK is Linux-only and launches the shared Adrenaline runner with the
// WebGTK addon selected.
const entry = runtimes.RUNTIMES['adrenaline-webgtk'];
assert.strictEqual(entry.label, 'Adrenaline.js (WebGTK)');
assert.deepStrictEqual(entry.platforms, ['linux']);
assert.strictEqual(runtimes.isAvailable('adrenaline-webgtk'), process.platform === 'linux');

const spec = runtimes.commandFor('adrenaline-webgtk', { repoRoot: '/repo', suiteDir: '/suite' });
assert.ok(spec.command[1].endsWith('adrenaline-runner.js'));
assert.ok(spec.env.ADREN_ADDON_PATH.endsWith('adrenaline-webgtk.node'));

// Every non-Linux platform exposes no Linux-only runtimes.
for (const rt of ['adrenaline-cef', 'adrenaline-webgtk']) {
  assert.deepStrictEqual(runtimes.RUNTIMES[rt].platforms, ['linux']);
}

console.log('test_benchmark_runtimes.js passed successfully!');
