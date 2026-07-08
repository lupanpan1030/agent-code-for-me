import { describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  getBundledCodexCliMissingHint,
  getBundledCodexCliPath,
  resolveBundledCodexCliPath,
} from "../src/main/lib/codex/cli-path"

function createRepoRoot() {
  const root = mkdtempSync(join(tmpdir(), "locus-codex-cli-path-"))
  const appPath = join(root, "out", "main")
  const platformBin = join(
    root,
    "resources",
    "bin",
    `${process.platform}-${process.arch}`,
  )
  mkdirSync(appPath, { recursive: true })
  mkdirSync(join(root, "resources", "cli"), { recursive: true })
  mkdirSync(platformBin, { recursive: true })
  writeFileSync(join(root, "package.json"), '{"name":"locus"}')
  return {
    appPath,
    binaryPath: join(
      platformBin,
      process.platform === "win32" ? "codex.exe" : "codex",
    ),
    root,
  }
}

describe("Codex bundled CLI path", () => {
  test("resolves dev CLI from repo root when Electron app path is out/main", () => {
    const repo = createRepoRoot()

    expect(
      getBundledCodexCliPath({
        isPackaged: false,
        getAppPath: () => repo.appPath,
      }),
    ).toBe(repo.binaryPath)
  })

  test("resolve uses packaged-aware missing hints", () => {
    const repo = createRepoRoot()
    writeFileSync(repo.binaryPath, "")
    chmodSync(repo.binaryPath, 0o755)

    expect(
      resolveBundledCodexCliPath({
        isPackaged: false,
        getAppPath: () => repo.appPath,
      }),
    ).toBe(repo.binaryPath)
    expect(
      getBundledCodexCliMissingHint({
        isPackaged: false,
        getAppPath: () => repo.appPath,
      }),
    ).toContain("bun run codex:download")
    expect(
      getBundledCodexCliMissingHint({
        isPackaged: true,
        getAppPath: () => repo.appPath,
      }),
    ).toContain("Reinstall the app")
  })
})
