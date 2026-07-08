import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { type ElectronAppLike, getElectronApp } from "../electron-app"

export const BUNDLED_CODEX_CLI_VERSION = "0.139.0"

function findDevAppRoot(startPaths: Array<string | undefined>): string {
  const visited = new Set<string>()
  for (const startPath of startPaths) {
    if (!startPath) continue
    let current = resolve(startPath)
    while (!visited.has(current)) {
      visited.add(current)
      if (
        existsSync(join(current, "package.json")) &&
        existsSync(join(current, "resources", "cli"))
      ) {
        return current
      }
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  return resolve(startPaths.find(Boolean) ?? process.cwd())
}

export function getBundledCodexCliPath(
  appContext: Pick<
    ElectronAppLike,
    "isPackaged" | "getAppPath"
  > = getElectronApp(),
): string {
  const binaryName = process.platform === "win32" ? "codex.exe" : "codex"
  const resourcesDir = appContext.isPackaged
    ? join(process.resourcesPath, "bin")
    : join(
        findDevAppRoot([appContext.getAppPath?.(), process.cwd()]),
        "resources",
        "bin",
        `${process.platform}-${process.arch}`,
      )

  return join(resourcesDir, binaryName)
}

export function getBundledCodexCliMissingHint(
  appContext: Pick<
    ElectronAppLike,
    "isPackaged" | "getAppPath"
  > = getElectronApp(),
): string {
  return appContext.isPackaged
    ? "Reinstall the app so the bundled Codex command is restored."
    : "Run `bun run codex:download` from the repo, then restart the dev app."
}

export function resolveBundledCodexCliPath(
  appContext: Pick<
    ElectronAppLike,
    "isPackaged" | "getAppPath"
  > = getElectronApp(),
): string {
  const binaryPath = getBundledCodexCliPath(appContext)
  if (existsSync(binaryPath)) {
    return binaryPath
  }

  const hint = getBundledCodexCliMissingHint(appContext)

  throw new Error(
    `[codex] Bundled Codex CLI not found at ${binaryPath}. ${hint}`,
  )
}
