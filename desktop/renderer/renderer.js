const targetRootInput = document.getElementById("targetRoot");
const runtimeEl = document.getElementById("runtime");
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

let currentTargetRoot = "";
let latestFilePath = "";
let currentPercent = 0;

const modeInputs = Array.from(document.querySelectorAll('input[name="mode"]'));

boot();
bindEvents();
renderModeLabel();

async function boot() {
  try {
    const health = await window.desktopApi.getHealth();
    currentTargetRoot = health.downloadsDir;
    targetRootInput.value = currentTargetRoot;
    destinationLabel.textContent = shortenPath(currentTargetRoot);
    runtimeEl.textContent = [
      `yt-dlp: ${health.ytDlpInstalled ? "installed" : "downloads on first use"}`,
      `ffmpeg: ${health.ffmpegAvailable ? "bundled" : "missing"}`,
      `runtime folder: ${health.downloadsDir}`
    ].join(" | ");
  } catch (error) {
    runtimeEl.textContent = error.message;
  }
}

function bindEvents() {
  chooseFolder.addEventListener("click", async () => {
    const result = await window.desktopApi.pickFolder();
    if (!result.canceled) {
      currentTargetRoot = result.folderPath;
      targetRootInput.value = currentTargetRoot;
      destinationLabel.textContent = shortenPath(currentTargetRoot);
      formNote.textContent = "Save location updated.";
    }
  });

  openFolder.addEventListener("click", async () => {
    const target = currentTargetRoot || targetRootInput.value.trim();
    if (target) {
      await window.desktopApi.openPath(target);
    }
  });

  openFile.addEventListener("click", async () => {
    if (latestFilePath) {
      await window.desktopApi.openPath(latestFilePath);
    }
  });

  for (const input of modeInputs) {
    input.addEventListener("change", renderModeLabel);
  }

  window.desktopApi.onDownloadProgress((progress) => {
    if (progress.filePath) {
      latestFilePath = progress.filePath;
      openFile.disabled = false;
    }

    if (progress.type === "progress") {
      currentPercent = Math.max(currentPercent, progress.percent || 0);
      setWorkingState(`Downloading... ${currentPercent.toFixed(1)}%`, progress.message, currentPercent, "Downloading");
      return;
    }

    setWorkingState("Processing...", progress.message, Math.max(currentPercent, 96), "Processing");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    chooseFolder.disabled = true;
    latestFilePath = "";
    openFile.disabled = true;
    currentPercent = 0;

    setWorkingState(
      "Preparing download...",
      "Fetching media details and starting the transfer.",
      4,
      "Starting"
    );
    formNote.textContent = "Downloader is running.";

    try {
      const result = await window.desktopApi.download({
        url: document.getElementById("url").value.trim(),
        mode: getSelectedMode(),
        customName: document.getElementById("customName").value.trim(),
        targetRoot: targetRootInput.value.trim()
      });

      latestFilePath = result.filePath || latestFilePath;
      openFile.disabled = !latestFilePath;
      headline.textContent = result.message;
      headline.className = "success";
      statusBadge.textContent = "Complete";
      progressLabel.textContent = "Finished";
      progressValue.textContent = "100%";
      progressBar.style.width = "100%";
      details.textContent = result.filePath
        ? `Saved to: ${result.filePath}\n\n${result.log}`
        : result.log || "Completed.";
      formNote.textContent = "Download completed.";
    } catch (error) {
      headline.textContent = "Failed.";
      headline.className = "error";
      statusBadge.textContent = "Error";
      progressLabel.textContent = "Stopped";
      progressValue.textContent = `${Math.round(currentPercent)}%`;
      progressBar.style.width = `${currentPercent}%`;
      details.textContent = error.message;
      formNote.textContent = "The last job failed.";
    } finally {
      submit.disabled = false;
      chooseFolder.disabled = false;
    }
  });
}

function renderModeLabel() {
  modeLabel.textContent = getSelectedMode() === "mp3" ? "MP3" : "Video";
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

function shortenPath(value) {
  if (!value) {
    return "Default folder";
  }

  return value.length > 34 ? `${value.slice(0, 15)}...${value.slice(-16)}` : value;
}
