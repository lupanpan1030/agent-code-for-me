import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Chat } from "@ai-sdk/react"
import type { ChatTransport, UIMessage } from "ai"
import {
  claimChatStreamResume,
  clearChatStreamResumeClaimsForTest,
  releaseFailedChatStreamResume,
  resolvePersistedChatStreamId,
  resumeClaimedChatStream,
} from "../src/renderer/features/agents/lib/chat-stream-resume"

describe("chat stream resume mapping and gate", () => {
  beforeEach(() => {
    clearChatStreamResumeClaimsForTest()
  })

  afterEach(() => {
    clearChatStreamResumeClaimsForTest()
  })

  test("maps the camelCase Drizzle DTO stream id and preserves legacy snake_case", () => {
    expect(resolvePersistedChatStreamId({ streamId: "stream-db" })).toBe(
      "stream-db",
    )
    expect(
      resolvePersistedChatStreamId({
        stream_id: "stream-legacy",
        streamId: "stream-db",
      }),
    ).toBe("stream-legacy")
    expect(resolvePersistedChatStreamId({ streamId: null })).toBeNull()
  })

  test("claims one resume per persisted stream across consumers and releases only failed keys", () => {
    expect(claimChatStreamResume("sub-1", "stream-1")).toBe("sub-1:stream-1")
    expect(claimChatStreamResume("sub-1", "stream-1")).toBeNull()
    expect(claimChatStreamResume("sub-1", "stream-2")).toBe("sub-1:stream-2")

    releaseFailedChatStreamResume("sub-1:stream-1")
    expect(claimChatStreamResume("sub-1", "stream-2")).toBeNull()
    releaseFailedChatStreamResume("sub-1:stream-2")
    expect(claimChatStreamResume("sub-1", "stream-2")).toBe("sub-1:stream-2")

    expect(claimChatStreamResume("sub-1", null)).toBeNull()
    expect(claimChatStreamResume("sub-1", "stream-2")).toBe("sub-1:stream-2")
  })

  test("deduplicates the same successful resume across two remounted real Chat consumers", async () => {
    let reconnectAttempts = 0
    const transport: ChatTransport<UIMessage> = {
      sendMessages: async () => new ReadableStream(),
      reconnectToStream: async () => {
        reconnectAttempts += 1
        return new ReadableStream({
          start(controller) {
            controller.close()
          },
        })
      },
    }
    const firstMountChat = new Chat<UIMessage>({
      id: "sub-remounted-chat",
      messages: [],
      transport,
    })
    const secondMountChat = new Chat<UIMessage>({
      id: "sub-remounted-chat",
      messages: [],
      transport,
    })

    const firstResumeKey = claimChatStreamResume(
      "sub-remounted-chat",
      "persisted-stream",
    )
    const secondResumeKey = claimChatStreamResume(
      "sub-remounted-chat",
      "persisted-stream",
    )

    expect(firstResumeKey).toBe("sub-remounted-chat:persisted-stream")
    expect(secondResumeKey).toBeNull()
    if (!firstResumeKey) throw new Error("Expected the first mount to claim.")

    expect(
      await resumeClaimedChatStream({
        resumeKey: firstResumeKey,
        resume: () => firstMountChat.resumeStream(),
        getStatus: () => firstMountChat.status,
      }),
    ).toBe("retained")
    expect(reconnectAttempts).toBe(1)
    expect(
      claimChatStreamResume("sub-remounted-chat", "persisted-stream"),
    ).toBeNull()
    expect(
      claimChatStreamResume("sub-remounted-chat", "next-persisted-stream"),
    ).toBe("sub-remounted-chat:next-persisted-stream")

    // Keep the second real Chat consumer live in the test: it represents the
    // replacement mount that was denied the duplicate resume.
    expect(secondMountChat.status).toBe("ready")
  })

  test("releases and retries across remounted real Chats when the SDK resolves with error status", async () => {
    let reconnectAttempts = 0
    const transport: ChatTransport<UIMessage> = {
      sendMessages: async () => new ReadableStream(),
      reconnectToStream: async () => {
        reconnectAttempts += 1
        throw new TypeError("network unavailable")
      },
    }
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const remountedChat = new Chat<UIMessage>({
        id: "sub-real-chat",
        messages: [],
        transport,
        onError: () => {},
      })
      const resumeKey = claimChatStreamResume(
        "sub-real-chat",
        "persisted-stream",
      )
      expect(resumeKey).toBe("sub-real-chat:persisted-stream")
      if (!resumeKey) throw new Error("Expected a retryable resume claim.")

      const outcome = await resumeClaimedChatStream({
        resumeKey,
        resume: () => remountedChat.resumeStream(),
        getStatus: () => remountedChat.status,
      })

      expect(outcome).toBe("released")
      expect(remountedChat.status).toBe("error")
      expect(reconnectAttempts).toBe(attempt)
    }
  })
})
