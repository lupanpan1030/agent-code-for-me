import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { tmpdir } from "node:os"
import * as schema from "../src/main/lib/db/schema"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

let testDb = createAgentJobTestDb()

mock.module("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => tmpdir(),
  },
  BrowserWindow: class BrowserWindow {},
  clipboard: {},
  dialog: {},
  ipcMain: {},
  net: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`, "utf8"),
    decryptString: (value: Buffer) =>
      value.toString("utf8").replace(/^sealed:/, ""),
  },
  shell: {},
}))

mock.module("../src/main/lib/db", () => ({
  ...schema,
  getDatabase: () => testDb,
}))

const {
  clearActiveCodexStreamsForTest,
  getActiveCodexStream,
  setActiveCodexStream,
} = await import("../src/main/lib/codex/active-streams")
const {
  clearClaudeActiveSessionsForTest,
  getActiveClaudeSession,
  setActiveClaudeSession,
} = await import("../src/main/lib/claude/active-sessions")
const { clearDesktopRunAdmissionsForTest } = await import(
  "../src/main/lib/agent-runtime/desktop-run-admission-generation"
)
const { codexRouter } = await import("../src/main/lib/trpc/routers/codex")
const { claudeRouter } = await import("../src/main/lib/trpc/routers/claude")

function seedBoundSubChat(input: {
  chatId: string
  subChatId: string
  runtime: "codex" | "claude-code"
  projectPath?: string
}): void {
  if (input.projectPath) {
    testDb
      .insert(schema.projects)
      .values({
        id: `project-${input.chatId}`,
        name: `Project ${input.chatId}`,
        path: input.projectPath,
      })
      .run()
  }
  testDb
    .insert(schema.chats)
    .values({
      id: input.chatId,
      projectId: input.projectPath ? `project-${input.chatId}` : null,
      worktreePath: input.projectPath ?? null,
    })
    .run()
  testDb
    .insert(schema.subChats)
    .values({ id: input.subChatId, chatId: input.chatId })
    .run()
  testDb
    .insert(schema.subChatBindings)
    .values({
      id: `binding-${input.subChatId}`,
      subChatId: input.subChatId,
      runtime: input.runtime,
      modelId:
        input.runtime === "codex" ? "gpt-5.5" : "claude-sonnet-4-20250514",
      modelSource: input.runtime === "codex" ? "chatgpt" : "claude-oauth",
      thinkingLevel: input.runtime === "codex" ? "high" : null,
    })
    .run()
}

async function collectSubscription<T>(
  stream:
    | {
        subscribe(observer: {
          next(value: T): void
          error?(error: unknown): void
          complete(): void
        }): { unsubscribe(): void }
      }
    | Promise<{
        subscribe(observer: {
          next(value: T): void
          error?(error: unknown): void
          complete(): void
        }): { unsubscribe(): void }
      }>,
): Promise<T[]> {
  const resolvedStream = await stream
  return new Promise<T[]>((resolve, reject) => {
    const chunks: T[] = []
    resolvedStream.subscribe({
      next: (chunk) => chunks.push(chunk),
      error: reject,
      complete: () => resolve(chunks),
    })
  })
}

function rejectedScopeContract(input: {
  chatId: string
  subChatId: string
  runId: string
  cwd: string
}) {
  return {
    id: `contract-${input.runId}`,
    version: 1 as const,
    status: "draft" as const,
    createdAt: "2026-08-26T00:00:00.000Z",
    source: "manual" as const,
    chatId: input.chatId,
    subChatId: input.subChatId,
    runId: input.runId,
    cwd: input.cwd,
    projectPath: input.cwd,
    editableScope: [{ path: "src", kind: "directory" as const }],
    readOnlyEvidence: [],
    successChecks: [],
    blockedPaths: [],
    expansions: [],
  }
}

beforeEach(() => {
  testDb = createAgentJobTestDb()
  clearActiveCodexStreamsForTest()
  clearClaudeActiveSessionsForTest()
  clearDesktopRunAdmissionsForTest()
})

afterEach(() => {
  clearActiveCodexStreamsForTest()
  clearClaudeActiveSessionsForTest()
  clearDesktopRunAdmissionsForTest()
})

describe("desktop Run binding admission ordering", () => {
  test("rejects a wrong-runtime Codex request before touching the active stream", async () => {
    seedBoundSubChat({
      chatId: "chat-claude",
      subChatId: "sub-claude",
      runtime: "claude-code",
    })
    const sentinelController = new AbortController()
    const sentinel = {
      runId: "sentinel-codex-run",
      controller: sentinelController,
      cancelRequested: false,
    }
    setActiveCodexStream("sub-claude", sentinel)

    const emitted = await collectSubscription(
      codexRouter.createCaller({ getWindow: () => null }).chat({
        chatId: "chat-claude",
        subChatId: "sub-claude",
        runId: "forged-codex-run",
        prompt: "must not replace the active stream",
        mode: "agent",
        model: "gpt-5.5/high",
        codexAuthMethod: "chatgpt",
      }),
    )

    expect(emitted.map((chunk) => chunk.type)).toEqual(["error", "finish"])
    expect(getActiveCodexStream("sub-claude")).toBe(sentinel)
    expect(sentinelController.signal.aborted).toBe(false)
    expect(sentinel.cancelRequested).toBe(false)
  })

  test("rejects a wrong-runtime Claude request before touching the active session", async () => {
    seedBoundSubChat({
      chatId: "chat-codex",
      subChatId: "sub-codex",
      runtime: "codex",
    })
    const sentinelController = new AbortController()
    const sentinel = {
      runId: "sentinel-claude-run",
      controller: sentinelController,
    }
    setActiveClaudeSession("sub-codex", sentinel)

    const emitted = await collectSubscription(
      claudeRouter.createCaller({ getWindow: () => null }).chat({
        chatId: "chat-codex",
        subChatId: "sub-codex",
        runId: "forged-claude-run",
        prompt: "must not replace the active session",
        mode: "agent",
        model: "claude-sonnet-4-20250514",
        modelSource: "claude-oauth",
      }),
    )

    expect(emitted.map((chunk) => chunk.type)).toEqual(["error", "finish"])
    expect(getActiveClaudeSession("sub-codex")).toBe(sentinel)
    expect(sentinelController.signal.aborted).toBe(false)
  })

  test("keeps a Codex sentinel when the binding is correct but cwd preflight fails", async () => {
    seedBoundSubChat({
      chatId: "chat-codex-cwd",
      subChatId: "sub-codex-cwd",
      runtime: "codex",
      projectPath: "/repo/codex-cwd",
    })
    const sentinelController = new AbortController()
    const sentinel = {
      runId: "same-codex-run",
      controller: sentinelController,
      cancelRequested: false,
    }
    setActiveCodexStream("sub-codex-cwd", sentinel)

    const emitted = await collectSubscription(
      codexRouter.createCaller({ getWindow: () => null }).chat({
        chatId: "chat-codex-cwd",
        subChatId: "sub-codex-cwd",
        runId: sentinel.runId,
        prompt: "must fail before replacement",
        cwd: "/repo/forged-cwd",
        mode: "agent",
        model: "gpt-5.5/high",
        codexAuthMethod: "chatgpt",
      }),
    )

    expect(emitted.map((chunk) => chunk.type)).toEqual(["error", "finish"])
    expect(getActiveCodexStream("sub-codex-cwd")).toBe(sentinel)
    expect(sentinelController.signal.aborted).toBe(false)
    expect(sentinel.cancelRequested).toBe(false)
  })

  test("keeps a Claude sentinel when the binding is correct but cwd preflight fails", async () => {
    seedBoundSubChat({
      chatId: "chat-claude-cwd",
      subChatId: "sub-claude-cwd",
      runtime: "claude-code",
      projectPath: "/repo/claude-cwd",
    })
    const sentinelController = new AbortController()
    const sentinel = {
      runId: "same-claude-run",
      controller: sentinelController,
    }
    setActiveClaudeSession("sub-claude-cwd", sentinel)

    const emitted = await collectSubscription(
      claudeRouter.createCaller({ getWindow: () => null }).chat({
        chatId: "chat-claude-cwd",
        subChatId: "sub-claude-cwd",
        runId: sentinel.runId,
        prompt: "must fail before replacement",
        cwd: "/repo/forged-cwd",
        mode: "agent",
        model: "claude-sonnet-4-20250514",
        modelSource: "claude-oauth",
      }),
    )

    expect(emitted.map((chunk) => chunk.type)).toEqual(["error", "finish"])
    expect(getActiveClaudeSession("sub-claude-cwd")).toBe(sentinel)
    expect(sentinelController.signal.aborted).toBe(false)
  })

  test("keeps a Codex sentinel when an admitted request has a rejected scope", async () => {
    const cwd = "/repo/codex-scope"
    seedBoundSubChat({
      chatId: "chat-codex-scope",
      subChatId: "sub-codex-scope",
      runtime: "codex",
      projectPath: cwd,
    })
    const sentinelController = new AbortController()
    const sentinel = {
      runId: "same-codex-scope-run",
      controller: sentinelController,
      cancelRequested: false,
    }
    setActiveCodexStream("sub-codex-scope", sentinel)

    const emitted = await collectSubscription(
      codexRouter.createCaller({ getWindow: () => null }).chat({
        chatId: "chat-codex-scope",
        subChatId: "sub-codex-scope",
        runId: sentinel.runId,
        prompt: "must reject draft scope",
        cwd,
        projectPath: cwd,
        mode: "agent",
        model: "gpt-5.5/high",
        codexAuthMethod: "chatgpt",
        scopeContract: rejectedScopeContract({
          chatId: "chat-codex-scope",
          subChatId: "sub-codex-scope",
          runId: sentinel.runId,
          cwd,
        }),
      }),
    )

    expect(emitted.map((chunk) => chunk.type)).toEqual(["error", "finish"])
    expect(getActiveCodexStream("sub-codex-scope")).toBe(sentinel)
    expect(sentinelController.signal.aborted).toBe(false)
    expect(sentinel.cancelRequested).toBe(false)
  })

  test("keeps a Claude sentinel when an admitted request has a rejected scope", async () => {
    const cwd = "/repo/claude-scope"
    seedBoundSubChat({
      chatId: "chat-claude-scope",
      subChatId: "sub-claude-scope",
      runtime: "claude-code",
      projectPath: cwd,
    })
    const sentinelController = new AbortController()
    const sentinel = {
      runId: "same-claude-scope-run",
      controller: sentinelController,
    }
    setActiveClaudeSession("sub-claude-scope", sentinel)

    const emitted = await collectSubscription(
      claudeRouter.createCaller({ getWindow: () => null }).chat({
        chatId: "chat-claude-scope",
        subChatId: "sub-claude-scope",
        runId: sentinel.runId,
        prompt: "must reject draft scope",
        cwd,
        projectPath: cwd,
        mode: "agent",
        model: "claude-sonnet-4-20250514",
        modelSource: "claude-oauth",
        scopeContract: rejectedScopeContract({
          chatId: "chat-claude-scope",
          subChatId: "sub-claude-scope",
          runId: sentinel.runId,
          cwd,
        }),
      }),
    )

    expect(emitted.map((chunk) => chunk.type)).toEqual(["error", "finish"])
    expect(getActiveClaudeSession("sub-claude-scope")).toBe(sentinel)
    expect(sentinelController.signal.aborted).toBe(false)
  })
})
