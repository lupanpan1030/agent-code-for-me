export type CodexRuntimeCapabilityStatus =
  | "supported"
  | "degraded"
  | "unsupported"

export type CodexRuntimeCapabilityId =
  | "hardToolGuard"
  | "planMode"
  | "scopeExpansion"
  | "askUserQuestion"
  | "rollback"
  | "mcpAuth"
  | "mcpConfiguration"
  | "providerProfiles"
  | "attachments"
  | "usageMetadata"
  | "runtimePlugins"
  | "runtimeCommands"
  | "runtimeWorkflows"
  | "appAgents"

export type CodexRuntimeCapability = {
  id: CodexRuntimeCapabilityId
  label: string
  status: CodexRuntimeCapabilityStatus
  reason: string
  hint: string | null
}

export type CodexRuntimeCapabilityBlocker = {
  capability: CodexRuntimeCapabilityId
  status: CodexRuntimeCapabilityStatus
  message: string
  hint: string | null
  reason: string
}

export type CodexCapabilityErrorChunk = {
  type: "capability-error"
  runtime: "codex"
  capability: CodexRuntimeCapabilityId
  errorText: string
  blocker: CodexRuntimeCapabilityBlocker
}

const CODEX_RUNTIME_CAPABILITIES: readonly CodexRuntimeCapability[] = [
  {
    id: "hardToolGuard",
    label: "Hard tool guard",
    status: "unsupported",
    reason:
      "Current ACP integration does not expose a reliable pre-execution allow/deny/rewrite hook for Codex tool calls.",
    hint: "Use Claude for guarded runs until Codex has a Locus-owned tool proxy or ACP pre-tool interception.",
  },
  {
    id: "planMode",
    label: "Plan mode enforcement",
    status: "unsupported",
    reason:
      "Codex plan mode is not yet enforced by a verified runtime mode or pre-tool denial path.",
    hint: "Do not rely on Codex plan mode for write or shell prevention yet.",
  },
  {
    id: "scopeExpansion",
    label: "Scope expansion approval",
    status: "unsupported",
    reason:
      "Codex cannot pause before crossing workspace scope without a pre-execution tool decision hook.",
    hint: "Keep Codex scope expansion controls disabled until hard tool guard parity exists.",
  },
  {
    id: "askUserQuestion",
    label: "Ask user question",
    status: "unsupported",
    reason:
      "The desktop Codex path does not yet normalize pending question, answer, timeout, and denial events.",
    hint: "Keep interactive question flows runtime-specific until Codex emits a tested event contract.",
  },
  {
    id: "rollback",
    label: "Rollback and fork",
    status: "unsupported",
    reason:
      "Codex session IDs are persisted, but rollback and fork are not wired through durable shared session references.",
    hint: "Do not expose Codex rollback or fork as runtime-neutral behavior yet.",
  },
  {
    id: "mcpAuth",
    label: "MCP auth",
    status: "degraded",
    reason:
      "Codex runs preflight MCP needs-auth state, but full shared MCP auth refresh parity is not complete.",
    hint: "Needs-auth MCP servers are blocked before provider work; broader auth parity still needs shared runtime tests.",
  },
  {
    id: "mcpConfiguration",
    label: "MCP configuration",
    status: "degraded",
    reason:
      "Codex can resolve app/global and project MCP state, but parity for all shared configuration operations is incomplete.",
    hint: "Keep Codex MCP configuration surfaces tied to explicit capability state.",
  },
  {
    id: "providerProfiles",
    label: "Provider profiles",
    status: "degraded",
    reason:
      "Codex provider profiles use main-process gateway tokens, but renderer-safe metadata parity is incomplete.",
    hint: "Expose only non-secret profile summaries to Codex callers.",
  },
  {
    id: "attachments",
    label: "Attachments",
    status: "degraded",
    reason:
      "Codex supports current image and long-text attachment paths, but normalized file attachment parity is incomplete.",
    hint: "Validate attachment types before starting provider work.",
  },
  {
    id: "usageMetadata",
    label: "Usage metadata",
    status: "degraded",
    reason:
      "Codex polls usage for active sessions, but shared quota/context/token metadata parity is incomplete.",
    hint: "Treat missing Codex usage fields as unavailable, not zero.",
  },
  {
    id: "runtimePlugins",
    label: "Runtime plugins",
    status: "unsupported",
    reason:
      "Codex plugin entries are not yet executable through a runtime-native or shared Locus plugin layer.",
    hint: "Do not show plugin execute controls for Codex until an execution path exists.",
  },
  {
    id: "runtimeCommands",
    label: "Runtime commands",
    status: "unsupported",
    reason:
      "Codex runtime command invocation is not yet implemented for command-guide or chat command surfaces.",
    hint: "Disable Codex command execution controls until command parity is implemented.",
  },
  {
    id: "runtimeWorkflows",
    label: "Runtime workflows",
    status: "unsupported",
    reason:
      "Claude Dynamic Workflows have no Codex-equivalent adapter or shared workflow layer yet.",
    hint: "Keep workflow parity out of Codex until implemented or explicitly rescoped.",
  },
  {
    id: "appAgents",
    label: "App Agents and skills",
    status: "degraded",
    reason:
      "Codex App Agent mentions are prompt-prepared, but runtime-neutral execution and limitation reporting are incomplete.",
    hint: "Do not count prompt injection alone as App Agent parity.",
  },
]

export function getCodexRuntimeCapabilities(): CodexRuntimeCapability[] {
  return CODEX_RUNTIME_CAPABILITIES.map((capability) => ({ ...capability }))
}

export function getCodexRuntimeCapability(
  id: CodexRuntimeCapabilityId,
): CodexRuntimeCapability {
  const capability = CODEX_RUNTIME_CAPABILITIES.find(
    (candidate) => candidate.id === id,
  )
  if (!capability) {
    throw new Error(`Unknown Codex runtime capability: ${id}`)
  }
  return { ...capability }
}

export function buildCodexUnsupportedCapabilityErrorChunk(input: {
  capability: CodexRuntimeCapability
  message?: string
  hint?: string | null
}): CodexCapabilityErrorChunk {
  const message =
    input.message ||
    `Codex ${input.capability.label} is ${input.capability.status}. ${input.capability.reason}`
  const blocker: CodexRuntimeCapabilityBlocker = {
    capability: input.capability.id,
    status: input.capability.status,
    message,
    hint: input.hint ?? input.capability.hint,
    reason: input.capability.reason,
  }

  return {
    type: "capability-error",
    runtime: "codex",
    capability: input.capability.id,
    errorText: blocker.hint ? `${blocker.message} ${blocker.hint}` : blocker.message,
    blocker,
  }
}

export function getCodexRunBlockingCapability(input: {
  mode?: "plan" | "agent"
  hasScopeContract?: boolean
}): CodexRuntimeCapability | null {
  if (input.hasScopeContract) {
    return getCodexRuntimeCapability("hardToolGuard")
  }
  if (input.mode === "plan") {
    return getCodexRuntimeCapability("planMode")
  }
  return null
}
