import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { eq } from "drizzle-orm"
import { createCanonicalRunEventLedger } from "../src/main/lib/agent-runtime/run-event-ledger"
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

const CODEX_TUPLE = {
  kind: "runtime",
  installationId: "inst-codex-0.139.0-persistence-test",
  runtimeId: "codex",
  adapterSource: "codex-app-server",
  version: "0.139.0",
  executableRef: "exe-persistence-test",
  binarySha256: "a".repeat(64),
  protocolName: "codex-app-server-jsonrpc",
  protocolVersion: "v2",
  schemaFiles: [{ path: "ServerNotification.ts", sha256: "b".repeat(64) }],
} as const

/**
 * Committed records of one Codex desktop Run from the real ledger: an
 * assistant delta and two `thread/tokenUsage/updated` snapshots (the last
 * one carries the cache members and the model context window).
 */
async function committedCodexRunRecords() {
  const rows: Array<Record<string, unknown>> = []
  const ledger = createCanonicalRunEventLedger({
    runId: "run-metadata",
    runtimeId: "codex",
    provenance: CODEX_TUPLE,
    durableStore: {
      appendExact(input: { records: Array<Record<string, unknown>> }) {
        rows.push(...input.records)
        return input.records
      },
      read(_runId: string, after = 0) {
        return rows.filter((row) => Number(row.sequence) > after)
      },
    },
  })
  const notify = (observationKey: string, method: string, params: unknown) =>
    ledger.ingestNotification({
      observationKey,
      transportId: "t1",
      receivedAt: "2026-09-04T00:00:00.000Z",
      message: { method, params },
    })
  const vector = (total: number, cached: number) => ({
    totalTokens: total,
    inputTokens: total - 2,
    cachedInputTokens: cached,
    outputTokens: 2,
    reasoningOutputTokens: 1,
  })
  await notify("n-started", "turn/started", {
    threadId: "thread-7",
    turn: { id: "turn-3", status: "inProgress", error: null },
  })
  await notify("n-delta", "item/agentMessage/delta", {
    threadId: "thread-7",
    turnId: "turn-3",
    itemId: "msg-1",
    delta: "Hello world",
  })
  await notify("n-usage-1", "thread/tokenUsage/updated", {
    threadId: "thread-7",
    turnId: "turn-3",
    tokenUsage: {
      total: vector(10, 0),
      last: vector(10, 0),
      modelContextWindow: 200000,
    },
  })
  await notify("n-usage-2", "thread/tokenUsage/updated", {
    threadId: "thread-7",
    turnId: "turn-3",
    tokenUsage: {
      total: vector(30, 4),
      last: vector(20, 4),
      modelContextWindow: 258400,
    },
  })
  await ledger.whenIdle()
  return {
    records: rows,
    nativeContext: await ledger.readNativeContext(),
  }
}

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

function assistantRecord(sequence: number, text: string, itemId = "msg") {
  return {
    sequence,
    type: "assistant_delta",
    payload: {
      text,
      item: {
        threadId: "th",
        turnId: "tu",
        itemId,
        channel: "assistant",
        partIndex: 0,
      },
    },
  }
}

describe("Codex desktop run persistence owner", () => {
  afterEach(() => {
    clearActiveCodexStreamsForTest()
  })

  test("loads history and preserves the user-message JSON shape", () => {
    const db = createPersistenceDb()
    const activeStreamOwner = {
      runId: "run-1",
      controller: new AbortController(),
      cancelRequested: false,
    }
    setActiveCodexStream("sub-1", activeStreamOwner)
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
      activeStreamOwner,
      existingMessages,
      prompt: "hello",
      images: undefined,
      longTextAttachments: undefined,
      metadataModel: "gpt-5.4",
      createId: () => "user-1",
      now: () => timestamps.shift() ?? new Date(0),
    })

    expect(result).toEqual({
      authoritative: true,
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
    const activeStreamOwner = {
      runId: "run-1",
      controller: new AbortController(),
      cancelRequested: false,
    }
    setActiveCodexStream("sub-1", activeStreamOwner)
    const first = persistCodexDesktopRunUserMessage({
      db,
      subChatId: "sub-1",
      activeStreamOwner,
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
      activeStreamOwner,
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

    expect(first.authoritative).toBe(true)
    expect(duplicate.authoritative).toBe(true)
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

  test("rejects A user persistence after B replaces it with the same run id", () => {
    const db = createPersistenceDb()
    const ownerA = {
      runId: "run-shared",
      controller: new AbortController(),
      cancelRequested: false,
    }
    const ownerB = {
      runId: "run-shared",
      controller: new AbortController(),
      cancelRequested: false,
    }
    setActiveCodexStream("sub-1", ownerA)
    const existingMessages = loadCodexDesktopRunHistory({
      db,
      subChatId: "sub-1",
    })
    const initialUpdatedAt = readUpdatedAt(db)

    setActiveCodexStream("sub-1", ownerB)
    const staleResult = persistCodexDesktopRunUserMessage({
      db,
      subChatId: "sub-1",
      activeStreamOwner: ownerA,
      existingMessages,
      prompt: "stale A prompt",
      images: undefined,
      longTextAttachments: undefined,
      metadataModel: "gpt-5.4",
      createId: () => "stale-user",
      now: () => new Date("2026-08-26T04:05:06.000Z"),
    })

    expect(staleResult).toEqual({
      authoritative: false,
      isDuplicatePrompt: false,
      messagesForStream: existingMessages,
    })
    expect(readMessages(db)).toEqual([])
    expect(readUpdatedAt(db)).toEqual(initialUpdatedAt)

    deleteActiveCodexStream("sub-1")
    const missingResult = persistCodexDesktopRunUserMessage({
      db,
      subChatId: "sub-1",
      activeStreamOwner: ownerB,
      existingMessages,
      prompt: "missing owner prompt",
      images: undefined,
      longTextAttachments: undefined,
      metadataModel: "gpt-5.4",
    })
    expect(missingResult.authoritative).toBe(false)
    expect(readMessages(db)).toEqual([])
    expect(readUpdatedAt(db)).toEqual(initialUpdatedAt)
  })

  test("rejects user, duplicate, and assistant persistence after the exact owner aborts", () => {
    const db = createPersistenceDb()
    const activeStreamOwner = {
      runId: "run-aborted",
      controller: new AbortController(),
      cancelRequested: true,
    }
    setActiveCodexStream("sub-1", activeStreamOwner)
    activeStreamOwner.controller.abort()
    const initialUpdatedAt = readUpdatedAt(db)
    const duplicateMessage = buildCodexDesktopRunUserMessage({
      prompt: "duplicate",
      images: undefined,
      longTextAttachments: undefined,
      metadataModel: "gpt-5.4",
      createId: () => "existing-user",
      now: () => new Date("2026-08-26T04:05:06.000Z"),
    })

    expect(
      persistCodexDesktopRunUserMessage({
        db,
        subChatId: "sub-1",
        activeStreamOwner,
        existingMessages: [],
        prompt: "must not persist",
        images: undefined,
        longTextAttachments: undefined,
        metadataModel: "gpt-5.4",
      }),
    ).toEqual({
      authoritative: false,
      isDuplicatePrompt: false,
      messagesForStream: [],
    })
    expect(
      persistCodexDesktopRunUserMessage({
        db,
        subChatId: "sub-1",
        activeStreamOwner,
        existingMessages: [duplicateMessage],
        prompt: "duplicate",
        images: undefined,
        longTextAttachments: undefined,
        metadataModel: "gpt-5.4",
      }),
    ).toEqual({
      authoritative: false,
      isDuplicatePrompt: true,
      messagesForStream: [duplicateMessage],
    })
    expect(
      persistCodexDesktopAssistantAfterNaturalFinish({
        db,
        subChatId: "sub-1",
        activeStreamOwner,
        messagesForStream: [],
        records: [assistantRecord(1, "must not persist")],
        model: "gpt-5.4",
      }),
    ).toBe(false)
    expect(readMessages(db)).toEqual([])
    expect(readUpdatedAt(db)).toEqual(initialUpdatedAt)
  })

  test("builds assistant JSON with the established metadata precedence", async () => {
    // History is built from the committed records (refactor-canonical-run-
    // event-ledger, T2-5 / S-11): the last committed usage_update supplies
    // the usage metadata the stream showed, the native context supplies the
    // thread/turn, the route's run metadata overrides both (as the finish
    // metadata once overrode message-metadata) and the persisted
    // model/provider still take precedence over everything.
    const { records, nativeContext } = await committedCodexRunRecords()
    expect(
      buildCodexAppServerAssistantMessage({
        records,
        nativeContext,
        metadata: {
          provider: "stale-provider",
          adapterSource: "codex-app-server",
          sessionId: "session-1",
          totalTokens: 999,
          model: "stale",
        },
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
        adapterSource: "codex-app-server",
        threadId: "thread-7",
        turnId: "turn-3",
        sessionId: "session-1",
        inputTokens: 18,
        outputTokens: 2,
        totalTokens: 999,
        cacheReadInputTokens: 4,
        cachedInputTokens: 4,
        reasoningOutputTokens: 1,
        cumulativeInputTokens: 28,
        cumulativeOutputTokens: 2,
        cumulativeTotalTokens: 30,
        modelContextWindow: 258400,
        model: "gpt-5.4",
        provider: "codex",
      },
    })
  })

  test("persists committed usage, native context and session metadata for reload (T2-5 / S-11)", async () => {
    const db = createPersistenceDb()
    const owner = {
      runId: "run-metadata",
      controller: new AbortController(),
      cancelRequested: false,
    }
    setActiveCodexStream("sub-1", owner)
    const { records, nativeContext } = await committedCodexRunRecords()
    expect(nativeContext).toEqual({ threadId: "thread-7", turnId: "turn-3" })

    expect(
      persistCodexDesktopAssistantAfterNaturalFinish({
        db,
        subChatId: "sub-1",
        activeStreamOwner: owner,
        messagesForStream: [],
        records,
        nativeContext,
        metadata: {
          provider: "codex",
          adapterSource: "codex-app-server",
          sessionId: "session-9",
        },
        model: "gpt-5.4",
        createId: () => "assistant-1",
        now: () => new Date("2026-08-26T03:04:05.000Z"),
      }),
    ).toBe(true)
    const [persisted] = readMessages(db) as Array<{
      metadata: Record<string, unknown>
    }>
    expect(persisted.metadata).toMatchObject({
      provider: "codex",
      model: "gpt-5.4",
      sessionId: "session-9",
      threadId: "thread-7",
      turnId: "turn-3",
      modelContextWindow: 258400,
      cachedInputTokens: 4,
      cacheReadInputTokens: 4,
      inputTokens: 18,
      totalTokens: 20,
      cumulativeTotalTokens: 30,
    })
  })

  test("replaces streamed deltas with the reconciled final item text", () => {
    expect(
      buildCodexAppServerAssistantMessage({
        records: [
          assistantRecord(1, "hel"),
          {
            sequence: 2,
            type: "status",
            payload: {
              subtype: "item_reconciliation",
              item: {
                threadId: "th",
                turnId: "tu",
                itemId: "msg",
                channel: "assistant",
                partIndex: 0,
                state: "completed",
                text: "hello",
              },
            },
          },
        ],
        model: "gpt-5.4",
        generateMessageId: () => "assistant-1",
        now: () => new Date("2026-08-26T02:03:04.000Z"),
      }),
    ).toMatchObject({ parts: [{ type: "text", text: "hello" }] })
  })

  test("persists an assistant only when the run remains authoritative", () => {
    const db = createPersistenceDb()
    const staleOwner = {
      runId: "run-shared",
      controller: new AbortController(),
      cancelRequested: false,
    }
    const currentOwner = {
      runId: "run-shared",
      controller: new AbortController(),
      cancelRequested: false,
    }
    setActiveCodexStream("sub-1", currentOwner)

    expect(
      persistCodexDesktopAssistantAfterNaturalFinish({
        db,
        subChatId: "sub-1",
        activeStreamOwner: staleOwner,
        messagesForStream: [],
        records: [assistantRecord(1, "stale")],
        model: "gpt-5.4",
      }),
    ).toBe(false)
    expect(readMessages(db)).toEqual([])

    expect(
      persistCodexDesktopAssistantAfterNaturalFinish({
        db,
        subChatId: "sub-1",
        activeStreamOwner: currentOwner,
        messagesForStream: [],
        records: [assistantRecord(1, "current")],
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
    expect(
      persistCodexDesktopAssistantAfterNaturalFinish({
        db,
        subChatId: "sub-1",
        activeStreamOwner: currentOwner,
        messagesForStream: [],
        records: [assistantRecord(1, "missing owner")],
        model: "gpt-5.4",
        createId: () => "assistant-2",
        now: () => new Date("2026-08-26T03:04:06.000Z"),
      }),
    ).toBe(false)
    expect(readMessages(db)).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: "2026-08-26T03:04:05.000Z",
        parts: [{ type: "text", text: "current" }],
        metadata: { model: "gpt-5.4", provider: "codex" },
      },
    ])
    expect(readUpdatedAt(db)).toEqual(new Date("2026-08-26T03:04:05.000Z"))
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
    const userAuthorityGateIndex = route.indexOf(
      "if (!userPersistence.authoritative)",
      userPersistenceIndex,
    )
    const mcpResolutionIndex = route.indexOf(
      "await resolveCodexMcpSnapshotForDesktopRun({",
      userPersistenceIndex,
    )

    expect(runtimeGateIndex).toBeGreaterThan(0)
    expect(historyReadIndex).toBeGreaterThan(runtimeGateIndex)
    expect(imagePreparationIndex).toBeGreaterThan(historyReadIndex)
    expect(providerBindingIndex).toBeGreaterThan(imagePreparationIndex)
    expect(userPersistenceIndex).toBeGreaterThan(providerBindingIndex)
    expect(route.slice(userPersistenceIndex, userAuthorityGateIndex)).toContain(
      "activeStreamOwner",
    )
    expect(userAuthorityGateIndex).toBeGreaterThan(userPersistenceIndex)
    expect(mcpResolutionIndex).toBeGreaterThan(userAuthorityGateIndex)
    expect(route).toContain("getLastCodexSessionId(existingMessages)")
    expect(route).not.toContain("getLastCodexSessionId(messagesForStream)")
  })
})
