import type { AgentRuntimeContractId } from "../../../shared/agent-runtime-capabilities"
import {
  type LocalJobApiRuntimeReadiness,
  normalizeLocalJobApiRuntimeReadiness,
} from "../../../shared/local-job-api"
import {
  getClaudeCodeCredentialMetadata,
  hasAnyClaudeCodeAccount,
} from "../claude-credentials"
import { getExistingClaudeCredentials } from "../claude-token"
import { getBundledCodexCliPath } from "../codex/cli-path"
import { getCodexRuntimeStatus } from "../codex/runtime-status"
import {
  getRuntimeExecutableStatus,
  type RuntimeExecutableStatus,
} from "../runtime-executable"

type RuntimeStatusComponent = {
  id: string
  status: string
  error: string | null
  hint: string | null
}

type CodexRuntimeStatusLike = {
  components: RuntimeStatusComponent[]
}

export type RuntimeReadinessResolverDependencies = {
  getClaudeCodeCredentialMetadata?: () => Pick<
    ReturnType<typeof getClaudeCodeCredentialMetadata>,
    "isConnected"
  >
  getCodexExecutableStatus?: () => RuntimeExecutableStatus
  getCodexRuntimeStatus?: () => Promise<CodexRuntimeStatusLike>
  getExistingClaudeCredentials?: () => { accessToken?: string | null } | null
  hasAnyClaudeCodeAccount?: () => boolean
  now?: () => number
}

export type ResolveRuntimeReadinessOptions = {
  dependencies?: RuntimeReadinessResolverDependencies
  onDiagnostic?: (message: string) => void
  probe?: boolean
  runtimeId: AgentRuntimeContractId
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
    "Run `bun run codex:download` from the repo, then retry discovery.",
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
    if (metadata.isConnected) {
      return readiness({
        state: "ready",
        detail: "Locus desktop Claude credential is available.",
      })
    }
  }

  const externalCredential = dependencies.getExistingClaudeCredentials
    ? dependencies.getExistingClaudeCredentials()
    : getExistingClaudeCredentials()
  if (externalCredential?.accessToken) {
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
  input: ResolveRuntimeReadinessOptions,
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

  const status = await (dependencies.getCodexRuntimeStatus?.() ??
    getCodexRuntimeStatus())
  const resolved = readinessFromCodexStatus(status)
  readinessCache.set("codex", {
    expiresAt: now + RUNTIME_READINESS_CACHE_TTL_MS,
    readiness: resolved,
  })
  return resolved
}

export async function resolveLocalJobApiRuntimeReadiness(
  input: ResolveRuntimeReadinessOptions,
): Promise<LocalJobApiRuntimeReadiness> {
  try {
    if (input.runtimeId === "claude-code") {
      return resolveClaudeReadiness(input.dependencies ?? {})
    }
    return await resolveCodexReadiness(input)
  } catch {
    emitUnknownDiagnostic(input.runtimeId, input.onDiagnostic)
    return readiness(unknownReadiness())
  }
}

export function clearRuntimeReadinessCacheForTest(): void {
  readinessCache.clear()
}
