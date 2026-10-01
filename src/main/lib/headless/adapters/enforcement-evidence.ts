import type { AgentRuntimeEnforcementEvidence } from "../../agent-runtime/run-contract"

/**
 * Enforcement evidence the headless leaves export as typed constants. The
 * runtime route catalog references these values; it never claims a stronger
 * level than its leaf.
 */
export const CLAUDE_CODE_BATCH_ENFORCEMENT_EVIDENCE =
  "sandbox-level" as const satisfies AgentRuntimeEnforcementEvidence

export const CODEX_BATCH_ENFORCEMENT_EVIDENCE =
  "sandbox-level" as const satisfies AgentRuntimeEnforcementEvidence

/**
 * The headless Codex app-server leaf binds a bounded policy grant only at
 * its admission/audit gate, not per scope before tool execution.
 */
export const CODEX_APP_SERVER_HEADLESS_ENFORCEMENT_EVIDENCE =
  "admission-audit" as const satisfies AgentRuntimeEnforcementEvidence
