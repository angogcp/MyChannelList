(function () {
  const THEME_KEY = "video-dl.theme";
  const saved = localStorage.getItem(THEME_KEY) || "light";
  document.documentElement.setAttribute("data-theme", saved);

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
    updateToggleBtns(theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
  }

  function updateToggleBtns(theme) {
    document.querySelectorAll(".theme-toggle-btn").forEach((btn) => {
      const isDark = theme === "dark";
      const icon = btn.querySelector(".theme-icon");
      const label = btn.querySelector(".theme-label");
      if (icon) icon.textContent = isDark ? "☀️" : "🌙";
      if (label) label.textContent = isDark ? "晨光流萤" : "暗夜极光";
    });
  }

  window.toggleAppTheme = toggleTheme;

  function init() {
    updateToggleBtns(document.documentElement.getAttribute("data-theme") || "light");
    document.querySelectorAll(".theme-toggle-btn").forEach((btn) => {
      btn.removeEventListener("click", toggleTheme);
      btn.addEventListener("click", toggleTheme);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
