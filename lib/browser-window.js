const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const native = require('../build/Release/adrenaline.node');
const app = require('./app');
const ipcMain = require('./ipc-main');

class WebContents extends EventEmitter {
    constructor(browserWindow) {
        super();
        this._window = browserWindow;
    }

    executeJavaScript(code) {
        if (!this._window._isClosed) {
            return native.evalWindow(this._window.id, code);
        }
        return false;
    }

    send(channel, data) {
        const json = JSON.stringify(data !== undefined ? data : null);
        const script = `if (window.adrenaline && window.adrenaline._onMessage) { window.adrenaline._onMessage(${JSON.stringify(channel)}, ${json}); }`;
        return this.executeJavaScript(script);
    }
}

class BrowserWindow extends EventEmitter {
    constructor(options = {}) {
        super();

        const {
            width = 800,
            height = 600,
            title = 'Adrenaline App',
            webPreferences = {},
            url,
            html
        } = options;

        this._options = { width, height, title, webPreferences, url, html };
        this._isClosed = false;

        this.webContents = new WebContents(this);

        const nativeOpts = {
            width,
            height,
            title,
            url,
            html,
            onIpc: (channel, data) => this._handleIpc(channel, data)
        };

        this._id = native.createWindow(nativeOpts);

        app._addWindow(this);
    }

    get id() {
        return this._id;
    }

    _handleIpc(channel, data) {
        if (this._isClosed) return;

        // Special channel for ipcMain.handle / ipcRenderer.invoke
        if (channel === '__adrenaline_ipc_invoke' && data && typeof data === 'object') {
            const { reqId, channel: targetChannel, data: payload } = data;
            const event = { sender: this.webContents };

            ipcMain._invoke(targetChannel, event, payload)
                .then((result) => {
                    const resJson = JSON.stringify(result !== undefined ? result : null);
                    this.webContents.executeJavaScript(`if (window.__adrenaline_ipc_reply) window.__adrenaline_ipc_reply(${JSON.stringify(reqId)}, null, ${resJson});`);
                })
                .catch((err) => {
                    const errMsg = err && err.message ? err.message : String(err);
                    this.webContents.executeJavaScript(`if (window.__adrenaline_ipc_reply) window.__adrenaline_ipc_reply(${JSON.stringify(reqId)}, ${JSON.stringify(errMsg)}, null);`);
                });
            return;
        }

        // Emit raw on Window instance for backward compatibility
        this.emit('ipc-message', channel, data);

        // Emit on ipcMain
        const event = { sender: this.webContents };
        ipcMain.emit(channel, event, data);
    }

    setTitle(title) {
        if (this._isClosed) return;
        this._options.title = title;
        const script = `document.title = ${JSON.stringify(title)};`;
        this.webContents.executeJavaScript(script);
    }

    loadURL(url) {
        if (this._isClosed) return;
        const script = `window.location.href = ${JSON.stringify(url)};`;
        this.webContents.executeJavaScript(script);
    }

    loadFile(filePath) {
        if (this._isClosed) return;
        const absPath = path.resolve(filePath);
        if (fs.existsSync(absPath)) {
            const fileContent = fs.readFileSync(absPath, 'utf8');
            const dataUri = `data:text/html;charset=utf-8,${encodeURIComponent(fileContent)}`;
            this.loadURL(dataUri);
        } else {
            throw new Error(`File not found: ${filePath}`);
        }
    }

    close() {
        if (this._isClosed) return false;
        this._isClosed = true;
        this.emit('closed');
        const closed = native.closeWindow(this._id);
        app._removeWindow(this);
        return closed;
    }
}

module.exports = BrowserWindow;
