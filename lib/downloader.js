const fs = require("fs");
const fsp = require("fs/promises");
const https = require("https");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const sanitizeFilename = require("sanitize-filename");

const YT_DLP_URL =
  process.platform === "win32"
    ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";

const WINDOWS_FFMPEG_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

function createDownloader(options = {}) {
  const appRoot = options.appRoot || process.cwd();
  const dataRoot = options.dataRoot || appRoot;
  const binDir = path.join(dataRoot, "bin");
  const downloadsDir = path.join(dataRoot, "downloads");
  const ytDlpPath = path.join(binDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  const ffmpegPath = options.ffmpegPath || path.join(binDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

  return {
    appRoot,
    dataRoot,
    binDir,
    downloadsDir,
    ytDlpPath,
    ffmpegPath,
    ensureDirectories,
    ensureYtDlp,
    ensureFfmpeg,
    getHealth,
    download,
    deleteLocalFile,
    updateYtDlp
  };

  async function ensureDirectories() {
    await Promise.all([
      fsp.mkdir(binDir, { recursive: true }),
      fsp.mkdir(path.join(downloadsDir, "video"), { recursive: true }),
      fsp.mkdir(path.join(downloadsDir, "audio"), { recursive: true })
    ]);
  }

  async function ensureYtDlp() {
    if (fs.existsSync(ytDlpPath)) {
      return;
    }

    await downloadFile(YT_DLP_URL, ytDlpPath);

    if (process.platform !== "win32") {
      await fsp.chmod(ytDlpPath, 0o755);
    }
  }

  async function ensureFfmpeg() {
    if (fs.existsSync(ffmpegPath)) {
      return;
    }

    if (process.platform !== "win32") {
      throw new Error("ffmpeg bootstrap is only implemented for Windows in this build.");
    }

    await downloadAndExtractWindowsFfmpeg(ffmpegPath, binDir);
  }

  async function getHealth() {
    await ensureDirectories();
    return {
      ok: true,
      ytDlpInstalled: fs.existsSync(ytDlpPath),
      ffmpegAvailable: fs.existsSync(ffmpegPath),
      downloadsDir
    };
  }

  async function download({ url, mode = "video", quality = "", customName = "", targetRoot, onProgress } = {}) {
    if (!url || typeof url !== "string") {
      throw new Error("A video URL is required.");
    }

    if (!["video", "mp3"].includes(mode)) {
      throw new Error("Mode must be either video or mp3.");
    }

    await ensureDirectories();
    await ensureYtDlp();
    await ensureFfmpeg();

    const outputBaseDir = targetRoot ? path.resolve(targetRoot) : downloadsDir;
    const outputSubdir = mode === "mp3" ? "audio" : "video";
    const outputDir = path.join(outputBaseDir, outputSubdir);
    await fsp.mkdir(outputDir, { recursive: true });

    const baseName = sanitizeFilename(customName.trim()) || "%(title)s";
    const outputTemplate = path.join(outputDir, `${baseName}.%(ext)s`);
    const args = [
      "--no-playlist",
      "--windows-filenames",
      "--newline",
      "--progress",
      // Clean up title: collapse multiple spaces and strip trailing whitespace
      "--replace-in-metadata", "title", "\\s{2,}", " ",
      "--replace-in-metadata", "title", "\\s+$", "",
      // Embed rich metadata into the media file
      "--embed-metadata",
      "--embed-thumbnail",
      // Aggressive retries with 1s sleep to survive Windows Defender / cloud sync file locks
      "--file-access-retries", "50",
      "--retry-sleep", "file_access:1",
      "--extractor-args", "youtube:player_client=default,android",
      ...getJsRuntimeArgs(),
      "--ffmpeg-location",
      ffmpegPath
    ];

    if (mode === "mp3") {
      args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
    } else {
      args.push("-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/bv*+ba/b", "--merge-output-format", "mp4");
    }

    args.push("-o", outputTemplate, url);

    const result = await runYtDlp(ytDlpPath, args, appRoot, onProgress);

    // Use extracted destination, but fall back to scanning the output dir for the newest file
    let filePath = result.destination;
    if (!filePath || !await fileExists(filePath)) {
      filePath = await findNewestFile(outputDir) || "";
    }

    return {
      ok: true,
      mode,
      message: mode === "mp3" ? "Audio download completed." : "Video download completed.",
      filePath,
      log: result.log
    };
  }

  async function deleteLocalFile(filePath) {
    if (!filePath) {
      return;
    }
    await fsp.rm(path.resolve(filePath), { force: true });
  }

  async function updateYtDlp() {
    await ensureDirectories();
    await ensureYtDlp();
    return new Promise((resolve, reject) => {
      const child = spawn(ytDlpPath, ["-U"], { cwd: appRoot, windowsHide: true });
      const output = [];
      child.stdout.on("data", chunk => output.push(chunk.toString()));
      child.stderr.on("data", chunk => output.push(chunk.toString()));
      child.on("error", reject);
      child.on("close", code => {
        const log = output.join("").trim();
        if (code !== 0) reject(new Error(log || `Update failed with code ${code}`));
        else resolve({ ok: true, log });
      });
    });
  }
}

function getJsRuntimeArgs() {
  const candidatePaths = [];

  if (process.execPath && /node(?:\.exe)?$/i.test(process.execPath)) {
    candidatePaths.push(process.execPath);
  }

  if (process.platform === "win32") {
    candidatePaths.push("C:\\Program Files\\nodejs\\node.exe");
    candidatePaths.push("C:\\Program Files (x86)\\nodejs\\node.exe");
  }

  for (const candidate of candidatePaths) {
    if (candidate && fs.existsSync(candidate)) {
      return ["--js-runtimes", `node:${candidate}`];
    }
  }

  return [];
}
function resolveQualityPreset(mode, quality) {
  const normalized = String(quality || "").trim().toLowerCase();

  if (mode === "mp3") {
    const audioPresets = {
      best: { audioQuality: "0" },
      "320k": { audioQuality: "320K" },
      "192k": { audioQuality: "192K" },
      "128k": { audioQuality: "128K" }
    };

    if (!normalized) {
      return audioPresets.best;
    }

    const preset = audioPresets[normalized];
    if (!preset) {
      throw new Error("Unsupported MP3 quality selected.");
    }
    return preset;
  }

  const videoPresets = {
    best: { format: "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/bv*+ba/b" },
    "2160p": { format: "bestvideo[ext=mp4][height<=2160]+bestaudio[ext=m4a]/best[ext=mp4][height<=2160]/best[height<=2160]" },
    "1440p": { format: "bestvideo[ext=mp4][height<=1440]+bestaudio[ext=m4a]/best[ext=mp4][height<=1440]/best[height<=1440]" },
    "1080p": { format: "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4][height<=1080]/best[height<=1080]" },
    "720p": { format: "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best[height<=720]" },
    "480p": { format: "bestvideo[ext=mp4][height<=480]+bestaudio[ext=m4a]/best[ext=mp4][height<=480]/best[height<=480]" }
  };

  if (!normalized) {
    return videoPresets.best;
  }

  const preset = videoPresets[normalized];
  if (!preset) {
    throw new Error("Unsupported video quality selected.");
  }
  return preset;
}
async function downloadAndExtractWindowsFfmpeg(ffmpegPath, binDir) {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "video-dl-ffmpeg-"));
  const zipPath = path.join(tempRoot, "ffmpeg.zip");
  const extractDir = path.join(tempRoot, "unzipped");

  try {
    await downloadFile(WINDOWS_FFMPEG_URL, zipPath);
    await fsp.mkdir(extractDir, { recursive: true });

    const expand = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`
      ],
      {
        windowsHide: true,
        encoding: "utf8"
      }
    );

    if (expand.status !== 0) {
      throw new Error(expand.stderr?.trim() || "Failed to extract ffmpeg archive.");
    }

    const discovered = await findFileRecursive(extractDir, "ffmpeg.exe");
    if (!discovered) {
      throw new Error("ffmpeg.exe was not found in the downloaded archive.");
    }

    await fsp.mkdir(binDir, { recursive: true });
    await fsp.copyFile(discovered, ffmpegPath);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

async function findFileRecursive(rootDir, targetName) {
  const entries = await fsp.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === targetName.toLowerCase()) {
      return fullPath;
    }

    if (entry.isDirectory()) {
      const nested = await findFileRecursive(fullPath, targetName);
      if (nested) {
        return nested;
      }
    }
  }

  return "";
}

async function downloadFile(url, destination) {
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlink(destination, () => {
          downloadFile(response.headers.location, destination).then(resolve).catch(reject);
        });
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(destination, () => {
          reject(new Error(`Failed to download file. HTTP ${response.statusCode}`));
        });
        return;
      }

      response.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
    });

    request.on("error", (error) => {
      file.close();
      fs.unlink(destination, () => reject(error));
    });
  });
}

async function runYtDlp(ytDlpPath, args, cwd, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlpPath, args, {
      cwd,
      windowsHide: true
    });

    const output = [];
    let destination = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output.push(text);
      destination = extractDestination(text) || destination;
      emitProgress(text, destination, onProgress);
    });

    child.stderr.on("data", (chunk) => {
      output.push(chunk.toString());
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      const log = output.join("").trim();

      if (code !== 0) {
        reject(new Error(log || `yt-dlp exited with code ${code}`));
        return;
      }

      resolve({
        destination,
        log
      });
    });
  });
}

function emitProgress(text, destination, onProgress) {
  if (typeof onProgress !== "function") {
    return;
  }

  const lines = text.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const progress = parseProgressLine(line, destination);
    if (progress) {
      onProgress(progress);
    }
  }
}

function parseProgressLine(line, destination) {
  const percentMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
  if (percentMatch) {
    return {
      type: "progress",
      percent: Number(percentMatch[1]),
      message: line,
      filePath: destination || ""
    };
  }

  if (line.includes("[download] Destination:")) {
    return {
      type: "destination",
      message: line,
      filePath: extractDestination(line) || destination || ""
    };
  }

  if (line.includes("[Merger]") || line.includes("[ExtractAudio]")) {
    return {
      type: "processing",
      message: line,
      filePath: extractDestination(line) || destination || ""
    };
  }

  return null;
}

function extractDestination(text) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const match =
      line.match(/\[download\] Destination: (.+)$/) ||
      line.match(/\[Merger\] Merging formats into "(.+)"$/) ||
      line.match(/\[ExtractAudio\] Destination: (.+)$/) ||
      line.match(/\[download\] (.+) has already been downloaded$/) ||
      line.match(/\[ExtractAudio\] Not converting audio (.+); file is already in target format/);

    if (match && looksLikeFilePath(match[1])) {
      return match[1];
    }
  }

  return "";
}

function looksLikeFilePath(str) {
  if (!str || str.length < 4) return false;
  // Must contain a path separator
  if (!str.includes("/") && !str.includes("\\")) return false;
  // Must end with a file extension
  if (!/\.[a-zA-Z0-9]{2,5}$/.test(str)) return false;
  // Should not look like progress output
  if (/^\s*\d+(\.\d+)?%/.test(str)) return false;
  return true;
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findNewestFile(dirPath) {
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    let newest = null;
    let newestTime = 0;

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      // Skip temp/partial files
      if (entry.name.endsWith(".part") || entry.name.endsWith(".temp")) continue;

      const fullPath = path.join(dirPath, entry.name);
      const stat = await fsp.stat(fullPath);
      if (stat.mtimeMs > newestTime) {
        newestTime = stat.mtimeMs;
        newest = fullPath;
      }
    }

    return newest;
  } catch {
    return null;
  }
}

module.exports = {
  createDownloader
};
