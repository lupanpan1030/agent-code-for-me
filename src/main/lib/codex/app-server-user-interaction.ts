import { randomUUID } from "node:crypto"
import {
  QUESTIONS_SKIPPED_MESSAGE,
  QUESTIONS_TIMED_OUT_MESSAGE,
  extractCodexAskUserQuestionAnswers,
  type CodexAskUserQuestion,
  type CodexAskUserQuestionApproval,
  type CodexAskUserQuestionOption,
  type CodexAskUserQuestionPending,
} from "./ask-user-question"

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }

export type CodexAppServerToolRequestUserInputOption = {
  label: string
  description: string
}

export type CodexAppServerToolRequestUserInputQuestion = {
  id: string
  header: string
  question: string
  isOther: boolean
  isSecret: boolean
  options: CodexAppServerToolRequestUserInputOption[] | null
}

export type CodexAppServerToolRequestUserInputParams = {
  threadId: string
  turnId: string
  itemId: string
  questions: CodexAppServerToolRequestUserInputQuestion[]
}

export type CodexAppServerToolRequestUserInputResponse = {
  answers: Record<string, { answers: string[] }>
}

export type CodexAppServerMcpElicitationPrimitiveSchema = {
  type: "string" | "number" | "integer" | "boolean" | "array"
  title?: string
  description?: string
  enum?: string[]
  enumNames?: string[]
  anyOf?: { const?: string; title?: string }[]
  items?: {
    enum?: string[]
    anyOf?: { const?: string; title?: string }[]
  }
}

export type CodexAppServerMcpElicitationSchema = {
  type: "object"
  properties: Record<string, CodexAppServerMcpElicitationPrimitiveSchema>
  required?: string[]
}

export type CodexAppServerMcpElicitationRequestParams = {
  threadId: string
  turnId: string | null
  serverName: string
  _meta: JsonValue | null
  message: string
} & (
  | {
      mode: "form"
      requestedSchema: CodexAppServerMcpElicitationSchema
    }
  | {
      mode: "url"
      url: string
      elicitationId: string
    }
)

export type CodexAppServerMcpElicitationRequestResponse = {
  action: "accept" | "decline" | "cancel"
  content: JsonValue | null
  _meta: JsonValue | null
}

export type CreateCodexAppServerUserInteractionBridgeInput = {
  subChatId: string
  isCurrentRunOwner?: () => boolean
  emit: (chunk: Record<string, unknown>) => void
  registerPending: (
    approvalId: string,
    pending: CodexAskUserQuestionPending,
  ) => void
  unregisterPending: (
    approvalId: string,
    pending: CodexAskUserQuestionPending,
  ) => boolean
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 60000
const SECRET_KEY_PATTERN =
  /(?:api[_-]?key|authorization|bearer|cookie|oauth|password|secret|token)/i

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeOptions(
  options: CodexAppServerToolRequestUserInputOption[] | null | undefined,
  isOther: boolean,
): CodexAskUserQuestionOption[] {
  const normalized = Array.isArray(options)
    ? options
        .map((option) => {
          const label = cleanText(option.label)
          if (!label) return null
          return {
            label,
            description: cleanText(option.description),
          }
        })
        .filter((option): option is CodexAskUserQuestionOption =>
          Boolean(option),
        )
    : []

  if (isOther && !normalized.some((option) => option.label === "Other")) {
    normalized.push({ label: "Other", description: "" })
  }

  return normalized
}

export function normalizeCodexAppServerUserInputQuestions(
  params: CodexAppServerToolRequestUserInputParams,
): CodexAskUserQuestion[] {
  return params.questions
    .map((question) => {
      const questionText = cleanText(question.question)
      if (!question.id || !questionText) return null
      const header = cleanText(question.header) || questionText
      return {
        question: questionText,
        header,
        options: normalizeOptions(question.options, Boolean(question.isOther)),
        multiSelect: false,
      }
    })
    .filter((question): question is CodexAskUserQuestion => Boolean(question))
}

function answerForQuestion(
  answersByPrompt: Record<string, string>,
  question: {
    id: string
    header: string
    question: string
  },
): string | null {
  return (
    answersByPrompt[question.id] ??
    answersByPrompt[question.question] ??
    answersByPrompt[question.header] ??
    null
  )
}

export function buildCodexAppServerUserInputResponse(
  params: CodexAppServerToolRequestUserInputParams,
  approval: CodexAskUserQuestionApproval,
): CodexAppServerToolRequestUserInputResponse {
  if (!approval.approved) return { answers: {} }

  const answersByPrompt = extractCodexAskUserQuestionAnswers(
    approval.updatedInput,
  )
  const answers: CodexAppServerToolRequestUserInputResponse["answers"] = {}

  for (const question of params.questions) {
    const answer = answerForQuestion(answersByPrompt, question)
    if (answer === null) continue
    answers[question.id] = { answers: [answer] }
  }

  return { answers }
}

function redactedUserInputResult(
  params: CodexAppServerToolRequestUserInputParams,
  response: CodexAppServerToolRequestUserInputResponse,
): JsonValue {
  const secretQuestionIds = new Set(
    params.questions
      .filter((question) => question.isSecret)
      .map((question) => question.id),
  )
  const answers: JsonObject = {}
  for (const [questionId, answer] of Object.entries(response.answers)) {
    answers[questionId] = {
      answers: secretQuestionIds.has(questionId)
        ? ["<redacted>"]
        : answer.answers,
    }
  }
  return { answers }
}

function enumOptions(
  schema: CodexAppServerMcpElicitationPrimitiveSchema,
): CodexAskUserQuestionOption[] {
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((value, index) => ({
      label: schema.enumNames?.[index] ?? value,
      description: "",
    }))
  }

  const titledOptions = schema.anyOf ?? schema.items?.anyOf
  if (Array.isArray(titledOptions)) {
    return titledOptions
      .map((option) => {
        const label = cleanText(option.title) || cleanText(option.const)
        if (!label) return null
        return { label, description: "" }
      })
      .filter((option): option is CodexAskUserQuestionOption =>
        Boolean(option),
      )
  }

  if (Array.isArray(schema.items?.enum)) {
    return schema.items.enum.map((value) => ({
      label: value,
      description: "",
    }))
  }

  return []
}

export function normalizeCodexAppServerMcpElicitationQuestions(
  params: CodexAppServerMcpElicitationRequestParams,
): CodexAskUserQuestion[] {
  if (params.mode === "url") {
    return [
      {
        header: params.serverName,
        question: `${params.message}\n${params.url}`,
        options: [
          { label: "Accept", description: "" },
          { label: "Decline", description: "" },
        ],
        multiSelect: false,
      },
    ]
  }

  const entries = Object.entries(params.requestedSchema.properties)
  if (entries.length === 0) {
    return [
      {
        header: params.serverName,
        question: params.message,
        options: [],
        multiSelect: false,
      },
    ]
  }

  return entries.map(([propertyName, schema]) => ({
    header: cleanText(schema.title) || propertyName,
    question: cleanText(schema.description) || cleanText(schema.title) || propertyName,
    options: enumOptions(schema),
    multiSelect: schema.type === "array",
  }))
}

function coerceMcpAnswer(
  rawAnswer: string,
  schema: CodexAppServerMcpElicitationPrimitiveSchema,
): JsonValue {
  if (schema.type === "boolean") {
    return /^(true|yes|y|1)$/i.test(rawAnswer)
  }
  if (schema.type === "number" || schema.type === "integer") {
    const value = Number(rawAnswer)
    return Number.isFinite(value) ? value : rawAnswer
  }
  if (schema.type === "array") {
    return rawAnswer
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return rawAnswer
}

function mcpActionForRejectedApproval(
  approval: CodexAskUserQuestionApproval,
): "decline" | "cancel" {
  return approval.message === QUESTIONS_TIMED_OUT_MESSAGE ? "cancel" : "decline"
}

export function buildCodexAppServerMcpElicitationResponse(
  params: CodexAppServerMcpElicitationRequestParams,
  approval: CodexAskUserQuestionApproval,
): CodexAppServerMcpElicitationRequestResponse {
  if (!approval.approved) {
    return {
      action: mcpActionForRejectedApproval(approval),
      content: null,
      _meta: null,
    }
  }

  if (params.mode === "url") {
    return {
      action: "accept",
      content: null,
      _meta: null,
    }
  }

  const answersByPrompt = extractCodexAskUserQuestionAnswers(
    approval.updatedInput,
  )
  const content: JsonObject = {}

  for (const [propertyName, schema] of Object.entries(
    params.requestedSchema.properties,
  )) {
    const answer =
      answersByPrompt[propertyName] ??
      answersByPrompt[schema.title ?? ""] ??
      answersByPrompt[schema.description ?? ""]
    if (answer === undefined) continue
    content[propertyName] = coerceMcpAnswer(answer, schema)
  }

  return {
    action: "accept",
    content,
    _meta: null,
  }
}

function redactedMcpContent(content: JsonValue | null): JsonValue | null {
  if (!isRecord(content)) return content

  const redacted: JsonObject = {}
  for (const [key, value] of Object.entries(content)) {
    redacted[key] = SECRET_KEY_PATTERN.test(key) ? "<redacted>" : value
  }
  return redacted
}

async function waitForApproval(input: {
  subChatId: string
  approvalId: string
  toolUseId: string
  questions: CodexAskUserQuestion[]
  timeoutMs: number
  emit: (chunk: Record<string, unknown>) => void
  registerPending: (
    approvalId: string,
    pending: CodexAskUserQuestionPending,
  ) => void
  unregisterPending: (
    approvalId: string,
    pending: CodexAskUserQuestionPending,
  ) => boolean
  isCurrentRunOwner: () => boolean
}): Promise<CodexAskUserQuestionApproval> {
  return new Promise<CodexAskUserQuestionApproval>((resolve) => {
    let settled = false
    let pending!: CodexAskUserQuestionPending
    const finish = (approval: CodexAskUserQuestionApproval) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      input.unregisterPending(input.approvalId, pending)
      resolve(approval)
    }
    const timeoutId = setTimeout(() => {
      const owned =
        input.unregisterPending(input.approvalId, pending) !== false
      if (owned) {
        input.emit({
          type: "ask-user-question-timeout",
          approvalId: input.approvalId,
          toolUseId: input.toolUseId,
        })
      }
      finish({
        approved: false,
        message: QUESTIONS_TIMED_OUT_MESSAGE,
      })
    }, input.timeoutMs)

    pending = {
      approvalId: input.approvalId,
      toolUseId: input.toolUseId,
      subChatId: input.subChatId,
      isCurrentRunOwner: input.isCurrentRunOwner,
      resolve: finish,
    }
    input.registerPending(input.approvalId, pending)
    input.emit({
      type: "ask-user-question",
      approvalId: input.approvalId,
      toolUseId: input.toolUseId,
      questions: input.questions,
    })
  })
}

export function createCodexAppServerUserInteractionBridge({
  subChatId,
  isCurrentRunOwner = () => true,
  emit,
  registerPending,
  unregisterPending,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: CreateCodexAppServerUserInteractionBridgeInput) {
  const runOwnerIsCurrent = (): boolean => {
    try {
      return isCurrentRunOwner()
    } catch {
      return false
    }
  }

  return {
    async handleUserInputRequest(input: {
      requestId: string
      params: CodexAppServerToolRequestUserInputParams
    }): Promise<CodexAppServerToolRequestUserInputResponse> {
      const toolUseId = `codex-app-server-user-input-${input.requestId}`
      const approvalId = `codex-approval-${randomUUID()}`
      const questions = normalizeCodexAppServerUserInputQuestions(input.params)

      if (questions.length === 0 || !runOwnerIsCurrent()) return { answers: {} }

      const approval = await waitForApproval({
        subChatId,
        approvalId,
        toolUseId,
        questions,
        timeoutMs,
        emit,
        registerPending,
        unregisterPending,
        isCurrentRunOwner: runOwnerIsCurrent,
      })
      const effectiveApproval = runOwnerIsCurrent()
        ? approval
        : { approved: false, message: "Codex run is no longer active." }

      const response = buildCodexAppServerUserInputResponse(
        input.params,
        effectiveApproval,
      )
      emit({
        type: "ask-user-question-result",
        approvalId,
        toolUseId,
        result: effectiveApproval.approved
          ? redactedUserInputResult(input.params, response)
          : effectiveApproval.message || QUESTIONS_SKIPPED_MESSAGE,
      })
      return response
    },

    async handleMcpElicitationRequest(input: {
      requestId: string
      params: CodexAppServerMcpElicitationRequestParams
    }): Promise<CodexAppServerMcpElicitationRequestResponse> {
      const toolUseId = `codex-app-server-mcp-elicitation-${input.requestId}`
      const approvalId = `codex-approval-${randomUUID()}`
      const questions = normalizeCodexAppServerMcpElicitationQuestions(
        input.params,
      )

      if (!runOwnerIsCurrent()) {
        return { action: "cancel", content: null, _meta: null }
      }
      const approval = await waitForApproval({
        subChatId,
        approvalId,
        toolUseId,
        questions,
        timeoutMs,
        emit,
        registerPending,
        unregisterPending,
        isCurrentRunOwner: runOwnerIsCurrent,
      })
      const effectiveApproval = runOwnerIsCurrent()
        ? approval
        : { approved: false, message: "Codex run is no longer active." }

      const response = buildCodexAppServerMcpElicitationResponse(
        input.params,
        effectiveApproval,
      )
      emit({
        type: "ask-user-question-result",
        approvalId,
        toolUseId,
        result: {
          action: response.action,
          content: redactedMcpContent(response.content),
        },
      })
      return response
    },
  }
}
