# Adrenaline.js

> **Ship only what you use. Eliminate everything else. The ultra-lightweight Electron alternative.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/adrenaline-js.svg)](https://www.npmjs.com/package/adrenaline-js)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

Adrenaline.js is an ultra-lightweight, high-performance desktop application framework for Node.js developers. By decoupling your app from Chromium bloat and offering both native OS webviews and a pruned, modular Chromium (CEF) engine, Adrenaline delivers blazing-fast desktop applications with tiny bundle sizes and minimal memory footprint.

Empirically benchmarked on **Linux x64 (Debian 13) under Xvfb**. Native Win32 and macOS Cocoa bindings are provided.

> *"Why not Tauri? Tauri is brilliant, but writing backend logic shouldn't require learning Rust and fighting the borrow checker. Adrenaline gives you the same lightweight native webviews using 100% Node.js and the full npm ecosystem you already know."*

---

## ⚡ Key Features

- **Dual-Engine Architecture (WebView & Pruned CEF):** Choose between an ultra-lightweight system webview (~5-10MB) or a 100% consistent, de-googled Chromium Embedded Framework (CEF) engine with compile-time physical bloat stripping.
- **Sub-Millisecond Mean IPC (0.85ms / 2.5ms p95):** Direct non-blocking communication between the frontend and the Node.js event loop using `Napi::ThreadSafeFunction` (TSFN). The CEF engine drives its message pump from an eventfd wake channel, so replies dispatch the instant they arrive rather than on the next loop tick.
- **Zero Rust / Go Barrier:** Built 100% for JavaScript and Node.js developers. Use your favorite npm packages natively without bridging or learning a new language.
- **Drop-in Electron-Compatible API:** Zero learning curve. Code with familiar abstractions including `app`, `BrowserWindow`, `ipcMain`, and native `dialog`.
- **Native OS Dialogs Module:** Non-blocking platform file pickers, save dialogs, and message boxes (`dialog.showOpenDialog`, `dialog.showSaveDialog`, `showMessageBox`) powered by native Win32, Cocoa, and GTK.
- **Modular Stripping Engine (`adrenaline.config.js`):** Physical compile-time tree-shaking purges unused components (PDF, WebRTC, DevTools, redundant locales) directly from the disk bundle.
- **Zero-Telemetry by Default:** Curated ungoogled-chromium optimization flags enforce low-memory device caching, disable background networking pings, and block WebRTC IP leaks.
- **Full TypeScript & Dual ESM/CJS Support:** First-class TypeScript declarations (`index.d.ts`) alongside simultaneous support for `import` (ESM) and `require` (CommonJS).
- **Built-in CLI & Scaffolder:** Rapid project bootstrapping with `npx adrenaline-js init` and `adrenaline dev`.

---

## 🚀 Quickstart Guide

Scaffold and launch a new project in seconds:

```bash
# 1. Scaffold a modern starter project
npx adrenaline-js init my-app

# 2. Navigate to your project folder
cd my-app

# 3. Install dependencies
npm install

# 4. Launch your desktop app!
npx adrenaline dev
```

---

## 👑 The Royal Rumble — 5-Way Runtime Showdown

An empirical, headless benchmark (`xvfb-run -a`) running five JavaScript desktop runtimes through an identical heavy workload for 30 seconds each: **10,000-record virtualized DOM mutations**, **100 JSON IPC packets/sec**, and **2 concurrent SHA-256 CPU worker threads**.

### Master Comparison Matrix

Lower is better for every metric. **Bold** marks the winner of each row.

| Metric | Electron (v45) | NW.js | Neutralinojs | Adrenaline (WebView) | Adrenaline (CEF) | Winner 🏆 |
| :--- | ---: | ---: | ---: | ---: | ---: | :--- |
| **Startup to First Paint** | **349 ms** | 4120 ms | 683 ms | 520 ms | 417 ms | **Electron** 🥇 |
| **Idle Memory (PSS)** | **286.1 MB** | 463.9 MB | 407.0 MB | 383.3 MB | 358.9 MB | **Electron** |
| **Peak Stress Memory (PSS)** | 650.0 MB | 917.7 MB | 490.6 MB | 500.9 MB | **442.9 MB** | **Adrenaline (CEF)** 🥇 |
| **Peak Private Memory** | 500.2 MB | 728.9 MB | **339.0 MB** | 351.4 MB | 356.6 MB | **Neutralinojs** 🥇 |
| **Total Shipped Payload** | 273.8 MB | 510.8 MB | 123.6 MB | **121.1 MB** | 413.1 MB | **Adrenaline (WebView)** 🥇 |
| **Process Count (Task Manager)** | 11 procs | 14 procs | 10 procs | 8 procs | **6 procs** | **Adrenaline (CEF)** 🥇 |
| **IPC Latency (mean / p95)** | 0.60 ms / **2.01 ms** | 0.93 ms / 2.52 ms | 28.31 ms / 50.82 ms | 2.02 ms / 5.51 ms | 0.85 ms / 2.51 ms | **Electron** 🥇 |
| **Real Node.js / npm Support** | Yes | Yes | **No** (custom) | **Yes** | **Yes** | — |

> **Key Takeaway:** Adrenaline (CEF) held the lowest memory under peak stress (**-31.9% vs Electron**, saving 207 MB RAM under a sustained 30s load) and spawned the smallest process tree (6 procs), while Adrenaline (WebView) shipped the smallest uncompressed distribution payload. Electron still wins cold start (349 ms) and IPC p95 (2.01 ms) — Adrenaline (CEF) follows at 417 ms and 2.51 ms.

*Full methodology, raw 350KB profiler trace, and process-by-process breakdowns available in `benchmarks/ROYAL_RUMBLE_SHOWDOWN.md`.*

### Engine Roles — Choose Your Trade-off

- **WebView Mode (The Lightweight King):** Ultra-small shipped footprint — **~121 MB total** including the Node.js runtime, of which the native addon itself is only **~0.3 MB**. Ideal for lightweight desktop utilities that can lean on the OS WebView.
- **Pruned CEF Mode (The Stress & Fidelity Tank):** Ships a **413 MB** pruned Chromium engine for 100% cross-platform rendering consistency, while using **32% less RAM under heavy stress** than Electron and spawning only **6 processes**.

---

## ⚙️ Configuration & Module Stripping (`adrenaline.config.js`)

Adrenaline allows developers to physically eliminate unused features from the final distribution:

```javascript
// adrenaline.config.js
module.exports = {
  engine: 'cef', // 'webview' (lightweight) or 'cef' (Chromium)
  modules: {
    devtools: false,          // Physically deletes devtools resource paks
    webrtc: false,            // Clamps down WebRTC & prevents IP leaks
    pdf: false,               // Strips PDF support
    cleanPrivacy: true,       // Injects aggressive low-end device & ungoogled flags
    softwareRasterizer: false // Prunes SwiftShader/Vulkan fallbacks (engine runs --disable-gpu)
  }
};
```

---

## 🛡️ Security Architecture & Content Policy

Adrenaline is designed for trusted local desktop application code:

- **CEF Engine Constraints:** CEF runs in `single-process` mode with sandbox disabled to maximize performance and avoid multi-process container overhead.
- **Local-Only Origin Enforcement:** By default, Adrenaline strictly enforces a local-origin policy via `RejectRemoteUrl` and `OnBeforeBrowse`. Navigating to untrusted remote websites (`http://`, `https://`) is rejected to prevent untrusted remote web code from executing within the host application process.
- **Zero-Telemetry:** All unwanted background Google pings, telemetry reporting, and WebRTC external IP leaks are blocked by default.

---

## 💻 Code Example

### Main Process (`main.js`)

```javascript
const { app, BrowserWindow, ipcMain, dialog } = require('adrenaline-js');
const path = require('path');

app.whenReady().then(() => {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        title: 'My Adrenaline App',
        resizable: true
    });

    win.loadFile(path.join(__dirname, 'index.html'));

    ipcMain.on('open-file-dialog', async (event) => {
        const result = await dialog.showOpenDialog({
            title: 'Select a document',
            filters: [{ name: 'Documents', extensions: ['txt', 'md', 'json'] }]
        });
        
        if (!result.canceled) {
            win.webContents.send('selected-file', result.filePaths[0]);
        }
    });
});
```

### Renderer Process (`index.html`)

```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>My Adrenaline App</title>
</head>
<body>
    <h1>Hello Adrenaline.js! ⚡</h1>
    <button onclick="pickFile()">Choose File</button>
    <p id="path-display">No file selected.</p>

    <script>
        function pickFile() {
            window.adrenaline.send('open-file-dialog', {});
        }

        window.adrenaline.on('selected-file', (filePath) => {
            document.getElementById('path-display').innerText = filePath;
        });
    </script>
</body>
</html>
```

---

## 🛠️ CLI Commands

Adrenaline comes with a built-in CLI tool for seamless developer experience:

- `adrenaline init <project-name>`: Scaffold a modern starter project with pre-configured IPC.
- `adrenaline dev` / `adrenaline start`: Run the desktop application in the current directory.
- `adrenaline --version` / `-v`: Display current CLI version.
- `adrenaline --help` / `-h`: Display help options and usage flags.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
