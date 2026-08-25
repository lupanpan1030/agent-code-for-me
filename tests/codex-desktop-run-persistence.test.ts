import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { eq } from "drizzle-orm"
import {
  clearActiveCodexStreamsForTest,
  deleteActiveCodexStream,
  setActiveCodexStream,
} from "../src/main/lib/codex/active-streams"
import {
  buildCodexAppServerAssistantMessage,
  buildCodexDesktopRunUserMessage,
  type CodexDesktopRunPersistenceDatabase,
  isDuplicateCodexDesktopRunPrompt,
  loadCodexDesktopRunHistory,
  persistCodexDesktopAssistantAfterNaturalFinish,
  persistCodexDesktopRunUserMessage,
} from "../src/main/lib/codex/desktop-run-persistence"
import { chats, projects, subChats } from "../src/main/lib/db/schema"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

function createPersistenceDb(): CodexDesktopRunPersistenceDatabase {
  const db = createAgentJobTestDb()
  db.insert(projects)
    .values({ id: "project-1", name: "Project", path: "/tmp/project" })
    .run()
  db.insert(chats)
    .values({ id: "chat-1", name: "Chat", projectId: "project-1" })
    .run()
  db.insert(subChats)
    .values({
      id: "sub-1",
      chatId: "chat-1",
      messages: "[]",
      mode: "agent",
    })
    .run()
  return db as unknown as CodexDesktopRunPersistenceDatabase
}

function readMessages(db: CodexDesktopRunPersistenceDatabase): unknown[] {
  const row = db.select().from(subChats).where(eq(subChats.id, "sub-1")).get()
  return JSON.parse(row?.messages ?? "[]")
}

function readUpdatedAt(
  db: CodexDesktopRunPersistenceDatabase,
): Date | null | undefined {
  return db.select().from(subChats).where(eq(subChats.id, "sub-1")).get()
    ?.updatedAt
}

describe("Codex desktop run persistence owner", () => {
  afterEach(() => {
    clearActiveCodexStreamsForTest()
  })

  test("loads history and preserves the user-message JSON shape", () => {
    const db = createPersistenceDb()
    const timestamps = [
      new Date("2026-08-26T01:02:03.000Z"),
      new Date("2026-08-26T01:02:04.000Z"),
    ]
    const existingMessages = loadCodexDesktopRunHistory({
      db,
      subChatId: "sub-1",
    })

    const result = persistCodexDesktopRunUserMessage({
      db,
      subChatId: "sub-1",
      existingMessages,
      prompt: "hello",
      images: undefined,
      longTextAttachments: undefined,
      metadataModel: "gpt-5.4",
      createId: () => "user-1",
      now: () => timestamps.shift() ?? new Date(0),
    })

    expect(result).toEqual({
      isDuplicatePrompt: false,
      messagesForStream: [
        {
          id: "user-1",
          role: "user",
          createdAt: "2026-08-26T01:02:03.000Z",
          parts: [{ type: "text", text: "hello" }],
          metadata: { model: "gpt-5.4", provider: "codex" },
        },
      ],
    })
    expect(readMessages(db)).toEqual(result.messagesForStream)
    expect(readUpdatedAt(db)).toEqual(new Date("2026-08-26T01:02:04.000Z"))
  })

  test("preserves prompt, long-text, and image signature comparison", () => {
    const db = createPersistenceDb()
    const first = persistCodexDesktopRunUserMessage({
      db,
      subChatId: "sub-1",
      existingMessages: [],
      prompt: "hello",
      images: undefined,
      longTextAttachments: [
        {
          attachmentId: "text-1",
          localRef: "attachment://text-1",
          filename: "note.txt",
          byteLength: 5,
          kind: "pasted",
        },
      ],
      metadataModel: "gpt-5.4",
      createId: () => "user-1",
    })

    const duplicate = persistCodexDesktopRunUserMessage({
      db,
      subChatId: "sub-1",
      existingMessages: first.messagesForStream,
      prompt: "hello",
      images: undefined,
      longTextAttachments: [
        {
          attachmentId: "text-1",
          localRef: "attachment://text-1",
          filename: "note.txt",
          byteLength: 5,
          kind: "pasted",
        },
      ],
      metadataModel: "gpt-5.4",
      createId: () => "must-not-be-used",
    })

    expect(duplicate.isDuplicatePrompt).toBe(true)
    expect(duplicate.messagesForStream).toEqual(first.messagesForStream)
    expect(readMessages(db)).toEqual(first.messagesForStream)
    expect(
      isDuplicateCodexDesktopRunPrompt(first.messagesForStream, {
        prompt: "hello",
        images: [{ base64Data: "encoded-image", mediaType: "image/png" }],
        longTextAttachments: [
          {
            attachmentId: "text-1",
            localRef: "attachment://text-1",
            filename: "note.txt",
            byteLength: 5,
            kind: "pasted",
          },
        ],
      }),
    ).toBe(false)

    const image = {
      attachmentId: "image-1",
      localRef: "cia:v1:sub-1/image-1.png",
      mediaType: "image/png",
      sizeBytes: 68,
    }
    const imageMessage = buildCodexDesktopRunUserMessage({
      prompt: "hello",
      images: [image],
      longTextAttachments: undefined,
      metadataModel: "gpt-5.4",
      createId: () => "image-user",
      now: () => new Date("2026-08-26T01:02:05.000Z"),
    })

    // Preserve the baseline JSON-string signature behavior verbatim: even the
    // same staged image currently makes the prompt non-duplicate.
    expect(
      isDuplicateCodexDesktopRunPrompt([imageMessage], {
        prompt: "hello",
        images: [image],
        longTextAttachments: undefined,
      }),
    ).toBe(false)
    expect(
      isDuplicateCodexDesktopRunPrompt([imageMessage], {
        prompt: "hello",
        images: [{ ...image, localRef: "cia:v1:sub-1/image-2.png" }],
        longTextAttachments: undefined,
      }),
    ).toBe(false)
  })

  test("builds assistant JSON with the established metadata precedence", () => {
    expect(
      buildCodexAppServerAssistantMessage({
        chunks: [
          { type: "text-delta", delta: "Hello " },
          {
            type: "message-metadata",
            messageMetadata: { sessionId: "session-1", model: "stale" },
          },
          { type: "text-delta", delta: "world" },
          {
            type: "finish",
            messageMetadata: { usage: { inputTokens: 3 }, model: "finish" },
          },
        ],
        model: "gpt-5.4",
        generateMessageId: () => "assistant-1",
        now: () => new Date("2026-08-26T02:03:04.000Z"),
      }),
    ).toEqual({
      id: "assistant-1",
      role: "assistant",
      createdAt: "2026-08-26T02:03:04.000Z",
      parts: [{ type: "text", text: "Hello world" }],
      metadata: {
        sessionId: "session-1",
        usage: { inputTokens: 3 },
        model: "gpt-5.4",
        provider: "codex",
      },
    })
  })

  test("persists an assistant only when the run remains authoritative", () => {
    const db = createPersistenceDb()
    const controller = new AbortController()
    setActiveCodexStream("sub-1", {
      runId: "run-new",
      controller,
      cancelRequested: false,
    })

    expect(
      persistCodexDesktopAssistantAfterNaturalFinish({
        db,
        subChatId: "sub-1",
        runId: "run-old",
        messagesForStream: [],
        chunks: [{ type: "text-delta", delta: "stale" }],
        model: "gpt-5.4",
      }),
    ).toBe(false)
    expect(readMessages(db)).toEqual([])

    expect(
      persistCodexDesktopAssistantAfterNaturalFinish({
        db,
        subChatId: "sub-1",
        runId: "run-new",
        messagesForStream: [],
        chunks: [{ type: "text-delta", delta: "current" }],
        model: "gpt-5.4",
        createId: () => "assistant-1",
        now: () => new Date("2026-08-26T03:04:05.000Z"),
      }),
    ).toBe(true)
    expect(readMessages(db)).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: "2026-08-26T03:04:05.000Z",
        parts: [{ type: "text", text: "current" }],
        metadata: { model: "gpt-5.4", provider: "codex" },
      },
    ])

    deleteActiveCodexStream("sub-1")
    const timestamps = [
      new Date("2026-08-26T03:04:06.000Z"),
      new Date("2026-08-26T03:04:07.000Z"),
    ]
    expect(
      persistCodexDesktopAssistantAfterNaturalFinish({
        db,
        subChatId: "sub-1",
        runId: "run-without-registered-stream",
        messagesForStream: [],
        chunks: [{ type: "text-delta", delta: "no stream is allowed" }],
        model: "gpt-5.4",
        createId: () => "assistant-2",
        now: () => timestamps.shift() ?? new Date(0),
      }),
    ).toBe(true)
    expect(readMessages(db)).toEqual([
      {
        id: "assistant-2",
        role: "assistant",
        createdAt: "2026-08-26T03:04:06.000Z",
        parts: [{ type: "text", text: "no stream is allowed" }],
        metadata: { model: "gpt-5.4", provider: "codex" },
      },
    ])
    expect(readUpdatedAt(db)).toEqual(new Date("2026-08-26T03:04:07.000Z"))
  })

  test("keeps the second history read and resume snapshot at their original route positions", () => {
    const route = readFileSync("src/main/lib/trpc/routers/codex.ts", "utf8")
    const runtimeGateIndex = route.indexOf("await verifyRuntimeStatus()")
    const historyReadIndex = route.indexOf("loadCodexDesktopRunHistory({")
    const imagePreparationIndex = route.indexOf(
      "prepareChatImageAttachmentsForDesktopRun({",
      historyReadIndex,
    )
    const providerBindingIndex = route.indexOf(
      "await providerBindingStage.resolve({",
      imagePreparationIndex,
    )
    const userPersistenceIndex = route.indexOf(
      "persistCodexDesktopRunUserMessage({",
      providerBindingIndex,
    )

    expect(runtimeGateIndex).toBeGreaterThan(0)
    expect(historyReadIndex).toBeGreaterThan(runtimeGateIndex)
    expect(imagePreparationIndex).toBeGreaterThan(historyReadIndex)
    expect(providerBindingIndex).toBeGreaterThan(imagePreparationIndex)
    expect(userPersistenceIndex).toBeGreaterThan(providerBindingIndex)
    expect(route).toContain("getLastCodexSessionId(existingMessages)")
    expect(route).not.toContain("getLastCodexSessionId(messagesForStream)")
  })
})
