#!/usr/bin/env node
"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 3010);
const url = `http://localhost:${port}`;
const openMode = parseArgs(process.argv.slice(2));
const logDir = path.join(os.tmpdir(), "VideoDLWeb");
const stdoutLog = path.join(logDir, "web.stdout.log");
const stderrLog = path.join(logDir, "web.stderr.log");
const npmLog = path.join(logDir, "npm-install.log");

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});

async function main() {
  await ensureDependencies();
  await fsp.mkdir(logDir, { recursive: true });

  if (!await isReady(url)) {
    await clearOldLogs();
    startServer();
    await waitUntilReady(url, 20_000);
  }

  await openUrl(url, openMode);
}

function parseArgs(args) {
  if (args.includes("--none")) return "none";
  if (args.includes("--app")) return "app";
  return "browser";
}

async function ensureDependencies() {
  if (fs.existsSync(path.join(root, "node_modules"))) {
    return;
  }

  if (!fs.existsSync(path.join(root, "package.json"))) {
    throw new Error(`package.json was not found in ${root}.`);
  }

  await fsp.mkdir(logDir, { recursive: true });
  console.log("Installing npm dependencies for the first run...");
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const install = spawnSync(npmCommand, ["install", "--no-fund", "--no-audit"], {
    cwd: root,
    encoding: "utf8",
    shell: false
  });
  const installOutput = `${install.stdout || ""}${install.stderr || ""}`;
  if (installOutput) {
    await fsp.writeFile(npmLog, installOutput, "utf8");
  }

  if (install.status !== 0 || !fs.existsSync(path.join(root, "node_modules"))) {
    throw new Error(`Failed to install dependencies automatically. Run manually:\n\n  npm install --no-fund --no-audit\n\n${installOutput}`);
  }
}

async function clearOldLogs() {
  await Promise.all([
    fsp.rm(stdoutLog, { force: true }),
    fsp.rm(stderrLog, { force: true })
  ]);
}

function startServer() {
  const out = fs.openSync(stdoutLog, "a");
  const err = fs.openSync(stderrLog, "a");
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    detached: true,
    stdio: ["ignore", out, err],
    env: { ...process.env, PORT: String(port) },
    windowsHide: true
  });
  child.unref();
}

function isReady(targetUrl) {
  return new Promise((resolve) => {
    const req = http.get(targetUrl, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function waitUntilReady(targetUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isReady(targetUrl)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const [stdout, stderr] = await Promise.all([
    readTail(stdoutLog),
    readTail(stderrLog)
  ]);
  throw new Error(`Web app did not start on ${targetUrl}.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
}

async function readTail(filePath, maxChars = 8000) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return raw.slice(-maxChars);
  } catch {
    return "";
  }
}

async function openUrl(targetUrl, mode) {
  if (mode === "none") {
    console.log(`Local web app is ready at ${targetUrl}`);
    return;
  }

  const opened = mode === "app" ? openAppWindow(targetUrl) : openBrowser(targetUrl);
  if (opened) {
    console.log(`${mode === "app" ? "Opened app-style window" : "Opened browser"} at ${targetUrl}`);
    return;
  }

  if (mode === "app" && openBrowser(targetUrl)) {
    console.log(`Opened browser at ${targetUrl}`);
    return;
  }

  console.log(`Local web app is ready at ${targetUrl}`);
}

function openBrowser(targetUrl) {
  const candidates = getBrowserOpenCommands(targetUrl);
  return runFirstAvailable(candidates);
}

function openAppWindow(targetUrl) {
  const profileDir = path.join(os.tmpdir(), "VideoDLWebAppProfile");
  try {
    fs.mkdirSync(profileDir, { recursive: true });
  } catch {
    // Browser can still launch without our profile dir.
  }

  const args = [`--app=${targetUrl}`, "--new-window", `--user-data-dir=${profileDir}`];
  const browserNames = process.platform === "win32"
    ? [
        "msedge.exe",
        "chrome.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
      ]
    : process.platform === "darwin"
    ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        "google-chrome",
        "chromium"
      ]
    : ["microsoft-edge", "microsoft-edge-stable", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];

  return runFirstAvailable(browserNames.map((command) => ({ command, args })));
}

function getBrowserOpenCommands(targetUrl) {
  if (process.platform === "win32") {
    return [{ command: "cmd.exe", args: ["/c", "start", "", targetUrl] }];
  }

  const commands = [];
  if (process.platform === "darwin") {
    commands.push({ command: "open", args: [targetUrl] });
  }

  // WSL often has cmd.exe available and can open the Windows default browser.
  if (isWsl()) {
    commands.push({ command: "cmd.exe", args: ["/c", "start", "", targetUrl] });
  }
  commands.push(
    { command: "xdg-open", args: [targetUrl] },
    { command: "gio", args: ["open", targetUrl] },
    { command: "sensible-browser", args: [targetUrl] }
  );
  return commands;
}

function runFirstAvailable(candidates) {
  for (const candidate of candidates) {
    if (!commandExists(candidate.command)) {
      continue;
    }
    try {
      const child = spawn(candidate.command, candidate.args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
      child.on("error", () => {});
      child.unref();
      return true;
    } catch {
      // Try the next candidate.
    }
  }
  return false;
}

function commandExists(command) {
  if (!command) return false;
  if (path.isAbsolute(command)) {
    return fs.existsSync(command);
  }

  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  return result.status === 0 && !!String(result.stdout || "").trim();
}

function isWsl() {
  if (process.platform !== "linux") return false;
  try {
    const release = fs.readFileSync("/proc/sys/kernel/osrelease", "utf8");
    return /microsoft|wsl/i.test(release);
  } catch {
    return false;
  }
}
