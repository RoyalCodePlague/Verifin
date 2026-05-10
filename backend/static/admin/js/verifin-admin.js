(function () {
  const storageKey = "verifin-admin-theme";

  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function applyTheme(theme) {
    const nextTheme = theme || localStorage.getItem(storageKey) || systemTheme();
    document.documentElement.dataset.verifinTheme = nextTheme;
    document.documentElement.classList.toggle("verifin-light", nextTheme === "light");
    document.documentElement.classList.toggle("verifin-dark", nextTheme !== "light");
    const label = document.querySelector("[data-verifin-theme-label]");
    if (label) label.textContent = nextTheme === "light" ? "Light" : "Dark";
  }

  applyTheme();

  window.addEventListener("DOMContentLoaded", function () {
    applyTheme();
    const toggle = document.querySelector("[data-verifin-theme-toggle]");
    if (!toggle) return;
    toggle.addEventListener("click", function () {
      const current = document.documentElement.dataset.verifinTheme === "light" ? "light" : "dark";
      const next = current === "light" ? "dark" : "light";
      localStorage.setItem(storageKey, next);
      applyTheme(next);
    });
  });
})();
