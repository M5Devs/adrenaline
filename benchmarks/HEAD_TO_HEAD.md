# Empirical Head-to-Head Benchmark Report: Adrenaline.js vs Electron

## Executive Summary
This report compares **Adrenaline.js (WebView-backed Node.js desktop runtime)** directly against standard **Electron** running the exact same complex frontend workload under identical headless execution conditions (`xvfb-run`).

## Workload Specification
Both runtimes executed an identical frontend application (`benchmarks/head-to-head/app/`) featuring:
- **Dynamic DOM Load:** Table rendering and live client-side filtering over **500+ records**.
- **Active Canvas Rendering:** Continuous **60fps animated particle system** with particle collision and line rendering.
- **Active Bidirectional IPC:** Background-to-renderer and renderer-to-background messages dispatched **every 500ms**.
- **Test Duration:** 10-second continuous active profiling run.

## Head-to-Head Comparison Table

| Metric | Electron | Adrenaline.js | Difference % |
| :--- | :--- | :--- | :--- |
| **Process Count** | 6 processes | 3 processes | -50.0% |
| **Startup Time to Paint** | 268 ms | 1848 ms | +589.6% |
| **Physical Memory (PSS)** | 246.79 MB | 394.31 MB | +59.8% |
| **Peak Resident Memory (RSS)** | 522.71 MB | 581.45 MB | +11.2% |
| **Disk / Bundle Footprint** | 274.84 MB | 302.07 MB | +9.9% |

## Process Tree Breakdown

### Electron Process Footprint
| PID | Name / Executable | Inferred Role | RSS (MB) | PSS (MB) |
| :--- | :--- | :--- | :--- | :--- |
| 89851 | `electron` | Main Process (Electron) | 144.18 | 82.62 |
| 89855 | `electron` | Utility / Helper Process | 55.51 | 15.24 |
| 89882 | `electron` | GPU Process | 63.04 | 23.02 |
| 89856 | `electron` | Utility / Helper Process | 55.04 | 15.07 |
| 89899 | `electron` | Renderer Process | 129.80 | 83.38 |
| 89884 | `electron` | Utility / Helper Process | 72.34 | 26.11 |

### Adrenaline.js Process Footprint
| PID | Name / Executable | Inferred Role | RSS (MB) | PSS (MB) |
| :--- | :--- | :--- | :--- | :--- |
| 89482 | `node` | Main Node Process (Adrenaline) | 201.82 | 110.10 |
| 89621 | `WebKitNetworkPr` | WebKit Web Process | 54.55 | 27.12 |
| 89629 | `WebKitWebProces` | WebKit Web Process | 323.09 | 254.78 |

## Measurement Methodology
1. **Process Tracking:** The benchmark harness monitors process parent-child relationships using `pgrep` recursively from the root process PID.
2. **Proportional Set Size (PSS):** Summed directly from `/proc/[pid]/smaps_rollup` across all processes in the runtime tree. PSS accounts for shared libraries without double-counting shared OS pages.
3. **Resident Set Size (RSS):** Summed total peak memory resident in RAM.
4. **Startup Time:** Precise time elapsed from initial process spawn to renderer initialization and interactive paint acknowledgment (`app-ready` signal sent over IPC).
5. **Cleanup:** Complete SIGKILL process tree termination after sampling to guarantee zero leftover background child processes.
