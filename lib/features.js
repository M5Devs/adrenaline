const native = require('../build/Release/adrenaline.node');

let features;
if (native && typeof native.getCompiledFeatures === 'function') {
    features = native.getCompiledFeatures();
} else {
    features = {
        devtools: true,
        localFiles: true,
        pdf: false,
        cef: false,
        webview: true
    };
}

module.exports = features;
