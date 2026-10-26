const { spawn } = require("child_process");
const { TextDecoder } = require("util");

const UTF8_DECODER = new TextDecoder("utf-8");

function buildUtf8SpawnEnv() {
  return {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8"
  };
}

function decodeUtf8Chunks(chunks) {
  const buffers = chunks.map((chunk) =>
    Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ""), "utf8")
  );
  return UTF8_DECODER.decode(Buffer.concat(buffers));
}

function runYtDlp(ytDlpPath, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlpPath, args, {
      cwd: cwd || process.cwd(),
      windowsHide: true,
      env: buildUtf8SpawnEnv()
    });

    const chunks = [];
    const errChunks = [];

    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => errChunks.push(chunk));

    child.on("error", (error) => reject(error));

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

module.exports = { buildUtf8SpawnEnv, decodeUtf8Chunks, runYtDlp };
