import { afterEach, describe, expect, test } from "bun:test"
import { Chat, type UIMessage, useChat } from "@ai-sdk/react"
import type { ChatTransport } from "ai"
import { Window } from "happy-dom"
import { act, createElement, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  claimChatInitialGeneration,
  clearChatInitialGenerationClaimsForTest,
  releaseFailedChatInitialGeneration,
  runClaimedChatInitialGeneration,
} from "../src/renderer/features/agents/lib/chat-initial-generation"
import {
  clearChatSessionBindingGatesForTest,
  withChatSessionBindingGate,
  withCurrentChatSessionBindingGate,
} from "../src/renderer/features/agents/lib/chat-session-binding-gate"
import { getChatViewInstanceKey } from "../src/renderer/features/agents/lib/chat-view-instance-key"
import { agentChatStore } from "../src/renderer/features/agents/stores/agent-chat-store"

const testWindow = new Window({ url: "http://localhost/" })
Object.assign(globalThis, {
  window: testWindow,
  document: testWindow.document,
  navigator: testWindow.navigator,
  Node: testWindow.Node,
  Element: testWindow.Element,
  HTMLElement: testWindow.HTMLElement,
  MutationObserver: testWindow.MutationObserver,
})
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let mountedRoot: Root | null = null

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount())
  }
  mountedRoot = null
  testWindow.document.body.replaceChildren()
  clearChatInitialGenerationClaimsForTest()
  clearChatSessionBindingGatesForTest()
  agentChatStore.clear()
})

function message(id: string): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text: id }],
  }
}

function ChatProbe({ chat }: { chat: Chat<UIMessage> }) {
  const { messages } = useChat({ chat })
  return createElement(
    "div",
    { "data-testid": "messages" },
    messages.map((item) => item.id).join(","),
  )
}

function InitialGenerationProbe({
  chat,
  subChatId,
  onGeneration,
}: {
  chat: Chat<UIMessage>
  subChatId: string
  onGeneration: (generation: Promise<unknown>) => void
}) {
  const { messages, status } = useChat({ chat })
  useEffect(() => {
    if (messages.length !== 1 || status !== "ready") return
    const firstMessage = messages[0]
    const generationKey = claimChatInitialGeneration(
      subChatId,
      firstMessage?.id,
    )
    if (!generationKey) return

    onGeneration(
      withCurrentChatSessionBindingGate(subChatId, (currentChat) =>
        runClaimedChatInitialGeneration({
          generationKey,
          regenerate: () => currentChat.regenerate(),
          getStatus: () => currentChat.status,
        }),
      ),
    )
  }, [messages, onGeneration, status, subChatId])

  return null
}

describe("chat view instance key", () => {
  test("remounts useChat when a same-id Chat instance is recreated", async () => {
    const container = testWindow.document.createElement("div")
    testWindow.document.body.append(container)
    mountedRoot = createRoot(container)
    const firstChat = new Chat<UIMessage>({
      id: "same-sub-chat",
      messages: [],
    })
    const secondChat = new Chat<UIMessage>({
      id: "same-sub-chat",
      messages: [],
    })

    await act(async () => {
      mountedRoot?.render(
        createElement(ChatProbe, {
          key: getChatViewInstanceKey(firstChat),
          chat: firstChat,
        }),
      )
    })
    await act(async () => {
      firstChat.messages = [message("first")]
    })
    expect(container.textContent).toBe("first")

    await act(async () => {
      mountedRoot?.render(
        createElement(ChatProbe, {
          key: getChatViewInstanceKey(secondChat),
          chat: secondChat,
        }),
      )
    })
    await act(async () => {
      secondChat.messages = [message("second")]
    })
    expect(container.textContent).toBe("second")

    await act(async () => {
      firstChat.messages = [message("stale-old-instance")]
    })
    expect(container.textContent).toBe("second")
  })

  test("claims one initial generation across a binding-gated same-id remount", async () => {
    const subChatId = "same-sub-chat-initial-generation"
    const transportCalls: string[] = []
    const transport = (owner: string): ChatTransport<UIMessage> => ({
      sendMessages: async () => {
        transportCalls.push(owner)
        return new ReadableStream({
          start(controller) {
            controller.close()
          },
        })
      },
      reconnectToStream: async () => null,
    })
    const initialMessages = [message("initial-message")]
    const oldChat = new Chat<UIMessage>({
      id: subChatId,
      messages: initialMessages,
      transport: transport("old"),
    })
    const replacementChat = new Chat<UIMessage>({
      id: subChatId,
      messages: initialMessages,
      transport: transport("replacement"),
    })
    agentChatStore.set(subChatId, oldChat, "parent-1")

    const container = testWindow.document.createElement("div")
    testWindow.document.body.append(container)
    mountedRoot = createRoot(container)
    const generationPromises: Promise<unknown>[] = []
    const onGeneration = (generation: Promise<unknown>) => {
      generationPromises.push(generation)
    }

    let releaseBindingUpdate: (() => void) | undefined
    const bindingUpdateBlocked = new Promise<void>((resolve) => {
      releaseBindingUpdate = resolve
    })
    let markBindingUpdateStarted: (() => void) | undefined
    const bindingUpdateStarted = new Promise<void>((resolve) => {
      markBindingUpdateStarted = resolve
    })
    const bindingUpdate = withChatSessionBindingGate(subChatId, async () => {
      markBindingUpdateStarted?.()
      await bindingUpdateBlocked
      agentChatStore.delete(subChatId)
      agentChatStore.set(subChatId, replacementChat, "parent-1")
      mountedRoot?.render(
        createElement(InitialGenerationProbe, {
          key: getChatViewInstanceKey(replacementChat),
          chat: replacementChat,
          subChatId,
          onGeneration,
        }),
      )
    })
    await bindingUpdateStarted

    await act(async () => {
      mountedRoot?.render(
        createElement(InitialGenerationProbe, {
          key: getChatViewInstanceKey(oldChat),
          chat: oldChat,
          subChatId,
          onGeneration,
        }),
      )
    })
    expect(generationPromises).toHaveLength(1)

    await act(async () => {
      releaseBindingUpdate?.()
      await bindingUpdate
      await Promise.all(generationPromises)
    })

    expect(generationPromises).toHaveLength(1)
    expect(transportCalls).toEqual(["replacement"])
    expect(claimChatInitialGeneration(subChatId, "initial-message")).toBeNull()
  })

  test("releases only a failed initial-generation claim for retry", () => {
    const generationKey = claimChatInitialGeneration(
      "retry-sub-chat",
      "initial-message",
    )
    expect(generationKey).toBe("retry-sub-chat:initial-message")
    expect(
      claimChatInitialGeneration("retry-sub-chat", "initial-message"),
    ).toBeNull()
    releaseFailedChatInitialGeneration("other-sub-chat:initial-message")
    expect(
      claimChatInitialGeneration("retry-sub-chat", "initial-message"),
    ).toBeNull()
    releaseFailedChatInitialGeneration(generationKey ?? "")
    expect(
      claimChatInitialGeneration("retry-sub-chat", "initial-message"),
    ).toBe("retry-sub-chat:initial-message")
  })

  test("releases an initial-generation claim when current-Chat admission fails", async () => {
    const subChatId = "missing-current-chat"
    const messageId = "initial-message"
    const generationKey = claimChatInitialGeneration(subChatId, messageId)
    if (!generationKey) throw new Error("Expected an initial claim")

    try {
      await withCurrentChatSessionBindingGate(subChatId, (currentChat) =>
        runClaimedChatInitialGeneration({
          generationKey,
          regenerate: () => currentChat.regenerate(),
          getStatus: () => currentChat.status,
        }),
      )
    } catch {
      // This is the outer active-chat catch: the inner generation helper never
      // received control because there was no current Chat.
      releaseFailedChatInitialGeneration(generationKey)
    }

    expect(claimChatInitialGeneration(subChatId, messageId)).toBe(generationKey)
  })
})
