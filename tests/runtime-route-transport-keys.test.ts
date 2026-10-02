/**
 * Implementer unit for refactor-unified-runtime-route-catalog touch-up T1-5a:
 * createRuntimeRouteTransport looks a transportId up only among the compiled
 * table's own keys. Prototype member names, a case variant and an empty id
 * are unknown transports: they return unknown_transport and construct no
 * wire adapter. Replacing the Object.hasOwn lookup with plain indexing makes
 * the prototype-key cases return a non-failure (or throw) and fail here.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test"

const constructions: Array<{ wire: string; config: unknown }> = []

class RecordingIpcChatTransport {
  constructor(readonly config: unknown) {
    constructions.push({ wire: "IPCChatTransport", config })
  }
}

class RecordingCodexAppServerChatTransport {
  constructor(readonly config: unknown) {
    constructions.push({ wire: "CodexAppServerChatTransport", config })
  }
}

mock.module("../src/renderer/features/agents/lib/ipc-chat-transport", () => ({
  IPCChatTransport: RecordingIpcChatTransport,
}))
mock.module(
  "../src/renderer/features/agents/lib/codex-app-server-chat-transport",
  () => ({ CodexAppServerChatTransport: RecordingCodexAppServerChatTransport }),
)

const { createRuntimeRouteTransport } = await import(
  "../src/renderer/features/agents/lib/runtime-route-transport"
)

const CONFIG = { chatId: "chat-1", subChatId: "sub-1" } as never

beforeEach(() => {
  constructions.length = 0
})

describe("createRuntimeRouteTransport transportId lookup", () => {
  const unknownIds = [
    "constructor",
    "__proto__",
    "toString",
    "hasOwnProperty",
    "valueOf",
    "CLAUDE-CHAT-IPC",
    "Codex-Chat-Ipc",
    "",
  ]

  for (const transportId of unknownIds) {
    test(`"${transportId}" is unknown_transport with zero constructor calls`, () => {
      let result: unknown
      let thrown: unknown = null
      try {
        result = createRuntimeRouteTransport(
          { state: "loaded", transportId },
          CONFIG,
        )
      } catch (error) {
        thrown = error
      }
      expect({ thrown, result }).toEqual({
        thrown: null,
        result: { ok: false, failure: "unknown_transport" },
      })
      expect(constructions).toEqual([])
    })
  }

  test("the two compiled own keys each construct exactly their wire adapter once", () => {
    const claude = createRuntimeRouteTransport(
      { state: "loaded", transportId: "claude-chat-ipc" },
      CONFIG,
    )
    const codex = createRuntimeRouteTransport(
      { state: "loaded", transportId: "codex-chat-ipc" },
      CONFIG,
    )
    expect(claude.ok && claude.transport).toBeInstanceOf(
      RecordingIpcChatTransport,
    )
    expect(codex.ok && codex.transport).toBeInstanceOf(
      RecordingCodexAppServerChatTransport,
    )
    expect(constructions).toEqual([
      { wire: "IPCChatTransport", config: CONFIG },
      { wire: "CodexAppServerChatTransport", config: CONFIG },
    ])
  })
})
