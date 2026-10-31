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

const CONFIG_FILENAMES = ['adrenaline.config.js', 'adrenaline.config.cjs', 'adrenaline.config.json'];

const DEFAULT_MODULES = {
  devtools: true,
  webrtc: true,
  pdf: false,
  cleanPrivacy: false,
  localFiles: true
};

const DEFAULT_CONFIG = {
  engine: 'webview',
  modules: { ...DEFAULT_MODULES }
};

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

  return { engine, modules, configFile: configPath(cwd) };
}

/**
 * Space separated `KEY=VALUE` defines consumed by binding.gyp via `<!@(...)`.
 * Only the switches that influence compiled-in behaviour are emitted here;
 * devtools/pdf asset elimination happens physically at setup time.
 */
function gypDefines(cwd) {
  const { modules } = resolve(cwd);
  const defs = [
    `ADREN_FEATURE_WEBRTC=${modules.webrtc ? 1 : 0}`,
    `ADREN_FEATURE_CLEAN_PRIVACY=${modules.cleanPrivacy ? 1 : 0}`,
    `ADREN_FEATURE_PDF=${modules.pdf ? 1 : 0}`,
    `ADREN_FEATURE_DEVTOOLS=${modules.devtools ? 1 : 0}`
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

  for (const [moduleName, targets] of Object.entries(ASSET_STRIP_RULES)) {
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
  ASSET_STRIP_RULES,
  resolve,
  loadRawConfig,
  gypDefines,
  applyAssetStripping,
  stripRuntimeAssets,
  directorySize,
  configPath,
  mb
};
