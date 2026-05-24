document.addEventListener("DOMContentLoaded", () => {
  const tooltip = document.createElement("div");
  tooltip.className = "custom-tooltip";
  document.body.appendChild(tooltip);

  let activeElement = null;

  function showTooltip(el) {
    const text = el.getAttribute("data-tooltip-text");
    if (!text) return;

    tooltip.textContent = text;
    tooltip.classList.add("visible");
    activeElement = el;
    positionTooltip();
  }

  function hideTooltip() {
    tooltip.classList.remove("visible");
    activeElement = null;
  }

  function positionTooltip() {
    if (!activeElement) return;

    const rect = activeElement.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    // Position above the element, horizontally centered
    let left = rect.left + rect.width / 2;
    let top = rect.top - tooltipRect.height - 8; // 8px offset

    // Boundary check
    if (top < 8) {
      // If not enough space above, position below
      top = rect.bottom + 8;
      tooltip.classList.add("tooltip-below");
    } else {
      tooltip.classList.remove("tooltip-below");
    }

    if (left - tooltipRect.width / 2 < 8) {
      left = tooltipRect.width / 2 + 8;
    } else if (left + tooltipRect.width / 2 > window.innerWidth - 8) {
      left = window.innerWidth - tooltipRect.width / 2 - 8;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function setupTooltips() {
    // Select elements with title or data-tooltip attributes
    const targets = document.querySelectorAll("[title], [data-tooltip]");
    targets.forEach((el) => {
      const title = el.getAttribute("title");
      if (title) {
        el.setAttribute("data-tooltip-text", title);
        el.removeAttribute("title"); // prevent default browser tooltip
      } else {
        const customText = el.getAttribute("data-tooltip");
        if (customText) {
          el.setAttribute("data-tooltip-text", customText);
        }
      }

      // Avoid double binding
      if (el.dataset.tooltipBound) return;
      el.dataset.tooltipBound = "true";

      el.addEventListener("mouseenter", () => showTooltip(el));
      el.addEventListener("mouseleave", hideTooltip);
      el.addEventListener("focus", () => showTooltip(el));
      el.addEventListener("blur", hideTooltip);
    });
  }

  setupTooltips();

  // Re-run setup on dynamic changes (e.g. items rendered dynamically)
  const observer = new MutationObserver(() => {
    setupTooltips();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  window.addEventListener("scroll", positionTooltip, { passive: true });
  window.addEventListener("resize", positionTooltip, { passive: true });
});
