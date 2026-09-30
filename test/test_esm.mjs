import assert from 'assert';
import { app, BrowserWindow, ipcMain } from '../index.mjs';

console.log('Testing ES Module imports from index.mjs...');

assert.ok(app, 'app should be exported');
assert.ok(BrowserWindow, 'BrowserWindow should be exported');
assert.ok(ipcMain, 'ipcMain should be exported');
assert.strictEqual(typeof app.whenReady, 'function', 'app.whenReady should be a function');
assert.strictEqual(typeof BrowserWindow, 'function', 'BrowserWindow should be a constructor function');
assert.strictEqual(typeof ipcMain.handle, 'function', 'ipcMain.handle should be a function');

console.log('ES Module import test passed successfully!');
