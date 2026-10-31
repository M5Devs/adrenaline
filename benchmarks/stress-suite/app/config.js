'use strict';

// Single source of truth for the stress workload. Shared byte-for-byte by the
// Adrenaline.js and Electron runners so both runtimes execute identical work.
const CONFIG = {
  records: 10000,
  visibleRows: 40,
  ipcRateHz: 100,
  ipcDurationMs: 30000,
  hashWorkers: 2,
  hashBlockBytes: 8192,
  hashMaxBlocksPerTick: 64,
  mutateBatch: 250,
  mutateIntervalMs: 100,
  sortIntervalMs: 1000,
  searchIntervalMs: 1500,
  themeIntervalMs: 750,
  metricHistory: 240,
};

module.exports = { CONFIG };
