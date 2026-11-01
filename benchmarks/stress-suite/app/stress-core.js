'use strict';

/*
 * Runtime-agnostic stress core.
 *
 * The heavy workload (idle window, 100 packets/s IPC storm with per-packet
 * round-trip timing, and N forked SHA-256 CPU workers) is defined once here and
 * driven through a tiny transport interface, so all five runtimes execute the
 * exact same logic and only the IPC binding differs:
 *
 *   transport.on(channel, handler)   register a handler for messages *from* the UI
 *   transport.send(channel, data)    deliver a message *to* the UI
 *
 * Electron and Adrenaline.js adapt their ipcMain/webContents; NW.js adapts its
 * background-page <-> window bridge; Neutralinojs adapts its extension
 * WebSocket. See app/backend.js for the Electron/Adrenaline adapter.
 *
 * Protocol (UI -> backend):
 *   'first-paint'  : first DOM paint happened (startup metric)
 *   'render-ready' : initial dataset rendered and view is live
 *   'ipc-ack'      : round-trip acknowledgement
 *   'render-stats' : periodic renderer telemetry
 * Backend -> UI:
 *   'stress-start' : begin the heavy workload now
 */

const path = require('path');
const { fork } = require('child_process');
const { CONFIG } = require('./config');

const SECTORS = ['TECH', 'FIN', 'ENGY', 'HLTH', 'INDU', 'UTIL', 'MATL', 'CONS'];
const IDLE_WINDOW_MS = 2500;

function createStressCore(opts) {
  const { transport, log } = opts;
  const say = typeof log === 'function' ? log : () => {};
  const onPhase = typeof opts.onPhase === 'function' ? opts.onPhase : () => {};

  const latencies = [];
  const pending = new Map();
  let seq = 0;
  let acked = 0;
  let firstPaintAt = null;
  let stressStartAt = null;
  let running = true;
  const workers = [];
  let hashBlocks = 0;
  let hashBytes = 0;

  const result = {
    runtime: opts.runtime,
    config: CONFIG,
    idleWindowMs: IDLE_WINDOW_MS,
    latencies: [],
    stats: {},
  };

  function sendPacket() {
    const s = seq++;
    const metrics = new Array(16);
    for (let i = 0; i < 16; i++) metrics[i] = Math.round((10 + Math.random() * 900) * 100) / 100;
    const payload = {
      seq: s,
      t: Date.now(),
      symbol: SECTORS[s % SECTORS.length] + (s % 1000),
      metrics,
      sensor: { temp: 20 + Math.random() * 60, pressure: 900 + Math.random() * 200, rpm: 1000 + Math.random() * 9000 },
    };
    pending.set(s, process.hrtime.bigint());
    transport.send('ipc-data', payload);
  }

  transport.on('ipc-ack', (data) => {
    if (!data || typeof data.seq !== 'number') return;
    const sent = pending.get(data.seq);
    if (sent === undefined) return;
    pending.delete(data.seq);
    latencies.push(Number(process.hrtime.bigint() - sent) / 1e6);
    acked++;
  });

  transport.on('first-paint', (data) => {
    if (firstPaintAt === null) {
      firstPaintAt = Date.now();
      result.stats.firstPaintIpcAt = data && data.t;
      say('first-paint received');
      onPhase('ready');
    }
  });

  transport.on('render-ready', () => {
    say('render-ready received; entering idle window');
    onPhase('idle');
    setTimeout(() => {
      if (!running) return;
      stressStartAt = Date.now();
      result.stats.stressStartAt = stressStartAt;
      say('stress-start dispatched');
      onPhase('stress');
      transport.send('stress-start', { t: Date.now() });
      beginStorm();
    }, IDLE_WINDOW_MS);
  });

  transport.on('render-stats', (data) => {
    result.stats.lastRenderStats = data;
    say('render-stats ' + JSON.stringify(data));
  });

  function startWorkers() {
    const workerPath = path.join(__dirname, 'hash-worker.js');
    for (let i = 0; i < CONFIG.hashWorkers; i++) {
      const w = fork(workerPath, [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
      w.on('message', (msg) => {
        if (msg && msg.type === 'hash-progress') { hashBlocks = msg.blocksHashed; hashBytes = msg.bytesHashed; }
      });
      workers.push(w);
    }
  }

  let stormTimer = null;
  let statsTimer = null;

  function beginStorm() {
    if (stormTimer) return;
    // CPU workers are started *here*, not at boot, so the idle baseline the
    // profiler samples is free of both the IPC storm and the hashing load.
    startWorkers();
    const interval = Math.round(1000 / CONFIG.ipcRateHz);
    stormTimer = setInterval(sendPacket, interval);
    statsTimer = setInterval(() => {
      say('progress packets=' + seq + ' acked=' + acked + ' pending=' + pending.size + ' hashed=' + hashBlocks);
    }, 5000);
  }

  function finish() {
    if (!running) return result;
    running = false;
    if (stormTimer) clearInterval(stormTimer);
    if (statsTimer) clearInterval(statsTimer);

    for (const w of workers) {
      try { w.send({ type: 'stop' }); } catch (e) { /* ignore */ }
    }

    const sorted = latencies.slice().sort((a, b) => a - b);
    const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);
    const mean = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null;

    result.latencies = latencies;
    result.stats.ipcPacketsSent = seq;
    result.stats.ipcPacketsAcked = acked;
    result.stats.ipcPacketsUnacked = pending.size;
    result.stats.ipcLatency = {
      mean,
      min: sorted.length ? sorted[0] : null,
      max: sorted.length ? sorted[sorted.length - 1] : null,
      p50: pct(50), p90: pct(90), p95: pct(95), p99: pct(99),
      samples: sorted.length,
    };
    result.stats.hash = { blocks: hashBlocks, bytes: hashBytes, workers: workers.length };
    result.stats.firstPaintAtMs = firstPaintAt;

    for (const w of workers) {
      try { w.kill('SIGTERM'); } catch (e) { /* ignore */ }
    }
    return result;
  }

  return { result, finish };
}

module.exports = { createStressCore };
