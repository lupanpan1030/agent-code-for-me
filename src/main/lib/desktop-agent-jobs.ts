import { createHash, randomUUID } from "node:crypto"
import type { AgentJobMode } from "../../shared/agent-jobs"
import type { AgentRuntimeId } from "../../shared/agent-runtime-capabilities"
import type { DesktopPermissionPolicy } from "./agent-runtime/permission-policy"
import { verifyDesktopRunPreflight } from "./agent-runtime/preflight"
import {
  assistantItemOutputRecords,
  isAssistantItemRecord,
  type LedgerRecord,
  type OutcomeEvidence,
  type TerminalJobFields,
} from "./agent-runtime/run-event-ledger"
import {
  getOrCreateRunEventLedger,
  releaseRunEventLedger,
} from "./agent-runtime/run-event-ledger-host"
import type { AgentJob } from "./db/schema"
import type { AgentJobDatabase } from "./headless/job-store"
import {
  cancelAgentJob,
  createAgentJob,
  getAgentJob,
  heartbeatAgentJob,
  startAgentJob,
} from "./headless/job-store"

type DesktopAgentRuntime = Extract<AgentRuntimeId, "claude-code" | "codex">

export type CreateDesktopAgentJobInput = {
  runtime: DesktopAgentRuntime
  mode: AgentJobMode
  chatId: string
  subChatId: string
  cwd: string
  prompt: string
  runId?: string | null
  permissionPolicy?: DesktopPermissionPolicy | null
}

export type DesktopAgentJobHandle = {
  job: AgentJob
  workerId: string
  cwd: string
}

export type CreateAndRegisterDesktopChatAgentJobInput =
  CreateDesktopAgentJobInput & {
    cancel: () => void
    heartbeatIntervalMs?: number
  }

export type ResolveDesktopChatJobCompletionInput = {
  runtime: DesktopAgentRuntime
  aborted: boolean
  reachedNaturalFinish: boolean
  sawError: boolean
}

export type DesktopChatJobCompletion = {
  status: "succeeded" | "failed" | "canceled"
  exitCode: number
  errorCode: string | null
  errorMessage: string | null
}

export type CompleteDesktopChatAgentJobSafelyInput =
  ResolveDesktopChatJobCompletionInput & {
    jobId: string | null | undefined
    result?: unknown
  }

export type RequestCancelDesktopChatAgentJobSafelyInput = {
  jobId: string | null | undefined
  sawError: boolean
  reachedNaturalFinish: boolean
  requestedBy: string
}

type CancelRegistration = {
  jobId: string
  runtime: DesktopAgentRuntime
  subChatId: string
  runId?: string | null
  db: AgentJobDatabase
  workerId: string
  heartbeatIntervalMs?: number
  cancel: () => void
}

type ActiveCancelRegistration = CancelRegistration & {
  heartbeatTimer: ReturnType<typeof setInterval> | null
}

const activeDesktopJobCancellations = new Map<
  string,
  ActiveCancelRegistration
>()

function assertDesktopRuntime(
  runtime: string,
): asserts runtime is DesktopAgentRuntime {
  if (runtime !== "claude-code" && runtime !== "codex") {
    throw new Error(`Unsupported desktop job runtime: ${runtime}`)
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function createDesktopPermissionPolicySnapshot(
  policy: DesktopPermissionPolicy | null | undefined,
) {
  if (!policy) return null

  return {
    runtimeId: policy.runtimeId,
    mode: policy.mode,
    guarded: policy.guarded,
    enforcement: policy.enforcement,
    planWorkspaceSideEffects: policy.planWorkspaceSideEffects,
    allowedLocusPersistence: policy.allowedLocusPersistence,
    blockedSideEffects: policy.blockedSideEffects,
    requiresPreExecutionEnforcement: policy.requiresPreExecutionEnforcement,
    runtimeMapping: policy.runtimeMapping,
    diagnostics: policy.diagnostics,
  }
}

export async function createAndStartDesktopAgentJob(
  db: AgentJobDatabase,
  input: CreateDesktopAgentJobInput,
): Promise<DesktopAgentJobHandle> {
  assertDesktopRuntime(input.runtime)
  const context = verifyDesktopRunPreflight(db, input)
  const workerId = `desktop:${input.runtime}:${input.runId || randomUUID()}`
  const prompt = input.prompt
  const job = await createAgentJob(db, {
    source: "desktop",
    runtime: input.runtime,
    mode: input.mode,
    cwd: context.cwd,
    prompt,
    input: {
      kind: "desktop-chat",
      chatId: context.chat.id,
      subChatId: context.subChat.id,
      workspaceKind: context.kind,
      projectId: context.kind === "project" ? context.project.id : null,
      runId: input.runId ?? null,
      promptSha256: sha256(prompt),
      promptLength: prompt.length,
      permissionPolicy: createDesktopPermissionPolicySnapshot(
        input.permissionPolicy,
      ),
    },
    projectId: context.kind === "project" ? context.project.id : null,
    chatId: context.chat.id,
    subChatId: context.subChat.id,
  })

  const running = await startAgentJob(db, {
    jobId: job.id,
    workerId,
    workerPid: process.pid,
  })
  // The desktop host registers the Run's job-row projection once, so a
  // settlement minted by another port (a Codex transport exit) still records
  // an error code and message; the safe finalizer passes its own fields.
  const ledger = await getOrCreateRunEventLedger(db, running, {
    terminalJobFields: desktopTerminalJobFields,
  })
  await ledger.appendSystemEvent({
    observationKey: `desktop:stream-started:${job.id}`,
    type: "status",
    payload: {
      status: "desktop_chat_stream_started",
      runtime: input.runtime,
      mode: input.mode,
      runId: input.runId ?? null,
    },
  })

  return {
    job: getAgentJob(db, job.id) ?? running,
    workerId,
    cwd: context.cwd,
  }
}

function desktopTerminalJobFields(outcome: {
  status: string
  reasons: string[]
}): TerminalJobFields {
  if (outcome.status === "succeeded") {
    return { exitCode: 0, errorCode: null, errorMessage: null }
  }
  if (outcome.status === "canceled") {
    return {
      exitCode: 5,
      errorCode: "desktop_chat_canceled",
      errorMessage: "Desktop chat stream was canceled.",
    }
  }
  return {
    exitCode: 1,
    errorCode: outcome.reasons[0] ?? "desktop_chat_failed",
    errorMessage: `Desktop run outcome ${outcome.status}: ${outcome.reasons.join(", ") || "no success evidence"}.`,
  }
}

export function registerActiveDesktopAgentJob(
  registration: CancelRegistration,
): void {
  unregisterActiveDesktopAgentJob(registration.jobId)
  const heartbeatTimer = setInterval(() => {
    try {
      heartbeatAgentJob(
        registration.db,
        registration.jobId,
        registration.workerId,
      )
    } catch {
      unregisterActiveDesktopAgentJob(registration.jobId)
    }
  }, registration.heartbeatIntervalMs ?? 30_000)
  heartbeatTimer.unref?.()
  activeDesktopJobCancellations.set(registration.jobId, {
    ...registration,
    heartbeatTimer,
  })
}

export async function createAndRegisterDesktopChatAgentJob(
  db: AgentJobDatabase,
  input: CreateAndRegisterDesktopChatAgentJobInput,
): Promise<DesktopAgentJobHandle> {
  const handle = await createAndStartDesktopAgentJob(db, input)
  registerActiveDesktopAgentJob({
    jobId: handle.job.id,
    runtime: input.runtime,
    subChatId: input.subChatId,
    runId: input.runId,
    db,
    workerId: handle.workerId,
    heartbeatIntervalMs: input.heartbeatIntervalMs,
    cancel: input.cancel,
  })
  return handle
}

export function unregisterActiveDesktopAgentJob(jobId: string): void {
  const registration = activeDesktopJobCancellations.get(jobId)
  if (registration?.heartbeatTimer) {
    clearInterval(registration.heartbeatTimer)
  }
  activeDesktopJobCancellations.delete(jobId)
}

export function cancelActiveDesktopAgentJob(jobId: string): boolean {
  const registration = activeDesktopJobCancellations.get(jobId)
  if (!registration) return false
  registration.cancel()
  return true
}

export async function requestCancelDesktopAgentJob(
  db: AgentJobDatabase,
  jobId: string,
  requestedBy: string,
): Promise<{ job: AgentJob; activeCancelDelivered: boolean }> {
  const job = getAgentJob(db, jobId)
  if (!job) throw new Error(`Unknown job: ${jobId}`)
  const updated = await cancelAgentJob(db, jobId, { requestedBy })
  return {
    job: updated,
    activeCancelDelivered: cancelActiveDesktopAgentJob(jobId),
  }
}

function desktopRuntimeLabel(runtime: DesktopAgentRuntime): "Claude" | "Codex" {
  switch (runtime) {
    case "claude-code":
      return "Claude"
    case "codex":
      return "Codex"
  }
}

export function resolveDesktopChatJobCompletion({
  runtime,
  aborted,
  reachedNaturalFinish,
  sawError,
}: ResolveDesktopChatJobCompletionInput): DesktopChatJobCompletion {
  const wasCanceled = aborted && !reachedNaturalFinish
  const status = wasCanceled ? "canceled" : sawError ? "failed" : "succeeded"
  const runtimeLabel = desktopRuntimeLabel(runtime)

  return {
    status,
    exitCode: status === "succeeded" ? 0 : status === "canceled" ? 5 : 1,
    errorCode:
      status === "failed"
        ? "desktop_chat_failed"
        : status === "canceled"
          ? "desktop_chat_canceled"
          : null,
    errorMessage:
      status === "failed"
        ? `Desktop ${runtimeLabel} chat stream failed.`
        : status === "canceled"
          ? `Desktop ${runtimeLabel} chat stream was canceled.`
          : null,
  }
}

const DESKTOP_OUTPUT_TYPES = new Set([
  "assistant_delta",
  "reasoning_delta",
  "tool_started",
  "tool_delta",
  "tool_finished",
  "command_started",
  "command_output",
  "command_finished",
  "artifact_created",
])

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

/**
 * The live native terminal a desktop runtime committed to the Run's ledger:
 * the Codex `turn/completed` terminal candidate or the Claude Agent SDK
 * `result` message. Its observation key comes from the committed fact key
 * (`<observationKey>:<ordinal>`).
 */
function committedDesktopNativeTerminal(
  records: readonly LedgerRecord[],
): { observationKey: string; status: "succeeded" | "failed" } | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]
    if (record.type !== "status" || !isRecordObject(record.payload)) continue
    const payload = record.payload
    let status: "succeeded" | "failed" | null = null
    if (
      payload.subtype === "turn_lifecycle" &&
      payload.terminalCandidate === true
    ) {
      status =
        payload.turnStatus === "completed"
          ? "succeeded"
          : payload.turnStatus === "failed"
            ? "failed"
            : null
    } else if (payload.subtype === "runtime_result") {
      status =
        payload.isError === true ||
        (typeof payload.messageSubtype === "string" &&
          payload.messageSubtype.startsWith("error"))
          ? "failed"
          : "succeeded"
    } else {
      continue
    }
    const observationKey =
      typeof record.factKey === "string"
        ? record.factKey.replace(/:\d+$/, "")
        : ""
    return status && observationKey ? { observationKey, status } : null
  }
  return null
}

/**
 * Terminal evidence of a desktop chat Run (design "Error, Completion and
 * Late-Event Policy"): the safe finalizer observed the live stream's natural
 * finish or failure, a cancel or an interrupt; output and policy evidence are
 * the Run's committed records. A committed live native terminal is
 * `native_terminal` evidence; a finalizer status with no native terminal
 * (a failure before the runtime's terminal) is host evidence. The ledger
 * decides the outcome.
 */
function desktopOutcomeEvidence(input: {
  jobId: string
  status: "succeeded" | "failed" | "canceled" | "interrupted"
  records: readonly LedgerRecord[]
}): OutcomeEvidence {
  const observationKey = `desktop-finalize:${input.jobId}`
  const native = committedDesktopNativeTerminal(input.records)
  // A host-observed failure after a native success stays host evidence.
  const nativeTrigger =
    native && (input.status === "succeeded" || native.status === "failed")
      ? native
      : null
  // Assistant items count by their final item state (final text wins); other
  // output records, item-less assistant_delta included, count by type.
  const outputKeys = [
    ...assistantItemOutputRecords(input.records),
    ...input.records.filter(
      (record) =>
        DESKTOP_OUTPUT_TYPES.has(record.type) && !isAssistantItemRecord(record),
    ),
  ]
    .sort((left, right) => left.sequence - right.sequence)
    .map((record) => `record:${record.sequence}`)
  const denials = input.records.filter((record) => {
    if (record.type !== "permission_requested") return false
    const payload = isRecordObject(record.payload) ? record.payload : {}
    return payload.decision === "deny" && payload.controlLevel === "enforce"
  })
  return {
    trigger:
      input.status === "canceled"
        ? { kind: "cancel", reason: "desktop_cancel", observationKey }
        : input.status === "interrupted"
          ? { kind: "interrupt", reason: "desktop_interrupt", observationKey }
          : nativeTrigger
            ? {
                kind: "native_terminal",
                status: nativeTrigger.status,
                observationKey: nativeTrigger.observationKey,
                origin: "live",
              }
            : {
                kind: "host_result",
                status: input.status,
                observationKey,
              },
    policy: {
      denied: denials.length > 0,
      evidenceKeys:
        denials.length > 0
          ? denials.map((record) => `record:${record.sequence}`)
          : ["policy:no-recorded-denial"],
    },
    output: {
      valid: true,
      empty: outputKeys.length === 0,
      allowEmpty: false,
      evidenceKeys: outputKeys,
    },
    postRun: {
      credentialsSafe: true,
      evidenceKeys: ["postrun:desktop-finalizer"],
    },
  }
}

/**
 * Desktop safe finalizer: submits terminal evidence for a still-running
 * desktop job to its host ledger (never throws; a job that is already
 * terminal is returned unchanged).
 */
export async function completeDesktopAgentJobSafely(
  db: AgentJobDatabase,
  input: {
    jobId: string | null | undefined
    status: "succeeded" | "failed" | "canceled" | "interrupted"
    exitCode?: number | null
    errorCode?: string | null
    errorMessage?: string | null
    result?: unknown
  },
): Promise<AgentJob | null> {
  if (!input.jobId) return null
  const current = getAgentJob(db, input.jobId)
  if (!current || current.status !== "running") return current
  try {
    const ledger = await getOrCreateRunEventLedger(db, current)
    await ledger.whenIdle()
    const records = (await ledger.read(0)) as LedgerRecord[]
    await ledger.settle(
      desktopOutcomeEvidence({
        jobId: input.jobId,
        status: input.status,
        records,
      }),
      {
        jobFields: (outcome) =>
          outcome.status === input.status
            ? {
                exitCode: input.exitCode ?? null,
                errorCode: input.errorCode ?? null,
                errorMessage: input.errorMessage ?? null,
                result: input.result,
              }
            : {
                exitCode: outcome.status === "succeeded" ? 0 : 1,
                errorCode: outcome.reasons[0] ?? "desktop_chat_failed",
                errorMessage: `Desktop run outcome ${outcome.status}: ${outcome.reasons.join(", ")}.`,
                result: input.result,
              },
      },
    )
  } catch {
    // The finalizer is best effort: a concurrent terminal or a store failure
    // leaves the committed state as the authority.
  } finally {
    releaseRunEventLedger(db, input.jobId)
  }
  return getAgentJob(db, input.jobId)
}

export async function completeDesktopChatAgentJobSafely(
  db: AgentJobDatabase,
  input: CompleteDesktopChatAgentJobSafelyInput,
): Promise<AgentJob | null> {
  if (!input.jobId) return null
  const completion = resolveDesktopChatJobCompletion({
    runtime: input.runtime,
    aborted: input.aborted,
    reachedNaturalFinish: input.reachedNaturalFinish,
    sawError: input.sawError,
  })
  const completed = await completeDesktopAgentJobSafely(db, {
    jobId: input.jobId,
    ...completion,
    result: input.result,
  })
  unregisterActiveDesktopAgentJob(input.jobId)
  return completed
}

export async function requestCancelDesktopChatAgentJobSafely(
  db: AgentJobDatabase,
  input: RequestCancelDesktopChatAgentJobSafelyInput,
): Promise<Awaited<ReturnType<typeof requestCancelDesktopAgentJob>> | null> {
  if (!input.jobId || input.sawError || input.reachedNaturalFinish) {
    return null
  }
  try {
    return await requestCancelDesktopAgentJob(
      db,
      input.jobId,
      input.requestedBy,
    )
  } catch {
    // Job may already be terminal if cleanup raced with stream finish.
    return null
  }
}
