// ---------------------------------------------------------------------------
// Committed-record renderer projection (refactor-canonical-run-event-ledger,
// design "Current Owner to Target Mapping").
//
// projectRunEventToRendererChunks is a pure forward projection of one
// committed, already redacted ledger record into renderer chunks. It never
// allocates sequences, never redacts, never reconstructs a terminal and never
// appends a reconciled item's final text as another delta: an
// item_reconciliation record replaces the item through a data chunk. Coarse
// desktop stream input is decoded by agent-runtime/ledger-ingress.ts; this
// module only projects what the ledger committed.
// ---------------------------------------------------------------------------

export type RendererProjectionChunk = Record<string, unknown> & { type: string }

/** Payload members the ledger adds for its own bookkeeping. */
const LEDGER_BOOKKEEPING_KEYS = new Set([
  "chunkType",
  "subtype",
  "item",
  "redactionPending",
  "extensions",
  "classification",
])

function projectionRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function projectionItemId(
  record: Record<string, unknown>,
  payload: Record<string, unknown>,
): string {
  const item = projectionRecord(payload.item)
  for (const candidate of [
    payload.id,
    item?.itemId,
    item?.correlationKey,
    payload.toolCallId,
  ]) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate
  }
  return `sequence-${String(record.sequence)}`
}

function chunkFields(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(
      ([key]) => !LEDGER_BOOKKEEPING_KEYS.has(key),
    ),
  )
}

/** Tool chunk fields: the coarse decoder's default tool status is dropped. */
function toolFields(payload: Record<string, unknown>): Record<string, unknown> {
  const { status: _status, ...rest } = chunkFields(payload)
  return rest
}

function stringField(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = payload[key]
  return typeof value === "string" ? value : undefined
}

function codexIds(payload: Record<string, unknown>): Record<string, unknown> {
  const extensions = projectionRecord(payload.extensions)
  return projectionRecord(extensions?.["runtime.codex.v1"]) ?? {}
}

function codexMessageMetadata(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const ids = codexIds(payload)
  const last = projectionRecord(payload.last) ?? {}
  const total = projectionRecord(payload.total) ?? {}
  return {
    provider: "codex",
    adapterSource: "codex-app-server",
    threadId: ids.threadId ?? null,
    turnId: ids.turnId ?? null,
    inputTokens: last.inputTokens,
    outputTokens: last.outputTokens,
    totalTokens: last.totalTokens,
    cacheReadInputTokens: last.cachedInputTokens,
    cachedInputTokens: last.cachedInputTokens,
    reasoningOutputTokens: last.reasoningOutputTokens,
    cumulativeInputTokens: total.inputTokens,
    cumulativeOutputTokens: total.outputTokens,
    cumulativeTotalTokens: total.totalTokens,
    modelContextWindow: payload.modelContextWindow ?? null,
  }
}

function projectStatus(
  committed: Record<string, unknown>,
  payload: Record<string, unknown>,
  id: string,
): RendererProjectionChunk[] {
  if (payload.subtype === "item_reconciliation") {
    return [
      {
        type: "data-item-reconciliation",
        id,
        data: {
          sequence: committed.sequence,
          item: payload.item ?? null,
          reconciliation: payload.reconciliation ?? null,
        },
      },
    ]
  }
  const chunkType = stringField(payload, "chunkType")
  if (payload.subtype === "desktop_stream" && chunkType) {
    return [{ ...chunkFields(payload), type: chunkType }]
  }
  if (payload.status === "runtime-status") {
    const { status: _status, ...rest } = chunkFields(payload)
    return [{ ...rest, type: "runtime-status" }]
  }
  if (
    payload.subtype === "thread_lifecycle" &&
    payload.method === "thread/started"
  ) {
    const ids = codexIds(payload)
    return [
      {
        type: "session-init",
        threadId: ids.threadId ?? null,
        sessionId: ids.sessionId ?? null,
        provider: "codex",
        adapterSource: "codex-app-server",
      },
    ]
  }
  if (
    payload.subtype === "turn_lifecycle" &&
    payload.method === "turn/started"
  ) {
    const ids = codexIds(payload)
    return [
      {
        type: "start-step",
        id: ids.turnId ?? id,
        threadId: ids.threadId ?? null,
        adapterSource: "codex-app-server",
      },
    ]
  }
  return []
}

function projectRecord(
  committed: Record<string, unknown>,
  payload: Record<string, unknown>,
): RendererProjectionChunk[] {
  const id = projectionItemId(committed, payload)
  const text =
    typeof payload.text === "string"
      ? payload.text
      : typeof payload.delta === "string"
        ? payload.delta
        : null
  const chunkType = stringField(payload, "chunkType")
  switch (committed.type) {
    case "assistant_delta":
      return text ? [{ type: "text-delta", id, delta: text }] : []
    case "reasoning_delta":
      return text
        ? [{ type: chunkType ?? "reasoning-delta", id, delta: text }]
        : []
    case "tool_started":
      return [
        { ...toolFields(payload), type: chunkType ?? "tool-input-available" },
      ]
    case "tool_delta": {
      if (chunkType !== "tool-input-delta") return []
      const { delta, ...rest } = toolFields(payload)
      return [
        { ...rest, type: "tool-input-delta", inputTextDelta: delta ?? "" },
      ]
    }
    case "tool_finished":
      return chunkType ? [{ ...toolFields(payload), type: chunkType }] : []
    case "permission_requested":
    case "question_pending":
    case "question_result":
      return chunkType ? [{ ...chunkFields(payload), type: chunkType }] : []
    case "guard_decision":
      return [{ type: "guard-event", event: payload.event ?? null }]
    case "error":
      return [
        {
          ...chunkFields(payload),
          type: chunkType ?? "error",
          errorText:
            stringField(payload, "errorText") ??
            stringField(payload, "message") ??
            "Runtime stream error",
        },
      ]
    case "usage_update":
      if (projectionRecord(payload.messageMetadata)) {
        return [
          {
            type: "message-metadata",
            messageMetadata: payload.messageMetadata,
          },
        ]
      }
      return payload.kind === "snapshot" && projectionRecord(payload.last)
        ? [
            {
              type: "message-metadata",
              messageMetadata: codexMessageMetadata(payload),
            },
          ]
        : []
    case "status":
    case "mcp_needs_auth":
      return projectStatus(committed, payload, id)
    default:
      return []
  }
}

/**
 * Projects one committed record into renderer chunks. Desktop coarse records
 * carry the chunk fields their stream decoder kept (ledger-ingress.ts);
 * native Codex records carry their redacted native identities. A record with
 * no renderer vocabulary projects to one `data-run-event` chunk.
 */
export function projectRunEventToRendererChunks(
  record: unknown,
): RendererProjectionChunk[] {
  const committed = projectionRecord(record)
  if (!committed || typeof committed.type !== "string") return []
  const payload = projectionRecord(committed.payload) ?? {}
  const projected = projectRecord(committed, payload)
  if (projected.length > 0 || committed.type === "assistant_delta") {
    return projected
  }
  return [
    {
      type: "data-run-event",
      id: `${String(committed.runId ?? committed.jobId ?? "run")}:${String(committed.sequence)}`,
      data: {
        sequence: committed.sequence,
        type: committed.type,
        payload,
      },
    },
  ]
}
