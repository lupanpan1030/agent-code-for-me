export type WorkbenchDiffSurface = "details" | "mobile" | "full-page"

export function openWorkbenchDiffSurface(input: {
  isMobile: boolean
  openDetailsWidget: (widget: "diff") => boolean
  setDiffDisplayMode: (mode: "details-expanded" | "full-page") => void
  setDiffSidebarOpen: (open: boolean) => void
  setMobileViewMode: (mode: "diff") => void
}): WorkbenchDiffSurface {
  input.setDiffDisplayMode("details-expanded")
  input.setDiffSidebarOpen(false)
  if (input.openDetailsWidget("diff")) return "details"

  if (input.isMobile) {
    input.setMobileViewMode("diff")
    return "mobile"
  }

  input.setDiffDisplayMode("full-page")
  input.setDiffSidebarOpen(true)
  return "full-page"
}
