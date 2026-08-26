import { randomUUID } from "node:crypto"
import type {
  Options as ClaudeAgentSdkOptions,
  HookCallback,
  HookJSONOutput,
  PermissionResult,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk"
import type { AgentGuardEvent } from "../../../shared/agent-scope-contracts"
import {
  classifyObservedToolRisk,
  decideClaudeToolUse,
  registerActiveGuardedScopeExpansionRequest,
  resolveGuardedScopedShellWriteApproval,
  toClaudePermissionResult,
  type ValidatedAgentScopeContract,
} from "../agent-guard"
import type { DesktopPermissionPolicy } from "../agent-runtime/permission-policy"
import { decideAssistantToolPermission } from "../agent-runtime/permission-policy"
import type { UIMessageChunk } from "./types"

export type ClaudeAgentSdkCanUseTool = NonNullable<
  ClaudeAgentSdkOptions["canUseTool"]
>

export type ClaudeAgentSdkPreToolUseHook = HookCallback

export type ClaudeAgentSdkPermissionControls = {
  canUseTool: ClaudeAgentSdkCanUseTool
  preToolUseHook: ClaudeAgentSdkPreToolUseHook
}

export type ClaudeAskUserQuestionDecision = {
  approved: boolean
  message?: string
  updatedInput?: unknown
}

export type ClaudeAskUserQuestionPending = {
  approvalId: string
  toolUseId: string
  subChatId: string
  toolName: string
  toolInput: Record<string, unknown>
  approvalInput?: {
    questions: AskUserQuestionChunk["questions"]
  }
  isCurrentRunOwner: () => boolean
  resolve: (decision: ClaudeAskUserQuestionDecision) => void
}

export type CreateClaudeAgentSdkToolPermissionHandlerInput = {
  isUsingOllama: boolean
  permissionPolicy: DesktopPermissionPolicy
  guardedContract: ValidatedAgentScopeContract | null
  isGuardedContractCurrent: (contract: ValidatedAgentScopeContract) => boolean
  recordGuardEvent: (event: AgentGuardEvent) => void
  emit: (chunk: UIMessageChunk) => void
  subChatId: string
  isCurrentRunOwner?: () => boolean
  pendingToolApprovals: Map<string, ClaudeAskUserQuestionPending>
  parts: Array<Record<string, any>>
}

const PLAN_MODE_BLOCKED_TOOLS = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "Bash",
])

const APPROVE_OPTION_LABEL = "Approve"
const DENY_OPTION_LABEL = "Deny"

type AskUserQuestionChunk = Extract<
  UIMessageChunk,
  { type: "ask-user-question" }
>

function createGuardedShellApprovalQuestions(
  reason: string,
): AskUserQuestionChunk["questions"] {
  return [
    {
      header: "Scoped shell write",
      question: reason,
      options: [
        {
          label: APPROVE_OPTION_LABEL,
          description: "Allow this bounded shell file operation once.",
        },
        {
          label: DENY_OPTION_LABEL,
          description: "Block this shell file operation.",
        },
      ],
      multiSelect: false,
    },
  ]
}

function approvalAnswers(
  decision: ClaudeAskUserQuestionDecision,
): Record<string, unknown> {
  const updatedInput = decision.updatedInput
  if (
    !updatedInput ||
    typeof updatedInput !== "object" ||
    !("answers" in updatedInput) ||
    typeof (updatedInput as { answers?: unknown }).answers !== "object" ||
    (updatedInput as { answers?: unknown }).answers === null
  ) {
    return {}
  }

  return (updatedInput as { answers: Record<string, unknown> }).answers
}

function approvalSelected(
  decision: ClaudeAskUserQuestionDecision,
  label: string,
): boolean {
  return Object.values(approvalAnswers(decision)).some((answer) => {
    if (typeof answer === "string") return answer === label
    if (Array.isArray(answer)) return answer.includes(label)
    return false
  })
}

function approvalAccepted(decision: ClaudeAskUserQuestionDecision): boolean {
  return (
    decision.approved &&
    approvalSelected(decision, APPROVE_OPTION_LABEL) &&
    !approvalSelected(decision, DENY_OPTION_LABEL)
  )
}

function fixOllamaToolInputAliases(
  toolName: string,
  toolInput: Record<string, unknown>,
): void {
  if (
    (toolName === "Read" || toolName === "Write" || toolName === "Edit") &&
    toolInput.file &&
    !toolInput.file_path
  ) {
    toolInput.file_path = toolInput.file
    delete toolInput.file
    console.log(`[Ollama] Fixed ${toolName} tool: file -> file_path`)
  }

  if (toolName === "Glob") {
    if (toolInput.directory && !toolInput.path) {
      toolInput.path = toolInput.directory
      delete toolInput.directory
      console.log("[Ollama] Fixed Glob tool: directory -> path")
    }
    if (toolInput.dir && !toolInput.path) {
      toolInput.path = toolInput.dir
      delete toolInput.dir
      console.log("[Ollama] Fixed Glob tool: dir -> path")
    }
  }

  if (toolName === "Grep") {
    if (toolInput.query && !toolInput.pattern) {
      toolInput.pattern = toolInput.query
      delete toolInput.query
      console.log("[Ollama] Fixed Grep tool: query -> pattern")
    }
    if (toolInput.directory && !toolInput.path) {
      toolInput.path = toolInput.directory
      delete toolInput.directory
      console.log("[Ollama] Fixed Grep tool: directory -> path")
    }
  }

  if (toolName === "Bash" && toolInput.cmd && !toolInput.command) {
    toolInput.command = toolInput.cmd
    delete toolInput.cmd
    console.log("[Ollama] Fixed Bash tool: cmd -> command")
  }
}

function isPreToolUseHookInput(
  input: Parameters<HookCallback>[0],
): input is PreToolUseHookInput {
  return input.hook_event_name === "PreToolUse"
}

function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return { ...(input as Record<string, unknown>) }
  }
  return {}
}

function toClaudePreToolUseHookOutput(
  decision: PermissionResult,
): HookJSONOutput {
  if (decision.behavior === "deny") {
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: decision.message,
      },
    }
  }

  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      ...(decision.updatedInput ? { updatedInput: decision.updatedInput } : {}),
    },
  }
}

export function createClaudeAgentSdkPermissionControls({
  isUsingOllama,
  permissionPolicy,
  guardedContract,
  isGuardedContractCurrent,
  recordGuardEvent,
  emit,
  subChatId,
  isCurrentRunOwner = () => true,
  pendingToolApprovals,
  parts,
}: CreateClaudeAgentSdkToolPermissionHandlerInput): ClaudeAgentSdkPermissionControls {
  const preToolUseDecisions = new Map<string, PermissionResult>()
  const runOwnerIsCurrent = (): boolean => {
    try {
      return isCurrentRunOwner()
    } catch {
      return false
    }
  }
  const guardedOwnerIsCurrent = (): boolean => {
    if (!guardedContract) return true
    try {
      return (
        guardedContract.subChatId === subChatId &&
        isGuardedContractCurrent(guardedContract)
      )
    } catch {
      return false
    }
  }
  const callbackAuthorityIsCurrent = (): boolean =>
    runOwnerIsCurrent() && guardedOwnerIsCurrent()
  const staleRunMessage = (): string =>
    runOwnerIsCurrent()
      ? "Guarded run is no longer active."
      : "Claude run is no longer active."
  const staleRunDecision = (): PermissionResult => ({
    behavior: "deny",
    message: staleRunMessage(),
  })
  const deletePendingIfCurrent = (
    approvalId: string,
    pending: ClaudeAskUserQuestionPending,
  ): boolean => {
    if (pendingToolApprovals.get(approvalId) !== pending) return false
    return pendingToolApprovals.delete(approvalId)
  }
  const waitForUserApproval = (input: {
    toolUseId: string
    toolName: string
    toolInput: Record<string, unknown>
    questions: AskUserQuestionChunk["questions"]
    approvalInput?: ClaudeAskUserQuestionPending["approvalInput"]
  }): Promise<{
    approvalId: string
    response: ClaudeAskUserQuestionDecision
  }> => {
    const approvalId = `claude-approval-${randomUUID()}`
    return new Promise((resolve) => {
      let settled = false
      let pending!: ClaudeAskUserQuestionPending
      const finish = (response: ClaudeAskUserQuestionDecision) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        deletePendingIfCurrent(approvalId, pending)
        resolve({ approvalId, response })
      }
      const timeoutId = setTimeout(() => {
        const owned = deletePendingIfCurrent(approvalId, pending)
        if (owned) {
          emit({
            type: "ask-user-question-timeout",
            approvalId,
            toolUseId: input.toolUseId,
          })
        }
        finish({ approved: false, message: "Timed out" })
      }, 60000)

      pending = {
        approvalId,
        toolUseId: input.toolUseId,
        subChatId,
        toolName: input.toolName,
        toolInput: { ...input.toolInput },
        ...(input.approvalInput ? { approvalInput: input.approvalInput } : {}),
        isCurrentRunOwner: callbackAuthorityIsCurrent,
        resolve: finish,
      }
      pendingToolApprovals.set(approvalId, pending)
      emit({
        type: "ask-user-question",
        approvalId,
        toolUseId: input.toolUseId,
        questions: input.questions,
      })
    })
  }

  const decideToolPermission = async ({
    toolName,
    toolInput,
    toolUseID,
    handleAskUserQuestion,
  }: {
    toolName: string
    toolInput: Record<string, unknown>
    toolUseID: string
    handleAskUserQuestion: boolean
  }): Promise<PermissionResult> => {
    if (!callbackAuthorityIsCurrent()) return staleRunDecision()

    if (isUsingOllama) {
      fixOllamaToolInputAliases(toolName, toolInput)
    }

    if (permissionPolicy.controlLevel === "assistant") {
      const decision = decideAssistantToolPermission({ toolName })
      if (decision.decision === "deny") {
        return {
          behavior: "deny",
          message: decision.message || "Assistant mode blocked tool use.",
        }
      }
      if (!callbackAuthorityIsCurrent()) return staleRunDecision()
      return {
        behavior: "allow",
        updatedInput: toolInput,
      }
    }

    if (permissionPolicy.planWorkspaceSideEffects === "deny") {
      if (toolName === "ExitPlanMode") {
        return {
          behavior: "deny",
          message:
            "IMPORTANT: DONT IMPLEMENT THE PLAN UNTIL THE EXPLIT COMMAND. THE PLAN WAS **ONLY** PRESENTED TO USER, FINISH CURRENT MESSAGE AS SOON AS POSSIBLE",
        }
      }
      if (PLAN_MODE_BLOCKED_TOOLS.has(toolName)) {
        return {
          behavior: "deny",
          message: `Tool "${toolName}" blocked in plan mode.`,
        }
      }
    }

    if (
      guardedContract &&
      permissionPolicy.enforcement === "locus-guarded-tool-policy" &&
      toolName !== "AskUserQuestion"
    ) {
      if (!guardedOwnerIsCurrent()) {
        return {
          behavior: "deny",
          message: "Guarded run is no longer active.",
        }
      }
      const approval = resolveGuardedScopedShellWriteApproval({
        contract: guardedContract,
        toolName,
        toolInput,
        toolUseId: toolUseID,
      })
      if (approval?.decision === "allow" && approval.requiresUserApproval) {
        recordGuardEvent(approval.event)
        emit({
          type: "guard-event",
          event: approval.event,
        })

        const questions = createGuardedShellApprovalQuestions(approval.reason)
        const { approvalId, response } = await waitForUserApproval({
          toolUseId: toolUseID,
          toolName,
          toolInput,
          questions,
          approvalInput: { questions },
        })

        if (!callbackAuthorityIsCurrent()) {
          const errorMessage = "Guarded run is no longer active."
          emit({
            type: "ask-user-question-result",
            approvalId,
            toolUseId: toolUseID,
            result: errorMessage,
          })
          return {
            behavior: "deny",
            message: errorMessage,
          }
        }

        if (!approvalAccepted(response)) {
          const errorMessage = response.message || "Denied"
          emit({
            type: "ask-user-question-result",
            approvalId,
            toolUseId: toolUseID,
            result: errorMessage,
          })
          return {
            behavior: "deny",
            message: errorMessage,
          }
        }

        emit({
          type: "ask-user-question-result",
          approvalId,
          toolUseId: toolUseID,
          result: "approved",
        })
        if (!callbackAuthorityIsCurrent()) return staleRunDecision()
        return {
          behavior: "allow",
          updatedInput: approval.updatedInput,
        }
      }

      const decision = decideClaudeToolUse({
        contract: guardedContract,
        toolName,
        toolInput,
        toolUseId: toolUseID,
      })
      if (
        decision.decision === "request-expansion" &&
        !registerActiveGuardedScopeExpansionRequest({
          contract: guardedContract,
          event: decision.event,
        })
      ) {
        return {
          behavior: "deny",
          message: "Guarded run is no longer active.",
        }
      }
      recordGuardEvent(decision.event)
      emit({
        type: "guard-event",
        event: decision.event,
      })
      if (!callbackAuthorityIsCurrent()) return staleRunDecision()
      return toClaudePermissionResult(decision)
    }

    if (toolName === "AskUserQuestion") {
      if (!handleAskUserQuestion) {
        if (!callbackAuthorityIsCurrent()) return staleRunDecision()
        return {
          behavior: "allow",
          updatedInput: toolInput,
        }
      }

      const { approvalId, response } = await waitForUserApproval({
        toolUseId: toolUseID,
        toolName: "AskUserQuestion",
        toolInput,
        questions: (toolInput as any).questions,
      })

      const askToolPart = parts.find(
        (part) =>
          part.toolCallId === toolUseID && part.type === "tool-AskUserQuestion",
      )

      if (!response.approved || !callbackAuthorityIsCurrent()) {
        const errorMessage = callbackAuthorityIsCurrent()
          ? response.message || "Skipped"
          : staleRunMessage()
        if (askToolPart) {
          askToolPart.result = errorMessage
          askToolPart.state = "result"
        }
        emit({
          type: "ask-user-question-result",
          approvalId,
          toolUseId: toolUseID,
          result: errorMessage,
        })
        return {
          behavior: "deny",
          message: errorMessage,
        }
      }

      const answers = (response.updatedInput as any)?.answers
      const answerResult = { answers }
      if (askToolPart) {
        askToolPart.result = answerResult
        askToolPart.state = "result"
      }
      emit({
        type: "ask-user-question-result",
        approvalId,
        toolUseId: toolUseID,
        result: answerResult,
      })
      if (!callbackAuthorityIsCurrent()) return staleRunDecision()
      return {
        behavior: "allow",
        updatedInput: response.updatedInput as Record<string, unknown>,
      }
    }

    if (
      permissionPolicy.controlLevel === "observe" &&
      permissionPolicy.observedToolPolicy.enabled
    ) {
      const risk = classifyObservedToolRisk({
        toolName,
        toolInput,
        toolUseId: toolUseID,
      })
      const shouldDeny =
        risk.catastrophic &&
        permissionPolicy.observedToolPolicy.blocksCatastrophicActions
      const message = `Observed mode blocked ${toolName}: ${risk.reason}`
      emit({
        type: "observed-tool-decision",
        controlLevel: "observe",
        decision: shouldDeny ? "deny" : "allow",
        risk,
        ...(shouldDeny ? { message } : {}),
      })
      if (shouldDeny) {
        return {
          behavior: "deny",
          message,
        }
      }
    }

    if (!callbackAuthorityIsCurrent()) return staleRunDecision()
    return {
      behavior: "allow",
      updatedInput: toolInput,
    }
  }

  const canUseTool: ClaudeAgentSdkCanUseTool = async (
    toolName,
    toolInput,
    options,
  ) => {
    if (!callbackAuthorityIsCurrent()) return staleRunDecision()
    const cachedDecision = preToolUseDecisions.get(options.toolUseID)
    if (cachedDecision && toolName !== "AskUserQuestion") {
      preToolUseDecisions.delete(options.toolUseID)
      if (
        guardedContract &&
        permissionPolicy.enforcement === "locus-guarded-tool-policy" &&
        !guardedOwnerIsCurrent()
      ) {
        return {
          behavior: "deny",
          message: "Guarded run is no longer active.",
        }
      }
      return callbackAuthorityIsCurrent() ? cachedDecision : staleRunDecision()
    }

    const decision = await decideToolPermission({
      toolName,
      toolInput,
      toolUseID: options.toolUseID,
      handleAskUserQuestion: true,
    })
    return callbackAuthorityIsCurrent() ? decision : staleRunDecision()
  }

  const preToolUseHook: ClaudeAgentSdkPreToolUseHook = async (
    hookInput,
    toolUseID,
  ) => {
    if (!isPreToolUseHookInput(hookInput)) {
      return { continue: true }
    }

    if (!callbackAuthorityIsCurrent()) {
      return toClaudePreToolUseHookOutput(staleRunDecision())
    }

    const resolvedToolUseID =
      hookInput.tool_use_id || toolUseID || "unknown-tool-use"
    if (hookInput.tool_name === "AskUserQuestion") {
      return { continue: true }
    }

    const decision = await decideToolPermission({
      toolName: hookInput.tool_name,
      toolInput: normalizeToolInput(hookInput.tool_input),
      toolUseID: resolvedToolUseID,
      handleAskUserQuestion: false,
    })
    const effectiveDecision = callbackAuthorityIsCurrent()
      ? decision
      : staleRunDecision()
    if (callbackAuthorityIsCurrent()) {
      preToolUseDecisions.set(resolvedToolUseID, effectiveDecision)
    }
    return toClaudePreToolUseHookOutput(effectiveDecision)
  }

  return {
    canUseTool,
    preToolUseHook,
  }
}

export function createClaudeAgentSdkToolPermissionHandler(
  input: CreateClaudeAgentSdkToolPermissionHandlerInput,
): ClaudeAgentSdkCanUseTool {
  return createClaudeAgentSdkPermissionControls(input).canUseTool
}
