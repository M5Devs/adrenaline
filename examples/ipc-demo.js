const adrenaline = require('../index.js');

const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Adrenaline IPC Demo</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        button { padding: 10px 15px; font-size: 16px; cursor: pointer; }
        p { font-size: 18px; margin-top: 15px; }
    </style>
</head>
<body>
    <h2>Adrenaline.js Bidirectional IPC Demo</h2>
    <button onclick="sendPing()">Ping Node.js</button>
    <p id="status">Waiting...</p>

    <script>
        function sendPing() {
            if (window.adrenaline && window.adrenaline.send) {
                window.adrenaline.send("ping", { time: Date.now() });
            } else if (window.__adrenaline_ipc_send) {
                window.__adrenaline_ipc_send("ping", { time: Date.now() });
            }
        }
    </script>
</body>
</html>
`;

console.log('Creating Adrenaline window with IPC handler...');

const win = adrenaline.createWindow({
    title: 'Adrenaline IPC Demo',
    width: 600,
    height: 400,
    html: html
});

win.on('ipc-message', (channel, data) => {
    console.log(`Received from UI [${channel}]:`, data);
    if (channel === 'ping') {
        console.log('Sending response to Webview...');
        win.eval("document.getElementById('status').innerText = 'Pong from Node.js! ⚡'");
    }
});

console.log('Window created successfully!');
