# Empirical Head-to-Head Benchmark Report: Adrenaline.js vs Electron

## Executive Summary
This report compares **Adrenaline.js (WebView-backed Node.js desktop runtime)** directly against standard **Electron** running the exact same complex frontend productivity workload under identical headless execution conditions (`xvfb-run`).

## Workload Specification
Both runtimes executed an identical frontend application (`benchmarks/head-to-head/app/`) featuring a realistic desktop productivity suite:
- **Dynamic Productivity Dataset:** 1,000+ live records with continuous search filtering, column sorting, and row mutations.
- **Glassmorphism UI:** Modern backdrop filters, CSS transitions, and sticky headers.
- **Active Bidirectional IPC:** Continuous background-to-renderer and renderer-to-background messages every **200ms**.
- **Test Duration:** 10-second continuous active profiling run.

## Head-to-Head Comparison Table

| Metric | Electron | Adrenaline.js | Difference % |
| :--- | :--- | :--- | :--- |
| **Process Count** | 6 processes | 3 processes | -50.0% |
| **Startup Time to Paint** | 471 ms | 2318 ms | +392.1% |
| **Physical Memory (PSS)** | 311.56 MB | 431.23 MB | +38.4% |
| **Peak Resident Memory (RSS)** | 596.11 MB | 619.13 MB | +3.9% |
| **Disk / Runtime Bundle Footprint** | 273.66 MB | 0.32 MB | -99.9% |

## Process Tree Breakdown

### Electron Process Footprint
| PID | Name / Executable | Inferred Role | RSS (MB) | PSS (MB) |
| :--- | :--- | :--- | :--- | :--- |
| 158267 | `electron` | Main Process (Electron) | 144.68 | 81.54 |
| 158271 | `electron` | Utility / Helper Process | 55.17 | 15.25 |
| 158296 | `electron` | GPU Process | 76.33 | 31.79 |
| 158272 | `electron` | Utility / Helper Process | 54.78 | 14.99 |
| 158316 | `electron` | Renderer Process | 192.23 | 141.82 |
| 158298 | `electron` | Utility / Helper Process | 72.70 | 25.93 |

### Adrenaline.js Process Footprint
| PID | Name / Executable | Inferred Role | RSS (MB) | PSS (MB) |
| :--- | :--- | :--- | :--- | :--- |
| 157551 | `node` | Main Node Process (Adrenaline) | 203.18 | 111.02 |
| 157701 | `WebKitNetworkPr` | WebKit Web Process | 54.63 | 27.27 |
| 157704 | `WebKitWebProces` | WebKit Web Process | 359.31 | 290.92 |

## Measurement Methodology
1. **Process Tracking:** The benchmark harness monitors process parent-child relationships using `pgrep` recursively from the root process PID.
2. **Proportional Set Size (PSS):** Summed directly from `/proc/[pid]/smaps_rollup` across all processes in the runtime tree. PSS accounts for shared OS libraries without double-counting.
3. **Resident Set Size (RSS):** Summed total peak memory resident in RAM.
4. **Startup Time:** Precise time elapsed from initial process spawn to renderer initialization and interactive paint acknowledgment (`app-ready` signal sent over IPC).
5. **Runtime Disk Footprint:** Electron footprint measures its required bundled Chromium/Node runtime distribution (`node_modules/electron/dist`). Adrenaline footprint measures the native C++ addon (`build/Release/adrenaline.node`), JavaScript libraries (`lib/`), and application files.
6. **Cleanup:** Complete SIGKILL process tree termination after sampling to guarantee zero leftover background child processes.
