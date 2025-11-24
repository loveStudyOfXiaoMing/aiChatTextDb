const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  connect: (config) => ipcRenderer.invoke('db:connect', config),
  listSchema: (payload) => ipcRenderer.invoke('db:listSchema', payload),
  runQuery: (payload) => ipcRenderer.invoke('db:runQuery', payload),
  close: (payload) => ipcRenderer.invoke('db:close', payload),
});
