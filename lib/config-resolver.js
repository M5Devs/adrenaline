'use strict';

/**
 * Modular Config Stripping Engine
 *
 * Reads `adrenaline.config.js` from the project root and resolves it into a
 * normalized description of the runtime that should be produced. The resolver
 * is intentionally dependency-free and never throws: callers (node-gyp, the
 * CEF setup script and the runtime) all rely on it to degrade gracefully to the
 * conservative defaults.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CONFIG_FILENAMES = ['adrenaline.config.js', 'adrenaline.config.cjs', 'adrenaline.config.json'];

const DEFAULT_MODULES = {
  devtools: true,
  webrtc: true,
  pdf: false,
  cleanPrivacy: false,
  localFiles: true,
  // Off by default: the CEF engine runs with `disable-gpu`, so the SwiftShader /
  // Vulkan software rasterizers are never loaded and are pruned from the shipped
  // distribution. Opt back in for a hardware/software-GL build.
  softwareRasterizer: false
};

const DEFAULT_CONFIG = {
  engine: 'webview',
  modules: { ...DEFAULT_MODULES }
};

// Engines the resolver understands. `webview` and `cef` ship with Adrenaline;
// `webgtk` links the sister project (github.com/M5Devs/webgtk). An unknown
// engine degrades to `webview` so a typo never produces an unbuildable define.
const SUPPORTED_ENGINES = ['webview', 'cef', 'webgtk'];

// Assets that can be physically removed from a CEF distribution when the
// matching module is disabled. Paths are relative to the CEF root.
const ASSET_STRIP_RULES = {
  devtools: [
    'devtools_resources.pak',
    'Resources/devtools_resources.pak',
    'devtools',
    'Resources/devtools',
    'Resources/inspector'
  ],
  pdf: [
    'pdf',
    'Resources/pdf',
    'pdf_resources.pak',
    'Resources/pdf_resources.pak'
  ]
};

// The heavy software graphics stack. `disable-gpu` (set by the CEF engine)
// means these libraries are never loaded at runtime, so by default they are
// dropped from the shipped distribution. Set `softwareRasterizer: true` in
// adrenaline.config.js (or `ADREN_MODULE_SOFTWARE_RASTERIZER=1`) to keep them
// for a build that renders through SwiftShader/Vulkan.
const SOFTWARE_RASTERIZER_RULE = 'softwareRasterizer';
const SOFTWARE_RASTERIZER_ASSETS = [
  'Release/libvk_swiftshader.so',
  'Release/vk_swiftshader_icd.json',
  'Release/libvulkan.so.1'
];

function projectRoot(cwd) {
  return cwd || process.cwd();
}

function configPath(cwd) {
  const root = projectRoot(cwd);
  for (const name of CONFIG_FILENAMES) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function coerceBool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
}

function loadRawConfig(cwd) {
  const file = configPath(cwd);
  if (!file) return {};
  try {
    // `delete require.cache` so long-lived processes pick up config edits.
    delete require.cache[require.resolve(file)];
    const loaded = require(file);
    return loaded && typeof loaded === 'object' ? loaded : {};
  } catch (err) {
    process.stderr.write(`[adrenaline] Failed to read ${path.basename(file)}: ${err.message}\n`);
    return {};
  }
}

/**
 * Resolve the effective configuration: defaults merged with the on-disk config
 * and any environment overrides (`ADREN_ENGINE`, `ADREN_MODULE_<NAME>`).
 */
function resolve(cwd) {
  const raw = loadRawConfig(cwd);
  const rawModules = raw.modules && typeof raw.modules === 'object' ? raw.modules : {};

  const modules = {};
  for (const key of Object.keys(DEFAULT_MODULES)) {
    modules[key] = coerceBool(rawModules[key], DEFAULT_MODULES[key]);
  }

  for (const key of Object.keys(DEFAULT_MODULES)) {
    const envName = 'ADREN_MODULE_' + key.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase();
    if (process.env[envName] !== undefined) {
      modules[key] = coerceBool(process.env[envName], modules[key]);
    }
  }

  let engine = raw.engine || DEFAULT_CONFIG.engine;
  if (process.env.ADREN_ENGINE) {
    engine = process.env.ADREN_ENGINE;
  }
  engine = String(engine).toLowerCase();
  if (!SUPPORTED_ENGINES.includes(engine)) {
    process.stderr.write(`[adrenaline] Unknown engine "${engine}"; falling back to webview.\n`);
    engine = DEFAULT_CONFIG.engine;
  }

  return { engine, modules, configFile: configPath(cwd) };
}

/**
 * Space separated `KEY=VALUE` defines consumed by binding.gyp via `<!@(...)`.
 * Only the switches that influence compiled-in behaviour are emitted here;
 * devtools/pdf asset elimination happens physically at setup time.
 */
function gypDefines(cwd) {
  const { engine, modules } = resolve(cwd);
  const defs = [
    `ADREN_FEATURE_WEBRTC=${modules.webrtc ? 1 : 0}`,
    `ADREN_FEATURE_CLEAN_PRIVACY=${modules.cleanPrivacy ? 1 : 0}`,
    `ADREN_FEATURE_PDF=${modules.pdf ? 1 : 0}`,
    `ADREN_FEATURE_DEVTOOLS=${modules.devtools ? 1 : 0}`,
    // Exactly one engine is compiled in. binding.gyp selects the matching
    // sources/libraries from the same resolved engine.
    `ADREN_FEATURE_CEF=${engine === 'cef' ? 1 : 0}`,
    `ADREN_FEATURE_WEBVIEW=${engine === 'webview' ? 1 : 0}`,
    `ADREN_FEATURE_WEBGTK=${engine === 'webgtk' ? 1 : 0}`
  ];
  return defs.join(' ');
}

function directorySize(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += directorySize(full);
    } else if (entry.isFile()) {
      try {
        total += fs.statSync(full).size;
      } catch (err) {
        /* file vanished mid-walk */
      }
    }
  }
  return total;
}

/**
 * Physically delete assets that the configuration marks as unrequested.
 * Returns the list of removed paths and the number of bytes reclaimed.
 */
function applyAssetStripping(cefRoot, cwd) {
  const { modules } = resolve(cwd);
  const removed = [];
  let savedBytes = 0;

  const rules = Object.entries(ASSET_STRIP_RULES);
  if (!modules[SOFTWARE_RASTERIZER_RULE]) {
    rules.push([SOFTWARE_RASTERIZER_RULE, SOFTWARE_RASTERIZER_ASSETS]);
  }

  for (const [moduleName, targets] of rules) {
    if (modules[moduleName]) continue;
    for (const rel of targets) {
      const target = path.join(cefRoot, rel);
      if (!fs.existsSync(target)) continue;
      const size = directorySize(target);
      const stat = fs.statSync(target);
      const bytes = stat.isDirectory() ? size : stat.size;
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(rel);
      savedBytes += bytes;
    }
  }

  return { removed, savedBytes };
}

/**
 * Strip debug/unneeded symbols from an ELF binary with `strip --strip-unneeded`.
 *
 * `--strip-unneeded` removes the `.debug_*` sections *and* the `.symtab` (and
 * any symbols a relocation no longer needs) while preserving `.dynsym`, which
 * the dynamic linker reads. For a stripped CEF `libcef.so` that is hundreds of
 * megabytes of debug info no end user ever reads. Idempotent: a second run
 * reclaims nothing. Returns the byte delta (0 when `strip` is unavailable or the
 * file was already stripped) so callers can report it.
 */
function stripBinary(file) {
  if (!fs.existsSync(file)) {
    return { stripped: false, savedBytes: 0 };
  }
  const before = fs.statSync(file).size;
  // `strip` and `llvm-strip` are interchangeable; prefer GNU strip.
  const candidates = ['strip', 'llvm-strip'];
  for (const tool of candidates) {
    const res = spawnSync(tool, ['--strip-unneeded', file], { stdio: 'ignore' });
    if (res.error || res.status !== 0) continue;
    const after = fs.statSync(file).size;
    return { stripped: after < before, savedBytes: Math.max(0, before - after) };
  }
  return { stripped: false, savedBytes: 0 };
}

/**
 * Strip debug symbols from a native addon (`adrenaline.node`). Separate from the
 * CEF distribution stripping because the addon is a build artifact, not part of
 * the vendored CEF tree.
 */
function stripNativeAddon(addonPath) {
  return stripBinary(addonPath);
}

/**
 * Runtime counterpart of `applyAssetStripping` used on a packaged distribution
 * bundle (the folder that ships next to the native addon).
 */
function stripRuntimeAssets(distDir, cwd) {
  return applyAssetStripping(distDir, cwd);
}

function mb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

module.exports = {
  DEFAULT_CONFIG,
  DEFAULT_MODULES,
  SUPPORTED_ENGINES,
  ASSET_STRIP_RULES,
  SOFTWARE_RASTERIZER_RULE,
  SOFTWARE_RASTERIZER_ASSETS,
  resolve,
  loadRawConfig,
  gypDefines,
  applyAssetStripping,
  stripRuntimeAssets,
  stripBinary,
  stripNativeAddon,
  directorySize,
  configPath,
  mb
};
