const path = require('path');
const adrenaline = require('../../index.js');
const { app, BrowserWindow, ipcMain } = adrenaline;

const spawnTime = Date.now();
let ipcInterval = null;
let ipcSeq = 0;

app.whenReady().then(() => {
    const htmlPath = path.join(__dirname, 'app', 'index.html');

    const win = new BrowserWindow({
        width: 1000,
        height: 700,
        title: 'Adrenaline Head-to-Head Test'
    });

    win.loadFile(htmlPath);

    ipcMain.on('app-ready', (event, data) => {
        const readyTime = Date.now() - spawnTime;
        if (process.send) {
            process.send({ type: 'READY', timeMs: readyTime });
        } else {
            console.log(`[Adrenaline] Ready signal received in ${readyTime}ms`);
        }

        // Start 500ms continuous bidirectional IPC ping loop
        ipcInterval = setInterval(() => {
            ipcSeq++;
            win.webContents.send('ping-from-main', { seq: ipcSeq });
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
