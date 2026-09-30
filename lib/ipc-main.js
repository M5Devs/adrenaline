const EventEmitter = require('events');

class IpcMain extends EventEmitter {
    constructor() {
        super();
        this._handlers = new Map();
    }

    handle(channel, handler) {
        if (typeof handler !== 'function') {
            throw new TypeError(`Handler for '${channel}' must be a function`);
        }
        if (this._handlers.has(channel)) {
            throw new Error(`Attempted to register a second handler for '${channel}'`);
        }
        this._handlers.set(channel, handler);
    }

    handleOnce(channel, handler) {
        if (typeof handler !== 'function') {
            throw new TypeError(`Handler for '${channel}' must be a function`);
        }
        if (this._handlers.has(channel)) {
            throw new Error(`Attempted to register a second handler for '${channel}'`);
        }
        const wrapper = async (event, ...args) => {
            this.removeHandler(channel);
            return await handler(event, ...args);
        };
        this._handlers.set(channel, wrapper);
    }

    removeHandler(channel) {
        this._handlers.delete(channel);
    }

    async _invoke(channel, event, ...args) {
        const handler = this._handlers.get(channel);
        if (!handler) {
            throw new Error(`No handler registered for '${channel}'`);
        }
        return await handler(event, ...args);
    }
}

const ipcMainSingleton = new IpcMain();
module.exports = ipcMainSingleton;
