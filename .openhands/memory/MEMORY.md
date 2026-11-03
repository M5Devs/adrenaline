# Project memory — Adrenaline.js

Desktop app framework (Electron-compatible API) using Node.js + `webview.h`
(WebKitGTK), with an optional CEF engine. Version 0.5.0. Repo at
`/workspace/project/adrenaline`.

## Layout
- `src/window.cpp` — the engine thread + window/IPC layer for BOTH engines
  (`#if ADREN_FEATURE_CEF`). One dedicated engine thread owns the loop; all
  `gtk_*`/`webkit_*` and CEF calls must happen on it.
- `src/cef/` — `adrenaline_app.*` (CefApp, command-line switches,
  `OnScheduleMessagePumpWork`), `adrenaline_client.*` (load/IPC, idle GC),
  `adrenaline_wakeup.h` (process-wide eventfd wake channel), `adrenaline_url_policy.h`.
- `lib/config-resolver.js` — config + module model (`DEFAULT_MODULES`,
  `ASSET_STRIP_RULES`, `stripBinary`, `applyAssetStripping`).
- `scripts/setup-cef.js` (fetch/prune/strip CEF), `scripts/setup-webgtk.js`
  (clone+build the sister project's `libwebgtk.so` into `vendor/webgtk/`),
  `scripts/strip-runtime.js`, `scripts/build.js` (engine is a compile-time
  define: `--adren_engine=cef|webview|webgtk`).
- `benchmarks/stress-suite/` — the Royal Rumble (run.js / report.js /
  profiler.js); `profiles-combined.json` + `ROYAL_RUMBLE_SHOWDOWN.md` are committed evidence.
  Linux roster is 5-way: electron, neutralino, adrenaline-webview,
  adrenaline-cef, adrenaline-webgtk (NW.js evicted).

## Commands
- Build: `npm run build -- --adren_engine=cef` (or `=webview` / `=webgtk`).
- Tests: `xvfb-run -a npm test` (11 suites; needs a real X display).
- CEF: `npm run setup:cef` (provisions `vendor/cef`), `npm run strip:runtime`.
- WebGTK: `npm run setup:webgtk` (provisions `vendor/webgtk`), then
  `ADREN_ENGINE=webgtk npm run build`. Needs cmake + libgtk-3-dev.
- Bench: `npm run benchmark` (setup + run + report). Duration via `STRESS_DURATION_MS`
  (canonical 30000).

## Engine model (3 engines)
- `lib/config-resolver.js` `SUPPORTED_ENGINES = ['webview','cef','webgtk']`;
  an unknown engine degrades to `webview` (never emits a bogus define).
  `gypDefines()` emits `ADREN_FEATURE_{CEF,WEBVIEW,WEBGTK}` — exactly one is 1.
- `src/features.h` defaults `ADREN_FEATURE_WEBGTK` to 0; `src/window.cpp` adds a
  `#elif ADREN_FEATURE_WEBGTK` branch (GTK window + `webgtk_view` + a
  main-context timer pumping the IPC bridge script). `binding.gyp` links
  `-lwebgtk` + `-Wl,-rpath,<webgtk_lib>` for the webgtk engine.
- `scripts/build.js selectEngine(engine, cefAvailable, webgtkAvailable)` falls
  back to webview when the engine's vendor lib is missing (CEF and WebGTK trees
  are both gitignored).
- WebGTK's C ABI has no function-binding hook, so the IPC bridge is a periodic
  `webgtk_view_evaluate_javascript` of a script that installs `window.adrenaline`
  and returns one queued `[channel, data]` per tick (mirrors the webview engine's
  envelope). The mock backend echoes the script (no JS execution) — that is why
  `test_webgtk.js` is a smoke test unless `WEBGTK_ENGINE_DIR` is set.

## Gotchas learned
- **No CEF helper binary**: a Node addon loads into a running process, so CEF runs
  `single-process` + `no-sandbox`; remote URLs are rejected as mitigation.
- `CefModuleDir()` must use `dladdr(&cef_initialize)` (C API symbol, only in
  libcef.so), NOT the C++ `CefInitialize` thunk which resolves to the addon.
- webview engine needs `XInitThreads()` + a global init mutex (libX11 is not
  thread-safe) — see 2026-10-31.md.
- `strip --strip-unneeded` (not `--strip-debug`) reclaims the ~180MB of CEF debug
  info; it drops `.symtab`, keeps `.dynsym`. Idempotent.
- Container can be reset mid-session (apt pkgs + `node_modules/electron/dist`
  vanish, workspace files survive). `sudo -n` works. Re-provision: xvfb xauth
  pkg-config cmake libgtk-3-dev libwebkit2gtk-4.1-dev + `node
  node_modules/electron/install.js`.
- `benchmarks/stress-suite/setup.js` Neutralino fetch is broken upstream — see
  2026-11-02.md for the manual workaround.

## History
- `2026-10-31.md` — CEF pruning + modular feature elimination; fixed the
  intermittent GTK/libX11 teardown crash.
- `2026-11-01.md` — CEF windowing + IPC layer; the `dladdr` icudtl.dat fix.
- `2026-11-02.md` — eventfd instant-wakeup pump (IPC p95 11.6→2.5ms) + disk
  stripping (620→413MB) + env re-provisioning notes.
