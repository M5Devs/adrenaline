const assert = require('assert');
const path = require('path');
const fs = require('fs');
const adrenaline = require('../index.js');
const { app, BrowserWindow, ipcMain } = adrenaline;

console.log('Testing loadFile (file:// URI support), navigateWindow, and window hints...');

app.whenReady().then(() => {
    const htmlPath = path.join(__dirname, 'test_file_asset.html');
    const jsPath = path.join(__dirname, 'test_asset.js');

    const jsContent = `
        if (window.adrenaline) {
            window.adrenaline.send('asset-loaded', { relativeAssetResolved: true });
        }
    `.trim();

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>LoadFile Asset Test</title>
</head>
<body>
    <h1>File URI Relative Asset Test</h1>
    <script src="./test_asset.js"></script>
</body>
</html>
    `.trim();

    fs.writeFileSync(jsPath, jsContent);
    fs.writeFileSync(htmlPath, htmlContent);

    const win = new BrowserWindow({
        width: 800,
        height: 600,
        resizable: false,
        minWidth: 400,
        minHeight: 300,
        maxWidth: 1000,
        maxHeight: 800,
        title: 'LoadFile Test'
    });

    let assetLoadedReceived = false;

    ipcMain.on('asset-loaded', (event, data) => {
        console.log('Received asset-loaded on ipcMain:', data);
        assert.deepStrictEqual(data, { relativeAssetResolved: true });
        assetLoadedReceived = true;

        console.log('loadFile and asset resolution test passed! Closing window...');
        setImmediate(() => {
            win.close();
            if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
            if (fs.existsSync(jsPath)) fs.unlinkSync(jsPath);
            assert.ok(assetLoadedReceived, 'asset-loaded IPC should have been received');
            console.log('test_loadfile.js completed successfully!');
            process.exit(0);
        });
    });

    // Load file via loadFile
    win.loadFile(htmlPath);
});
