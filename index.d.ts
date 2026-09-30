import { EventEmitter } from 'events';

export interface BrowserWindowOptions {
  width?: number;
  height?: number;
  title?: string;
  resizable?: boolean;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  webPreferences?: Record<string, unknown>;
  url?: string;
  html?: string;
}

export class WebContents extends EventEmitter {
  constructor(browserWindow: BrowserWindow);
  send(channel: string, data?: unknown): void;
  executeJavaScript(code: string): Promise<unknown>;
}

export class BrowserWindow extends EventEmitter {
  constructor(options?: BrowserWindowOptions);
  readonly id: number;
  readonly webContents: WebContents;
  loadFile(filePath: string): Promise<void> | void;
  loadURL(url: string): Promise<void> | void;
  close(): boolean | void;
  setTitle(title: string): void;
}

export interface App extends EventEmitter {
  whenReady(): Promise<void>;
  quit(): void;
}

export interface IpcMain extends EventEmitter {
  on(channel: string, listener: (event: unknown, data: any) => void): this;
  handle(channel: string, handler: (event: unknown, data: any) => Promise<any> | any): void;
  handleOnce(channel: string, handler: (event: unknown, data: any) => Promise<any> | any): void;
  removeHandler(channel: string): void;
}

export const app: App;
export const BrowserWindow: typeof BrowserWindow;
export const ipcMain: IpcMain;
