import { afterEach, describe, expect, test } from "bun:test"
import { Window } from "happy-dom"

const testWindow = new Window({ url: "http://localhost/" })
Object.assign(globalThis, {
  window: testWindow,
  document: testWindow.document,
  localStorage: testWindow.localStorage,
  sessionStorage: testWindow.sessionStorage,
})

const { appStore } = await import("../src/renderer/lib/jotai-store")
const {
  askUserQuestionApprovalIdsAtom,
  askUserQuestionResultsAtom,
  expiredUserQuestionsAtom,
  pendingScopeExpansionRequestsAtom,
  pendingUserQuestionsAtom,
} = await import("../src/renderer/features/agents/atoms")
const {
  applyRuntimeEventStateChunk,
  createAskUserQuestionStateKey,
  respondToRuntimeQuestionApproval,
} = await import("../src/renderer/features/agents/lib/runtime-event-state")
const { areAskUserQuestionPropsEqual, clearToolStateCachesByToolCallIds } =
  await import("../src/renderer/features/agents/ui/agent-tool-utils")

const context = { subChatId: "sub-1", parentChatId: "chat-1" }
const otherContext = { subChatId: "sub-2", parentChatId: "chat-2" }
const questions = [
  {
    question: "Continue?",
    header: "Confirm",
    options: [{ label: "Yes", description: "Continue." }],
    multiSelect: false,
  },
]

function createDeferred<T>() {
  let resolve: ((value: T) => void) | undefined
  let reject: ((error: unknown) => void) | undefined
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe("runtime question approval identity", () => {
  afterEach(() => {
    appStore.set(pendingUserQuestionsAtom, new Map())
    appStore.set(expiredUserQuestionsAtom, new Map())
    appStore.set(askUserQuestionResultsAtom, new Map())
    appStore.set(askUserQuestionApprovalIdsAtom, new Map())
    appStore.set(pendingScopeExpansionRequestsAtom, new Map())
  })

  for (const runtimeId of ["codex", "claude-code"] as const) {
    test(`${runtimeId} ignores A timeout/result after same-tool-id B replacement`, () => {
      applyRuntimeEventStateChunk(context, {
        type: "ask-user-question",
        approvalId: "approval-A",
        toolUseId: "shared-runtime-tool",
        questions,
      })
      applyRuntimeEventStateChunk(context, {
        type: "ask-user-question",
        approvalId: "approval-B",
        toolUseId: "shared-runtime-tool",
        questions,
      })

      expect(appStore.get(askUserQuestionApprovalIdsAtom)).toEqual(
        new Map([
          [
            "approval-B",
            createAskUserQuestionStateKey("sub-1", "shared-runtime-tool"),
          ],
        ]),
      )

      applyRuntimeEventStateChunk(context, {
        type: "ask-user-question-timeout",
        approvalId: "approval-A",
        toolUseId: "shared-runtime-tool",
      })
      expect(
        appStore.get(pendingUserQuestionsAtom).get("sub-1")?.approvalId,
      ).toBe("approval-B")
      expect(appStore.get(expiredUserQuestionsAtom).has("sub-1")).toBe(false)

      applyRuntimeEventStateChunk(context, {
        type: "ask-user-question-result",
        approvalId: "approval-A",
        toolUseId: "shared-runtime-tool",
        result: "stale-A",
      })
      expect(
        appStore.get(pendingUserQuestionsAtom).get("sub-1")?.approvalId,
      ).toBe("approval-B")
      expect(
        appStore
          .get(askUserQuestionResultsAtom)
          .has(createAskUserQuestionStateKey("sub-1", "shared-runtime-tool")),
      ).toBe(false)

      applyRuntimeEventStateChunk(context, {
        type: "ask-user-question-result",
        approvalId: "approval-B",
        toolUseId: "shared-runtime-tool",
        result: "winner-B",
      })
      expect(appStore.get(pendingUserQuestionsAtom).has("sub-1")).toBe(false)
      expect(
        appStore
          .get(askUserQuestionResultsAtom)
          .get(createAskUserQuestionStateKey("sub-1", "shared-runtime-tool")),
      ).toBe("winner-B")
      expect(appStore.get(askUserQuestionApprovalIdsAtom).size).toBe(0)
    })
  }

  for (const response of [true, false] as const) {
    test(`a deferred A response=${response} compare-deletes only A after B replaces it`, async () => {
      applyRuntimeEventStateChunk(context, {
        type: "ask-user-question",
        approvalId: "approval-A",
        toolUseId: "shared-runtime-tool",
        questions,
      })
      const deferredResponse = createDeferred<{ ok: boolean }>()
      const continuation = respondToRuntimeQuestionApproval({
        identity: {
          subChatId: "sub-1",
          approvalId: "approval-A",
          toolUseId: "shared-runtime-tool",
        },
        respond: () => deferredResponse.promise,
      })

      applyRuntimeEventStateChunk(context, {
        type: "ask-user-question",
        approvalId: "approval-B",
        toolUseId: "shared-runtime-tool",
        questions,
      })
      deferredResponse.resolve?.({ ok: response })

      expect(await continuation).toEqual({
        response: { ok: response },
        cleared: false,
        superseded: true,
      })
      expect(
        appStore.get(pendingUserQuestionsAtom).get("sub-1")?.approvalId,
      ).toBe("approval-B")
      expect(appStore.get(askUserQuestionApprovalIdsAtom)).toEqual(
        new Map([
          [
            "approval-B",
            createAskUserQuestionStateKey("sub-1", "shared-runtime-tool"),
          ],
        ]),
      )
    })
  }

  test("a transport throw keeps exact question A available for retry", async () => {
    applyRuntimeEventStateChunk(context, {
      type: "ask-user-question",
      approvalId: "approval-A",
      toolUseId: "tool-A",
      questions,
    })
    const deferredResponse = createDeferred<boolean>()
    const continuation = respondToRuntimeQuestionApproval({
      identity: {
        subChatId: "sub-1",
        approvalId: "approval-A",
        toolUseId: "tool-A",
      },
      respond: () => deferredResponse.promise,
    })

    deferredResponse.reject?.(new Error("transport unavailable"))
    await expect(continuation).rejects.toThrow("transport unavailable")
    expect(appStore.get(pendingUserQuestionsAtom).get("sub-1")).toMatchObject({
      approvalId: "approval-A",
      toolUseId: "tool-A",
    })
    expect(appStore.get(askUserQuestionApprovalIdsAtom)).toEqual(
      new Map([
        ["approval-A", createAskUserQuestionStateKey("sub-1", "tool-A")],
      ]),
    )
  })

  test("keeps concurrent cross-chat approvals and results isolated when runtime tool IDs match", () => {
    applyRuntimeEventStateChunk(context, {
      type: "ask-user-question",
      approvalId: "approval-chat-1",
      toolUseId: "shared-runtime-tool",
      questions,
    })
    applyRuntimeEventStateChunk(otherContext, {
      type: "ask-user-question",
      approvalId: "approval-chat-2",
      toolUseId: "shared-runtime-tool",
      questions,
    })

    const firstKey = createAskUserQuestionStateKey(
      "sub-1",
      "shared-runtime-tool",
    )
    const secondKey = createAskUserQuestionStateKey(
      "sub-2",
      "shared-runtime-tool",
    )
    expect(appStore.get(askUserQuestionApprovalIdsAtom)).toEqual(
      new Map([
        ["approval-chat-1", firstKey],
        ["approval-chat-2", secondKey],
      ]),
    )

    // An approval is bound to both its chat and provider tool provenance.
    applyRuntimeEventStateChunk(otherContext, {
      type: "ask-user-question-result",
      approvalId: "approval-chat-1",
      toolUseId: "shared-runtime-tool",
      result: "wrong-chat",
    })
    expect(appStore.get(pendingUserQuestionsAtom).has("sub-1")).toBe(true)
    expect(appStore.get(pendingUserQuestionsAtom).has("sub-2")).toBe(true)
    expect(appStore.get(askUserQuestionResultsAtom).size).toBe(0)

    applyRuntimeEventStateChunk(context, {
      type: "ask-user-question-result",
      approvalId: "approval-chat-1",
      toolUseId: "shared-runtime-tool",
      result: "chat-1-result",
    })
    expect(appStore.get(pendingUserQuestionsAtom).has("sub-1")).toBe(false)
    expect(appStore.get(pendingUserQuestionsAtom).has("sub-2")).toBe(true)
    expect(appStore.get(askUserQuestionResultsAtom).get(firstKey)).toBe(
      "chat-1-result",
    )
    expect(appStore.get(askUserQuestionResultsAtom).has(secondKey)).toBe(false)
    expect(appStore.get(askUserQuestionApprovalIdsAtom)).toEqual(
      new Map([["approval-chat-2", secondKey]]),
    )

    applyRuntimeEventStateChunk(otherContext, {
      type: "ask-user-question-result",
      approvalId: "approval-chat-2",
      toolUseId: "shared-runtime-tool",
      result: "chat-2-result",
    })
    expect(appStore.get(pendingUserQuestionsAtom).size).toBe(0)
    expect(appStore.get(askUserQuestionResultsAtom)).toEqual(
      new Map([
        [firstKey, "chat-1-result"],
        [secondKey, "chat-2-result"],
      ]),
    )
    expect(appStore.get(askUserQuestionApprovalIdsAtom).size).toBe(0)
  })

  test("clears the AskUser memo cache by its composite chat and tool key", () => {
    const props = {
      input: { questions },
      state: "call",
      subChatId: "sub-cache-A",
      toolCallId: "shared-cache-tool",
    }

    expect(areAskUserQuestionPropsEqual(props, props)).toBe(false)
    expect(areAskUserQuestionPropsEqual(props, props)).toBe(true)

    clearToolStateCachesByToolCallIds("sub-cache-B", ["shared-cache-tool"])
    expect(areAskUserQuestionPropsEqual(props, props)).toBe(true)

    clearToolStateCachesByToolCallIds("sub-cache-A", ["shared-cache-tool"])
    expect(areAskUserQuestionPropsEqual(props, props)).toBe(false)
  })

  test("scope-expansion UI state tracks the main-minted event id", () => {
    applyRuntimeEventStateChunk(context, {
      type: "guard-event",
      event: {
        id: "scope-request-A",
        runId: "run-A",
        contractId: "contract-shared",
        type: "scope-expansion-request",
        toolUseId: "tool-shared",
        path: "src/a.ts",
        paths: ["src/a.ts"],
        reason: "A request",
        createdAt: "2026-08-26T00:00:00.000Z",
      },
    })
    applyRuntimeEventStateChunk(context, {
      type: "guard-event",
      event: {
        id: "scope-request-B",
        runId: "run-B",
        contractId: "contract-shared",
        type: "scope-expansion-request",
        toolUseId: "tool-shared",
        path: "src/b.ts",
        paths: ["src/b.ts"],
        reason: "B request",
        createdAt: "2026-08-26T00:00:01.000Z",
      },
    })

    expect(
      appStore.get(pendingScopeExpansionRequestsAtom).get("sub-1"),
    ).toMatchObject({
      requestId: "scope-request-B",
      toolUseId: "tool-shared",
      path: "src/b.ts",
    })
  })
})
