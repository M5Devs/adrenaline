# Project memory — Adrenaline.js

Ultra-lightweight Electron alternative: Node.js backend + native OS webviews
(WebKitGTK on Linux/macOS, WebView2 on Windows) instead of bundled Chromium.
`package.json` name `adrenaline-js`, v0.2.0. Native addon in `src/` (C++,
node-addon-api), JS surface in `lib/` + `index.js`/`index.mjs`, types `index.d.ts`.

## Build & test
- `npm run build` / `npm install` → `node-gyp rebuild` (sources: `src/main.cpp`,
  `src/window.cpp`, `src/dialog.cpp`; engine = `webview`; `NAPI_VERSION=8`).
  Produces `build/Release/adrenaline.node` (gitignored).
- `npm test` runs `test/test*.js` (plain node scripts, no framework).
- API surface mirrors Electron: `app`, `BrowserWindow`, `ipcMain`, `dialog`,
  `features`. The native layer injects a `window.adrenaline` bridge
  (`send`/`on`/`invoke`) into the webview — same shape Electron gets via a
  `contextBridge` preload.

## Benchmark suite (Adrenaline vs Electron) — `benchmarks/`
- `benchmarks/stress-suite/` compares both runtimes on one shared workload
  (`app/{config,backend,harness,renderer,index.html,preload,hash-worker}.js`)
  with `adrenaline-runner.js` / `electron-runner.js` / `profiler.js` / `run.js` /
  `report.js` / `tools/reaper.c`. `npm run benchmark` = `run.js && report.js`.
- Report: `benchmarks/STRESS_TEST.md`; raw evidence
  `benchmarks/stress-suite/profiles-combined.json` (committed on purpose).
- Each runtime runs **sequentially** under `xvfb-run -a`, 500 ms sampling for 30 s.
  Metrics: PSS summed tree-wide from `/proc/[pid]/smaps_rollup` (never a naive RSS
  sum — double-counts shared libs), Private = Private_Clean+Private_Dirty, CPU from
  Σ(utime+stime) deltas ÷ wallclock, IPC round-trip via hrtime (p50/90/95/99),
  startup = spawn → first-paint IPC.

### Benchmark environment quirks (each cost real debugging time)
- **Launcher differs**: Adrenaline runs under `node`; Electron MUST launch with the
  Electron binary (`node_modules/electron/dist/electron`, path in
  `node_modules/electron/path.txt`). `run.js` `launcherFor()`; profiler `launcher` opt.
- **WebKitGTK children are forked from a non-main thread**, so
  `/proc/<pid>/task/<pid>/children` omits WebKitWebProcess/WebKitNetworkProcess.
  Walk the tree from a full `/proc` scan keyed on the stat PPID field instead.
- **Container PID 1 (openhands-agent-server) does not reap orphans** → SIGKILLed
  grandchildren become permanent zombies. Fix: run the runner detached under the
  subreaper `tools/reaper.c` (PR_SET_CHILD_SUBREAPER). It must **linger ~2 s after
  its main child dies** (ECHILD fires before orphans re-parent). Then SIGTERM the
  group and let the subreaper reap; SIGKILL only if members stay live. Zombie delta
  across a run is then 0.
- **Idle baseline contamination**: start SHA-256 CPU workers in `beginStorm()`, not
  at boot, or the idle PSS sample includes hashing load.
- Electron needs `--no-sandbox --disable-gpu` here (also via
  `app.commandLine.appendSwitch`).
- `profileRun`'s result-file wait loop must NOT be gated on the child being alive —
  the runner writes results *during* shutdown, after which it exits.

### Representative 30 s result (4-core EPYC 9B14, 16 GB, Debian 13, WebKitGTK 2.54)
- Peak PSS: Electron ~700 MB (11 procs) vs Adrenaline ~512 MB (8 procs).
- Idle PSS: Electron ~300 MB vs Adrenaline ~392 MB (WebKit reserves heap up front).
- CPU: both ~260–280 % (2 SHA-256 workers dominate). IPC p95: ~1.8 ms vs ~5.1 ms.
- Startup: ~345 ms vs ~520 ms. Shipped size: 273.7 MB vs 121.5 MB (node + addon).

## Notes
- An unrelated project's memory (a browser audio studio, "EchoLab") was previously
  stored in this file; it is preserved in `.openhands/memory/echolab-memory-archive.md`
  and does not apply to this repository.

## Fixed: teardown core dump / SIGSEGV (exit 139/134) after `npm test`
- Symptom: every test prints success, then the process aborts at exit
  (`realloc(): invalid next size` / SIGSEGV in JSC `StringImpl::destroy`), only
  under `xvfb-run -a` (needs a real X display). `test_flags_optimization.js` was
  the worst offender (~7–12/40), the full suite ~3/20.
- **Definitive root cause (2026-10-31):** `env.AddCleanupHook(...)` — i.e.
  `napi_add_env_cleanup_hook` — **does not run when the process ends via
  `process.exit()`**, and every test calls `process.exit(0)`. So `ShutdownWindows()`
  and every teardown strategy layered on it was a **no-op**; WebKit/JSC teardown
  raced node's own exit. (Proved by writing a file from inside the hook: never
  fired. Timing also proved it: a requested 2500 ms shutdown sleep took 0.16 s.)
- **Fix:** export native `shutdown()` and call it from a JS `process.on('exit')`
  hook in `index.js` (node's own 'exit' hook *does* run at `process.exit()` and
  blocks until the callback returns). `ShutdownWindows()` drains the engine loop
  (`RunOnEngine(DrainEngine(500))`) then signals+joins the engine thread.
  - Webviews still open at exit are **not** destroyed — tearing one down at exit
    aborts 100% of the time even after draining; the OS reclaims it.
  - `close()` **parks** the closed `WindowInstance` in `closed_windows()` instead
    of destroying it; destroying in `close()` also aborts at exit (test.js /
    test_loadfile.js close a loaded window). Parking is the only stable choice.
- Result: flags 0/80, delay-0 0/80, 40× open/close 0/20, full suite 0/10 (webview)
  and 0/5 (cef).
- The earlier `XInitThreads()` + `g_engine_init_mutex` change (below) is still
  correct and needed for concurrent GTK init, but it was **not** the exit crash's
  root cause — the skipped cleanup hook was.
- Diagnostic note: stderr from a fatal path is not flushed; write diagnostics to a
  file. There is no gdb/valgrind/strace in this image (only `addr2line`).

## Also fixed: concurrent GTK init (kept, separate from the exit crash)
- Each `BrowserWindow` runs its own GTK main loop on a dedicated thread, so
  `gtk_init()` / `webkit_web_view_new()` could run **concurrently** against a shared
  GMainContext with a non-thread-safe libX11 → heap corruption.
- Fix (src/main.cpp, src/window.cpp, binding.gyp): `XInitThreads()` once in module
  `Init` (link `-lX11`) and a global `g_engine_init_mutex` held across
  `webview::webview` ctor → `init()`. This is correct and needed, but it was not the
  exit-139 root cause (that was the skipped N-API cleanup hook, above).

