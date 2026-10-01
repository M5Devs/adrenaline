const native = require('../build/Release/adrenaline.node');

const dialog = {
    showOpenDialog: async (options = {}) => {
        return native.showOpenDialog(options);
    },
    showSaveDialog: async (options = {}) => {
        return native.showSaveDialog(options);
    },
    showMessageBox: async (options = {}) => {
        return native.showMessageBox(options);
    }
};

module.exports = dialog;
