import {
  AGENT_JOB_EVENT_TYPES,
  type AgentJobEventType,
} from "../../../shared/agent-jobs"
import type { JsonValue } from "./runtime-events"

/**
 * Stateless ingress decoding for coarse runtime observations
 * (refactor-canonical-run-event-ledger, design "Current Owner to Target
 * Mapping": ledger-ingress.ts is stateless decode only).
 *
 * A coarse adapter (headless process runners, completion, desktop fallbacks)
 * submits `{ type, payload }` through `ledger.ingestRuntimeObservation`. This
 * module validates the internal vocabulary, refuses owner-gated types
 * (`completed` belongs to settle, `artifact_created` to the artifact owner,
 * `job_created`/`job_started` to host lifecycle facts) and describes which
 * text field is a stream fragment. It keeps no state and invents no native
 * identity: sequence, item correlation, usage accumulation and redaction are
 * owned by the ledger.
 */

export type JsonObject = { [key: string]: JsonValue }

export type CoarseStreamFragment = {
  /** Payload field carrying the stream text. */
  field: string
  /** Item channel of the fragment (design item key channels). */
  itemChannel: "assistant" | "text" | "tool"
  /** Stable stream-redaction channel within one Run. */
  streamChannel: string
}

export type CoarseUsageObservation = {
  /** Native message/call identity, when the runtime supplied one. */
  callId?: string
  revision?: number
  /** The call's usage vector (numeric members only). */
  vector: Record<string, number>
}

export type DecodedCoarseObservation =
  | {
      kind: "event"
      type: AgentJobEventType
      payload: JsonObject
      stream?: CoarseStreamFragment
      usage?: CoarseUsageObservation
    }
  | {
      kind: "rejected"
      reason: "owner_gated_type" | "host_lifecycle_type" | "unknown_type"
      type: string
    }

const OWNER_GATED_TYPES = new Set(["completed", "artifact_created"])
const HOST_LIFECYCLE_TYPES = new Set(["job_created", "job_started"])

function isJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function numericVector(value: unknown): Record<string, number> {
  const vector: Record<string, number> = {}
  if (!isJsonObject(value)) return vector
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number" && Number.isFinite(entry)) vector[key] = entry
  }
  return vector
}

function textField(payload: JsonObject, candidates: readonly string[]) {
  return candidates.find((key) => typeof payload[key] === "string")
}

function streamIdentity(payload: JsonObject, keys: readonly string[]): string {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return "default"
}

function toolStatusDefault(type: AgentJobEventType): string | null {
  if (type === "tool_started") return "started"
  if (type === "tool_delta") return "running"
  if (type === "tool_finished") return "completed"
  return null
}

/**
 * Decodes one coarse `{ type, payload }` observation. Pure: the result
 * depends only on the input, which is never mutated.
 */
export function decodeCoarseRuntimeObservation(input: {
  type: unknown
  payload?: unknown
}): DecodedCoarseObservation {
  const type = typeof input.type === "string" ? input.type : ""
  if (!(AGENT_JOB_EVENT_TYPES as readonly string[]).includes(type)) {
    return { kind: "rejected", reason: "unknown_type", type }
  }
  if (OWNER_GATED_TYPES.has(type)) {
    return { kind: "rejected", reason: "owner_gated_type", type }
  }
  if (HOST_LIFECYCLE_TYPES.has(type)) {
    return { kind: "rejected", reason: "host_lifecycle_type", type }
  }
  const eventType = type as AgentJobEventType
  const raw = toJsonValue(input.payload ?? {})
  const payload: JsonObject = isJsonObject(raw) ? raw : { value: raw }

  if (eventType === "assistant_delta" || eventType === "reasoning_delta") {
    const field = textField(payload, ["text", "delta"])
    const family = eventType === "assistant_delta" ? "assistant" : "reasoning"
    return {
      kind: "event",
      type: eventType,
      payload,
      ...(field
        ? {
            stream: {
              field,
              itemChannel:
                eventType === "assistant_delta" ? "assistant" : "text",
              streamChannel: `coarse:${family}:${streamIdentity(payload, ["messageId", "id"])}`,
            },
          }
        : {}),
    }
  }

  const statusDefault = toolStatusDefault(eventType)
  if (statusDefault) {
    const toolPayload =
      typeof payload.status === "string"
        ? payload
        : { ...payload, status: statusDefault }
    const field =
      eventType === "tool_delta"
        ? textField(toolPayload, ["delta", "text", "output", "message"])
        : undefined
    return {
      kind: "event",
      type: eventType,
      payload: toolPayload,
      ...(field
        ? {
            stream: {
              field,
              itemChannel: "tool",
              streamChannel: `coarse:tool:${streamIdentity(toolPayload, ["toolCallId", "id"])}`,
            },
          }
        : {}),
    }
  }

  if (eventType === "command_output" && typeof payload.text === "string") {
    return {
      kind: "event",
      type: eventType,
      payload,
      stream: {
        field: "text",
        itemChannel: "tool",
        streamChannel: `coarse:command:${streamIdentity(payload, ["stream"])}`,
      },
    }
  }

  if (eventType === "usage_update") {
    const callId =
      typeof payload.callId === "string" && payload.callId.length > 0
        ? payload.callId
        : undefined
    const revision =
      typeof payload.revision === "number" ? payload.revision : undefined
    return {
      kind: "event",
      type: eventType,
      payload,
      usage: {
        ...(callId ? { callId } : {}),
        ...(revision === undefined ? {} : { revision }),
        vector: numericVector(payload.usage ?? payload.last ?? payload),
      },
    }
  }

  return { kind: "event", type: eventType, payload }
}

// ---------------------------------------------------------------------------
// Desktop stream decode (refactor-canonical-run-event-ledger, design "Current
// Owner to Target Mapping": coarse input decode moves here from the retired
// stream-event-mapper chunk mapper).
//
// A desktop runtime's renderer-bound stream chunk is either a coarse runtime
// observation the Run's ledger commits (text/reasoning/tool/guard/question/
// status/error/usage chunks) or renderer framing/interaction with no durable
// fact (text/reasoning boundaries, finish, pending interaction prompts). The
// decode is stateless; it keeps the chunk fields the committed-record
// renderer projection needs (with `chunkType` where one record type carries
// several chunk kinds) and invents no native identity or terminal.
// ---------------------------------------------------------------------------

export type DecodedDesktopStreamChunk =
  | { kind: "observation"; type: AgentJobEventType; payload: JsonObject }
  | { kind: "renderer_only" }

const DESKTOP_STATUS_CHUNK_TYPES = new Set([
  "session-init",
  "start-step",
  "finish-step",
  "file-change-diff",
  "file-change-patch",
  "file-change-delta",
  "retry-notification",
])

function chunkPayload(chunk: JsonObject): JsonObject {
  const { type: _type, ...rest } = chunk
  return rest
}

/** Decodes one desktop renderer-bound stream chunk. Pure. */
export function decodeDesktopStreamChunk(
  chunk: unknown,
): DecodedDesktopStreamChunk {
  const raw = toJsonValue(chunk)
  if (!isJsonObject(raw) || typeof raw.type !== "string") {
    return { kind: "renderer_only" }
  }
  const chunkType = raw.type
  const fields = chunkPayload(raw)
  switch (chunkType) {
    case "text-delta":
      return {
        kind: "observation",
        type: "assistant_delta",
        payload: {
          ...(typeof fields.id === "string" ? { id: fields.id } : {}),
          delta: typeof fields.delta === "string" ? fields.delta : "",
        },
      }
    case "reasoning":
    case "reasoning-delta":
      return {
        kind: "observation",
        type: "reasoning_delta",
        payload: {
          ...(typeof fields.id === "string" ? { id: fields.id } : {}),
          delta:
            typeof fields.delta === "string"
              ? fields.delta
              : typeof fields.text === "string"
                ? fields.text
                : "",
          chunkType,
        },
      }
    case "tool-input-start":
    case "tool-input-available":
      return {
        kind: "observation",
        type: "tool_started",
        payload: { ...fields, chunkType },
      }
    case "tool-input-delta": {
      const { inputTextDelta, ...rest } = fields
      return {
        kind: "observation",
        type: "tool_delta",
        payload: {
          ...rest,
          delta: typeof inputTextDelta === "string" ? inputTextDelta : "",
          chunkType,
        },
      }
    }
    case "tool-output-available":
    case "tool-output-error":
      return {
        kind: "observation",
        type: "tool_finished",
        payload: { ...fields, chunkType },
      }
    case "guard-event":
      return {
        kind: "observation",
        type: "guard_decision",
        payload: { event: fields.event ?? null },
      }
    case "observed-tool-decision":
      return {
        kind: "observation",
        type: "permission_requested",
        payload: { ...fields, chunkType },
      }
    case "ask-user-question":
      return {
        kind: "observation",
        type: "question_pending",
        payload: { ...fields, chunkType },
      }
    case "ask-user-question-timeout":
    case "ask-user-question-result":
      return {
        kind: "observation",
        type: "question_result",
        payload: { ...fields, chunkType },
      }
    case "runtime-status": {
      const blocker = isJsonObject(fields.blocker) ? fields.blocker : null
      const mcpNeedsAuth = blocker?.component === "mcp" && fields.ok === false
      return {
        kind: "observation",
        type: mcpNeedsAuth ? "mcp_needs_auth" : "status",
        payload: { ...fields, status: "runtime-status" },
      }
    }
    case "error":
    case "auth-error":
    case "capability-error":
      return {
        kind: "observation",
        type: "error",
        payload: {
          ...fields,
          errorText:
            typeof fields.errorText === "string"
              ? fields.errorText
              : typeof fields.message === "string"
                ? fields.message
                : "Runtime stream error",
          chunkType,
        },
      }
    case "message-metadata":
      return {
        kind: "observation",
        type: "usage_update",
        payload: { messageMetadata: fields.messageMetadata ?? null },
      }
    default:
      if (DESKTOP_STATUS_CHUNK_TYPES.has(chunkType)) {
        return {
          kind: "observation",
          type: "status",
          payload: { ...fields, subtype: "desktop_stream", chunkType },
        }
      }
      return { kind: "renderer_only" }
  }
}
