const EventEmitter = require('events');
const native = require('./build/Release/adrenaline.node');

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
    ping: native.ping,
    createWindow,
    Window,
    closeWindow: native.closeWindow,
    evalWindow: native.evalWindow
};
