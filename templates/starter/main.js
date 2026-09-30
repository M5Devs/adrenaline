const { app, BrowserWindow, ipcMain } = require('adrenaline-js');
const path = require('path');
const fs = require('fs');

app.whenReady().then(() => {
    const indexPath = path.join(__dirname, 'index.html');

    let win;
    if (fs.existsSync(indexPath)) {
        win = new BrowserWindow({
            width: 800,
            height: 600,
            title: 'Adrenaline Starter App'
        });
        win.loadFile(indexPath);
    } else {
        win = new BrowserWindow({
            width: 800,
            height: 600,
            title: 'Adrenaline Starter App',
            html: '<h1>Welcome to Adrenaline!</h1>'
        });
    }

    let counter = 0;

    ipcMain.on('ping', (event, data) => {
        console.log('Received ping from renderer:', data);
        win.webContents.send('pong', {
            reply: 'Pong from Node.js!',
            timestamp: Date.now()
        });
    });

    ipcMain.on('increment-counter', (event, data) => {
        counter += 1;
        win.webContents.send('counter-updated', { count: counter });
    });
});

app.on('window-all-closed', () => {
    console.log('All windows closed. Exiting...');
});
