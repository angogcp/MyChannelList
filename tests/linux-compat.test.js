const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const test = require("node:test");
const { createDownloader } = require("../lib/downloader");

const appRoot = path.resolve(__dirname, "..");

test("launch npm scripts are cross-platform and do not call PowerShell directly", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));

  assert.strictEqual(pkg.scripts["launch:web"], "node scripts/launch-web.js");
  assert.strictEqual(pkg.scripts["launch:app"], "node scripts/launch-web.js --app");
  assert.ok(fs.existsSync(path.join(appRoot, "scripts", "launch-web.js")));
});

test("README documents Linux install and launch commands", () => {
  const readme = fs.readFileSync(path.join(appRoot, "README.md"), "utf8");

  assert.match(readme, /Linux/i);
  assert.match(readme, /sudo apt install[^\n]*ffmpeg/i);
  assert.match(readme, /npm install/i);
  assert.match(readme, /npm run launch:web/i);
});

test("Linux runtime ignores Windows-only bundled executables", async (t) => {
  if (process.platform === "win32") {
    t.skip("Linux-specific executable resolution");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "video-dl-linux-compat-"));
  try {
    fs.mkdirSync(path.join(tempRoot, "bin"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "bin", "yt-dlp.exe"), "not a linux executable");
    fs.writeFileSync(path.join(tempRoot, "bin", "ffmpeg.exe"), "not a linux executable");

    const health = await createDownloader({ appRoot: tempRoot, dataRoot: tempRoot }).getHealth();

    assert.ok(!/\.exe$/i.test(health.ytDlpPath), `yt-dlp path should not be Windows .exe on Linux: ${health.ytDlpPath}`);
    assert.ok(!/\.exe$/i.test(health.ffmpegPath), `ffmpeg path should not be Windows .exe on Linux: ${health.ffmpegPath}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
