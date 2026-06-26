window.onerror = (msg, url, line) => {
  console.error("[HTML] Global error:", msg, "at", url, "line", line)

  const root = document.getElementById("root")
  if (root && root.dataset.reactMounted !== "true") {
    root.textContent = `Error: ${String(msg)}`
  }
}
