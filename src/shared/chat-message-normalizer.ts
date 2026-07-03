import { normalizeAcpParts } from "./acp-tool-normalizer"
import type {
  CanonicalChatMessage,
  CanonicalChatMessagePart,
} from "./chat-message"
import { normalizeCodexToolPart } from "./codex-tool-normalizer"

type AnyRecord = Record<string, any>

type ParseFailure = {
  error: unknown
  rawMessages: unknown
}

type PersistedMessagesParseResult =
  | { ok: true; messages: unknown[] }
  | { ok: false; failure: ParseFailure }

export type NormalizePersistedChatMessagesOptions = {
  sourceId?: string
  onParseError?: (error: unknown, sourceId?: string) => void
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function parseObjectJson(value: string): AnyRecord | null {
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parsePersistedMessages(
  rawMessages: unknown,
  options?: NormalizePersistedChatMessagesOptions,
): PersistedMessagesParseResult {
  if (Array.isArray(rawMessages)) return { ok: true, messages: rawMessages }
  if (!rawMessages) return { ok: true, messages: [] }

  if (typeof rawMessages !== "string") return { ok: true, messages: [] }

  try {
    const parsed = JSON.parse(rawMessages)
    if (Array.isArray(parsed)) return { ok: true, messages: parsed }
    const error = new Error("Persisted messages JSON did not contain an array.")
    options?.onParseError?.(error, options.sourceId)
    return { ok: false, failure: { error, rawMessages } }
  } catch (error) {
    options?.onParseError?.(error, options.sourceId)
    return { ok: false, failure: { error, rawMessages } }
  }
}

function sourceSegment(sourceId: string | undefined): string {
  return (sourceId || "unknown")
    .trim()
    .replace(/[^A-Za-z0-9_.:-]/g, "_")
    .slice(0, 120) || "unknown"
}

function parseFailureMessage(
  failure: ParseFailure,
  options?: NormalizePersistedChatMessagesOptions,
): CanonicalChatMessage[] {
  const source = sourceSegment(options?.sourceId)
  const errorMessage =
    failure.error instanceof Error ? failure.error.message : String(failure.error)

  return [
    {
      id: `parse-failure-${source}`,
      role: "assistant",
      metadata: {
        parseFailure: true,
        parseFailureSourceId: options?.sourceId,
        parseFailureError: errorMessage,
        rawPersistedMessages: failure.rawMessages,
      },
      parts: [
        {
          type: "text",
          text: "消息解析失败。原始聊天数据仍保留在本地数据库中，未被删除。",
        },
      ],
    } as CanonicalChatMessage,
  ]
}

function normalizeLegacyToolInvocationPart(part: AnyRecord): AnyRecord | null {
  if (part.type !== "tool-invocation" || !part.toolName) return null

  return {
    ...part,
    type: `tool-${part.toolName}`,
    toolCallId: part.toolCallId || part.toolInvocationId,
    input: part.input || part.args,
  }
}

function normalizeToolStateAndOutput(part: AnyRecord): AnyRecord {
  if (!asString(part.type).startsWith("tool-") || !part.state) return part

  let normalizedState = part.state
  if (part.state === "result") {
    normalizedState =
      part.result?.success === false ? "output-error" : "output-available"
  }

  return {
    ...part,
    state: normalizedState,
    output: part.output || part.result,
  }
}

function isCodexMcpWrapperPart(part: AnyRecord): boolean {
  return (
    asString(part.type).startsWith("tool-Tool:") ||
    asString(part.toolName).startsWith("Tool:") ||
    asString(part.input?.toolName).startsWith("Tool:")
  )
}

function normalizeCodexMcpWrapperPart(part: AnyRecord): AnyRecord | null {
  if (!isCodexMcpWrapperPart(part)) return null

  const normalizedMcpPart = normalizeCodexToolPart(
    part as CanonicalChatMessagePart,
  ) as AnyRecord
  if (normalizedMcpPart === part) return null
  if (normalizedMcpPart.state) {
    return normalizeToolStateAndOutput(normalizedMcpPart)
  }
  return normalizedMcpPart
}

function isAcpToolPart(part: AnyRecord): boolean {
  const type = asString(part.type)
  return (
    type.startsWith("tool-") &&
    (part.input?.toolName ||
      type.includes(" ") ||
      type === "tool-acp.acp_provider_agent_dynamic_tool")
  )
}

function normalizeAcpHydrationPart(part: AnyRecord): AnyRecord | null {
  if (!isAcpToolPart(part)) return null

  const inputForSharedPrimitive =
    typeof part.input === "string"
      ? parseObjectJson(part.input) ?? part.input
      : part.input
  const candidate =
    inputForSharedPrimitive !== part.input
      ? { ...part, input: inputForSharedPrimitive }
      : part
  const normalized = normalizeAcpParts([
    candidate as CanonicalChatMessagePart,
  ])[0] as AnyRecord
  if (normalized === candidate) return null

  const outputWasAddedAsUndefined =
    normalized.output === undefined &&
    !Object.prototype.hasOwnProperty.call(part, "output")
  const normalizedPart = outputWasAddedAsUndefined
    ? { ...normalized }
    : normalized
  if (outputWasAddedAsUndefined) {
    delete normalizedPart.output
  }

  if (normalizedPart.state) {
    return normalizeToolStateAndOutput(normalizedPart)
  }
  return normalizedPart
}

export function normalizePersistedChatMessagePart(
  part: unknown,
): CanonicalChatMessagePart {
  if (!isRecord(part)) return part as CanonicalChatMessagePart

  const legacyToolPart = normalizeLegacyToolInvocationPart(part)
  if (legacyToolPart) return legacyToolPart as CanonicalChatMessagePart

  const codexMcpPart = normalizeCodexMcpWrapperPart(part)
  if (codexMcpPart) return codexMcpPart as CanonicalChatMessagePart

  const acpPart = normalizeAcpHydrationPart(part)
  if (acpPart) return acpPart as CanonicalChatMessagePart

  return normalizeToolStateAndOutput(part) as CanonicalChatMessagePart
}

export function normalizePersistedChatMessage(
  message: unknown,
): CanonicalChatMessage {
  if (!isRecord(message)) return message as CanonicalChatMessage
  if (!Array.isArray(message.parts)) return message as CanonicalChatMessage

  return {
    ...message,
    parts: message.parts.map(normalizePersistedChatMessagePart),
  } as CanonicalChatMessage
}

export function normalizePersistedChatMessages(
  rawMessages: unknown,
  options?: NormalizePersistedChatMessagesOptions,
): CanonicalChatMessage[] {
  const parsed = parsePersistedMessages(rawMessages, options)
  if (!parsed.ok) return parseFailureMessage(parsed.failure, options)
  return parsed.messages.map(normalizePersistedChatMessage)
}
