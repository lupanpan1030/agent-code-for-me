import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const activeChatSource = readFileSync(
  "src/renderer/features/agents/main/active-chat.tsx",
  "utf8",
)
const chatInputSource = readFileSync(
  "src/renderer/features/agents/main/chat-input-area.tsx",
  "utf8",
)
const newChatFormSource = readFileSync(
  "src/renderer/features/agents/main/new-chat-form.tsx",
  "utf8",
)
const runtimeModelSelectorSource = readFileSync(
  "src/renderer/features/agents/components/runtime-model-selector.tsx",
  "utf8",
)
const agentModelSelectorSource = readFileSync(
  "src/renderer/features/agents/components/agent-model-selector.tsx",
  "utf8",
)
const appServerSmokeSource = readFileSync(
  "scripts/smoke-codex-app-server-desktop.ts",
  "utf8",
)
const quickChatSmokeSource = readFileSync(
  "scripts/smoke-quick-chat-project-sidebar.ts",
  "utf8",
)
const queueProcessorSource = readFileSync(
  "src/renderer/features/agents/components/queue-processor.tsx",
  "utf8",
)
const subChatStoreSource = readFileSync(
  "src/renderer/features/agents/stores/sub-chat-store.ts",
  "utf8",
)
const codexRouterSource = readFileSync(
  "src/main/lib/trpc/routers/codex.ts",
  "utf8",
)
const claudeRouterSource = readFileSync(
  "src/main/lib/trpc/routers/claude.ts",
  "utf8",
)

function sliceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

describe("renderer chat session binding owner", () => {
  test("uses the DTO binding as the only existing-chat runtime truth", () => {
    expect(activeChatSource).toContain("const chatProvider = binding.runtime")
    expect(activeChatSource).toContain("binding={binding}")
    const transportConstructors = [
      ...activeChatSource.matchAll(
        /new (?:ACPChatTransport|IPCChatTransport)\(\{/g,
      ),
    ]
    expect(transportConstructors).toHaveLength(4)
    for (const constructorMatch of transportConstructors) {
      const constructorSource = activeChatSource.slice(
        constructorMatch.index,
        constructorMatch.index + 400,
      )
      expect(constructorSource).toMatch(/binding(?:,|: newSubChat\.binding)/)
    }
    expect(activeChatSource).not.toContain("inferAgentChatProviderFromMessages")
    expect(activeChatSource).not.toContain("subChatProviderOverrides")
    expect(activeChatSource).not.toMatch(
      /instanceof (?:ACPChatTransport|IPCChatTransport)/,
    )
    expect(
      activeChatSource.match(/key=\{getChatViewInstanceKey\(chat\)\}/g),
    ).toHaveLength(3)
  })

  test("keeps the first-party Codex effort preference while a Profile is selected", () => {
    const profileThinkingPath = sliceBetween(
      newChatFormSource,
      "const selectedCodexProfileIsPending =",
      "selectedCodexProfileId &&\n      !selectedCodexProviderProfile",
    )
    const profileGuardIndex = profileThinkingPath.indexOf(
      "if (selectedCodexProfileId) return",
    )
    const thinkingWriteIndex = profileThinkingPath.indexOf(
      "setLastSelectedCodexThinking(selectedCodexThinking)",
    )
    expect(profileGuardIndex).toBeGreaterThanOrEqual(0)
    expect(thinkingWriteIndex).toBeGreaterThan(profileGuardIndex)
  })

  test("persists, publishes, and recreates the replacement transport without a mounted view", () => {
    const updatePath = sliceBetween(
      activeChatSource,
      "const handleBindingChange = useCallback(",
      "// Handle creating a new sub-chat",
    )
    const mutationIndex = updatePath.indexOf(
      "await trpcClient.chats.updateSubChatBinding.mutate",
    )
    const receiptPublicationIndex = updatePath.indexOf(
      "publishChatSessionBindingReceipt({",
      mutationIndex,
    )
    const cacheIndex = updatePath.indexOf(
      "utils.agents.getAgentChat.setData",
      receiptPublicationIndex,
    )
    const receiptIndex = updatePath.indexOf(
      "agentSubChatsRef.current = agentSubChatsRef.current.map",
      cacheIndex,
    )
    const authRetryReceiptIndex = updatePath.indexOf(
      "appStore.set(pendingAuthRetryMessageAtom, null)",
      receiptIndex,
    )
    const deleteIndex = updatePath.indexOf(
      "agentChatStore.delete(subChatId)",
      authRetryReceiptIndex,
    )
    const replacementIndex = updatePath.indexOf(
      "const replacementChat = getOrCreateChat(subChatId)",
      deleteIndex,
    )
    const renderReceiptIndex = updatePath.indexOf(
      "flushSync(() => forceUpdate({}))",
      replacementIndex,
    )

    expect(mutationIndex).toBeGreaterThanOrEqual(0)
    expect(receiptPublicationIndex).toBeGreaterThan(mutationIndex)
    expect(updatePath).toContain("context: operationContext")
    expect(cacheIndex).toBeGreaterThan(receiptPublicationIndex)
    expect(receiptIndex).toBeGreaterThan(cacheIndex)
    expect(authRetryReceiptIndex).toBeGreaterThan(receiptIndex)
    expect(deleteIndex).toBeGreaterThan(authRetryReceiptIndex)
    expect(replacementIndex).toBeGreaterThan(deleteIndex)
    expect(renderReceiptIndex).toBeGreaterThan(replacementIndex)
    expect(updatePath).toContain("if (chatViewMountedRef.current)")
  })

  test("settles live question approvals through their exact captured renderer owner", () => {
    const approvalPath = sliceBetween(
      activeChatSource,
      "const respondToLiveUserQuestion = useCallback(",
      "// Handle answering questions",
    )
    expect(approvalPath).toContain("respondToRuntimeQuestionApproval({")
    expect(approvalPath).toContain("subChatId: question.subChatId")
    expect(approvalPath).toContain("approvalId: question.approvalId")
    expect(approvalPath).toContain("toolUseId: question.toolUseId")
    expect(approvalPath).toContain('toast.error(t("agent.askUser.error")')

    const answerPath = sliceBetween(
      activeChatSource,
      "const handleQuestionsAnswer = useCallback(",
      "// Handle skipping questions",
    )
    const skipPath = sliceBetween(
      activeChatSource,
      "const handleQuestionsSkip = useCallback",
      "// Ref to prevent double submit",
    )
    expect(answerPath).toContain("respondToLiveUserQuestion(displayQuestions")
    expect(skipPath).toContain("respondToLiveUserQuestion(displayQuestions")
    expect(answerPath).not.toContain("clearPendingQuestionCallback()\n      }")
    expect(skipPath).not.toContain("Clear UI immediately")
    expect(activeChatSource).not.toContain("setPendingQuestionsMap")
  })

  test("retains captured work across normal eviction and cancels only explicit close", () => {
    expect(
      activeChatSource.match(
        /shouldRetainChatSessionDuringNormalEviction\(\{/g,
      ),
    ).toHaveLength(3)
    expect(
      activeChatSource.match(/deferUntilPendingChatSessionOperationsSettle\(/g),
    ).toHaveLength(3)
    expect(subChatStoreSource).toContain(
      "cancelPendingChatSessionOperations(subChatId)",
    )
    expect(
      subChatStoreSource.indexOf(
        "cancelPendingChatSessionOperations(subChatId)",
      ),
    ).toBeLessThan(
      subChatStoreSource.indexOf("agentChatStore.delete(subChatId)"),
    )

    const localQueueSendPath = sliceBetween(
      activeChatSource,
      "const handleSendFromQueue = useCallback",
      "const handleRemoveFromQueue",
    )
    expect(localQueueSendPath).toContain(
      "withPendingChatSessionOperation(subChatId",
    )
    expect(
      localQueueSendPath.indexOf("isChatSessionOperationCancelledError(error)"),
    ).toBeLessThan(localQueueSendPath.indexOf("prependItem(subChatId, item)"))

    const globalQueueCatchIndex = queueProcessorSource.indexOf(
      "isChatSessionOperationCancelledError(error)",
    )
    expect(globalQueueCatchIndex).toBeGreaterThanOrEqual(0)
    expect(globalQueueCatchIndex).toBeLessThan(
      queueProcessorSource.indexOf("prependItem(subChatId, item)"),
    )
  })

  test("cannot recreate a transport while its chat is streaming", () => {
    const updatePath = sliceBetween(
      activeChatSource,
      "const handleBindingChange = useCallback(",
      "// Handle creating a new sub-chat",
    )
    const streamingGuardIndex = updatePath.indexOf(
      "useStreamingStatusStore.getState().isStreaming(subChatId)",
    )
    const mutationIndex = updatePath.indexOf(
      "await trpcClient.chats.updateSubChatBinding.mutate",
    )

    expect(streamingGuardIndex).toBeGreaterThanOrEqual(0)
    expect(mutationIndex).toBeGreaterThan(streamingGuardIndex)
    expect(chatInputSource).toContain("disabled={isStreaming}")
    expect(runtimeModelSelectorSource).toContain("disabled={disabled}")
  })

  test("serializes every send and binding transition through one per-chat gate", () => {
    const updatePath = sliceBetween(
      activeChatSource,
      "const handleBindingChange = useCallback(",
      "// Handle creating a new sub-chat",
    )
    expect(updatePath).toContain("withChatSessionBindingGate(subChatId")
    expect(activeChatSource).not.toContain("sendMessageRef")
    expect(activeChatSource).not.toContain("regenerateRef")
    expect(
      activeChatSource.match(/withCurrentChatSessionBindingGate\(/g),
    ).toHaveLength(4)
    expect(activeChatSource).toContain("currentChat.sendMessage(message)")
    const currentChatSendPath = sliceBetween(
      activeChatSource,
      "const sendMessageWithBindingGate = useCallback",
      "const sendAuthRetryMessageWithBindingGate",
    )
    expect(currentChatSendPath).toContain(
      "operationContext?: ChatSessionOperationContext",
    )
    expect(currentChatSendPath).toContain("context.throwIfCancelled()")
    expect(currentChatSendPath).toContain("operationContext,")
    expect(activeChatSource).toContain("currentChat.regenerate()")
    expect(activeChatSource).toContain("currentChat.resumeStream()")
    expect(activeChatSource).toContain(
      "void regenerateInitialMessageWithBindingGate(generationKey)",
    )
    expect(activeChatSource).not.toMatch(/\n\s+regenerate\(\)/)
    expect(activeChatSource).toContain("resume: false")
    expect(activeChatSource).not.toContain("resumeStreamRef")
    expect(activeChatSource).not.toContain("resume: !!streamId")
    expect(activeChatSource).not.toContain("bindingUpdateChainsRef")

    const queueGateIndex = queueProcessorSource.indexOf(
      "withChatSessionBindingGate(subChatId",
    )
    const currentChatIndex = queueProcessorSource.indexOf(
      "agentChatStore.get(subChatId)",
      queueGateIndex,
    )
    const sendIndex = queueProcessorSource.indexOf(
      "await chat.sendMessage",
      currentChatIndex,
    )
    expect(queueGateIndex).toBeGreaterThanOrEqual(0)
    expect(currentChatIndex).toBeGreaterThan(queueGateIndex)
    expect(sendIndex).toBeGreaterThan(currentChatIndex)
  })

  test("captures every direct-send payload before awaiting a selector mutation", () => {
    expect(chatInputSource).toContain(
      "pendingBindingUpdateRef.current = operation",
    )
    expect(chatInputSource.match(/runPendingSubmit\(\(context\) =>/g)).toHaveLength(5)
    expect(chatInputSource).toContain(
      "withPendingChatSessionOperation(subChatId",
    )
    for (const [start, end] of [
      ["const guardedSend = useCallback", "const guardedEditorSubmit"],
      [
        "const handleSendButtonClick = useCallback",
        "const hasSendButtonContent",
      ],
    ] as const) {
      const sendPath = sliceBetween(chatInputSource, start, end)
      expect(sendPath).toContain("onSend(waitForBindingUpdate, context)")
      expect(sendPath).not.toContain("await waitForBindingUpdate()")
    }

    const forcePath = sliceBetween(
      chatInputSource,
      "const guardedForceSend = useCallback",
      "const stablePromptSubmit",
    )
    expect(forcePath).toContain("onForceSend(waitForBindingUpdate, context)")
    expect(forcePath).not.toContain("await waitForBindingUpdate()")

    const questionPath = sliceBetween(
      chatInputSource,
      "const guardedEditorSubmit = useCallback",
      "const guardedForceSend",
    )
    expect(questionPath).toContain("await runPendingSubmit((context) =>")
    expect(questionPath).toContain(
      "onSubmitWithQuestionAnswer(waitForBindingUpdate, context)",
    )

    const directSendPath = sliceBetween(
      activeChatSource,
      "const handleSend = useCallback",
      "// Queue handlers for sending queued messages",
    )
    const capturedInputIndex = directSendPath.indexOf(
      "const inputValue = editorRef.current?.getValue()",
    )
    const capturedAttachmentsIndex = directSendPath.indexOf(
      "const currentFileContents = Array.from(fileContentsRef.current.entries())",
    )
    const bindingWaitIndex = directSendPath.indexOf(
      "await waitForBindingUpdate()",
    )
    const clearBeforeWaitIndex = directSendPath.indexOf(
      "editorRef.current?.clear()",
    )
    const restoreAfterFailureIndex = directSendPath.indexOf(
      "editorRef.current?.setValue(inputValue)",
    )
    expect(capturedInputIndex).toBeGreaterThanOrEqual(0)
    expect(capturedAttachmentsIndex).toBeGreaterThan(capturedInputIndex)
    expect(clearBeforeWaitIndex).toBeGreaterThan(capturedAttachmentsIndex)
    expect(bindingWaitIndex).toBeGreaterThan(clearBeforeWaitIndex)
    expect(restoreAfterFailureIndex).toBeGreaterThan(bindingWaitIndex)
    expect(directSendPath).toContain("operationContext?.throwIfCancelled()")
    expect(directSendPath).toContain("operationContext,")

    const directForcePath = sliceBetween(
      activeChatSource,
      "const handleForceSend = useCallback",
      "// NOTE: Auto-processing of queue",
    )
    const forceInputIndex = directForcePath.indexOf(
      "const inputValue = editorRef.current?.getValue()",
    )
    const forceStopIndex = directForcePath.indexOf("await handleStop()")
    const forceBindingWaitIndex = directForcePath.indexOf(
      "await waitForBindingUpdate()",
    )
    const forceClearIndex = directForcePath.indexOf(
      "editorRef.current?.clear()",
    )
    const forceRestoreIndex = directForcePath.indexOf(
      "editorRef.current?.setValue(inputValue)",
    )
    expect(forceInputIndex).toBeGreaterThanOrEqual(0)
    expect(forceClearIndex).toBeGreaterThan(forceInputIndex)
    expect(forceStopIndex).toBeGreaterThan(forceClearIndex)
    expect(forceBindingWaitIndex).toBeGreaterThan(forceStopIndex)
    expect(forceRestoreIndex).toBeGreaterThan(forceBindingWaitIndex)
    expect(directForcePath).toContain("operationContext?.throwIfCancelled()")
    expect(directForcePath).toContain("operationContext,")

    const questionFollowUpPath = sliceBetween(
      activeChatSource,
      "const handleSubmitWithQuestionAnswer = useCallback",
      "// Memoize the callback",
    )
    expect(questionFollowUpPath).toContain(
      "operationContext?: ChatSessionOperationContext",
    )
    expect(questionFollowUpPath).toContain(
      "operationContext?.throwIfCancelled()",
    )
    expect(questionFollowUpPath).toContain(
      "sendUserMessage(customText, operationContext)",
    )

    const queueDrainPath = sliceBetween(
      chatInputSource,
      "const handleEditorSubmit = useCallback",
      "// Mention select handler",
    )
    expect(queueDrainPath).toContain(
      "stopBeforePendingChatSessionBindingUpdate({",
    )
    expect(queueDrainPath).toContain("runPendingSubmit(async (context) =>")
    expect(queueDrainPath).toContain(
      "onSendFromQueue(firstQueueItemId, context)",
    )
    expect(
      queueDrainPath.indexOf("onSendFromQueue(firstQueueItemId, context)"),
    ).toBeGreaterThan(
      queueDrainPath.indexOf("stopBeforePendingChatSessionBindingUpdate({"),
    )

    const sendButtonQueueDrainPath = sliceBetween(
      chatInputSource,
      "const handleSendButtonClick = useCallback",
      "const hasSendButtonContent",
    )
    expect(sendButtonQueueDrainPath).toContain(
      "stopBeforePendingChatSessionBindingUpdate({",
    )
    expect(sendButtonQueueDrainPath).toContain(
      "runPendingSubmit(async (context) =>",
    )
    expect(sendButtonQueueDrainPath).toContain(
      "onSendFromQueue(firstQueueItemId, context)",
    )
    expect(
      sendButtonQueueDrainPath.indexOf("onSendFromQueue(firstQueueItemId, context)"),
    ).toBeGreaterThan(
      sendButtonQueueDrainPath.indexOf(
        "stopBeforePendingChatSessionBindingUpdate({",
      ),
    )

    const localQueueSendPath = sliceBetween(
      activeChatSource,
      "const handleSendFromQueue = useCallback",
      "const handleRemoveFromQueue",
    )
    expect(localQueueSendPath).toContain(
      "inheritedContext?: ChatSessionOperationContext",
    )
    expect(localQueueSendPath).toContain("context,\n        )")
    expect(localQueueSendPath).toContain("}, inheritedContext)")
  })

  test("switches runtime with a complete target binding and only writes on explicit UI actions", () => {
    expect(chatInputSource).toContain(
      "getNewChatSessionBindingDefaults(nextProvider)",
    )
    expect(chatInputSource).not.toContain("claudeSourceNormalization.changed")
    expect(chatInputSource).not.toMatch(
      /subChat(?:ModelId|ClaudeModelSource|CodexModelId|CodexModelSource|CodexThinking)AtomFamily/,
    )
    expect(chatInputSource).toMatch(
      /onSelectThinking: \(thinking\) => \{[\s\S]*?modelId: selectedCodexModel\.id,[\s\S]*?thinkingLevel: thinking/,
    )
    expect(chatInputSource).toContain(
      "supportsThinking: !selectedCodexProfileId",
    )
    expect(newChatFormSource).toContain(
      "supportsThinking: !selectedCodexProfileId",
    )
    expect(agentModelSelectorSource).toContain(
      "codex.supportsThinking !== false",
    )
  })

  test("never rewrites first-party Codex source from credential availability", () => {
    for (const source of [chatInputSource, newChatFormSource]) {
      const selectionPath = sliceBetween(
        source,
        "const effectiveCodexFirstPartySource =",
        "const codexApiKeyModels =",
      )
      expect(selectionPath).not.toContain("setupStatus.codex.authMethod")
      expect(selectionPath).not.toContain("hasAppCodexApiKey")
      expect(selectionPath).toContain('=== "openai-api-key"')
      expect(selectionPath).toContain('=== "chatgpt"')
    }
  })

  test("selects and leaves Provider Profiles through one complete binding update", () => {
    const profileSelectionPath = sliceBetween(
      agentModelSelectorSource,
      "const handleItemClick = (item: FlatModelItem) => {",
      "const handleCodexAccountSourceSelect = useCallback(",
    )
    expect(profileSelectionPath).toContain("claude.onSelectProviderProfile")
    expect(profileSelectionPath).toContain("codex.onSelectProviderProfile")
    expect(profileSelectionPath).not.toContain("onSelectModelSource(source")

    expect(
      chatInputSource.match(
        /onSelectProviderProfile: \(profile\) => \{[\s\S]*?createProviderProfileChatSessionBindingWrite\([\s\S]*?void updateBinding\(binding\)/g,
      ),
    ).toHaveLength(2)
    expect(newChatFormSource).toContain(
      "createProviderProfileChatSessionBindingWrite({",
    )
    expect(chatInputSource).toMatch(
      /selectedClaudeProfileId[\s\S]*?modelSource: "claude-oauth" as const,[\s\S]*?providerProfileId: null/,
    )
    expect(chatInputSource).toMatch(
      /selectedCodexProfileId[\s\S]*?modelSource: "chatgpt" as const,[\s\S]*?providerProfileId: null,[\s\S]*?thinkingLevel: nextThinking/,
    )
  })

  test("does not disguise an unavailable Claude Profile binding as OAuth", () => {
    expect(chatInputSource).toContain(
      "const effectiveClaudeModelSource = normalizedClaudeModelSource",
    )
    expect(chatInputSource).toContain("selectedClaudeProfileIsUnavailable")
    expect(chatInputSource).toContain(
      't("workbench.error.provider_profile_missing.title")',
    )
    expect(chatInputSource).not.toMatch(
      /selectedClaudeProfileId[\s\S]{0,180}!selectedClaudeProviderProfile[\s\S]{0,180}\? "claude-oauth"/,
    )
  })

  test("creation paths cache server DTOs carrying canonical bindings", () => {
    expect(activeChatSource.match(/binding: newSubChatBinding/g)).toHaveLength(
      2,
    )
    expect(
      activeChatSource.match(
        /subChats: \[\.\.\.\(old\.subChats \?\? \[\]\), newSubChat\]/g,
      ),
    ).toHaveLength(1)
    expect(
      activeChatSource.match(
        /subChats: \[\.\.\.\(old\.subChats \|\| \[\]\), newSubChat\]/g,
      ),
    ).toHaveLength(1)
    expect(
      newChatFormSource.match(/binding: selectedChatBinding/g),
    ).toHaveLength(2)
    expect(newChatFormSource).not.toMatch(
      /subChat(?:ModelId|ClaudeModelSource|CodexModelId|CodexModelSource|CodexThinking)AtomFamily/,
    )
    expect(appServerSmokeSource).toContain("seedSubChatBinding(")
    expect(appServerSmokeSource).toContain("updateSubChatBinding(")
    expect(appServerSmokeSource).toContain(
      "createCodexAppServerSmokeBindingTuple({",
    )
    expect(
      quickChatSmokeSource.match(/caller\.chats\.create\(\{/g),
    ).toHaveLength(6)
    expect(
      quickChatSmokeSource.match(
        /binding: (?:claudeBinding|codexBindingTuple\.binding)/g,
      ),
    ).toHaveLength(6)
    expect(quickChatSmokeSource).not.toMatch(
      /(?:provider|modelSource|providerProfileId): .*\n[\s\S]{0,120}caller\.chats\.create/,
    )
  })

  test("keeps the Codex desktop smoke on exact approval and subscription owners", () => {
    expect(appServerSmokeSource).toContain("approvalId: record.approvalId")
    expect(appServerSmokeSource).not.toContain("toolUseId: record.toolUseId")
    expect(appServerSmokeSource).toContain("activeSubscription.unsubscribe()")
    expect(appServerSmokeSource).toContain("waitForCanceledJobForRun(runId)")
    expect(appServerSmokeSource).not.toContain("caller.codex.cancel(")
  })

  test("main desktop routes admit renderer payloads against DB binding truth", () => {
    expect(codexRouterSource).toContain("admitCodexChatSessionBindingRun(")
    expect(codexRouterSource).toContain(
      "providerProfileId: bindingAdmission.providerProfileId",
    )
    expect(codexRouterSource).toContain(
      "requestedModel: bindingAdmission.requestedModel",
    )
    expect(claudeRouterSource).toContain("admitClaudeChatSessionBindingRun(")
    expect(claudeRouterSource).toContain(
      "modelSource: bindingAdmission.modelSource",
    )
    expect(claudeRouterSource).toContain(
      "requestedModel: bindingAdmission.requestedModel",
    )
  })
})
