/**
 * Implementer unit probes for refactor-unified-runtime-route-catalog touch-up
 * T1: the Runtime Route Catalog Single Owner production rules of
 * scripts/check-architecture-guards.mjs run over inline source text. Each
 * mutation probe starts from the real production file (or a minimal one),
 * applies one Phase II review mutation and must be reported with its exact
 * finding tuple; each clean counterpart must yield no finding. The frozen
 * architecture fixture (tests/fixtures/runtime-route-catalog) is untouched.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  collectRuntimeRouteCatalogFindings,
  collectRuntimeRouteRetiredMentions,
  RUNTIME_ROUTE_CATALOG_SECTION,
  RUNTIME_ROUTE_RULE,
} from "../scripts/check-architecture-guards.mjs"

const REPO_ROOT = join(import.meta.dir, "..")
const OWNER = "src/main/lib/agent-runtime/runtime-route-catalog.ts"
const ACTIVE_CHAT = "src/renderer/features/agents/main/active-chat.tsx"
const TRANSPORT_HELPER =
  "src/renderer/features/agents/lib/runtime-route-transport.ts"
const SUB_CHATS_ROUTER = "src/main/lib/trpc/routers/chats-sub-chats.ts"

type Finding = {
  rule: string
  file: string
  symbol: string
  owner: string
  ownerSection: string
}

function readRepoFile(file: string): string {
  return readFileSync(join(REPO_ROOT, file), "utf8")
}

/** Replaces the one occurrence of `anchor` (a missing anchor fails loudly). */
function mutate(source: string, anchor: string, replacement: string): string {
  expect(source.split(anchor).length - 1).toBe(1)
  return source.replace(anchor, replacement)
}

function scan(files: Record<string, string>): Finding[] {
  return collectRuntimeRouteCatalogFindings(
    Object.entries(files).map(([file, source]) => ({ file, source })),
  ) as Finding[]
}

function finding(rule: string, file: string, symbol: string): Finding {
  return {
    rule,
    file,
    symbol,
    owner: OWNER,
    ownerSection: RUNTIME_ROUTE_CATALOG_SECTION,
  }
}

describe("T1-1 renderer construction path, transport helper and main transportId selection", () => {
  const activeChat = readRepoFile(ACTIVE_CHAT)
  const helper = readRepoFile(TRANSPORT_HELPER)
  const subChats = readRepoFile(SUB_CHATS_ROUTER)

  test("clean counterparts: the production construction sites, helper and stamping router yield no finding", () => {
    expect(scan({ [ACTIVE_CHAT]: activeChat })).toEqual([])
    expect(scan({ [TRANSPORT_HELPER]: helper })).toEqual([])
    expect(scan({ [SUB_CHATS_ROUTER]: subChats })).toEqual([])
  })

  test("m7b: a binding.runtime ternary picking the transport input inside getOrCreateChat (still two helper calls) is a renderer-route-projection-bypass", () => {
    const mutated = mutate(
      activeChat,
      `        toRuntimeRouteTransportInput({
          readFailed: isLocalChatReadError,
          binding,
        }),
        { chatId, subChatId, binding, projectPath, mode: subChatMode },`,
      `        binding.runtime === "codex"
          ? { state: "loaded", transportId: "codex-chat-ipc" }
          : toRuntimeRouteTransportInput({
              readFailed: isLocalChatReadError,
              binding,
            }),
        { chatId, subChatId, binding, projectPath, mode: subChatMode },`,
    )
    expect(mutated.match(/createRuntimeRouteTransport\(/g)).toHaveLength(2)
    expect(scan({ [ACTIVE_CHAT]: mutated })).toEqual([
      finding(RUNTIME_ROUTE_RULE.renderer, ACTIVE_CHAT, "getOrCreateChat"),
    ])
  })

  test("m7c: a binding.runtime comparison on the failed-route branch of getOrCreateChat is a renderer-route-projection-bypass", () => {
    const mutated = mutate(
      activeChat,
      "      if (!route.ok) {",
      '      if (!route.ok && binding.runtime === "claude-code") {',
    )
    expect(scan({ [ACTIVE_CHAT]: mutated })).toEqual([
      finding(RUNTIME_ROUTE_RULE.renderer, ACTIVE_CHAT, "getOrCreateChat"),
    ])
  })

  test("construction path: a .runtime switch or includes test inside the P15 handler is reported; a runtime branch outside both paths is not", () => {
    const anchor = "    const newSubChatBinding = getNewSubChatBinding()\n"
    const switched = mutate(
      activeChat,
      anchor,
      `${anchor}    switch (newSubChatBinding.runtime) {
      default:
        break
    }
`,
    )
    expect(scan({ [ACTIVE_CHAT]: switched })).toEqual([
      finding(
        RUNTIME_ROUTE_RULE.renderer,
        ACTIVE_CHAT,
        "handleCreateNewSubChat",
      ),
    ])
    const included = mutate(
      activeChat,
      anchor,
      `${anchor}    if (["codex"].includes(newSubChatBinding.runtime)) {
      store.setActiveSubChat(chatId)
    }
`,
    )
    expect(scan({ [ACTIVE_CHAT]: included })).toEqual([
      finding(
        RUNTIME_ROUTE_RULE.renderer,
        ACTIVE_CHAT,
        "handleCreateNewSubChat",
      ),
    ])
    // P25/P26-style adjacent branch outside the construction paths.
    const adjacent = `${activeChat}
export function adjacentRuntimeLabel(binding: { runtime: string }) {
  return binding.runtime === "codex" ? "Codex" : "Claude Code"
}
`
    expect(scan({ [ACTIVE_CHAT]: adjacent })).toEqual([])
  })

  test("m14b: a runtime-keyed transportId map appended to the transport helper is a renderer-route-projection-bypass", () => {
    const mutated = `${helper}
export const TRANSPORT_ID_BY_RUNTIME = {
  codex: "codex-chat-ipc",
  "claude-code": "claude-chat-ipc",
}
`
    expect(scan({ [TRANSPORT_HELPER]: mutated })).toEqual([
      finding(
        RUNTIME_ROUTE_RULE.renderer,
        TRANSPORT_HELPER,
        "TRANSPORT_ID_BY_RUNTIME",
      ),
    ])
  })

  test("helper: a lone runtime-id literal or a .runtime branch inside createRuntimeRouteTransport is reported", () => {
    const literal = mutate(
      helper,
      '  if (input.state === "error") {',
      '  const fallbackRuntime = "claude"\n  if (input.state === "error") {',
    )
    expect(scan({ [TRANSPORT_HELPER]: literal })).toEqual([
      finding(
        RUNTIME_ROUTE_RULE.renderer,
        TRANSPORT_HELPER,
        "createRuntimeRouteTransport",
      ),
    ])
    const branch = mutate(
      helper,
      '  if (input.state === "error") {',
      '  if ((config as { runtime?: string }).runtime !== (input as { runtime?: string }).runtime) {\n    return { ok: false, failure: "unknown_transport" }\n  }\n  if (input.state === "error") {',
    )
    expect(scan({ [TRANSPORT_HELPER]: branch })).toEqual([
      finding(
        RUNTIME_ROUTE_RULE.renderer,
        TRANSPORT_HELPER,
        "createRuntimeRouteTransport",
      ),
    ])
  })

  test("m16: a runtime ternary stamping transportId literals in the main read model is a route-dispatch-outside-owner finding", () => {
    const mutated = mutate(
      subChats,
      "        binding: withRuntimeRouteTransportId(getSubChatBinding(db, subChat.id)),",
      `        binding: {
          ...getSubChatBinding(db, subChat.id),
          transportId:
            getSubChatBinding(db, subChat.id).runtime === "codex"
              ? "codex-chat-ipc"
              : "claude-chat-ipc",
        },`,
    )
    expect(scan({ [SUB_CHATS_ROUTER]: mutated })).toEqual([
      finding(RUNTIME_ROUTE_RULE.dispatch, SUB_CHATS_ROUTER, "getSubChat"),
    ])
  })

  test("main: if, switch and logical forms yielding transportId literals are reported; runtime branches yielding other values are not", () => {
    const file = "src/main/lib/agent-runtime/runtime-route-read-model.ts"
    const ifForm = `export function transportIdFor(binding: { runtime: string }) {
  if (binding.runtime === "claude-code") return "claude-chat-ipc"
  return "codex-chat-ipc"
}
`
    const switchForm = `export function transportIdFor(runtimeId: string) {
  switch (runtimeId) {
    case "codex":
      return "codex-chat-ipc"
    default:
      return "claude-chat-ipc"
  }
}
`
    const logicalForm = `export function transportIdFor(binding: { runtimeId: string }) {
  return (binding.runtimeId === "codex" && "codex-chat-ipc") || null
}
`
    for (const source of [ifForm, switchForm, logicalForm]) {
      expect(scan({ [file]: source })).toEqual([
        finding(RUNTIME_ROUTE_RULE.dispatch, file, "transportIdFor"),
      ])
    }
    // P25 provider target and a runtime-specific error message: no transportId.
    const clean = `export function providerTargetForBinding(binding: { runtime: string }) {
  return binding.runtime === "codex" ? "codex" : "claude"
}

export function assertCodexRuntime(binding: { runtime: string }) {
  if (binding.runtime !== "codex") {
    throw new Error("Codex transport requires the codex runtime.")
  }
}
`
    expect(scan({ [file]: clean })).toEqual([])
  })
})

describe("T1-2 a runtime choice between the D1 named hosts", () => {
  test("clean: the catalog and the typed per-procedure hosts and their callers yield no finding", () => {
    const files = [
      OWNER,
      "src/main/lib/claude/agent-sdk-desktop-run-runtime.ts",
      "src/main/lib/codex/desktop-chat-run.ts",
      "src/main/lib/headless/agent-runtime.ts",
      "src/main/lib/headless/job-runner.ts",
      "src/main/lib/trpc/routers/claude.ts",
      "src/main/lib/trpc/routers/codex.ts",
    ]
    expect(
      scan(Object.fromEntries(files.map((file) => [file, readRepoFile(file)]))),
    ).toEqual([])
  })

  test("m4: a router runtimeId branch choosing between the Codex and Claude desktop hosts is a route-dispatch-outside-owner finding", () => {
    const file = "src/main/lib/trpc/routers/desktop-runtime.ts"
    const source = `import { runClaudeAgentSdkDesktopRuntimeWithMcpReadiness } from "../../claude/agent-sdk-desktop-run-runtime"
import { runCodexDesktopChatRun } from "../../codex/desktop-chat-run"

export async function runDesktopRuntime(runtimeId: string, input: never) {
  if (runtimeId === "codex") return runCodexDesktopChatRun(input)
  return runClaudeAgentSdkDesktopRuntimeWithMcpReadiness(input)
}
`
    expect(scan({ [file]: source })).toEqual([
      finding(RUNTIME_ROUTE_RULE.dispatch, file, "runDesktopRuntime"),
    ])
  })

  test("m5: a runtime-keyed map of named hosts in headless is a route-dispatch-outside-owner finding", () => {
    const file = "src/main/lib/headless/runtime-hosts.ts"
    const source = `import { runCodexDesktopChatRun } from "../codex/desktop-chat-run"
import { runAgentTask } from "./agent-runtime"

export const HOSTS_BY_RUNTIME = {
  codex: runCodexDesktopChatRun,
  "claude-code": runAgentTask,
}
`
    expect(scan({ [file]: source })).toEqual([
      finding(RUNTIME_ROUTE_RULE.dispatch, file, "HOSTS_BY_RUNTIME"),
    ])
  })

  test("a runtime ternary picking a lazily imported host member is reported; a fixed-runtime host call is not", () => {
    const file = "src/main/lib/headless/job-runner.ts"
    const source = `export async function hostFor(runtimeId: string) {
  return runtimeId === "claude-code"
    ? (await import("./agent-runtime")).runAgentTask
    : (await import("../codex/desktop-chat-run")).runCodexDesktopChatRun
}
`
    expect(scan({ [file]: source })).toEqual([
      finding(RUNTIME_ROUTE_RULE.dispatch, file, "hostFor"),
    ])
    const fixed = `import { runCodexDesktopChatRun } from "../codex/desktop-chat-run"

export async function codexChatRunBody(input: { runtime: string }) {
  if (input.runtime !== "codex") throw new Error("stale binding")
  return runCodexDesktopChatRun(input as never)
}
`
    expect(scan({ [file]: fixed })).toEqual([])
  })
})

describe("T1-4 retired registry and readiness facade names", () => {
  const READ_MODEL = "src/main/lib/agent-runtime/runtime-route-read-model.ts"
  const READINESS = "src/main/lib/headless/runtime-readiness.ts"
  const RETIRED_NAMES = [
    "listRegisteredAgentRuntimeManifests",
    "getRegisteredAgentRuntimeManifest",
    "getRegisteredAgentRuntimeId",
    "checkRegisteredAgentRuntimeCapability",
    "resolveRegisteredAgentRuntimeManifest",
    "resolveRegisteredAgentRuntimeCapability",
    "resolveLocalJobApiRuntimeReadiness",
  ]

  test("clean: the production read model and readiness owner mention no retired name", () => {
    expect(
      collectRuntimeRouteRetiredMentions(READ_MODEL, readRepoFile(READ_MODEL)),
    ).toEqual([])
    expect(
      collectRuntimeRouteRetiredMentions(READINESS, readRepoFile(READINESS)),
    ).toEqual([])
  })

  test("m10: a forwarding alias re-export under a deleted registry name is a retired-route-selector finding", () => {
    const mutated = `${readRepoFile(READ_MODEL)}
export { listRuntimeRouteManifests as getRegisteredAgentRuntimeManifest } from "./runtime-route-catalog"
`
    expect(collectRuntimeRouteRetiredMentions(READ_MODEL, mutated)).toEqual([
      finding(
        RUNTIME_ROUTE_RULE.retired,
        READ_MODEL,
        "getRegisteredAgentRuntimeManifest",
      ),
    ])
  })

  test("every deleted registry export and the readiness facade name is rejected as a const forwarding alias", () => {
    for (const name of RETIRED_NAMES) {
      const mutated = `${readRepoFile(READINESS)}
export const ${name} = resolveCodexRuntimeReadiness
`
      expect(collectRuntimeRouteRetiredMentions(READINESS, mutated)).toEqual([
        finding(RUNTIME_ROUTE_RULE.retired, READINESS, name),
      ])
    }
  })
})
