const EventEmitter = require('events');

class App extends EventEmitter {
    constructor() {
        super();
        this._isReady = false;
        this._windows = new Set();
        this._readyPromise = new Promise((resolve) => {
            setImmediate(() => {
                this._isReady = true;
                this.emit('ready');
                resolve();
            });
        });
    }

    whenReady() {
        return this._readyPromise;
    }

    _addWindow(win) {
        this._windows.add(win);
    }

    _removeWindow(win) {
        if (this._windows.has(win)) {
            this._windows.delete(win);
            if (this._windows.size === 0) {
                let defaultPrevented = false;
                const event = {
                    preventDefault: () => {
                        defaultPrevented = true;
                    }
                };
                this.emit('window-all-closed', event);
                if (!defaultPrevented) {
                    this.quit();
                }
            }
        }
    }

    quit() {
        // Copy set to avoid mutation issues during iteration
        const openWindows = Array.from(this._windows);
        for (const win of openWindows) {
            try {
                win.close();
            } catch (e) {
                // Ignore error if window was already closed
            }
        }
        this._windows.clear();
        setImmediate(() => {
            process.exit(0);
        });
    }
}

const appSingleton = new App();
module.exports = appSingleton;
