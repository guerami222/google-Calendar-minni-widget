const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widgetAPI', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  fetchICS: (icsUrl) => ipcRenderer.invoke('calendar:fetchICS', icsUrl),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggleAlwaysOnTop'),
  getAlwaysOnTop: () => ipcRenderer.invoke('window:getAlwaysOnTop'),
createEvent: (payload) => ipcRenderer.invoke('calendar:createEvent', payload),
deleteEvent: (payload) => ipcRenderer.invoke('calendar:deleteEvent', payload),
updateEventTitle: (payload) => ipcRenderer.invoke('calendar:updateEventTitle', payload),
listEvents: () => ipcRenderer.invoke('calendar:listEvents'),
resizeWindow: (x, y) => ipcRenderer.send("resize-window", { width: x, height: y }),
resetSize: () => ipcRenderer.invoke('window:resetSize'),
getStartup: () => ipcRenderer.invoke('startup:get'),
setStartup: (enabled) => ipcRenderer.invoke('startup:set', enabled),
login: () => ipcRenderer.invoke("auth:login"),
logout: () => ipcRenderer.invoke("auth:logout"),
getAuthStatus: () => ipcRenderer.invoke("auth:status"),
});