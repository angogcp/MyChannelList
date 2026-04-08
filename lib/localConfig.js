const fs = require("fs");
const path = require("path");

function loadLocalConfig(appRoot) {
  const root = appRoot || process.cwd();
  const jsonPath = path.join(root, "data", "local-config.json");
  const envPath = path.join(root, ".env.local");

  return {
    ...readJsonConfig(jsonPath),
    ...readEnvConfig(envPath)
  };
}

function readJsonConfig(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readEnvConfig(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, "utf8");
    const result = {};

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }

    return result;
  } catch {
    return {};
  }
}

module.exports = {
  loadLocalConfig
};
