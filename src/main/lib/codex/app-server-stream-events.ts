// Codex app-server native boundary decoding (refactor-canonical-run-event-
// ledger, design "Current Owner to Target Mapping"): this module is stateless.
// The former stateful runtime-event mapper (thread/session/turn/tokenUsage
// state, renderer chunk mapping and the interrupt request builder) is removed;
// the Run's ledger owns native context and the committed-record renderer
// projection lives in agent-runtime/stream-event-mapper.ts.

// ---------------------------------------------------------------------------
// Stateless native boundary decoder (refactor-canonical-run-event-ledger).
//
// decodeCodexNativeBoundary maps one Codex app-server boundary (notification,
// server request, response-send or resolved) to fixture-shaped observation
// descriptors `{kind, native, channel?, partIndex?, text?, fields?, total?,
// last?, code?, willRetry?}` following the pinned 66 notification / 10 server
// request / 16 ThreadItem disposition table. It owns no sequence, outcome,
// usage or session/thread/turn state: the output depends only on the input,
// and a part index is forwarded only when the native payload carries one.
// Redaction, correlation, reconciliation and sequencing belong to the ledger.
// ---------------------------------------------------------------------------

export type CodexNativeIds = {
  threadId?: string
  sessionId?: string
  turnId?: string
  itemId?: string
  requestId?: string | number
  callId?: string
}

export type CodexNativeDescriptor = {
  kind: string
  method?: string
  native: CodexNativeIds
  channel?: "assistant" | "text" | "summary" | "tool"
  partIndex?: number
  text?: string
  fields?: Record<string, unknown>
  total?: Record<string, number>
  last?: Record<string, number>
  code?: string | number
  willRetry?: boolean
  boundary?: "request" | "response_send" | "resolved"
  requestId?: string | number
  sendResult?: "sent" | "failed"
}

/** Status subtype for every non-domain notification of the pinned table. */
export const CODEX_NOTIFICATION_STATUS_SUBTYPES: Readonly<
  Record<string, string>
> = {
  "account/login/completed": "oauth_lifecycle",
  "mcpServer/oauthLogin/completed": "oauth_lifecycle",
  "account/rateLimits/updated": "account_lifecycle",
  "account/updated": "account_lifecycle",
  "app/list/updated": "configuration",
  "externalAgentConfig/import/completed": "configuration",
  "skills/changed": "configuration",
  "command/exec/outputDelta": "runtime_process",
  "process/outputDelta": "runtime_process",
  "process/exited": "runtime_process",
  configWarning: "warning",
  deprecationNotice: "warning",
  guardianWarning: "warning",
  warning: "warning",
  "fs/changed": "workspace_observation",
  "fuzzyFileSearch/sessionCompleted": "workspace_observation",
  "fuzzyFileSearch/sessionUpdated": "workspace_observation",
  "hook/completed": "hook_lifecycle",
  "hook/started": "hook_lifecycle",
  "item/autoApprovalReview/completed": "approval_review",
  "item/autoApprovalReview/started": "approval_review",
  "item/plan/delta": "plan",
  "turn/plan/updated": "plan",
  "item/reasoning/summaryPartAdded": "reasoning_part",
  "mcpServer/startupStatus/updated": "mcp_lifecycle",
  "model/rerouted": "reroute",
  "model/verification": "model_verification",
  "turn/moderationMetadata": "model_verification",
  "rawResponseItem/completed": "raw_response_observed",
  "remoteControl/status/changed": "unsupported_native_surface",
  "windows/worldWritableWarning": "unsupported_native_surface",
  "windowsSandbox/setupCompleted": "unsupported_native_surface",
  "thread/realtime/closed": "unsupported_native_surface",
  "thread/realtime/error": "unsupported_native_surface",
  "thread/realtime/itemAdded": "unsupported_native_surface",
  "thread/realtime/outputAudio/delta": "unsupported_native_surface",
  "thread/realtime/sdp": "unsupported_native_surface",
  "thread/realtime/started": "unsupported_native_surface",
  "thread/realtime/transcript/delta": "unsupported_native_surface",
  "thread/realtime/transcript/done": "unsupported_native_surface",
  "thread/archived": "thread_lifecycle",
  "thread/closed": "thread_lifecycle",
  "thread/goal/cleared": "thread_lifecycle",
  "thread/goal/updated": "thread_lifecycle",
  "thread/name/updated": "thread_lifecycle",
  "thread/settings/updated": "thread_lifecycle",
  "thread/started": "thread_lifecycle",
  "thread/status/changed": "thread_lifecycle",
  "thread/unarchived": "thread_lifecycle",
  "thread/compacted": "compaction",
  "turn/diff/updated": "diff_observation",
  "turn/started": "turn_lifecycle",
}

/** Notifications decoded to domain events or item/terminal/boundary kinds. */
export const CODEX_NOTIFICATION_DOMAIN_KINDS: Readonly<Record<string, string>> =
  {
    error: "error",
    "item/agentMessage/delta": "assistant_delta",
    "item/reasoning/summaryTextDelta": "reasoning_delta",
    "item/reasoning/textDelta": "reasoning_delta",
    "item/commandExecution/outputDelta": "tool_delta",
    "item/commandExecution/terminalInteraction": "tool_delta",
    "item/fileChange/outputDelta": "tool_delta",
    "item/fileChange/patchUpdated": "tool_delta",
    "item/mcpToolCall/progress": "tool_delta",
    "item/started": "item_started",
    "item/completed": "item_completed",
    "serverRequest/resolved": "interaction_boundary",
    "thread/tokenUsage/updated": "usage_update",
    "turn/completed": "terminal_candidate",
  }

/** The 10 pinned server request methods (status/interaction_boundary). */
export const CODEX_SERVER_REQUEST_METHODS: readonly string[] = [
  "account/chatgptAuthTokens/refresh",
  "applyPatchApproval",
  "attestation/generate",
  "execCommandApproval",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/call",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
]

/** ThreadItem variant -> disposition (tool items share the tool channel). */
export const CODEX_THREAD_ITEM_DISPOSITIONS: Readonly<
  Record<string, "assistant" | "reasoning" | "tool" | string>
> = {
  agentMessage: "assistant",
  reasoning: "reasoning",
  commandExecution: "tool",
  mcpToolCall: "tool",
  dynamicToolCall: "tool",
  collabAgentToolCall: "tool",
  webSearch: "tool",
  imageView: "tool",
  imageGeneration: "tool",
  fileChange: "tool",
  contextCompaction: "compaction",
  enteredReviewMode: "review_mode",
  exitedReviewMode: "review_mode",
  hookPrompt: "hook_lifecycle",
  plan: "plan",
  userMessage: "user_message",
}

const OBSERVED_DEFERRED_SURFACES: Readonly<Record<string, string>> = {
  "remoteControl/status/changed": "remote_control",
  "windows/worldWritableWarning": "windows",
  "windowsSandbox/setupCompleted": "windows",
}

type DecoderRecord = Record<string, unknown>

function asDecoderRecord(value: unknown): DecoderRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as DecoderRecord)
    : null
}

function stringField(record: DecoderRecord | null, key: string) {
  const value = record?.[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function indexField(record: DecoderRecord | null, key: string) {
  const value = record?.[key]
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined
}

function scalarFields(
  record: DecoderRecord | null,
  keys: readonly string[],
): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const key of keys) {
    const value = record?.[key]
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      fields[key] = value
    }
  }
  return fields
}

function nativeIds(
  params: DecoderRecord | null,
  extra: CodexNativeIds = {},
): CodexNativeIds {
  const ids: CodexNativeIds = {}
  const threadId =
    stringField(params, "threadId") ?? stringField(params, "conversationId")
  const turnId = stringField(params, "turnId")
  const itemId = stringField(params, "itemId")
  const callId = stringField(params, "callId")
  if (threadId) ids.threadId = threadId
  if (turnId) ids.turnId = turnId
  if (itemId) ids.itemId = itemId
  if (callId) ids.callId = callId
  return { ...ids, ...extra }
}

function usageVector(value: unknown): Record<string, number> | undefined {
  const record = asDecoderRecord(value)
  if (!record) return undefined
  const vector: Record<string, number> = {}
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "number" && Number.isFinite(entry)) {
      vector[key] = entry
    }
  }
  return Object.keys(vector).length > 0 ? vector : undefined
}

function invalidShape(method: string): CodexNativeDescriptor {
  return { kind: "invalid_native_shape", method, native: {} }
}

function unknownMethod(method: string): CodexNativeDescriptor {
  return { kind: "unknown_native_method", method, native: {} }
}

/** Normalized ThreadItem: variant, identity and allowlisted final fields. */
function normalizeThreadItem(item: DecoderRecord): {
  itemType: string
  itemId: string
  fields: Record<string, unknown>
} | null {
  const itemType = stringField(item, "type")
  const itemId = stringField(item, "id")
  if (!itemType || !itemId) return null
  const fields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    if (key === "type" || key === "id") continue
    fields[key] = value
  }
  return { itemType, itemId, fields }
}

function decodeNotification(
  method: string,
  params: DecoderRecord | null,
): CodexNativeDescriptor {
  const domainKind = CODEX_NOTIFICATION_DOMAIN_KINDS[method]
  const statusKind = CODEX_NOTIFICATION_STATUS_SUBTYPES[method]
  if (!domainKind && !statusKind) return unknownMethod(method)
  if (!params) return invalidShape(method)

  switch (method) {
    case "item/agentMessage/delta": {
      const ids = nativeIds(params)
      const text = params.delta
      if (
        !ids.threadId ||
        !ids.turnId ||
        !ids.itemId ||
        typeof text !== "string"
      )
        return invalidShape(method)
      return {
        kind: "assistant_delta",
        method,
        native: ids,
        channel: "assistant",
        text,
      }
    }
    case "item/reasoning/textDelta":
    case "item/reasoning/summaryTextDelta": {
      const ids = nativeIds(params)
      const text = params.delta
      if (
        !ids.threadId ||
        !ids.turnId ||
        !ids.itemId ||
        typeof text !== "string"
      )
        return invalidShape(method)
      const summary = method === "item/reasoning/summaryTextDelta"
      const partIndex = indexField(
        params,
        summary ? "summaryIndex" : "contentIndex",
      )
      return {
        kind: "reasoning_delta",
        method,
        native: ids,
        channel: summary ? "summary" : "text",
        ...(partIndex === undefined ? {} : { partIndex }),
        text,
      }
    }
    case "item/reasoning/summaryPartAdded": {
      const ids = nativeIds(params)
      const partIndex = indexField(params, "summaryIndex")
      if (
        !ids.threadId ||
        !ids.turnId ||
        !ids.itemId ||
        partIndex === undefined
      )
        return invalidShape(method)
      return {
        kind: "reasoning_part",
        method,
        native: ids,
        channel: "summary",
        partIndex,
      }
    }
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
    case "item/mcpToolCall/progress": {
      const ids = nativeIds(params)
      const text =
        method === "item/mcpToolCall/progress" ? params.message : params.delta
      if (!ids.itemId || typeof text !== "string") return invalidShape(method)
      return {
        kind: "tool_delta",
        method,
        native: ids,
        channel: "tool",
        text,
        fields: {
          textField:
            method === "item/mcpToolCall/progress" ? "message" : "output",
        },
      }
    }
    case "item/commandExecution/terminalInteraction": {
      const ids = nativeIds(params)
      if (!ids.itemId) return invalidShape(method)
      return {
        kind: "tool_delta",
        method,
        native: ids,
        channel: "tool",
        fields: {
          ...scalarFields(params, ["processId"]),
          interaction: "stdin",
          contentOmitted: true,
        },
      }
    }
    case "item/fileChange/patchUpdated": {
      const ids = nativeIds(params)
      if (!ids.itemId) return invalidShape(method)
      return {
        kind: "tool_delta",
        method,
        native: ids,
        channel: "tool",
        fields: {
          changeCount: Array.isArray(params.changes)
            ? params.changes.length
            : 0,
        },
      }
    }
    case "item/started":
    case "item/completed": {
      const item = asDecoderRecord(params.item)
      const normalized = item ? normalizeThreadItem(item) : null
      const ids = nativeIds(params)
      if (!normalized) return invalidShape(method)
      return {
        kind: method === "item/started" ? "item_started" : "item_completed",
        method,
        native: { ...ids, itemId: normalized.itemId },
        fields: { itemType: normalized.itemType, item: normalized.fields },
      }
    }
    case "error": {
      const error = asDecoderRecord(params.error)
      if (!error) return invalidShape(method)
      const code = error.code
      return {
        kind: "error",
        method,
        native: nativeIds(params),
        ...(typeof code === "string" || typeof code === "number"
          ? { code }
          : {}),
        ...(typeof params.willRetry === "boolean"
          ? { willRetry: params.willRetry }
          : {}),
        ...(typeof error.message === "string" ? { text: error.message } : {}),
      }
    }
    case "thread/tokenUsage/updated": {
      const tokenUsage = asDecoderRecord(params.tokenUsage)
      const total = usageVector(tokenUsage?.total)
      const last = usageVector(tokenUsage?.last)
      if (!total) return invalidShape(method)
      return {
        kind: "usage_update",
        method,
        native: nativeIds(params),
        total,
        ...(last ? { last } : {}),
        fields: scalarFields(tokenUsage, ["modelContextWindow"]),
      }
    }
    case "turn/completed":
    case "turn/started": {
      const turn = asDecoderRecord(params.turn)
      const threadId = stringField(params, "threadId")
      const turnId = stringField(turn, "id")
      if (!threadId || !turnId) return invalidShape(method)
      const error = asDecoderRecord(turn?.error)
      return {
        kind:
          method === "turn/completed" ? "terminal_candidate" : "turn_lifecycle",
        method,
        native: { threadId, turnId },
        fields: {
          turnStatus: typeof turn?.status === "string" ? turn.status : null,
          ...scalarFields(turn, ["durationMs"]),
          ...(error && typeof error.message === "string"
            ? { errorMessage: error.message }
            : {}),
        },
      }
    }
    case "serverRequest/resolved": {
      const requestId = params.requestId
      if (typeof requestId !== "string" && typeof requestId !== "number")
        return invalidShape(method)
      return {
        kind: "interaction_boundary",
        method,
        boundary: "resolved",
        requestId,
        native: nativeIds(params, { requestId }),
      }
    }
    case "thread/started": {
      const thread = asDecoderRecord(params.thread)
      const threadId = stringField(thread, "id")
      if (!threadId) return invalidShape(method)
      const sessionId = stringField(thread, "sessionId")
      return {
        kind: "thread_lifecycle",
        method,
        native: { threadId, ...(sessionId ? { sessionId } : {}) },
        fields: scalarFields(thread, ["ephemeral", "cliVersion"]),
      }
    }
    default:
      break
  }

  if (statusKind === "unsupported_native_surface") {
    const surface = OBSERVED_DEFERRED_SURFACES[method] ?? "realtime"
    const threadId = stringField(params, "threadId")
    return {
      kind: statusKind,
      method,
      native: threadId ? { threadId } : {},
      fields: {
        surface,
        disposition: "observed_deferred",
        contentOmitted: true,
      },
    }
  }
  return {
    kind: statusKind,
    method,
    native: nativeIds(params),
    fields: statusFields(method, params),
  }
}

/** Allowlisted, content-free diagnostic fields per status notification. */
function statusFields(
  method: string,
  params: DecoderRecord,
): Record<string, unknown> {
  switch (method) {
    case "account/login/completed":
    case "mcpServer/oauthLogin/completed":
      return scalarFields(params, ["name", "success"])
    case "account/updated":
      return scalarFields(params, ["authMode"])
    case "command/exec/outputDelta":
      return {
        ...scalarFields(params, ["processId", "stream", "capReached"]),
        contentOmitted: true,
      }
    case "process/outputDelta":
      return {
        ...scalarFields(params, ["processHandle", "stream", "capReached"]),
        contentOmitted: true,
      }
    case "process/exited":
      return scalarFields(params, ["processHandle", "exitCode", "signal"])
    case "configWarning":
    case "deprecationNotice":
      return scalarFields(params, ["summary"])
    case "guardianWarning":
    case "warning":
      return scalarFields(params, ["message"])
    case "fs/changed":
      return {
        ...scalarFields(params, ["watchId"]),
        changedPathCount: Array.isArray(params.changedPaths)
          ? params.changedPaths.length
          : 0,
      }
    case "fuzzyFileSearch/sessionCompleted":
    case "fuzzyFileSearch/sessionUpdated":
      return {
        ...(typeof params.sessionId === "string"
          ? { searchSessionId: params.sessionId }
          : {}),
        ...(Array.isArray(params.files)
          ? { fileCount: params.files.length }
          : {}),
      }
    case "hook/completed":
    case "hook/started": {
      const run = asDecoderRecord(params.run)
      return {
        ...(typeof run?.id === "string" ? { hookRunId: run.id } : {}),
        ...(typeof run?.status === "string" ? { hookStatus: run.status } : {}),
      }
    }
    case "item/autoApprovalReview/completed":
    case "item/autoApprovalReview/started": {
      const review = asDecoderRecord(params.review)
      return {
        ...scalarFields(params, ["targetItemId"]),
        ...(typeof review?.status === "string"
          ? { reviewStatus: review.status }
          : {}),
      }
    }
    case "item/plan/delta":
      return typeof params.delta === "string" ? { text: params.delta } : {}
    case "turn/plan/updated":
      return {
        ...scalarFields(params, ["explanation"]),
        stepCount: Array.isArray(params.plan) ? params.plan.length : 0,
      }
    case "mcpServer/startupStatus/updated":
      return scalarFields(params, ["name", "status"])
    case "model/rerouted":
      return scalarFields(params, ["fromModel", "toModel", "reason"])
    case "model/verification":
      return {
        verificationCount: Array.isArray(params.verifications)
          ? params.verifications.length
          : 0,
      }
    case "rawResponseItem/completed": {
      const item = asDecoderRecord(params.item)
      return {
        ...(typeof item?.type === "string" ? { itemType: item.type } : {}),
        ...(typeof item?.role === "string" ? { role: item.role } : {}),
        contentOmitted: true,
      }
    }
    case "thread/status/changed": {
      const status = asDecoderRecord(params.status)
      return typeof status?.type === "string"
        ? { threadStatus: status.type }
        : {}
    }
    case "thread/name/updated":
      return scalarFields(params, ["threadName"])
    case "turn/diff/updated":
      return {
        diffLength: typeof params.diff === "string" ? params.diff.length : 0,
        contentOmitted: true,
      }
    default:
      return {}
  }
}

function decodeServerRequest(
  method: string,
  id: string | number,
  params: DecoderRecord | null,
): CodexNativeDescriptor {
  if (!CODEX_SERVER_REQUEST_METHODS.includes(method)) {
    return {
      ...unknownMethod(method),
      boundary: "request",
      requestId: id,
      native: { requestId: id },
    }
  }
  return {
    kind: "interaction_boundary",
    method,
    boundary: "request",
    requestId: id,
    native: nativeIds(params, { requestId: id }),
  }
}

/**
 * Decodes one Codex native boundary into observation descriptors. Stateless
 * and deterministic: it never mutates its input and never assigns sequences,
 * outcomes or inferred part indexes.
 */
export function decodeCodexNativeBoundary(
  boundary: unknown,
): CodexNativeDescriptor[] {
  const input = asDecoderRecord(boundary) ?? {}
  const message = asDecoderRecord(input.message)
  const requestId = input.requestId
  if (
    !message &&
    (typeof requestId === "string" || typeof requestId === "number") &&
    (input.result === "sent" || input.result === "failed")
  ) {
    return [
      {
        kind: "interaction_boundary",
        boundary: "response_send",
        requestId,
        sendResult: input.result,
        native: { requestId },
      },
    ]
  }
  if (!message) return [invalidShape("unknown")]
  const method = typeof message.method === "string" ? message.method : null
  const params = asDecoderRecord(message.params)
  const id = message.id
  if (method && (typeof id === "string" || typeof id === "number")) {
    return [decodeServerRequest(method, id, params)]
  }
  if (method) return [decodeNotification(method, params)]
  if (typeof id === "string" || typeof id === "number") {
    const error = asDecoderRecord(message.error)
    return [
      {
        kind: "protocol_response",
        native: {},
        fields: {
          jsonRpcId: id,
          ...(error ? scalarFields(error, ["code", "message"]) : {}),
        },
        ...(error &&
        (typeof error.code === "string" || typeof error.code === "number")
          ? { code: error.code }
          : {}),
      },
    ]
  }
  return [invalidShape("unknown")]
}

/**
 * The Codex app-server protocol schema this adapter decodes against: the
 * pinned notification/request/item disposition tables compiled into Locus
 * (the repository vendors no schema files). run-provenance.ts fingerprints
 * these exact bytes as the Run's schema identity.
 */
export function codexAppServerSchemaDocuments(): {
  path: string
  content: string
}[] {
  const sorted = (record: Readonly<Record<string, string>>) =>
    Object.fromEntries(
      Object.entries(record).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    )
  return [
    {
      path: "codex-app-server/v2/dispositions.json",
      content: JSON.stringify({
        notifications: sorted({
          ...CODEX_NOTIFICATION_STATUS_SUBTYPES,
          ...CODEX_NOTIFICATION_DOMAIN_KINDS,
        }),
        serverRequests: [...CODEX_SERVER_REQUEST_METHODS].sort(),
        threadItems: sorted(CODEX_THREAD_ITEM_DISPOSITIONS),
      }),
    },
  ]
}
