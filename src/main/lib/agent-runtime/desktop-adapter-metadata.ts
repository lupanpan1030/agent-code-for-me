import type { DesktopRuntimeAdapterMetadata } from "./desktop-runner"
import type { AgentRuntimeEnforcementEvidence } from "./run-contract"

export const CLAUDE_AGENT_SDK_DESKTOP_ADAPTER_METADATA = {
  runtimeId: "claude-code",
  source: "claude-agent-sdk",
  label: "Claude Agent SDK",
  temporaryFallback: false,
  fallbackReason: null,
  defaultDisableCondition: null,
  removalCondition: null,
} satisfies DesktopRuntimeAdapterMetadata

export const CODEX_APP_SERVER_DESKTOP_ADAPTER_METADATA = {
  runtimeId: "codex",
  source: "codex-app-server",
  label: "Codex app-server adapter",
  temporaryFallback: false,
  fallbackReason: null,
  defaultDisableCondition: null,
  removalCondition: null,
} satisfies DesktopRuntimeAdapterMetadata

/**
 * Enforcement evidence of the desktop leaves: the Claude Agent SDK
 * canUseTool path and the Codex app-server approval bridge decide each tool
 * request before it executes.
 */
export const CLAUDE_AGENT_SDK_DESKTOP_ENFORCEMENT_EVIDENCE =
  "pre-execution" as const satisfies AgentRuntimeEnforcementEvidence

export const CODEX_APP_SERVER_DESKTOP_ENFORCEMENT_EVIDENCE =
  "pre-execution" as const satisfies AgentRuntimeEnforcementEvidence
