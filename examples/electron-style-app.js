const { app, BrowserWindow, ipcMain } = require('../index.js');
const path = require('path');
const fs = require('fs');

const indexHtmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Adrenaline Desktop</title>
</head>
<body>
    <h1>Hello from Adrenaline Electron-style App!</h1>
    <p id="msg">Waiting for IPC message...</p>
    <script>
        if (window.adrenaline) {
            window.adrenaline.on('greeting', function(data) {
                document.getElementById('msg').innerText = data.text;
                window.adrenaline.send('greeting-ack', { received: true });
            });
            setTimeout(function() {
                window.adrenaline.send('app-started', { timestamp: Date.now() });
            }, 100);
        }
    </script>
</body>
</html>
`.trim();

app.whenReady().then(() => {
    console.log('App ready!');
    const win = new BrowserWindow({
        width: 700,
        height: 500,
        title: 'Adrenaline Desktop',
        html: indexHtmlContent
    });

    ipcMain.on('app-started', (event, data) => {
        console.log('App started message received:', data);
        win.webContents.send('greeting', { text: 'Welcome to Adrenaline Electron API!' });
    });

    ipcMain.on('greeting-ack', (event, data) => {
        console.log('Greeting ACK received:', data);
        console.log('Closing window in 5 seconds...');
        setTimeout(() => {
            console.log('Closing window now...');
            win.close();
        }, 5000);
    });
});

app.on('window-all-closed', () => {
    console.log('All windows closed.');
});
