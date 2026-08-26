import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import type { RollbackCheckpointBinding } from "../../../shared/chat-message"
import { redactRuntimePayload } from "../agent-runtime/redaction"
import type { JsonValue } from "../agent-runtime/runtime-events"
import { chats, subChats } from "../db/schema"
import {
  createRollbackStashDraft,
  discardRollbackStashDraft,
  publishRollbackStashDraft,
  type RollbackStashDraft,
} from "../git/stash"
import { isActiveClaudeSessionSignal } from "./active-sessions"

export type PrepareClaudeAgentSdkAssistantPersistenceInput = {
  messagesToSave: any[]
  parts: any[]
  metadata: any
  createId?: () => string
  now?: () => Date
}

export type ClaudeAgentSdkAssistantPersistence = {
  assistantMessage: any | null
  messages: any[]
  sessionId: string | null
}

export type PersistClaudeAgentSdkAssistantResponseInput = {
  db: any
  chatId: string
  subChatId: string
  activeSessionSignal: AbortSignal
  messagesToSave: any[]
  parts: any[]
  metadata: any
  secretHints?: readonly string[]
  historyEnabled: boolean
  cwd?: string | null
  clearStreamWhenEmpty?: boolean
  touchChatWhenEmpty?: boolean
  createId?: () => string
  now?: () => Date
  createRollbackStashDraftFn?: typeof createRollbackStashDraft
  publishRollbackStashDraftFn?: typeof publishRollbackStashDraft
  discardRollbackStashDraftFn?: typeof discardRollbackStashDraft
}

export type PersistClaudeAgentSdkAssistantResponseResult = {
  persistence: ClaudeAgentSdkAssistantPersistence
  rollbackStashCreated: boolean
  committed: boolean
}

function withRollbackCheckpointMetadata(
  metadata: unknown,
  checkpoint: RollbackCheckpointBinding | null,
): Record<string, unknown> {
  const metadataRecord =
    typeof metadata === "object" &&
    metadata !== null &&
    !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {}
  const {
    rollbackCheckpointAvailable: _ignoredAvailability,
    rollbackCheckpointRef: _ignoredRef,
    rollbackCheckpointOid: _ignoredOid,
    ...runtimeMetadata
  } = metadataRecord
  if (!checkpoint) {
    return {
      ...runtimeMetadata,
      rollbackCheckpointAvailable: false,
    }
  }
  return {
    ...runtimeMetadata,
    rollbackCheckpointAvailable: true,
    rollbackCheckpointRef: checkpoint.ref,
    rollbackCheckpointOid: checkpoint.oid,
  }
}

function bindRollbackCheckpointToAssistantPersistence(
  persistence: ClaudeAgentSdkAssistantPersistence,
  checkpoint: RollbackCheckpointBinding | null,
): ClaudeAgentSdkAssistantPersistence {
  if (!persistence.assistantMessage) return persistence
  const assistantMessage = {
    ...persistence.assistantMessage,
    metadata: withRollbackCheckpointMetadata(
      persistence.assistantMessage.metadata,
      checkpoint,
    ),
  }
  return {
    ...persistence,
    assistantMessage,
    messages: [...persistence.messages.slice(0, -1), assistantMessage],
  }
}

export function prepareClaudeAgentSdkAssistantPersistence({
  messagesToSave,
  parts,
  metadata,
  createId = randomUUID,
  now = () => new Date(),
}: PrepareClaudeAgentSdkAssistantPersistenceInput): ClaudeAgentSdkAssistantPersistence {
  const sessionId = metadata?.sessionId ?? null
  if (parts.length === 0) {
    return {
      assistantMessage: null,
      messages: messagesToSave,
      sessionId,
    }
  }

  const assistantMessage = {
    id: createId(),
    role: "assistant",
    createdAt: now().toISOString(),
    parts,
    metadata: withRollbackCheckpointMetadata(metadata, null),
  }

  return {
    assistantMessage,
    messages: [...messagesToSave, assistantMessage],
    sessionId,
  }
}

export function shouldCreateClaudeAgentSdkRollbackStash(input: {
  historyEnabled: boolean
  metadata: any
  cwd?: string | null
}): input is {
  historyEnabled: true
  metadata: { sdkMessageUuid: string }
  cwd: string
} {
  return Boolean(
    input.historyEnabled && input.metadata?.sdkMessageUuid && input.cwd,
  )
}

export async function persistClaudeAgentSdkAssistantResponse({
  db,
  chatId,
  subChatId,
  activeSessionSignal,
  messagesToSave,
  parts,
  metadata,
  secretHints,
  historyEnabled,
  cwd,
  clearStreamWhenEmpty = true,
  touchChatWhenEmpty = true,
  createId,
  now = () => new Date(),
  createRollbackStashDraftFn = createRollbackStashDraft,
  publishRollbackStashDraftFn = publishRollbackStashDraft,
  discardRollbackStashDraftFn = discardRollbackStashDraft,
}: PersistClaudeAgentSdkAssistantResponseInput): Promise<PersistClaudeAgentSdkAssistantResponseResult> {
  const redactedInput = redactRuntimePayload(
    {
      messagesToSave,
      parts,
      metadata,
    } as JsonValue,
    {
      runtimeId: "claude-code",
      runId: `claude-message-persistence:${subChatId}`,
      source: "desktop-adapter",
      secretHints,
    },
  ).payload as {
    messagesToSave: typeof messagesToSave
    parts: typeof parts
    metadata: typeof metadata
  }
  let persistence = prepareClaudeAgentSdkAssistantPersistence({
    messagesToSave: redactedInput.messagesToSave,
    parts: redactedInput.parts,
    metadata: redactedInput.metadata,
    createId,
    now,
  })
  const updatedAt = now()
  const staleResult = (): PersistClaudeAgentSdkAssistantResponseResult => ({
    persistence: bindRollbackCheckpointToAssistantPersistence(
      persistence,
      null,
    ),
    rollbackStashCreated: false,
    committed: false,
  })

  if (!isActiveClaudeSessionSignal(subChatId, activeSessionSignal)) {
    return staleResult()
  }

  let rollbackDraft: RollbackStashDraft | null = null
  let publishedCheckpoint: RollbackCheckpointBinding | null = null
  let assistantCommitted = false
  try {
    if (
      persistence.assistantMessage &&
      shouldCreateClaudeAgentSdkRollbackStash({
        historyEnabled,
        metadata: redactedInput.metadata,
        cwd,
      })
    ) {
      const rollbackCwd = cwd
      const sdkMessageUuid = redactedInput.metadata.sdkMessageUuid
      if (
        typeof rollbackCwd === "string" &&
        typeof sdkMessageUuid === "string"
      ) {
        rollbackDraft = await createRollbackStashDraftFn(
          rollbackCwd,
          sdkMessageUuid,
        )
        if (!isActiveClaudeSessionSignal(subChatId, activeSessionSignal)) {
          return staleResult()
        }
        if (rollbackDraft) {
          publishedCheckpoint = await publishRollbackStashDraftFn(rollbackDraft)
          if (!isActiveClaudeSessionSignal(subChatId, activeSessionSignal)) {
            return staleResult()
          }
        }
      }
    }

    persistence = bindRollbackCheckpointToAssistantPersistence(
      persistence,
      publishedCheckpoint,
    )
    if (!isActiveClaudeSessionSignal(subChatId, activeSessionSignal)) {
      return staleResult()
    }

    if (persistence.assistantMessage) {
      db.transaction((tx: typeof db) => {
        tx.update(subChats)
          .set({
            messages: JSON.stringify(persistence.messages),
            sessionId: persistence.sessionId,
            streamId: null,
            updatedAt,
          })
          .where(eq(subChats.id, subChatId))
          .run()
        tx.update(chats).set({ updatedAt }).where(eq(chats.id, chatId)).run()
      })
      assistantCommitted = true
    } else if (clearStreamWhenEmpty) {
      db.transaction((tx: typeof db) => {
        tx.update(subChats)
          .set({
            sessionId: persistence.sessionId,
            streamId: null,
            updatedAt,
          })
          .where(eq(subChats.id, subChatId))
          .run()

        if (touchChatWhenEmpty) {
          tx.update(chats).set({ updatedAt }).where(eq(chats.id, chatId)).run()
        }
      })
    }

    return {
      persistence,
      rollbackStashCreated: publishedCheckpoint !== null,
      committed: true,
    }
  } finally {
    if (rollbackDraft) {
      if (assistantCommitted) {
        await discardRollbackStashDraftFn(rollbackDraft)
      } else {
        await discardRollbackStashDraftFn(rollbackDraft, {
          publishedCheckpoint,
        })
      }
    }
  }
}
