const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("asciiDesktop", {
  dismiss: () => ipcRenderer.send("saver:dismiss"),
  preview: () => ipcRenderer.send("saver:preview"),
});
