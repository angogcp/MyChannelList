const targetRootInput = document.getElementById("targetRoot");
const qualitySelect = document.getElementById("quality");
const runtimeEl = document.getElementById("runtime");
const revisionEl = document.getElementById("revision");
const headline = document.getElementById("headline");
const details = document.getElementById("details");
const submit = document.getElementById("submit");
const openFolder = document.getElementById("open-folder");
const openFile = document.getElementById("open-file");
const chooseFolder = document.getElementById("choose-folder");
const form = document.getElementById("download-form");
const formNote = document.getElementById("form-note");
const modeLabel = document.getElementById("mode-label");
const destinationLabel = document.getElementById("destination-label");
const statusBadge = document.getElementById("status-badge");
const progressLabel = document.getElementById("progress-label");
const progressValue = document.getElementById("progress-value");
const progressBar = document.getElementById("progress-bar");
const driveClientIdInput = document.getElementById("driveClientId");
const driveFolderSelect = document.getElementById("driveFolder");
const driveConnectButton = document.getElementById("drive-connect");
const driveRefreshButton = document.getElementById("drive-refresh");
const driveDisconnectButton = document.getElementById("drive-disconnect");
const uploadToDriveInput = document.getElementById("uploadToDrive");
const driveNote = document.getElementById("drive-note");

let currentTargetRoot = "";
let latestFilePath = "";
let progressTimer = null;
let currentProgress = 0;
let runtimePaths = null;
let runtimeAssetsReady = false;
let driveConnected = false;
let driveBusy = false;

const STORAGE_KEYS = {
  driveClientId: "video-dl.drive.clientId",
  driveFolderId: "video-dl.drive.folderId",
  uploadToDrive: "video-dl.drive.upload",
  quality: "video-dl.quality"
};

const RESOURCE_CANDIDATES = {
  script: [
    "scripts/downloader.ps1",
    "/scripts/downloader.ps1",
    "resources/scripts/downloader.ps1",
    "/resources/scripts/downloader.ps1"
  ],
  ytDlp: [
    "bin/yt-dlp.exe",
    "/bin/yt-dlp.exe",
    "resources/bin/yt-dlp.exe",
    "/resources/bin/yt-dlp.exe"
  ],
  ffmpeg: [
    "bin/ffmpeg.exe",
    "/bin/ffmpeg.exe",
    "resources/bin/ffmpeg.exe",
    "/resources/bin/ffmpeg.exe"
  ]
};

const modeInputs = Array.from(document.querySelectorAll('input[name="mode"]'));

Neutralino.init();
Neutralino.events.on("windowClose", () => Neutralino.app.exit());

boot();
bindEvents();
renderQualityOptions(loadValue(STORAGE_KEYS.quality, ""));
renderModeLabel();
async function boot() {
  try {
    await renderRevisionInfo();
    loadDrivePreferences();
    await ensureRuntimeAssets();
    const health = await invokeBackend("health");
    currentTargetRoot = health.downloadsDir;
    targetRootInput.value = currentTargetRoot;
    destinationLabel.textContent = shortenPath(currentTargetRoot);
    renderRuntimeStatus(health);
    await refreshDriveStatus(true);
  } catch (error) {
    runtimeEl.textContent = error.message;
    setErrorState(error.message);
  }
}

function renderRuntimeStatus(health) {
  runtimeEl.textContent = [
    `yt-dlp: ${health.ytDlpInstalled ? "bundled" : "missing"}`,
    `ffmpeg: ${health.ffmpegAvailable ? "bundled" : "missing"}`,
    `drive: ${health.driveConnected ? "connected" : "not connected"}`,
    `runtime folder: ${health.downloadsDir}`
  ].join(" | ");
}

async function renderRevisionInfo() {
  if (!revisionEl) {
    return;
  }

  let appVersion = window.NL_APPVERSION || "unknown";
  let runtimeVersion = window.NL_VERSION || "unknown";

  try {
    const config = await Neutralino.app.getConfig();
    appVersion = config?.version || appVersion;
  } catch {
    // Fall back to Neutralino globals when config is unavailable.
  }

  revisionEl.textContent = `Version ${appVersion} | Runtime ${runtimeVersion}`;
}

function bindEvents() {
  chooseFolder.addEventListener("click", async () => {
    const folder = await Neutralino.os.showFolderDialog("Choose save folder", {
      defaultPath: currentTargetRoot || undefined
    });

    if (folder) {
      currentTargetRoot = folder;
      targetRootInput.value = currentTargetRoot;
      destinationLabel.textContent = shortenPath(currentTargetRoot);
      formNote.textContent = "Save location updated.";
    }
  });

  openFolder.addEventListener("click", async () => {
    const target = currentTargetRoot || targetRootInput.value.trim();
    if (target) {
      await Neutralino.os.open(target);
    }
  });

  openFile.addEventListener("click", async () => {
    if (latestFilePath) {
      await Neutralino.os.open(latestFilePath);
    }
  });

  driveClientIdInput.addEventListener("input", () => {
    storeValue(STORAGE_KEYS.driveClientId, driveClientIdInput.value.trim());
  });

  driveFolderSelect.addEventListener("change", () => {
    storeValue(STORAGE_KEYS.driveFolderId, driveFolderSelect.value);
  });

  uploadToDriveInput.addEventListener("change", () => {
    storeValue(STORAGE_KEYS.uploadToDrive, uploadToDriveInput.checked ? "1" : "0");
  });

  driveConnectButton.addEventListener("click", connectDrive);
  driveRefreshButton.addEventListener("click", () => loadDriveFolders(true));
  driveDisconnectButton.addEventListener("click", disconnectDrive);

  for (const input of modeInputs) {
    input.addEventListener("change", () => {
      renderQualityOptions();
      renderModeLabel();
    });
  }

  qualitySelect.addEventListener("change", () => {
    storeValue(STORAGE_KEYS.quality, qualitySelect.value);
    renderModeLabel();
  });

  form.addEventListener("submit", handleSubmit);
}
async function handleSubmit(event) {
  event.preventDefault();

  const shouldUpload = uploadToDriveInput.checked;
  const selectedFolderId = driveFolderSelect.value;

  if (shouldUpload && !driveConnected) {
    const message = "Connect Google Drive before enabling upload.";
    formNote.textContent = message;
    setErrorState(message);
    return;
  }

  if (shouldUpload && !selectedFolderId) {
    const message = "Choose a Google Drive folder before enabling upload.";
    formNote.textContent = message;
    setErrorState(message);
    return;
  }

  submit.disabled = true;
  chooseFolder.disabled = true;
  openFile.disabled = true;
  latestFilePath = "";
  startPseudoProgress();
  formNote.textContent = shouldUpload ? "Downloader is running. Drive upload will start after the local file is ready." : "Downloader is running.";

  try {
    const result = await invokeBackend("download", {
      url: document.getElementById("url").value.trim(),
      mode: getSelectedMode(),
      customName: document.getElementById("customName").value.trim(),
      quality: qualitySelect.value,
      targetRoot: targetRootInput.value.trim()
    });

    latestFilePath = result.filePath || "";
    openFile.disabled = !latestFilePath;

    let uploadResult = null;
    let uploadError = null;

    if (shouldUpload && latestFilePath) {
      stopPseudoProgress(96);
      setWorkingState("Uploading to Google Drive...", "Sending the completed local file to the selected Google Drive folder.", 96, "Uploading");
      try {
        uploadResult = await invokeBackend("drive-upload", {
          filePath: latestFilePath,
          folderId: selectedFolderId
        });
      } catch (error) {
        uploadError = error;
      }
    }

    stopPseudoProgress(100);
    const baseDetails = result.filePath
      ? `Saved to: ${result.filePath}\n\n${result.log}`
      : result.log || "Completed.";

    if (uploadResult) {
      headline.textContent = `${result.message} Uploaded to Google Drive.`;
      headline.className = "success";
      statusBadge.textContent = "Complete";
      progressLabel.textContent = "Finished";
      progressValue.textContent = "100%";
      details.textContent = `${baseDetails}\n\nGoogle Drive upload completed.${uploadResult.name ? `\nFile: ${uploadResult.name}` : ""}${uploadResult.webViewLink ? `\n${uploadResult.webViewLink}` : ""}`;
      formNote.textContent = "Download and Google Drive upload completed.";
    } else if (uploadError) {
      headline.textContent = result.message;
      headline.className = "working";
      statusBadge.textContent = "Partial";
      progressLabel.textContent = "Saved locally";
      progressValue.textContent = "100%";
      details.textContent = `${baseDetails}\n\nGoogle Drive upload failed.\n${uploadError.message}`;
      formNote.textContent = "Downloaded locally. Google Drive upload failed.";
    } else {
      headline.textContent = result.message;
      headline.className = "success";
      statusBadge.textContent = "Complete";
      progressLabel.textContent = "Finished";
      progressValue.textContent = "100%";
      details.textContent = baseDetails;
      formNote.textContent = "Download completed.";
    }

    const refreshed = await invokeBackend("health");
    renderRuntimeStatus(refreshed);
  } catch (error) {
    stopPseudoProgress(Math.min(currentProgress, 88));
    setErrorState(error.message);
    formNote.textContent = "The last job failed.";
  } finally {
    submit.disabled = false;
    chooseFolder.disabled = false;
    setDriveControlsBusy(false);
  }
}

async function connectDrive() {
  const clientId = driveClientIdInput.value.trim();
  if (!clientId) {
    driveNote.textContent = "Paste a Google OAuth Desktop client ID first.";
    return;
  }

  setDriveControlsBusy(true);
  driveNote.textContent = "Opening your browser for Google Drive sign-in...";

  try {
    const result = await invokeBackend("drive-connect", { clientId });
    driveConnected = true;
    storeValue(STORAGE_KEYS.driveClientId, clientId);
    updateDriveStatusUi(result);
    await loadDriveFolders(false);
    driveNote.textContent = result.email ? `Connected as ${result.email}.` : "Connected to Google Drive.";
  } catch (error) {
    driveNote.textContent = error.message;
  } finally {
    setDriveControlsBusy(false);
  }
}

async function disconnectDrive() {
  setDriveControlsBusy(true);
  try {
    await invokeBackend("drive-disconnect");
    driveConnected = false;
    populateDriveFolders([], "");
    driveNote.textContent = "Google Drive disconnected.";
    updateDriveStatusUi({ connected: false, email: "", clientId: driveClientIdInput.value.trim() });
  } catch (error) {
    driveNote.textContent = error.message;
  } finally {
    setDriveControlsBusy(false);
  }
}
async function refreshDriveStatus(loadFolders) {
  try {
    const status = await invokeBackend("drive-status");
    if (!driveClientIdInput.value.trim() && status.clientId) {
      driveClientIdInput.value = status.clientId;
      storeValue(STORAGE_KEYS.driveClientId, status.clientId);
    }
    updateDriveStatusUi(status);
    if (status.connected && loadFolders) {
      await loadDriveFolders(false);
    }
  } catch (error) {
    driveNote.textContent = error.message;
  }
}

function updateDriveStatusUi(status) {
  driveConnected = !!status.connected;
  driveConnectButton.textContent = driveConnected ? "Reconnect" : "Connect";
  driveDisconnectButton.disabled = !driveConnected || driveBusy;
  driveRefreshButton.disabled = !driveConnected || driveBusy;

  if (driveConnected) {
    driveNote.textContent = status.email ? `Connected as ${status.email}.` : "Connected to Google Drive.";
  } else if (!driveBusy) {
    driveNote.textContent = "Not connected.";
  }
}

async function loadDriveFolders(showLoading) {
  if (!driveConnected) {
    populateDriveFolders([], "");
    driveNote.textContent = "Connect Google Drive to load folders.";
    return;
  }

  if (showLoading) {
    driveNote.textContent = "Loading Google Drive folders...";
  }

  setDriveControlsBusy(true);
  try {
    const result = await invokeBackend("drive-list-folders");
    const selectedFolderId = loadValue(STORAGE_KEYS.driveFolderId, "");
    populateDriveFolders(Array.isArray(result.folders) ? result.folders : [], selectedFolderId);
    driveNote.textContent = driveFolderSelect.options.length > 1 ? "Step 3 ready: choose a folder, then turn on auto-upload." : "No Google Drive folders were returned for this account.";
    syncDriveUiState();
  } catch (error) {
    driveNote.textContent = error.message;
  } finally {
    setDriveControlsBusy(false);
  }
}

function populateDriveFolders(folders, selectedId) {
  driveFolderSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = folders.length ? "Choose Google Drive folder" : "No folders available";
  driveFolderSelect.appendChild(placeholder);

  for (const folder of folders) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.name;
    driveFolderSelect.appendChild(option);
  }

  if (selectedId && folders.some((folder) => folder.id === selectedId)) {
    driveFolderSelect.value = selectedId;
  } else if (folders.length === 1) {
    driveFolderSelect.value = folders[0].id;
    storeValue(STORAGE_KEYS.driveFolderId, folders[0].id);
  } else if (folders.some((folder) => folder.id === "root")) {
    driveFolderSelect.value = "root";
    storeValue(STORAGE_KEYS.driveFolderId, "root");
  } else {
    driveFolderSelect.value = "";
    storeValue(STORAGE_KEYS.driveFolderId, "");
  }

  syncDriveUiState();
}

function syncDriveUiState() {
  const hasClientId = !!driveClientIdInput.value.trim();
  const hasFolder = !!driveFolderSelect.value;

  driveConnectButton.textContent = driveConnected ? "Reconnect Google" : "Step 2: Connect Google";
  driveConnectButton.disabled = driveBusy || !hasClientId;
  driveRefreshButton.disabled = driveBusy || !driveConnected;
  driveDisconnectButton.disabled = driveBusy || !driveConnected;
  uploadToDriveInput.disabled = !driveConnected || !hasFolder;

  if ((!driveConnected || !hasFolder) && uploadToDriveInput.checked) {
    uploadToDriveInput.checked = false;
    storeValue(STORAGE_KEYS.uploadToDrive, "0");
  }

  if (driveBusy) {
    return;
  }

  if (!hasClientId) {
    driveNote.textContent = "Step 1: paste your Google Desktop App client ID.";
    return;
  }

  if (!driveConnected) {
    driveNote.textContent = "Step 2: click Connect Google and finish sign-in in your browser.";
    return;
  }

  if (!hasFolder) {
    driveNote.textContent = "Step 3: choose the Google Drive folder that should receive uploads.";
    return;
  }

  if (!uploadToDriveInput.checked) {
    driveNote.textContent = "Step 4: turn on auto-upload if you want future downloads sent to Google Drive.";
    return;
  }

  driveNote.textContent = "Ready. New downloads will upload to the selected Google Drive folder.";
}
function setDriveControlsBusy(isBusy) {
  driveBusy = isBusy;
  driveConnectButton.disabled = isBusy;
  driveRefreshButton.disabled = isBusy || !driveConnected;
  driveDisconnectButton.disabled = isBusy || !driveConnected;
}

function loadDrivePreferences() {
  driveClientIdInput.value = loadValue(STORAGE_KEYS.driveClientId, "");
  uploadToDriveInput.checked = loadValue(STORAGE_KEYS.uploadToDrive, "0") === "1";
}

function loadValue(key, fallbackValue) {
  try {
    return window.localStorage.getItem(key) ?? fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function storeValue(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures.
  }
}

async function invokeBackend(action, payload = {}) {
  const paths = await ensureRuntimeAssets();
  const encodedPayload = toBase64Utf8(JSON.stringify(payload));
  const escapedScriptPath = paths.script.replace(/"/g, '""');
  const command = `powershell -NoProfile -ExecutionPolicy Bypass -File "${escapedScriptPath}" -Action "${action}" -PayloadBase64 "${encodedPayload}"`;
  const result = await Neutralino.os.execCommand(command);
  const output = [result.stdOut || "", result.stdErr || ""].filter(Boolean).join("\n").trim();
  const parsed = extractJsonResult(output);

  if (result.exitCode !== 0 || (parsed && parsed.ok === false)) {
    throw new Error(parsed?.error || output || "Command failed.");
  }

  return parsed || { ok: true };
}

async function ensureRuntimeAssets() {
  if (runtimeAssetsReady && runtimePaths) {
    return runtimePaths;
  }

  runtimePaths = await getRuntimePaths();
  await ensureDirectory(runtimePaths.root);
  await ensureDirectory(runtimePaths.bin);
  await ensureDirectory(runtimePaths.downloads);
  await ensureDirectory(`${runtimePaths.downloads}\\video`);
  await ensureDirectory(`${runtimePaths.downloads}\\audio`);

  await writeTextResource(RESOURCE_CANDIDATES.script, runtimePaths.script);
  await writeBinaryResourceIfMissing(RESOURCE_CANDIDATES.ytDlp, runtimePaths.ytDlp);
  await writeBinaryResourceIfMissing(RESOURCE_CANDIDATES.ffmpeg, runtimePaths.ffmpeg);

  runtimeAssetsReady = true;
  return runtimePaths;
}

async function getRuntimePaths() {
  if (runtimePaths) {
    return runtimePaths;
  }

  const tempDir = await Neutralino.os.getPath("temp");
  const root = `${tempDir}\\VideoDLLite`;
  runtimePaths = {
    root,
    bin: `${root}\\bin`,
    downloads: `${root}\\downloads`,
    script: `${root}\\downloader.ps1`,
    ytDlp: `${root}\\bin\\yt-dlp.exe`,
    ffmpeg: `${root}\\bin\\ffmpeg.exe`
  };
  return runtimePaths;
}

async function ensureDirectory(path) {
  try {
    await Neutralino.filesystem.createDirectory(path);
  } catch {
    // Directory may already exist.
  }
}

async function writeTextResource(resourcePaths, destinationPath) {
  const { content } = await readTextResource(resourcePaths);
  await Neutralino.filesystem.writeFile(destinationPath, content);
}

async function writeBinaryResourceIfMissing(resourcePaths, destinationPath) {
  if (await fileExists(destinationPath)) {
    return;
  }

  const { content } = await readBinaryResource(resourcePaths);
  await Neutralino.filesystem.writeBinaryFile(destinationPath, content);
}

async function readTextResource(resourcePaths) {
  let lastError = null;
  for (const resourcePath of resourcePaths) {
    try {
      const content = await Neutralino.resources.readFile(resourcePath);
      return { path: resourcePath, content };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Unable to read bundled text resource. Tried: ${resourcePaths.join(", ")}. ${lastError?.message || ""}`.trim());
}

async function readBinaryResource(resourcePaths) {
  let lastError = null;
  for (const resourcePath of resourcePaths) {
    try {
      const content = await Neutralino.resources.readBinaryFile(resourcePath);
      return { path: resourcePath, content };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Unable to read bundled binary resource. Tried: ${resourcePaths.join(", ")}. ${lastError?.message || ""}`.trim());
}
async function fileExists(path) {
  try {
    await Neutralino.filesystem.getStats(path);
    return true;
  } catch {
    return false;
  }
}

function extractJsonResult(output) {
  if (!output) {
    return null;
  }

  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith("{")) {
      continue;
    }

    try {
      return JSON.parse(line);
    } catch {
      // Continue scanning for the last valid JSON line.
    }
  }

  return null;
}

function getQualityOptions(mode) {
  return mode === "mp3"
    ? [
        { value: "best", label: "Best available MP3" },
        { value: "320k", label: "320 kbps" },
        { value: "192k", label: "192 kbps" },
        { value: "128k", label: "128 kbps" }
      ]
    : [
        { value: "best", label: "Best available MP4" },
        { value: "2160p", label: "4K / 2160p" },
        { value: "1440p", label: "1440p" },
        { value: "1080p", label: "1080p" },
        { value: "720p", label: "720p" },
        { value: "480p", label: "480p" }
      ];
}

function renderQualityOptions(preferredValue = "") {
  const options = getQualityOptions(getSelectedMode());
  const nextValue = options.some((option) => option.value === preferredValue)
    ? preferredValue
    : options[0].value;

  qualitySelect.innerHTML = "";
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    qualitySelect.appendChild(el);
  }

  qualitySelect.value = nextValue;
  storeValue(STORAGE_KEYS.quality, nextValue);
}

function getSelectedQualityLabel() {
  const selected = qualitySelect.options[qualitySelect.selectedIndex];
  return selected ? selected.textContent : "";
}
function startPseudoProgress() {
  clearInterval(progressTimer);
  currentProgress = 6;
  setWorkingState("Preparing download...", "Launching the local downloader and checking bundled tools.", currentProgress, "Starting");

  progressTimer = setInterval(() => {
    currentProgress = Math.min(currentProgress + (currentProgress < 35 ? 9 : currentProgress < 70 ? 5 : 2), 92);
    setWorkingState(
      currentProgress < 30 ? "Checking local tools..." : currentProgress < 70 ? "Downloading..." : "Finishing up...",
      currentProgress < 30
        ? "Preparing the bundled yt-dlp and ffmpeg runtime."
        : currentProgress < 70
          ? "Transfer is in progress. This lightweight shell waits for the local command to finish."
          : "Processing the final file and writing output to disk.",
      currentProgress,
      currentProgress < 30 ? "Starting" : currentProgress < 70 ? "Downloading" : "Processing"
    );
  }, 900);
}

function stopPseudoProgress(finalPercent) {
  clearInterval(progressTimer);
  progressTimer = null;
  currentProgress = finalPercent;
  progressBar.style.width = `${finalPercent}%`;
  progressValue.textContent = `${Math.round(finalPercent)}%`;
}

function renderModeLabel() {
  const mode = getSelectedMode();
  const qualityLabel = getSelectedQualityLabel();
  modeLabel.textContent = `${mode === "mp3" ? "MP3" : "Video"}${qualityLabel ? ` - ${qualityLabel}` : ""}`;
}

function getSelectedMode() {
  const selected = document.querySelector('input[name="mode"]:checked');
  return selected ? selected.value : "video";
}

function setWorkingState(title, detailText, percent, badgeText) {
  headline.textContent = title;
  headline.className = "working";
  statusBadge.textContent = badgeText;
  progressLabel.textContent = badgeText;
  progressValue.textContent = `${Math.round(percent)}%`;
  progressBar.style.width = `${percent}%`;
  details.textContent = detailText;
}

function setErrorState(message) {
  headline.textContent = "Failed.";
  headline.className = "error";
  statusBadge.textContent = "Error";
  progressLabel.textContent = "Stopped";
  progressValue.textContent = `${Math.round(currentProgress)}%`;
  progressBar.style.width = `${currentProgress}%`;
  details.textContent = message;
}

function shortenPath(value) {
  if (!value) {
    return "Default folder";
  }
  return value.length > 34 ? `${value.slice(0, 15)}...${value.slice(-16)}` : value;
}

function toBase64Utf8(value) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)));
}






