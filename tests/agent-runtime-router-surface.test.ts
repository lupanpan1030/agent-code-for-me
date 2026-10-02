import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  CONTRACT_RUNTIME_IDS,
  checkAgentRuntimeCapability,
  getAgentRuntimeCapabilityManifest,
  resolveAgentRuntimeCapability,
  resolveAgentRuntimeCapabilityManifest,
} from "../src/shared/agent-runtime-capabilities"

// refactor-unified-runtime-route-catalog (design D5): renamed from
// tests/agent-runtime-registry.test.ts. The runtime-registry facade is
// retired; its facade tests migrate onto the shared capability owner that
// pure capability callers now use directly (catalog coverage: S06 unknown /
// retired IDs, S10 manifest truth). The two router-surface source-scan
// ratchets below are kept verbatim.
describe("agent runtime router surface", () => {
  test("exposes non-secret Claude Code and Codex capability manifests", () => {
    const manifests = CONTRACT_RUNTIME_IDS.map((runtimeId) =>
      getAgentRuntimeCapabilityManifest(runtimeId),
    )

    expect(manifests.map((manifest) => manifest.runtimeId)).toEqual([
      "claude-code",
      "codex",
    ])
    expect(getAgentRuntimeCapabilityManifest("claude").runtimeId).toBe(
      "claude-code",
    )
    expect(getAgentRuntimeCapabilityManifest("codex").runtimeId).toBe("codex")
    expect(JSON.stringify(manifests)).not.toMatch(
      /(^|[^A-Za-z0-9_])sk-[A-Za-z0-9_-]{20,}/,
    )
    expect(JSON.stringify(manifests)).not.toContain("access_token")
  })

  test("provides reusable runtime gating for future desktop CLI job and protocol callers", () => {
    expect(
      checkAgentRuntimeCapability({
        runtime: "claude-code",
        capabilityId: "rollback",
      }).ok,
    ).toBe(true)

    const codexRollback = checkAgentRuntimeCapability({
      runtime: "codex",
      capabilityId: "rollback",
    })
    expect(codexRollback.ok).toBe(false)
    if (!codexRollback.ok) {
      expect(codexRollback.diagnostic.message).toContain("unsupported")
    }
  })

  test("returns normalized unavailable-runtime diagnostics for unknown callers", () => {
    expect(resolveAgentRuntimeCapabilityManifest("future-runtime")).toEqual({
      ok: false,
      runtimeId: "future-runtime",
      diagnostic: {
        type: "unavailable-runtime",
        runtimeId: "future-runtime",
        message: "Agent runtime future-runtime is not registered.",
        hint: "Choose a registered runtime and retry.",
      },
    })

    expect(
      resolveAgentRuntimeCapability({
        runtime: "future-runtime",
        capabilityId: "planMode",
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        type: "unavailable-runtime",
      },
    })
  })

  test("is exposed through a runtime-neutral tRPC router", () => {
    const appRouter = readFileSync("src/main/lib/trpc/routers/index.ts", "utf8")
    const runtimeRouter = readFileSync(
      "src/main/lib/trpc/routers/agent-runtime.ts",
      "utf8",
    )
    const activeChat = readFileSync(
      "src/renderer/features/agents/main/active-chat.tsx",
      "utf8",
    )
    const runtimeCapabilities = readFileSync(
      "src/shared/agent-runtime-capabilities.ts",
      "utf8",
    )
    const retiredManagedRuntimeId = "kun"
    const retiredCliRuntimeId = "qwen-code"

    expect(appRouter).toContain("agentRuntime: agentRuntimeRouter")
    expect(runtimeRouter).toContain("listManifests")
    for (const removedRouterMember of [
      "getManifest",
      "checkCapability",
      "respondScopeExpansion",
      "getRuntimeFeatureSettings",
      "chat: publicProcedure",
      "respondToolApproval",
      "activeRuntimeStreams",
      "pendingRuntimeToolApprovals",
      "scopeContract",
    ]) {
      expect(runtimeRouter).not.toContain(removedRouterMember)
    }
    for (const retiredSymbol of ["Kun", "Qwen"]) {
      expect(runtimeRouter).not.toContain(retiredSymbol)
    }
    expect(activeChat).not.toContain(
      `provider === "${retiredManagedRuntimeId}"`,
    )
    expect(activeChat).not.toContain(`provider === "${retiredCliRuntimeId}"`)
    expect(runtimeCapabilities).not.toContain("KUN_RUNTIME_MANIFEST")
    expect(runtimeCapabilities).not.toContain("QWEN_CODE_RUNTIME_MANIFEST")
  })

  test("renderer consumes runtime manifests through a store instead of static capability truth", () => {
    const runtimeManifestStore = readFileSync(
      "src/renderer/features/agents/lib/runtime-manifest-store.ts",
      "utf8",
    )
    const activeChat = readFileSync(
      "src/renderer/features/agents/main/active-chat.tsx",
      "utf8",
    )
    const guardedRunCard = readFileSync(
      "src/renderer/features/agents/ui/agent-guarded-run-card.tsx",
      "utf8",
    )

    expect(runtimeManifestStore).toContain(
      "trpc.agentRuntime.listManifests.useQuery",
    )
    expect(runtimeManifestStore).toContain("runtimeCapabilityManifestsAtom")
    expect(activeChat).toContain("useRuntimeCapabilitySupported")
    expect(activeChat).toContain('"rollback"')
    expect(activeChat).not.toContain(
      'isRuntimeCapabilitySupported } from "../../../../shared/agent-runtime-capabilities"',
    )
    expect(guardedRunCard).not.toContain("isRuntimeCapabilitySupported")
  })
})
