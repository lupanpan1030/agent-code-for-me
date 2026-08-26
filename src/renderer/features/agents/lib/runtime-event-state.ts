import type {
  AgentGuardEvent,
  GuardedRunAudit,
} from "../../../../shared/agent-scope-contracts"
import { appStore } from "../../../lib/jotai-store"
import {
  askUserQuestionApprovalIdsAtom,
  askUserQuestionResultsAtom,
  expiredUserQuestionsAtom,
  guardedRunAuditsAtom,
  guardedRunEventsAtom,
  type PendingUserQuestion,
  pendingScopeExpansionRequestsAtom,
  pendingUserQuestionsAtom,
} from "../atoms"

type RuntimeEventStateContext = {
  subChatId: string
  parentChatId: string
}

export type RuntimeQuestionApprovalIdentity = Pick<
  PendingUserQuestion,
  "subChatId" | "approvalId" | "toolUseId"
>

type AskUserQuestionChunk = {
  type: "ask-user-question"
  approvalId: string
  toolUseId: string
  questions: PendingUserQuestion["questions"]
}

type AskUserQuestionTimeoutChunk = {
  type: "ask-user-question-timeout"
  approvalId: string
  toolUseId: string
}

type AskUserQuestionResultChunk = {
  type: "ask-user-question-result"
  approvalId: string
  toolUseId: string
  result: unknown
}

type GuardEventChunk = {
  type: "guard-event"
  event: AgentGuardEvent
}

type GuardAuditChunk = {
  type: "guard-audit"
  audit: GuardedRunAudit
}

type RuntimeEventStateChunk =
  | AskUserQuestionChunk
  | AskUserQuestionTimeoutChunk
  | AskUserQuestionResultChunk
  | GuardEventChunk
  | GuardAuditChunk

/**
 * Runtime tool IDs are provider provenance, not globally unique renderer state
 * identities. Scope their UI projection to the chat that received the event.
 */
export function createAskUserQuestionStateKey(
  subChatId: string,
  toolUseId: string,
): string {
  return JSON.stringify([subChatId, toolUseId])
}

/**
 * Removes only the renderer question state still owned by the captured
 * main-minted approval identity. A delayed response from question A must not
 * clear replacement question B, even when the provider reuses its tool ID.
 */
export function clearRuntimeQuestionApprovalIfCurrent(
  identity: RuntimeQuestionApprovalIdentity,
): boolean {
  const ownerKey = createAskUserQuestionStateKey(
    identity.subChatId,
    identity.toolUseId,
  )
  const currentApprovalIds = appStore.get(askUserQuestionApprovalIdsAtom)
  if (currentApprovalIds.get(identity.approvalId) !== ownerKey) {
    return false
  }

  const nextApprovalIds = new Map(currentApprovalIds)
  if (nextApprovalIds.get(identity.approvalId) !== ownerKey) {
    return false
  }
  nextApprovalIds.delete(identity.approvalId)
  appStore.set(askUserQuestionApprovalIdsAtom, nextApprovalIds)

  const currentPending = appStore.get(pendingUserQuestionsAtom)
  const pending = currentPending.get(identity.subChatId)
  if (
    pending?.approvalId === identity.approvalId &&
    pending.toolUseId === identity.toolUseId
  ) {
    const nextPending = new Map(currentPending)
    nextPending.delete(identity.subChatId)
    appStore.set(pendingUserQuestionsAtom, nextPending)
  }

  const currentExpired = appStore.get(expiredUserQuestionsAtom)
  const expired = currentExpired.get(identity.subChatId)
  if (
    expired?.approvalId === identity.approvalId &&
    expired.toolUseId === identity.toolUseId
  ) {
    const nextExpired = new Map(currentExpired)
    nextExpired.delete(identity.subChatId)
    appStore.set(expiredUserQuestionsAtom, nextExpired)
  }

  return true
}

/**
 * Runs the transport response first, then compare-deletes its exact renderer
 * owner. Resolved false values are still completed responses; a thrown
 * transport leaves the question intact so the user can retry.
 */
export async function respondToRuntimeQuestionApproval<T>(input: {
  identity: RuntimeQuestionApprovalIdentity
  respond: () => Promise<T>
}): Promise<{ response: T; cleared: boolean; superseded: boolean }> {
  const response = await input.respond()
  const cleared = clearRuntimeQuestionApprovalIfCurrent(input.identity)
  const currentQuestion =
    appStore.get(pendingUserQuestionsAtom).get(input.identity.subChatId) ??
    appStore.get(expiredUserQuestionsAtom).get(input.identity.subChatId)
  return {
    response,
    cleared,
    superseded:
      !cleared &&
      currentQuestion !== undefined &&
      (currentQuestion.approvalId !== input.identity.approvalId ||
        currentQuestion.toolUseId !== input.identity.toolUseId),
  }
}

export function applyRuntimeEventStateChunk(
  context: RuntimeEventStateContext,
  chunk: { type?: string },
): boolean {
  if (!isRuntimeEventStateChunk(chunk)) {
    return false
  }

  switch (chunk.type) {
    case "ask-user-question":
      applyAskUserQuestion(context, chunk)
      return true
    case "ask-user-question-timeout":
      applyAskUserQuestionTimeout(context, chunk)
      return true
    case "ask-user-question-result":
      applyAskUserQuestionResult(context, chunk)
      return true
    case "guard-event":
      applyGuardEvent(context, chunk)
      return true
    case "guard-audit":
      applyGuardAudit(context, chunk)
      return true
  }
}

export function clearPendingUserQuestionForRuntimeChunk({
  subChatId,
  chunk,
}: {
  subChatId: string
  chunk: { type?: string }
}) {
  const chunkType = chunk.type
  const shouldClearOnChunk =
    typeof chunkType === "string" &&
    chunkType !== "ask-user-question" &&
    chunkType !== "ask-user-question-timeout" &&
    chunkType !== "ask-user-question-result" &&
    !chunkType.startsWith("tool-input") &&
    chunkType !== "start" &&
    chunkType !== "start-step"

  if (!shouldClearOnChunk) {
    return
  }

  const currentMap = appStore.get(pendingUserQuestionsAtom)
  const pending = currentMap.get(subChatId)
  if (!pending) {
    return
  }

  const newMap = new Map(currentMap)
  newMap.delete(subChatId)
  appStore.set(pendingUserQuestionsAtom, newMap)

  const currentApprovalIds = appStore.get(askUserQuestionApprovalIdsAtom)
  const ownerKey = createAskUserQuestionStateKey(
    pending.subChatId,
    pending.toolUseId,
  )
  if (currentApprovalIds.get(pending.approvalId) === ownerKey) {
    const nextApprovalIds = new Map(currentApprovalIds)
    nextApprovalIds.delete(pending.approvalId)
    appStore.set(askUserQuestionApprovalIdsAtom, nextApprovalIds)
  }
}

function isRuntimeEventStateChunk(chunk: {
  type?: string
}): chunk is RuntimeEventStateChunk {
  return (
    chunk.type === "ask-user-question" ||
    chunk.type === "ask-user-question-timeout" ||
    chunk.type === "ask-user-question-result" ||
    chunk.type === "guard-event" ||
    chunk.type === "guard-audit"
  )
}

function applyAskUserQuestion(
  context: RuntimeEventStateContext,
  chunk: AskUserQuestionChunk,
) {
  const currentMap = appStore.get(pendingUserQuestionsAtom)
  const currentExpired = appStore.get(expiredUserQuestionsAtom)
  const currentApprovalIds = appStore.get(askUserQuestionApprovalIdsAtom)
  const ownerKey = createAskUserQuestionStateKey(
    context.subChatId,
    chunk.toolUseId,
  )
  const existingOwnerKey = currentApprovalIds.get(chunk.approvalId)

  // A main-minted approval ID is one-shot authority. If an invalid duplicate
  // arrives for another chat/tool, do not let it steal the existing owner.
  if (existingOwnerKey !== undefined && existingOwnerKey !== ownerKey) {
    return
  }

  const nextApprovalIds = new Map(currentApprovalIds)
  const revokeQuestionOwner = (question: PendingUserQuestion | undefined) => {
    if (!question || question.approvalId === chunk.approvalId) {
      return
    }

    const previousOwnerKey = createAskUserQuestionStateKey(
      question.subChatId,
      question.toolUseId,
    )
    if (nextApprovalIds.get(question.approvalId) === previousOwnerKey) {
      nextApprovalIds.delete(question.approvalId)
    }
  }

  // Replacing the question for this chat revokes only that exact old owner.
  // Another chat may legitimately reuse the same provider toolUseId.
  revokeQuestionOwner(currentMap.get(context.subChatId))
  revokeQuestionOwner(currentExpired.get(context.subChatId))
  nextApprovalIds.set(chunk.approvalId, ownerKey)

  const newMap = new Map(currentMap)
  newMap.set(context.subChatId, {
    subChatId: context.subChatId,
    parentChatId: context.parentChatId,
    approvalId: chunk.approvalId,
    toolUseId: chunk.toolUseId,
    questions: chunk.questions,
  })
  appStore.set(pendingUserQuestionsAtom, newMap)
  appStore.set(askUserQuestionApprovalIdsAtom, nextApprovalIds)

  const currentResults = appStore.get(askUserQuestionResultsAtom)
  if (currentResults.has(ownerKey)) {
    const nextResults = new Map(currentResults)
    nextResults.delete(ownerKey)
    appStore.set(askUserQuestionResultsAtom, nextResults)
  }

  if (currentExpired.has(context.subChatId)) {
    const newExpiredMap = new Map(currentExpired)
    newExpiredMap.delete(context.subChatId)
    appStore.set(expiredUserQuestionsAtom, newExpiredMap)
  }
}

function applyAskUserQuestionTimeout(
  context: RuntimeEventStateContext,
  chunk: AskUserQuestionTimeoutChunk,
) {
  const ownerKey = createAskUserQuestionStateKey(
    context.subChatId,
    chunk.toolUseId,
  )
  const approvalIds = appStore.get(askUserQuestionApprovalIdsAtom)
  if (approvalIds.get(chunk.approvalId) !== ownerKey) {
    return
  }

  const currentMap = appStore.get(pendingUserQuestionsAtom)
  const pending = currentMap.get(context.subChatId)
  if (
    !pending ||
    pending.approvalId !== chunk.approvalId ||
    pending.toolUseId !== chunk.toolUseId
  ) {
    return
  }

  const newPendingMap = new Map(currentMap)
  newPendingMap.delete(context.subChatId)
  appStore.set(pendingUserQuestionsAtom, newPendingMap)

  const currentExpired = appStore.get(expiredUserQuestionsAtom)
  const newExpiredMap = new Map(currentExpired)
  newExpiredMap.set(context.subChatId, pending)
  appStore.set(expiredUserQuestionsAtom, newExpiredMap)
}

function applyAskUserQuestionResult(
  context: RuntimeEventStateContext,
  chunk: AskUserQuestionResultChunk,
) {
  const ownerKey = createAskUserQuestionStateKey(
    context.subChatId,
    chunk.toolUseId,
  )
  if (
    !clearRuntimeQuestionApprovalIfCurrent({
      subChatId: context.subChatId,
      approvalId: chunk.approvalId,
      toolUseId: chunk.toolUseId,
    })
  ) {
    return
  }

  const currentResults = appStore.get(askUserQuestionResultsAtom)
  const newResults = new Map(currentResults)
  newResults.set(ownerKey, chunk.result)
  appStore.set(askUserQuestionResultsAtom, newResults)
}

function applyGuardEvent(
  context: RuntimeEventStateContext,
  chunk: GuardEventChunk,
) {
  const currentEvents = appStore.get(guardedRunEventsAtom)
  const nextEvents = new Map(currentEvents)
  const events = nextEvents.get(context.subChatId) ?? []
  nextEvents.set(context.subChatId, [...events, chunk.event])
  appStore.set(guardedRunEventsAtom, nextEvents)

  if (
    chunk.event.type !== "scope-expansion-request" ||
    !chunk.event.toolUseId
  ) {
    return
  }

  const currentRequests = appStore.get(pendingScopeExpansionRequestsAtom)
  const nextRequests = new Map(currentRequests)
  nextRequests.set(context.subChatId, {
    subChatId: context.subChatId,
    parentChatId: context.parentChatId,
    requestId: chunk.event.id,
    toolUseId: chunk.event.toolUseId,
    contractId: chunk.event.contractId,
    path: chunk.event.path,
    paths: chunk.event.paths,
    toolName: chunk.event.toolName,
    reason: chunk.event.reason,
  })
  appStore.set(pendingScopeExpansionRequestsAtom, nextRequests)
}

function applyGuardAudit(
  context: RuntimeEventStateContext,
  chunk: GuardAuditChunk,
) {
  const currentAudits = appStore.get(guardedRunAuditsAtom)
  const nextAudits = new Map(currentAudits)
  nextAudits.set(context.subChatId, chunk.audit)
  appStore.set(guardedRunAuditsAtom, nextAudits)
}
