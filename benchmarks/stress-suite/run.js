'use strict';

/*
 * Benchmark orchestrator.
 *
 * Runs the profiler against each runtime sequentially (never concurrently, so
 * the two never compete for CPU), collects the disk footprint for each, and
 * writes the aggregated evidence to profiles-<runtime>.json. report.js then
 * turns that evidence into benchmarks/STRESS_TEST.md.
 *
 * Usage:
 *   node run.js                 # both runtimes, 30s each
 *   node run.js adrenaline      # one runtime
 *   STRESS_DURATION_MS=8000 node run.js   # shorter smoke run
 */

const fs = require('fs');
const path = require('path');
const { profileRun, measureFootprint } = require('./profiler');

const SUITE_DIR = __dirname;
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Resolve the launcher for each runtime:
 *   adrenaline -> the `node` binary running this script
 *   electron   -> node_modules/electron/dist/electron (via electron/path.txt)
 */
function launcherFor(runtime) {
  if (runtime === 'electron') {
    const electronPkg = path.join(REPO_ROOT, 'node_modules', 'electron');
    const rel = fs.readFileSync(path.join(electronPkg, 'path.txt'), 'utf8').trim();
    return path.join(electronPkg, 'dist', rel);
  }
  return process.execPath;
}

function rm(p) { try { fs.unlinkSync(p); } catch (e) { /* ignore */ } }

function cleanupStaleArtifacts(runtime) {
  rm(path.join(SUITE_DIR, `results-${runtime}.json`));
  rm(path.join(SUITE_DIR, `phase-${runtime}.json`));
}

async function runOne(runtime, durationMs, intervalMs) {
  cleanupStaleArtifacts(runtime);
  const runnerPath = path.join(SUITE_DIR, runtime === 'electron' ? 'electron-runner.js' : 'adrenaline-runner.js');
  const resultFile = path.join(SUITE_DIR, `results-${runtime}.json`);
  const phaseFile = path.join(SUITE_DIR, `phase-${runtime}.json`);

  console.error(`\n=== Profiling ${runtime} for ${durationMs / 1000}s ===`);
  const profile = await profileRun({
    runtime,
    runnerPath,
    repoRoot: REPO_ROOT,
    durationMs,
    intervalMs,
    resultFile,
    phaseFile,
    launcher: launcherFor(runtime),
    extraArgs: runtime === 'electron' ? ['--no-sandbox', '--disable-gpu'] : [],
    env: {
      STRESS_RESULT_FILE: resultFile,
      STRESS_PHASE_FILE: phaseFile,
      STRESS_DURATION_MS: String(durationMs),
    },
  });

  const footprint = measureFootprint(runtime, { repoRoot: REPO_ROOT });
  const evidence = { runtime, profile, footprint, generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(SUITE_DIR, `profiles-${runtime}.json`), JSON.stringify(evidence, null, 2));
  return evidence;
}

async function main() {
  const arg = process.argv[2];
  const durationMs = Number(process.env.STRESS_DURATION_MS || 30000);
  const intervalMs = Number(process.env.STRESS_INTERVAL_MS || 500);
  const runtimes = arg ? [arg] : ['adrenaline', 'electron'];

  const evidence = {};
  for (const rt of runtimes) {
    evidence[rt] = await runOne(rt, durationMs, intervalMs);
  }

  // Merge into a single combined file for the report generator.
  const combinedPath = path.join(SUITE_DIR, 'profiles-combined.json');
  let combined = {};
  if (fs.existsSync(combinedPath)) {
    try { combined = JSON.parse(fs.readFileSync(combinedPath, 'utf8')); } catch (e) { combined = {}; }
  }
  Object.assign(combined, evidence);
  fs.writeFileSync(combinedPath, JSON.stringify(combined, null, 2));
  console.error('\nEvidence written to ' + combinedPath);
}

main().catch((e) => { console.error(e); process.exit(1); });
