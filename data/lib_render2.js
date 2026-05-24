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
          row.innerHTML = "<div>test</div>";
          row.querySelector(".file-play").addEventListener("click", () => playFile(f));
          row.querySelector(".file-del").addEventListener("click", () => deleteSingle(f));
          fileListEl.appendChild(row);
        }
      }
