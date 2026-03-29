const path = require("path");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { createDownloader } = require("../lib/downloader");

let mainWindow;
let downloader;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 820,
    minWidth: 900,
    minHeight: 700,
    backgroundColor: "#efe9dd",
    title: "Video DL Desktop",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  downloader = createDownloader({
    appRoot: app.getAppPath(),
    dataRoot: path.join(app.getPath("userData"), "runtime")
  });

  ipcMain.handle("app:get-health", async () => downloader.getHealth());
  ipcMain.handle("app:pick-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    return {
      canceled: false,
      folderPath: result.filePaths[0]
    };
  });

  ipcMain.handle("app:download", async (_event, payload) =>
    downloader.download({
      ...(payload || {}),
      onProgress(progress) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("download:progress", progress);
        }
      }
    })
  );

  ipcMain.handle("app:open-path", async (_event, targetPath) => {
    if (!targetPath) {
      return { ok: false };
    }

    await shell.openPath(targetPath);
    return { ok: true };
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
