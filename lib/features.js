const path = require('path');
const native = require('../build/Release/adrenaline.node');
const resolver = require('./config-resolver');

const defaults = {
    devtools: true,
    localFiles: true,
    pdf: false,
    webrtc: true,
    cleanPrivacy: false,
    cef: false,
    webview: true
};

let features;
if (native && typeof native.getCompiledFeatures === 'function') {
    features = native.getCompiledFeatures();
} else {
    features = { ...defaults };
}

// Surface the on-disk `adrenaline.config.js` decisions too, so consumers can
// reason about the *requested* runtime even when the native addon was built
// from a different config.
const resolved = resolver.resolve(path.join(__dirname, '..'));
features.config = {
    engine: resolved.engine,
    modules: resolved.modules,
    configFile: resolved.configFile
};

module.exports = features;
