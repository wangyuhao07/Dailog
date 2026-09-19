import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('dailog', {
  platform: process.platform,
  version: process.versions.electron,
  closeFloating: () => ipcRenderer.invoke('floating:close'),
  startWindowResize: () => ipcRenderer.invoke('floating:start-resize'),
  endWindowResize: () => ipcRenderer.invoke('floating:end-resize'),
  getAppState: () => ipcRenderer.invoke('state:get'),
  setAppState: (nextState) => ipcRenderer.invoke('state:set', nextState),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  getAutoLaunch: () => ipcRenderer.invoke('app:get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('app:set-auto-launch', enabled),
  getMcpClientConfig: () => ipcRenderer.invoke('app:get-mcp-client-config'),
  testModelConnection: (config) => ipcRenderer.invoke('ai:test-model', config),
  askModelQuestion: (config, question) => ipcRenderer.invoke('ai:ask-model', config, question),
  generateDailyReport: (config, prompt) => ipcRenderer.invoke('ai:generate-daily-report', config, prompt),
  exportData: (exportType, payload) => ipcRenderer.invoke('data:export', exportType, payload),
  importData: () => ipcRenderer.invoke('data:import'),
  onAppStateChanged: (callback) => {
    const listener = (_event, nextState) => callback(nextState);
    ipcRenderer.on('state:changed', listener);
    return () => ipcRenderer.removeListener('state:changed', listener);
  },
});
