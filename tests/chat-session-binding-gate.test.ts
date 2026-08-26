import { afterEach, describe, expect, test } from "bun:test"
import { Chat } from "@ai-sdk/react"
import type { ChatTransport, UIMessage } from "ai"
import {
  cancelPendingChatSessionOperations,
  clearChatSessionBindingGatesForTest,
  deferUntilPendingChatSessionOperationsSettle,
  hasPendingChatSessionOperation,
  isChatSessionOperationCancelledError,
  publishChatSessionBindingReceipt,
  shouldRetainChatSessionDuringNormalEviction,
  stopBeforePendingChatSessionBindingUpdate,
  withChatSessionBindingGate,
  withCurrentChatSessionBindingGate,
  withPendingChatSessionOperation,
} from "../src/renderer/features/agents/lib/chat-session-binding-gate"
import {
  claimChatStreamResume,
  clearChatStreamResumeClaimsForTest,
  releaseFailedChatStreamResume,
  resumeClaimedChatStream,
} from "../src/renderer/features/agents/lib/chat-stream-resume"
import { agentChatStore } from "../src/renderer/features/agents/stores/agent-chat-store"

afterEach(() => {
  clearChatSessionBindingGatesForTest()
  clearChatStreamResumeClaimsForTest()
  agentChatStore.clear()
})

describe("chat session binding transition gate", () => {
  test("normal navigation can retain a chat while a captured operation is pending", async () => {
    let releaseOperation: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => {
      releaseOperation = resolve
    })

    const operation = withPendingChatSessionOperation(
      "sub-navigation",
      async () => {
        await blocked
      },
    )

    // Retention is visible synchronously, before the operation reaches its
    // first await. Both parent-workspace pruning and resident-tab eviction use
    // this same predicate.
    expect(hasPendingChatSessionOperation("sub-navigation")).toBe(true)
    const retentionByPath = Object.fromEntries(
      ["parent-workspace-switch", "resident-tab-limit"].map((path) => [
        path,
        shouldRetainChatSessionDuringNormalEviction({
          subChatId: "sub-navigation",
          isStreaming: false,
          queuedMessageCount: 0,
        }),
      ]),
    )
    expect(retentionByPath).toEqual({
      "parent-workspace-switch": true,
      "resident-tab-limit": true,
    })
    releaseOperation?.()
    await operation
    expect(hasPendingChatSessionOperation("sub-navigation")).toBe(false)
  })

  test("deferred normal eviction rechecks after the last operation releases", async () => {
    const subChatId = "sub-deferred-eviction"
    agentChatStore.set(
      subChatId,
      new Chat<UIMessage>({ id: subChatId, messages: [] }),
      "parent-1",
    )
    let releaseOperation: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => {
      releaseOperation = resolve
    })
    let markRechecked: (() => void) | undefined
    const rechecked = new Promise<void>((resolve) => {
      markRechecked = resolve
    })
    const events: string[] = []

    const operation = withPendingChatSessionOperation(subChatId, async () => {
      events.push("operation:start")
      await blocked
      events.push("operation:finish")
    })

    function attemptEviction() {
      if (
        deferUntilPendingChatSessionOperationsSettle(subChatId, attemptEviction)
      )
        return
      if (
        shouldRetainChatSessionDuringNormalEviction({
          subChatId,
          isStreaming: false,
          queuedMessageCount: 0,
        })
      )
        return
      agentChatStore.delete(subChatId)
      events.push("eviction:recheck")
      markRechecked?.()
    }

    attemptEviction()
    expect(agentChatStore.has(subChatId)).toBe(true)

    releaseOperation?.()
    await operation
    expect(events).toEqual(["operation:start", "operation:finish"])
    await rechecked
    expect(agentChatStore.has(subChatId)).toBe(false)
    expect(events).toEqual([
      "operation:start",
      "operation:finish",
      "eviction:recheck",
    ])
  })

  test("explicit close cancels old work without poisoning later operations", async () => {
    let releaseOperation: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => {
      releaseOperation = resolve
    })

    const operation = withPendingChatSessionOperation(
      "sub-explicit-close",
      async (context) => {
        await blocked
        context.throwIfCancelled()
      },
    )

    expect(hasPendingChatSessionOperation("sub-explicit-close")).toBe(true)
    cancelPendingChatSessionOperations("sub-explicit-close")
    releaseOperation?.()

    let cancellationError: unknown
    try {
      await operation
    } catch (error) {
      cancellationError = error
    }
    expect(isChatSessionOperationCancelledError(cancellationError)).toBe(true)
    expect(hasPendingChatSessionOperation("sub-explicit-close")).toBe(false)

    await expect(
      withPendingChatSessionOperation("sub-explicit-close", () => "fresh"),
    ).resolves.toBe("fresh")
  })

  test("close after mutation dispatch publishes its receipt before reopen without recreating the closed transport", async () => {
    const subChatId = "sub-close-receipt-reopen"
    let resolveMutation: ((binding: string) => void) | undefined
    const mutation = new Promise<string>((resolve) => {
      resolveMutation = resolve
    })
    let markMutationStarted: (() => void) | undefined
    const mutationStarted = new Promise<void>((resolve) => {
      markMutationStarted = resolve
    })
    let queryBinding = "old-binding"
    let subChatRefBinding = "old-binding"
    let replacementCount = 0

    const update = withChatSessionBindingGate(
      subChatId,
      async (context) => {
        markMutationStarted?.()
        const receipt = await mutation
        publishChatSessionBindingReceipt({
          context,
          receipt,
          publish: (canonicalBinding) => {
            queryBinding = canonicalBinding
            subChatRefBinding = canonicalBinding
          },
        })
        replacementCount++
      },
    )

    await mutationStarted
    cancelPendingChatSessionOperations(subChatId)
    resolveMutation?.("new-binding")

    let cancellationError: unknown
    try {
      await update
    } catch (error) {
      cancellationError = error
    }
    expect(isChatSessionOperationCancelledError(cancellationError)).toBe(true)
    expect(queryBinding).toBe("new-binding")
    expect(subChatRefBinding).toBe("new-binding")
    expect(replacementCount).toBe(0)

    // A later explicit reopen reads the receipt-published canonical ref; it
    // cannot resurrect the pre-mutation binding from the closed UI operation.
    const reopenedBinding = subChatRefBinding
    expect(reopenedBinding).toBe("new-binding")
  })

  test("normalizes a transport failure after explicit close to cancellation", async () => {
    let releaseSend: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => {
      releaseSend = resolve
    })
    const send = withChatSessionBindingGate("sub-transport-close", async () => {
      await blocked
      throw new Error("transport aborted")
    })

    cancelPendingChatSessionOperations("sub-transport-close")
    releaseSend?.()

    let cancellationError: unknown
    try {
      await send
    } catch (error) {
      cancellationError = error
    }
    expect(isChatSessionOperationCancelledError(cancellationError)).toBe(true)
  })

  test("closing an idle chat does not pre-cancel its next operation", async () => {
    cancelPendingChatSessionOperations("sub-idle-close")

    await expect(
      withPendingChatSessionOperation("sub-idle-close", () => "fresh"),
    ).resolves.toBe("fresh")
  })

  test("an inherited outer context cannot send an old prompt after same-id reopen", async () => {
    const subChatId = "sub-close-reopen-old-prompt"
    const calls = { old: [] as UIMessage[][], reopened: [] as UIMessage[][] }
    const transport = (
      owner: keyof typeof calls,
    ): ChatTransport<UIMessage> => ({
      sendMessages: async ({ messages }) => {
        calls[owner].push(messages)
        return new ReadableStream({
          start(controller) {
            controller.close()
          },
        })
      },
      reconnectToStream: async () => null,
    })
    agentChatStore.set(
      subChatId,
      new Chat<UIMessage>({
        id: subChatId,
        messages: [],
        transport: transport("old"),
      }),
      "parent-1",
    )

    let releasePreparation: (() => void) | undefined
    const preparationBlocked = new Promise<void>((resolve) => {
      releasePreparation = resolve
    })
    let markPreparationStarted: (() => void) | undefined
    const preparationStarted = new Promise<void>((resolve) => {
      markPreparationStarted = resolve
    })

    const oldSubmit = withPendingChatSessionOperation(
      subChatId,
      async (outerContext) => {
        markPreparationStarted?.()
        await preparationBlocked
        await withCurrentChatSessionBindingGate(
          subChatId,
          (currentChat) =>
            currentChat.sendMessage({
              role: "user",
              parts: [{ type: "text", text: "old prompt" }],
            }),
          outerContext,
        )
      },
    )

    await preparationStarted
    cancelPendingChatSessionOperations(subChatId)
    agentChatStore.delete(subChatId)
    agentChatStore.set(
      subChatId,
      new Chat<UIMessage>({
        id: subChatId,
        messages: [],
        transport: transport("reopened"),
      }),
      "parent-1",
    )
    releasePreparation?.()

    let cancellationError: unknown
    try {
      await oldSubmit
    } catch (error) {
      cancellationError = error
    }
    expect(isChatSessionOperationCancelledError(cancellationError)).toBe(true)
    expect(calls).toEqual({ old: [], reopened: [] })

    await withCurrentChatSessionBindingGate(subChatId, (currentChat) =>
      currentChat.sendMessage({
        role: "user",
        parts: [{ type: "text", text: "fresh prompt" }],
      }),
    )
    expect(calls.old).toHaveLength(0)
    expect(calls.reopened).toHaveLength(1)
    expect(calls.reopened[0]?.at(-1)?.parts).toEqual([
      { type: "text", text: "fresh prompt" },
    ])
  })

  test("a send queued behind a binding update resolves current transport state", async () => {
    let releaseUpdate: (() => void) | undefined
    const updateBlocked = new Promise<void>((resolve) => {
      releaseUpdate = resolve
    })
    let markUpdateStarted: (() => void) | undefined
    const updateStarted = new Promise<void>((resolve) => {
      markUpdateStarted = resolve
    })
    let bindingModel = "old-model"
    const events: string[] = []

    const update = withChatSessionBindingGate("sub-1", async () => {
      events.push("update:start")
      markUpdateStarted?.()
      await updateBlocked
      bindingModel = "new-model"
      events.push("update:finish")
    })
    const send = withChatSessionBindingGate("sub-1", () => {
      events.push(`send:${bindingModel}`)
    })

    await updateStarted
    expect(events).toEqual(["update:start"])
    releaseUpdate?.()
    await Promise.all([update, send])
    expect(events).toEqual(["update:start", "update:finish", "send:new-model"])
  })

  test("a captured immediate send uses only the replacement Chat transport after remount", async () => {
    const subChatId = "sub-remounted-send"
    const calls = { old: [] as UIMessage[][], replacement: [] as UIMessage[][] }
    const transport = (
      owner: keyof typeof calls,
    ): ChatTransport<UIMessage> => ({
      sendMessages: async ({ messages }) => {
        calls[owner].push(messages)
        return new ReadableStream({
          start(controller) {
            controller.close()
          },
        })
      },
      reconnectToStream: async () => null,
    })
    const oldChat = new Chat<UIMessage>({
      id: subChatId,
      messages: [],
      transport: transport("old"),
    })
    const replacementChat = new Chat<UIMessage>({
      id: subChatId,
      messages: [],
      transport: transport("replacement"),
    })
    agentChatStore.set(subChatId, oldChat, "parent-1")

    let releaseUpdate: (() => void) | undefined
    const updateBlocked = new Promise<void>((resolve) => {
      releaseUpdate = resolve
    })
    let markUpdateStarted: (() => void) | undefined
    const updateStarted = new Promise<void>((resolve) => {
      markUpdateStarted = resolve
    })
    const update = withChatSessionBindingGate(subChatId, async () => {
      markUpdateStarted?.()
      await updateBlocked
      agentChatStore.delete(subChatId)
      agentChatStore.set(subChatId, replacementChat, "parent-1")
    })
    await updateStarted

    let uncontrolledInput = "captured before binding remount"
    const capturedText = uncontrolledInput
    const send = withCurrentChatSessionBindingGate(subChatId, (currentChat) =>
      currentChat.sendMessage({
        role: "user",
        parts: [{ type: "text", text: capturedText }],
      }),
    )
    // Model the old input unmount: the source becomes unavailable while the
    // captured operation remains queued behind the binding transition.
    uncontrolledInput = ""
    expect(uncontrolledInput).toBe("")

    releaseUpdate?.()
    await Promise.all([update, send])

    expect(calls.old).toHaveLength(0)
    expect(calls.replacement).toHaveLength(1)
    expect(calls.replacement[0]?.at(-1)?.parts).toEqual([
      { type: "text", text: "captured before binding remount" },
    ])
  })

  test("a claimed resume reconnects only the replacement Chat after remount", async () => {
    const subChatId = "sub-remounted-resume"
    const reconnects = { old: 0, replacement: 0 }
    const transport = (
      owner: keyof typeof reconnects,
    ): ChatTransport<UIMessage> => ({
      sendMessages: async () => new ReadableStream(),
      reconnectToStream: async () => {
        reconnects[owner] += 1
        return new ReadableStream({
          start(controller) {
            controller.close()
          },
        })
      },
    })
    const oldChat = new Chat<UIMessage>({
      id: subChatId,
      messages: [],
      transport: transport("old"),
    })
    const replacementChat = new Chat<UIMessage>({
      id: subChatId,
      messages: [],
      transport: transport("replacement"),
    })
    agentChatStore.set(subChatId, oldChat, "parent-1")

    let releaseUpdate: (() => void) | undefined
    const updateBlocked = new Promise<void>((resolve) => {
      releaseUpdate = resolve
    })
    let markUpdateStarted: (() => void) | undefined
    const updateStarted = new Promise<void>((resolve) => {
      markUpdateStarted = resolve
    })
    const update = withChatSessionBindingGate(subChatId, async () => {
      markUpdateStarted?.()
      await updateBlocked
      agentChatStore.delete(subChatId)
      agentChatStore.set(subChatId, replacementChat, "parent-1")
    })
    await updateStarted

    const resumeKey = claimChatStreamResume(subChatId, "persisted-stream")
    if (!resumeKey) throw new Error("Expected the old mount to claim resume")
    const resume = withCurrentChatSessionBindingGate(subChatId, (currentChat) =>
      resumeClaimedChatStream({
        resumeKey,
        resume: () => currentChat.resumeStream(),
        getStatus: () => currentChat.status,
      }),
    )

    releaseUpdate?.()
    const [, outcome] = await Promise.all([update, resume])

    expect(outcome).toBe("retained")
    expect(reconnects).toEqual({ old: 0, replacement: 1 })
  })

  test("releases a resume claim when current-Chat admission fails", async () => {
    const subChatId = "sub-missing-resume-chat"
    const streamId = "persisted-stream"
    const resumeKey = claimChatStreamResume(subChatId, streamId)
    if (!resumeKey) throw new Error("Expected a resume claim")

    try {
      await withCurrentChatSessionBindingGate(subChatId, (currentChat) =>
        resumeClaimedChatStream({
          resumeKey,
          resume: () => currentChat.resumeStream(),
          getStatus: () => currentChat.status,
        }),
      )
    } catch {
      releaseFailedChatStreamResume(resumeKey)
    }

    expect(claimChatStreamResume(subChatId, streamId)).toBe(resumeKey)
  })

  test("a binding update cannot overtake an already-started send", async () => {
    let releaseSend: (() => void) | undefined
    const sendBlocked = new Promise<void>((resolve) => {
      releaseSend = resolve
    })
    let markSendStarted: (() => void) | undefined
    const sendStarted = new Promise<void>((resolve) => {
      markSendStarted = resolve
    })
    const events: string[] = []

    const send = withChatSessionBindingGate("sub-1", async () => {
      events.push("send:start")
      markSendStarted?.()
      await sendBlocked
      events.push("send:finish")
    })
    const update = withChatSessionBindingGate("sub-1", () => {
      events.push("update")
    })

    await sendStarted
    expect(events).toEqual(["send:start"])
    releaseSend?.()
    await Promise.all([send, update])
    expect(events).toEqual(["send:start", "send:finish", "update"])
  })

  test("force stop releases a send before awaiting its queued binding update", async () => {
    let releaseSend: (() => void) | undefined
    const sendBlocked = new Promise<void>((resolve) => {
      releaseSend = resolve
    })
    let markSendStarted: (() => void) | undefined
    const sendStarted = new Promise<void>((resolve) => {
      markSendStarted = resolve
    })
    const events: string[] = []

    const send = withChatSessionBindingGate("sub-1", async () => {
      events.push("send:start")
      markSendStarted?.()
      await sendBlocked
      events.push("send:finish")
    })
    await sendStarted

    const update = withChatSessionBindingGate("sub-1", () => {
      events.push("update")
    })
    const ready = await stopBeforePendingChatSessionBindingUpdate({
      shouldStop: true,
      stop: async () => {
        events.push("stop")
        releaseSend?.()
      },
      waitForBindingUpdate: async () => {
        await update
        return true
      },
    })
    expect(ready).toBe(true)

    await withChatSessionBindingGate("sub-1", () => {
      events.push("force-send")
    })
    await send
    expect(events).toEqual([
      "send:start",
      "stop",
      "send:finish",
      "update",
      "force-send",
    ])
  })

  test("a binding update cannot overtake an active stream resume", async () => {
    let releaseResume: (() => void) | undefined
    const resumeBlocked = new Promise<void>((resolve) => {
      releaseResume = resolve
    })
    let markResumeStarted: (() => void) | undefined
    const resumeStarted = new Promise<void>((resolve) => {
      markResumeStarted = resolve
    })
    const events: string[] = []

    const resume = withChatSessionBindingGate("sub-1", async () => {
      events.push("resume:start")
      markResumeStarted?.()
      await resumeBlocked
      events.push("resume:finish")
    })
    await resumeStarted
    const update = withChatSessionBindingGate("sub-1", () => {
      events.push("update")
    })

    expect(events).toEqual(["resume:start"])
    releaseResume?.()
    await Promise.all([resume, update])
    expect(events).toEqual(["resume:start", "resume:finish", "update"])
  })

  test("a live question answer releases the run before update and follow-up send", async () => {
    let releaseRun: (() => void) | undefined
    const runBlocked = new Promise<void>((resolve) => {
      releaseRun = resolve
    })
    let markRunStarted: (() => void) | undefined
    const runStarted = new Promise<void>((resolve) => {
      markRunStarted = resolve
    })
    const events: string[] = []

    const run = withChatSessionBindingGate("sub-1", async () => {
      events.push("run:start")
      markRunStarted?.()
      await runBlocked
      events.push("run:finish")
    })
    await runStarted
    const update = withChatSessionBindingGate("sub-1", () => {
      events.push("update")
    })

    events.push("answer")
    releaseRun?.()
    await update
    await withChatSessionBindingGate("sub-1", () => {
      events.push("follow-up-send")
    })
    await run

    expect(events).toEqual([
      "run:start",
      "answer",
      "run:finish",
      "update",
      "follow-up-send",
    ])
  })
})
