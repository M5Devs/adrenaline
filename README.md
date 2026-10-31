# Adrenaline.js

> **Ship only what you use. Eliminate everything else. The ultra-lightweight Electron alternative.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/adrenaline-js.svg)](https://www.npmjs.com/package/adrenaline-js)
[![Node.js](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)](https://nodejs.org/)

Adrenaline.js is an ultra-lightweight, high-performance desktop application framework for Node.js developers. By decoupling your app from Chromium bloat and leveraging native OS system engines with compile-time modularity, Adrenaline delivers blazing-fast desktop applications with tiny bundle sizes and minimal memory footprint.

> *"Why not Tauri? Tauri is brilliant, but writing backend logic shouldn't require learning Rust and fighting the borrow checker. Adrenaline gives you the same lightweight native webviews using 100% Node.js and the full npm ecosystem you already know."*

---

## ⚡ Key Features

- **Tiny Bundle & Minimal Footprint:** Eliminate 150MB+ Chromium bloat. Shipped runtimes start as small as ~5-10MB with ultra-low baseline RAM.
- **Zero Rust / Go Barrier:** Built 100% for JavaScript and Node.js developers. Use your favorite npm packages natively without bridging or learning a new language.
- **Drop-in Electron-Compatible API:** Zero learning curve. Code with familiar abstractions including `app`, `BrowserWindow`, `ipcMain`, and native `dialog`.
- **Native OS Dialogs Module:** Non-blocking platform file pickers, save dialogs, and message boxes (`dialog.showOpenDialog`, `dialog.showSaveDialog`, `showMessageBox`) powered by native Win32, Cocoa, and GTK.
- **Modular Native Architecture (`features.h`):** Compile-time tree-shaking allows excluding unused browser capabilities (PDF, WebRTC, DevTools) directly from the native binary.
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

## 📊 Comparison: Adrenaline vs Electron vs Tauri

| Feature | **Adrenaline.js** ⚡ | **Electron** ⚛️ | **Tauri** 🦀 |
| :--- | :--- | :--- | :--- |
| **Language / Runtime** | **Node.js / JavaScript** | Node.js / JavaScript | Rust / Web view |
| **App Bundle Size** | **~5 – 10 MB** | ~150 MB+ | ~5 – 10 MB |
| **Peak Stress Memory (PSS)** | **~505 MB (-31.6%)** | ~739 MB | ~480 MB |
| **Backend Language** | **JavaScript / Node.js** | JavaScript / Node.js | Rust |
| **Learning Curve** | **Zero (Electron API)** | Easy | High (Requires Rust) |
| **npm Ecosystem** | **Full Native Support** | Full Native Support | Limited (Requires bridges) |
| **Rendering Engine** | **Native OS Webview / Modular CEF** | Bundled Chromium | System Native Webview |

---

## 🔬 Empirical Stress Benchmark (30s Sustained Load)

Tested on identical workloads under headless execution: 10,000-record virtualized DOM mutations, 100 JSON IPC packets/sec, and 2 concurrent SHA-256 worker threads.

| Metric | Electron (v45 Baseline) | Adrenaline.js (v0.2.0) | Delta |
| :--- | :--- | :--- | :--- |
| **Peak Stress Memory (PSS)** | 739.5 MB | **505.6 MB** | **-31.6% (234 MB saved)** |
| **Peak Private Memory** | 606.9 MB | **354.6 MB** | **-41.6% (252 MB saved)** |
| **Total Shipped Runtime Size** | 273.7 MB | **121.5 MB** | **-55.6% smaller** |
| **IPC Packet Loss** | 0 unacknowledged | **0 unacknowledged** | **100% Reliable** |

*Full methodology, profiler harness, and raw sample traces available in `benchmarks/STRESS_TEST.md`.*

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

This project is licensed under the [MIT License](LICENSE)
