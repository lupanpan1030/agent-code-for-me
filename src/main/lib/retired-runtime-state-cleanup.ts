import { lstat, realpath, rm, unlink } from "node:fs/promises"
import { join, resolve } from "node:path"

type PathStat = {
  isDirectory: () => boolean
  isSymbolicLink: () => boolean
}

type CleanupDependencies = {
  unlink: (path: string) => Promise<void>
  rm: (path: string, options: { recursive: true; force: true }) => Promise<void>
  lstat: (path: string) => Promise<PathStat>
  realpath: (path: string) => Promise<string>
  warn: (message: string, error: unknown) => void
}

const defaultDependencies: CleanupDependencies = {
  unlink,
  rm,
  lstat,
  realpath,
  warn: (message, error) => console.warn(message, error),
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  )
}

async function removeManagedRuntimeDirectory(
  userDataPath: string,
  runtimeId: string,
  dependencies: CleanupDependencies,
): Promise<void> {
  const runtimesPath = join(userDataPath, "runtimes")
  const runtimesStat = await dependencies.lstat(runtimesPath)
  if (runtimesStat.isSymbolicLink() || !runtimesStat.isDirectory()) {
    throw new Error("Refusing to clean an unsafe runtimes directory")
  }

  const [resolvedUserDataPath, resolvedRuntimesPath] = await Promise.all([
    dependencies.realpath(userDataPath),
    dependencies.realpath(runtimesPath),
  ])
  if (
    resolve(resolvedRuntimesPath) !== resolve(resolvedUserDataPath, "runtimes")
  ) {
    throw new Error("Refusing to clean a runtimes directory outside userData")
  }

  const runtimePath = join(runtimesPath, runtimeId)
  const runtimeStat = await dependencies.lstat(runtimePath)
  if (runtimeStat.isSymbolicLink()) {
    await dependencies.unlink(runtimePath)
    return
  }

  await dependencies.rm(runtimePath, { recursive: true, force: true })
}

export async function cleanupRetiredRuntimeState(
  userDataPath: string,
  dependencies: CleanupDependencies = defaultDependencies,
): Promise<void> {
  // Written as plain literals on purpose. An earlier revision built these by
  // joining split fragments so the change's residue grep would report zero —
  // which hid the code that deletes these paths from anyone searching for them.
  const retiredManagedRuntimeId = "kun"
  const retiredCliRuntimeId = "qwen"
  const operations = [
    {
      label: "retired managed-runtime settings",
      remove: () =>
        dependencies.unlink(
          join(userDataPath, `${retiredManagedRuntimeId}-cli-settings.json`),
        ),
    },
    {
      label: "retired CLI-runtime settings",
      remove: () =>
        dependencies.unlink(
          join(userDataPath, `${retiredCliRuntimeId}-cli-settings.json`),
        ),
    },
    {
      label: "retired managed-runtime files",
      remove: () =>
        removeManagedRuntimeDirectory(
          userDataPath,
          retiredManagedRuntimeId,
          dependencies,
        ),
    },
    {
      label: "retired runtime feature settings",
      remove: () =>
        dependencies.unlink(
          join(userDataPath, "runtime-feature-settings.json"),
        ),
    },
  ]

  await Promise.all(
    operations.map(async ({ label, remove }) => {
      try {
        await remove()
      } catch (error) {
        if (isMissingPathError(error)) return
        try {
          dependencies.warn(`[App] Failed to remove ${label}:`, error)
        } catch {
          // Cleanup diagnostics must never turn an upgrade sweep into a startup failure.
        }
      }
    }),
  )
}
