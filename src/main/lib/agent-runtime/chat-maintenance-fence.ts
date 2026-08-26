import { getActiveClaudeSession } from "../claude/active-sessions"
import { getActiveCodexStream } from "../codex/active-streams"
import {
  claimDesktopRunAdmission,
  type DesktopRunAdmissionGeneration,
  invalidateDesktopRunAdmission,
  releaseDesktopRunAdmission,
} from "./desktop-run-admission-generation"

export const SESSION_BINDING_BUSY_CODE = "SESSION_BINDING_BUSY" as const

export type ChatMaintenanceOperation = "rollback"
export type ChatMaintenanceBusyReason = "active-run" | "maintenance"

/**
 * Phase-5-compatible conflict vocabulary for the narrow Foundation fence.
 * `subChatId` deliberately stands in for the future durable `bindingId` until
 * C4 SessionBinding lifecycle work absorbs or replaces this mechanism.
 */
export type ChatMaintenanceBusyError = Readonly<{
  code: typeof SESSION_BINDING_BUSY_CODE
  subChatId: string
  operation: ChatMaintenanceOperation
  activeRunId: string | null
  reason: ChatMaintenanceBusyReason
}>

export type ChatMaintenanceFence = Readonly<{
  subChatId: string
  operation: ChatMaintenanceOperation
  token: symbol
}>

/**
 * Exact process-local blocker owned by a desktop Run only for the purpose of
 * excluding rollback until that Run's supervised lifecycle has settled.
 *
 * This is not execution authority: it cannot block or admit another Run, it
 * cannot renew or wait, and it is never persisted.
 */
export type ChatMaintenanceRunBlocker = Readonly<{
  subChatId: string
  activeRunId: string
  token: symbol
}>

export type AcquireChatMaintenanceFenceResult =
  | Readonly<{ ok: true; fence: ChatMaintenanceFence }>
  | Readonly<{ ok: false; error: ChatMaintenanceBusyError }>

export type ClaimDesktopRunAdmissionWithMaintenanceResult =
  | Readonly<{ ok: true; blocker: ChatMaintenanceRunBlocker }>
  | Readonly<{ ok: false; reason: "stale-admission" }>
  | Readonly<{
      ok: false
      reason: "maintenance"
      error: ChatMaintenanceBusyError
    }>

// Process-local by design: this is not a durable SessionBinding execution
// lease and is intentionally empty after a main-process restart.
const maintenanceFenceBySubChat = new Map<string, ChatMaintenanceFence>()
// A same-chat replacement may begin before the aborted predecessor has
// finished draining. Keep every exact claimed lifecycle visible to rollback;
// the single current-runtime registries cannot represent that overlap.
const runBlockersBySubChat = new Map<
  string,
  Set<ChatMaintenanceRunBlocker>
>()
// Exact, process-local rejection receipts for candidates displaced by
// rollback. This maintenance-specific state stays with the canonical fence
// owner and holds no Run alive while it awaits claim/release cleanup.
let maintenanceInvalidatedAdmissions =
  new WeakSet<DesktopRunAdmissionGeneration>()

function createBusyError(input: {
  subChatId: string
  operation: ChatMaintenanceOperation
  activeRunId: string | null
  reason: ChatMaintenanceBusyReason
}): ChatMaintenanceBusyError {
  return Object.freeze({
    code: SESSION_BINDING_BUSY_CODE,
    subChatId: input.subChatId,
    operation: input.operation,
    activeRunId: input.activeRunId,
    reason: input.reason,
  })
}

function getLatestRunBlocker(
  subChatId: string,
): ChatMaintenanceRunBlocker | undefined {
  const blockers = runBlockersBySubChat.get(subChatId)
  if (!blockers) return undefined
  let latest: ChatMaintenanceRunBlocker | undefined
  for (const blocker of blockers) latest = blocker
  return latest
}

function createChatMaintenanceRunBlocker(input: {
  subChatId: string
  activeRunId: string
}): ChatMaintenanceRunBlocker {
  const blocker = Object.freeze({
    subChatId: input.subChatId,
    activeRunId: input.activeRunId,
    token: Symbol(`run:${input.subChatId}`),
  })
  const blockers = runBlockersBySubChat.get(input.subChatId)
  if (blockers) {
    blockers.add(blocker)
  } else {
    runBlockersBySubChat.set(input.subChatId, new Set([blocker]))
  }
  return blocker
}

export function formatChatMaintenanceBusyMessage(
  error: ChatMaintenanceBusyError,
  blockedOperation: "rollback" | "run",
): string {
  if (blockedOperation === "run") {
    return `Chat ${error.subChatId} is busy with ${error.operation} maintenance; a new Run cannot start.`
  }

  const conflict =
    error.reason === "active-run"
      ? `active Run ${error.activeRunId ?? "unknown"}`
      : "another maintenance operation"
  return `Chat ${error.subChatId} is busy with ${conflict}; rollback cannot start.`
}

/**
 * Acquires the narrow rollback-vs-new-Run mutual exclusion fence.
 *
 * BUSY checks are side-effect free. Only a rollback that can actually acquire
 * ownership invalidates older pending candidates, immediately before the
 * exact token is installed. The entire operation is synchronous, so no Run
 * final claim can interleave between that invalidation and Map installation.
 */
export function acquireChatMaintenanceFence(
  subChatId: string,
  operation: ChatMaintenanceOperation = "rollback",
): AcquireChatMaintenanceFenceResult {
  const activeRunId =
    getActiveClaudeSession(subChatId)?.runId ??
    getActiveCodexStream(subChatId)?.runId ??
    getLatestRunBlocker(subChatId)?.activeRunId ??
    null
  if (activeRunId !== null) {
    return {
      ok: false,
      error: createBusyError({
        subChatId,
        operation,
        activeRunId,
        reason: "active-run",
      }),
    }
  }

  if (maintenanceFenceBySubChat.has(subChatId)) {
    return {
      ok: false,
      error: createBusyError({
        subChatId,
        operation,
        activeRunId: null,
        reason: "maintenance",
      }),
    }
  }

  const invalidatedAdmission = invalidateDesktopRunAdmission(subChatId)
  if (invalidatedAdmission) {
    maintenanceInvalidatedAdmissions.add(invalidatedAdmission)
  }
  const fence = Object.freeze({
    subChatId,
    operation,
    token: Symbol(`${operation}:${subChatId}`),
  })
  maintenanceFenceBySubChat.set(subChatId, fence)
  return { ok: true, fence }
}

/** Exact-token release: stale cleanup cannot release a replacement fence. */
export function releaseChatMaintenanceFence(
  fence: ChatMaintenanceFence,
): boolean {
  if (maintenanceFenceBySubChat.get(fence.subChatId) !== fence) {
    return false
  }
  maintenanceFenceBySubChat.delete(fence.subChatId)
  return true
}

/**
 * Final desktop Run claim shared by Claude and Codex.
 *
 * It performs the maintenance check and admission claim synchronously in the
 * same main-process turn. When maintenance wins, a newly reserved candidate is
 * consumed and receives the structured C4.1-aligned BUSY conflict.
 */
export function claimDesktopRunAdmissionWithMaintenanceFence(
  admission: DesktopRunAdmissionGeneration,
  activeRunId: string,
): ClaimDesktopRunAdmissionWithMaintenanceResult {
  const maintenance = maintenanceFenceBySubChat.get(admission.subChatId)
  if (maintenance) {
    releaseDesktopRunAdmissionWithMaintenanceFence(admission)
    return {
      ok: false,
      reason: "maintenance",
      error: createBusyError({
        subChatId: admission.subChatId,
        operation: maintenance.operation,
        activeRunId: null,
        reason: "maintenance",
      }),
    }
  }

  if (maintenanceInvalidatedAdmissions.delete(admission)) {
    return {
      ok: false,
      reason: "maintenance",
      error: createBusyError({
        subChatId: admission.subChatId,
        operation: "rollback",
        activeRunId: null,
        reason: "maintenance",
      }),
    }
  }

  if (!claimDesktopRunAdmission(admission)) {
    return { ok: false, reason: "stale-admission" }
  }
  return {
    ok: true,
    blocker: createChatMaintenanceRunBlocker({
      subChatId: admission.subChatId,
      activeRunId,
    }),
  }
}

/**
 * Releases only the exact Run blocker after supervised lifecycle settlement.
 * Unsubscribe/abort must not call this while provider work can still drain.
 */
export function releaseChatMaintenanceRunBlocker(
  blocker: ChatMaintenanceRunBlocker,
): boolean {
  const blockers = runBlockersBySubChat.get(blocker.subChatId)
  if (!blockers?.delete(blocker)) return false
  if (blockers.size === 0) {
    runBlockersBySubChat.delete(blocker.subChatId)
  }
  return true
}

/**
 * Exact cleanup companion for every maintenance-aware desktop admission.
 * It retracts a one-shot BUSY tombstone as well as an ordinary reservation.
 */
export function releaseDesktopRunAdmissionWithMaintenanceFence(
  admission: DesktopRunAdmissionGeneration,
): boolean {
  const releasedMaintenanceReceipt =
    maintenanceInvalidatedAdmissions.delete(admission)
  return releaseDesktopRunAdmission(admission) || releasedMaintenanceReceipt
}

export function hasActiveChatMaintenanceFence(subChatId: string): boolean {
  return maintenanceFenceBySubChat.has(subChatId)
}

export function clearChatMaintenanceFencesForTest(): void {
  maintenanceFenceBySubChat.clear()
  runBlockersBySubChat.clear()
  maintenanceInvalidatedAdmissions =
    new WeakSet<DesktopRunAdmissionGeneration>()
}
