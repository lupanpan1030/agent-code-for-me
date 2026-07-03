type DockLike = {
  hide(): void
}

export type HeadlessDockApp = {
  dock?: DockLike | null
}

type HideDockErrorHandler = (error: unknown) => void

function logHideDockError(error: unknown): void {
  console.warn("[Headless] Failed to hide Dock icon:", error)
}

export function hideDockForHeadlessCli(
  app: HeadlessDockApp,
  platform = process.platform,
  onError: HideDockErrorHandler = logHideDockError,
): void {
  if (platform !== "darwin") return
  try {
    app.dock?.hide()
  } catch (error) {
    onError(error)
  }
}
