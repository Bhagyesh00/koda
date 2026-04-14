// Preload script runs in the renderer process before the page loads.
// Keep this minimal — only expose APIs via contextBridge if you need
// native features (file dialogs, system info, etc.) in the UI.
//
// Example (uncomment if needed):
// import { contextBridge, ipcRenderer } from 'electron';
// contextBridge.exposeInMainWorld('koda', {
//   version: () => ipcRenderer.invoke('app-version'),
// });
