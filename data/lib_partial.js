      const fileListEl = document.getElementById("file-list");
      const statusBar = document.getElementById("status-bar");
      const refreshBtn = document.getElementById("refresh-btn");
      const deleteSelectedBtn = document.getElementById("delete-selected-btn");
      const selectRow = document.getElementById("select-row");
      const selectAllCb = document.getElementById("select-all");
      const selectedCountEl = document.getElementById("selected-count");
      const searchInput = document.getElementById("search");
      const statTotal = document.getElementById("stat-total");
      const statVideo = document.getElementById("stat-video");
      const statAudio = document.getElementById("stat-audio");
      const statSize = document.getElementById("stat-size");
      const playerOverlay = document.getElementById("player-overlay");
      const playerStage = document.getElementById("player-stage");
      const playerTitle = document.getElementById("player-title");
      const playerSub = document.getElementById("player-sub");
      const playerOpen = document.getElementById("player-open");
      const playerClose = document.getElementById("player-close");

      let allFiles = [];
      let activeFilter = "all";
      let busy = false;

      boot();

      async function boot() {
        refreshBtn.addEventListener("click", loadLibrary);
        deleteSelectedBtn.addEventListener("click", deleteSelected);
        selectAllCb.addEventListener("change", toggleSelectAll);
        searchInput.addEventListener("input", renderFiles);
        playerClose.addEventListener("click", closePlayer);
        playerOverlay.addEventListener("click", (event) => {
          if (event.target === playerOverlay) closePlayer();
        });
        document.addEventListener("keydown", (event) => {
          if (event.key === "Escape" && playerOverlay.classList.contains("open")) closePlayer();
        });

        document.querySelectorAll(".filter-btn").forEach(btn => {
          btn.addEventListener("click", () => {
            document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            activeFilter = btn.dataset.filter;
            renderFiles();
          });
        });

        await loadLibrary();
      }

      async function loadLibrary() {
        if (busy) return;
        busy = true;
        fileListEl.innerHTML = `<div class="file-empty"><span class="spinner"></span> Loading...</div>`;
        selectRow.style.display = "none";
        try {
          const data = await api("/api/library");
          allFiles = data.files || [];
          updateStats();
          renderFiles();
          setStatus("success", `${allFiles.length} file${allFiles.length !== 1 ? "s" : ""} loaded.`);
        } catch (err) {
          fileListEl.innerHTML = `<div class="file-empty" style="color:var(--error)">${esc(err.message)}</div>`;
          setStatus("error", err.message);
        } finally { busy = false; }
      }

      function getFiltered() {
        const q = searchInput.value.trim().toLowerCase();
        return allFiles.filter(f => {
          if (activeFilter !== "all" && f.category !== activeFilter) return false;
          if (q && !f.name.toLowerCase().includes(q)) return false;
          return true;
        });
      }

      function renderFiles() {
        const files = getFiltered();
        fileListEl.innerHTML = "";
        selectAllCb.checked = false;
        deleteSelectedBtn.disabled = true;
        selectedCountEl.textContent = "";

        if (!files.length) {
          fileListEl.innerHTML = `<div class="file-empty">${allFiles.length ? "No matches." : "No files yet."}</div>`;
          selectRow.style.display = "none";
          return;
        }

        selectRow.style.display = "flex";
        files.forEach((f, i) => {
          const row = document.createElement("div");
          row.className = "file-row file-row-with-cb fade-in";
          row.style.setProperty("--delay", String(i));
          const dateStr = fmtDate(f.modified);
          const ext = f.name.split(".").pop().toUpperCase();
          row.innerHTML = `
            <input type="checkbox" class="file-cb" data-path="${esc(f.path)}" />
            <div class="file-info">
              <div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div>
              <div class="file-meta"><span>${dateStr}</span><span>${ext}</span></div>
            </div>
            <span class="file-badge ${f.category}">${f.category}</span>
            <span class="file-size">${f.size}</span>
            <button class="secondary small file-play" data-path="${esc(f.path)}">Play</button>
            <button class="danger small file-del" data-path="${esc(f.path)}">Delete</button>
          `;
          row.querySelector(".file-cb").addEventListener("change", syncSelection);
          row.querySelector(".file-play").addEventListener("click", () => playFile(f));
          row.querySelector(".file-del").addEventListener("click", () => deleteSingle(f));
          fileListEl.appendChild(row);
        }