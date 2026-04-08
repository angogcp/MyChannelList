const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { TextDecoder } = require("util");

const UTF8_DECODER = new TextDecoder("utf-8");

function createChannelManager(options = {}) {
  const appRoot = options.appRoot || process.cwd();
  const dataDir = options.dataDir || path.join(appRoot, "data");
  const channelsPath = path.join(dataDir, "channels.json");
  const fallbackYtDlpPath = path.join(appRoot, "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  const resolveYtDlpPath = typeof options.ytDlpPath === "function"
    ? options.ytDlpPath
    : () => options.ytDlpPath || fallbackYtDlpPath;

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
      const parsed = JSON.parse(raw);
      const channels = Array.isArray(parsed) ? parsed.map(normalizeChannelEntry) : [];

      if (JSON.stringify(parsed) !== JSON.stringify(channels)) {
        await saveChannels(channels);
      }

      return channels;
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
    const normalizedUrl = normalizeChannelUrl(url);
    const exists = channels.some((ch) => ch.url.replace(/\/+$/, "") === normalizedUrl);

    if (exists) {
      throw new Error("This channel is already in the list.");
    }

    const entry = {
      name: (name || "").trim() || normalizedUrl,
      url: normalizedUrl
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
    const normalizedUrl = normalizeChannelUrl(url);
    const filtered = channels.filter((ch) => ch.url.replace(/\/+$/, "") !== normalizedUrl);

    if (filtered.length === channels.length) {
      throw new Error("Channel not found in the list.");
    }

    await saveChannels(filtered);
    return { ok: true, channels: filtered };
  }

  async function fetchVideos(channelUrl, limit = 15, fetchOptions = {}) {
    if (!channelUrl || typeof channelUrl !== "string") {
      throw new Error("A channel URL is required.");
    }

    const normalizedUrl = normalizeChannelUrl(channelUrl);
    const ytDlpPath = resolveYtDlpPath();
    if (!fs.existsSync(ytDlpPath)) {
      throw new Error("yt-dlp is not installed yet. Run a download first to bootstrap it.");
    }

    const youtubeLang = inferYoutubeLanguage(fetchOptions);
    const args = [
      "--flat-playlist",
      "--dump-json",
      "--encoding",
      "utf-8",
      "--playlist-end",
      String(limit),
      normalizedUrl
    ];

    if (youtubeLang) {
      args.splice(args.length - 1, 0, "--extractor-args", `youtube:lang=${youtubeLang};player_client=default,android`);
    }

    const output = await runYtDlpRaw(ytDlpPath, args);
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

    await backfillVideoDates(ytDlpPath, videos, youtubeLang);

    return { ok: true, videos };
  }

  function runYtDlpRaw(ytDlpPath, args) {
    return new Promise((resolve, reject) => {
      const child = spawn(ytDlpPath, args, {
        cwd: appRoot,
        windowsHide: true,
        env: buildUtf8SpawnEnv()
      });

      const chunks = [];
      const errChunks = [];

      child.stdout.on("data", (chunk) => {
        chunks.push(chunk);
      });

      child.stderr.on("data", (chunk) => {
        errChunks.push(chunk);
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code) => {
        if (code !== 0) {
          const errText = decodeUtf8Chunks(errChunks).trim();
          reject(new Error(errText || `yt-dlp exited with code ${code}`));
          return;
        }
        resolve(decodeUtf8Chunks(chunks));
      });
    });
  }
}

async function backfillVideoDates(ytDlpPath, videos, youtubeLang) {
  const pending = (Array.isArray(videos) ? videos : []).filter((video) => video && video.url && !video.uploadDate);
  if (!pending.length) {
    return;
  }

  const args = [
    "--skip-download",
    "--encoding",
    "utf-8",
    "--print",
    "%(id)s\t%(upload_date)s\t%(timestamp)s"
  ];

  if (youtubeLang) {
    args.push("--extractor-args", `youtube:lang=${youtubeLang};player_client=default,android`);
  }

  args.push(...pending.map((video) => video.url));

  try {
    const output = await runYtDlpRawStatic(ytDlpPath, args);
    const rows = String(output || "").split(/\r?\n/).filter(Boolean);
    const byId = new Map();

    for (const row of rows) {
      const [id, uploadDate = "", timestamp = ""] = row.split("\t");
      if (!id) continue;
      byId.set(id.trim(), {
        uploadDate: String(uploadDate || "").trim(),
        timestamp: String(timestamp || "").trim()
      });
    }

    for (const video of pending) {
      const detail = byId.get(String(video.id || "").trim());
      if (!detail) continue;
      if (detail.uploadDate) {
        video.uploadDate = detail.uploadDate;
      }
      if (detail.timestamp && !video.timestamp) {
        video.timestamp = Number(detail.timestamp) || 0;
      }
    }
  } catch {
    // Keep the list usable even if date enrichment fails.
  }
}

function normalizeChannelEntry(entry = {}) {
  return {
    ...entry,
    url: normalizeChannelUrl(entry.url || "")
  };
}

function normalizeChannelUrl(url) {
  const input = String(url || "").trim();
  if (!input) {
    return "";
  }

  const trimmed = input.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const isYoutube = host === "youtube.com"
      || host === "www.youtube.com"
      || host === "m.youtube.com";

    if (!isYoutube) {
      return trimmed;
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length === 1 && parts[0].startsWith("@")) {
      parsed.pathname = `/${parts[0]}/videos`;
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString().replace(/\/+$/, "");
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}

function buildUtf8SpawnEnv() {
  return {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8"
  };
}

function decodeUtf8Chunks(chunks) {
  const buffers = chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ""), "utf8")));
  return UTF8_DECODER.decode(Buffer.concat(buffers));
}

function runYtDlpRawStatic(ytDlpPath, args, appRoot = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlpPath, args, {
      cwd: appRoot,
      windowsHide: true,
      env: buildUtf8SpawnEnv()
    });

    const chunks = [];
    const errChunks = [];

    child.stdout.on("data", (chunk) => {
      chunks.push(chunk);
    });

    child.stderr.on("data", (chunk) => {
      errChunks.push(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const errText = decodeUtf8Chunks(errChunks).trim();
        reject(new Error(errText || `yt-dlp exited with code ${code}`));
        return;
      }
      resolve(decodeUtf8Chunks(chunks));
    });
  });
}

function inferYoutubeLanguage(options = {}) {
  const explicit = normalizeYoutubeLanguage(options.youtubeLang);
  if (explicit) {
    return explicit;
  }

  const hints = [
    options.channelName,
    options.channelTitle,
    options.channelUrl
  ].filter(Boolean).map((value) => String(value));

  for (const hint of hints) {
    if (/[ぁ-ゖァ-ヺー]/u.test(hint)) return "ja";
    if (/[가-힣]/u.test(hint)) return "ko";
    if (/[\u4E00-\u9FFF]/u.test(hint)) {
      return looksTraditionalChinese(hint) ? "zh-TW" : "zh-CN";
    }
  }

  return "";
}

function normalizeYoutubeLanguage(value) {
  const normalized = String(value || "").trim();
  const supported = new Set([
    "zh-CN",
    "zh-TW",
    "zh-HK",
    "ja",
    "ko"
  ]);
  return supported.has(normalized) ? normalized : "";
}

function looksTraditionalChinese(text) {
  return /[這個們為來時會後說點對開學麼種與實無機應還讓從間體關龍氣車長讀張靈麼臺灣網裡書聽觀]/u.test(String(text || ""));
}

module.exports = { createChannelManager, normalizeChannelUrl };
