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
        files.forEach((f, i) => {
          console.log(f, i);
        });

      function toggleSelectAll() {
        const checked = selectAllCb.checked;
        fileListEl.querySelectorAll(".file-cb").forEach(cb => { cb.checked = checked; });
        syncSelection();
      }

      function syncSelection() {
        const all = fileListEl.querySelectorAll(".file-cb");
        const checked = fileListEl.querySelectorAll(".file-cb:checked");
        deleteSelectedBtn.disabled = checked.length === 0;
        selectAllCb.checked = all.length > 0 && checked.length === all.length;
        selectedCountEl.textContent = checked.length ? `${checked.length} selected` : "";
      }

      async function deleteSingle(f) {
        if (!confirm(`Delete "${f.name}"?`)) return;
        try {
          await api("/api/library", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: f.path }) });
          allFiles = allFiles.filter(x => x.path !== f.path);
          updateStats(); renderFiles();
          setStatus("success", `Deleted "${f.name}".`);
        } catch (err) { setStatus("error", err.message); }
      }

      async function deleteSelected() {
        const paths = [...fileListEl.querySelectorAll(".file-cb:checked")].map(cb => cb.dataset.path);
        if (!paths.length) return;
        if (!confirm(`Delete ${paths.length} file${paths.length > 1 ? "s" : ""}?`)) return;
        busy = true; deleteSelectedBtn.disabled = true;
        let deleted = 0, lastError = "";
        for (const p of paths) {
          try {
            await api("/api/library", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: p }) });
            allFiles = allFiles.filter(x => x.path !== p);
            deleted++;
          } catch (err) { lastError = err.message; }
        }
        updateStats(); renderFiles(); busy = false;
        if (lastError) setStatus("error", `${deleted}/${paths.length} deleted. ${lastError}`);
        else setStatus("success", `${deleted} file${deleted > 1 ? "s" : ""} deleted.`);
      }

      function playFile(file) {
        const src = mediaUrl(file);
        const isAudio = file.category === "audio";
        playerTitle.textContent = file.name;
        playerSub.textContent = `${file.category.toUpperCase()} · ${file.size} · ${fmtDate(file.modified)}`;
        playerOpen.href = src;
        playerStage.innerHTML = isAudio
          ? `<audio controls autoplay src="${esc(src)}"></audio>`
          : `<video controls autoplay playsinline src="${esc(src)}"></video>`;
        playerOverlay.classList.add("open");
        playerOverlay.setAttribute("aria-hidden", "false");
        setStatus("", `Playing "${file.name}".`);
      }

      function closePlayer() {
        playerStage.innerHTML = "";
        playerOverlay.classList.remove("open");
        playerOverlay.setAttribute("aria-hidden", "true");
      }

      function mediaUrl(file) {
        return `/api/library/media?path=${encodeURIComponent(file.path)}`;
      }

      function updateStats() {
        const v = allFiles.filter(f => f.category === "video");
        const a = allFiles.filter(f => f.category === "audio");
        const bytes = allFiles.reduce((s, f) => s + f.sizeBytes, 0);
        statTotal.textContent = allFiles.length;
        statVideo.textContent = v.length;
        statAudio.textContent = a.length;
        statSize.textContent = fmtSize(bytes);
      }

      function setStatus(type, msg) {
        statusBar.innerHTML = type ? `<span class="${type}">${esc(msg)}</span>` : esc(msg);
      }

      function fmtDate(iso) {
        try {
          const d = new Date(iso);
          return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" }) + " " +
            d.toLocaleTimeString(undefined, { hour:"2-digit", minute:"2-digit" });
        } catch { return ""; }
      }

      function fmtSize(bytes) {
        if (bytes === 0) return "0 B";
        const u = ["B","KB","MB","GB","TB"];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + u[i];
      }

      function esc(v) {
        return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
      }

      async function api(url, opts = {}) {
        const r = await fetch(url, opts);
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Request failed.");
        return d;
      }

