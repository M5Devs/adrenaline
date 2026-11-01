const path = require('path');

// Single point of native-addon resolution. `ADREN_ADDON_PATH` lets a caller
// select a specific build (e.g. the webview or CEF engine) without rebuilding
// or swapping files in `build/Release/`; it defaults to the normal build output.
const addonPath = process.env.ADREN_ADDON_PATH
    ? path.resolve(process.env.ADREN_ADDON_PATH)
    : path.join(__dirname, '..', 'build', 'Release', 'adrenaline.node');

module.exports = require(addonPath);
