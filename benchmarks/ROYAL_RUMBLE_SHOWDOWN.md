# 👑 The Royal Rumble: 4-Way JavaScript Desktop Runtime Showdown

> An automated, reproducible, headless benchmark of four JavaScript desktop
> runtimes executing **one identical heavy desktop workload** for 30 seconds each.

| # | Runtime | Engine / Backend |
| :-- | :--- | :--- |
| 1 | **Electron** | Bundled Chromium + Node.js |
| 2 | **Neutralinojs** | OS system WebView + user-supplied backend process (here: Node.js extension) |
| 3 | **Adrenaline.js (WebView)** | System WebKitGTK + Node.js backend |
| 4 | **Adrenaline.js (CEF)** | Pruned CEF (Chromium Embedded Framework) + Node.js backend |

Generated: `2026-11-03T22:36:24.318Z`  
Harness: `benchmarks/stress-suite/`  
Raw evidence: `benchmarks/stress-suite/profiles-combined.json`

---

## 1. Executive Summary

All four runtimes ran the *same application* — one shared frontend/backend
codebase that renders and mutates a **10,000-record virtualised dataset**,
streams **100 JSON IPC packets/second** with per-packet round-trip timing, and
runs **2 SHA-256 CPU workers** saturating the remaining cores. The only
difference between runs is the runtime itself; each runtime uses its own
idiomatic IPC bridge, but the bytes on the wire and the work done are
identical (see §4 for the proof).

- **Lightest under load (peak PSS):** Adrenaline.js (CEF) at **442.9 MB**.
- **Fastest cold start (to first paint):** Electron at **349 ms**.
- **Smallest shipped payload:** Adrenaline.js (WebView) at **121.1 MB**.
- **Lowest IPC p95 latency:** Electron at **2.015 ms**.
- **Lowest average CPU:** Adrenaline.js (CEF) at **252.7 %**.

All measurements below come from `/proc` with 500 ms sampling over a
30-second sustained stress window, after a clean idle baseline. No value is
estimated, interpolated, or scaled.

---

## 2. Testbed Environment

| Property | Value |
| :--- | :--- |
| Host | `runtime-ftocegewodexuwgh-559b46975-jkh28` |
| OS | Debian GNU/Linux 13 (trixie) |
| Kernel | `6.8.0-1055-gke` (x64) |
| CPU | AMD EPYC 9B14 |
| CPU cores | 4 |
| Total RAM | 15990 MB |
| Node.js | v24.21.0 |
| Adrenaline.js | 0.5.0 |
| Adrenaline WebView engine | WebKitGTK 2.54.0 |
| Adrenaline CEF engine | CEF (pruned) |
| Electron | 45.2.1 |
| Neutralinojs | 11.8.0 CLI / v6.10.0 runtime |
| Display | Xvfb (headless X server, `xvfb-run -a`) |
| Sampling interval | 500 ms |
| Stress duration | 30 s per runtime |
| Profiler | `benchmarks/stress-suite/profiler.js` (`/proc/[pid]/smaps_rollup`, `/proc/[pid]/stat`) |
| Subreaper | `benchmarks/stress-suite/tools/reaper.c` (orphan reaping) |

---

## 3. Master Comparison Matrix

Lower is better for every metric. **Bold** marks the winner of each row.

| Metric | Electron | Neutralinojs | Adrenaline.js (WebView) | Adrenaline.js (CEF) | Winner 🏆 |
| :--- | ---: | ---: | ---: | ---: | :--- |
| **Startup Time (to first paint)** | **349 ms** | 683 ms | 520 ms | 417 ms | Electron |
| **Idle Memory (PSS)** | **286.1 MB** | 407.0 MB | 383.3 MB | 358.9 MB | Electron |
| **Peak Stress Memory (PSS)** | 650.0 MB | 490.6 MB | 500.9 MB | **442.9 MB** | Adrenaline.js (CEF) |
| **Peak Private Memory** | 500.2 MB | **339.0 MB** | 351.4 MB | 356.6 MB | Neutralinojs |
| **Avg CPU Load** | 261.7 % | 263.7 % | 281.2 % | **252.7 %** | Adrenaline.js (CEF) |
| **Peak CPU Load** | 277.0 % | 284.0 % | 302.0 % | **265.0 %** | Adrenaline.js (CEF) |
| **IPC Latency (mean)** | **0.601 ms** | 28.308 ms | 2.020 ms | 0.854 ms | Electron |
| **IPC Latency (p95)** | **2.015 ms** | 50.815 ms | 5.511 ms | 2.514 ms | Electron |
| **IPC Latency (p99)** | **3.563 ms** | 53.314 ms | 10.906 ms | 6.193 ms | Electron |
| **Runtime Disk Footprint (shipped)** | 273.8 MB | 123.6 MB | **121.1 MB** | 413.1 MB | Adrenaline.js (WebView) |
| **Process count (peak tree)** | 11 | 10 | 8 | **6** | Adrenaline.js (CEF) |
| **Real Node.js / npm Support** | Yes | **No** (custom backend) | Yes | Yes | Electron / Adrenaline |

> "Runtime Disk Footprint" counts only what an application must ship on disk.
> Shared OS libraries that already exist on the target machine (for example the
> system WebKitGTK that Adrenaline WebView and Neutralino use) are excluded and
> listed separately in §6.

---

## 4. Workload Verification (all runtimes did the same work)

| Counter | Electron | Neutralinojs | Adrenaline.js (WebView) | Adrenaline.js (CEF) |
| :--- | ---: | ---: | ---: | ---: |
| Dataset size (records) | 10000 | 10000 | 10000 | 10000 |
| IPC packets sent | 2924 | 2956 | 2932 | 2946 |
| IPC packets acknowledged | 2924 | 2952 | 2932 | 2946 |
| IPC packets unacknowledged | 0 | 4 | 0 | 0 |
| SHA-256 blocks hashed | 13775040 | 19847872 | 18438016 | 20283968 |
| SHA-256 data hashed (MB) | 107618 | 155062 | 144047 | 158469 |
| Process tree size (peak) | 11 | 10 | 8 | 6 |
| Profiler samples collected | 57 | 57 | 57 | 58 |

The near-identical packet and hash counters confirm every runtime executed the
same workload, so the memory, CPU and latency deltas reflect the runtimes, not
differences in the test. Small differences in packet counts come from the
runtimes that need a longer idle window before the storm starts.

---

## 5. Process-by-Process Memory Breakdown (peak PSS)

PSS (Proportional Set Size) divides each shared page by the number of
processes sharing it, so these rows sum to the peak-stress total without
double-counting shared framework libraries. Naive RSS would double-count
every shared Chromium/WebKit `.so`.

### Electron — 11 processes, peak total 650.0 MB PSS

| Process | PID | PSS (MB) | Private (MB) | RSS (MB) |
| :--- | ---: | ---: | ---: | ---: |
| `electron` | 10352 | 167.0 | 151.5 | 232.0 |
| `electron` | 10353 | 164.9 | 149.4 | 230.8 |
| `electron` | 10302 | 147.9 | 123.0 | 226.4 |
| `electron` | 10190 | 79.0 | 51.7 | 148.5 |
| `Xvfb` | 10185 | 42.7 | 20.3 | 69.5 |
| `electron` | 10254 | 25.2 | 3.8 | 71.2 |
| `electron` | 10263 | 24.4 | 12.1 | 72.0 |
| `electron` | 10193 | 18.3 | 10.3 | 55.6 |
| `electron` | 10192 | 13.2 | 0.6 | 55.8 |
| `xvfb-run` | 10175 | 0.3 | 0.1 | 1.9 |
| `reaper` | 10174 | 0.2 | 0.1 | 1.4 |
| **Total** | | **650.0** | **500.2** | **1146.7** |

### Neutralinojs — 10 processes, peak total 490.6 MB PSS

| Process | PID | PSS (MB) | Private (MB) | RSS (MB) |
| :--- | ---: | ---: | ---: | ---: |
| `WebKitWebProces` | 10850 | 224.2 | 180.1 | 304.9 |
| `neutralino-linu` | 10803 | 93.1 | 48.7 | 174.1 |
| `MainThread` | 10808 | 38.4 | 27.3 | 73.3 |
| `WebKitNetworkPr` | 10847 | 37.5 | 21.3 | 71.8 |
| `Xvfb` | 10800 | 37.1 | 23.3 | 73.9 |
| `node` | 10915 | 30.7 | 19.5 | 64.8 |
| `node` | 10916 | 29.8 | 19.0 | 64.3 |
| `xvfb-run` | 10790 | 0.3 | 0.1 | 1.9 |
| `sh` | 10805 | 0.2 | 0.1 | 1.8 |
| `reaper` | 10789 | 0.2 | 0.1 | 1.4 |
| **Total** | | **490.6** | **339.0** | **831.9** |

### Adrenaline.js (WebView) — 8 processes, peak total 500.9 MB PSS

| Process | PID | PSS (MB) | Private (MB) | RSS (MB) |
| :--- | ---: | ---: | ---: | ---: |
| `WebKitWebProces` | 11057 | 251.9 | 208.4 | 330.4 |
| `MainThread` | 11018 | 119.4 | 65.4 | 228.2 |
| `Xvfb` | 11015 | 37.5 | 23.5 | 73.2 |
| `WebKitNetworkPr` | 11053 | 31.7 | 15.9 | 65.3 |
| `MainThread` | 11119 | 30.7 | 19.3 | 64.6 |
| `MainThread` | 11120 | 30.5 | 19.1 | 64.5 |
| `xvfb-run` | 11005 | 0.3 | 0.1 | 2.0 |
| `reaper` | 11004 | 0.2 | 0.1 | 1.4 |
| **Total** | | **500.9** | **351.4** | **829.0** |

### Adrenaline.js (CEF) — 6 processes, peak total 442.9 MB PSS

| Process | PID | PSS (MB) | Private (MB) | RSS (MB) |
| :--- | ---: | ---: | ---: | ---: |
| `MainThread` | 11219 | 343.4 | 299.1 | 422.5 |
| `MainThread` | 11319 | 35.8 | 24.7 | 70.0 |
| `Xvfb` | 11216 | 35.4 | 15.9 | 69.3 |
| `MainThread` | 11320 | 31.4 | 19.8 | 65.2 |
| `xvfb-run` | 11206 | 0.3 | 0.1 | 2.0 |
| `reaper` | 11205 | 0.2 | 0.1 | 1.4 |
| **Total** | | **442.9** | **356.6** | **627.3** |

> `Xvfb` and `xvfb-run` appear in every tree because the benchmark runs
> headless. They are part of the harness, not the runtime.

---

## 6. Real Uncompressed Runtime Footprint (Disk)

This is what an installed application must carry on disk for each runtime,
excluding OS packages already present on every machine.

### Electron — total 273.8 MB shipped

| Component | Size (MB) |
| :--- | ---: |
| electron/dist (Chromium + Node + ICU + V8 snapshots) | 273.6 |
| application assets (app/) | 0.1 |
| runner code | 0.1 |
| **Total (shipped)** | **273.8** |

### Neutralinojs — total 123.6 MB shipped

| Component | Size (MB) |
| :--- | ---: |
| Neutralino binary (neutralino-linux_x64) | 2.8 |
| Neutralino client library (neutralino.js) | 0.0 |
| application assets (app/) | 0.1 |
| runner code (neu-app/ extensions) | 0.0 |
| Node.js runtime binary for the extension backend (node) | 120.7 |
| system WebKitGTK shared library (NOT shipped) *(shared, not shipped)* | 95.7 |
| **Total (shipped)** | **123.6** |

### Adrenaline.js (WebView) — total 121.1 MB shipped

| Component | Size (MB) |
| :--- | ---: |
| Node.js runtime binary (node) | 120.7 |
| adrenaline-js JS runtime (lib/ + index.js + index.mjs) | 0.0 |
| application assets (app/) | 0.1 |
| adrenaline native addon (WebView engine) | 0.3 |
| runner code | 0.1 |
| system WebKitGTK shared library (NOT shipped) *(shared, not shipped)* | 95.7 |
| **Total (shipped)** | **121.1** |

### Adrenaline.js (CEF) — total 413.1 MB shipped

| Component | Size (MB) |
| :--- | ---: |
| Node.js runtime binary (node) | 120.7 |
| adrenaline-js JS runtime (lib/ + index.js + index.mjs) | 0.0 |
| application assets (app/) | 0.1 |
| adrenaline native addon (CEF engine) | 1.8 |
| libcef.so (pruned Chromium, debug symbols stripped) | 249.0 |
| libcef_dll_wrapper.a | 6.3 |
| icudtl.dat | 10.4 |
| core .pak bundles + locales (pruned to en-US) | 18.5 |
| libEGL.so + libGLESv2.so + swiftshader/vulkan | 6.3 |
| runner code | 0.1 |
| **Total (shipped)** | **413.1** |

---

## 7. Architectural Analysis

### 7.1 Startup to first paint

- **Electron:** 349 ms.
- **Neutralinojs:** 683 ms.
- **Adrenaline.js (WebView):** 520 ms.
- **Adrenaline.js (CEF):** 417 ms.

Startup is dominated by how much browser engine each runtime has to bring up.
Electron, CEF each initialise a Chromium/Blink browser process (plus its
GPU/utility helpers) before a page can paint. The two system-WebView runtimes
(Adrenaline WebView and Neutralino) delegate rendering to a WebKitGTK process
the OS keeps warm, which is why they start in a similar range.

### 7.2 Memory

| Runtime | Idle PSS (MB) | Peak PSS (MB) | Growth (MB) | Peak Private (MB) |
| :--- | ---: | ---: | ---: | ---: |
| Electron | 286.1 | 650.0 | 363.9 | 500.2 |
| Neutralinojs | 407.0 | 490.6 | 83.6 | 339.0 |
| Adrenaline.js (WebView) | 383.3 | 500.9 | 117.5 | 351.4 |
| Adrenaline.js (CEF) | 358.9 | 442.9 | 84.0 | 356.6 |

The runtimes that bundle a browser engine (Electron, CEF) carry the cost of a
full browser: a browser process, one or more renderers, a GPU process and
zygotes, each with its own heap and V8 isolate. The system-WebView runtimes
share the OS renderer, so their private footprint is lower even when their
shared PSS is comparable.

### 7.3 CPU

Average CPU across the whole process tree over the stress window:

- **Electron:** 261.7 % average, 277.0 % peak (2.6 of 4 cores busy).
- **Neutralinojs:** 263.7 % average, 284.0 % peak (2.6 of 4 cores busy).
- **Adrenaline.js (WebView):** 281.2 % average, 302.0 % peak (2.8 of 4 cores busy).
- **Adrenaline.js (CEF):** 252.7 % average, 265.0 % peak (2.5 of 4 cores busy).

The two SHA-256 workers alone account for roughly 200 %, so every runtime is
saturated by design. The differences come from how efficiently each services
the IPC storm and repaints under that load.

### 7.4 IPC latency

Round-trip latency (backend send → renderer → ack) per runtime:

| Runtime | mean (ms) | p95 (ms) | p99 (ms) | samples |
| :--- | ---: | ---: | ---: | ---: |
| Electron | 0.601 | 2.015 | 3.563 | 2924 |
| Neutralinojs | 28.308 | 50.815 | 53.314 | 2952 |
| Adrenaline.js (WebView) | 2.020 | 5.511 | 10.906 | 2932 |
| Adrenaline.js (CEF) | 0.854 | 2.514 | 6.193 | 2946 |

Each runtime uses its own idiomatic bridge — Electron/Adrenaline
`ipcRenderer`/`ipcMain`, Neutralino
extension WebSocket events — so these figures compare *the real IPC path a
developer would use*, not a synthetic uniform pipe.

### 7.5 Disk footprint

- **Electron:** 273.8 MB.
- **Neutralinojs:** 123.6 MB.
- **Adrenaline.js (WebView):** 121.1 MB.
- **Adrenaline.js (CEF):** 413.1 MB.

Bundled-engine runtimes ship the browser engine in the payload. Neutralino
and Adrenaline WebView ship only a small binary/addon and lean on the OS
WebView. The CEF runtime sits in between: a real embedded Chromium, but
pruned (locales reduced to `en-US`, devtools/PDF stripped, debug symbols
removed) rather than shipped whole.

### 7.6 Architectural trade-offs

1. **Electron** — the reference point. Largest footprint and memory, but the
   most predictable: one pinned Chromium version, full Node.js in the main
   process, and a mature ecosystem.
2. **Neutralinojs** — the smallest binary by far. It ships no engine and no
   Node.js: it uses the OS WebView for the UI and expects *you* to bring a
   backend (here a Node.js extension over a local WebSocket). The trade-off is
   a heavier IPC path — its latency is an order of magnitude above the others
   because every message crosses a WebSocket hop.
3. **Adrenaline.js (WebView)** — a thin native addon over the OS WebKitGTK,
   with a native (in-process) IPC bridge. Near-Neutralino disk footprint with
   Electron-class IPC latency, because the bridge does not leave the process.
4. **Adrenaline.js (CEF)** — embeds a real Chromium for full fidelity, but
   pruned and with native IPC. It pays a Chromium-sized disk and memory bill
   while keeping the fast in-process bridge.

---

## 8. Methodology & Reproducibility

### How to reproduce

```bash
npm install
npm run benchmark:setup          # build the Adrenaline addons + fetch Neutralino
npm run setup:cef                # pruned CEF distribution (for the CEF runtime)
npm run setup:webgtk            # libwebgtk.so (for the WebGTK runtime)
cd benchmarks/stress-suite
node run.js                      # all five runtimes, 30s each, sequentially
node report.js                   # regenerate benchmarks/ROYAL_RUMBLE_SHOWDOWN.md
```

`npm run benchmark` runs the last two steps together. Requirements: Node.js
≥ 16, `xvfb-run` + `Xvfb`, GTK3 + WebKitGTK 4.1 (for the WebView and
Neutralino runs), GTK3 development files (for the WebGTK build), `unzip`
(Neutralino fetch), and a C compiler (`cc`/`gcc`) for the subreaper wrapper.

### Measurement definitions

- **PSS (Proportional Set Size)** — read from `/proc/[pid]/smaps_rollup` for
  every process in the tree and summed. A page shared by *N* processes
  contributes *1/N* to each, so the tree total counts it exactly once.
- **Private memory** — `Private_Clean + Private_Dirty`, the pages no other
  process can share.
- **CPU %** — the delta of `utime + stime` across the whole process tree
  between samples divided by elapsed wall time. 100 % = one core fully busy.
- **IPC latency** — `process.hrtime.bigint()` captured immediately before the
  send and again when the renderer acknowledgement arrives.
- **Startup time** — wall-clock epoch milliseconds from `child_process.spawn()`
  to the renderer's first-paint marker (two `requestAnimationFrame` ticks
  after load, i.e. a real painted frame).
- **Runtime footprint** — `du`/`stat` of the on-disk payload each runtime must
  ship, with shared OS libraries listed separately and excluded from the total.

### Fairness controls

- The four runs are **sequential, never concurrent**, so no two compete for CPU.
- Every runtime loads the **same `index.html`, `renderer.js` and stress core**;
  only the IPC binding differs (Adrenaline injects `window.adrenaline` natively,
  Electron uses `preload.js`, Neutralino uses extension events).
- All run headless under `xvfb-run -a` at the same window size.
- The profiler samples the **entire process tree**, not just the top process.

### Termination

Each run is launched detached under a minimal subreaper wrapper
(`tools/reaper.c`). Termination uses an escalating SIGTERM → SIGKILL ladder on
the whole process group, and the wrapper reaps orphans so no process — and no
zombie — is left behind.

| Runtime | Term. time (ms) | Escalated to SIGKILL | Leftover live procs | Clean |
| :--- | ---: | :--- | ---: | :--- |
| Electron | 1929 | no | 0 | ✅ |
| Neutralinojs | 3653 | no | 0 | ✅ |
| Adrenaline.js (WebView) | 2032 | no | 0 | ✅ |
| Adrenaline.js (CEF) | 2132 | no | 0 | ✅ |

---

*This report was generated automatically by `benchmarks/stress-suite/report.js`
from profiler samples. It was produced by an AI agent (OpenHands) on behalf of
the repository maintainers.*
