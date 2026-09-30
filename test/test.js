const assert = require('assert');
const path = require('path');
const fs = require('fs');
const adrenaline = require('../index.js');
const { app, BrowserWindow, ipcMain } = adrenaline;

console.log('Testing ping...');
const pingResult = adrenaline.ping();
console.log('Ping result:', pingResult);
assert.strictEqual(pingResult, 'Adrenaline Core v0.1.0 is Alive!');

console.log('Testing Electron-compatible High-Level API (app, BrowserWindow, ipcMain)...');

let windowAllClosedFired = false;
let handleCalled = false;

app.on('window-all-closed', (e) => {
    if (e && e.preventDefault) e.preventDefault();
    windowAllClosedFired = true;
    console.log('app event: window-all-closed fired');
});

app.whenReady().then(() => {
    console.log('app.whenReady() promise resolved');

    const testHtmlPath = path.join(__dirname, 'test_page.html');
    const htmlContent = `
<!DOCTYPE html>
<html>
<head><title>Electron API Test Page</title></head>
<body>
    <h1 id="title">Initial Header</h1>
    <script>
        if (window.adrenaline) {
            window.adrenaline.on('server-msg', function(data) {
                if (data && data.hello === 'world') {
                    window.adrenaline.send('client-ack', { ok: true });
                }
            });

            setTimeout(function() {
                window.adrenaline.send('client-ready', { status: 'ready' });
            }, 100);
        }
    </script>
</body>
</html>
    `.trim();
    fs.writeFileSync(testHtmlPath, htmlContent);

    const win = new BrowserWindow({
        width: 700,
        height: 500,
        title: 'Initial Title',
        html: htmlContent
    });

    assert.ok(win.id > 0, 'BrowserWindow should have valid ID');
    win.setTitle('Updated Title');

    ipcMain.handle('test-handle', async (event, data) => {
        handleCalled = true;
        return 'handled:' + data;
    });

    ipcMain._invoke('test-handle', {}, 'sample').then((res) => {
        assert.strictEqual(res, 'handled:sample');
    });

    let clientReadyReceived = false;
    let clientAckReceived = false;

    ipcMain.on('client-ready', (event, data) => {
        console.log('Received client-ready on ipcMain:', data);
        assert.deepStrictEqual(data, { status: 'ready' });
        clientReadyReceived = true;
        win.webContents.send('server-msg', { hello: 'world' });
    });

    ipcMain.on('client-ack', (event, data) => {
        console.log('Received client-ack on ipcMain:', data);
        assert.deepStrictEqual(data, { ok: true });
        clientAckReceived = true;

        assert.ok(handleCalled, 'ipcMain.handle should have been called');
        assert.ok(clientReadyReceived, 'ipcMain.on client-ready should have been called');

        console.log('Electron API tests passed! Closing BrowserWindow...');
        win.close();

        setTimeout(() => {
            assert.ok(windowAllClosedFired, 'window-all-closed event should have fired');
            if (fs.existsSync(testHtmlPath)) fs.unlinkSync(testHtmlPath);
            console.log('All unit and integration tests completed successfully!');
            process.exit(0);
        }, 300);
    });
});
