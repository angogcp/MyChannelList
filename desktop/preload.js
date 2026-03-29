const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApi", {
  getHealth: () => ipcRenderer.invoke("app:get-health"),
  pickFolder: () => ipcRenderer.invoke("app:pick-folder"),
  download: (payload) => ipcRenderer.invoke("app:download", payload),
  openPath: (targetPath) => ipcRenderer.invoke("app:open-path", targetPath),
  onDownloadProgress: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("download:progress", wrapped);
    return () => ipcRenderer.removeListener("download:progress", wrapped);
  }
});
