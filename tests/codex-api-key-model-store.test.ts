import { afterEach, describe, expect, test } from "bun:test"
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  getStoredCodexApiKeyModelIds,
  updateStoredCodexApiKeyModelIds,
} from "../src/main/lib/codex/api-key-store"

const tempDirs: string[] = []

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

describe("Codex API-key model snapshot store", () => {
  test("persists a bounded safe snapshot without touching the encrypted key", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "locus-codex-models-"))
    tempDirs.push(userDataPath)
    const storePath = join(userDataPath, "codex-api-key.json")
    writeFileSync(
      storePath,
      JSON.stringify({
        version: 1,
        encryptedApiKey: "encrypted-test-value",
        updatedAt: "2026-07-23T00:00:00.000Z",
      }),
    )

    expect(
      updateStoredCodexApiKeyModelIds(
        ["gpt-live", "gpt-unsafe;drop", "text-embedding-3-large"],
        { userDataPath },
      ),
    ).toEqual(["gpt-live"])
    expect(getStoredCodexApiKeyModelIds({ userDataPath })).toEqual(["gpt-live"])

    const persisted = JSON.parse(readFileSync(storePath, "utf-8")) as {
      encryptedApiKey: string
      updatedAt: string
    }
    expect(persisted.encryptedApiKey).toBe("encrypted-test-value")
    expect(persisted.updatedAt).toBe("2026-07-23T00:00:00.000Z")
    expect(readdirSync(userDataPath)).toEqual(["codex-api-key.json"])
  })

  test("sanitizes a tampered persisted snapshot on read", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "locus-codex-models-"))
    tempDirs.push(userDataPath)
    writeFileSync(
      join(userDataPath, "codex-api-key.json"),
      JSON.stringify({
        version: 1,
        encryptedApiKey: "encrypted-test-value",
        updatedAt: "2026-07-23T00:00:00.000Z",
        modelIds: ["gpt-safe", "gpt-bad\nvalue", "not-codex"],
      }),
    )

    expect(getStoredCodexApiKeyModelIds({ userDataPath })).toEqual(["gpt-safe"])
  })
})
