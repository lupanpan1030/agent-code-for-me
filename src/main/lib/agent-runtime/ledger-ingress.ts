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
