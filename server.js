const express = require("express");
const path = require("path");
const { createDownloader } = require("./lib/downloader");
const { createGoogleDriveManager } = require("./lib/googleDrive");
const { createChannelManager } = require("./lib/channels");
const { createLibraryManager } = require("./lib/library");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const downloader = createDownloader({
  appRoot: ROOT_DIR,
  dataRoot: ROOT_DIR
});
const drive = createGoogleDriveManager({
  appRoot: ROOT_DIR,
  dataDir: path.join(ROOT_DIR, "data")
});
const channels = createChannelManager({
  appRoot: ROOT_DIR,
  dataDir: path.join(ROOT_DIR, "data"),
  ytDlpPath: downloader.ytDlpPath
});
const library = createLibraryManager({
  appRoot: ROOT_DIR,
  downloadsDir: path.join(ROOT_DIR, "downloads")
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(ROOT_DIR, "public")));

app.get("/api/health", async (_req, res) => {
  const [health, driveStatus] = await Promise.all([downloader.getHealth(), drive.getStatus()]);
  res.json({
    ...health,
    driveConnected: driveStatus.connected,
    driveEmail: driveStatus.email || ""
  });
});

app.get("/api/drive/status", async (_req, res) => {
  try {
    res.json(await drive.getStatus());
  } catch (error) {
    res.status(500).json({ error: error.message || "Drive status failed." });
  }
});

app.get("/api/drive/connect-start", async (req, res) => {
  try {
    const origin = `${req.protocol}://${req.get("host")}`;
    const clientId = String(req.query.clientId || "").trim();
    const clientSecret = String(req.query.clientSecret || "").trim();
    const result = await drive.beginConnect(clientId, clientSecret, origin);
    res.redirect(result.authUrl);
  } catch (error) {
    res.status(500).type("html").send(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Google Drive connection failed</title></head>
  <body style="font-family:Segoe UI, sans-serif;padding:32px;line-height:1.5;">
    <h2>Google Drive connection failed</h2>
    <p>${escapeHtml(error.message || "Unknown error.")}</p>
  </body>
</html>`);
  }
});
app.post("/api/drive/connect-init", async (req, res) => {
  try {
    const origin = `${req.protocol}://${req.get("host")}`;
    const result = await drive.beginConnect((req.body || {}).clientId, (req.body || {}).clientSecret, origin);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || "Drive connect init failed." });
  }
});

app.get("/api/drive/callback", async (req, res) => {
  const homeUrl = `${req.protocol}://${req.get("host")}/`;

  try {
    await drive.finishConnect({
      code: req.query.code,
      state: req.query.state
    });

    res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Video DL</title>
    <meta http-equiv="refresh" content="2;url=${homeUrl}" />
  </head>
  <body style="font-family:Segoe UI, sans-serif;padding:32px;line-height:1.5;">
    <h2>Google Drive connected</h2>
    <p>Returning to Video DL...</p>
    <p><a href="${homeUrl}">Go back now</a></p>
    <script>setTimeout(function(){ window.location.replace(${JSON.stringify(homeUrl)}); }, 1200);</script>
  </body>
</html>`);
  } catch (error) {
    res.status(500).type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Video DL</title>
  </head>
  <body style="font-family:Segoe UI, sans-serif;padding:32px;line-height:1.5;">
    <h2>Google Drive connection failed</h2>
    <p>${escapeHtml(error.message || "Unknown error.")}</p>
    <p><a href="${homeUrl}">Return to Video DL</a></p>
  </body>
</html>`);
  }
});

app.get("/api/drive/folders", async (_req, res) => {
  try {
    res.json(await drive.listFolders());
  } catch (error) {
    res.status(500).json({ error: error.message || "Drive folder load failed." });
  }
});

app.post("/api/drive/folders", async (req, res) => {
  try {
    const { name } = req.body || {};
    res.json(await drive.createFolder(name));
  } catch (error) {
    res.status(500).json({ error: error.message || "Drive folder creation failed." });
  }
});

app.post("/api/drive/disconnect", async (_req, res) => {
  try {
    res.json(await drive.disconnect());
  } catch (error) {
    res.status(500).json({ error: error.message || "Drive disconnect failed." });
  }
});

app.post("/api/drive/upload", async (req, res) => {
  try {
    res.json(await drive.uploadFile(req.body || {}));
  } catch (error) {
    res.status(500).json({ error: error.message || "Drive upload failed." });
  }
});

app.post("/api/download", async (req, res) => {
  try {
    const payload = req.body || {};
    const result = await downloader.download(payload);

    let driveResult = null;
    if (payload.uploadToDrive) {
      driveResult = await drive.uploadFile({
        filePath: result.filePath,
        folderId: payload.driveFolderId,
        deleteLocal: !!payload.deleteLocalAfterUpload
      });
    }

    res.json({
      ...result,
      driveUpload: driveResult
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Download failed."
    });
  }
});

// ── Channel Watch List ──

app.get("/api/channels", async (_req, res) => {
  try {
    res.json({ ok: true, channels: await channels.loadChannels() });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load channels." });
  }
});

app.post("/api/channels", async (req, res) => {
  try {
    res.json(await channels.addChannel(req.body || {}));
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to add channel." });
  }
});

app.delete("/api/channels", async (req, res) => {
  try {
    res.json(await channels.removeChannel(req.body || {}));
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to remove channel." });
  }
});

app.get("/api/channels/videos", async (req, res) => {
  try {
    const url = String(req.query.url || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 15, 1), 50);
    res.json(await channels.fetchVideos(url, limit));
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to fetch videos." });
  }
});

// ── Library ──

app.get("/api/library", async (_req, res) => {
  try {
    res.json(await library.listFiles());
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to list files." });
  }
});

app.get("/api/library/stats", async (_req, res) => {
  try {
    res.json(await library.getStats());
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to get stats." });
  }
});

app.delete("/api/library", async (req, res) => {
  try {
    res.json(await library.deleteFile((req.body || {}).path));
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to delete file." });
  }
});

app.listen(PORT, () => {
  console.log(`Video downloader running at http://localhost:${PORT}`);
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
