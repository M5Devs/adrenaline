'use strict';

/**
 * Adrenaline.js Modular Config Stripping Engine
 *
 * Everything not requested here is eliminated from the runtime bundle. The
 * config is consumed by:
 *   - lib/config-resolver.js  -> normalize + drive the native build defines
 *   - scripts/setup-cef.js    -> physically prune unrequested distribution assets
 *   - scripts/strip-runtime.js-> prune an already-packaged distribution
 *   - src/cef/adrenaline_app.cpp -> compile-time command line switches
 */
module.exports = {
  // 'webview' (system WebView, lightest), 'cef' (pruned Chromium, consistent)
  // or 'webgtk' (custom GTK3/GTK4 Blink/V8 OSR view from M5Devs/webgtk).
  engine: 'cef',
  modules: {
    devtools: false,          // Drop devtools resources (devtools_resources.pak, etc.)
    webrtc: false,            // Disable & isolate WebRTC
    pdf: false,               // Strip PDF support
    cleanPrivacy: true,       // Enforce ungoogled flags
    // The engine runs with `disable-gpu`, so the SwiftShader/Vulkan software
    // rasterizers (libvk_swiftshader.so, libvulkan.so.1, vk_swiftshader_icd.json)
    // are never loaded. Set true only for a build that renders through them.
    softwareRasterizer: false
  }
};
