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
      }