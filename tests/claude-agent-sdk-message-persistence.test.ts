import { afterEach, describe, expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { eq } from "drizzle-orm"
import {
  clearClaudeActiveSessionsForTest,
  setActiveClaudeSession,
} from "../src/main/lib/claude/active-sessions"
import {
  persistClaudeAgentSdkAssistantResponse,
  prepareClaudeAgentSdkAssistantPersistence,
  shouldCreateClaudeAgentSdkRollbackStash,
} from "../src/main/lib/claude/agent-sdk-message-persistence"
import { chats, projects, subChats } from "../src/main/lib/db/schema"
import type { RollbackCheckpointBinding } from "../src/shared/chat-message"
import { EXACT_SECRET_REDACTION_MARKER } from "../src/shared/secret-redaction-policy"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

function seedChat(db: ReturnType<typeof createAgentJobTestDb>) {
  db.insert(projects)
    .values({
      id: "project-1",
      name: "Project",
      path: "/repo",
    })
    .run()
  db.insert(chats)
    .values({
      id: "chat-1",
      projectId: "project-1",
      worktreePath: "/repo",
      updatedAt: new Date("2026-05-31T00:00:00.000Z"),
    })
    .run()
  db.insert(subChats)
    .values({
      id: "sub-1",
      chatId: "chat-1",
      sessionId: "old-session",
      streamId: "stream-1",
      messages: JSON.stringify([{ id: "existing", role: "user" }]),
      updatedAt: new Date("2026-05-31T00:00:00.000Z"),
    })
    .run()
}

function activateClaudeSession(): AbortSignal {
  const controller = new AbortController()
  setActiveClaudeSession("sub-1", { controller, runId: "run-1" })
  return controller.signal
}

const publishedCheckpoint: RollbackCheckpointBinding = {
  ref: "refs/locus-checkpoints/123e4567-e89b-42d3-a456-426614174000",
  oid: "a".repeat(40),
}

describe("Claude Agent SDK message persistence", () => {
  afterEach(() => {
    clearClaudeActiveSessionsForTest()
  })

  test("creates assistant message and appended persisted messages", () => {
    const userMessage = { id: "user-1", role: "user", parts: [] }
    const parts = [{ type: "text", text: "hello" }]
    const metadata = {
      sessionId: "session-1",
      sdkMessageUuid: "sdk-message-1",
    }
    const persistedMetadata = {
      ...metadata,
      rollbackCheckpointAvailable: false,
    }

    const persistence = prepareClaudeAgentSdkAssistantPersistence({
      messagesToSave: [userMessage],
      parts,
      metadata,
      createId: () => "assistant-1",
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    })

    expect(persistence).toEqual({
      assistantMessage: {
        id: "assistant-1",
        role: "assistant",
        createdAt: "2026-06-01T00:00:00.000Z",
        parts,
        metadata: persistedMetadata,
      },
      messages: [
        userMessage,
        {
          id: "assistant-1",
          role: "assistant",
          createdAt: "2026-06-01T00:00:00.000Z",
          parts,
          metadata: persistedMetadata,
        },
      ],
      sessionId: "session-1",
    })
  })

  test("returns existing messages and session when there are no assistant parts", () => {
    const messagesToSave = [{ id: "user-1", role: "user" }]

    expect(
      prepareClaudeAgentSdkAssistantPersistence({
        messagesToSave,
        parts: [],
        metadata: { sessionId: "session-1" },
        createId: () => {
          throw new Error("id should not be created")
        },
      }),
    ).toEqual({
      assistantMessage: null,
      messages: messagesToSave,
      sessionId: "session-1",
    })
  })

  test("requires history, sdk message UUID, and cwd before rollback stash", () => {
    expect(
      shouldCreateClaudeAgentSdkRollbackStash({
        historyEnabled: true,
        metadata: { sdkMessageUuid: "sdk-message-1" },
        cwd: "/repo",
      }),
    ).toBe(true)
    expect(
      shouldCreateClaudeAgentSdkRollbackStash({
        historyEnabled: false,
        metadata: { sdkMessageUuid: "sdk-message-1" },
        cwd: "/repo",
      }),
    ).toBe(false)
    expect(
      shouldCreateClaudeAgentSdkRollbackStash({
        historyEnabled: true,
        metadata: {},
        cwd: "/repo",
      }),
    ).toBe(false)
    expect(
      shouldCreateClaudeAgentSdkRollbackStash({
        historyEnabled: true,
        metadata: { sdkMessageUuid: "sdk-message-1" },
        cwd: null,
      }),
    ).toBe(false)
  })

  test("persists assistant messages, clears stream state, touches chat, and creates rollback stash", async () => {
    const db = createAgentJobTestDb()
    seedChat(db)
    const stashEvents: string[] = []
    const draft = {
      cwd: "/repo",
      sdkMessageUuid: "sdk-message-1",
      oid: publishedCheckpoint.oid,
      privateRef:
        "refs/locus-checkpoint-drafts/223e4567-e89b-42d3-a456-426614174000",
      publicRef: publishedCheckpoint.ref,
    }

    const result = await persistClaudeAgentSdkAssistantResponse({
      db,
      chatId: "chat-1",
      subChatId: "sub-1",
      activeSessionSignal: activateClaudeSession(),
      messagesToSave: [{ id: "user-1", role: "user" }],
      parts: [{ type: "text", text: "hello" }],
      metadata: {
        sessionId: "session-1",
        sdkMessageUuid: "sdk-message-1",
      },
      historyEnabled: true,
      cwd: "/repo",
      createId: () => "assistant-1",
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      createRollbackStashDraftFn: async (cwd, uuid) => {
        stashEvents.push(`create:${cwd}:${uuid}`)
        return draft
      },
      publishRollbackStashDraftFn: async (input) => {
        expect(input).toBe(draft)
        stashEvents.push("publish")
        return publishedCheckpoint
      },
      discardRollbackStashDraftFn: async (input, options) => {
        expect(input).toBe(draft)
        expect(options).toBeUndefined()
        stashEvents.push("discard-private")
      },
    })

    expect(result.rollbackStashCreated).toBe(true)
    expect(stashEvents).toEqual([
      "create:/repo:sdk-message-1",
      "publish",
      "discard-private",
    ])

    const subChat = db
      .select()
      .from(subChats)
      .where(eq(subChats.id, "sub-1"))
      .get()
    expect(subChat?.sessionId).toBe("session-1")
    expect(subChat?.streamId).toBeNull()
    expect(JSON.parse(subChat?.messages ?? "[]")).toEqual([
      { id: "user-1", role: "user" },
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: "2026-06-01T00:00:00.000Z",
        parts: [{ type: "text", text: "hello" }],
        metadata: {
          sessionId: "session-1",
          sdkMessageUuid: "sdk-message-1",
          rollbackCheckpointAvailable: true,
          rollbackCheckpointRef: publishedCheckpoint.ref,
          rollbackCheckpointOid: publishedCheckpoint.oid,
        },
      },
    ])
    expect(
      db.select().from(chats).where(eq(chats.id, "chat-1")).get()?.updatedAt,
    ).toEqual(new Date("2026-06-01T00:00:00.000Z"))
  })

  test("redacts upstream and gateway hints recursively before assistant messages reach the database", async () => {
    const db = createAgentJobTestDb()
    seedChat(db)
    const upstreamToken = randomBytes(32).toString("hex")
    const gatewayToken = randomBytes(32).toString("hex")

    const result = await persistClaudeAgentSdkAssistantResponse({
      db,
      chatId: "chat-1",
      subChatId: "sub-1",
      activeSessionSignal: activateClaudeSession(),
      messagesToSave: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: `prior echo ${upstreamToken}` }],
        },
      ],
      parts: [
        {
          type: "text",
          text: `successful assistant echo ${upstreamToken} ${gatewayToken}`,
        },
      ],
      metadata: {
        sessionId: "session-1",
        note: `metadata echo ${upstreamToken}`,
      },
      secretHints: [upstreamToken, gatewayToken],
      historyEnabled: false,
      cwd: "/repo",
      createId: () => "assistant-secret",
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    })

    const subChat = db
      .select()
      .from(subChats)
      .where(eq(subChats.id, "sub-1"))
      .get()
    expect(subChat?.messages).not.toContain(upstreamToken)
    expect(subChat?.messages).not.toContain(gatewayToken)
    expect(subChat?.messages).toContain(EXACT_SECRET_REDACTION_MARKER)
    expect(JSON.stringify(result)).not.toContain(gatewayToken)
    expect(JSON.stringify(result)).not.toContain(upstreamToken)
    expect(result.persistence.assistantMessage).toMatchObject({
      parts: [
        {
          type: "text",
          text: `successful assistant echo ${EXACT_SECRET_REDACTION_MARKER} ${EXACT_SECRET_REDACTION_MARKER}`,
        },
      ],
      metadata: {
        note: `metadata echo ${EXACT_SECRET_REDACTION_MARKER}`,
        rollbackCheckpointAvailable: false,
      },
    })
  })

  test("does not persist or stash a stale assistant after a same-run-id replacement", async () => {
    const db = createAgentJobTestDb()
    seedChat(db)
    const staleController = new AbortController()
    const replacementController = new AbortController()
    setActiveClaudeSession("sub-1", {
      controller: staleController,
      runId: "run-shared",
    })
    setActiveClaudeSession("sub-1", {
      controller: replacementController,
      runId: "run-shared",
    })
    let stashCalls = 0

    const result = await persistClaudeAgentSdkAssistantResponse({
      db,
      chatId: "chat-1",
      subChatId: "sub-1",
      activeSessionSignal: staleController.signal,
      messagesToSave: [{ id: "stale-user", role: "user" }],
      parts: [{ type: "text", text: "stale assistant" }],
      metadata: {
        sessionId: "stale-session",
        sdkMessageUuid: "stale-sdk-message",
      },
      historyEnabled: true,
      cwd: "/repo",
      createRollbackStashDraftFn: async () => {
        stashCalls += 1
        return null
      },
    })

    expect(result.committed).toBe(false)
    expect(result.rollbackStashCreated).toBe(false)
    expect(stashCalls).toBe(0)
    expect(
      db.select().from(subChats).where(eq(subChats.id, "sub-1")).get(),
    ).toMatchObject({
      sessionId: "old-session",
      streamId: "stream-1",
      messages: JSON.stringify([{ id: "existing", role: "user" }]),
    })
  })

  test("does not persist or stash an aborted exact owner retained for lifecycle drain", async () => {
    const db = createAgentJobTestDb()
    seedChat(db)
    const controller = new AbortController()
    setActiveClaudeSession("sub-1", {
      controller,
      runId: "run-draining",
    })
    controller.abort()
    let stashCalls = 0

    const result = await persistClaudeAgentSdkAssistantResponse({
      db,
      chatId: "chat-1",
      subChatId: "sub-1",
      activeSessionSignal: controller.signal,
      messagesToSave: [{ id: "aborted-user", role: "user" }],
      parts: [{ type: "text", text: "aborted assistant" }],
      metadata: {
        sessionId: "aborted-session",
        sdkMessageUuid: "aborted-sdk-message",
      },
      historyEnabled: true,
      cwd: "/repo",
      createRollbackStashDraftFn: async () => {
        stashCalls += 1
        return null
      },
    })

    expect(result.committed).toBe(false)
    expect(result.rollbackStashCreated).toBe(false)
    expect(stashCalls).toBe(0)
    expect(
      db.select().from(subChats).where(eq(subChats.id, "sub-1")).get(),
    ).toMatchObject({
      sessionId: "old-session",
      streamId: "stream-1",
      messages: JSON.stringify([{ id: "existing", role: "user" }]),
    })
  })

  test("discards a private draft that captured successor files without publishing or persisting it", async () => {
    const db = createAgentJobTestDb()
    seedChat(db)
    const staleController = new AbortController()
    const replacementController = new AbortController()
    setActiveClaudeSession("sub-1", {
      controller: staleController,
      runId: "run-shared",
    })

    let releaseDraft: (() => void) | undefined
    const draftCanFinish = new Promise<void>((resolve) => {
      releaseDraft = resolve
    })
    let notifyDraftStarted: (() => void) | undefined
    const draftStarted = new Promise<void>((resolve) => {
      notifyDraftStarted = resolve
    })
    let workspaceContents = "files-from-run-a"
    const successorCheckpoint: RollbackCheckpointBinding = {
      ref: "refs/locus-checkpoints/323e4567-e89b-42d3-a456-426614174000",
      oid: "b".repeat(40),
    }
    const publicCheckpoints = new Map([
      [successorCheckpoint.ref, successorCheckpoint.oid],
    ])
    const discardedOids: string[] = []

    const persistencePromise = persistClaudeAgentSdkAssistantResponse({
      db,
      chatId: "chat-1",
      subChatId: "sub-1",
      activeSessionSignal: staleController.signal,
      messagesToSave: [{ id: "stale-user", role: "user" }],
      parts: [{ type: "text", text: "stale assistant" }],
      metadata: {
        sessionId: "stale-session",
        sdkMessageUuid: "stale-sdk-message",
      },
      historyEnabled: true,
      cwd: "/repo",
      createRollbackStashDraftFn: async (cwd, sdkMessageUuid) => {
        notifyDraftStarted?.()
        await draftCanFinish
        return {
          cwd,
          sdkMessageUuid,
          // Model a Git capture that finished only after Run B changed files.
          oid: workspaceContents,
          privateRef:
            "refs/locus-checkpoint-drafts/423e4567-e89b-42d3-a456-426614174000",
          publicRef:
            "refs/locus-checkpoints/523e4567-e89b-42d3-a456-426614174000",
        }
      },
      publishRollbackStashDraftFn: async (draft) => {
        publicCheckpoints.set(draft.publicRef, draft.oid)
        return { ref: draft.publicRef, oid: draft.oid }
      },
      discardRollbackStashDraftFn: async (draft) => {
        discardedOids.push(draft.oid)
      },
    })

    await draftStarted
    workspaceContents = "files-from-run-b"
    setActiveClaudeSession("sub-1", {
      controller: replacementController,
      runId: "run-shared",
    })
    releaseDraft?.()

    const result = await persistencePromise
    expect(result).toMatchObject({
      committed: false,
      rollbackStashCreated: false,
    })
    expect(discardedOids).toEqual(["files-from-run-b"])
    expect(publicCheckpoints).toEqual(
      new Map([[successorCheckpoint.ref, successorCheckpoint.oid]]),
    )
    expect(
      db.select().from(subChats).where(eq(subChats.id, "sub-1")).get(),
    ).toMatchObject({
      sessionId: "old-session",
      streamId: "stream-1",
      messages: JSON.stringify([{ id: "existing", role: "user" }]),
    })
  })

  test("retracts an exact published draft when ownership changes during publication", async () => {
    const db = createAgentJobTestDb()
    seedChat(db)
    const staleController = new AbortController()
    const replacementController = new AbortController()
    setActiveClaudeSession("sub-1", {
      controller: staleController,
      runId: "run-shared",
    })
    const draft = {
      cwd: "/repo",
      sdkMessageUuid: "stale-sdk-message",
      oid: publishedCheckpoint.oid,
      privateRef:
        "refs/locus-checkpoint-drafts/623e4567-e89b-42d3-a456-426614174000",
      publicRef: publishedCheckpoint.ref,
    }
    let releasePublish: (() => void) | undefined
    const publishCanFinish = new Promise<void>((resolve) => {
      releasePublish = resolve
    })
    let notifyPublishStarted: (() => void) | undefined
    const publishStarted = new Promise<void>((resolve) => {
      notifyPublishStarted = resolve
    })
    const discardOptions: Array<
      { publishedCheckpoint?: RollbackCheckpointBinding | null } | undefined
    > = []

    const persistencePromise = persistClaudeAgentSdkAssistantResponse({
      db,
      chatId: "chat-1",
      subChatId: "sub-1",
      activeSessionSignal: staleController.signal,
      messagesToSave: [{ id: "stale-user", role: "user" }],
      parts: [{ type: "text", text: "stale assistant" }],
      metadata: {
        sessionId: "stale-session",
        sdkMessageUuid: "stale-sdk-message",
      },
      historyEnabled: true,
      cwd: "/repo",
      createRollbackStashDraftFn: async () => draft,
      publishRollbackStashDraftFn: async () => {
        notifyPublishStarted?.()
        await publishCanFinish
        return publishedCheckpoint
      },
      discardRollbackStashDraftFn: async (_draft, options) => {
        discardOptions.push(options)
      },
    })

    await publishStarted
    setActiveClaudeSession("sub-1", {
      controller: replacementController,
      runId: "run-shared",
    })
    releasePublish?.()

    const result = await persistencePromise
    expect(result).toMatchObject({
      committed: false,
      rollbackStashCreated: false,
    })
    expect(discardOptions).toEqual([{ publishedCheckpoint }])
    expect(
      db.select().from(subChats).where(eq(subChats.id, "sub-1")).get(),
    ).toMatchObject({
      sessionId: "old-session",
      streamId: "stream-1",
      messages: JSON.stringify([{ id: "existing", role: "user" }]),
    })
  })

  test("persists explicit rollback unavailability when checkpoint publication fails", async () => {
    const db = createAgentJobTestDb()
    seedChat(db)
    const draft = {
      cwd: "/repo",
      sdkMessageUuid: "sdk-message-1",
      oid: "c".repeat(40),
      privateRef:
        "refs/locus-checkpoint-drafts/723e4567-e89b-42d3-a456-426614174000",
      publicRef: "refs/locus-checkpoints/823e4567-e89b-42d3-a456-426614174000",
    }
    const discardOptions: unknown[] = []

    const result = await persistClaudeAgentSdkAssistantResponse({
      db,
      chatId: "chat-1",
      subChatId: "sub-1",
      activeSessionSignal: activateClaudeSession(),
      messagesToSave: [{ id: "user-1", role: "user" }],
      parts: [{ type: "text", text: "assistant without rollback" }],
      metadata: {
        sessionId: "session-1",
        sdkMessageUuid: "sdk-message-1",
        // Runtime-controlled metadata cannot smuggle a legacy checkpoint path.
        rollbackCheckpointAvailable: true,
        rollbackCheckpointRef: "refs/checkpoints/sdk-message-1",
        rollbackCheckpointOid: "d".repeat(40),
      },
      historyEnabled: true,
      cwd: "/repo",
      createRollbackStashDraftFn: async () => draft,
      publishRollbackStashDraftFn: async () => null,
      discardRollbackStashDraftFn: async (_draft, options) => {
        discardOptions.push(options)
      },
    })

    expect(result).toMatchObject({
      committed: true,
      rollbackStashCreated: false,
    })
    expect(result.persistence.assistantMessage?.metadata).toMatchObject({
      sdkMessageUuid: "sdk-message-1",
      rollbackCheckpointAvailable: false,
    })
    expect(result.persistence.assistantMessage?.metadata).not.toHaveProperty(
      "rollbackCheckpointRef",
    )
    expect(result.persistence.assistantMessage?.metadata).not.toHaveProperty(
      "rollbackCheckpointOid",
    )
    expect(discardOptions).toEqual([undefined])

    const persistedMessages = JSON.parse(
      db.select().from(subChats).where(eq(subChats.id, "sub-1")).get()
        ?.messages ?? "[]",
    ) as Array<{ metadata?: Record<string, unknown> }>
    expect(persistedMessages.at(-1)?.metadata).toMatchObject({
      rollbackCheckpointAvailable: false,
    })
    expect(persistedMessages.at(-1)?.metadata).not.toHaveProperty(
      "rollbackCheckpointRef",
    )
  })

  test("retracts its exact public checkpoint and preserves the old row when the DB transaction throws", async () => {
    const db = createAgentJobTestDb()
    seedChat(db)
    db.$client.exec(`
      CREATE TRIGGER reject_assistant_message_update
      BEFORE UPDATE OF messages ON sub_chats
      BEGIN
        SELECT RAISE(ABORT, 'assistant persistence blocked');
      END;
    `)
    const draft = {
      cwd: "/repo",
      sdkMessageUuid: "sdk-message-1",
      oid: "e".repeat(40),
      privateRef:
        "refs/locus-checkpoint-drafts/923e4567-e89b-42d3-a456-426614174000",
      publicRef: "refs/locus-checkpoints/a23e4567-e89b-42d3-a456-426614174000",
    }
    const checkpoint = { ref: draft.publicRef, oid: draft.oid }
    const discardOptions: Array<
      { publishedCheckpoint?: RollbackCheckpointBinding | null } | undefined
    > = []

    await expect(
      persistClaudeAgentSdkAssistantResponse({
        db,
        chatId: "chat-1",
        subChatId: "sub-1",
        activeSessionSignal: activateClaudeSession(),
        messagesToSave: [{ id: "user-1", role: "user" }],
        parts: [{ type: "text", text: "must not persist" }],
        metadata: {
          sessionId: "session-1",
          sdkMessageUuid: "sdk-message-1",
        },
        historyEnabled: true,
        cwd: "/repo",
        createRollbackStashDraftFn: async () => draft,
        publishRollbackStashDraftFn: async () => checkpoint,
        discardRollbackStashDraftFn: async (_draft, options) => {
          discardOptions.push(options)
        },
      }),
    ).rejects.toThrow("assistant persistence blocked")

    expect(discardOptions).toEqual([{ publishedCheckpoint: checkpoint }])
    expect(
      db.select().from(subChats).where(eq(subChats.id, "sub-1")).get(),
    ).toMatchObject({
      sessionId: "old-session",
      streamId: "stream-1",
      messages: JSON.stringify([{ id: "existing", role: "user" }]),
    })
  })

  test("clears final empty response streams but preserves stream state for empty error saves", async () => {
    const finalDb = createAgentJobTestDb()
    seedChat(finalDb)

    await persistClaudeAgentSdkAssistantResponse({
      db: finalDb,
      chatId: "chat-1",
      subChatId: "sub-1",
      activeSessionSignal: activateClaudeSession(),
      messagesToSave: [{ id: "user-1", role: "user" }],
      parts: [],
      metadata: { sessionId: "session-1" },
      historyEnabled: false,
      cwd: "/repo",
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    })
    expect(
      finalDb.select().from(subChats).where(eq(subChats.id, "sub-1")).get(),
    ).toMatchObject({
      sessionId: "session-1",
      streamId: null,
    })

    const errorDb = createAgentJobTestDb()
    seedChat(errorDb)
    await persistClaudeAgentSdkAssistantResponse({
      db: errorDb,
      chatId: "chat-1",
      subChatId: "sub-1",
      activeSessionSignal: activateClaudeSession(),
      messagesToSave: [{ id: "user-1", role: "user" }],
      parts: [],
      metadata: { sessionId: "session-1" },
      historyEnabled: false,
      cwd: "/repo",
      clearStreamWhenEmpty: false,
      touchChatWhenEmpty: false,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    })
    expect(
      errorDb.select().from(subChats).where(eq(subChats.id, "sub-1")).get(),
    ).toMatchObject({
      sessionId: "old-session",
      streamId: "stream-1",
    })
  })
})
