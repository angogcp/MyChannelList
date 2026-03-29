const fsp = require("fs/promises");
const path = require("path");

function createLibraryManager(options = {}) {
  const downloadsDir = options.downloadsDir || path.join(options.appRoot || process.cwd(), "downloads");

  return {
    listFiles,
    deleteFile,
    getStats
  };

  async function listFiles() {
    const videoDir = path.join(downloadsDir, "video");
    const audioDir = path.join(downloadsDir, "audio");

    const [videoFiles, audioFiles] = await Promise.all([
      scanDir(videoDir, "video"),
      scanDir(audioDir, "audio")
    ]);

    const files = [...videoFiles, ...audioFiles].sort((a, b) => b.modifiedAt - a.modifiedAt);

    return { ok: true, files, downloadsDir };
  }

  async function scanDir(dirPath, category) {
    try {
      await fsp.mkdir(dirPath, { recursive: true });
      const entries = await fsp.readdir(dirPath, { withFileTypes: true });
      const files = [];

      for (const entry of entries) {
        if (!entry.isFile()) continue;

        const fullPath = path.join(dirPath, entry.name);
        try {
          const stat = await fsp.stat(fullPath);
          files.push({
            name: entry.name,
            path: fullPath,
            category,
            sizeBytes: stat.size,
            size: formatSize(stat.size),
            modifiedAt: stat.mtimeMs,
            modified: new Date(stat.mtimeMs).toISOString()
          });
        } catch {
          // skip files we can't stat
        }
      }

      return files;
    } catch {
      return [];
    }
  }

  async function deleteFile(filePath) {
    if (!filePath || typeof filePath !== "string") {
      throw new Error("A file path is required.");
    }

    const resolved = path.resolve(filePath);
    const resolvedDownloads = path.resolve(downloadsDir);

    // Security: only allow deleting files inside the downloads directory
    if (!resolved.startsWith(resolvedDownloads + path.sep)) {
      throw new Error("Can only delete files inside the downloads directory.");
    }

    await fsp.rm(resolved, { force: true });
    return { ok: true, deleted: resolved };
  }

  async function getStats() {
    const result = await listFiles();
    const files = result.files;
    const totalSize = files.reduce((sum, f) => sum + f.sizeBytes, 0);
    const videoCount = files.filter((f) => f.category === "video").length;
    const audioCount = files.filter((f) => f.category === "audio").length;

    return {
      ok: true,
      totalFiles: files.length,
      videoCount,
      audioCount,
      totalSize: formatSize(totalSize),
      totalSizeBytes: totalSize
    };
  }
}

function formatSize(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + units[i];
}

module.exports = { createLibraryManager };
