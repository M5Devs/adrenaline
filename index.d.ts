import { EventEmitter } from 'events';

export interface CompiledFeatures {
  devtools: boolean;
  localFiles: boolean;
  pdf: boolean;
  cef: boolean;
  webview: boolean;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: FileFilter[];
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles' | 'createDirectory' | string>;
}

export interface OpenDialogReturnValue {
  canceled: boolean;
  filePaths: string[];
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: FileFilter[];
  properties?: Array<'showHiddenFiles' | 'createDirectory' | string>;
}

export interface SaveDialogReturnValue {
  canceled: boolean;
  filePath: string;
}

export interface MessageBoxOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning';
  buttons?: string[];
  defaultId?: number;
  title?: string;
  message?: string;
  detail?: string;
  checkboxLabel?: string;
  checkboxChecked?: boolean;
}

export interface MessageBoxReturnValue {
  response: number;
  checkboxChecked: boolean;
}

export interface Dialog {
  showOpenDialog(options?: OpenDialogOptions): Promise<OpenDialogReturnValue>;
  showSaveDialog(options?: SaveDialogOptions): Promise<SaveDialogReturnValue>;
  showMessageBox(options?: MessageBoxOptions): Promise<MessageBoxReturnValue>;
}

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
  openDevTools(): boolean | void;
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
export const features: CompiledFeatures;
export const dialog: Dialog;
