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
    expect(claude).toContain("buildGuardedRunAudit")
    expect(chunks).toContain('| { type: "guard-event"; event: AgentGuardEvent }')
    expect(chunks).toContain('| { type: "guard-audit"; audit: GuardedRunAudit }')
  })

  test("Codex transport and router receive a contract and produce an audit-only record", () => {
    const codex = readFileSync("src/main/lib/trpc/routers/codex.ts", "utf8")
    const acp = readFileSync(
      "src/renderer/features/agents/lib/acp-chat-transport.ts",
      "utf8",
    )

    expect(acp).toContain("approvedGuardedRunContractsAtom")
    expect(acp).toContain("scopeContract")
    expect(acp).toContain('chunk.type === "guard-audit"')
    expect(codex).toContain(
      "scopeContract: agentScopeContractInputSchema.optional()",
    )
    expect(codex).toContain("validateAgentScopeContract(input.scopeContract")
    expect(codex).toContain("buildGuardedRunPromptBlock(guardedContract)")
    expect(codex).toContain("buildGuardedRunAudit")
    expect(codex).toContain('enforcementMode: "contract-and-audit"')
  })
})
