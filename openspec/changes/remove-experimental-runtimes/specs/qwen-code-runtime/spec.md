# qwen-code-runtime Specification Delta

The `qwen-code` runtime is removed in full. This capability ceases to exist and
`openspec/specs/qwen-code-runtime/` is deleted.

**Shared reason for every requirement below.** The `qwen-code` runtime is retired because it has no
agent-guard enforcement — no file under `src/main/lib/qwen/` imports `agent-guard`, its approval
prompt renders only `toolCall.title` (never the path, diff, or command), and its plan mode is
cosmetic because `acpPermissionPolicy` is hardcoded `"ask"` for every control level. A user in Locus
"plan" mode was running a fully write-capable agent. Against the product thesis — run agents
**safely** in parallel on real git repos — it is liability with no unique capability.

**Shared migration for every requirement below.** No data migration. Verified 2026-08-12 that this
installation has zero `qwen-code` rows and Locus has no other users. Qwen *models* remain available
through Ollama and the DashScope provider preset; only the runtime is removed.

**Scope guard.** This delta removes the qwen-code **runtime**. It does not affect Qwen models
(`qwen2.5-coder`, `qwen3-coder`), the DashScope provider preset, the Codex ACP transport
(`acp-chat-transport.ts`, misleadingly named), or the Locus-owned `locus acp` stdio surface.

## REMOVED Requirements

### Requirement: Flag-gated Qwen Code runtime registration
**Reason**: The runtime is removed, so there is nothing to register. `EXPERIMENTAL_RUNTIME_IDS`
becomes empty and the feature-gate mechanism is deleted with it.
**Migration**: None required — no installation has the flag enabled.

### Requirement: Local ACP Client Transport
**Reason**: `src/main/lib/qwen/qwen-acp-client.ts` is deleted. Note this is the Qwen ACP client
only; the Codex-facing ACP surfaces and the Locus-owned `locus acp` stdio server are retained.
**Migration**: None.

### Requirement: Runtime-Neutral Desktop Chat Entry
**Reason**: The shared experimental desktop chat entry served only these two runtimes. With both
removed, the entry, its message-history store, and its stream/approval registries are deleted. The
equivalent requirement in `agent-runtime-core` is removed in the same change.
**Migration**: None. Contract runtimes dispatch through their own entry points, unchanged.

### Requirement: ACP event and error mapping
**Reason**: Deleted with the Qwen ACP client.
**Migration**: None.

### Requirement: Conservative Qwen permission policy
**Reason**: Removed with the runtime. This requirement was in any case not met by the shipped code —
it required file writes, shell, and MCP calls to route through the Locus guard and that the
runtime's own approvals not substitute for it, whereas the implementation was exactly that
substitution. Retiring it removes a spec that overstated enforcement.
**Migration**: None.

### Requirement: Isolated Qwen Auth and Smoke State
**Reason**: No Qwen auth or smoke state remains. The `qwen-acp:smoke:evidence` script and its
evidence gate in `tests/proof-evidence-gates.test.ts` are deleted.
**Migration**: None. The archived `add-qwen-acp-spike` change is left untouched as historical record.

### Requirement: Honest Qwen capability manifest
**Reason**: `QWEN_CODE_RUNTIME_MANIFEST` and its `AGENT_RUNTIME_MANIFESTS` entry are deleted.
**Migration**: None.
