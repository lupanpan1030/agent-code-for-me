import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  clearAuthRetryTransportGenerationsForTest,
  getChatSessionBindingIdentity,
  isCurrentAuthRetryBindingIdentity,
  isCurrentAuthRetryTransportGeneration,
  pendingAuthRetryMatchesBinding,
  registerAuthRetryTransportGeneration,
  releaseAuthRetryTransportGeneration,
} from "../src/renderer/features/agents/lib/auth-retry-binding"
import {
  didCodexAuthRetryLoginSatisfyBinding,
  failCodexAuthErrorStream,
  resolveRequiredCodexAuthRetryMethod,
} from "../src/renderer/features/agents/lib/codex-auth-retry"
import type { ChatSessionBinding } from "../src/shared/chat-session-binding"

afterEach(() => {
  clearAuthRetryTransportGenerationsForTest()
})

function binding(patch: Partial<ChatSessionBinding> = {}): ChatSessionBinding {
  return {
    id: "binding-1",
    subChatId: "sub-1",
    runtime: "codex",
    providerProfileId: null,
    modelId: "gpt-5.4",
    modelSource: "chatgpt",
    thinkingLevel: "high",
    createdAt: new Date("2026-08-26T00:00:00.000Z"),
    updatedAt: new Date("2026-08-26T00:00:01.000Z"),
    ...patch,
  }
}

describe("Codex binding-specific auth retry", () => {
  const apiKeyRetry = {
    provider: "codex" as const,
    requiredCodexAuthMethod: "api_key" as const,
  }
  const chatGptRetry = {
    provider: "codex" as const,
    requiredCodexAuthMethod: "chatgpt" as const,
  }

  test("does not unlock an API-key-bound retry after ChatGPT succeeds", () => {
    expect(
      didCodexAuthRetryLoginSatisfyBinding({
        pending: apiKeyRetry,
        successfulMethod: "chatgpt",
      }),
    ).toBe(false)
  })

  test("does not unlock a ChatGPT-bound retry after API-key login succeeds", () => {
    expect(
      didCodexAuthRetryLoginSatisfyBinding({
        pending: chatGptRetry,
        successfulMethod: "api_key",
      }),
    ).toBe(false)
  })

  test("preselects and unlocks only the authentication method required by the binding", () => {
    expect(resolveRequiredCodexAuthRetryMethod(apiKeyRetry)).toBe("api_key")
    expect(resolveRequiredCodexAuthRetryMethod(chatGptRetry)).toBe("chatgpt")
    expect(
      didCodexAuthRetryLoginSatisfyBinding({
        pending: apiKeyRetry,
        successfulMethod: "api_key",
      }),
    ).toBe(true)
    expect(
      didCodexAuthRetryLoginSatisfyBinding({
        pending: chatGptRetry,
        successfulMethod: "chatgpt",
      }),
    ).toBe(true)

    const modalSource = readFileSync(
      "src/renderer/components/dialogs/codex-login-modal.tsx",
      "utf8",
    )
    expect(modalSource).toContain("setMethod(requiredAuthRetryMethod)")
    expect(modalSource).toContain("didCodexAuthRetryLoginSatisfyBinding({")
  })

  test("binds retry payloads to the exact source, profile, model, effort, and revision", () => {
    const original = binding()
    const originalIdentity = getChatSessionBindingIdentity(original)

    for (const changed of [
      binding({ modelSource: "openai-api-key" }),
      binding({
        providerProfileId: "profile-1",
        modelSource: "provider-profile:profile-1",
        thinkingLevel: null,
      }),
      binding({ modelId: "gpt-5.5" }),
      binding({ thinkingLevel: "xhigh" }),
      binding({ updatedAt: new Date("2026-08-26T00:00:02.000Z") }),
    ]) {
      expect(getChatSessionBindingIdentity(changed)).not.toBe(originalIdentity)
      expect(
        pendingAuthRetryMatchesBinding(
          { bindingIdentity: originalIdentity },
          changed,
        ),
      ).toBe(false)
    }

    expect(
      pendingAuthRetryMatchesBinding(
        { bindingIdentity: originalIdentity },
        binding(),
      ),
    ).toBe(true)
  })

  test("a replacement transport retires a deferred auth probe from the old binding", async () => {
    let resolveProbe: (() => void) | undefined
    const probe = new Promise<void>((resolve) => {
      resolveProbe = resolve
    })
    const oldGeneration = registerAuthRetryTransportGeneration(
      "sub-1",
      binding(),
    )
    const oldProbeMayPublish = probe.then(() =>
      isCurrentAuthRetryTransportGeneration(oldGeneration),
    )

    const replacementBinding = binding({
      providerProfileId: "profile-1",
      modelId: "provider-model",
      modelSource: "provider-profile:profile-1",
      thinkingLevel: null,
      updatedAt: new Date("2026-08-26T00:00:02.000Z"),
    })
    const replacementGeneration = registerAuthRetryTransportGeneration(
      "sub-1",
      replacementBinding,
    )
    resolveProbe?.()

    expect(await oldProbeMayPublish).toBe(false)
    expect(isCurrentAuthRetryTransportGeneration(replacementGeneration)).toBe(
      true,
    )
    expect(
      isCurrentAuthRetryBindingIdentity(
        "sub-1",
        replacementGeneration.bindingIdentity,
      ),
    ).toBe(true)

    // Cleanup from the retired transport cannot clear the replacement owner.
    releaseAuthRetryTransportGeneration(oldGeneration)
    expect(isCurrentAuthRetryTransportGeneration(replacementGeneration)).toBe(
      true,
    )
  })

  for (const source of ["first-party", "provider-profile"] as const) {
    test(`${source} auth failure closes only its exact captured subscription`, () => {
      const events: string[] = []
      let exactUnsubscribeCount = 0
      const unrelatedUnsubscribeCount = 0

      failCodexAuthErrorStream({
        error: new Error(`${source} authentication failed`),
        errorStream: (error) => events.push(`error:${error.message}`),
        unsubscribe: () => {
          exactUnsubscribeCount++
          events.push("unsubscribe:exact")
        },
      })

      expect(events).toEqual([
        `error:${source} authentication failed`,
        "unsubscribe:exact",
      ])
      expect(exactUnsubscribeCount).toBe(1)
      expect(unrelatedUnsubscribeCount).toBe(0)
    })
  }

  test("auth cleanup still unsubscribes when the renderer stream already rejects erroring", () => {
    let unsubscribeCount = 0
    expect(() =>
      failCodexAuthErrorStream({
        error: new Error("authentication failed"),
        errorStream: () => {
          throw new Error("stream already closed")
        },
        unsubscribe: () => {
          unsubscribeCount++
        },
      }),
    ).toThrow("stream already closed")
    expect(unsubscribeCount).toBe(1)
  })
})
