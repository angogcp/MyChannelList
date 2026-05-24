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