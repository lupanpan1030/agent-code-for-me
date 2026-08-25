import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { randomBytes } from "node:crypto"
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let userDataDir = ""

mock.module("electron", () => ({
  app: {
    getPath(name: string) {
      if (name !== "userData") {
        throw new Error(`unexpected app path request: ${name}`)
      }
      return userDataDir
    },
    isPackaged: false,
  },
}))

const rawLogger = await import("../src/main/lib/claude/raw-logger")

async function expectFileRemoved(file: string): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try {
      await stat(file)
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  await expect(stat(file)).rejects.toThrow()
}

describe("Claude raw logger", () => {
  const previousRawLog = process.env.CLAUDE_RAW_LOG

  beforeEach(async () => {
    delete process.env.CLAUDE_RAW_LOG
    userDataDir = await mkdtemp(join(tmpdir(), "locus-raw-logger-"))
    rawLogger.setClaudeRawLoggerUserDataDirProviderForTest(() => userDataDir)
  })

  afterEach(async () => {
    if (previousRawLog === undefined) {
      delete process.env.CLAUDE_RAW_LOG
    } else {
      process.env.CLAUDE_RAW_LOG = previousRawLog
    }
    rawLogger.setClaudeRawLoggerUserDataDirProviderForTest(null)
    await rm(userDataDir, { force: true, recursive: true })
    userDataDir = ""
  })

  test("does not write raw logs unless explicitly enabled", async () => {
    await rawLogger.logRawClaudeMessage("session-1", { first: true })

    await expect(stat(join(userDataDir, "logs", "claude"))).rejects.toThrow()
  })

  test("recreates the logs directory before appending to a cached log file", async () => {
    process.env.CLAUDE_RAW_LOG = "1"

    await rawLogger.logRawClaudeMessage("session-1", { first: true })

    const logsDir = join(userDataDir, "logs", "claude")
    expect((await readdir(logsDir)).length).toBe(1)

    await rm(logsDir, { force: true, recursive: true })

    await rawLogger.logRawClaudeMessage("session-1", { second: true })

    const files = await readdir(logsDir)
    expect(files.length).toBe(1)
    expect(files[0]).toEndWith(".jsonl")
  })

  test("uses a safe filename segment for raw log session ids", async () => {
    process.env.CLAUDE_RAW_LOG = "1"

    await rawLogger.logRawClaudeMessage("../unsafe/session", { first: true })

    const logsDir = join(userDataDir, "logs", "claude")
    const files = await readdir(logsDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toEndWith(".jsonl")
    expect(files[0]).not.toContain("/")
    expect(files[0]).not.toContain("..")
  })

  test("redacts obvious secrets before writing raw SDK logs to disk", async () => {
    process.env.CLAUDE_RAW_LOG = "1"

    await rawLogger.logRawClaudeMessage("session-secrets", {
      authorization: "Bearer raw-authorization-token",
      headers: {
        apiKey: "sk-testsecretvalue1234567890",
        token: "plain-token-value",
      },
      text: "token=inline-secret-value Bearer inline.bearer.secret",
      usage: {
        input_tokens: 123,
      },
    })

    const logsDir = join(userDataDir, "logs", "claude")
    const files = await readdir(logsDir)
    expect(files).toHaveLength(1)

    const raw = await readFile(join(logsDir, files[0]), "utf8")
    expect(raw).not.toContain("raw-authorization-token")
    expect(raw).not.toContain("sk-testsecretvalue1234567890")
    expect(raw).not.toContain("plain-token-value")
    expect(raw).not.toContain("inline-secret-value")
    expect(raw).not.toContain("inline.bearer.secret")

    const entry = JSON.parse(raw.trim())
    expect(entry.data).toMatchObject({
      authorization: "<redacted>",
      headers: {
        apiKey: "<redacted>",
        token: "<redacted>",
      },
      text: "token=<redacted> <redacted>",
      usage: {
        input_tokens: 123,
      },
    })
    expect(entry.redaction.status).toBe("redacted")
    expect(entry.redaction.appliedRules).toEqual(
      expect.arrayContaining(["secret-key", "secret-text"]),
    )
  })

  test("omits credential-bound SDK diagnostic content before writing to disk", async () => {
    process.env.CLAUDE_RAW_LOG = "1"
    const gatewayToken = randomBytes(32).toString("hex")

    await rawLogger.logRawClaudeMessage(
      "session-exact-secret",
      { type: "assistant", text: `malicious raw echo ${gatewayToken}` },
      [gatewayToken],
    )

    const logsDir = join(userDataDir, "logs", "claude")
    const files = await readdir(logsDir)
    const raw = await readFile(join(logsDir, files[0]), "utf8")
    expect(raw).not.toContain(gatewayToken)
    expect(raw).toContain("credential-bound diagnostic content omitted")
    expect(JSON.parse(raw.trim()).redaction.appliedRules).toContain(
      "credential-bound-diagnostic-omitted",
    )
  })

  test("does not persist either half of a credential split across SDK messages", async () => {
    process.env.CLAUDE_RAW_LOG = "1"
    const gatewayToken = randomBytes(32).toString("hex")
    const firstHalf = gatewayToken.slice(0, gatewayToken.length / 2)
    const secondHalf = gatewayToken.slice(gatewayToken.length / 2)

    await rawLogger.logRawClaudeMessage(
      "session-split-secret",
      { type: "assistant", text: firstHalf },
      [gatewayToken],
    )
    await rawLogger.logRawClaudeMessage(
      "session-split-secret",
      { type: "assistant", text: secondHalf },
      [gatewayToken],
    )

    const logsDir = join(userDataDir, "logs", "claude")
    const files = await readdir(logsDir)
    const raw = await readFile(join(logsDir, files[0]), "utf8")
    expect(raw).not.toContain(firstHalf)
    expect(raw).not.toContain(secondHalf)
    expect(raw).not.toContain(gatewayToken)
  })

  test("cleans up stale logs when a new raw log session starts", async () => {
    process.env.CLAUDE_RAW_LOG = "1"

    const logsDir = join(userDataDir, "logs", "claude")
    await mkdir(logsDir, { recursive: true })
    const staleLog = join(logsDir, "old-session.jsonl")
    await writeFile(staleLog, "{}\n")
    const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await utimes(staleLog, staleDate, staleDate)

    await rawLogger.logRawClaudeMessage("session-cleanup", { first: true })

    await expectFileRemoved(staleLog)
  })
})
