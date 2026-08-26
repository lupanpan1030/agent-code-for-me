import { beforeEach, describe, expect, mock, test } from "bun:test"
import { eq } from "drizzle-orm"
import {
  acquireChatMaintenanceFence,
  clearChatMaintenanceFencesForTest,
  releaseChatMaintenanceFence,
} from "../src/main/lib/agent-runtime/chat-maintenance-fence"
import {
  clearClaudeActiveSessionsForTest,
  setActiveClaudeSession,
} from "../src/main/lib/claude/active-sessions"
import * as schema from "../src/main/lib/db/schema"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

let testDb = createAgentJobTestDb()
let databaseAccessCount = 0
let rollbackCalls: Array<{
  worktreePath: string
  checkpoint: { ref: string; oid: string }
}> = []
let rollbackResult:
  | { success: true; checkpointFound: true }
  | { success: true; checkpointFound: false }
  | { success: false; error: string } = {
  success: true,
  checkpointFound: true,
}
let rollbackThrownError: Error | null = null

mock.module("electron", () => ({
  BrowserWindow: class BrowserWindow {},
}))

mock.module("../src/main/lib/db", () => ({
  ...schema,
  getDatabase: () => {
    databaseAccessCount += 1
    return testDb
  },
}))

mock.module("../src/main/lib/chats/workspace-cleanup", () => ({
  cleanupChatWorkspaceForDelete: async () => ({
    success: true,
    workspaceId: null,
    worktreeRemoved: false,
    terminalKilled: 0,
    terminalFailed: 0,
    errors: [],
  }),
}))

mock.module("../src/main/lib/git", () => ({
  createWorktreeForChat: async () => ({}),
  fetchGitHubPRStatus: async () => null,
  getWorktreeDiff: async () => "",
  removeWorktree: async () => ({ success: true }),
  sanitizeProjectName: (name: string) => name,
}))

mock.module("../src/main/lib/git/cache", () => ({
  gitCache: {
    invalidateStatus: () => {},
    invalidateParsedDiff: () => {},
  },
}))

mock.module("../src/main/lib/git/stash", () => ({
  applyRollbackStash: async (
    worktreePath: string,
    checkpoint: { ref: string; oid: string },
  ) => {
    rollbackCalls.push({ worktreePath, checkpoint })
    if (rollbackThrownError) throw rollbackThrownError
    return rollbackResult
  },
}))

mock.module("../src/main/lib/terminal/manager", () => ({
  terminalManager: {
    killByWorkspaceId: async () => ({ killed: 0, failed: 0 }),
  },
}))

mock.module("../src/main/lib/trpc/routers/chats-helpers", () => ({
  getCodexRollbackUnsupportedMessage: () => "Codex rollback unsupported",
  hasCodexBackedMessages: () => false,
  sendWorktreeSetupApprovalRequired: () => {},
  sendWorktreeSetupFailure: () => {},
}))

const { chatCrudProcedures } = await import(
  "../src/main/lib/trpc/routers/chats-crud"
)
const { subChatProcedures } = await import(
  "../src/main/lib/trpc/routers/chats-sub-chats"
)
const { router } = await import("../src/main/lib/trpc")

const bindingRouter = router({
  create: chatCrudProcedures.create,
  get: chatCrudProcedures.get,
  createSubChat: subChatProcedures.createSubChat,
  getSubChat: subChatProcedures.getSubChat,
  updateSubChatBinding: subChatProcedures.updateSubChatBinding,
  forkSubChat: subChatProcedures.forkSubChat,
  rollbackToMessage: subChatProcedures.rollbackToMessage,
})

beforeEach(() => {
  testDb = createAgentJobTestDb()
  databaseAccessCount = 0
  rollbackCalls = []
  rollbackResult = { success: true, checkpointFound: true }
  rollbackThrownError = null
  clearChatMaintenanceFencesForTest()
  clearClaudeActiveSessionsForTest()
})

function rejectBindingInserts(): void {
  testDb.$client.exec(`
    CREATE TRIGGER reject_sub_chat_binding_insert
    BEFORE INSERT ON sub_chat_bindings
    BEGIN
      SELECT RAISE(ABORT, 'binding insert blocked');
    END;
  `)
}

function seedProviderProfile(input: {
  id: string
  targetRuntimes: string[]
  defaultModel?: string
}): void {
  testDb
    .insert(schema.agentProviderProfiles)
    .values({
      id: input.id,
      name: input.id,
      protocol: "openai-responses",
      baseUrl: "https://provider.example.com/v1",
      defaultModel: input.defaultModel ?? "provider-model",
      authMode: "none",
      targetRuntimesJson: JSON.stringify(input.targetRuntimes),
      capabilitiesJson: "{}",
    })
    .run()
}

describe("chat session binding router envelopes", () => {
  test("create and read attach the durable binding instead of inferring current runtime from messages", async () => {
    const caller = bindingRouter.createCaller({ getWindow: () => null })
    const created = await caller.create({
      projectId: null,
      name: "Bound chat",
      provider: "claude-code",
      model: "legacy-message-model",
      initialMessage: "hello",
      useWorktree: false,
      mode: "agent",
      binding: {
        runtime: "codex",
        modelId: "gpt-5.5",
        modelSource: "chatgpt",
        thinkingLevel: "high",
      },
    })

    const firstSubChat = created.subChats[0]
    if (!firstSubChat) {
      throw new Error("Expected chat creation to return its initial sub-chat")
    }
    expect(firstSubChat?.binding).toMatchObject({
      runtime: "codex",
      modelId: "gpt-5.5",
      modelSource: "chatgpt",
      thinkingLevel: "high",
    })
    const persistedMessages = JSON.parse(firstSubChat.messages) as Array<{
      metadata?: { model?: string; provider?: string }
    }>
    expect(persistedMessages[0]?.metadata).toMatchObject({
      model: "gpt-5.5",
      provider: "codex",
    })
    expect(
      testDb
        .select()
        .from(schema.subChatBindings)
        .where(eq(schema.subChatBindings.subChatId, firstSubChat.id))
        .all(),
    ).toHaveLength(1)

    const loaded = await caller.get({ id: created.id })
    expect(loaded?.subChats[0]?.binding.runtime).toBe("codex")
  })

  test("createSubChat, update, getSubChat, and fork delegate binding writes to the owner", async () => {
    const caller = bindingRouter.createCaller({ getWindow: () => null })
    const created = await caller.create({
      projectId: null,
      name: "Claude chat",
      initialMessage: "fork me",
      provider: "claude-code",
      useWorktree: false,
      mode: "agent",
      binding: {
        runtime: "claude-code",
        modelId: "fable",
        modelSource: "claude-oauth",
      },
    })

    const additional = await caller.createSubChat({
      chatId: created.id,
      name: "Codex child",
      mode: "agent",
      binding: {
        runtime: "codex",
        modelId: "gpt-5.5",
        modelSource: "chatgpt",
        thinkingLevel: "medium",
      },
    })
    expect(additional.binding.runtime).toBe("codex")

    seedProviderProfile({
      id: "profile-1",
      targetRuntimes: ["codex"],
      defaultModel: "profile-default-model",
    })

    const updated = await caller.updateSubChatBinding({
      id: additional.id,
      binding: {
        modelSource: "provider-profile:profile-1",
        providerProfileId: "mismatched-profile",
        modelId: "profile-default-model",
        thinkingLevel: "xhigh",
      },
    })
    expect(updated).toMatchObject({
      modelSource: "provider-profile:profile-1",
      providerProfileId: "profile-1",
      modelId: "profile-default-model",
      thinkingLevel: null,
    })
    expect((await caller.getSubChat({ id: additional.id }))?.binding).toEqual(
      updated,
    )

    const source = created.subChats[0]
    if (!source) {
      throw new Error("Expected chat creation to return its initial sub-chat")
    }
    const sourceMessages = JSON.parse(source.messages) as Array<{ id: string }>
    const sourceMessage = sourceMessages[0]
    if (!sourceMessage) {
      throw new Error("Expected the source sub-chat to contain a message")
    }
    const forked = await caller.forkSubChat({
      subChatId: source.id,
      messageId: sourceMessage.id,
    })
    expect(forked.subChat.binding).toMatchObject({
      runtime: "claude-code",
      modelId: "fable",
      modelSource: "claude-oauth",
    })
    expect(forked.subChat.binding.id).not.toBe(source.binding.id)
  })

  test("rolls back creation when a stored default references a stale or wrong-target Profile", async () => {
    const caller = bindingRouter.createCaller({ getWindow: () => null })
    seedProviderProfile({ id: "claude-only", targetRuntimes: ["claude"] })
    seedProviderProfile({
      id: "codex-current",
      targetRuntimes: ["codex"],
      defaultModel: "current-provider-model",
    })

    for (const profileId of ["missing-profile", "claude-only"]) {
      await expect(
        caller.create({
          projectId: null,
          name: `Rejected ${profileId}`,
          useWorktree: false,
          mode: "agent",
          binding: {
            runtime: "codex",
            modelSource: `provider-profile:${profileId}`,
            modelId: "provider-model",
          },
        }),
      ).rejects.toThrow(
        profileId === "missing-profile"
          ? "was not found"
          : "does not support codex",
      )
    }

    await expect(
      caller.create({
        projectId: null,
        name: "Rejected stale model snapshot",
        useWorktree: false,
        mode: "agent",
        binding: {
          runtime: "codex",
          modelSource: "provider-profile:codex-current",
          modelId: "stale-provider-model",
        },
      }),
    ).rejects.toThrow("requires its current default model snapshot")

    expect(testDb.select().from(schema.chats).all()).toHaveLength(0)
    expect(testDb.select().from(schema.subChats).all()).toHaveLength(0)
    expect(testDb.select().from(schema.subChatBindings).all()).toHaveLength(0)
  })

  test("chat creation rolls back the chat and sub-chat when binding creation fails", async () => {
    const caller = bindingRouter.createCaller({ getWindow: () => null })
    rejectBindingInserts()

    await expect(
      caller.create({
        projectId: null,
        name: "Atomic chat",
        useWorktree: false,
        mode: "agent",
        binding: { runtime: "codex" },
      }),
    ).rejects.toThrow()

    expect(testDb.select().from(schema.chats).all()).toHaveLength(0)
    expect(testDb.select().from(schema.subChats).all()).toHaveLength(0)
  })

  test("sub-chat creation rolls back its row when binding creation fails", async () => {
    const caller = bindingRouter.createCaller({ getWindow: () => null })
    const created = await caller.create({
      projectId: null,
      name: "Atomic child parent",
      useWorktree: false,
      mode: "agent",
      binding: { runtime: "claude-code" },
    })
    const countBefore = testDb.select().from(schema.subChats).all().length
    rejectBindingInserts()

    await expect(
      caller.createSubChat({
        chatId: created.id,
        mode: "agent",
        binding: { runtime: "codex" },
      }),
    ).rejects.toThrow()

    expect(testDb.select().from(schema.subChats).all()).toHaveLength(
      countBefore,
    )
  })

  test("fork creation rolls back its row when binding copy fails", async () => {
    const caller = bindingRouter.createCaller({ getWindow: () => null })
    const created = await caller.create({
      projectId: null,
      name: "Atomic fork parent",
      initialMessage: "fork source",
      useWorktree: false,
      mode: "agent",
      binding: { runtime: "claude-code" },
    })
    const source = created.subChats[0]
    if (!source) {
      throw new Error("Expected chat creation to return its initial sub-chat")
    }
    const sourceMessage = (
      JSON.parse(source.messages) as Array<{ id: string }>
    )[0]
    if (!sourceMessage) {
      throw new Error("Expected the source sub-chat to contain a message")
    }
    const sourceMessageId = sourceMessage.id
    const countBefore = testDb.select().from(schema.subChats).all().length
    rejectBindingInserts()

    await expect(
      caller.forkSubChat({
        subChatId: source.id,
        messageId: sourceMessageId,
      }),
    ).rejects.toThrow()

    expect(testDb.select().from(schema.subChats).all()).toHaveLength(
      countBefore,
    )
  })

  test("rollback resolves the canonical checkpoint from target assistant metadata", async () => {
    const caller = bindingRouter.createCaller({ getWindow: () => null })
    const created = await caller.create({
      projectId: null,
      name: "Rollback target",
      useWorktree: false,
      mode: "agent",
      binding: { runtime: "claude-code" },
    })
    const source = created.subChats[0]
    if (!source) throw new Error("Expected rollback source sub-chat")
    const checkpoint = {
      ref: "refs/locus-checkpoints/123e4567-e89b-42d3-a456-426614174000",
      oid: "a".repeat(40),
    }
    testDb
      .update(schema.chats)
      .set({ worktreePath: "/repo" })
      .where(eq(schema.chats.id, created.id))
      .run()
    testDb
      .update(schema.subChats)
      .set({
        messages: JSON.stringify([
          {
            id: "assistant-target",
            role: "assistant",
            parts: [{ type: "text", text: "checkpoint" }],
            metadata: {
              sdkMessageUuid: "sdk-target",
              rollbackCheckpointAvailable: true,
              rollbackCheckpointRef: checkpoint.ref,
              rollbackCheckpointOid: checkpoint.oid,
            },
          },
          { id: "user-later", role: "user", parts: [] },
        ]),
      })
      .where(eq(schema.subChats.id, source.id))
      .run()

    const result = await caller.rollbackToMessage({
      subChatId: source.id,
      sdkMessageUuid: "sdk-target",
    })

    expect(result.success).toBe(true)
    expect(rollbackCalls).toEqual([{ worktreePath: "/repo", checkpoint }])
    if (!result.success) throw new Error(result.error)
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.metadata).toMatchObject({
      sdkMessageUuid: "sdk-target",
      rollbackCheckpointAvailable: true,
      rollbackCheckpointRef: checkpoint.ref,
      rollbackCheckpointOid: checkpoint.oid,
      shouldResume: true,
    })
    const reacquired = acquireChatMaintenanceFence(source.id, "rollback")
    expect(reacquired.ok).toBe(true)
    if (reacquired.ok) {
      expect(releaseChatMaintenanceFence(reacquired.fence)).toBe(true)
    }
  })

  test("rollback releases its maintenance fence when Git rollback returns failure", async () => {
    const caller = bindingRouter.createCaller({ getWindow: () => null })
    const created = await caller.create({
      projectId: null,
      name: "Rollback Git failure",
      useWorktree: false,
      mode: "agent",
      binding: { runtime: "claude-code" },
    })
    const source = created.subChats[0]
    if (!source) throw new Error("Expected rollback source sub-chat")
    const checkpoint = {
      ref: "refs/locus-checkpoints/223e4567-e89b-42d3-a456-426614174000",
      oid: "b".repeat(40),
    }
    testDb
      .update(schema.chats)
      .set({ worktreePath: "/repo" })
      .where(eq(schema.chats.id, created.id))
      .run()
    testDb
      .update(schema.subChats)
      .set({
        messages: JSON.stringify([
          {
            id: "assistant-target",
            role: "assistant",
            parts: [{ type: "text", text: "checkpoint" }],
            metadata: {
              sdkMessageUuid: "sdk-target",
              rollbackCheckpointAvailable: true,
              rollbackCheckpointRef: checkpoint.ref,
              rollbackCheckpointOid: checkpoint.oid,
            },
          },
        ]),
      })
      .where(eq(schema.subChats.id, source.id))
      .run()
    rollbackResult = { success: false, error: "simulated failure" }

    expect(
      await caller.rollbackToMessage({
        subChatId: source.id,
        sdkMessageUuid: "sdk-target",
      }),
    ).toEqual({
      success: false,
      error: "Git rollback failed: simulated failure",
    })

    const reacquired = acquireChatMaintenanceFence(source.id, "rollback")
    expect(reacquired.ok).toBe(true)
    if (reacquired.ok) {
      expect(releaseChatMaintenanceFence(reacquired.fence)).toBe(true)
    }
  })

  test("rollback releases its maintenance fence when Git rollback throws", async () => {
    const caller = bindingRouter.createCaller({ getWindow: () => null })
    const created = await caller.create({
      projectId: null,
      name: "Rollback Git throw",
      useWorktree: false,
      mode: "agent",
      binding: { runtime: "claude-code" },
    })
    const source = created.subChats[0]
    if (!source) throw new Error("Expected rollback source sub-chat")
    const checkpoint = {
      ref: "refs/locus-checkpoints/323e4567-e89b-42d3-a456-426614174000",
      oid: "c".repeat(40),
    }
    testDb
      .update(schema.chats)
      .set({ worktreePath: "/repo" })
      .where(eq(schema.chats.id, created.id))
      .run()
    testDb
      .update(schema.subChats)
      .set({
        messages: JSON.stringify([
          {
            id: "assistant-target",
            role: "assistant",
            parts: [{ type: "text", text: "checkpoint" }],
            metadata: {
              sdkMessageUuid: "sdk-target",
              rollbackCheckpointAvailable: true,
              rollbackCheckpointRef: checkpoint.ref,
              rollbackCheckpointOid: checkpoint.oid,
            },
          },
        ]),
      })
      .where(eq(schema.subChats.id, source.id))
      .run()
    rollbackThrownError = new Error("simulated throw")

    await expect(
      caller.rollbackToMessage({
        subChatId: source.id,
        sdkMessageUuid: "sdk-target",
      }),
    ).rejects.toThrow("simulated throw")

    const reacquired = acquireChatMaintenanceFence(source.id, "rollback")
    expect(reacquired.ok).toBe(true)
    if (reacquired.ok) {
      expect(releaseChatMaintenanceFence(reacquired.fence)).toBe(true)
    }
  })

  test("rollback fails closed when canonical availability, ref, or OID is absent", async () => {
    const caller = bindingRouter.createCaller({ getWindow: () => null })
    const created = await caller.create({
      projectId: null,
      name: "Unavailable rollback",
      useWorktree: false,
      mode: "agent",
      binding: { runtime: "claude-code" },
    })
    const source = created.subChats[0]
    if (!source) throw new Error("Expected rollback source sub-chat")
    testDb
      .update(schema.chats)
      .set({ worktreePath: "/repo" })
      .where(eq(schema.chats.id, created.id))
      .run()

    const unavailableMetadata = [
      { sdkMessageUuid: "sdk-target" },
      {
        sdkMessageUuid: "sdk-target",
        rollbackCheckpointAvailable: false,
        rollbackCheckpointRef:
          "refs/locus-checkpoints/123e4567-e89b-42d3-a456-426614174000",
        rollbackCheckpointOid: "a".repeat(40),
      },
      {
        sdkMessageUuid: "sdk-target",
        rollbackCheckpointAvailable: true,
        rollbackCheckpointRef: "refs/checkpoints/sdk-target",
        rollbackCheckpointOid: "a".repeat(40),
      },
      {
        sdkMessageUuid: "sdk-target",
        rollbackCheckpointAvailable: true,
        rollbackCheckpointRef:
          "refs/locus-checkpoints/123e4567-e89b-42d3-a456-426614174000",
      },
    ]

    for (const metadata of unavailableMetadata) {
      testDb
        .update(schema.subChats)
        .set({
          messages: JSON.stringify([
            {
              id: "assistant-target",
              role: "assistant",
              parts: [{ type: "text", text: "no checkpoint" }],
              metadata,
            },
          ]),
        })
        .where(eq(schema.subChats.id, source.id))
        .run()
      const result = await caller.rollbackToMessage({
        subChatId: source.id,
        sdkMessageUuid: "sdk-target",
      })
      expect(result).toEqual({
        success: false,
        error: "Rollback checkpoint is unavailable for this message",
      })
    }

    testDb
      .update(schema.subChats)
      .set({
        messages: JSON.stringify([
          {
            id: "user-spoof",
            role: "user",
            parts: [{ type: "text", text: "not an assistant checkpoint" }],
            metadata: {
              sdkMessageUuid: "sdk-target",
              rollbackCheckpointAvailable: true,
              rollbackCheckpointRef:
                "refs/locus-checkpoints/423e4567-e89b-42d3-a456-426614174000",
              rollbackCheckpointOid: "d".repeat(40),
            },
          },
        ]),
      })
      .where(eq(schema.subChats.id, source.id))
      .run()
    expect(
      await caller.rollbackToMessage({
        subChatId: source.id,
        sdkMessageUuid: "sdk-target",
      }),
    ).toEqual({ success: false, error: "Message not found" })
    expect(rollbackCalls).toEqual([])
  })

  test("rollback returns active-Run BUSY before touching DB or Git", async () => {
    const caller = bindingRouter.createCaller({ getWindow: () => null })
    setActiveClaudeSession("sub-active", {
      controller: new AbortController(),
      runId: "run-active",
    })

    expect(
      await caller.rollbackToMessage({
        subChatId: "sub-active",
        sdkMessageUuid: "sdk-target",
      }),
    ).toEqual({
      success: false,
      error:
        "Chat sub-active is busy with active Run run-active; rollback cannot start.",
      busy: {
        code: "SESSION_BINDING_BUSY",
        subChatId: "sub-active",
        operation: "rollback",
        activeRunId: "run-active",
        reason: "active-run",
      },
    })
    expect(databaseAccessCount).toBe(0)
    expect(rollbackCalls).toEqual([])
  })

  test("rollback returns maintenance BUSY and cannot release another owner", async () => {
    const caller = bindingRouter.createCaller({ getWindow: () => null })
    const owner = acquireChatMaintenanceFence("sub-maintenance", "rollback")
    if (!owner.ok) throw new Error("Expected maintenance fence owner")

    expect(
      await caller.rollbackToMessage({
        subChatId: "sub-maintenance",
        sdkMessageUuid: "sdk-target",
      }),
    ).toEqual({
      success: false,
      error:
        "Chat sub-maintenance is busy with another maintenance operation; rollback cannot start.",
      busy: {
        code: "SESSION_BINDING_BUSY",
        subChatId: "sub-maintenance",
        operation: "rollback",
        activeRunId: null,
        reason: "maintenance",
      },
    })
    expect(databaseAccessCount).toBe(0)
    expect(rollbackCalls).toEqual([])
    expect(releaseChatMaintenanceFence(owner.fence)).toBe(true)
  })

  test("does not expose the retired arbitrary message overwrite mutation", () => {
    expect("updateSubChatMessages" in subChatProcedures).toBe(false)
  })
})
