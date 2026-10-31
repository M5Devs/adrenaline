'use strict';

/*
 * Runtime-agnostic runner harness.
 *
 * Both electron-runner.js and adrenaline-runner.js use this so that the only
 * thing that differs between them is which module provides `app`,
 * `BrowserWindow` and `ipcMain`. It owns:
 *   - the boot timestamps used for the startup-to-first-paint metric;
 *   - the phase marker file the profiler watches ('boot' -> 'idle' -> 'stress'
 *     -> 'done') so it can isolate an uncontaminated idle baseline;
 *   - result serialisation and the exit ladder.
 */

const fs = require('fs');
const path = require('path');
const { CONFIG } = require('./config');

function createHarness(opts) {
  const {
    runtime,
    resultFile = path.join(__dirname, '..', `results-${runtime}.json`),
    phaseFile = path.join(__dirname, '..', `phase-${runtime}.json`),
    // The profiler passes the same value it samples for, so the runner's stress
    // window and the profiler's sampling window always agree.
    durationMs = Number(process.env.STRESS_DURATION_MS || CONFIG.ipcDurationMs),
  } = opts;

  const bootEpoch = Date.now();
  const bootHrMs = Number(process.hrtime.bigint() / 1000000n);

  let stress = null;
  let finished = false;
  let firstPaintEpoch = null;
  let stressStartEpoch = null;

  const log = (msg) => process.stderr.write('[runner] ' + msg + '\n');

  const phaseState = { runtime, bootEpoch, bootHrMs, phase: 'boot' };

  function setPhase(phase, extra) {
    phaseState.phase = phase;
    phaseState.updatedEpoch = Date.now();
    if (extra) Object.assign(phaseState, extra);
    try { fs.writeFileSync(phaseFile, JSON.stringify(phaseState)); } catch (e) { /* ignore */ }
  }

  function onPhase(phase) {
    if (phase === 'ready') {
      if (firstPaintEpoch === null) firstPaintEpoch = Date.now();
      setPhase('idle', { firstPaintEpoch, startupMs: firstPaintEpoch - bootEpoch });
    } else if (phase === 'idle') {
      setPhase('idle', { firstPaintEpoch });
    } else if (phase === 'stress') {
      stressStartEpoch = Date.now();
      setPhase('stress', { stressStartEpoch });
    }
  }

  function attach(stressObj) { stress = stressObj; }

  function writeResult() {
    const result = stress ? stress.finish() : { stats: {} };
    result.runtime = runtime;
    result.timing = {
      bootEpoch,
      bootHrMs,
      firstPaintEpoch,
      startupMs: firstPaintEpoch ? firstPaintEpoch - bootEpoch : null,
      stressStartEpoch,
      finishedEpoch: Date.now(),
      stressDurationMs: stressStartEpoch ? Date.now() - stressStartEpoch : null,
    };
    try {
      fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
      log('result written to ' + resultFile);
    } catch (e) {
      log('failed to write result: ' + e.message);
    }
    return result;
  }

  function finish(exitFn) {
    if (finished) return;
    finished = true;
    writeResult();
    setPhase('done', { startupMs: firstPaintEpoch ? firstPaintEpoch - bootEpoch : null });
    setTimeout(() => {
      try { exitFn(); } catch (e) { process.exit(0); }
    }, 250);
  }

  return {
    runtime,
    resultFile,
    phaseFile,
    durationMs,
    bootEpoch,
    log,
    setPhase,
    onPhase,
    attach,
    finish,
    writeResult,
    get firstPaintEpoch() { return firstPaintEpoch; },
    get stressStartEpoch() { return stressStartEpoch; },
    get finished() { return finished; },
  };
}

module.exports = { createHarness };
