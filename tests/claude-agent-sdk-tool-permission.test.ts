import { afterEach, describe, expect, mock, test } from "bun:test"
import { join } from "node:path"
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk"
import {
  getClaudePermissionMapping,
  resolveDesktopPermissionPolicy,
} from "../src/main/lib/agent-runtime/permission-policy"
import type { ClaudeAskUserQuestionPending } from "../src/main/lib/claude/agent-sdk-tool-permission"
import type { UIMessageChunk } from "../src/main/lib/claude/types"
import type { AgentScopeContract } from "../src/shared/agent-scope-contracts"

mock.module("electron", () => ({
  app: {
    getPath(name: string) {
      if (name !== "userData") {
        throw new Error(`unexpected app path request: ${name}`)
      }
      return join(process.cwd(), ".tmp-test-user-data")
    },
    isPackaged: false,
  },
}))

const {
  createClaudeAgentSdkPermissionControls,
  createClaudeAgentSdkToolPermissionHandler,
} = await import("../src/main/lib/claude/agent-sdk-tool-permission")
const {
  clearActiveGuardedContractsForTest,
  hasPendingActiveGuardedScopeExpansionForTest,
  isActiveGuardedContract,
  replaceActiveGuardedContractForSubChat,
  validateAgentScopeContract,
} = await import("../src/main/lib/agent-guard")

const cwd = join(process.cwd(), "example-project")

afterEach(() => {
  clearActiveGuardedContractsForTest()
})

function pendingForTool(
  pending: Map<string, ClaudeAskUserQuestionPending>,
  toolUseId: string,
): ClaudeAskUserQuestionPending | undefined {
  return [...pending.values()].find((item) => item.toolUseId === toolUseId)
}

function toolOptions(toolUseID: string) {
  return {
    toolUseID,
    signal: new AbortController().signal,
  } as any
}

function baseHandlerInput(
  overrides: Partial<
    Parameters<typeof createClaudeAgentSdkToolPermissionHandler>[0]
  > = {},
) {
  return {
    isUsingOllama: false,
    permissionPolicy: resolveDesktopPermissionPolicy({
      runtimeId: "claude-code",
      mode: "agent",
    }),
    guardedContract: null,
    isGuardedContractCurrent: () => false,
    recordGuardEvent: () => {},
    emit: () => {},
    subChatId: "sub-1",
    pendingToolApprovals: new Map<string, ClaudeAskUserQuestionPending>(),
    parts: [],
    ...overrides,
  }
}

function baseContract(): AgentScopeContract {
  return {
    id: "contract-1",
    version: 1,
    status: "approved",
    createdAt: "2026-06-07T00:00:00.000Z",
    approvedAt: "2026-06-07T00:00:01.000Z",
    source: "manual",
    chatId: "chat-1",
    subChatId: "sub-1",
    runId: "run-1",
    cwd,
    projectPath: cwd,
    editableScope: [{ path: "src/app.ts", kind: "file" }],
    readOnlyEvidence: [{ path: "tests/app.test.ts", kind: "file" }],
    successChecks: [{ command: "bun test tests/app.test.ts" }],
    blockedPaths: [],
    expansions: [],
  }
}

describe("Claude Agent SDK tool permission handler", () => {
  test("repairs Ollama tool aliases and blocks plan-mode workspace side effects", async () => {
    const handler = createClaudeAgentSdkToolPermissionHandler(
      baseHandlerInput({
        isUsingOllama: true,
        permissionPolicy: resolveDesktopPermissionPolicy({
          runtimeId: "claude-code",
          mode: "plan",
        }),
      }),
    )
    const readInput: Record<string, unknown> = { file: "src/app.ts" }

    const readResult = await handler("Read", readInput, toolOptions("tool-1"))
    expect(readResult).toEqual({
      behavior: "allow",
      updatedInput: { file_path: "src/app.ts" },
    })
    expect(readInput).toEqual({ file_path: "src/app.ts" })

    for (const [index, toolName] of [
      "Edit",
      "Write",
      "MultiEdit",
      "NotebookEdit",
      "Bash",
    ].entries()) {
      const writeResult = await handler(
        toolName,
        { file_path: "src/app.ts", command: "echo unsafe" },
        toolOptions(`plan-blocked-${index}`),
      )
      expect(writeResult.behavior).toBe("deny")
      expect(writeResult.message).toContain("blocked in plan mode")
    }
  })

  test("enforces assistant web-only allow-list before Claude tools run", async () => {
    const controls = createClaudeAgentSdkPermissionControls(
      baseHandlerInput({
        permissionPolicy: resolveDesktopPermissionPolicy({
          runtimeId: "claude-code",
          mode: "agent",
          workspaceKind: "folderless",
        }),
      }),
    )

    await expect(
      controls.canUseTool(
        "WebSearch",
        { query: "OpenAI" },
        toolOptions("assistant-web-1"),
      ),
    ).resolves.toEqual({
      behavior: "allow",
      updatedInput: { query: "OpenAI" },
    })

    await expect(
      controls.canUseTool(
        "Read",
        { file_path: "src/app.ts" },
        toolOptions("assistant-read-1"),
      ),
    ).resolves.toMatchObject({
      behavior: "deny",
      message: expect.stringContaining("filesystem tools are unavailable"),
    })

    const assistantTodoHookInput: PreToolUseHookInput = {
      hook_event_name: "PreToolUse",
      tool_name: "TodoWrite",
      tool_input: { todos: [] },
      tool_use_id: "assistant-unknown-1",
    }
    const preToolUseResult = await controls.preToolUseHook(
      assistantTodoHookInput,
      "assistant-unknown-1",
      { signal: new AbortController().signal },
    )

    expect(preToolUseResult).toMatchObject({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining(
          "runtime mutation tools are unavailable",
        ),
      },
    })
  })

  test("bridges AskUserQuestion through pending approval state", async () => {
    const pendingToolApprovals = new Map<string, ClaudeAskUserQuestionPending>()
    const emitted: any[] = []
    const parts: Array<Record<string, any>> = [
      {
        type: "tool-AskUserQuestion",
        toolCallId: "ask-1",
        state: "call",
      },
    ]
    const handler = createClaudeAgentSdkToolPermissionHandler(
      baseHandlerInput({
        pendingToolApprovals,
        parts,
        emit: (chunk) => {
          emitted.push(chunk)
        },
      }),
    )

    const resultPromise = handler(
      "AskUserQuestion",
      {
        questions: [
          {
            question: "Proceed?",
            header: "Confirm",
            options: [{ label: "Yes", description: "Continue." }],
            multiSelect: false,
          },
        ],
      },
      toolOptions("ask-1"),
    )

    const pending = pendingForTool(pendingToolApprovals, "ask-1")
    expect(pending).toBeDefined()
    pending?.resolve({
      approved: true,
      updatedInput: { answers: ["Yes"] },
    })

    const result = await resultPromise
    expect(result).toEqual({
      behavior: "allow",
      updatedInput: { answers: ["Yes"] },
    })
    expect(parts[0]).toMatchObject({
      state: "result",
      result: { answers: ["Yes"] },
    })
    expect(emitted.map((chunk) => chunk.type)).toEqual([
      "ask-user-question",
      "ask-user-question-result",
    ])
  })

  test("delegates guarded tool decisions to the guard owner", async () => {
    const guardedContract = await validateAgentScopeContract(baseContract(), {
      cwd,
      projectPath: cwd,
      chatId: "chat-1",
      subChatId: "sub-1",
      runId: "run-1",
      requireRegisteredWorktree: false,
    })
    const guardEvents: any[] = []
    const emitted: any[] = []
    const permissionPolicy = resolveDesktopPermissionPolicy({
      runtimeId: "claude-code",
      mode: "agent",
      hasScopeContract: true,
    })
    expect(
      getClaudePermissionMapping(permissionPolicy).requiresToolPolicy,
    ).toBe(true)

    const handler = createClaudeAgentSdkToolPermissionHandler(
      baseHandlerInput({
        permissionPolicy,
        guardedContract,
        isGuardedContractCurrent: (contract) => contract === guardedContract,
        recordGuardEvent: (event) => {
          guardEvents.push(event)
        },
        emit: (chunk) => {
          emitted.push(chunk)
        },
      }),
    )

    const result = await handler(
      "Edit",
      { file_path: "src/app.ts" },
      toolOptions("tool-1"),
    )

    expect(result.behavior).toBe("allow")
    expect(guardEvents).toHaveLength(1)
    expect(guardEvents[0]).toMatchObject({ type: "allowed" })
    expect(emitted).toEqual([
      {
        type: "guard-event",
        event: guardEvents[0],
      },
    ])
  })

  test("denies a stale guarded handler when a broader same-ID contract replaces it", async () => {
    const guardedContract = await validateAgentScopeContract(baseContract(), {
      cwd,
      projectPath: cwd,
      chatId: "chat-1",
      subChatId: "sub-1",
      runId: "run-1",
      requireRegisteredWorktree: false,
    })
    const replacementContract = await validateAgentScopeContract(
      {
        ...baseContract(),
        runId: "run-2",
        editableScope: [{ path: "src", kind: "directory" }],
      },
      {
        cwd,
        projectPath: cwd,
        chatId: "chat-1",
        subChatId: "sub-1",
        runId: "run-2",
        requireRegisteredWorktree: false,
      },
    )
    const guardEvents: unknown[] = []
    const handler = createClaudeAgentSdkToolPermissionHandler(
      baseHandlerInput({
        permissionPolicy: resolveDesktopPermissionPolicy({
          runtimeId: "claude-code",
          mode: "agent",
          hasScopeContract: true,
        }),
        guardedContract,
        isGuardedContractCurrent: (contract) =>
          contract === replacementContract,
        recordGuardEvent: (event) => guardEvents.push(event),
      }),
    )

    await expect(
      handler(
        "Edit",
        { file_path: "src/replacement-only.ts" },
        toolOptions("stale-guard-tool"),
      ),
    ).resolves.toEqual({
      behavior: "deny",
      message: "Guarded run is no longer active.",
    })
    expect(guardEvents).toEqual([])
  })

  test("denies a stale guarded handler when a different-ID contract replaces it", async () => {
    const guardedContract = await validateAgentScopeContract(baseContract(), {
      cwd,
      projectPath: cwd,
      chatId: "chat-1",
      subChatId: "sub-1",
      runId: "run-1",
      requireRegisteredWorktree: false,
    })
    const replacementContract = await validateAgentScopeContract(
      {
        ...baseContract(),
        id: "contract-2",
        runId: "run-2",
        editableScope: [{ path: "src", kind: "directory" }],
      },
      {
        cwd,
        projectPath: cwd,
        chatId: "chat-1",
        subChatId: "sub-1",
        runId: "run-2",
        requireRegisteredWorktree: false,
      },
    )
    let currentContract = guardedContract
    const handler = createClaudeAgentSdkToolPermissionHandler(
      baseHandlerInput({
        permissionPolicy: resolveDesktopPermissionPolicy({
          runtimeId: "claude-code",
          mode: "agent",
          hasScopeContract: true,
        }),
        guardedContract,
        isGuardedContractCurrent: (contract) => contract === currentContract,
      }),
    )

    currentContract = replacementContract

    await expect(
      handler(
        "Edit",
        { file_path: "src/replacement-only.ts" },
        toolOptions("different-id-stale-guard-tool"),
      ),
    ).resolves.toEqual({
      behavior: "deny",
      message: "Guarded run is no longer active.",
    })
  })

  test("isolates same-ID cross-chat contracts before rejecting a replaced capture", async () => {
    const first = await validateAgentScopeContract(baseContract(), {
      cwd,
      projectPath: cwd,
      chatId: "chat-1",
      subChatId: "sub-1",
      runId: "run-1",
      requireRegisteredWorktree: false,
    })
    const second = await validateAgentScopeContract(
      {
        ...baseContract(),
        chatId: "chat-2",
        subChatId: "sub-2",
        runId: "run-2",
      },
      {
        cwd,
        projectPath: cwd,
        chatId: "chat-2",
        subChatId: "sub-2",
        runId: "run-2",
        requireRegisteredWorktree: false,
      },
    )
    replaceActiveGuardedContractForSubChat(first.subChatId, first)
    replaceActiveGuardedContractForSubChat(second.subChatId, second)
    const handler = createClaudeAgentSdkToolPermissionHandler(
      baseHandlerInput({
        permissionPolicy: resolveDesktopPermissionPolicy({
          runtimeId: "claude-code",
          mode: "agent",
          hasScopeContract: true,
        }),
        guardedContract: first,
        isGuardedContractCurrent: isActiveGuardedContract,
      }),
    )

    await expect(
      handler(
        "Edit",
        { file_path: "src/app.ts" },
        toolOptions("cross-chat-same-contract-id"),
      ),
    ).resolves.toMatchObject({ behavior: "allow" })
    expect(isActiveGuardedContract(first)).toBe(true)
    expect(isActiveGuardedContract(second)).toBe(true)

    const replacement = { ...first, runId: "run-replacement" }
    replaceActiveGuardedContractForSubChat(first.subChatId, replacement)
    await expect(
      handler(
        "Edit",
        { file_path: "src/app.ts" },
        toolOptions("stale-captured-contract"),
      ),
    ).resolves.toEqual({
      behavior: "deny",
      message: "Guarded run is no longer active.",
    })
    expect(isActiveGuardedContract(second)).toBe(true)
  })

  test("denies a guarded shell write when different-ID replacement happens during approval", async () => {
    const guardedContract = await validateAgentScopeContract(
      {
        ...baseContract(),
        editableScope: [{ path: "src", kind: "directory" }],
      },
      {
        cwd,
        projectPath: cwd,
        chatId: "chat-1",
        subChatId: "sub-1",
        runId: "run-1",
        requireRegisteredWorktree: false,
      },
    )
    const replacementContract = await validateAgentScopeContract(
      {
        ...baseContract(),
        id: "contract-2",
        runId: "run-2",
        editableScope: [{ path: "src", kind: "directory" }],
      },
      {
        cwd,
        projectPath: cwd,
        chatId: "chat-1",
        subChatId: "sub-1",
        runId: "run-2",
        requireRegisteredWorktree: false,
      },
    )
    const pendingToolApprovals = new Map<string, ClaudeAskUserQuestionPending>()
    const emitted: UIMessageChunk[] = []
    let currentContract = guardedContract
    const handler = createClaudeAgentSdkToolPermissionHandler(
      baseHandlerInput({
        permissionPolicy: resolveDesktopPermissionPolicy({
          runtimeId: "claude-code",
          mode: "agent",
          hasScopeContract: true,
        }),
        guardedContract,
        isGuardedContractCurrent: (contract) => contract === currentContract,
        pendingToolApprovals,
        emit: (chunk) => emitted.push(chunk),
      }),
    )
    const resultPromise = handler(
      "Bash",
      {
        command: `/bin/zsh -lc "printf 'hello' > ${join(cwd, "src/generated.txt")}"`,
      },
      toolOptions("stale-during-approval"),
    )
    const pending = pendingForTool(
      pendingToolApprovals,
      "stale-during-approval",
    )
    if (!pending?.approvalInput) {
      throw new Error("expected guarded shell approval pending state")
    }

    currentContract = replacementContract
    pending.resolve({
      approved: true,
      updatedInput: {
        questions: pending.approvalInput.questions,
        answers: {
          [pending.approvalInput.questions[0].question]: "Approve",
        },
      },
    })

    await expect(resultPromise).resolves.toEqual({
      behavior: "deny",
      message: "Guarded run is no longer active.",
    })
    expect(emitted.at(-1)).toEqual({
      type: "ask-user-question-result",
      approvalId: pending.approvalId,
      toolUseId: "stale-during-approval",
      result: "Guarded run is no longer active.",
    })
  })

  test("denies a guarded approval when an unguarded Run replaces its owner", async () => {
    const guardedContract = await validateAgentScopeContract(
      {
        ...baseContract(),
        editableScope: [{ path: "src", kind: "directory" }],
      },
      {
        cwd,
        projectPath: cwd,
        chatId: "chat-1",
        subChatId: "sub-1",
        runId: "run-1",
        requireRegisteredWorktree: false,
      },
    )
    const pendingToolApprovals = new Map<string, ClaudeAskUserQuestionPending>()
    let currentContract: typeof guardedContract | undefined = guardedContract
    const handler = createClaudeAgentSdkToolPermissionHandler(
      baseHandlerInput({
        permissionPolicy: resolveDesktopPermissionPolicy({
          runtimeId: "claude-code",
          mode: "agent",
          hasScopeContract: true,
        }),
        guardedContract,
        isGuardedContractCurrent: (contract) => contract === currentContract,
        pendingToolApprovals,
      }),
    )
    const resultPromise = handler(
      "Bash",
      {
        command: `/bin/zsh -lc "printf 'hello' > ${join(cwd, "src/generated.txt")}"`,
      },
      toolOptions("unguarded-replacement"),
    )
    const pending = pendingForTool(
      pendingToolApprovals,
      "unguarded-replacement",
    )
    if (!pending?.approvalInput) {
      throw new Error("expected guarded shell approval pending state")
    }

    currentContract = undefined
    pending.resolve({
      approved: true,
      updatedInput: {
        questions: pending.approvalInput.questions,
        answers: {
          [pending.approvalInput.questions[0].question]: "Approve",
        },
      },
    })

    await expect(resultPromise).resolves.toEqual({
      behavior: "deny",
      message: "Guarded run is no longer active.",
    })
  })

  test("requires user approval before allowing guarded bounded shell writes", async () => {
    const guardedContract = await validateAgentScopeContract(
      {
        ...baseContract(),
        id: "contract-shell-approval",
        editableScope: [{ path: "src", kind: "directory" }],
      },
      {
        cwd,
        projectPath: cwd,
        chatId: "chat-1",
        subChatId: "sub-1",
        runId: "run-1",
        requireRegisteredWorktree: false,
      },
    )
    const pendingToolApprovals = new Map<string, ClaudeAskUserQuestionPending>()
    const guardEvents: any[] = []
    const emitted: any[] = []
    const handler = createClaudeAgentSdkToolPermissionHandler(
      baseHandlerInput({
        permissionPolicy: resolveDesktopPermissionPolicy({
          runtimeId: "claude-code",
          mode: "agent",
          hasScopeContract: true,
        }),
        guardedContract,
        isGuardedContractCurrent: (contract) => contract === guardedContract,
        pendingToolApprovals,
        recordGuardEvent: (event) => {
          guardEvents.push(event)
        },
        emit: (chunk) => {
          emitted.push(chunk)
        },
      }),
    )
    const toolInput = {
      command: `/bin/zsh -lc "printf 'hello' > ${join(cwd, "src/generated.txt")}"`,
    }

    const resultPromise = handler(
      "Bash",
      toolInput,
      toolOptions("guard-shell-approval-1"),
    )

    const pendingApproval = pendingForTool(
      pendingToolApprovals,
      "guard-shell-approval-1",
    )
    expect(pendingApproval).toBeDefined()
    expect(pendingApproval).toMatchObject({
      toolName: "Bash",
      toolInput,
    })
    if (!pendingApproval?.approvalInput) {
      throw new Error("expected guarded shell approval pending state")
    }
    const question = pendingApproval.approvalInput.questions[0]
    expect(question.options.map((option) => option.label)).toEqual([
      "Approve",
      "Deny",
    ])
    expect(guardEvents).toHaveLength(1)
    expect(guardEvents[0]).toMatchObject({
      type: "allowed",
      toolName: "Bash",
      toolUseId: "guard-shell-approval-1",
    })
    expect(emitted.map((chunk) => chunk.type)).toEqual([
      "guard-event",
      "ask-user-question",
    ])

    pendingApproval.resolve({
      approved: true,
      updatedInput: {
        questions: pendingApproval.approvalInput.questions,
        answers: {
          [question.question]: "Approve",
        },
      },
    })

    const result = await resultPromise
    expect(result).toEqual({
      behavior: "allow",
      updatedInput: toolInput,
    })
    expect(emitted.at(-1)).toEqual({
      type: "ask-user-question-result",
      approvalId: pendingApproval.approvalId,
      toolUseId: "guard-shell-approval-1",
      result: "approved",
    })
  })

  test("denies guarded bounded shell writes when the user selects Deny", async () => {
    const guardedContract = await validateAgentScopeContract(
      {
        ...baseContract(),
        id: "contract-shell-deny",
        editableScope: [{ path: "src", kind: "directory" }],
      },
      {
        cwd,
        projectPath: cwd,
        chatId: "chat-1",
        subChatId: "sub-1",
        runId: "run-1",
        requireRegisteredWorktree: false,
      },
    )
    const pendingToolApprovals = new Map<string, ClaudeAskUserQuestionPending>()
    const handler = createClaudeAgentSdkToolPermissionHandler(
      baseHandlerInput({
        permissionPolicy: resolveDesktopPermissionPolicy({
          runtimeId: "claude-code",
          mode: "agent",
          hasScopeContract: true,
        }),
        guardedContract,
        isGuardedContractCurrent: (contract) => contract === guardedContract,
        pendingToolApprovals,
      }),
    )
    const resultPromise = handler(
      "Bash",
      {
        command: `/bin/zsh -lc "printf 'hello' > ${join(cwd, "src/generated.txt")}"`,
      },
      toolOptions("guard-shell-deny-1"),
    )
    const pendingApproval = pendingForTool(
      pendingToolApprovals,
      "guard-shell-deny-1",
    )
    if (!pendingApproval?.approvalInput) {
      throw new Error("expected guarded shell approval pending state")
    }
    pendingApproval.resolve({
      approved: true,
      updatedInput: {
        questions: pendingApproval.approvalInput.questions,
        answers: {
          [pendingApproval.approvalInput.questions[0].question]: "Deny",
        },
      },
    })

    await expect(resultPromise).resolves.toMatchObject({
      behavior: "deny",
      message: "Denied",
    })
  })

  test("observes normal Agent-mode tools and loudly blocks catastrophic actions", async () => {
    const emitted: any[] = []
    const handler = createClaudeAgentSdkToolPermissionHandler(
      baseHandlerInput({
        emit: (chunk) => {
          emitted.push(chunk)
        },
      }),
    )

    const normalResult = await handler(
      "Edit",
      { file_path: "src/app.ts" },
      toolOptions("observe-1"),
    )
    const catastrophicResult = await handler(
      "Bash",
      { command: "git reset --hard HEAD" },
      toolOptions("observe-2"),
    )

    expect(normalResult).toEqual({
      behavior: "allow",
      updatedInput: { file_path: "src/app.ts" },
    })
    expect(catastrophicResult.behavior).toBe("deny")
    expect(catastrophicResult.message).toContain("Observed mode blocked Bash")
    expect(emitted).toHaveLength(2)
    expect(emitted[0]).toMatchObject({
      type: "observed-tool-decision",
      controlLevel: "observe",
      decision: "allow",
      risk: {
        toolName: "Edit",
        toolUseId: "observe-1",
        riskLevel: "medium",
        catastrophic: false,
      },
    })
    expect(emitted[1]).toMatchObject({
      type: "observed-tool-decision",
      controlLevel: "observe",
      decision: "deny",
      risk: {
        toolName: "Bash",
        toolUseId: "observe-2",
        riskLevel: "catastrophic",
        catastrophic: true,
      },
    })
  })

  test("uses PreToolUse for observed decisions and reuses them in canUseTool", async () => {
    const emitted: any[] = []
    const controls = createClaudeAgentSdkPermissionControls(
      baseHandlerInput({
        emit: (chunk) => {
          emitted.push(chunk)
        },
      }),
    )

    const result = await controls.preToolUseHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: {
          file_path: join(cwd, ".env"),
          content: "LOCUS_SMOKE_SHOULD_NOT_EXIST=1",
        },
        tool_use_id: "observe-hook-1",
      } as any,
      "observe-hook-1",
      { signal: new AbortController().signal },
    )

    expect(result).toMatchObject({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining(
          "Observed mode blocked Write",
        ),
      },
    })
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      type: "observed-tool-decision",
      decision: "deny",
      risk: {
        toolName: "Write",
        toolUseId: "observe-hook-1",
        riskLevel: "catastrophic",
        catastrophic: true,
      },
    })

    const canUseToolResult = await controls.canUseTool(
      "Write",
      { file_path: join(cwd, ".env") },
      toolOptions("observe-hook-1"),
    )
    expect(canUseToolResult.behavior).toBe("deny")
    expect(emitted).toHaveLength(1)
  })

  test("same-run-id replacement denies unguarded callbacks and cached allows", async () => {
    let activeOwner = "A"
    const controlsA = createClaudeAgentSdkPermissionControls(
      baseHandlerInput({
        isCurrentRunOwner: () => activeOwner === "A",
      }),
    )

    await expect(
      controlsA.preToolUseHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Edit",
          tool_input: { file_path: "src/app.ts" },
          tool_use_id: "cached-unguarded-allow",
        } as PreToolUseHookInput,
        "cached-unguarded-allow",
        { signal: new AbortController().signal },
      ),
    ).resolves.toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    })

    activeOwner = "B"
    await expect(
      controlsA.canUseTool(
        "Edit",
        { file_path: "src/app.ts" },
        toolOptions("cached-unguarded-allow"),
      ),
    ).resolves.toMatchObject({
      behavior: "deny",
      message: "Claude run is no longer active.",
    })
    await expect(
      controlsA.canUseTool(
        "Bash",
        { command: "printf safe" },
        toolOptions("late-direct-bash"),
      ),
    ).resolves.toMatchObject({
      behavior: "deny",
      message: "Claude run is no longer active.",
    })
    await expect(
      controlsA.preToolUseHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Edit",
          tool_input: { file_path: "src/late.ts" },
          tool_use_id: "late-hook-edit",
        } as PreToolUseHookInput,
        "late-hook-edit",
        { signal: new AbortController().signal },
      ),
    ).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: "deny",
        permissionDecisionReason: "Claude run is no longer active.",
      },
    })
  })

  test("uses PreToolUse for guarded scope decisions", async () => {
    const guardedContract = await validateAgentScopeContract(baseContract(), {
      cwd,
      projectPath: cwd,
      chatId: "chat-1",
      subChatId: "sub-1",
      runId: "run-1",
      requireRegisteredWorktree: false,
    })
    const guardEvents: any[] = []
    const emitted: any[] = []
    replaceActiveGuardedContractForSubChat(
      guardedContract.subChatId,
      guardedContract,
    )
    const controls = createClaudeAgentSdkPermissionControls(
      baseHandlerInput({
        permissionPolicy: resolveDesktopPermissionPolicy({
          runtimeId: "claude-code",
          mode: "agent",
          hasScopeContract: true,
        }),
        guardedContract,
        isGuardedContractCurrent: (contract) => contract === guardedContract,
        recordGuardEvent: (event) => {
          guardEvents.push(event)
        },
        emit: (chunk) => {
          emitted.push(chunk)
        },
      }),
    )

    const result = await controls.preToolUseHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "tests/app.test.ts" },
        tool_use_id: "guard-hook-1",
      } as any,
      "guard-hook-1",
      { signal: new AbortController().signal },
    )

    expect(result).toMatchObject({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
      },
    })
    expect(guardEvents).toHaveLength(1)
    expect(guardEvents[0]).toMatchObject({
      type: "scope-expansion-request",
      toolName: "Edit",
      toolUseId: "guard-hook-1",
    })
    expect(emitted).toEqual([
      {
        type: "guard-event",
        event: guardEvents[0],
      },
    ])
    expect(
      hasPendingActiveGuardedScopeExpansionForTest(guardEvents[0].id),
    ).toBe(true)
  })

  test("does not reuse a cached guarded allow after its contract is replaced", async () => {
    const guardedContract = await validateAgentScopeContract(baseContract(), {
      cwd,
      projectPath: cwd,
      chatId: "chat-1",
      subChatId: "sub-1",
      runId: "run-1",
      requireRegisteredWorktree: false,
    })
    const replacementContract = await validateAgentScopeContract(
      {
        ...baseContract(),
        id: "contract-2",
        runId: "run-2",
        editableScope: [{ path: "src", kind: "directory" }],
      },
      {
        cwd,
        projectPath: cwd,
        chatId: "chat-1",
        subChatId: "sub-1",
        runId: "run-2",
        requireRegisteredWorktree: false,
      },
    )
    let currentContract = guardedContract
    const controls = createClaudeAgentSdkPermissionControls(
      baseHandlerInput({
        permissionPolicy: resolveDesktopPermissionPolicy({
          runtimeId: "claude-code",
          mode: "agent",
          hasScopeContract: true,
        }),
        guardedContract,
        isGuardedContractCurrent: (contract) => contract === currentContract,
      }),
    )

    await expect(
      controls.preToolUseHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Edit",
          tool_input: { file_path: "src/app.ts" },
          tool_use_id: "cached-guard-allow",
        } as PreToolUseHookInput,
        "cached-guard-allow",
        { signal: new AbortController().signal },
      ),
    ).resolves.toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    })

    currentContract = replacementContract

    await expect(
      controls.canUseTool(
        "Edit",
        { file_path: "src/app.ts" },
        toolOptions("cached-guard-allow"),
      ),
    ).resolves.toEqual({
      behavior: "deny",
      message: "Guarded run is no longer active.",
    })
  })
})
