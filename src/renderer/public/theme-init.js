;(() => {
  const stored = localStorage.getItem("theme")
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
  const theme =
    stored === "light"
      ? "light"
      : stored === "dark"
        ? "dark"
        : prefersDark
          ? "dark"
          : "light"

  document.documentElement.classList.add(theme)
})()
