'use strict';

// CPU stress worker. Continuously SHA-256 hashes a fixed-size block, chaining
// each digest into the next so the loop can never be optimized away or served
// from a cache. Runs on the Node.js main event loop in a dedicated child
// process, which is what lets the profiler measure per-process CPU saturation
// and lets the runtime demonstrate (or avoid) event-loop starvation.
const crypto = require('crypto');
const { CONFIG } = require('./config');

let block = crypto.randomBytes(CONFIG.hashBlockBytes);
let blocksHashed = 0;
let bytesHashed = 0;

function tick() {
  const start = Date.now();
  // Hash as fast as possible until this slot is nearly used up, then yield so
  // the scheduler can still deliver IPC messages (a true starvation test).
  while (Date.now() - start < 5) {
    for (let i = 0; i < CONFIG.hashMaxBlocksPerTick; i++) {
      block = crypto.createHash('sha256').update(block).digest();
      blocksHashed++;
      bytesHashed += CONFIG.hashBlockBytes;
    }
  }
  process.send({ type: 'hash-progress', blocksHashed, bytesHashed });
  setImmediate(tick);
}

process.on('message', (msg) => {
  if (msg && msg.type === 'stop') {
    process.send({ type: 'hash-final', blocksHashed, bytesHashed });
    process.exit(0);
  }
});

process.send({ type: 'hash-ready', pid: process.pid });
tick();
