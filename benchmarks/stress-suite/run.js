'use strict';

/*
 * Royal Rumble orchestrator.
 *
 * Runs the profiler against each of the five runtimes *sequentially* (never
 * concurrently, so no two ever compete for CPU), collects the disk footprint
 * for each, and writes the aggregated evidence to profiles-<runtime>.json.
 * report.js then turns that evidence into
 * benchmarks/ROYAL_RUMBLE_SHOWDOWN.md.
 *
 * Usage:
 *   node run.js                     # all five runtimes, 30s each
 *   node run.js electron nw         # a subset, in the given order
 *   STRESS_DURATION_MS=8000 node run.js   # shorter smoke run
 */

const fs = require('fs');
const path = require('path');
const { profileRun, measureFootprint } = require('./profiler');
const { ORDER, commandFor, footprintRuntimeFor, RUNTIMES } = require('./runtimes');

const SUITE_DIR = __dirname;
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function rm(p) { try { fs.unlinkSync(p); } catch (e) { /* ignore */ } }

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* ignore */ } }

function cleanupStaleArtifacts(runtime) {
  rm(path.join(SUITE_DIR, `results-${runtime}.json`));
  rm(path.join(SUITE_DIR, `phase-${runtime}.json`));
}

/** Remove transient per-run state a runtime leaves behind (e.g. the CEF cache). */
function cleanupRuntime(spec) {
  if (spec && spec.cacheDir) rmrf(spec.cacheDir);
}

async function runOne(runtime, durationMs, intervalMs) {
  cleanupStaleArtifacts(runtime);
  const resultFile = path.join(SUITE_DIR, `results-${runtime}.json`);
  const phaseFile = path.join(SUITE_DIR, `phase-${runtime}.json`);
  const spec = commandFor(runtime, { repoRoot: REPO_ROOT, suiteDir: SUITE_DIR });

  console.error(`\n=== Profiling ${runtime} (${spec.label}) for ${durationMs / 1000}s ===`);
  const profile = await profileRun({
    runtime,
    repoRoot: REPO_ROOT,
    durationMs,
    intervalMs,
    resultFile,
    phaseFile,
    command: spec.command,
    runCwd: spec.cwd,
    env: {
      STRESS_RESULT_FILE: resultFile,
      STRESS_PHASE_FILE: phaseFile,
      STRESS_DURATION_MS: String(durationMs),
      ...spec.env,
    },
  });

  const footprint = measureFootprint(footprintRuntimeFor(runtime), { repoRoot: REPO_ROOT });
  cleanupRuntime(spec);
  const evidence = { runtime, label: spec.label, profile, footprint, generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(SUITE_DIR, `profiles-${runtime}.json`), JSON.stringify(evidence, null, 2));
  return evidence;
}

async function main() {
  const durationMs = Number(process.env.STRESS_DURATION_MS || 30000);
  const intervalMs = Number(process.env.STRESS_INTERVAL_MS || 500);
  const requested = process.argv.slice(2);
  const runtimes = requested.length ? requested : ORDER;

  for (const rt of runtimes) {
    if (!RUNTIMES[rt]) {
      console.error('Unknown runtime "' + rt + '". Known: ' + Object.keys(RUNTIMES).join(', '));
      process.exit(2);
    }
  }

  const combinedPath = path.join(SUITE_DIR, 'profiles-combined.json');
  let combined = {};
  if (fs.existsSync(combinedPath)) {
    try { combined = JSON.parse(fs.readFileSync(combinedPath, 'utf8')); } catch (e) { combined = {}; }
  }

  let failed = 0;
  for (const rt of runtimes) {
    try {
      const evidence = await runOne(rt, durationMs, intervalMs);
      combined[rt] = evidence;
      fs.writeFileSync(combinedPath, JSON.stringify(combined, null, 2));
    } catch (e) {
      failed++;
      console.error('Run for ' + rt + ' failed: ' + (e && e.stack ? e.stack : e));
    }
  }

  console.error('\nEvidence written to ' + combinedPath);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
