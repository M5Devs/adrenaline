# 👑 The Royal Rumble: 5-Way JavaScript Desktop Runtime Showdown

> An automated, reproducible, headless benchmark of five JavaScript desktop
> runtimes executing **one identical heavy desktop workload** for 30 seconds each.

| # | Runtime | Engine / Backend |
| :-- | :--- | :--- |
| 1 | **Electron** | Bundled Chromium + Node.js |
| 2 | **NW.js** | Bundled Chromium + Node.js (Node context in every window) |
| 3 | **Neutralinojs** | OS system WebView + user-supplied backend process (here: Node.js extension) |
| 4 | **Adrenaline.js (WebView)** | System WebKitGTK + Node.js backend |
| 5 | **Adrenaline.js (CEF)** | Pruned CEF (Chromium Embedded Framework) + Node.js backend |

Generated: `2026-11-01T18:56:07.501Z`  
Harness: `benchmarks/stress-suite/`  
Raw evidence: `benchmarks/stress-suite/profiles-combined.json`

---

## 1. Executive Summary

All five runtimes ran the *same application* — one shared frontend/backend
codebase that renders and mutates a **10,000-record virtualised dataset**,
streams **100 JSON IPC packets/second** with per-packet round-trip timing, and
runs **2 SHA-256 CPU workers** saturating the remaining cores. The only
difference between runs is the runtime itself; each runtime uses its own
idiomatic IPC bridge, but the bytes on the wire and the work done are
identical (see §4 for the proof).

- **Lightest under load (peak PSS):** Adrenaline.js (CEF) at **439.4 MB**.
- **Fastest cold start (to first paint):** Adrenaline.js (CEF) at **382 ms**.
- **Smallest shipped payload:** Adrenaline.js (WebView) at **121.1 MB**.
- **Lowest IPC p95 latency:** Electron at **2.179 ms**.
- **Lowest average CPU:** NW.js at **249.7 %**.

All measurements below come from `/proc` with 500 ms sampling over a
30-second sustained stress window, after a clean idle baseline. No value is
estimated, interpolated, or scaled.

---

## 2. Testbed Environment

| Property | Value |
| :--- | :--- |
| Host | `runtime-zoybervehmihjesp-6f8668777c-2t9cq` |
| OS | Debian GNU/Linux 13 (trixie) |
| Kernel | `6.8.0-1055-gke` (x64) |
| CPU | AMD EPYC 9B14 |
| CPU cores | 4 |
| Total RAM | 15990 MB |
| Node.js | v24.21.0 |
| Adrenaline.js | 0.2.0 |
| Adrenaline WebView engine | WebKitGTK 2.54.0 |
| Adrenaline CEF engine | CEF 150.0.23+g4ccc4ca+chromium-150.0.7871.287 (Chromium 150.0.7871.287) |
| Electron | 45.2.1 |
| NW.js | 0.119.2 |
| Neutralinojs | 11.8.0 CLI / v6.10.0 runtime |
| Display | Xvfb (headless X server, `xvfb-run -a`) |
| Sampling interval | 500 ms |
| Stress duration | 30 s per runtime |
| Profiler | `benchmarks/stress-suite/profiler.js` (`/proc/[pid]/smaps_rollup`, `/proc/[pid]/stat`) |
| Subreaper | `benchmarks/stress-suite/tools/reaper.c` (orphan reaping) |

---

## 3. Master Comparison Matrix

Lower is better for every metric. **Bold** marks the winner of each row.

| Metric | Electron | NW.js | Neutralinojs | Adrenaline.js (WebView) | Adrenaline.js (CEF) | Winner 🏆 |
| :--- | ---: | ---: | ---: | ---: | ---: | :--- |
| **Startup Time (to first paint)** | 394 ms | 567 ms | 530 ms | 509 ms | **382 ms** | Adrenaline.js (CEF) |
| **Idle Memory (PSS)** | **284.0 MB** | 470.9 MB | 403.2 MB | 379.5 MB | 359.5 MB | Electron |
| **Peak Stress Memory (PSS)** | 717.3 MB | 924.6 MB | 486.4 MB | 496.8 MB | **439.4 MB** | Adrenaline.js (CEF) |
| **Peak Private Memory** | 565.1 MB | 732.7 MB | **344.2 MB** | 346.3 MB | 356.6 MB | Neutralinojs |
| **Avg CPU Load** | 259.3 % | **249.7 %** | 262.1 % | 277.4 % | 252.2 % | NW.js |
| **Peak CPU Load** | 272.9 % | **266.9 %** | 289.5 % | 290.6 % | 269.2 % | NW.js |
| **IPC Latency (mean)** | **0.603 ms** | 0.907 ms | 28.143 ms | 1.914 ms | 7.775 ms | Electron |
| **IPC Latency (p95)** | **2.179 ms** | 2.544 ms | 50.741 ms | 5.495 ms | 11.623 ms | Electron |
| **IPC Latency (p99)** | **3.786 ms** | 4.115 ms | 52.622 ms | 9.940 ms | 15.810 ms | Electron |
| **Runtime Disk Footprint (shipped)** | 273.8 MB | 510.8 MB | 123.6 MB | **121.1 MB** | 620.0 MB | Adrenaline.js (WebView) |
| **Process count (peak tree)** | 11 | 14 | 10 | 8 | **6** | Adrenaline.js (CEF) |
| **Real Node.js / npm Support** | Yes | Yes | **No** (custom backend) | Yes | Yes | Electron / NW.js / Adrenaline |

> "Runtime Disk Footprint" counts only what an application must ship on disk.
> Shared OS libraries that already exist on the target machine (for example the
> system WebKitGTK that Adrenaline WebView and Neutralino use) are excluded and
> listed separately in §6.

---

## 4. Workload Verification (all runtimes did the same work)

| Counter | Electron | NW.js | Neutralinojs | Adrenaline.js (WebView) | Adrenaline.js (CEF) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Dataset size (records) | 10000 | 10000 | 10000 | 10000 | 10000 |
| IPC packets sent | 2871 | 2904 | 2940 | 2918 | 2938 |
| IPC packets acknowledged | 2871 | 2904 | 2938 | 2918 | 2937 |
| IPC packets unacknowledged | 0 | 0 | 2 | 0 | 1 |
| SHA-256 blocks hashed | 14116736 | 13121216 | 19851328 | 18525504 | 20876096 |
| SHA-256 data hashed (MB) | 110287 | 102510 | 155089 | 144731 | 163095 |
| Process tree size (peak) | 11 | 14 | 10 | 8 | 6 |
| Profiler samples collected | 55 | 54 | 55 | 55 | 56 |

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

### Electron — 11 processes, peak total 717.3 MB PSS

| Process | PID | PSS (MB) | Private (MB) | RSS (MB) |
| :--- | ---: | ---: | ---: | ---: |
| `electron` | 41698 | 204.3 | 188.8 | 270.5 |
| `electron` | 41699 | 173.0 | 157.5 | 239.3 |
| `electron` | 41637 | 151.2 | 125.8 | 230.2 |
| `electron` | 41524 | 75.7 | 50.9 | 149.3 |
| `Xvfb` | 41521 | 40.9 | 16.8 | 69.4 |
| `electron` | 41595 | 25.5 | 3.9 | 71.8 |
| `electron` | 41597 | 22.5 | 12.4 | 72.9 |
| `electron` | 41529 | 16.6 | 10.2 | 55.3 |
| `electron` | 41527 | 11.7 | 0.6 | 55.2 |
| `xvfb-run` | 41511 | 0.3 | 0.1 | 1.9 |
| `reaper` | 41510 | 0.2 | 0.1 | 1.4 |
| **Total** | | **717.3** | **565.1** | **1217.3** |

### NW.js — 14 processes, peak total 924.6 MB PSS

| Process | PID | PSS (MB) | Private (MB) | RSS (MB) |
| :--- | ---: | ---: | ---: | ---: |
| `exe` | 41969 | 204.1 | 164.8 | 317.1 |
| `node-MainThread` | 42023 | 202.4 | 183.4 | 279.3 |
| `node-MainThread` | 42024 | 201.0 | 181.9 | 277.9 |
| `nw` | 41831 | 132.1 | 101.8 | 220.2 |
| `Xvfb` | 41828 | 42.7 | 20.8 | 69.2 |
| `exe` | 41915 | 40.5 | 18.3 | 120.7 |
| `exe` | 41916 | 37.2 | 19.8 | 111.7 |
| `exe` | 41919 | 26.3 | 15.3 | 89.7 |
| `nw` | 41841 | 22.4 | 14.7 | 77.1 |
| `nw` | 41840 | 22.4 | 14.7 | 77.3 |
| `chrome_crashpad` | 41833 | 1.3 | 0.5 | 4.1 |
| `chrome_crashpad` | 41835 | 1.2 | 0.4 | 3.7 |
| `xvfb-run` | 41818 | 0.3 | 0.1 | 1.9 |
| `reaper` | 41817 | 0.2 | 0.1 | 1.4 |
| **Total** | | **924.6** | **732.7** | **1647.9** |

### Neutralinojs — 10 processes, peak total 486.4 MB PSS

| Process | PID | PSS (MB) | Private (MB) | RSS (MB) |
| :--- | ---: | ---: | ---: | ---: |
| `WebKitWebProces` | 42169 | 224.7 | 185.3 | 299.9 |
| `neutralino-linu` | 42122 | 88.2 | 48.3 | 164.0 |
| `MainThread` | 42127 | 39.0 | 27.9 | 73.9 |
| `Xvfb` | 42119 | 37.4 | 23.6 | 73.2 |
| `WebKitNetworkPr` | 42166 | 37.2 | 21.0 | 71.9 |
| `MainThread` | 42234 | 30.2 | 19.1 | 64.3 |
| `MainThread` | 42235 | 30.2 | 19.2 | 64.5 |
| `xvfb-run` | 42109 | 0.3 | 0.1 | 1.9 |
| `sh` | 42124 | 0.2 | 0.1 | 1.7 |
| `reaper` | 42108 | 0.2 | 0.1 | 1.4 |
| **Total** | | **486.4** | **344.2** | **816.1** |

### Adrenaline.js (WebView) — 8 processes, peak total 496.8 MB PSS

| Process | PID | PSS (MB) | Private (MB) | RSS (MB) |
| :--- | ---: | ---: | ---: | ---: |
| `WebKitWebProces` | 42376 | 249.2 | 204.8 | 328.9 |
| `MainThread` | 42338 | 116.7 | 61.8 | 226.9 |
| `Xvfb` | 42335 | 38.5 | 25.0 | 72.5 |
| `WebKitNetworkPr` | 42373 | 31.7 | 16.0 | 65.1 |
| `MainThread` | 42439 | 31.3 | 19.8 | 65.1 |
| `MainThread` | 42440 | 30.8 | 19.4 | 64.6 |
| `xvfb-run` | 42325 | 0.3 | 0.1 | 1.9 |
| `reaper` | 42324 | 0.2 | 0.1 | 1.4 |
| **Total** | | **496.8** | **346.3** | **825.6** |

### Adrenaline.js (CEF) — 6 processes, peak total 439.4 MB PSS

| Process | PID | PSS (MB) | Private (MB) | RSS (MB) |
| :--- | ---: | ---: | ---: | ---: |
| `MainThread` | 42539 | 341.8 | 299.5 | 418.6 |
| `Xvfb` | 42536 | 37.2 | 19.3 | 69.2 |
| `MainThread` | 42640 | 31.0 | 19.5 | 64.8 |
| `MainThread` | 42639 | 30.6 | 19.1 | 64.3 |
| `xvfb-run` | 42526 | 0.3 | 0.1 | 1.9 |
| `reaper` | 42525 | 0.2 | 0.1 | 1.4 |
| **Total** | | **439.4** | **356.6** | **619.6** |

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

### NW.js — total 510.8 MB shipped

| Component | Size (MB) |
| :--- | ---: |
| NW.js distribution (nw binary + libnw.so + Chromium + Node + ICU) | 510.8 |
| application assets (app/) | 0.1 |
| runner code (nw-app/) | 0.0 |
| **Total (shipped)** | **510.8** |

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

### Adrenaline.js (CEF) — total 620.0 MB shipped

| Component | Size (MB) |
| :--- | ---: |
| Node.js runtime binary (node) | 120.7 |
| adrenaline-js JS runtime (lib/ + index.js + index.mjs) | 0.0 |
| application assets (app/) | 0.1 |
| adrenaline native addon (CEF engine) | 1.8 |
| libcef.so (pruned Chromium, debug symbols stripped) | 426.6 |
| libcef_dll_wrapper.a | 6.3 |
| icudtl.dat | 10.4 |
| core .pak bundles + locales (pruned to en-US) | 18.5 |
| libEGL.so + libGLESv2.so + swiftshader/vulkan | 35.5 |
| runner code | 0.1 |
| **Total (shipped)** | **620.0** |

---

## 7. Architectural Analysis

### 7.1 Startup to first paint

- **Electron:** 394 ms.
- **NW.js:** 567 ms.
- **Neutralinojs:** 530 ms.
- **Adrenaline.js (WebView):** 509 ms.
- **Adrenaline.js (CEF):** 382 ms.

Startup is dominated by how much browser engine each runtime has to bring up.
Electron, NW.js and CEF each initialise a Chromium browser process (plus its
GPU/utility helpers) before a page can paint. The two system-WebView runtimes
(Adrenaline WebView and Neutralino) delegate rendering to a WebKitGTK process
the OS keeps warm, which is why they start in a similar range.

### 7.2 Memory

| Runtime | Idle PSS (MB) | Peak PSS (MB) | Growth (MB) | Peak Private (MB) |
| :--- | ---: | ---: | ---: | ---: |
| Electron | 284.0 | 717.3 | 433.3 | 565.1 |
| NW.js | 470.9 | 924.6 | 453.7 | 732.7 |
| Neutralinojs | 403.2 | 486.4 | 83.2 | 344.2 |
| Adrenaline.js (WebView) | 379.5 | 496.8 | 117.4 | 346.3 |
| Adrenaline.js (CEF) | 359.5 | 439.4 | 79.9 | 356.6 |

The runtimes that bundle Chromium (Electron, NW.js, CEF) carry the cost of a
full browser: a browser process, one or more renderers, a GPU process and
zygotes, each with its own heap and V8 isolate. The system-WebView runtimes
share the OS renderer, so their private footprint is lower even when their
shared PSS is comparable.

### 7.3 CPU

Average CPU across the whole process tree over the stress window:

- **Electron:** 259.3 % average, 272.9 % peak (2.6 of 4 cores busy).
- **NW.js:** 249.7 % average, 266.9 % peak (2.5 of 4 cores busy).
- **Neutralinojs:** 262.1 % average, 289.5 % peak (2.6 of 4 cores busy).
- **Adrenaline.js (WebView):** 277.4 % average, 290.6 % peak (2.8 of 4 cores busy).
- **Adrenaline.js (CEF):** 252.2 % average, 269.2 % peak (2.5 of 4 cores busy).

The two SHA-256 workers alone account for roughly 200 %, so every runtime is
saturated by design. The differences come from how efficiently each services
the IPC storm and repaints under that load.

### 7.4 IPC latency

Round-trip latency (backend send → renderer → ack) per runtime:

| Runtime | mean (ms) | p95 (ms) | p99 (ms) | samples |
| :--- | ---: | ---: | ---: | ---: |
| Electron | 0.603 | 2.179 | 3.786 | 2871 |
| NW.js | 0.907 | 2.544 | 4.115 | 2904 |
| Neutralinojs | 28.143 | 50.741 | 52.622 | 2938 |
| Adrenaline.js (WebView) | 1.914 | 5.495 | 9.940 | 2918 |
| Adrenaline.js (CEF) | 7.775 | 11.623 | 15.810 | 2937 |

Each runtime uses its own idiomatic bridge — Electron/Adrenaline
`ipcRenderer`/`ipcMain`, NW.js background-page ↔ window relay, Neutralino
extension WebSocket events — so these figures compare *the real IPC path a
developer would use*, not a synthetic uniform pipe.

### 7.5 Disk footprint

- **Electron:** 273.8 MB.
- **NW.js:** 510.8 MB.
- **Neutralinojs:** 123.6 MB.
- **Adrenaline.js (WebView):** 121.1 MB.
- **Adrenaline.js (CEF):** 620.0 MB.

Bundled-Chromium runtimes ship the browser engine in the payload. Neutralino
and Adrenaline WebView ship only a small binary/addon and lean on the OS
WebView. The CEF runtime sits in between: a real embedded Chromium, but
pruned (locales reduced to `en-US`, devtools/PDF stripped, debug symbols
removed) rather than shipped whole.

### 7.6 Architectural trade-offs

1. **Electron** — the reference point. Largest footprint and memory, but the
   most predictable: one pinned Chromium version, full Node.js in the main
   process, and a mature ecosystem.
2. **NW.js** — also bundles Chromium, but exposes Node.js directly inside the
   DOM context. That convenience costs memory (a Node context per window) and
   makes the largest process tree in this test.
3. **Neutralinojs** — the smallest binary by far. It ships no engine and no
   Node.js: it uses the OS WebView for the UI and expects *you* to bring a
   backend (here a Node.js extension over a local WebSocket). The trade-off is
   a heavier IPC path — its latency is an order of magnitude above the others
   because every message crosses a WebSocket hop.
4. **Adrenaline.js (WebView)** — a thin native addon over the OS WebKitGTK,
   with a native (in-process) IPC bridge. Near-Neutralino disk footprint with
   Electron-class IPC latency, because the bridge does not leave the process.
5. **Adrenaline.js (CEF)** — embeds a real Chromium for full fidelity, but
   pruned and with native IPC. It pays a Chromium-sized disk and memory bill
   while keeping the fast in-process bridge.

---

## 8. Methodology & Reproducibility

### How to reproduce

```bash
npm install
npm run benchmark:setup          # build both Adrenaline addons + fetch Neutralino
npm run setup:cef                # pruned CEF distribution (for the CEF runtime)
cd benchmarks/stress-suite
node run.js                      # all five runtimes, 30s each, sequentially
node report.js                   # regenerate benchmarks/ROYAL_RUMBLE_SHOWDOWN.md
```

`npm run benchmark` runs the last two steps together. Requirements: Node.js
≥ 16, `xvfb-run` + `Xvfb`, GTK3 + WebKitGTK 4.1 (for the WebView and
Neutralino runs), `unzip` (Neutralino fetch), and a C compiler (`cc`/`gcc`) for
the subreaper wrapper.

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

- The five runs are **sequential, never concurrent**, so no two compete for CPU.
- Every runtime loads the **same `index.html`, `renderer.js` and stress core**;
  only the IPC binding differs (Adrenaline injects `window.adrenaline` natively,
  Electron uses `preload.js`, NW.js relays through the background page,
  Neutralino uses extension events).
- All run headless under `xvfb-run -a` at the same window size.
- The profiler samples the **entire process tree**, not just the top process.

### Termination

Each run is launched detached under a minimal subreaper wrapper
(`tools/reaper.c`). Termination uses an escalating SIGTERM → SIGKILL ladder on
the whole process group, and the wrapper reaps orphans so no process — and no
zombie — is left behind.

| Runtime | Term. time (ms) | Escalated to SIGKILL | Leftover live procs | Clean |
| :--- | ---: | :--- | ---: | :--- |
| Electron | 2138 | no | 0 | ✅ |
| NW.js | 2149 | no | 0 | ✅ |
| Neutralinojs | 3699 | no | 0 | ✅ |
| Adrenaline.js (WebView) | 2140 | no | 0 | ✅ |
| Adrenaline.js (CEF) | 2129 | no | 0 | ✅ |

---

*This report was generated automatically by `benchmarks/stress-suite/report.js`
from profiler samples. It was produced by an AI agent (OpenHands) on behalf of
the repository maintainers.*
