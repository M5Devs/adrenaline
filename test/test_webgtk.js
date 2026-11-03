const assert = require('assert');
const adrenaline = require('../index.js');
const { app, BrowserWindow, ipcMain, features } = adrenaline;

// This test only exercises the engine when the addon was compiled with
// ADREN_FEATURE_WEBGTK=1 (i.e. `ADREN_ENGINE=webgtk npm install`). Under any
// other engine the native symbols are absent, so the file is a no-op rather
// than a failure, keeping `npm test` engine-agnostic.
if (!features.webgtk) {
    console.log('test_webgtk.js skipped: not compiled with the WebGTK engine.');
    process.exit(0);
}

// WebGTK ships two backends: the `mock` backend (used when no engine archive is
// configured) renders frames but does not execute JavaScript, so the IPC
// round-trip is only meaningful against the real Blink/V8 engine. The smoke
// checks below run in both cases.
const realEngine = Boolean(process.env.WEBGTK_ENGINE_DIR);

console.log(`Testing WebGTK engine (${realEngine ? 'real' : 'mock'} backend)...`);

const html = `
<!DOCTYPE html>
<html>
<head><title>WebGTK Test</title></head>
<body>
    <h1>WebGTK</h1>
    <script>
        window.adrenaline.on('ping', function (data) {
            window.adrenaline.send('pong', { echo: data.value });
        });
        window.adrenaline.send('ready', { engine: 'webgtk' });
    </script>
</body>
</html>
`;

app.whenReady().then(() => {
    const win = new BrowserWindow({ width: 640, height: 480, title: 'WebGTK Test', html });
    assert.ok(win.id > 0, 'WebGTK window should have a positive id');

    // Script execution and title updates must not throw on either backend.
    win.webContents.executeJavaScript('1 + 1');
    win.setTitle('WebGTK Test Renamed');

    if (!realEngine) {
        // Mock backend: assert the engine boots and tears down cleanly.
        setTimeout(() => {
            assert.strictEqual(win.close(), true, 'closeWindow should succeed');
            console.log('test_webgtk.js passed (smoke, mock backend).');
            setTimeout(() => process.exit(0), 100);
        }, 500);
        return;
    }

    // Real engine: full renderer -> main -> renderer IPC round-trip.
    let sawReady = false;
    const timeout = setTimeout(() => {
        console.error('Timed out waiting for WebGTK IPC.');
        process.exit(1);
    }, 20000);

    ipcMain.on('ready', (event, data) => {
        sawReady = true;
        assert.strictEqual(data.engine, 'webgtk', 'ready payload should carry the engine name');
        win.webContents.send('ping', { value: 42 });
    });

    ipcMain.on('pong', (event, data) => {
        assert.strictEqual(data.echo, 42, 'renderer should echo the ping payload');
        clearTimeout(timeout);
        assert.ok(sawReady, 'ready IPC should have been received first');
        win.close();
        console.log('test_webgtk.js passed successfully!');
        setTimeout(() => process.exit(0), 100);
    });
});
