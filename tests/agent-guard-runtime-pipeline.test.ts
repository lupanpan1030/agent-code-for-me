import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

describe("agent guard runtime pipeline", () => {
  test("Claude transport, router, and stream chunks are wired for hard enforcement", () => {
    const claude = readFileSync("src/main/lib/trpc/routers/claude.ts", "utf8")
    const ipc = readFileSync(
      "src/renderer/features/agents/lib/ipc-chat-transport.ts",
      "utf8",
    )
    const atoms = readFileSync(
      "src/renderer/features/agents/atoms/index.ts",
      "utf8",
    )
    const chunks = readFileSync("src/main/lib/claude/types.ts", "utf8")
    const input = readFileSync(
      "src/renderer/features/agents/main/chat-input-area.tsx",
      "utf8",
    )

    expect(atoms).toContain("approvedGuardedRunContractsAtom")
    expect(atoms).toContain("pendingScopeExpansionRequestsAtom")
    expect(ipc).toContain("runId: crypto.randomUUID()")
    expect(ipc).toContain("scopeContract")
    expect(ipc).toContain('chunk.type === "guard-event"')
    expect(ipc).toContain('chunk.type === "guard-audit"')
    expect(claude).toContain(
      "scopeContract: agentScopeContractInputSchema.optional()",
    )
    expect(claude).toContain("validateAgentScopeContract(input.scopeContract")
    expect(claude).toContain("decideClaudeToolUse")
    expect(claude).toContain("toClaudePermissionResult(decision)")
    expect(claude).toContain("respondScopeExpansion")
    expect(claude).toContain("activeGuardedContracts")
    expect(claude).toContain("buildGuardedRunAudit")
    expect(input).toContain("AgentGuardedRunCard")
    expect(input).toContain("approveGuardedRunDraft")
    expect(input).toContain("ensureGuardedRunReady")
    expect(chunks).toContain('| { type: "guard-event"; event: AgentGuardEvent }')
    expect(chunks).toContain('| { type: "guard-audit"; audit: GuardedRunAudit }')
  })

  test("Codex guarded and plan-mode runs are blocked instead of routed through audit-only enforcement", () => {
    const codex = readFileSync("src/main/lib/trpc/routers/codex.ts", "utf8")
    const acp = readFileSync(
      "src/renderer/features/agents/lib/acp-chat-transport.ts",
      "utf8",
    )

    expect(acp).toContain("approvedGuardedRunContractsAtom")
    expect(acp).toContain("scopeContract")
    expect(acp).toContain('chunk.type === "capability-error"')
    expect(codex).toContain(
      "scopeContract: agentScopeContractInputSchema.optional()",
    )
    expect(codex).toContain("getCodexRunBlockingCapability")
    expect(codex).toContain("buildCodexUnsupportedCapabilityErrorChunk")
    expect(codex).toContain("Codex guarded runs are blocked")
    expect(codex).toContain("Codex plan mode is blocked")
    expect(codex).not.toContain("buildGuardedRunPromptBlock(guardedContract)")
    expect(codex).not.toContain('enforcementMode: "contract-and-audit"')
    expect(codex).not.toContain("buildGuardedRunAudit")
  })

  test("Codex desktop route is wired to normalized runtime status before provider work", () => {
    const codex = readFileSync("src/main/lib/trpc/routers/codex.ts", "utf8")
    const acp = readFileSync(
      "src/renderer/features/agents/lib/acp-chat-transport.ts",
      "utf8",
    )

    expect(codex).toContain("buildCodexRuntimeAvailability")
    expect(codex).toContain("buildCodexRuntimeAvailabilityFromComponents")
    expect(codex).toContain("buildCodexRuntimeStatusChunk")
    expect(codex).toContain("buildCodexCapabilityErrorChunk")
    expect(codex).toContain("getCodexRuntimeCapabilities()")
    expect(codex).toContain("const runtimeStatus = await getCodexRuntimeStatus()")
    expect(codex).toContain("const integration = await getCodexIntegrationStatus()")
    expect(codex).toContain('id: "login"')
    expect(codex).toContain("runtimeStatus.blockers[0]")
    expect(codex).toContain('id: "provider-profile"')
    expect(codex).toContain('id: "mcp"')
    expect(codex).toContain('id: "local-only"')
    expect(acp).toContain('chunk.type === "runtime-status"')
  })
})
