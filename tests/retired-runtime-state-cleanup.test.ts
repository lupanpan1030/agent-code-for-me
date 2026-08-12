import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cleanupRetiredRuntimeState } from "../src/main/lib/retired-runtime-state-cleanup"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

function retiredPaths(userDataPath: string) {
  const managedRuntimeId = "kun"
  const cliRuntimeId = "qwen"
  return {
    managedSettings: join(
      userDataPath,
      `${managedRuntimeId}-cli-settings.json`,
    ),
    cliSettings: join(userDataPath, `${cliRuntimeId}-cli-settings.json`),
    managedRuntime: join(userDataPath, "runtimes", managedRuntimeId),
    featureSettings: join(userDataPath, "runtime-feature-settings.json"),
  }
}

describe("retired runtime state cleanup", () => {
  test("removes every retired path idempotently and preserves unrelated data", async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), "locus-retired-state-"))
    temporaryDirectories.push(userDataPath)
    const paths = retiredPaths(userDataPath)
    const unrelatedPath = join(userDataPath, "keep.json")

    await mkdir(paths.managedRuntime, { recursive: true })
    await Promise.all([
      writeFile(paths.managedSettings, "{}"),
      writeFile(paths.cliSettings, "{}"),
      writeFile(join(paths.managedRuntime, "binary"), "third-party"),
      writeFile(paths.featureSettings, "{}"),
      writeFile(unrelatedPath, "{}"),
    ])

    await cleanupRetiredRuntimeState(userDataPath)
    await cleanupRetiredRuntimeState(userDataPath)

    expect(existsSync(paths.managedSettings)).toBe(false)
    expect(existsSync(paths.cliSettings)).toBe(false)
    expect(existsSync(paths.managedRuntime)).toBe(false)
    expect(existsSync(paths.featureSettings)).toBe(false)
    expect(existsSync(unrelatedPath)).toBe(true)
  })

  test("isolates permission failures so every cleanup operation is attempted", async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), "locus-retired-state-"))
    temporaryDirectories.push(userDataPath)
    await mkdir(join(userDataPath, "runtimes"))

    const attemptedPaths: string[] = []
    const warnings: string[] = []

    await cleanupRetiredRuntimeState(userDataPath, {
      unlink: async (path) => {
        attemptedPaths.push(path)
        if (path.endsWith("runtime-feature-settings.json")) {
          throw Object.assign(new Error("permission denied"), {
            code: "EACCES",
          })
        }
      },
      rm: async (path) => {
        attemptedPaths.push(path)
      },
      lstat: async () => ({
        isDirectory: () => true,
        isSymbolicLink: () => false,
      }),
      realpath,
      warn: (message) => warnings.push(message),
    })

    expect(attemptedPaths).toHaveLength(4)
    expect(warnings).toEqual([
      "[App] Failed to remove retired runtime feature settings:",
    ])
  })

  test("refuses an intermediate runtimes symlink without touching its target", async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), "locus-retired-state-"))
    const outsidePath = await mkdtemp(join(tmpdir(), "locus-outside-state-"))
    temporaryDirectories.push(userDataPath, outsidePath)
    const managedRuntimeId = "kun"
    const outsideRuntimePath = join(outsidePath, managedRuntimeId)
    const outsideFilePath = join(outsideRuntimePath, "keep.bin")
    const warnings: string[] = []

    await mkdir(outsideRuntimePath)
    await writeFile(outsideFilePath, "outside-data")
    await symlink(outsidePath, join(userDataPath, "runtimes"), "dir")

    await cleanupRetiredRuntimeState(userDataPath, {
      unlink,
      rm,
      lstat,
      realpath,
      warn: (message) => warnings.push(message),
    })

    expect(await readFile(outsideFilePath, "utf8")).toBe("outside-data")
    expect(warnings).toEqual([
      "[App] Failed to remove retired managed-runtime files:",
    ])
  })
})
