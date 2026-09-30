const assert = require('assert');
const adrenaline = require('../index.js');

console.log('Testing ping...');
const pingResult = adrenaline.ping();
console.log('Ping result:', pingResult);
assert.strictEqual(pingResult, 'Adrenaline Core v0.1.0 is Alive!');

console.log('Testing non-blocking window creation and bidirectional IPC...');

const html = `
<!DOCTYPE html>
<html>
<head><title>IPC Test</title></head>
<body>
    <p id="status">Initial</p>
    <script>
        setTimeout(function() {
            if (window.adrenaline && window.adrenaline.send) {
                window.adrenaline.send('ping', { count: 1 });
            }
        }, 100);

        function verifyPong() {
            var text = document.getElementById('status').innerText;
            if (text === 'Pong from Node.js!') {
                window.adrenaline.send('pong-verified', { status: 'success' });
            }
        }
    </script>
</body>
</html>
`;

let pingReceived = false;
let pongVerified = false;

const win = adrenaline.createWindow({
    title: 'Adrenaline Test Window',
    width: 600,
    height: 400,
    html: html
});

assert.ok(win && typeof win.id === 'number' && win.id > 0, 'Window instance should have a positive numeric ID');

win.on('ipc-message', (channel, data) => {
    console.log(`Received IPC message [${channel}]:`, data);
    if (channel === 'ping') {
        pingReceived = true;
        assert.deepStrictEqual(data, { count: 1 });
        console.log('Sending eval to Webview...');
        win.eval("document.getElementById('status').innerText = 'Pong from Node.js!'; verifyPong();");
    } else if (channel === 'pong-verified') {
        pongVerified = true;
        assert.deepStrictEqual(data, { status: 'success' });
        console.log('Pong verified successfully!');
    }
});

const timeout = setTimeout(() => {
    console.error('Test timed out!');
    process.exit(1);
}, 5000);

const checkInterval = setInterval(() => {
    if (pingReceived && pongVerified) {
        clearInterval(checkInterval);
        clearTimeout(timeout);
        console.log('All IPC tests passed! Closing window...');
        const closed = win.close();
        assert.strictEqual(closed, true, 'Window should close successfully');
        console.log('All tests completed successfully!');
        process.exit(0);
    }
}, 200);
