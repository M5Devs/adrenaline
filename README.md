# Adrenaline.js

> **Ship only what you use. Eliminate everything else. The ultra-lightweight Electron alternative.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)](https://nodejs.org/)

Adrenaline.js is an ultra-lightweight, high-performance desktop application framework for Node.js developers. By using native OS system webviews (WebKit on macOS/Linux, WebView2 on Windows) instead of bundling an entire Chromium browser, Adrenaline delivers blazing-fast desktop applications with tiny bundle sizes and minimal memory footprint.

> *"Why not Tauri? Tauri is brilliant, but writing backend logic shouldn't require learning Rust and fighting the borrow checker. Adrenaline gives you the same lightweight native webviews using 100% Node.js and the full npm ecosystem you already know."*

---

## ⚡ Key Features

- **Tiny Bundle & Footprint (5-10 MB vs 150 MB+):** Native system webviews remove Chromium bloat, drastically reducing application installer size and RAM usage.
- **Zero Rust / Go Barrier:** Written 100% for Node.js & JavaScript developers. Use your favorite npm packages without learning a new language or toolchain.
- **Drop-in Electron-like API:** Work with familiar APIs like `app`, `BrowserWindow`, and `ipcMain` out of the box with zero learning curve.
- **Full TypeScript & Dual ESM/CJS Support:** First-class TypeScript type declarations (`index.d.ts`) with seamless CommonJS (`require`) and ES Module (`import`) exports.
- **Bidirectional IPC:** High-speed asynchronous inter-process communication between Node.js backend processes and webview frontends.
- **Built-in CLI & Scaffolder:** Instant project scaffolding and execution with `npx adrenaline-js init` and `adrenaline dev`.

---

## 🚀 Quickstart Guide

Scaffold and launch a new project in seconds:

```bash
# 1. Create a new Adrenaline.js project
npm install adrenaline-js
# or scaffold a new project:
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
| **Language / Runtime** | Node.js / JavaScript | Node.js / JavaScript | Rust / Web view |
| **App Bundle Size** | **~5 – 10 MB** | ~150 MB+ | ~5 – 10 MB |
| **Memory Footprint** | **Ultra-Low (~30 MB)** | High (150 MB+) | Ultra-Low (~30 MB) |
| **Backend Language** | **JavaScript / Node.js** | JavaScript / Node.js | Rust |
| **Learning Curve** | **Zero (Electron-like API)** | Easy | High (Requires Rust) |
| **npm Ecosystem** | **Full Native Support** | Full Native Support | Limited (Requires Rust bridges) |
| **Rendering Engine** | System Native Webview | Bundled Chromium | System Native Webview |

---

## 💻 Code Example

### Main Process (`main.js`)

```javascript
const { app, BrowserWindow, ipcMain } = require('adrenaline-js');
const path = require('path');

app.whenReady().then(() => {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        title: 'My Adrenaline App'
    });

    win.loadFile(path.join(__dirname, 'index.html'));

    ipcMain.on('ping', (event, data) => {
        console.log('Received ping from renderer:', data);
        win.webContents.send('pong', { reply: 'Pong from Node.js!' });
    });
});
```

### Renderer Process (`index.html`)

```html
<!DOCTYPE html>
<html>
<head>
    <title>My Adrenaline App</title>
</head>
<body>
    <h1>Hello Adrenaline.js!</h1>
    <button onclick="sendPing()">Ping Main Process</button>

    <script>
        function sendPing() {
            window.adrenaline.send('ping', { time: Date.now() });
        }

        window.adrenaline.on('pong', (data) => {
            alert(data.reply);
        });
    </script>
</body>
</html>
```

---

## 🛠️ CLI Commands

Adrenaline comes with a fast CLI tool for development:

- `adrenaline init <project-name>` / `adrenaline create <project-name>`: Scaffold a modern starter project.
- `adrenaline dev` / `adrenaline start`: Run the desktop app in current directory.
- `adrenaline --version` / `-v`: Display CLI version.
- `adrenaline --help` / `-h`: Display help options.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
