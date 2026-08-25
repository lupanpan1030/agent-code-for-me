import { describe, expect, test } from "bun:test"
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  assertCodexAppServerShellSnapshotsScrubbed,
  CodexAppServerShellSnapshotScrubError,
  resolveCodexAppServerShellSnapshotsDir,
  scrubCodexAppServerShellSnapshots,
} from "../src/main/lib/codex/app-server-shell-snapshots"
import { EXACT_SECRET_REDACTION_MARKER } from "../src/shared/secret-redaction-policy"

describe("Codex app-server shell snapshot secret scrubber", () => {
  test("scrubs shell snapshots under explicit CODEX_HOME without deleting unrelated content", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "locus-codex-home-"))
    try {
      const snapshotDir = join(codexHome, "shell_snapshots")
      mkdirSync(snapshotDir, { recursive: true })
      const snapshot = join(snapshotDir, "snapshot.sh")
      writeFileSync(
        snapshot,
        [
          "export FOO=bar",
          "export LOCUS_CODEX_PROVIDER_GATEWAY_TOKEN=selected-token",
          "printf selected-token",
        ].join("\n"),
      )
      const unrelated = join(snapshotDir, "unrelated.sh")
      writeFileSync(unrelated, "export FOO=bar\n")

      const result = scrubCodexAppServerShellSnapshots({
        runtimeEnv: {
          CODEX_HOME: codexHome,
          LOCUS_CODEX_PROVIDER_GATEWAY_TOKEN: "selected-token",
        },
      })

      expect(result.snapshotDir).toBe(snapshotDir)
      expect(result.scannedFiles).toBe(2)
      expect(result.scrubbedFiles).toBe(1)
      expect(result.removedEnvLines).toBe(1)
      expect(result.redactedValueOccurrences).toBe(2)
      expect(result.skippedFiles).toBe(0)
      expect(result.errors).toBe(0)
      expect(() =>
        assertCodexAppServerShellSnapshotsScrubbed(result, "pre-start"),
      ).not.toThrow()
      expect(readFileSync(snapshot, "utf8")).not.toContain(
        "LOCUS_CODEX_PROVIDER_GATEWAY_TOKEN",
      )
      expect(readFileSync(snapshot, "utf8")).not.toContain("selected-token")
      expect(readFileSync(unrelated, "utf8")).toBe("export FOO=bar\n")
    } finally {
      rmSync(codexHome, { recursive: true, force: true })
    }
  })

  test("streams oversized regular snapshots and fails closed on non-regular entries", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "locus-codex-unverified-"))
    try {
      const snapshotDir = join(codexHome, "shell_snapshots")
      mkdirSync(snapshotDir, { recursive: true })
      const secret = "oversized-selected-token"
      const oversized = join(snapshotDir, "oversized.sh")
      writeFileSync(oversized, `${secret}\n${"x".repeat(5 * 1024 * 1024 + 1)}`)
      const outsideTarget = join(codexHome, "outside.sh")
      writeFileSync(outsideTarget, `printf ${secret}\n`)
      symlinkSync(outsideTarget, join(snapshotDir, "linked.sh"))
      linkSync(outsideTarget, join(snapshotDir, "hard-linked.sh"))
      const nestedDir = join(snapshotDir, "nested")
      mkdirSync(nestedDir)
      writeFileSync(join(nestedDir, "nested.sh"), `printf ${secret}\n`)

      const result = scrubCodexAppServerShellSnapshots({
        runtimeEnv: {
          CODEX_HOME: codexHome,
          LOCUS_CODEX_PROVIDER_GATEWAY_TOKEN: secret,
        },
      })

      expect(result.scannedFiles).toBe(1)
      expect(result.scrubbedFiles).toBe(1)
      expect(result.redactedValueOccurrences).toBe(1)
      expect(result.skippedFiles).toBe(3)
      expect(result.errors).toBe(0)
      expect(() =>
        assertCodexAppServerShellSnapshotsScrubbed(result, "pre-start"),
      ).toThrow("0 filesystem error(s), 3 unverified snapshot entry/entries")
      expect(readFileSync(oversized, "utf8")).not.toContain(secret)
      expect(readFileSync(oversized, "utf8")).toContain(
        EXACT_SECRET_REDACTION_MARKER,
      )
      expect(readFileSync(join(snapshotDir, "linked.sh"), "utf8")).toContain(
        secret,
      )
      expect(readFileSync(join(nestedDir, "nested.sh"), "utf8")).toContain(
        secret,
      )
      expect(readFileSync(outsideTarget, "utf8")).toContain(secret)
    } finally {
      rmSync(codexHome, { recursive: true, force: true })
    }
  })

  test("redacts exact values and env names split across streaming chunk boundaries", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "locus-codex-boundary-"))
    try {
      const snapshotDir = join(codexHome, "shell_snapshots")
      mkdirSync(snapshotDir, { recursive: true })
      const secret = "boundary-selected-token"
      const exactSnapshot = join(snapshotDir, "exact-boundary.sh")
      writeFileSync(
        exactSnapshot,
        `${"x".repeat(64 * 1024 - 4)}${secret}\nexport SAFE_EXACT=1\n`,
      )
      const envSnapshot = join(snapshotDir, "env-boundary.sh")
      writeFileSync(
        envSnapshot,
        `${"y".repeat(64 * 1024 - 5)} CODEX_API_KEY=${secret}\nexport SAFE_ENV=1\n`,
      )

      const result = scrubCodexAppServerShellSnapshots({
        runtimeEnv: {
          CODEX_HOME: codexHome,
          CODEX_API_KEY: secret,
        },
      })

      expect(result.scannedFiles).toBe(2)
      expect(result.scrubbedFiles).toBe(2)
      expect(result.removedEnvLines).toBe(1)
      expect(result.redactedValueOccurrences).toBe(2)
      expect(result.skippedFiles).toBe(0)
      expect(result.errors).toBe(0)
      expect(() =>
        assertCodexAppServerShellSnapshotsScrubbed(result, "post-run"),
      ).not.toThrow()
      const exact = readFileSync(exactSnapshot, "utf8")
      const env = readFileSync(envSnapshot, "utf8")
      expect(exact).not.toContain(secret)
      expect(exact).toContain(EXACT_SECRET_REDACTION_MARKER)
      expect(exact).toContain("export SAFE_EXACT=1")
      expect(env).not.toContain(secret)
      expect(env).not.toContain("CODEX_API_KEY")
      expect(env).toBe("export SAFE_ENV=1\n")
    } finally {
      rmSync(codexHome, { recursive: true, force: true })
    }
  })

  test("does not inspect or block unverified entries when there are no secrets", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "locus-codex-no-secrets-"))
    try {
      const snapshotDir = join(codexHome, "shell_snapshots")
      mkdirSync(join(snapshotDir, "nested"), { recursive: true })
      const result = scrubCodexAppServerShellSnapshots({
        runtimeEnv: { CODEX_HOME: codexHome },
        secrets: [],
      })

      expect(result.skippedFiles).toBe(0)
      expect(result.errors).toBe(0)
      expect(() =>
        assertCodexAppServerShellSnapshotsScrubbed(result, "pre-start"),
      ).not.toThrow()
    } finally {
      rmSync(codexHome, { recursive: true, force: true })
    }
  })

  test("uses HOME/.codex when CODEX_HOME is not present", () => {
    const home = mkdtempSync(join(tmpdir(), "locus-codex-home-default-"))
    try {
      const snapshotDir = join(home, ".codex", "shell_snapshots")
      mkdirSync(snapshotDir, { recursive: true })
      const snapshot = join(snapshotDir, "snapshot.sh")
      writeFileSync(snapshot, "export CODEX_API_KEY=sk-selected\n")

      expect(resolveCodexAppServerShellSnapshotsDir({ HOME: home })).toBe(
        snapshotDir,
      )

      const result = scrubCodexAppServerShellSnapshots({
        runtimeEnv: {
          HOME: home,
          CODEX_API_KEY: "sk-selected",
        },
      })

      expect(result.scrubbedFiles).toBe(1)
      expect(readFileSync(snapshot, "utf8")).not.toContain("CODEX_API_KEY")
      expect(readFileSync(snapshot, "utf8")).not.toContain("sk-selected")
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("rejects a symlinked CODEX_HOME without changing its target", () => {
    const root = mkdtempSync(join(tmpdir(), "locus-codex-home-link-"))
    try {
      const codexHomeTarget = join(root, "real-codex-home")
      const snapshotDir = join(codexHomeTarget, "shell_snapshots")
      mkdirSync(snapshotDir, { recursive: true })
      const secret = "linked-codex-home-secret"
      const snapshot = join(snapshotDir, "snapshot.sh")
      writeFileSync(snapshot, `printf ${secret}\n`)
      const linkedCodexHome = join(root, "linked-codex-home")
      symlinkSync(codexHomeTarget, linkedCodexHome, "dir")

      const result = scrubCodexAppServerShellSnapshots({
        runtimeEnv: {
          CODEX_HOME: linkedCodexHome,
          CODEX_API_KEY: secret,
        },
      })

      expect(result.errors).toBe(1)
      expect(result.scannedFiles).toBe(0)
      expect(result.diagnostics.join("\n")).toContain(
        "CODEX_HOME must be a real directory",
      )
      expect(readFileSync(snapshot, "utf8")).toContain(secret)
      expect(() =>
        assertCodexAppServerShellSnapshotsScrubbed(result, "pre-start"),
      ).toThrow(CodexAppServerShellSnapshotScrubError)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("rejects a symlinked HOME/.codex intermediate directory", () => {
    const home = mkdtempSync(join(tmpdir(), "locus-codex-middle-link-"))
    try {
      const realCodexDir = join(home, "real-codex")
      const snapshotDir = join(realCodexDir, "shell_snapshots")
      mkdirSync(snapshotDir, { recursive: true })
      const secret = "linked-middle-directory-secret"
      const snapshot = join(snapshotDir, "snapshot.sh")
      writeFileSync(snapshot, `printf ${secret}\n`)
      symlinkSync(realCodexDir, join(home, ".codex"), "dir")

      const result = scrubCodexAppServerShellSnapshots({
        runtimeEnv: { HOME: home, CODEX_API_KEY: secret },
      })

      expect(result.errors).toBe(1)
      expect(result.scannedFiles).toBe(0)
      expect(readFileSync(snapshot, "utf8")).toContain(secret)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("rejects a symlinked shell_snapshots directory", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "locus-snapshot-dir-link-"))
    try {
      const outsideSnapshotDir = join(codexHome, "outside-snapshots")
      mkdirSync(outsideSnapshotDir)
      const secret = "linked-snapshot-directory-secret"
      const snapshot = join(outsideSnapshotDir, "snapshot.sh")
      writeFileSync(snapshot, `printf ${secret}\n`)
      symlinkSync(outsideSnapshotDir, join(codexHome, "shell_snapshots"), "dir")

      const result = scrubCodexAppServerShellSnapshots({
        runtimeEnv: { CODEX_HOME: codexHome, CODEX_API_KEY: secret },
      })

      expect(result.errors).toBe(1)
      expect(result.scannedFiles).toBe(0)
      expect(readFileSync(snapshot, "utf8")).toContain(secret)
    } finally {
      rmSync(codexHome, { recursive: true, force: true })
    }
  })

  test("treats a broken shell_snapshots symlink as an error", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "locus-broken-snapshot-link-"))
    try {
      symlinkSync(
        join(codexHome, "missing-snapshots"),
        join(codexHome, "shell_snapshots"),
        "dir",
      )

      const result = scrubCodexAppServerShellSnapshots({
        runtimeEnv: {
          CODEX_HOME: codexHome,
          CODEX_API_KEY: "broken-snapshot-link-secret",
        },
      })

      expect(result.errors).toBe(1)
      expect(() =>
        assertCodexAppServerShellSnapshotsScrubbed(result, "pre-start"),
      ).toThrow(CodexAppServerShellSnapshotScrubError)
    } finally {
      rmSync(codexHome, { recursive: true, force: true })
    }
  })

  test("anchors replacement to the open snapshot directory and fails closed on a check-to-rename swap", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "locus-snapshot-race-swap-"))
    try {
      const snapshotDir = join(codexHome, "shell_snapshots")
      mkdirSync(snapshotDir)
      const secret = "snapshot-race-secret"
      const snapshotName = "snapshot.sh"
      writeFileSync(join(snapshotDir, snapshotName), `printf ${secret}\n`)
      const movedSnapshotDir = `${snapshotDir}.moved`
      let swapped = false

      const result = scrubCodexAppServerShellSnapshots({
        runtimeEnv: { CODEX_HOME: codexHome, CODEX_API_KEY: secret },
        filesystemHooks: {
          beforeAtomicRename({ entryName }) {
            if (swapped || entryName !== snapshotName) return
            swapped = true
            renameSync(snapshotDir, movedSnapshotDir)
            mkdirSync(snapshotDir)
            writeFileSync(
              join(snapshotDir, snapshotName),
              "replacement-must-stay-unchanged\n",
            )
          },
        },
      })

      expect(swapped).toBe(true)
      expect(result.scrubbedFiles).toBe(0)
      expect(result.errors).toBeGreaterThanOrEqual(1)
      expect(result.diagnostics.join("\n")).toContain(
        "directory path identity changed",
      )
      expect(readFileSync(join(snapshotDir, snapshotName), "utf8")).toBe(
        "replacement-must-stay-unchanged\n",
      )
      const anchoredSnapshot = readFileSync(
        join(movedSnapshotDir, snapshotName),
        "utf8",
      )
      expect(anchoredSnapshot).not.toContain(secret)
      expect(anchoredSnapshot).toContain(EXACT_SECRET_REDACTION_MARKER)
      expect(
        readdirSync(movedSnapshotDir).filter((entry) =>
          entry.includes(".locus-scrub-"),
        ),
      ).toEqual([])
    } finally {
      rmSync(codexHome, { recursive: true, force: true })
    }
  })

  test("detects a hardlinked scrub result after anchored replacement", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "locus-snapshot-temp-link-"))
    try {
      const snapshotDir = join(codexHome, "shell_snapshots")
      mkdirSync(snapshotDir)
      const secret = "snapshot-temp-hardlink-secret"
      const snapshotName = "snapshot.sh"
      const snapshotPath = join(snapshotDir, snapshotName)
      const capturedTemp = join(codexHome, "captured-scrub-temp.sh")
      writeFileSync(snapshotPath, `printf ${secret}\n`)

      const result = scrubCodexAppServerShellSnapshots({
        runtimeEnv: { CODEX_HOME: codexHome, CODEX_API_KEY: secret },
        filesystemHooks: {
          beforeAtomicRename({ entryName, snapshotDirPath }) {
            if (entryName !== snapshotName) return
            const tempName = readdirSync(snapshotDirPath).find((entry) =>
              entry.startsWith(`.${snapshotName}.locus-scrub-`),
            )
            if (!tempName) throw new Error("Expected scrub temp file")
            linkSync(join(snapshotDirPath, tempName), capturedTemp)
          },
        },
      })

      expect(result.scrubbedFiles).toBe(0)
      expect(result.errors).toBeGreaterThanOrEqual(1)
      expect(readFileSync(snapshotPath, "utf8")).not.toContain(secret)
      expect(readFileSync(capturedTemp, "utf8")).not.toContain(secret)
    } finally {
      rmSync(codexHome, { recursive: true, force: true })
    }
  })

  test("treats scrub errors as fail-closed", () => {
    const result = {
      snapshotDir: "/tmp/missing",
      scannedFiles: 0,
      scrubbedFiles: 0,
      removedEnvLines: 0,
      redactedValueOccurrences: 0,
      skippedFiles: 0,
      errors: 1,
      diagnostics: ["test filesystem error"],
    }

    expect(() =>
      assertCodexAppServerShellSnapshotsScrubbed(result, "pre-start"),
    ).toThrow(CodexAppServerShellSnapshotScrubError)
  })
})
