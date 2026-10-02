import type { AgentRuntimeContractId } from "../../../shared/agent-runtime-capabilities"
import {
  type LocalJobApiRuntimeReadiness,
  normalizeLocalJobApiRuntimeReadiness,
} from "../../../shared/local-job-api"
import { normalizeHeaderSafeCredential } from "../../../shared/secret-redaction-policy"
import {
  getClaudeCodeCredentialMetadata,
  hasAnyClaudeCodeAccount,
} from "../claude-credentials"
import { getExistingClaudeCredentials, isTokenExpired } from "../claude-token"
import {
  getBundledCodexCliMissingHint,
  getBundledCodexCliPath,
} from "../codex/cli-path"
import { getCodexNativeRuntimeStatus } from "../codex/native-runtime-status"
import {
  getRuntimeExecutableStatus,
  type RuntimeExecutableStatus,
} from "../runtime-executable"
import type { HeadlessDefaultProviderBindingInspection } from "./provider-binding"

type RuntimeStatusComponent = {
  id: string
  status: string
  error: string | null
  hint: string | null
}

type CodexRuntimeStatusLike = {
  components: RuntimeStatusComponent[]
}

type ClaudeCliCredentialForReadiness = {
  accessToken?: string | null
  expiresAt?: number | null
  refreshToken?: string | null
}

export type RuntimeReadinessResolverDependencies = {
  getClaudeCodeCredentialMetadata?: () => Pick<
    ReturnType<typeof getClaudeCodeCredentialMetadata>,
    | "isConnected"
    | "credentialUsable"
    | "isExpired"
    | "isExpiringSoon"
    | "refreshable"
  >
  getCodexExecutableStatus?: () => RuntimeExecutableStatus
  getCodexRuntimeStatus?: () => Promise<CodexRuntimeStatusLike>
  getExistingClaudeCredentials?: () => ClaudeCliCredentialForReadiness | null
  inspectDefaultProviderBinding?: (
    runtimeId: AgentRuntimeContractId,
  ) => HeadlessDefaultProviderBindingInspection
  hasAnyClaudeCodeAccount?: () => boolean
  now?: () => number
}

/** Context of one runtime's readiness probe (the route catalog's probe context). */
export type RuntimeReadinessProbeOptions = {
  dependencies?: RuntimeReadinessResolverDependencies
  onDiagnostic?: (message: string) => void
  probe?: boolean
}

const RUNTIME_READINESS_CACHE_TTL_MS = 30_000
const readinessCache = new Map<
  AgentRuntimeContractId,
  {
    expiresAt: number
    readiness: LocalJobApiRuntimeReadiness
  }
>()

function unknownReadiness(
  detail = "Runtime readiness could not be determined.",
): LocalJobApiRuntimeReadiness {
  return {
    state: "unknown",
    detail,
    hint: "Retry discovery or run the runtime to see the latest setup diagnostics.",
  }
}

function readiness(
  value: LocalJobApiRuntimeReadiness,
): LocalJobApiRuntimeReadiness {
  return normalizeLocalJobApiRuntimeReadiness(value)
}

function emitUnknownDiagnostic(
  runtimeId: AgentRuntimeContractId,
  onDiagnostic: ((message: string) => void) | undefined,
): void {
  onDiagnostic?.(
    `[local-job-api] Runtime readiness for ${runtimeId} is unknown; resolver failed.`,
  )
}

function defaultCodexExecutableStatus(): RuntimeExecutableStatus {
  return getRuntimeExecutableStatus(
    getBundledCodexCliPath(),
    getBundledCodexCliMissingHint(),
  )
}

function isClaudeAppCredentialUsable(
  metadata: Pick<
    ReturnType<typeof getClaudeCodeCredentialMetadata>,
    | "isConnected"
    | "credentialUsable"
    | "isExpired"
    | "isExpiringSoon"
    | "refreshable"
  >,
): boolean {
  return (
    metadata.isConnected &&
    metadata.credentialUsable &&
    (!metadata.isExpired || metadata.refreshable) &&
    (!metadata.isExpiringSoon || metadata.refreshable)
  )
}

function isClaudeCliCredentialUsable(
  credential: ClaudeCliCredentialForReadiness | null | undefined,
): boolean {
  if (!credential?.accessToken) {
    return false
  }

  const accessToken = normalizeHeaderSafeCredential(credential.accessToken)
  const refreshToken =
    credential.refreshToken == null
      ? null
      : normalizeHeaderSafeCredential(credential.refreshToken)
  if (!accessToken || (credential.refreshToken != null && !refreshToken)) {
    return false
  }
  return (
    !isTokenExpired(credential.expiresAt ?? undefined) || Boolean(refreshToken)
  )
}

function resolveClaudeReadiness(
  dependencies: RuntimeReadinessResolverDependencies,
): LocalJobApiRuntimeReadiness {
  const hasAnyAccount = dependencies.hasAnyClaudeCodeAccount
    ? dependencies.hasAnyClaudeCodeAccount()
    : hasAnyClaudeCodeAccount()
  if (hasAnyAccount) {
    const metadata = dependencies.getClaudeCodeCredentialMetadata
      ? dependencies.getClaudeCodeCredentialMetadata()
      : getClaudeCodeCredentialMetadata()
    if (isClaudeAppCredentialUsable(metadata)) {
      return readiness({
        state: "ready",
        detail: "Locus desktop Claude credential is available.",
      })
    }
  }

  const externalCredential = dependencies.getExistingClaudeCredentials
    ? dependencies.getExistingClaudeCredentials()
    : getExistingClaudeCredentials()
  if (isClaudeCliCredentialUsable(externalCredential)) {
    return readiness({
      state: "ready",
      detail: hasAnyAccount
        ? "Claude CLI login is available as fallback."
        : "Claude CLI login is available.",
    })
  }

  return readiness({
    state: "needs-auth",
    detail: "No Claude credential source is available.",
    hint: "Sign in through Locus desktop or log in with the claude CLI.",
  })
}

function resolveDefaultProviderReadiness(
  runtimeId: AgentRuntimeContractId,
  dependencies: RuntimeReadinessResolverDependencies,
): LocalJobApiRuntimeReadiness | null {
  const inspection = dependencies.inspectDefaultProviderBinding?.(runtimeId)
  if (!inspection || inspection.state === "not-configured") return null
  if (inspection.state === "ready") {
    return readiness({
      state: "ready",
      detail: "Configured default provider profile is available.",
    })
  }
  return readiness({
    state: "unavailable",
    detail: "Configured default provider profile is unavailable.",
    hint: "Fix or clear the runtime's default provider profile, then retry.",
  })
}

function componentDetail(
  component: RuntimeStatusComponent | undefined,
  fallback: string,
): string {
  return component?.error?.trim() || fallback
}

function componentHint(
  component: RuntimeStatusComponent | undefined,
  fallback: string,
): string {
  return component?.hint?.trim() || fallback
}

function readinessFromCodexStatus(
  status: CodexRuntimeStatusLike,
): LocalJobApiRuntimeReadiness {
  const cli = status.components.find(
    (component) => component.id === "login-cli",
  )
  if (cli && cli.status !== "ready") {
    return readiness({
      state: "unavailable",
      detail: componentDetail(cli, "Bundled Codex CLI is unavailable."),
      hint: componentHint(cli, "Restore the bundled Codex CLI, then retry."),
    })
  }

  const login = status.components.find((component) => component.id === "login")
  if (!login) {
    return readiness(unknownReadiness("Codex login status was not reported."))
  }

  if (login.status === "ready") {
    return readiness({
      state: "ready",
      detail: "Codex login is connected.",
    })
  }

  if (login.status === "needs-auth") {
    return readiness({
      state: "needs-auth",
      detail: componentDetail(login, "Codex login is required."),
      hint: componentHint(
        login,
        "Connect Codex with ChatGPT login, use a Codex API key, or choose a provider profile.",
      ),
    })
  }

  if (login.status === "blocked") {
    return readiness({
      state: "unavailable",
      detail: componentDetail(login, "Codex login status is blocked."),
      hint: componentHint(
        login,
        "Restore Codex runtime prerequisites, then retry.",
      ),
    })
  }

  return readiness(
    unknownReadiness(
      login.status === "failed"
        ? "Codex login status probe failed."
        : "Codex login readiness is unknown.",
    ),
  )
}

async function resolveCodexReadiness(
  input: RuntimeReadinessProbeOptions,
): Promise<LocalJobApiRuntimeReadiness> {
  const dependencies = input.dependencies ?? {}
  const executable =
    dependencies.getCodexExecutableStatus?.() ?? defaultCodexExecutableStatus()
  if (!executable.ok) {
    return readiness({
      state: "unavailable",
      detail: executable.error ?? "Bundled Codex CLI is unavailable.",
      hint: executable.hint,
    })
  }

  if (input.probe === false) {
    return readiness({
      state: "unknown",
      detail: "Codex login status probe was skipped.",
      hint: "Run without --no-probe to check Codex login readiness.",
    })
  }

  const now = dependencies.now?.() ?? Date.now()
  const cached = readinessCache.get("codex")
  if (cached && cached.expiresAt > now) {
    return cached.readiness
  }

  // Native status only: the desktop route metadata composition of
  // codex.getRuntimeStatus would reach the route catalog again.
  const status = await (dependencies.getCodexRuntimeStatus?.() ??
    getCodexNativeRuntimeStatus())
  const resolved = readinessFromCodexStatus(status)
  readinessCache.set("codex", {
    expiresAt: now + RUNTIME_READINESS_CACHE_TTL_MS,
    readiness: resolved,
  })
  return resolved
}

/**
 * One runtime's advisory readiness: the configured default provider profile
 * first (a broken default never falls back to the native probe), then the
 * runtime's native probe; any failure is `unknown`, never ready. Shared
 * composition of the per-runtime leaf probes below, not a runtime dispatch.
 */
async function resolveRuntimeReadinessWith(
  runtimeId: AgentRuntimeContractId,
  input: RuntimeReadinessProbeOptions,
  nativeProbe: () =>
    | LocalJobApiRuntimeReadiness
    | Promise<LocalJobApiRuntimeReadiness>,
): Promise<LocalJobApiRuntimeReadiness> {
  try {
    const defaultProviderReadiness = resolveDefaultProviderReadiness(
      runtimeId,
      input.dependencies ?? {},
    )
    if (defaultProviderReadiness) return defaultProviderReadiness
    return await nativeProbe()
  } catch {
    emitUnknownDiagnostic(runtimeId, input.onDiagnostic)
    return readiness(unknownReadiness())
  }
}

/**
 * Claude Code readiness leaf probe; the runtime route catalog references it
 * for Claude routes. This module keeps probe, cache, credential and
 * default-profile ownership and never imports the catalog.
 */
export function resolveClaudeCodeRuntimeReadiness(
  input: RuntimeReadinessProbeOptions = {},
): Promise<LocalJobApiRuntimeReadiness> {
  return resolveRuntimeReadinessWith("claude-code", input, () =>
    resolveClaudeReadiness(input.dependencies ?? {}),
  )
}

/**
 * Codex readiness leaf probe (bundled CLI, login status and the 30 s status
 * cache); the runtime route catalog references it for Codex routes.
 */
export function resolveCodexRuntimeReadiness(
  input: RuntimeReadinessProbeOptions = {},
): Promise<LocalJobApiRuntimeReadiness> {
  return resolveRuntimeReadinessWith("codex", input, () =>
    resolveCodexReadiness(input),
  )
}

/**
 * The readiness observed for a route without a probe (a missing route, a
 * completion route or a refused resolution): unknown, never ready.
 */
export function unknownRuntimeReadiness(): LocalJobApiRuntimeReadiness {
  return readiness(unknownReadiness())
}

export function clearRuntimeReadinessCacheForTest(): void {
  readinessCache.clear()
}
