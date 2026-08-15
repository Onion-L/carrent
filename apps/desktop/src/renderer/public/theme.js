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
