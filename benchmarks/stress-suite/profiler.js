'use strict';

/*
 * Task-manager style profiler.
 *
 * Spawns a runtime runner under `xvfb-run -a` and samples the *entire* process
 * tree every `intervalMs` for 30 seconds of sustained stress. The two headline
 * memory numbers are taken from /proc/[pid]/smaps_rollup so that shared pages
 * are counted once across the tree:
 *
 *   PSS = sum of each process' Pss.  A page shared by N processes contributes
 *         1/N to each, so summing Pss over the tree counts it exactly once.
 *   Private = sum of Private_Clean + Private_Dirty.  This is the portion that
 *         cannot be shared with any other process at all (the "unique" cost).
 *
 * Naive RSS is intentionally *not* used for the headline: summing Rss across a
 * Chromium/WebKit tree double-counts every shared framework .so, inflating the
 * baseline by hundreds of megabytes.
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const CLK_TCK = 100; // getconf CLK_TCK on Linux

function log(msg) {
  process.stderr.write('[profiler] ' + msg + '\n');
}

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}

// ---- process tree ---------------------------------------------------------

/**
 * Snapshot every process in one pass.
 *
 * We deliberately do NOT use /proc/[pid]/task/[pid]/children to walk the tree:
 * that file is *per-thread*, so a child forked from a non-main thread (which is
 * exactly how WebKitGTK spawns WebKitNetworkProcess / WebKitWebProcess) never
 * appears under task/<pid>/children even though its PPID is the runner. A
 * single full /proc scan keyed on the stat PPID field is both correct and, at
 * this tree size, cheaper than re-reading stat twice per pid.
 */
function scanProc() {
  const map = new Map();
  let entries = [];
  try { entries = fs.readdirSync('/proc'); } catch (e) { return map; }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    const stat = readFileSafe(`/proc/${pid}/stat`);
    if (!stat) continue;
    const rp = stat.lastIndexOf(')');
    if (rp < 0) continue;
    const comm = stat.slice(stat.indexOf('(') + 1, rp);
    const rest = stat.slice(rp + 2).split(' ');
    map.set(pid, {
      pid,
      comm,
      state: rest[0],
      ppid: Number(rest[1]),   // field 4 overall
      pgrp: Number(rest[2]),   // field 5 overall
      utime: Number(rest[11]), // field 14 overall
      stime: Number(rest[12]), // field 15 overall
      starttime: Number(rest[19]), // field 22 overall
    });
  }
  return map;
}

/** Descendants of `rootPid` (inclusive) from a scanProc() snapshot. */
function collectTreeFrom(map, rootPid) {
  const childrenOf = new Map();
  for (const p of map.values()) {
    if (!childrenOf.has(p.ppid)) childrenOf.set(p.ppid, []);
    childrenOf.get(p.ppid).push(p.pid);
  }
  const seen = new Set();
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    const kids = childrenOf.get(pid);
    if (kids) for (const c of kids) stack.push(c);
  }
  return Array.from(seen);
}

function collectTree(rootPid) {
  return collectTreeFrom(scanProc(), rootPid);
}

// ---- per-process metrics --------------------------------------------------

function smapsRollup(pid) {
  const txt = readFileSafe(`/proc/${pid}/smaps_rollup`);
  if (!txt) {
    // Older kernels: fall back to summing smaps.
    return smapsFallback(pid);
  }
  const m = {};
  for (const line of txt.split('\n')) {
    const mm = /^([A-Za-z_]+):\s+(\d+)\s+kB$/.exec(line.trim());
    if (mm) m[mm[1]] = Number(mm[2]);
  }
  return {
    rss: m.Rss || 0,
    pss: m.Pss || 0,
    privateClean: m.Private_Clean || 0,
    privateDirty: m.Private_Dirty || 0,
    sharedClean: m.Shared_Clean || 0,
    sharedDirty: m.Shared_Dirty || 0,
    swapPss: m.SwapPss || 0,
  };
}

function smapsFallback(pid) {
  const txt = readFileSafe(`/proc/${pid}/smaps`);
  if (!txt) return null;
  const acc = { rss: 0, pss: 0, privateClean: 0, privateDirty: 0, sharedClean: 0, sharedDirty: 0, swapPss: 0 };
  for (const line of txt.split('\n')) {
    const mm = /^([A-Za-z_]+):\s+(\d+)\s+kB$/.exec(line.trim());
    if (!mm) continue;
    const k = mm[1], v = Number(mm[2]);
    if (k === 'Rss') acc.rss += v;
    else if (k === 'Pss') acc.pss += v;
    else if (k === 'Private_Clean') acc.privateClean += v;
    else if (k === 'Private_Dirty') acc.privateDirty += v;
    else if (k === 'Shared_Clean') acc.sharedClean += v;
    else if (k === 'Shared_Dirty') acc.sharedDirty += v;
    else if (k === 'SwapPss') acc.swapPss += v;
  }
  return acc;
}

function sampleTree(rootPid) {
  const snapshot = scanProc();
  const pids = collectTreeFrom(snapshot, rootPid);
  const procs = [];
  let pss = 0, priv = 0, rss = 0, shared = 0;
  for (const pid of pids) {
    const st = snapshot.get(pid);
    if (!st || st.state === 'Z') continue; // zombies hold no memory
    const mem = smapsRollup(pid);
    if (!mem) continue;
    pss += mem.pss;
    priv += mem.privateClean + mem.privateDirty;
    rss += mem.rss;
    shared += mem.sharedClean + mem.sharedDirty;
    procs.push({
      pid,
      comm: st.comm,
      pssKb: mem.pss,
      privateKb: mem.privateClean + mem.privateDirty,
      rssKb: mem.rss,
      sharedKb: mem.sharedClean + mem.sharedDirty,
      swapPssKb: mem.swapPss,
      cpuTicks: st.utime + st.stime,
    });
  }
  return { pids, procs, pssKb: pss, privateKb: priv, rssKb: rss, sharedKb: shared };
}

// ---- runtime disk footprint ----------------------------------------------

function duBytes(dir) {
  const r = spawnSync('du', ['-sk', dir], { encoding: 'utf8' });
  if (r.status !== 0) return 0;
  const kb = parseInt(r.stdout.trim().split(/\s+/)[0], 10);
  return Number.isFinite(kb) ? kb * 1024 : 0;
}

function fileBytes(p) {
  try { return fs.statSync(p).size; } catch (e) { return 0; }
}

/**
 * Measure the *real uncompressed runtime footprint* that a shipped application
 * must carry on disk, excluding the application's own source and excluding the
 * shared OS packages that are already present on every machine.
 */
function measureFootprint(runtime, opts) {
  const root = opts.repoRoot;
  const suite = path.join(root, 'benchmarks', 'stress-suite');
  const components = [];
  const appDir = path.join(suite, 'app');

  const runnerBytes = (files) => files.reduce((a, f) => a + fileBytes(path.join(suite, f)), 0);
  const adrenalineCore = () => {
    components.push({ label: 'Node.js runtime binary (' + path.basename(process.execPath) + ')', bytes: fileBytes(process.execPath) });
    components.push({ label: 'adrenaline-js JS runtime (lib/ + index.js + index.mjs)', bytes: duBytes(path.join(root, 'lib')) + fileBytes(path.join(root, 'index.js')) + fileBytes(path.join(root, 'index.mjs')) });
    components.push({ label: 'application assets (app/)', bytes: duBytes(appDir) });
  };

  if (runtime === 'electron') {
    components.push({ label: 'electron/dist (Chromium + Node + ICU + V8 snapshots)', bytes: duBytes(path.join(root, 'node_modules', 'electron', 'dist')) });
    components.push({ label: 'application assets (app/)', bytes: duBytes(appDir) });
    components.push({ label: 'runner code', bytes: runnerBytes(['electron-runner.js', 'profiler.js', 'run.js', 'report.js']) });
  } else if (runtime === 'nw') {
    const nwDist = nwDistributionDir(root);
    components.push({ label: 'NW.js distribution (nw binary + libnw.so + Chromium + Node + ICU)', bytes: duBytes(nwDist) });
    components.push({ label: 'application assets (app/)', bytes: duBytes(appDir) });
    components.push({ label: 'runner code (nw-app/)', bytes: duBytes(path.join(suite, 'nw-app')) });
  } else if (runtime === 'neutralino') {
    components.push({ label: 'Neutralino binary (neutralino-linux_x64)', bytes: fileBytes(path.join(suite, 'neu-app', 'neutralino-linux_x64')) });
    components.push({ label: 'Neutralino client library (neutralino.js)', bytes: fileBytes(path.join(suite, 'neu-app', 'resources', 'neutralino.js')) });
    components.push({ label: 'application assets (app/)', bytes: duBytes(appDir) });
    components.push({ label: 'runner code (neu-app/ extensions)', bytes: duBytes(path.join(suite, 'neu-app', 'extensions')) + fileBytes(path.join(suite, 'neu-app', 'resources', 'neu-inject.js')) });
    // Neutralino delegates both the renderer (system WebView) and the backend
    // (the user's own runtime) to the OS; the backend here is Node.js.
    components.push({ label: 'Node.js runtime binary for the extension backend (' + path.basename(process.execPath) + ')', bytes: fileBytes(process.execPath) });
    const wk = sharedLibraryBytes(['libwebkit2gtk-4.1.so.0', 'libwebkit2gtk-4.0.so.0']);
    if (wk) components.push({ label: 'system WebKitGTK shared library (NOT shipped)', bytes: wk, shared: true });
  } else if (runtime === 'adrenaline-cef') {
    adrenalineCore();
    components.push({ label: 'adrenaline native addon (CEF engine)', bytes: fileBytes(path.join(root, '.bench-artifacts', 'adrenaline-cef.node')) });
    const cef = path.join(root, 'vendor', 'cef');
    components.push({ label: 'libcef.so (pruned Chromium, debug symbols stripped)', bytes: fileBytes(path.join(cef, 'Release', 'libcef.so')) });
    components.push({ label: 'libcef_dll_wrapper.a', bytes: fileBytes(path.join(cef, 'libcef_dll_wrapper', 'libcef_dll_wrapper.a')) });
    components.push({ label: 'icudtl.dat', bytes: fileBytes(path.join(cef, 'Release', 'icudtl.dat')) });
    components.push({ label: 'core .pak bundles + locales (pruned to en-US)', bytes: duBytes(path.join(cef, 'Resources')) + fileBytes(path.join(cef, 'Release', 'v8_context_snapshot.bin')) });
    components.push({ label: 'libEGL.so + libGLESv2.so + swiftshader/vulkan', bytes: fileBytes(path.join(cef, 'Release', 'libEGL.so')) + fileBytes(path.join(cef, 'Release', 'libGLESv2.so')) + fileBytes(path.join(cef, 'Release', 'libvk_swiftshader.so')) + fileBytes(path.join(cef, 'Release', 'libvulkan.so.1')) });
    components.push({ label: 'runner code', bytes: runnerBytes(['adrenaline-runner.js', 'profiler.js', 'run.js', 'report.js']) });
  } else {
    adrenalineCore();
    components.push({ label: 'adrenaline native addon (WebView engine)', bytes: fileBytes(path.join(root, '.bench-artifacts', 'adrenaline-webview.node')) });
    components.push({ label: 'runner code', bytes: runnerBytes(['adrenaline-runner.js', 'profiler.js', 'run.js', 'report.js']) });
    // The framework does not bundle WebKitGTK: it links the OS-provided shared
    // library, which is measured separately and clearly labelled as shared.
    const wk = sharedLibraryBytes(['libwebkit2gtk-4.1.so.0', 'libwebkit2gtk-4.0.so.0']);
    if (wk) components.push({ label: 'system WebKitGTK shared library (NOT shipped)', bytes: wk, shared: true });
  }

  const total = components.reduce((a, c) => a + c.bytes, 0);
  const shippedTotal = components.reduce((a, c) => a + (c.shared ? 0 : c.bytes), 0);
  return { runtime, components, total, shippedTotal };
}

function nwDistributionDir(root) {
  const base = path.join(root, 'node_modules', 'nw');
  try {
    const entry = fs.readdirSync(base).find((n) => n.startsWith('nwjs-'));
    if (entry) return path.join(base, entry);
  } catch (e) { /* ignore */ }
  return base;
}

function sharedLibraryBytes(names) {
  const r = spawnSync('ldconfig', ['-p'], { encoding: 'utf8' });
  if (r.status !== 0) return 0;
  for (const line of r.stdout.split('\n')) {
    for (const n of names) {
      if (line.includes(n)) {
        const m = /=>\s+(\S+)/.exec(line);
        if (m) return fileBytes(m[1]);
      }
    }
  }
  return 0;
}

// ---- main profiling run ---------------------------------------------------

/**
 * Kill the whole process group, not just the tree.
 *
 * We spawn the runner detached, so it becomes a process-group leader and every
 * descendant (xvfb-run, Xvfb, the Node backend, its SHA-256 workers, and the
 * WebKit/Chromium renderer processes) inherits that group id. Signalling the
 * group kills them all in one atomic step, which is what prevents grandchildren
 * from being orphaned and reparented to a PID 1 that may not reap them (leaving
 * zombies behind). A per-pid sweep follows as a belt-and-braces fallback.
 */
function killTree(rootPid, signal) {
  try { process.kill(-rootPid, signal); } catch (e) { /* group already gone */ }
  const pids = collectTree(rootPid);
  for (const pid of pids.slice().reverse()) {
    try { process.kill(pid, signal); } catch (e) { /* ignore */ }
  }
  try { process.kill(rootPid, signal); } catch (e) { /* ignore */ }
}

/** Every process whose process-group id is `pgid`. */
function groupMembers(pgid) {
  const out = [];
  for (const p of scanProc().values()) {
    if (p.pgrp === pgid) out.push({ pid: p.pid, state: p.state, comm: p.comm });
  }
  return out;
}

/** Count live (non-zombie) members of the group, plus any zombies. */
function groupLeftovers(pgid) {
  const members = groupMembers(pgid);
  return {
    total: members.length,
    live: members.filter((m) => m.state !== 'Z').length,
    zombies: members.filter((m) => m.state === 'Z').length,
    pids: members.map((m) => m.pid),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Compile (once) and return the path to the subreaper wrapper. Returns null if
 * no C compiler is available, in which case we fall back to launching the
 * command directly (correctness of the measurements is unaffected; only zombie
 * reaping of SIGKILLed orphans is).
 */
let _reaperPath;
function ensureReaper() {
  if (_reaperPath !== undefined) return _reaperPath;
  const src = path.join(__dirname, 'tools', 'reaper.c');
  const bin = path.join(__dirname, 'tools', 'reaper');
  if (!fs.existsSync(src)) { _reaperPath = null; return _reaperPath; }
  if (!fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(src).mtimeMs) {
    const cc = spawnSync('cc', ['-O2', '-o', bin, src], { encoding: 'utf8' });
    if (cc.status !== 0) {
      const cc2 = spawnSync('gcc', ['-O2', '-o', bin, src], { encoding: 'utf8' });
      if (cc2.status !== 0) {
        log('reaper build failed; running without subreaper: ' + (cc2.stderr || cc.stderr));
        _reaperPath = null;
        return _reaperPath;
      }
    }
  }
  _reaperPath = fs.existsSync(bin) ? bin : null;
  return _reaperPath;
}

function readPhase(phaseFile) {
  const txt = readFileSafe(phaseFile);
  if (!txt) return null;
  try { return JSON.parse(txt); } catch (e) { return null; }
}

async function profileRun(opts) {
  const {
    runtime,
    runnerPath,
    repoRoot,
    durationMs = 30000,
    intervalMs = 500,
    resultFile,
    phaseFile,
    // The runtime launcher: `node` for Adrenaline.js, the Electron binary for
    // Electron. `runnerPath` is appended, followed by extraArgs.
    launcher = process.execPath,
    extraArgs = [],
    // Explicit command form: [binary, ...args]. When given it replaces
    // `launcher` + `runnerPath` + `extraArgs`, which lets runtimes that are not
    // driven by Node (NW.js, Neutralinojs) be launched the same way.
    command = null,
    // Working directory for the runtime process (Neutralino needs its own).
    runCwd = null,
    env = {},
  } = opts;

  const xvfb = spawnSync('which', ['xvfb-run'], { encoding: 'utf8' });
  const useXvfb = xvfb.status === 0;

  // Everything runs under the subreaper wrapper so that SIGKILLed orphans are
  // re-parented to it (not to the container's non-reaping PID 1) and reaped.
  const reaperBin = ensureReaper();
  const appArgs = command || [launcher, runnerPath, ...extraArgs];
  const innerCmd = useXvfb ? 'xvfb-run' : appArgs[0];
  const innerArgs = useXvfb ? ['-a', ...appArgs] : appArgs.slice(1);
  const launchCmd = reaperBin || innerCmd;
  const launchArgs = reaperBin ? [innerCmd, ...innerArgs] : innerArgs;

  const startedAt = Date.now();
  const spawnHr = process.hrtime.bigint();

  const child = spawn(launchCmd, launchArgs, {
    cwd: runCwd || repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  const rootPid = child.pid;
  let stderrBuf = '';
  let stdoutBuf = '';
  child.stdout.on('data', (d) => { stdoutBuf += d.toString(); });
  child.stderr.on('data', (d) => { const s = d.toString(); stderrBuf += s; if (process.env.STRESS_VERBOSE) process.stderr.write('[child] ' + s); });

  let alive = true;
  child.on('exit', () => { alive = false; });

  const samples = [];
  let peak = { pssKb: 0, privateKb: 0, procs: [] };
  let idle = null;
  let lastCpu = null;
  const cpuSeries = [];
  let finishedResult = null;
  const treeSizeSeries = [];

  // Phase 1: wait for the renderer to finish booting ('idle' phase), then take
  // the idle baseline before any stress work begins.
  const idleSamples = [];
  const bootDeadline = Date.now() + 30000;
  while (alive && Date.now() < bootDeadline) {
    const ph = readPhase(phaseFile);
    const s = sampleTree(rootPid);
    if (s.procs.length && s.pssKb > 0) idleSamples.push(s);
    if (ph && (ph.phase === 'idle' || ph.phase === 'stress')) break;
    await sleep(intervalMs);
  }
  // Sample a little longer while genuinely idle.
  const idleUntil = Date.now() + 1500;
  while (alive && Date.now() < idleUntil) {
    const s = sampleTree(rootPid);
    if (s.procs.length && s.pssKb > 0) idleSamples.push(s);
    await sleep(intervalMs);
  }
  if (idleSamples.length) {
    // Median of the last few idle samples is more stable than min/max.
    const recent = idleSamples.slice(-5).sort((a, b) => a.pssKb - b.pssKb);
    idle = recent[Math.floor(recent.length / 2)];
  }

  // Phase 2: wait for the stress phase to begin, then sample for durationMs.
  const stressDeadline = Date.now() + 30000;
  while (alive && Date.now() < stressDeadline) {
    const ph = readPhase(phaseFile);
    if (ph && (ph.phase === 'stress' || ph.phase === 'done')) break;
    await sleep(100);
  }

  const stressStart = Date.now();
  while (alive && Date.now() - stressStart < durationMs) {
    const s = sampleTree(rootPid);
    if (s.procs.length) {
      samples.push(s);
      treeSizeSeries.push(s.procs.length);
      if (s.pssKb > peak.pssKb) peak = s;
      const totalTicks = s.procs.reduce((a, p) => a + (p.cpuTicks || 0), 0);
      const nowHr = process.hrtime.bigint();
      if (lastCpu) {
        const dtSec = Number(nowHr - lastCpu.hr) / 1e9;
        const dTicks = totalTicks - lastCpu.ticks;
        if (dtSec > 0) cpuSeries.push((dTicks / CLK_TCK) / dtSec * 100);
      }
      lastCpu = { hr: nowHr, ticks: totalTicks };
    }
    await sleep(intervalMs);
  }

  // Wait for the runner to write its result file. This must NOT be gated on
  // `alive`: the runner writes the file *while* shutting down, so the process
  // can already be gone by the time we look for it.
  let waited = 0;
  while (waited < 20000) {
    if (resultFile && fs.existsSync(resultFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
        if (parsed && parsed.stats && parsed.stats.ipcLatency) { finishedResult = parsed; break; }
      } catch (e) { /* partially written, retry */ }
    }
    if (!alive && waited > 2000) break;
    await sleep(200);
    waited += 200;
  }

  // Phase 3: graceful termination with an escalating signal ladder. The runner
  // normally exits on its own once the stress window ends, so this usually just
  // reaps the remaining renderer/xvfb children.
  const termStart = Date.now();
  const pgid = rootPid; // detached => the wrapper is its own group leader
  if (alive) killTree(rootPid, 'SIGTERM');

  // Give the group a generous window to drain. The subreaper wrapper stays alive
  // reaping orphans, so `live` naturally reaches 0 without a SIGKILL in the
  // common case. Killing it early would re-parent orphans to PID 1.
  let escalated = false;
  for (let i = 0; i < 80; i++) {
    if (groupLeftovers(pgid).live === 0) break;
    await sleep(100);
  }
  if (groupLeftovers(pgid).live > 0) {
    escalated = true;
    // SIGKILL everything *except* the subreaper first, let it reap, then kill it.
    for (const m of groupMembers(pgid)) {
      if (m.pid === rootPid) continue;
      try { process.kill(m.pid, 'SIGKILL'); } catch (e) { /* ignore */ }
    }
    await sleep(500);
    try { process.kill(rootPid, 'SIGKILL'); } catch (e) { /* ignore */ }
    for (let i = 0; i < 30; i++) {
      if (groupLeftovers(pgid).live === 0) break;
      await sleep(100);
    }
  }
  const termMs = Date.now() - termStart;

  // Phase 4: final sweep, then report exactly what (if anything) survived.
  await sleep(300);
  const leftovers = groupLeftovers(pgid);
  for (const pid of leftovers.pids) {
    try { process.kill(pid, 'SIGKILL'); } catch (e) { /* ignore */ }
  }
  await sleep(300);
  const finalLeftovers = groupLeftovers(pgid);

  const cpu = cpuSeries.filter((v) => Number.isFinite(v));
  const avgCpu = cpu.length ? cpu.reduce((a, b) => a + b, 0) / cpu.length : 0;
  const peakCpu = cpu.length ? Math.max(...cpu) : 0;

  // Aggregate per-process stats across the whole run (max observed per pid).
  const perProcess = new Map();
  for (const s of samples) {
    for (const p of s.procs) {
      const key = p.pid;
      const cur = perProcess.get(key) || { pid: p.pid, comm: p.comm, maxPssKb: 0, maxPrivateKb: 0, maxRssKb: 0 };
      cur.maxPssKb = Math.max(cur.maxPssKb, p.pssKb);
      cur.maxPrivateKb = Math.max(cur.maxPrivateKb, p.privateKb);
      cur.maxRssKb = Math.max(cur.maxRssKb, p.rssKb);
      perProcess.set(key, cur);
    }
  }

  const profile = {
    runtime,
    spawnPid: rootPid,
    usedXvfb: useXvfb,
    intervalMs,
    durationMs,
    startedAt,
    spawnHrMs: Number(spawnHr / 1000000n),
    sampleCount: samples.length,
    idle,
    peak,
    avgPssKb: samples.length ? samples.reduce((a, s) => a + s.pssKb, 0) / samples.length : 0,
    avgPrivateKb: samples.length ? samples.reduce((a, s) => a + s.privateKb, 0) / samples.length : 0,
    avgRssKb: samples.length ? samples.reduce((a, s) => a + s.rssKb, 0) / samples.length : 0,
    cpu: { avg: avgCpu, peak: peakCpu, samples: cpu.length, series: cpu.map((v) => Math.round(v * 10) / 10) },
    perProcess: Array.from(perProcess.values()).sort((a, b) => b.maxPssKb - a.maxPssKb),
    termination: {
      termMs,
      escalated,
      leftoverLive: finalLeftovers.live,
      leftoverZombies: finalLeftovers.zombies,
      clean: finalLeftovers.live === 0,
    },
    treeSizePeak: treeSizeSeries.length ? Math.max(...treeSizeSeries) : peak.procs.length,
    runnerResult: finishedResult,
    stderrTail: stderrBuf.split('\n').slice(-25).join('\n'),
    stdoutTail: stdoutBuf.split('\n').slice(-15).join('\n'),
  };

  // Startup time to first paint: spawn() -> first-paint IPC marker. Both clocks
  // are wall-clock epoch milliseconds, so the delta is the true wall time from
  // process spawn to the first painted frame.
  if (finishedResult && finishedResult.timing && finishedResult.timing.firstPaintEpoch) {
    profile.startupMs = finishedResult.timing.firstPaintEpoch - startedAt;
    profile.startupToReadyMs = finishedResult.timing.stressStartEpoch
      ? finishedResult.timing.stressStartEpoch - startedAt
      : null;
  }

  return profile;
}

module.exports = {
  profileRun,
  sampleTree,
  collectTree,
  groupMembers,
  groupLeftovers,
  measureFootprint,
  duBytes,
  fileBytes,
  killTree,
  sleep,
  log,
};

// Allow standalone invocation of a single runtime: node profiler.js <runtime>
if (require.main === module) {
  const { commandFor } = require('./runtimes');
  const runtime = process.argv[2] || 'adrenaline-webview';
  const repoRoot = path.resolve(__dirname, '..', '..');
  const resultFile = path.join(__dirname, `results-${runtime}.json`);
  const phaseFile = path.join(__dirname, `phase-${runtime}.json`);
  const spec = commandFor(runtime, { repoRoot, suiteDir: __dirname });
  profileRun({
    runtime,
    repoRoot,
    durationMs: Number(process.env.STRESS_DURATION_MS || 30000),
    intervalMs: Number(process.env.STRESS_INTERVAL_MS || 500),
    resultFile,
    phaseFile,
    command: spec.command,
    runCwd: spec.cwd,
    env: { STRESS_RESULT_FILE: resultFile, STRESS_PHASE_FILE: phaseFile, STRESS_DURATION_MS: process.env.STRESS_DURATION_MS || '30000', ...spec.env },
  }).then((p) => {
    console.log(JSON.stringify(p, null, 2));
  }).catch((e) => { console.error(e); process.exit(1); });
}
