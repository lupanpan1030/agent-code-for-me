import { describe, expect, test } from "bun:test"
import {
  QUESTIONS_SKIPPED_MESSAGE,
  type CodexAskUserQuestionPending,
} from "../src/main/lib/codex/ask-user-question"
import { mapDesktopStreamChunkToRunEvents } from "../src/main/lib/agent-runtime/stream-event-mapper"
import {
  buildCodexAppServerMcpElicitationResponse,
  buildCodexAppServerUserInputResponse,
  createCodexAppServerUserInteractionBridge,
  normalizeCodexAppServerMcpElicitationQuestions,
  normalizeCodexAppServerUserInputQuestions,
  type CodexAppServerMcpElicitationRequestParams,
  type CodexAppServerToolRequestUserInputParams,
} from "../src/main/lib/codex/app-server-user-interaction"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function createHarness(timeoutMs = 1000) {
  const chunks: Record<string, any>[] = []
  const pending = new Map<string, CodexAskUserQuestionPending>()
  const bridge = createCodexAppServerUserInteractionBridge({
    subChatId: "subchat-1",
    timeoutMs,
    emit: (chunk) => chunks.push(chunk),
    registerPending: (approvalId, item) => pending.set(approvalId, item),
    unregisterPending: (approvalId, item) => {
      if (pending.get(approvalId) !== item) return false
      return pending.delete(approvalId)
    },
  })

  return { bridge, chunks, pending }
}

const userInputParams: CodexAppServerToolRequestUserInputParams = {
  threadId: "thread-1",
  turnId: "turn-1",
  itemId: "item-1",
  questions: [
    {
      id: "q-confirm",
      header: "Confirm",
      question: "Proceed?",
      isOther: true,
      isSecret: false,
      options: [{ label: "Yes", description: "Continue" }],
    },
    {
      id: "q-token",
      header: "Token",
      question: "Enter token",
      isOther: false,
      isSecret: true,
      options: null,
    },
  ],
}

describe("Codex app-server user interaction bridge", () => {
  test("normalizes requestUserInput questions into the shared desktop question shape", () => {
    expect(normalizeCodexAppServerUserInputQuestions(userInputParams)).toEqual([
      {
        question: "Proceed?",
        header: "Confirm",
        options: [
          { label: "Yes", description: "Continue" },
          { label: "Other", description: "" },
        ],
        multiSelect: false,
      },
      {
        question: "Enter token",
        header: "Token",
        options: [],
        multiSelect: false,
      },
    ])
  })

  test("bridges requestUserInput pending and answer events without exposing secret answers", async () => {
    const { bridge, chunks, pending } = createHarness()
    const promise = bridge.handleUserInputRequest({
      requestId: "req-1",
      params: userInputParams,
    })

    expect(chunks[0]).toMatchObject({
      type: "ask-user-question",
      toolUseId: "codex-app-server-user-input-req-1",
      questions: [{ question: "Proceed?" }, { question: "Enter token" }],
    })
    const approvalId = chunks[0].approvalId
    const toolUseId = chunks[0].toolUseId
    expect(pending.has(approvalId)).toBe(true)

    pending.get(approvalId)?.resolve({
      approved: true,
      updatedInput: {
        answers: {
          "Proceed?": "Yes",
          "Enter token": "secret-token-value",
        },
      },
    })

    await expect(promise).resolves.toEqual({
      answers: {
        "q-confirm": { answers: ["Yes"] },
        "q-token": { answers: ["secret-token-value"] },
      },
    })
    expect(pending.has(approvalId)).toBe(false)
    expect(chunks.at(-1)).toEqual({
      type: "ask-user-question-result",
      approvalId,
      toolUseId,
      result: {
        answers: {
          "q-confirm": { answers: ["Yes"] },
          "q-token": { answers: ["<redacted>"] },
        },
      },
    })

    const mappedEvents = chunks.flatMap((chunk, index) =>
      mapDesktopStreamChunkToRunEvents({
        runtimeId: "codex",
        runId: "run-app-server",
        jobId: "job-app-server",
        sequence: index + 1,
        chunk,
      }),
    )
    expect(mappedEvents.map((event) => event.type)).toEqual([
      "question_pending",
      "question_result",
    ])
  })

  test("returns empty requestUserInput answers for skipped and timed-out questions", async () => {
    expect(
      buildCodexAppServerUserInputResponse(userInputParams, {
        approved: false,
        message: QUESTIONS_SKIPPED_MESSAGE,
      }),
    ).toEqual({ answers: {} })

    const { bridge, chunks, pending } = createHarness(5)
    const promise = bridge.handleUserInputRequest({
      requestId: "req-timeout",
      params: userInputParams,
    })
    const { approvalId, toolUseId } = chunks[0]

    await sleep(20)

    await expect(promise).resolves.toEqual({ answers: {} })
    expect(pending.has(approvalId)).toBe(false)
    expect(chunks).toContainEqual({
      type: "ask-user-question-timeout",
      approvalId,
      toolUseId,
    })
    expect(chunks.at(-1)).toEqual({
      type: "ask-user-question-result",
      approvalId,
      toolUseId,
      result: "Timed out",
    })
  })

  test("normalizes MCP form elicitation and returns accepted structured content", async () => {
    const params: CodexAppServerMcpElicitationRequestParams = {
      threadId: "thread-1",
      turnId: "turn-1",
      serverName: "linear",
      mode: "form",
      _meta: null,
      message: "Create an issue",
      requestedSchema: {
        type: "object",
        properties: {
          priority: {
            type: "string",
            title: "Priority",
            description: "Choose priority",
            enum: ["low", "high"],
          },
          apiToken: {
            type: "string",
            title: "API token",
            description: "Token",
          },
        },
        required: ["priority"],
      },
    }
    const { bridge, chunks, pending } = createHarness()
    const promise = bridge.handleMcpElicitationRequest({
      requestId: "mcp-1",
      params,
    })

    expect(normalizeCodexAppServerMcpElicitationQuestions(params)).toEqual([
      {
        header: "Priority",
        question: "Choose priority",
        options: [
          { label: "low", description: "" },
          { label: "high", description: "" },
        ],
        multiSelect: false,
      },
      {
        header: "API token",
        question: "Token",
        options: [],
        multiSelect: false,
      },
    ])

    const { approvalId, toolUseId } = chunks[0]
    pending.get(approvalId)?.resolve({
      approved: true,
      updatedInput: {
        answers: {
          "Choose priority": "high",
          Token: "mcp-secret-token",
        },
      },
    })

    await expect(promise).resolves.toEqual({
      action: "accept",
      content: {
        priority: "high",
        apiToken: "mcp-secret-token",
      },
      _meta: null,
    })
    expect(chunks.at(-1)).toEqual({
      type: "ask-user-question-result",
      approvalId,
      toolUseId,
      result: {
        action: "accept",
        content: {
          priority: "high",
          apiToken: "<redacted>",
        },
      },
    })
  })

  test("maps MCP url elicitation and rejection decisions", () => {
    const params: CodexAppServerMcpElicitationRequestParams = {
      threadId: "thread-1",
      turnId: null,
      serverName: "browser",
      mode: "url",
      _meta: null,
      message: "Open OAuth URL?",
      url: "https://example.test/oauth",
      elicitationId: "elicitation-1",
    }

    expect(normalizeCodexAppServerMcpElicitationQuestions(params)).toEqual([
      {
        header: "browser",
        question: "Open OAuth URL?\nhttps://example.test/oauth",
        options: [
          { label: "Accept", description: "" },
          { label: "Decline", description: "" },
        ],
        multiSelect: false,
      },
    ])
    expect(
      buildCodexAppServerMcpElicitationResponse(params, {
        approved: false,
        message: QUESTIONS_SKIPPED_MESSAGE,
      }),
    ).toEqual({
      action: "decline",
      content: null,
      _meta: null,
    })
    expect(
      buildCodexAppServerMcpElicitationResponse(params, {
        approved: false,
        message: "Timed out",
      }),
    ).toEqual({
      action: "cancel",
      content: null,
      _meta: null,
    })
  })
})
