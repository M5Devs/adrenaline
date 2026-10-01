const EventEmitter = require('events');
const native = require('./build/Release/adrenaline.node');
const app = require('./lib/app');
const BrowserWindow = require('./lib/browser-window');
const ipcMain = require('./lib/ipc-main');
const features = require('./lib/features');

class Window extends EventEmitter {
    constructor(options = {}) {
        super();
        const opts = { ...options };
        opts.onIpc = (channel, data) => {
            this.emit('ipc-message', channel, data);
        };
        this._id = native.createWindow(opts);
    }

    get id() {
        return this._id;
    }

    eval(script) {
        return native.evalWindow(this._id, script);
    }

    executeJavaScript(script) {
        return this.eval(script);
    }

    close() {
        return native.closeWindow(this._id);
    }
}

function createWindow(options) {
    return new Window(options);
}

module.exports = {
    app,
    BrowserWindow,
    ipcMain,
    features,
    ping: native.ping,
    createWindow,
    Window,
    closeWindow: native.closeWindow,
    evalWindow: native.evalWindow
};
