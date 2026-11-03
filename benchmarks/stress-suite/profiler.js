'use strict';

/*
 * Task-manager style profiler (cross-platform: Linux, Windows, macOS).
 *
 * Spawns a runtime runner and samples the *entire* process tree every
 * `intervalMs` for `durationMs` of sustained stress.
 *
 * Memory is measured with the most accurate primitive each OS offers, but every
 * backend is normalised to the same four numbers so the report reads identically
 * everywhere:
 *
 *   pssKb     - "shared-aware" total. On Linux this is the true PSS from
 *               /proc/[pid]/smaps_rollup: a page shared by N processes
 *               contributes 1/N to each, so summing it over the tree counts the
 *               page exactly once. Windows and macOS do not expose PSS, so the
 *               closest honest analogue is used (Working Set / resident size)
 *               and the report states this explicitly. On those platforms the
 *               number *over*-counts shared framework pages, never under-counts.
 *   privateKb - the portion no other process can share. Linux: Private_Clean +
 *               Private_Dirty. Windows: PrivatePageCount. macOS: rss minus
 *               the shared pages reported by `vmmap -summary` (best effort).
 *   rssKb     - resident set size as the OS reports it.
 *   sharedKb  - pss - private, i.e. the shared portion of the shared-aware total.
 *
 * The headline memory metric is the *shared-aware* number (PSS on Linux). Naive
 * RSS is intentionally not used for the Linux headline: summing Rss across a
 * Chromium/WebKit tree double-counts every shared framework library.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

const CLK_TCK = 100; // getconf CLK_TCK on Linux

function log(msg) {
  process.stderr.write('[profiler] ' + msg + '\n');
}

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}

/** Run a command and return trimmed stdout, or null if it failed. */
function capture(cmd, args, opts = {}) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...opts });
    if (r.error || r.status !== 0 || r.stdout == null) return null;
    return r.stdout;
  } catch (e) {
    return null;
  }
}

// ===========================================================================
// Process tree
// ===========================================================================

/** Linux: one pass over /proc, keyed on the stat PPID field. */
function scanProcLinux() {
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

/**
 * Windows: one `Get-CimInstance Win32_Process` call returns the whole table
 * (pid, parent, command line, private + working set). Much cheaper than a
 * per-pid round trip and it gives us the tree and the memory in one shot.
 *
 * CIM reports ParentProcessId, so the tree is reconstructed by following
 * parents up to the root instead of walking children down.
 */
function scanProcWindows() {
  const map = new Map();
  const ps = [
    '$ErrorActionPreference = "Stop";',
    'Get-CimInstance Win32_Process |',
    'Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,PrivatePageCount,UserModeTime,KernelModeTime |',
    'ConvertTo-Json -Compress -Depth 3',
  ].join(' ');
  const out = capture('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  if (!out) return map;
  let rows;
  try { rows = JSON.parse(out); } catch (e) { return map; }
  if (!Array.isArray(rows)) rows = rows ? [rows] : [];
  for (const r of rows) {
    const pid = Number(r.ProcessId);
    if (!Number.isFinite(pid)) continue;
    map.set(pid, {
      pid,
      comm: r.Name || 'unknown',
      state: 'R',
      ppid: Number(r.ParentProcessId) || 0,
      pgrp: null,
      // UserModeTime/KernelModeTime are 100-ns ticks (== 10^7 per second).
      cpuTicks: (Number(r.UserModeTime) || 0) + (Number(r.KernelModeTime) || 0),
      workingSet: Number(r.WorkingSetSize) || 0,
      privateBytes: Number(r.PrivatePageCount) || 0,
    });
  }
  return map;
}

/**
 * macOS: `ps -Ao pid=,ppid=,pgid=,rss=,time=,comm=` for the whole table.
 * `pgid` is captured so the termination path can key on the process group
 * exactly as it does on Linux.
 */
function scanProcMac() {
  const map = new Map();
  const out = capture('ps', ['-Ao', 'pid=,ppid=,pgid=,rss=,time=,comm=']);
  if (!out) return map;
  for (const line of out.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = /^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(t);
    if (!m) continue;
    const pid = Number(m[1]);
    map.set(pid, {
      pid,
      comm: path.basename(m[6].trim()) || 'unknown',
      state: 'R',
      ppid: Number(m[2]),
      pgrp: Number(m[3]),
      // `time` is [dd-]hh:mm:ss of cumulative CPU; convert to 100-tick units so
      // it is directly comparable to Linux's utime+stime.
      cpuTicks: parsePsTime(m[5]) * CLK_TCK,
      rssKb: Number(m[4]),
    });
  }
  return map;
}

function parsePsTime(s) {
  // Formats: "MM:SS.ss", "HH:MM:SS", "DD-HH:MM:SS".
  let days = 0;
  let rest = s;
  const dash = s.indexOf('-');
  if (dash >= 0) { days = Number(s.slice(0, dash)) || 0; rest = s.slice(dash + 1); }
  const parts = rest.split(':').map((p) => Number(p) || 0);
  let h = 0, m = 0, sec = 0;
  if (parts.length === 3) { [h, m, sec] = parts; }
  else if (parts.length === 2) { [m, sec] = parts; }
  else { sec = parts[0] || 0; }
  return days * 86400 + h * 3600 + m * 60 + sec;
}

function scanProc() {
  if (IS_WIN) return scanProcWindows();
  if (IS_MAC) return scanProcMac();
  return scanProcLinux();
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

// ===========================================================================
// Per-process memory
// ===========================================================================

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

/**
 * macOS per-process shared-page accounting.
 *
 * `vmmap -summary <pid>` is the only user-space way to split a process' memory
 * into its private and shared parts (Mach task info via `task_info` would need a
 * native helper). We only need the *shared* figure, and vmmap prints it in a
 * line such as "  Shared: 12.3M".
 *
 * vmmap is expensive (it walks the whole address space) and is run with
 * spawnSync, so calling it for every process on every sample would stall the
 * sampler. It is therefore cached per pid for a few seconds, and disabled for
 * the rest of the run after repeated failures or a single very slow call. When
 * it is unavailable the whole resident size is treated as private (an over-count
 * of private, never a crash), which is the honest fallback.
 */
const MAC_SHARED_TTL_MS = 4000;
const MAC_SHARED_MAX_MS = 2500;
const _macSharedCache = new Map();
let _macSharedDisabled = false;

function macSharedKb(pid) {
  if (_macSharedDisabled) return null;
  const now = Date.now();
  const hit = _macSharedCache.get(pid);
  if (hit && now - hit.at < MAC_SHARED_TTL_MS) return hit.kb;
  const t0 = Date.now();
  const out = capture('/usr/bin/vmmap', ['-summary', String(pid)]);
  const elapsed = Date.now() - t0;
  if (elapsed > MAC_SHARED_MAX_MS) {
    _macSharedDisabled = true;
    return null;
  }
  if (!out) return null;
  const m = /Shared:\s+([0-9.]+)([KMG]?)/.exec(out);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  if (!Number.isFinite(n)) return null;
  let kb;
  if (unit === 'G') kb = n * 1024 * 1024;
  else if (unit === 'M') kb = n * 1024;
  else if (unit === 'K') kb = n;
  else kb = n / 1024; // vmmap prints bytes when no suffix
  _macSharedCache.set(pid, { at: now, kb });
  return kb;
}

/**
 * Normalise one process' memory into {rssKb, pssKb, privateKb, sharedKb, swapKb}
 * using the platform's best primitive. `snapshot` is the process-table entry,
 * which already carries the Windows figures.
 */
function processMemory(st, snapshot) {
  if (IS_LINUX) {
    const mem = smapsRollup(st.pid);
    if (!mem) return null;
    return {
      rssKb: mem.rss,
      pssKb: mem.pss,
      privateKb: mem.privateClean + mem.privateDirty,
      sharedKb: mem.sharedClean + mem.sharedDirty,
      swapKb: mem.swapPss,
    };
  }
  if (IS_WIN) {
    const rssKb = Math.round((st.workingSet || 0) / 1024);
    const privateKb = Math.round((st.privateBytes || 0) / 1024);
    // No PSS on Windows; Working Set is the shared-aware figure.
    return { rssKb, pssKb: rssKb, privateKb, sharedKb: Math.max(0, rssKb - privateKb), swapKb: 0 };
  }
  // macOS
  const rssKb = st.rssKb || 0;
  const shared = macSharedKb(st.pid);
  const sharedKb = shared === null ? 0 : Math.min(shared, rssKb);
  return { rssKb, pssKb: rssKb, privateKb: Math.max(0, rssKb - sharedKb), sharedKb, swapKb: 0 };
}

function sampleTree(rootPid) {
  const snapshot = scanProc();
  const pids = collectTreeFrom(snapshot, rootPid);
  const procs = [];
  let pss = 0, priv = 0, rss = 0, shared = 0;
  for (const pid of pids) {
    const st = snapshot.get(pid);
    if (!st || st.state === 'Z') continue; // zombies hold no memory
    const mem = processMemory(st, snapshot);
    if (!mem) continue;
    pss += mem.pssKb;
    priv += mem.privateKb;
    rss += mem.rssKb;
    shared += mem.sharedKb;
    // Cumulative CPU in CLK_TCK (100 Hz) units, so the delta math below is the
    // same on every platform. Linux: utime+stime are already in ticks. Windows:
    // UserModeTime+KernelModeTime are 100-ns units (10^7 per second), so divide
    // by 1e5 to reach 100-per-second ticks. macOS: scanProcMac already converted
    // `ps time` seconds to ticks.
    const cpuTicks = IS_LINUX ? ((st.utime || 0) + (st.stime || 0))
      : IS_WIN ? (st.cpuTicks || 0) / 1e5
      : (st.cpuTicks || 0);
    procs.push({
      pid,
      comm: st.comm,
      pssKb: mem.pssKb,
      privateKb: mem.privateKb,
      rssKb: mem.rssKb,
      sharedKb: mem.sharedKb,
      swapPssKb: mem.swapKb,
      cpuTicks,
    });
  }
  return { pids, procs, pssKb: pss, privateKb: priv, rssKb: rss, sharedKb: shared };
}

// ===========================================================================
// Runtime disk footprint
// ===========================================================================

function duBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  const r = spawnSync('du', ['-sk', dir], { encoding: 'utf8', windowsHide: true });
  if (r.status === 0 && r.stdout) {
    const kb = parseInt(r.stdout.trim().split(/\s+/)[0], 10);
    if (Number.isFinite(kb)) return kb * 1024;
  }
  return duBytesPortable(dir);
}

/** Recursive byte count used when `du` is unavailable (e.g. Windows). */
function duBytesPortable(dir) {
  let total = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      if (e.isDirectory()) total += duBytesPortable(p);
      else if (e.isFile()) total += fs.statSync(p).size;
    } catch (err) { /* racing deletion / permission: skip */ }
  }
  return total;
}

function fileBytes(p) {
  try { return fs.statSync(p).size; } catch (e) { return 0; }
}

/** Platform-specific name of the shipped Neutralinojs runtime binary. */
function neutralinoBinaryName() {
  if (IS_WIN) return 'neutralino-win_x64.exe';
  if (IS_MAC) return os.arch() === 'arm64' ? 'neutralino-mac_arm64' : 'neutralino-mac_x64';
  return 'neutralino-linux_x64';
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
    components.push({ label: 'NW.js distribution (nw binary + Chromium + Node + ICU)', bytes: duBytes(nwDist) });
    components.push({ label: 'application assets (app/)', bytes: duBytes(appDir) });
    components.push({ label: 'runner code (nw-app/)', bytes: duBytes(path.join(suite, 'nw-app')) });
  } else if (runtime === 'neutralino') {
    const neuBin = neutralinoBinaryName();
    components.push({ label: 'Neutralino binary (' + neuBin + ')', bytes: fileBytes(path.join(suite, 'neu-app', neuBin)) });
    components.push({ label: 'Neutralino client library (neutralino.js)', bytes: fileBytes(path.join(suite, 'neu-app', 'resources', 'neutralino.js')) });
    components.push({ label: 'application assets (app/)', bytes: duBytes(appDir) });
    components.push({ label: 'runner code (neu-app/ extensions)', bytes: duBytes(path.join(suite, 'neu-app', 'extensions')) + fileBytes(path.join(suite, 'neu-app', 'resources', 'neu-inject.js')) });
    // Neutralino delegates both the renderer (system WebView) and the backend
    // (the user's own runtime) to the OS; the backend here is Node.js.
    components.push({ label: 'Node.js runtime binary for the extension backend (' + path.basename(process.execPath) + ')', bytes: fileBytes(process.execPath) });
    const wk = systemWebViewBytes();
    if (wk) components.push({ label: systemWebViewLabel(), bytes: wk, shared: true });
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
    // The framework does not bundle the OS webview: it links the platform
    // shared library/framework, measured separately and clearly labelled shared.
    const wk = systemWebViewBytes();
    if (wk) components.push({ label: systemWebViewLabel(), bytes: wk, shared: true });
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

function systemWebViewLabel() {
  if (IS_WIN) return 'system WebView2 runtime (NOT shipped)';
  if (IS_MAC) return 'system WebKit framework (NOT shipped)';
  return 'system WebKitGTK shared library (NOT shipped)';
}

/** Size of the OS-provided webview that the runtime links instead of shipping. */
function systemWebViewBytes() {
  if (IS_WIN) {
    // The Evergreen WebView2 runtime lives under a versioned folder in Program
    // Files; report the largest msedgewebview2.exe we can find (the runtime's
    // bulk) rather than the whole shared Edge tree.
    const bases = [
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'EdgeWebView', 'Application'),
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft', 'EdgeWebView', 'Application'),
    ];
    let best = 0;
    for (const b of bases) {
      let vers = [];
      try { vers = fs.readdirSync(b); } catch (e) { continue; }
      for (const v of vers) {
        const exe = path.join(b, v, 'msedgewebview2.exe');
        best = Math.max(best, fileBytes(exe));
      }
    }
    return best;
  }
  if (IS_MAC) {
    // WebKit is a system framework; report the main framework binary.
    return fileBytes('/System/Library/Frameworks/WebKit.framework/Versions/A/WebKit');
  }
  const r = spawnSync('ldconfig', ['-p'], { encoding: 'utf8' });
  if (r.status !== 0) return 0;
  for (const line of r.stdout.split('\n')) {
    for (const n of ['libwebkit2gtk-4.1.so.0', 'libwebkit2gtk-4.0.so.0']) {
      if (line.includes(n)) {
        const m = /=>\s+(\S+)/.exec(line);
        if (m) return fileBytes(m[1]);
      }
    }
  }
  return 0;
}

// ===========================================================================
// Process control
// ===========================================================================

/**
 * Members of the process group `pgid` on POSIX. Windows has no POSIX process
 * groups, so callers there use the process tree instead (pass `rootPid`).
 */
function groupMembers(pgid) {
  const out = [];
  if (IS_WIN) return out;
  for (const p of scanProc().values()) {
    if (p.pgrp === pgid) out.push({ pid: p.pid, state: p.state, comm: p.comm });
  }
  return out;
}

/** Members of the process tree rooted at `rootPid` (Windows termination path). */
function treeMembers(rootPid) {
  const snapshot = scanProc();
  return collectTreeFrom(snapshot, rootPid)
    .map((pid) => snapshot.get(pid))
    .filter(Boolean)
    .map((p) => ({ pid: p.pid, state: p.state, comm: p.comm }));
}

/**
 * Count live (non-zombie) members, plus any zombies. On POSIX this is the
 * process group (the runner is detached, so it leads one); on Windows it is the
 * process tree, since there is no group id to key on.
 */
function groupLeftovers(pgid, rootPid) {
  const members = IS_WIN && rootPid ? treeMembers(rootPid) : groupMembers(pgid);
  return {
    total: members.length,
    live: members.filter((m) => m.state !== 'Z').length,
    zombies: members.filter((m) => m.state === 'Z').length,
    pids: members.map((m) => m.pid),
  };
}

/**
 * Kill a process and all of its descendants.
 *
 * Linux/macOS: signal the whole process group (the runner is spawned detached,
 * so it leads a group and every descendant inherits it), then sweep the tree.
 * Windows: `taskkill /T /F` walks the tree natively; fall back to a manual sweep.
 */
function killTree(rootPid, signal) {
  if (IS_WIN) {
    const force = !signal || signal === 'SIGKILL' || signal === 'SIGTERM';
    spawnSync('taskkill', ['/PID', String(rootPid), '/T', force ? '/F' : ''].filter(Boolean), { windowsHide: true, stdio: 'ignore' });
    for (const pid of collectTree(rootPid).slice().reverse()) {
      try { process.kill(pid, signal || 'SIGKILL'); } catch (e) { /* ignore */ }
    }
    return;
  }
  try { process.kill(-rootPid, signal); } catch (e) { /* group already gone */ }
  const pids = collectTree(rootPid);
  for (const pid of pids.slice().reverse()) {
    try { process.kill(pid, signal); } catch (e) { /* ignore */ }
  }
  try { process.kill(rootPid, signal); } catch (e) { /* ignore */ }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Compile (once) and return the path to the subreaper wrapper. Linux-only: the
 * subreaper trick relies on prctl(PR_SET_CHILD_SUBREAPER). Returns null on
 * Windows/macOS or when no C compiler is available, in which case the command is
 * launched directly (correctness of the measurements is unaffected; only zombie
 * reaping of SIGKILLed orphans is).
 */
let _reaperPath;
function ensureReaper() {
  if (_reaperPath !== undefined) return _reaperPath;
  if (!IS_LINUX) { _reaperPath = null; return _reaperPath; }
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

// ===========================================================================
// Main profiling run
// ===========================================================================

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

  // Headless X is a Linux concept only. Windows and macOS GitHub runners have a
  // native graphical session, so xvfb-run must not be used there.
  let useXvfb = false;
  if (IS_LINUX) {
    const xvfb = spawnSync('which', ['xvfb-run'], { encoding: 'utf8' });
    useXvfb = xvfb.status === 0;
  }

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
    // A detached child leads a new process group on POSIX so the whole tree can
    // be signalled at once. On Windows this would pop a console window, and the
    // tree is killed with taskkill /T anyway, so it is left off there.
    detached: !IS_WIN,
    windowsHide: true,
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
  const members = () => (IS_WIN ? treeMembers(rootPid) : groupMembers(pgid));
  const leftoversOf = () => groupLeftovers(pgid, rootPid);
  if (alive) killTree(rootPid, 'SIGTERM');

  // Give the tree a generous window to drain. The subreaper wrapper stays alive
  // reaping orphans, so `live` naturally reaches 0 without a SIGKILL in the
  // common case. Killing it early would re-parent orphans to PID 1.
  let escalated = false;
  for (let i = 0; i < 80; i++) {
    if (leftoversOf().live === 0) break;
    await sleep(100);
  }
  if (leftoversOf().live > 0) {
    escalated = true;
    // SIGKILL everything *except* the subreaper first, let it reap, then kill it.
    for (const m of members()) {
      if (m.pid === rootPid) continue;
      try { process.kill(m.pid, 'SIGKILL'); } catch (e) { /* ignore */ }
    }
    await sleep(500);
    try { process.kill(rootPid, 'SIGKILL'); } catch (e) { /* ignore */ }
    for (let i = 0; i < 30; i++) {
      if (leftoversOf().live === 0) break;
      await sleep(100);
    }
  }
  const termMs = Date.now() - termStart;

  // Phase 4: final sweep, then report exactly what (if anything) survived.
  await sleep(300);
  const leftovers = leftoversOf();
  for (const pid of leftovers.pids) {
    try { process.kill(pid, 'SIGKILL'); } catch (e) { /* ignore */ }
  }
  await sleep(300);
  const finalLeftovers = leftoversOf();

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
    platform: process.platform,
    memorySource: IS_LINUX ? 'smaps_rollup (PSS)' : (IS_WIN ? 'WorkingSetSize (CIM)' : 'ps rss / vmmap shared'),
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
