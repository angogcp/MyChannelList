
      const form = document.getElementById("download-form");
      const submit = document.getElementById("submit");
      const headline = document.getElementById("headline");
      const details = document.getElementById("details");
      const driveClientIdInput = document.getElementById("driveClientId");
      const driveFolderSelect = document.getElementById("driveFolder");
      const driveConnectButton = document.getElementById("drive-connect");
      const driveRefreshButton = document.getElementById("drive-refresh");
      const driveDisconnectButton = document.getElementById("drive-disconnect");
      const uploadToDriveInput = document.getElementById("uploadToDrive");
      const deleteLocalAfterUploadInput = document.getElementById("deleteLocalAfterUpload");
      const driveNote = document.getElementById("drive-note");
      const driveStatus = document.getElementById("drive-status");

      const STORAGE_KEYS = {
        clientId: "video-dl.web.drive.clientId",
        folderId: "video-dl.web.drive.folderId",
        upload: "video-dl.web.drive.upload",
        deleteLocal: "video-dl.web.drive.deleteLocal"
      };

      let driveConnected = false;
      let driveBusy = false;

      boot();
      bindEvents();

      async function boot() {
        loadPreferences();
        await refreshDriveStatus(true);
      }

      function bindEvents() {
        driveClientIdInput.addEventListener("input", () => {
          storeValue(STORAGE_KEYS.clientId, driveClientIdInput.value.trim());
          syncDriveUiState();
        });

        driveFolderSelect.addEventListener("change", () => {
          storeValue(STORAGE_KEYS.folderId, driveFolderSelect.value);
          syncDriveUiState();
        });

        uploadToDriveInput.addEventListener("change", () => {
          storeValue(STORAGE_KEYS.upload, uploadToDriveInput.checked ? "1" : "0");
          syncDriveUiState();
        });

        deleteLocalAfterUploadInput.addEventListener("change", () => {
          storeValue(STORAGE_KEYS.deleteLocal, deleteLocalAfterUploadInput.checked ? "1" : "0");
        });

        driveConnectButton.addEventListener("click", connectDrive);
        driveRefreshButton.addEventListener("click", () => loadDriveFolders(true));
        driveDisconnectButton.addEventListener("click", disconnectDrive);
        form.addEventListener("submit", handleSubmit);
      }

      async function handleSubmit(event) {
        event.preventDefault();
        const uploadToDrive = uploadToDriveInput.checked;
        const driveFolderId = driveFolderSelect.value;
        const deleteLocalAfterUpload = deleteLocalAfterUploadInput.checked;

        if (uploadToDrive && !driveConnected) {
          setFailure("Connect Google Drive before enabling upload.");
          return;
        }

        if (uploadToDrive && !driveFolderId) {
          setFailure("Choose a Google Drive folder before enabling upload.");
          return;
        }

        submit.disabled = true;
        headline.textContent = uploadToDrive ? "Downloading and uploading..." : "Downloading...";
        headline.className = "";
        details.textContent = uploadToDrive
          ? "Fetching media, then uploading it to Google Drive."
          : "Fetching media and writing files locally.";

        const payload = {
          url: document.getElementById("url").value.trim(),
          mode: document.getElementById("mode").value,
          customName: document.getElementById("customName").value.trim(),
          uploadToDrive,
          driveFolderId,
          deleteLocalAfterUpload
        };

        try {
          const data = await api("/api/download", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          });

          const driveUpload = data.driveUpload || null;
          headline.textContent = driveUpload
            ? deleteLocalAfterUpload
              ? "Uploaded to Google Drive. Local file removed."
              : "Downloaded and uploaded to Google Drive."
            : data.message;
          headline.className = "success";
          details.textContent = renderDownloadDetails(data, driveUpload, deleteLocalAfterUpload);
        } catch (error) {
          setFailure(error.message);
        } finally {
          submit.disabled = false;
        }
      }

      async function connectDrive() {
        const clientId = driveClientIdInput.value.trim();
        if (!clientId) {
          driveNote.textContent = "Paste your Google Desktop App client ID first.";
          return;
        }

        setDriveBusy(true);
        driveNote.textContent = "Opening Google sign-in in this tab...";
        storeValue(STORAGE_KEYS.clientId, clientId);

        const connectUrl = `/api/drive/connect-start?clientId=${encodeURIComponent(clientId)}`;
        window.location.assign(connectUrl);
      }

      async function disconnectDrive() {
        setDriveBusy(true);
        try {
          await api("/api/drive/disconnect", { method: "POST" });
          driveConnected = false;
          populateFolders([], "");
          syncDriveUiState();
        } catch (error) {
          driveNote.textContent = error.message;
        } finally {
          setDriveBusy(false);
        }
      }

      async function refreshDriveStatus(loadFolders) {
        try {
          const status = await api("/api/drive/status");
          driveConnected = !!status.connected;
          if (!driveClientIdInput.value.trim() && status.clientId) {
            driveClientIdInput.value = status.clientId;
            storeValue(STORAGE_KEYS.clientId, status.clientId);
          }
          syncDriveUiState(status.email || "");
          if (driveConnected && loadFolders) {
            await loadDriveFolders(false);
          }
        } catch (error) {
          driveNote.textContent = error.message;
        }
      }

      async function loadDriveFolders(showLoading) {
        if (!driveConnected) {
          populateFolders([], "");
          syncDriveUiState();
          return;
        }

        if (showLoading) {
          driveNote.textContent = "Loading Google Drive folders...";
        }

        setDriveBusy(true);
        try {
          const result = await api("/api/drive/folders");
          populateFolders(Array.isArray(result.folders) ? result.folders : [], loadValue(STORAGE_KEYS.folderId, ""));
        } catch (error) {
          driveNote.textContent = error.message;
        } finally {
          setDriveBusy(false);
        }
      }

      function populateFolders(folders, selectedId) {
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
        } else if (folders.some((folder) => folder.id === "root")) {
          driveFolderSelect.value = "root";
          storeValue(STORAGE_KEYS.folderId, "root");
        } else {
          driveFolderSelect.value = "";
          storeValue(STORAGE_KEYS.folderId, "");
        }

        syncDriveUiState();
      }

      function syncDriveUiState(email = "") {
        const hasClientId = !!driveClientIdInput.value.trim();
        const hasFolder = !!driveFolderSelect.value;

        driveStatus.textContent = driveConnected ? (email ? `Connected as ${email}` : "Connected") : "Not connected";
        driveConnectButton.disabled = driveBusy || !hasClientId;
        driveRefreshButton.disabled = driveBusy || !driveConnected;
        driveDisconnectButton.disabled = driveBusy || !driveConnected;
        uploadToDriveInput.disabled = !driveConnected || !hasFolder;
        deleteLocalAfterUploadInput.disabled = !uploadToDriveInput.checked || uploadToDriveInput.disabled;

        if ((!driveConnected || !hasFolder) && uploadToDriveInput.checked) {
          uploadToDriveInput.checked = false;
          storeValue(STORAGE_KEYS.upload, "0");
        }

        if (!uploadToDriveInput.checked) {
          deleteLocalAfterUploadInput.checked = loadValue(STORAGE_KEYS.deleteLocal, "0") === "1";
        }

        if (driveBusy) {
          return;
        }

        if (!hasClientId) {
          driveNote.textContent = "Step 1: paste your Google Desktop App client ID.";
          return;
        }

        if (!driveConnected) {
          driveNote.textContent = "Step 2: connect Google Drive in this tab.";
          return;
        }

        if (!hasFolder) {
          driveNote.textContent = "Step 3: choose a Google Drive folder or use My Drive (Root).";
          return;
        }

        if (!uploadToDriveInput.checked) {
          driveNote.textContent = "Step 4: turn on upload if you want completed downloads sent to Google Drive.";
          return;
        }

        driveNote.textContent = deleteLocalAfterUploadInput.checked
          ? "Ready. New downloads will upload to Google Drive and then remove the local file."
          : "Ready. New downloads will upload to Google Drive after the local download finishes.";
      }

      function loadPreferences() {
        driveClientIdInput.value = loadValue(STORAGE_KEYS.clientId, "");
        uploadToDriveInput.checked = loadValue(STORAGE_KEYS.upload, "0") === "1";
        deleteLocalAfterUploadInput.checked = loadValue(STORAGE_KEYS.deleteLocal, "0") === "1";
        syncDriveUiState();
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

      async function api(url, options = {}) {
        const response = await fetch(url, options);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Request failed.");
        }
        return data;
      }

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function renderDownloadDetails(data, driveUpload, deleteLocalAfterUpload) {
        const lines = [];
        if (driveUpload) {
          lines.push(deleteLocalAfterUpload ? "Local file removed after upload." : `Saved to: ${data.filePath}`);
          lines.push(`Google Drive file: ${driveUpload.name}`);
          if (driveUpload.webViewLink) {
            lines.push(driveUpload.webViewLink);
          }
          lines.push("");
          lines.push(data.log || "Completed.");
          return lines.join("\n");
        }

        return data.filePath
          ? `Saved to: ${data.filePath}\n\n${data.log}`
          : data.log || "Completed.";
      }

      function setFailure(message) {
        headline.textContent = "Failed.";
        headline.className = "error";
        details.textContent = message;
      }
    