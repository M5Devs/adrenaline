const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

const spawnTime = Date.now();
let ipcInterval = null;
let ipcSeq = 0;

app.whenReady().then(() => {
    const htmlPath = path.join(__dirname, 'app', 'index.html');
    const preloadPath = path.join(__dirname, 'preload.js');

    const win = new BrowserWindow({
        width: 1000,
        height: 700,
        title: 'Electron Head-to-Head Test',
        webPreferences: {
            preload: preloadPath,
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    win.loadFile(htmlPath);

    ipcMain.on('app-ready', (event, data) => {
        const readyTime = Date.now() - spawnTime;
        if (process.send) {
            process.send({ type: 'READY', timeMs: readyTime });
        } else {
            console.log(`[Electron] Ready signal received in ${readyTime}ms`);
        }

        ipcInterval = setInterval(() => {
            ipcSeq++;
            if (!win.isDestroyed()) {
                win.webContents.send('ping-from-main', { seq: ipcSeq });
            }
        }, 500);
    });

    ipcMain.on('pong-from-renderer', (event, data) => {
        // Active IPC acknowledged
    });
});

process.on('SIGTERM', () => {
    if (ipcInterval) clearInterval(ipcInterval);
    app.quit();
});

process.on('SIGINT', () => {
    if (ipcInterval) clearInterval(ipcInterval);
    app.quit();
});
