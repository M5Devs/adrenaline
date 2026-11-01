# Adrenaline.js

> **Ship only what you use. Eliminate everything else. The ultra-lightweight Electron alternative.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/adrenaline-js.svg)](https://www.npmjs.com/package/adrenaline-js)
[![Node.js](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)](https://nodejs.org/)

Adrenaline.js is an ultra-lightweight, high-performance desktop application framework for Node.js developers. By decoupling your app from Chromium bloat and offering both native OS webviews and a pruned, modular Chromium (CEF) engine, Adrenaline delivers blazing-fast desktop applications with tiny bundle sizes and minimal memory footprint.

> *"Why not Tauri? Tauri is brilliant, but writing backend logic shouldn't require learning Rust and fighting the borrow checker. Adrenaline gives you the same lightweight native webviews using 100% Node.js and the full npm ecosystem you already know."*

---

## ⚡ Key Features

- **Dual-Engine Architecture (WebView & Pruned CEF):** Choose between an ultra-lightweight system webview (~5-10MB) or a 100% consistent, de-googled Chromium Embedded Framework (CEF) engine with compile-time physical bloat stripping.
- **Zero Rust / Go Barrier:** Built 100% for JavaScript and Node.js developers. Use your favorite npm packages natively without bridging or learning a new language.
- **Drop-in Electron-Compatible API:** Zero learning curve. Code with familiar abstractions including `app`, `BrowserWindow`, `ipcMain`, and native `dialog`.
- **Native OS Dialogs Module:** Non-blocking platform file pickers, save dialogs, and message boxes (`dialog.showOpenDialog`, `dialog.showSaveDialog`, `showMessageBox`) powered by native Win32, Cocoa, and GTK.
- **Modular Stripping Engine (`adrenaline.config.js`):** Physical compile-time tree-shaking purges unused components (PDF, WebRTC, DevTools, redundant locales) directly from the disk bundle.
- **Zero-Telemetry by Default:** Curated ungoogled-chromium optimization flags enforce low-memory device caching, disable background networking pings, and block WebRTC IP leaks.
- **Full TypeScript & Dual ESM/CJS Support:** First-class TypeScript declarations (`index.d.ts`) alongside simultaneous support for `import` (ESM) and `require` (CommonJS).
- **Sub-Millisecond Multithreaded IPC:** Direct non-blocking communication between the frontend and the Node.js event loop using `Napi::ThreadSafeFunction` (TSFN).
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

| Metric | Electron (v45) | NW.js | Neutralinojs | Adrenaline (WebView) | Adrenaline (CEF) | Winner 🏆 |
| :--- | ---: | ---: | ---: | ---: | ---: | :--- |
| **Startup to First Paint** | 394 ms | 567 ms | 530 ms | 509 ms | **382 ms** | **Adrenaline (CEF)** 🥇 |
| **Peak Stress Memory (PSS)** | 717.3 MB | 924.6 MB | 486.4 MB | 496.8 MB | **439.4 MB** | **Adrenaline (CEF)** 🥇 |
| **Peak Private Memory** | 565.1 MB | 732.7 MB | **344.2 MB** | 346.3 MB | 356.6 MB | **Neutralinojs** |
| **Total Shipped Payload** | 273.8 MB | 510.8 MB | 123.6 MB | **121.1 MB** | 620.0 MB | **Adrenaline (WebView)** 🥇 |
| **Process Count (Task Manager)** | 11 procs | 14 procs | 10 procs | 8 procs | **6 procs** | **Adrenaline (CEF)** 🥇 |
| **Real Node.js / npm Support** | Yes | Yes | **No** (custom) | **Yes** | **Yes** | — |

> **Key Takeaway:** Adrenaline (CEF) held the lowest memory under peak stress (**-38.7% vs Electron**, saving 278 MB RAM) and achieved the fastest cold startup, while Adrenaline (WebView) shipped the smallest uncompressed distribution payload.

*Full methodology, raw 350KB profiler trace, and process-by-process breakdowns available in `benchmarks/ROYAL_RUMBLE_SHOWDOWN.md`.*

---

## ⚙️ Configuration & Module Stripping (`adrenaline.config.js`)

Adrenaline allows developers to physically eliminate unused features from the final distribution:

```javascript
// adrenaline.config.js
module.exports = {
  engine: 'cef', // 'webview' (lightweight) or 'cef' (Chromium)
  modules: {
    devtools: false,   // Physically deletes devtools resource paks
    webrtc: false,     // Clamps down WebRTC & prevents IP leaks
    pdf: false,        // Strips PDF support
    cleanPrivacy: true // Injects aggressive low-end device & ungoogled flags
  }
};
```

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
