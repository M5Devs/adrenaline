# Project memory — Adrenaline.js

Ultra-lightweight Electron alternative: Node.js backend + native OS webviews
(WebKitGTK on Linux/macOS, WebView2 on Windows) instead of bundled Chromium.
`package.json` name `adrenaline-js`, v0.2.0. Native addon in `src/` (C++,
node-addon-api), JS surface in `lib/` + `index.js`/`index.mjs`, types `index.d.ts`.

## Build & test
- `npm run build` / `npm install` → `node scripts/build.js` → `node-gyp rebuild`
  (sources: `src/main.cpp`, `src/window.cpp`, `src/dialog.cpp`; `NAPI_VERSION=8`).
  Engine precedence: `--adren_engine`/`--engine` → `ADREN_ENGINE` →
  `adrenaline.config.js` → `webview`. Falls back to `webview` when
  `vendor/cef/Release/libcef.so` is absent (CI-safe). Produces
  `build/Release/adrenaline.node` (gitignored).
- CEF pipeline: `npm run setup:cef` (`scripts/setup-cef.js`) downloads the
  newest stable linux64 *minimal* CEF from Spotify's CDN index, prunes locales
  (keeps `en-US` + `en-US_{FEMININE,MASCULINE,NEUTER}.pak`; 216 removed, ~47 MB)
  and tests, builds `libcef_dll_wrapper.a` via CMake (needs `cmake` installed),
  then applies `lib/config-resolver.js` asset stripping (`devtools_resources.pak`
  etc. when the matching module is off). `vendor/` is gitignored.
- `npm test` runs `test/test*.js` (plain node scripts, no framework).
- API surface mirrors Electron: `app`, `BrowserWindow`, `ipcMain`, `dialog`,
  `features`. The native layer injects a `window.adrenaline` bridge
  (`send`/`on`/`invoke`) into the webview — same shape Electron gets via a
  `contextBridge` preload.

## CI (GitHub Actions)
- `ci.yml` + `publish.yml` pinned to `runs-on: ubuntu-24.04`. `ubuntu-latest`
  silently migrated 24.04 → 26.04 in late 2026 and broke the GTK/WebKit build:
  on Ubuntu ≥ 26.04 `libglib2.0-dev` is a *metapackage* (no headers/`.pc`) — the
  GLib headers and `glib-2.0.pc` moved to `libgio-2.0-dev`, so `pkg-config
  --cflags gtk+-3.0` stops emitting the glib include path → `fatal error:
  glib.h: No such file or directory`. A stock `ubuntu:26.04` Docker image works,
  so it is runner-image-specific. Keep the pin; install `libglib2.0-dev`
  explicitly. Do NOT add `libgio-2.0-dev` (absent on 24.04).

## Benchmark suite (Adrenaline vs Electron) — `benchmarks/`
- `benchmarks/stress-suite/`: one shared workload (`app/*`) run under
  `adrenaline-runner.js` / `electron-runner.js` / `profiler.js` / `run.js` /
  `report.js` / `tools/reaper.c`. `npm run benchmark` = `run.js && report.js`.
- Report `benchmarks/STRESS_TEST.md`; raw evidence `profiles-combined.json`
  (committed on purpose). Sequential runs under `xvfb-run -a`, 500 ms sampling
  for 30 s. PSS summed tree-wide from `/proc/[pid]/smaps_rollup` (never naive RSS
  sum — double-counts shared libs); Private = Private_Clean+Dirty; CPU from
  Σ(utime+stime) ÷ wallclock; IPC round-trip via hrtime; startup = spawn → first paint.

### Benchmark environment quirks (each cost real debugging time)
- Electron MUST launch via its binary (`node_modules/electron/dist/electron`,
  path in `node_modules/electron/path.txt`), not `node`; Adrenaline runs under
  `node`. See `run.js` `launcherFor()` / profiler `launcher` opt.
- WebKitGTK children fork from a non-main thread, so
  `/proc/<pid>/task/<pid>/children` omits WebKitWebProcess/NetworkProcess — walk
  the tree from a full `/proc` scan keyed on stat PPID instead.
- Container PID 1 (openhands-agent-server) does not reap orphans → SIGKILLed
  grandchildren become permanent zombies. Run the runner detached under the
  subreaper `tools/reaper.c` (PR_SET_CHILD_SUBREAPER), which must linger ~2 s
  after its main child dies (ECHILD fires before orphans re-parent); then SIGTERM
  the group. Zombie delta across a run is then 0.
- Start SHA-256 CPU workers in `beginStorm()`, not at boot, or the idle PSS
  sample includes hashing load. Electron needs `--no-sandbox --disable-gpu`.
- `profileRun`'s result-file wait must NOT be gated on the child being alive —
  the runner writes results during shutdown, then exits.

### Representative 30 s result (4-core EPYC 9B14, 16 GB, Debian 13, WebKitGTK 2.54)
- Peak PSS: Electron ~700 MB (11 procs) vs Adrenaline ~512 MB (8 procs).
- Idle PSS: Electron ~300 MB vs Adrenaline ~392 MB (WebKit reserves heap up front).
- CPU: both ~260–280 % (2 SHA-256 workers dominate). IPC p95 ~1.8 ms vs ~5.1 ms.
- Startup ~345 ms vs ~520 ms. Shipped size 273.7 MB vs 121.5 MB (node + addon).

## CEF engine (`ADREN_FEATURE_CEF`, `npm run build -- --adren_engine=cef`)
- Native layer: `src/cef/adrenaline_app.{h,cpp}` (CefApp + Browser/Render process
  handlers, process-message IPC bridge, command-line switches) and
  `src/cef/adrenaline_client.{h,cpp}` (CefClient: display/lifespan/load). Windowing
  lives in `src/window.cpp` under `#if ADREN_FEATURE_CEF` (views API:
  `CefWindow::CreateTopLevelWindow` + `CefBrowserView::CreateBrowserView`).
- Engine thread pumps CEF with `external_message_pump=true` →
  `CefDoMessageLoopWork()` + ~5 ms sleep each iteration. `CefInitialize` runs on
  that engine thread, not the JS thread.

### CEF integration gotchas (each cost real debugging time)
- **`dladdr` on the C++ `CefInitialize` reports the ADDON dir, not libcef.so.**
  The C++ symbol is a thin thunk defined in the addon (it calls `cef_initialize`).
  Use `dladdr(&cef_initialize, ...)` (include `include/capi/cef_app_capi.h`) to
  locate libcef.so / icudtl.dat. Wrong dir → CEF aborts with SIGTRAP in
  `LoadLocalState` (chrome_main_delegate.cc:861) via `PostEarlyInitialization`.
- `icudtl.dat` MUST sit next to `libcef.so`; CEF ignores `resources_dir_path` for
  it. `.pak` bundles + `locales/` may live in a sibling `Resources/` found via
  `resources_dir_path` / `locales_dir_path`.
- `CefMainArgs` needs a real argv (≥ argv[0]); the addon reconstructs it from
  `/proc/self/cmdline`.
- Settings: `no_sandbox=true`, `multi_threaded_message_loop=false`,
  `external_message_pump=true`, `locale="en-US"`, `cache_path=<module_dir>/.adrenaline_cache`.
- `xvfb-run -a` is required for the tests; benign noise: dbus/bus.cc,
  `chrome_100_percent.pak` load failures, `component_loader.cc` manifest warning.
- Build defines come from `lib/config-resolver.js` (reads `adrenaline.config.js`):
  `ADREN_FEATURE_CEF/WEBVIEW/DEVTOOLS/PDF/WEBRTC/CLEAN_PRIVACY/LOCAL_FILES`.
- Pruning (`scripts/setup-cef.js`): strips all locales except `en-US*.pak`
  (216 files / ~47 MB), removes `tests/`, relocates `icudtl.dat` next to
  libcef.so, builds `libcef_dll_wrapper.a` and deletes intermediates.
  `scripts/strip-runtime.js` applies `ASSET_STRIP_RULES` (e.g. removes
  `Resources/devtools_resources.pak`, ~25 MB) to a packaged dist.

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

