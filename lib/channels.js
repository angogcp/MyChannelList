const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

function createChannelManager(options = {}) {
  const appRoot = options.appRoot || process.cwd();
  const dataDir = options.dataDir || path.join(appRoot, "data");
  const channelsPath = path.join(dataDir, "channels.json");
  const ytDlpPath = options.ytDlpPath || path.join(appRoot, "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");

  return {
    loadChannels,
    saveChannels,
    addChannel,
    removeChannel,
    fetchVideos
  };

  async function ensureDataDir() {
    await fsp.mkdir(dataDir, { recursive: true });
  }

  async function loadChannels() {
    try {
      await ensureDataDir();
      const raw = await fsp.readFile(channelsPath, "utf8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async function saveChannels(list) {
    await ensureDataDir();
    await fsp.writeFile(channelsPath, JSON.stringify(list, null, 2), "utf8");
  }

  async function addChannel({ name, url }) {
    if (!url || typeof url !== "string") {
      throw new Error("A channel URL is required.");
    }

    const channels = await loadChannels();
    const normalizedUrl = url.trim().replace(/\/+$/, "");
    const exists = channels.some((ch) => ch.url.replace(/\/+$/, "") === normalizedUrl);

    if (exists) {
      throw new Error("This channel is already in the list.");
    }

    const entry = {
      name: (name || "").trim() || normalizedUrl,
      url: url.trim()
    };

    channels.push(entry);
    await saveChannels(channels);
    return { ok: true, channel: entry, channels };
  }

  async function removeChannel({ url }) {
    if (!url || typeof url !== "string") {
      throw new Error("A channel URL is required.");
    }

    const channels = await loadChannels();
    const normalizedUrl = url.trim().replace(/\/+$/, "");
    const filtered = channels.filter((ch) => ch.url.replace(/\/+$/, "") !== normalizedUrl);

    if (filtered.length === channels.length) {
      throw new Error("Channel not found in the list.");
    }

    await saveChannels(filtered);
    return { ok: true, channels: filtered };
  }

  async function fetchVideos(channelUrl, limit = 15) {
    if (!channelUrl || typeof channelUrl !== "string") {
      throw new Error("A channel URL is required.");
    }

    if (!fs.existsSync(ytDlpPath)) {
      throw new Error("yt-dlp is not installed yet. Run a download first to bootstrap it.");
    }

    const args = [
      "--flat-playlist",
      "--dump-json",
      "--playlist-end",
      String(limit),
      channelUrl.trim()
    ];

    const output = await runYtDlpRaw(args);
    const lines = output.split(/\r?\n/).filter(Boolean);
    const videos = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        videos.push({
          id: entry.id || "",
          title: entry.title || "(no title)",
          url: entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : "",
          duration: entry.duration || 0,
          uploadDate: entry.upload_date || "",
          thumbnail: entry.thumbnails && entry.thumbnails.length > 0
            ? entry.thumbnails[entry.thumbnails.length - 1].url
            : (entry.id ? `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg` : "")
        });
      } catch {
        // skip malformed lines
      }
    }

    return { ok: true, videos };
  }

  function runYtDlpRaw(args) {
    return new Promise((resolve, reject) => {
      const child = spawn(ytDlpPath, args, {
        cwd: appRoot,
        windowsHide: true
      });

      const chunks = [];
      const errChunks = [];

      child.stdout.on("data", (chunk) => {
        chunks.push(chunk.toString());
      });

      child.stderr.on("data", (chunk) => {
        errChunks.push(chunk.toString());
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code) => {
        if (code !== 0) {
          const errText = errChunks.join("").trim();
          reject(new Error(errText || `yt-dlp exited with code ${code}`));
          return;
        }
        resolve(chunks.join(""));
      });
    });
  }
}

module.exports = { createChannelManager };
