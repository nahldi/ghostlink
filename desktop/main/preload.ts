/**
 * Preload Script — Exposes a safe IPC bridge to the renderer via contextBridge.
 *
 * The renderer (launcher.js) must use `window.api.*` instead of
 * `require('electron').ipcRenderer` directly, because contextIsolation is enabled.
 */

import { contextBridge, ipcRenderer } from 'electron';

// Channels the renderer is allowed to invoke (request → response)
const INVOKE_CHANNELS = [
  'server:start',
  'server:stop',
  'server:status',
  'auth:check',
  'auth:check-all',
  'auth:login',
  'update:check',
  'update:download',
  'update:install',
  'app:open-chat',
  'app:get-version',
  'app:pick-folder',
  'app:save-settings',
  'window:minimize',
  'window:close',
] as const;

// Channels the renderer is allowed to listen on (main → renderer)
const LISTEN_CHANNELS = [
  'server:started',
  'server:stopped',
  'server:error',
  'auth:status',
  'update:available',
  'update:not-available',
  'update:progress',
  'update:downloaded',
  'update:error',
  'app:version',
  'app:folder-picked',
  'action:open-chat',
  'action:check-updates',
] as const;

contextBridge.exposeInMainWorld('api', {
  /**
   * Send an IPC message and wait for the result (pairs with ipcMain.handle).
   */
  invoke: (channel: string, ...args: any[]) => {
    if ((INVOKE_CHANNELS as readonly string[]).includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    console.warn('[preload] blocked invoke on channel:', channel);
    return Promise.reject(new Error(`Channel not allowed: ${channel}`));
  },

  /**
   * Listen for events pushed from the main process (ipcMain → renderer).
   */
  on: (channel: string, callback: (...args: any[]) => void) => {
    if ((LISTEN_CHANNELS as readonly string[]).includes(channel)) {
      const handler = (_event: Electron.IpcRendererEvent, ...args: any[]) => callback(...args);
      ipcRenderer.on(channel, handler);
      // Return an unsubscribe function
      return () => ipcRenderer.removeListener(channel, handler);
    }
    console.warn('[preload] blocked listen on channel:', channel);
    return () => {};
  },
});
