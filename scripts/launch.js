const { spawn } = require("child_process");
const path = require("path");

const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
const mode = modeArg ? modeArg.split("=")[1] : (process.argv.includes("app") ? "app" : "browser");
const rootDir = path.resolve(__dirname, "..");

if (process.platform === "win32") {
  const psScript = path.join(rootDir, "scripts", "launch-web.ps1");
  const child = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psScript, "-OpenMode", mode], {
    stdio: "inherit",
    windowsHide: true
  });
  child.on("exit", (code) => process.exit(code ?? 0));
} else {
  const shScript = path.join(rootDir, "scripts", "launch-mac.sh");
  const child = spawn("bash", [shScript, mode], {
    stdio: "inherit"
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}
