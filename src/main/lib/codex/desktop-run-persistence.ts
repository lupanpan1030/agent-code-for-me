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

export function buildCodexAppServerAssistantMessage(input: {
  chunks: Record<string, unknown>[]
  model: string
  generateMessageId: () => string
  now?: () => Date
}): unknown | null {
  const text = input.chunks
    .filter((chunk) => chunk?.type === "text-delta")
    .map((chunk) => (typeof chunk.delta === "string" ? chunk.delta : ""))
    .join("")
  const metadataChunks = input.chunks.flatMap((chunk) =>
    chunk.type === "message-metadata" && isRecord(chunk.messageMetadata)
      ? [chunk.messageMetadata]
      : [],
  )
  const finishMetadata = [...input.chunks]
    .reverse()
    .flatMap((chunk) =>
      chunk.type === "finish" && isRecord(chunk.messageMetadata)
        ? [chunk.messageMetadata]
        : [],
    )
    .at(0)
  const metadata = {
    ...metadataChunks.at(-1),
    ...(finishMetadata || {}),
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
  chunks: Record<string, unknown>[]
  model: string
  createId?: () => string
  now?: () => Date
  dependencies?: Partial<CodexDesktopRunPersistenceDependencies>
}): boolean {
  const assistantMessage = buildCodexAppServerAssistantMessage({
    chunks: input.chunks,
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
