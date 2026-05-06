const express = require("express");
const path = require("path");
const { version: APP_VERSION } = require("./package.json");
const { createDownloader } = require("./lib/downloader");
const { createGoogleDriveManager } = require("./lib/googleDrive");
const { createChannelManager, normalizeChannelUrl } = require("./lib/channels");
const { createLibraryManager } = require("./lib/library");
const { createDownloadQueue } = require("./lib/queue");
const { createContentTracker } = require("./lib/contentTracker");
const { createLlmAnalyzer } = require("./lib/llmAnalysis");
const { loadLocalConfig } = require("./lib/localConfig");

const app = express();
const PORT = Number(process.env.PORT || 3010);
const ROOT_DIR = __dirname;
const localConfig = loadLocalConfig(ROOT_DIR);
const DEFAULT_GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || localConfig.GOOGLE_CLIENT_ID || "").trim();
const DEFAULT_GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || localConfig.GOOGLE_CLIENT_SECRET || "").trim();
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || localConfig.OPENAI_API_KEY || "").trim();
const OPENAI_ANALYSIS_MODEL = String(process.env.OPENAI_ANALYSIS_MODEL || localConfig.OPENAI_ANALYSIS_MODEL || "gpt-5").trim();
const downloader = createDownloader({
  appRoot: ROOT_DIR,
  dataRoot: ROOT_DIR
});
const drive = createGoogleDriveManager({
  appRoot: ROOT_DIR,
  dataDir: path.join(ROOT_DIR, "data"),
  defaultClientId: DEFAULT_GOOGLE_CLIENT_ID,
  defaultClientSecret: DEFAULT_GOOGLE_CLIENT_SECRET
});
const channels = createChannelManager({
  appRoot: ROOT_DIR,
  dataDir: path.join(ROOT_DIR, "data"),
  ytDlpPath: () => downloader.ytDlpPath,
  ensureYtDlp: () => downloader.ensureYtDlp()
});
const library = createLibraryManager({
  appRoot: ROOT_DIR,
  downloadsDir: path.join(ROOT_DIR, "downloads")
});
const contentTracker = createContentTracker({
  appRoot: ROOT_DIR,
  dataDir: path.join(ROOT_DIR, "data")
});
const queue = createDownloadQueue({
  dataRoot: path.join(ROOT_DIR, "data"),
  downloader,
  drive,
  contentTracker
});
const llmAnalyzer = createLlmAnalyzer({
  apiKey: OPENAI_API_KEY,
  model: OPENAI_ANALYSIS_MODEL,
  timeoutMs: Number(process.env.OPENAI_ANALYSIS_TIMEOUT_MS || localConfig.OPENAI_ANALYSIS_TIMEOUT_MS || 45000)
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(ROOT_DIR, "public")));

app.get("/api/app-info", (_req, res) => {
  res.json({
    ok: true,
    version: APP_VERSION
  });
});

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
    const status = await drive.getStatus();
    res.json({
      ok: true,
      configured: !!status.configured,
      connected: !!status.connected,
      email: status.email || ""
    });
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

app.post("/api/download", (req, res) => {
  try {
    const payload = req.body || {};
    const job = queue.addJob(payload);
    res.status(202).json(job);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to add job to queue." });
  }
});

app.get("/api/queue/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });

  const sendState = () => {
    res.write(`data: ${JSON.stringify(queue.getQueueState())}\n\n`);
  };

  sendState(); // send initial state

  queue.on("update", sendState);

  req.on("close", () => {
    queue.removeListener("update", sendState);
  });
});

app.post("/api/queue/clear", (_req, res) => {
  try {
    queue.clearCompleted();
    res.json({ ok: true, queue: queue.getQueueState() });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to clear completed queue items." });
  }
});

app.post("/api/system/update-engine", async (_req, res) => {
  try {
    const result = await downloader.updateYtDlp();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || "Engine update failed." });
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
    const normalizedUrl = normalizeChannelUrl(url);
    const limit = Math.min(Math.max(Number(req.query.limit) || 15, 1), 50);
    const forceRefresh = String(req.query.refresh || "").trim() === "1";
    const channelList = await channels.loadChannels();
    const channel = (channelList || []).find((entry) => normalizeChannelUrl(entry.url || "") === normalizedUrl);
    const result = await channels.fetchVideos(normalizedUrl, limit, {
      channelUrl: normalizedUrl,
      channelName: channel?.name || "",
      forceRefresh
    });
    const enriched = await contentTracker.enrichVideos({
      channelName: channel?.name || "",
      channelUrl: normalizedUrl,
      videos: result.videos || []
    });
    res.json({
      ...enriched,
      cached: !!result.cached,
      fetchedAt: result.fetchedAt || "",
      cacheAgeMs: Number(result.cacheAgeMs || 0)
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to fetch videos." });
  }
});

app.get("/api/content/history", async (req, res) => {
  try {
    const channelUrl = String(req.query.channelUrl || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    res.json(await contentTracker.listHistory({ channelUrl, limit }));
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load content history." });
  }
});

app.post("/api/content/state", async (req, res) => {
  try {
    res.json(await contentTracker.updateRecord(req.body || {}));
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to update content state." });
  }
});

app.get("/api/content/preferences", async (req, res) => {
  try {
    const channelUrl = String(req.query.channelUrl || "").trim();
    res.json(await contentTracker.getPreferences({ channelUrl }));
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load preferences." });
  }
});

app.post("/api/content/preferences", async (req, res) => {
  try {
    res.json(await contentTracker.updatePreferences(req.body || {}));
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to save preferences." });
  }
});

app.get("/api/content/ai-status", async (_req, res) => {
  try {
    res.json(llmAnalyzer.getStatus());
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load AI status." });
  }
});

app.post("/api/content/ai-insight", async (req, res) => {
  try {
    const payload = req.body || {};
    const aiInsight = await llmAnalyzer.analyzeContent(payload);
    const result = await contentTracker.updateRecord({
      ...payload,
      aiInsight
    });
    res.json({
      ok: true,
      aiInsight,
      record: result.record,
      analysis: result.analysis
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to generate AI insight." });
  }
});

// ── Analysis Dashboard ──

app.get("/api/analysis/dashboard", async (_req, res) => {
  try {
    const fsp = require("fs/promises");
    const dataDir = path.join(ROOT_DIR, "data");

    const [trackerRaw, channelsRaw, aiStatus] = await Promise.all([
      fsp.readFile(path.join(dataDir, "content-tracker.json"), "utf8").catch(() => "{}"),
      fsp.readFile(path.join(dataDir, "channels.json"), "utf8").catch(() => "[]"),
      llmAnalyzer.getStatus()
    ]);

    const store = JSON.parse(trackerRaw);
    const channelList = JSON.parse(channelsRaw);
    const records = Object.values(store.records || {}).filter(Boolean);

    // Overview counts
    const totalTracked = records.length;
    const totalDownloaded = records.filter((r) => (r.downloadCount || 0) > 0).length;
    const totalSkipped = records.filter((r) => (r.status || "") === "skipped").length;
    const totalCompleted = records.filter((r) => (r.status || "") === "completed").length;
    const aiAnalyzed = records.filter((r) => r.aiInsight && r.aiInsight.summary).length;
    const unprocessed = records.filter((r) => {
      const s = r.status || "new";
      return s === "new" && !r.downloadCount && !r.queueCount && !r.note;
    }).length;

    // Build channel name lookup with URL normalization
    // (both channels.json and content-tracker may differ on /videos suffix)
    const channelNameMap = {};
    const channelBaseUrl = (url) => String(url || "").replace(/\/videos\/?$/, "").replace(/\/+$/, "");
    for (const ch of channelList) {
      channelNameMap[channelBaseUrl(ch.url)] = ch.name;
    }
    const resolveChannelName = (channelUrl, fallback) => {
      const name = channelNameMap[channelBaseUrl(channelUrl || "")];
      return name || fallback || channelUrl || "_unknown";
    };

    // Detect garbled text (excessive ? chars from encoding corruption)
    const isGarbled = (text) => {
      if (!text) return false;
      const qCount = (text.match(/\?/g) || []).length;
      return qCount >= 3 && qCount > text.length * 0.12;
    };

    // Per-channel aggregation (grouped by normalized base URL)
    const channelBuckets = {};
    for (const r of records) {
      const url = r.channelUrl || "_unknown";
      const baseUrl = channelBaseUrl(url);
      const key = baseUrl || url;
      if (!channelBuckets[key]) channelBuckets[key] = { items: [], urls: new Set() };
      channelBuckets[key].items.push(r);
      channelBuckets[key].urls.add(url);
    }

    const channelStats = Object.entries(channelBuckets)
      .map(([key, bucket]) => {
        const items = bucket.items;
        const url = [...bucket.urls][0] || key;
        const downloaded = items.filter((r) => (r.downloadCount || 0) > 0).length;
        const skipped = items.filter((r) => (r.status || "") === "skipped").length;
        const completed = items.filter((r) => (r.status || "") === "completed").length;
        return {
          url,
          name: resolveChannelName(url, items[0]?.channelName || url),
          totalItems: items.length,
          downloaded,
          skipped,
          completed,
          downloadRate: items.length > 0 ? Math.round((downloaded / items.length) * 100) : 0
        };
      })
      .sort((a, b) => b.totalItems - a.totalItems);

    // Items needing attention
    const needsAttention = records
      .filter((r) => {
        const s = r.status || "new";
        return s === "review_later" || s === "queued";
      })
      .map((r) => ({
        title: r.title || r.url || "Untitled",
        url: r.url || "",
        channelName: resolveChannelName(r.channelUrl, r.channelName || ""),
        status: r.status,
        garbled: isGarbled(r.title),
        lastUpdated: r.updatedAt || ""
      }))
      .sort((a, b) => new Date(b.lastUpdated || 0) - new Date(a.lastUpdated || 0))
      .slice(0, 15);

    // Recent activity timeline
    const activities = [];
    for (const r of records) {
      const resolvedName = resolveChannelName(r.channelUrl, r.channelName || "");
      if (r.lastDownloadedAt && r.downloadCount > 0) {
        activities.push({ title: r.title, channelName: resolvedName, action: "downloaded", garbled: isGarbled(r.title), timestamp: r.lastDownloadedAt });
      }
      if (r.lastSkippedAt) {
        activities.push({ title: r.title, channelName: resolvedName, action: "skipped", garbled: isGarbled(r.title), timestamp: r.lastSkippedAt });
      }
      if (r.lastCompletedAt) {
        activities.push({ title: r.title, channelName: resolvedName, action: "completed", garbled: isGarbled(r.title), timestamp: r.lastCompletedAt });
      }
    }
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      ok: true,
      overview: {
        totalTracked,
        totalDownloaded,
        totalSkipped,
        totalCompleted,
        aiAnalyzed,
        unprocessed,
        completionRate: totalTracked > 0 ? Math.round((totalCompleted / totalTracked) * 100) : 0,
        downloadRate: totalTracked > 0 ? Math.round((totalDownloaded / totalTracked) * 100) : 0
      },
      channelStats,
      needsAttention,
      recentActivity: activities.slice(0, 30),
      aiConfigured: aiStatus.configured,
      aiModel: aiStatus.model || ""
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Dashboard aggregation failed." });
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

app.get("/api/library/media", async (req, res) => {
  try {
    const filePath = await library.resolveFile(String(req.query.path || ""));
    res.setHeader("Cache-Control", "private, max-age=300");
    res.sendFile(filePath);
  } catch (error) {
    res.status(404).json({ error: error.message || "File not found." });
  }
});

app.delete("/api/library", async (req, res) => {
  try {
    res.json(await library.deleteFile((req.body || {}).path));
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to delete file." });
  }
});

queue.start().then(() => {
  app.listen(PORT, () => {
    console.log(`Video downloader running at http://localhost:${PORT}`);
  });
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
