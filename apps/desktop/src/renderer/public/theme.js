// Classic (non-module) JavaScript, deliberately outside TypeScript: this
// must execute synchronously before first paint to avoid a theme flash,
// and Vite copies public/ verbatim with no transform or type checking.
// Documented exception to the repo's TypeScript guideline.
(() => {
  try {
    const raw = localStorage.getItem("carrent:settings");
    const parsed = raw ? JSON.parse(raw) : null;
    const theme = parsed?.theme;
    const resolved =
      theme === "light" || theme === "dark"
        ? theme
        : theme === "system" && window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
    document.documentElement.dataset.theme = resolved;
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
})();
