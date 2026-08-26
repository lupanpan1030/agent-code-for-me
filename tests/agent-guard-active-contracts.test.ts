import { afterEach, describe, expect, mock, test } from "bun:test"
import { join } from "node:path"
import type {
  AgentGuardEvent,
  AgentScopeContract,
} from "../src/shared/agent-scope-contracts"

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
  clearActiveGuardedContractsForTest,
  deleteActiveGuardedContractIfMatch,
  hasPendingActiveGuardedScopeExpansionForTest,
  isActiveGuardedContract,
  prepareGuardedRunContract,
  registerActiveGuardedScopeExpansionRequest,
  replaceActiveGuardedContractForSubChat,
  respondActiveGuardedScopeExpansion,
} = await import("../src/main/lib/agent-guard/active-contracts")
const { validateAgentScopeContract } = await import(
  "../src/main/lib/agent-guard/contract"
)
const { desktopScopeExpansionResponseInputSchema } = await import(
  "../src/main/lib/agent-runtime/scope-expansion"
)

const cwd = join(process.cwd(), "example-project")

function baseContract(
  overrides: Partial<AgentScopeContract> = {},
): AgentScopeContract {
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
    ...overrides,
  }
}

async function activate(contract: AgentScopeContract = baseContract()) {
  const validated = await validateAgentScopeContract(contract, {
    cwd,
    projectPath: cwd,
    chatId: "chat-1",
    subChatId: "sub-1",
    runId: "run-1",
    requireRegisteredWorktree: false,
  })
  replaceActiveGuardedContractForSubChat(validated.subChatId, validated)
  return validated
}

function scopeExpansionEvent(
  overrides: Partial<AgentGuardEvent> = {},
): AgentGuardEvent {
  return {
    id: "scope-request-1",
    runId: "run-1",
    contractId: "contract-1",
    type: "scope-expansion-request",
    toolName: "Edit",
    toolUseId: "runtime-tool-1",
    path: "src/new.ts",
    paths: ["src/new.ts"],
    reason: "Canonical main-process reason.",
    createdAt: "2026-06-07T00:00:03.000Z",
    ...overrides,
  }
}

describe("active guarded contract owner", () => {
  afterEach(() => {
    clearActiveGuardedContractsForTest()
  })

  test("prepares no contract when guarded scope is absent", async () => {
    await expect(
      prepareGuardedRunContract({
        cwd,
        projectPath: cwd,
        chatId: "chat-1",
        subChatId: "sub-1",
        runId: "run-1",
        fallbackRunId: "fallback-run",
      }),
    ).resolves.toEqual({
      ok: true,
      contract: null,
      preRunStatus: null,
    })
  })

  test("prepares without replacing an active same-ID contract", async () => {
    const sentinel = await activate()
    const result = await prepareGuardedRunContract({
      scopeContract: baseContract(),
      cwd,
      projectPath: cwd,
      chatId: "chat-1",
      subChatId: "sub-1",
      runId: "run-1",
      fallbackRunId: "fallback-run",
      validateOptions: { requireRegisteredWorktree: false },
      captureStatus: async () => ({
        dirty: false,
        files: [],
        capturedAt: "2026-06-07T00:00:02.000Z",
        available: true,
      }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.contract).not.toBe(sentinel)
    expect(isActiveGuardedContract(sentinel)).toBe(true)
  })

  test("identity-safe deletion cannot remove a newer same-ID contract", async () => {
    const stale = await activate()
    const winner = await validateAgentScopeContract(
      baseContract({ runId: "run-2" }),
      {
        cwd,
        projectPath: cwd,
        chatId: "chat-1",
        subChatId: "sub-1",
        runId: "run-2",
        requireRegisteredWorktree: false,
      },
    )
    replaceActiveGuardedContractForSubChat(winner.subChatId, winner)

    expect(deleteActiveGuardedContractIfMatch(stale)).toBe(false)
    expect(isActiveGuardedContract(winner)).toBe(true)
    expect(deleteActiveGuardedContractIfMatch(winner)).toBe(true)
    expect(isActiveGuardedContract(winner)).toBe(false)
  })

  test("same contract ID remains isolated across different sub-chats", async () => {
    const first = await activate()
    const second = await validateAgentScopeContract(
      baseContract({
        chatId: "chat-2",
        subChatId: "sub-2",
        runId: "run-2",
      }),
      {
        cwd,
        projectPath: cwd,
        chatId: "chat-2",
        subChatId: "sub-2",
        runId: "run-2",
        requireRegisteredWorktree: false,
      },
    )
    replaceActiveGuardedContractForSubChat(second.subChatId, second)

    expect(first.id).toBe(second.id)
    expect(isActiveGuardedContract(first)).toBe(true)
    expect(isActiveGuardedContract(second)).toBe(true)

    expect(deleteActiveGuardedContractIfMatch(first)).toBe(true)
    expect(isActiveGuardedContract(first)).toBe(false)
    expect(isActiveGuardedContract(second)).toBe(true)

    replaceActiveGuardedContractForSubChat(second.subChatId, null)
    expect(isActiveGuardedContract(second)).toBe(false)
  })

  test("activating a different-ID contract revokes the old owner for the same sub-chat", async () => {
    const stale = await activate()
    const winner = await validateAgentScopeContract(
      baseContract({ id: "contract-2", runId: "run-2" }),
      {
        cwd,
        projectPath: cwd,
        chatId: "chat-1",
        subChatId: "sub-1",
        runId: "run-2",
        requireRegisteredWorktree: false,
      },
    )
    replaceActiveGuardedContractForSubChat(winner.subChatId, winner)

    expect(isActiveGuardedContract(stale)).toBe(false)
    expect(isActiveGuardedContract(winner)).toBe(true)
    expect(deleteActiveGuardedContractIfMatch(stale)).toBe(false)
    expect(deleteActiveGuardedContractIfMatch(winner)).toBe(true)
  })

  test("an unguarded winner revokes the previous guarded owner", async () => {
    const stale = await activate()

    replaceActiveGuardedContractForSubChat("sub-1", null)

    expect(isActiveGuardedContract(stale)).toBe(false)
    expect(deleteActiveGuardedContractIfMatch(stale)).toBe(false)
  })

  test("consumes a main-minted scope request once using canonical fields", async () => {
    const activeContract = await activate()
    const event = scopeExpansionEvent({
      paths: ["src/new.ts", "src/new.ts", "src/other.ts"],
    })
    expect(
      registerActiveGuardedScopeExpansionRequest({
        contract: activeContract,
        event,
        nowMs: 1_000,
      }),
    ).toBe(true)

    const result = await respondActiveGuardedScopeExpansion({
      requestId: event.id,
      approved: true,
      nowMs: 1_001,
      validateOptions: { requireRegisteredWorktree: false },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.contract).toBe(activeContract)
    expect(result.contract.editableScope.map((scope) => scope.path)).toEqual([
      "src/app.ts",
      "src/new.ts",
      "src/other.ts",
    ])
    expect(result.contract.expansions[0]).toMatchObject({
      requestedByToolUseId: "runtime-tool-1",
      reason: "Canonical main-process reason.",
    })
    await expect(
      respondActiveGuardedScopeExpansion({
        requestId: event.id,
        approved: true,
        nowMs: 1_002,
        validateOptions: { requireRegisteredWorktree: false },
      }),
    ).resolves.toEqual({
      ok: false,
      error: "Scope expansion request is no longer pending.",
    })
  })

  test("scope response schema accepts only the opaque request id and decision", () => {
    expect(
      desktopScopeExpansionResponseInputSchema.safeParse({
        requestId: "scope-request-1",
        approved: true,
      }).success,
    ).toBe(true)
    expect(
      desktopScopeExpansionResponseInputSchema.safeParse({
        requestId: "scope-request-1",
        approved: true,
        path: "forged/path.ts",
      }).success,
    ).toBe(false)
    expect(
      desktopScopeExpansionResponseInputSchema.safeParse({
        contractId: "contract-1",
        toolUseId: "runtime-tool-1",
        approved: true,
        paths: ["forged/path.ts"],
        reason: "forged",
      }).success,
    ).toBe(false)
  })

  test("reject and expiry both consume scope-expansion authority", async () => {
    const activeContract = await activate()
    const rejected = scopeExpansionEvent({ id: "scope-reject" })
    registerActiveGuardedScopeExpansionRequest({
      contract: activeContract,
      event: rejected,
      nowMs: 1_000,
    })
    const rejection = await respondActiveGuardedScopeExpansion({
      requestId: rejected.id,
      approved: false,
      nowMs: 1_001,
      validateOptions: { requireRegisteredWorktree: false },
    })
    expect(rejection.ok).toBe(true)
    expect(activeContract.editableScope.map((scope) => scope.path)).toEqual([
      "src/app.ts",
    ])
    expect(activeContract.expansions[0]?.rejectedAt).toBeTruthy()
    expect(hasPendingActiveGuardedScopeExpansionForTest(rejected.id)).toBe(
      false,
    )

    const expired = scopeExpansionEvent({ id: "scope-expired" })
    registerActiveGuardedScopeExpansionRequest({
      contract: activeContract,
      event: expired,
      nowMs: 2_000,
      ttlMs: 5,
    })
    await expect(
      respondActiveGuardedScopeExpansion({
        requestId: expired.id,
        approved: true,
        nowMs: 2_006,
        validateOptions: { requireRegisteredWorktree: false },
      }),
    ).resolves.toEqual({
      ok: false,
      error: "Scope expansion request has expired.",
    })
    expect(hasPendingActiveGuardedScopeExpansionForTest(expired.id)).toBe(false)
  })

  test("replacement or unguarded activation revokes stale scope-expansion requests", async () => {
    for (const replacement of [
      "same-id",
      "different-id",
      "unguarded",
    ] as const) {
      clearActiveGuardedContractsForTest()
      const stale = await activate()
      const event = scopeExpansionEvent({ id: `scope-${replacement}` })
      registerActiveGuardedScopeExpansionRequest({
        contract: stale,
        event,
      })

      if (replacement === "unguarded") {
        replaceActiveGuardedContractForSubChat("sub-1", null)
      } else {
        const winner = await validateAgentScopeContract(
          baseContract({
            id: replacement === "same-id" ? stale.id : "contract-2",
            runId: "run-2",
          }),
          {
            cwd,
            projectPath: cwd,
            chatId: "chat-1",
            subChatId: "sub-1",
            runId: "run-2",
            requireRegisteredWorktree: false,
          },
        )
        replaceActiveGuardedContractForSubChat(winner.subChatId, winner)
      }

      await expect(
        respondActiveGuardedScopeExpansion({
          requestId: event.id,
          approved: true,
          validateOptions: { requireRegisteredWorktree: false },
        }),
      ).resolves.toEqual({
        ok: false,
        error: "Scope expansion request is no longer pending.",
      })
    }
  })

  test("rechecks exact scope owner after asynchronous validation", async () => {
    const stale = await activate()
    const event = scopeExpansionEvent({ id: "scope-deferred" })
    registerActiveGuardedScopeExpansionRequest({ contract: stale, event })

    let releaseValidation!: () => void
    let validationStarted!: () => void
    const started = new Promise<void>((resolve) => {
      validationStarted = resolve
    })
    const release = new Promise<void>((resolve) => {
      releaseValidation = resolve
    })
    const validateAfterRelease: typeof validateAgentScopeContract = async (
      contract,
      options,
    ) => {
      validationStarted()
      await release
      return validateAgentScopeContract(contract, options)
    }

    const response = respondActiveGuardedScopeExpansion({
      requestId: event.id,
      approved: true,
      validateOptions: { requireRegisteredWorktree: false },
      validateContract: validateAfterRelease,
    })
    await started
    const winner = await validateAgentScopeContract(
      baseContract({ runId: "run-2" }),
      {
        cwd,
        projectPath: cwd,
        chatId: "chat-1",
        subChatId: "sub-1",
        runId: "run-2",
        requireRegisteredWorktree: false,
      },
    )
    replaceActiveGuardedContractForSubChat(winner.subChatId, winner)
    releaseValidation()

    await expect(response).resolves.toEqual({
      ok: false,
      error: "Guarded run is no longer active.",
    })
    expect(stale.expansions).toEqual([])
    expect(winner.expansions).toEqual([])
  })

  test("stale cleanup cannot delete a newer contract's pending scope request", async () => {
    const stale = await activate()
    const winner = await validateAgentScopeContract(
      baseContract({ runId: "run-2" }),
      {
        cwd,
        projectPath: cwd,
        chatId: "chat-1",
        subChatId: "sub-1",
        runId: "run-2",
        requireRegisteredWorktree: false,
      },
    )
    replaceActiveGuardedContractForSubChat(winner.subChatId, winner)
    const winnerEvent = scopeExpansionEvent({
      id: "scope-winner",
      runId: "run-2",
    })
    registerActiveGuardedScopeExpansionRequest({
      contract: winner,
      event: winnerEvent,
    })

    expect(deleteActiveGuardedContractIfMatch(stale)).toBe(false)
    expect(hasPendingActiveGuardedScopeExpansionForTest(winnerEvent.id)).toBe(
      true,
    )
  })

  test("validates candidate-locally and publishes only through winner admission", async () => {
    const capturedCwds: string[] = []
    const result = await prepareGuardedRunContract({
      scopeContract: baseContract({ runId: undefined }),
      cwd,
      projectPath: cwd,
      chatId: "chat-1",
      subChatId: "sub-1",
      fallbackRunId: "fallback-run",
      validateOptions: { requireRegisteredWorktree: false },
      captureStatus: async (captureCwd) => {
        capturedCwds.push(captureCwd)
        return {
          dirty: false,
          files: [],
          capturedAt: "2026-06-07T00:00:02.000Z",
          available: true,
        }
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.contract?.runId).toBe("fallback-run")
    expect(result.preRunStatus).toEqual({
      dirty: false,
      files: [],
      capturedAt: "2026-06-07T00:00:02.000Z",
      available: true,
    })
    expect(capturedCwds).toEqual([cwd])
    if (!result.contract) throw new Error("expected guarded contract")
    expect(isActiveGuardedContract(result.contract)).toBe(false)
    replaceActiveGuardedContractForSubChat(
      result.contract.subChatId,
      result.contract,
    )
    expect(isActiveGuardedContract(result.contract)).toBe(true)
  })

  test("returns stable validation errors without activating the contract", async () => {
    const result = await prepareGuardedRunContract({
      scopeContract: baseContract({ chatId: "other-chat" }),
      cwd,
      projectPath: cwd,
      chatId: "chat-1",
      subChatId: "sub-1",
      runId: "run-1",
      fallbackRunId: "fallback-run",
      validateOptions: { requireRegisteredWorktree: false },
      captureStatus: async () => {
        throw new Error("capture should not run")
      },
    })

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("chat"),
    })
    expect(result.ok).toBe(false)
  })
})
