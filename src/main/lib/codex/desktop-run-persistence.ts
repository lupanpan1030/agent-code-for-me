import { eq } from "drizzle-orm"
import { normalizeCodexStreamChunk } from "../../../shared/codex-tool-normalizer"
import type { getDatabase } from "../db"
import { subChats } from "../db"
import { type ActiveCodexStream, getActiveCodexStream } from "./active-streams"
import {
  buildCodexUserParts,
  codexImageAttachmentSignatureFromInput,
  codexImageAttachmentSignatureFromParts,
  codexLongTextAttachmentSignatureFromInput,
  codexLongTextAttachmentSignatureFromParts,
  extractCodexPromptFromStoredMessage,
  parseCodexStoredMessages,
} from "./chat-history"
import type { CodexChatInput } from "./chat-input-schema"

export type CodexDesktopRunPersistenceDatabase = Pick<
  ReturnType<typeof getDatabase>,
  "select" | "update"
>

type CodexDesktopRunMessageInput = Pick<
  CodexChatInput,
  "images" | "longTextAttachments" | "prompt"
>

type CodexDesktopRunPersistenceDependencies = {
  getActiveStream: typeof getActiveCodexStream
}

const defaultDependencies: CodexDesktopRunPersistenceDependencies = {
  getActiveStream: getActiveCodexStream,
}

function isAuthoritativeWritableCodexStream(input: {
  subChatId: string
  activeStreamOwner: ActiveCodexStream
  dependencies: CodexDesktopRunPersistenceDependencies
}): boolean {
  return (
    input.dependencies.getActiveStream(input.subChatId) ===
      input.activeStreamOwner &&
    !input.activeStreamOwner.controller.signal.aborted
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function loadCodexDesktopRunHistory(input: {
  db: CodexDesktopRunPersistenceDatabase
  subChatId: string
}): unknown[] {
  const existingSubChat = input.db
    .select()
    .from(subChats)
    .where(eq(subChats.id, input.subChatId))
    .get()

  if (!existingSubChat) {
    throw new Error("Sub-chat not found")
  }

  return parseCodexStoredMessages(existingSubChat.messages)
}

export function isDuplicateCodexDesktopRunPrompt(
  existingMessages: unknown[],
  input: CodexDesktopRunMessageInput,
): boolean {
  const lastMessage = existingMessages[existingMessages.length - 1]
  if (!isRecord(lastMessage)) return false
  const lastMessageParts = Array.isArray(lastMessage.parts)
    ? lastMessage.parts
    : undefined
  return (
    lastMessage?.role === "user" &&
    extractCodexPromptFromStoredMessage(lastMessage) === input.prompt &&
    codexLongTextAttachmentSignatureFromParts(lastMessageParts) ===
      codexLongTextAttachmentSignatureFromInput(input.longTextAttachments) &&
    codexImageAttachmentSignatureFromParts(lastMessageParts) ===
      codexImageAttachmentSignatureFromInput(input.images)
  )
}

export function buildCodexDesktopRunUserMessage(input: {
  prompt: string
  images: CodexChatInput["images"]
  longTextAttachments: CodexChatInput["longTextAttachments"]
  metadataModel: string
  createId?: () => string
  now?: () => Date
}): Record<string, unknown> {
  const createId = input.createId ?? (() => crypto.randomUUID())
  const now = input.now ?? (() => new Date())
  return {
    id: createId(),
    role: "user",
    createdAt: now().toISOString(),
    parts: buildCodexUserParts(
      input.prompt,
      input.images,
      input.longTextAttachments,
    ),
    metadata: { model: input.metadataModel, provider: "codex" },
  }
}

export function persistCodexDesktopRunUserMessage(input: {
  db: CodexDesktopRunPersistenceDatabase
  subChatId: string
  activeStreamOwner: ActiveCodexStream
  existingMessages: unknown[]
  prompt: string
  images: CodexChatInput["images"]
  longTextAttachments: CodexChatInput["longTextAttachments"]
  metadataModel: string
  createId?: () => string
  now?: () => Date
  dependencies?: Partial<CodexDesktopRunPersistenceDependencies>
}): {
  authoritative: boolean
  isDuplicatePrompt: boolean
  messagesForStream: unknown[]
} {
  const isDuplicatePrompt = isDuplicateCodexDesktopRunPrompt(
    input.existingMessages,
    input,
  )
  const dependencies = { ...defaultDependencies, ...input.dependencies }
  if (isDuplicatePrompt) {
    return {
      authoritative: isAuthoritativeWritableCodexStream({
        subChatId: input.subChatId,
        activeStreamOwner: input.activeStreamOwner,
        dependencies,
      }),
      isDuplicatePrompt,
      messagesForStream: input.existingMessages,
    }
  }

  const userMessage = buildCodexDesktopRunUserMessage(input)
  const messagesForStream = [...input.existingMessages, userMessage]
  const now = input.now ?? (() => new Date())

  if (
    !isAuthoritativeWritableCodexStream({
      subChatId: input.subChatId,
      activeStreamOwner: input.activeStreamOwner,
      dependencies,
    })
  ) {
    return {
      authoritative: false,
      isDuplicatePrompt,
      messagesForStream: input.existingMessages,
    }
  }
  input.db
    .update(subChats)
    .set({
      messages: JSON.stringify(messagesForStream),
      updatedAt: now(),
    })
    .where(eq(subChats.id, input.subChatId))
    .run()

  return { authoritative: true, isDuplicatePrompt, messagesForStream }
}

type CommittedRunRecord = {
  sequence?: unknown
  type?: unknown
  payload?: unknown
}

/**
 * Assistant text of one Run from its committed records (design: history uses
 * the committed item projection, not raw text-delta joins): each assistant
 * item's authoritative final text from its item_reconciliation replaces the
 * streamed deltas of that item.
 */
export function committedCodexAssistantText(
  records: readonly CommittedRunRecord[],
): string {
  const order: string[] = []
  const texts = new Map<string, string>()
  const itemKey = (payload: Record<string, unknown>): string | null => {
    const item = isRecord(payload.item) ? payload.item : null
    if (!item) return null
    const identity =
      typeof item.itemId === "string"
        ? `${String(item.threadId)}:${String(item.turnId)}:${item.itemId}`
        : typeof item.correlationKey === "string"
          ? item.correlationKey
          : null
    return identity
  }
  for (const record of records) {
    const payload = isRecord(record.payload) ? record.payload : {}
    const key = itemKey(payload)
    if (!key) continue
    if (record.type === "assistant_delta") {
      const delta =
        typeof payload.text === "string"
          ? payload.text
          : typeof payload.delta === "string"
            ? payload.delta
            : ""
      if (!texts.has(key)) order.push(key)
      texts.set(key, `${texts.get(key) ?? ""}${delta}`)
      continue
    }
    const item = isRecord(payload.item) ? payload.item : {}
    if (
      record.type === "status" &&
      payload.subtype === "item_reconciliation" &&
      item.channel === "assistant" &&
      typeof item.text === "string"
    ) {
      if (!texts.has(key)) order.push(key)
      texts.set(key, item.text)
    }
  }
  return order.map((key) => texts.get(key) ?? "").join("")
}

export function buildCodexAppServerAssistantMessage(input: {
  records: readonly CommittedRunRecord[]
  metadata?: Record<string, unknown> | null
  model: string
  generateMessageId: () => string
  now?: () => Date
}): unknown | null {
  const text = committedCodexAssistantText(input.records)
  const metadata = {
    ...(input.metadata ?? {}),
    model: input.model,
    provider: "codex",
  }

  if (!text.trim()) return null

  return normalizeCodexStreamChunk({
    id: input.generateMessageId(),
    role: "assistant",
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    parts: [{ type: "text", text }],
    metadata,
  })
}

export function persistCodexDesktopAssistantAfterNaturalFinish(input: {
  db: CodexDesktopRunPersistenceDatabase
  subChatId: string
  activeStreamOwner: ActiveCodexStream
  messagesForStream: unknown[]
  records: readonly CommittedRunRecord[]
  metadata?: Record<string, unknown> | null
  model: string
  createId?: () => string
  now?: () => Date
  dependencies?: Partial<CodexDesktopRunPersistenceDependencies>
}): boolean {
  const assistantMessage = buildCodexAppServerAssistantMessage({
    records: input.records,
    metadata: input.metadata,
    model: input.model,
    generateMessageId: input.createId ?? (() => crypto.randomUUID()),
    now: input.now,
  })
  if (!assistantMessage) return false

  const dependencies = { ...defaultDependencies, ...input.dependencies }
  if (
    !isAuthoritativeWritableCodexStream({
      subChatId: input.subChatId,
      activeStreamOwner: input.activeStreamOwner,
      dependencies,
    })
  ) {
    return false
  }

  const now = input.now ?? (() => new Date())
  input.db
    .update(subChats)
    .set({
      messages: JSON.stringify([...input.messagesForStream, assistantMessage]),
      updatedAt: now(),
    })
    .where(eq(subChats.id, input.subChatId))
    .run()
  return true
}
