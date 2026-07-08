import os from "node:os"
import path from "node:path"
import {
  buildClaudeEnv,
  createClaudeAgentSdkRuntimeEnv,
  getBundledClaudeBinaryPath,
} from "../../claude/env"
import { buildClaudeProviderEnv } from "../../claude/provider-runtime-config"
import {
  getValidClaudeCodeCredential,
  hasAnyClaudeCodeAccount,
} from "../../claude-credentials"
import type {
  AgentRuntimeObserver,
  AgentRuntimeRunRequest,
  AgentRuntimeRunResult,
} from "../agent-runtime-contract"
import { runProcessAgentTask } from "../process-runner"

type BuildClaudeEnvFn = typeof buildClaudeEnv
type GetValidClaudeCodeCredentialFn = () => Promise<{
  accessToken: string | null
}>
type HasAnyClaudeCodeAccountFn = typeof hasAnyClaudeCodeAccount

type ClaudeHeadlessRuntimeEnvDependencies = {
  buildEnv?: BuildClaudeEnvFn
  getValidCredential?: GetValidClaudeCodeCredentialFn
  hasAnyAccount?: HasAnyClaudeCodeAccountFn
  getClaudeConfigDir?: () => string
  warn?: (message: string) => void
}

const APP_CREDENTIAL_FALLBACK_WARNING =
  "[headless-claude] App-stored Claude credential unavailable; falling back to Claude CLI login."
const IGNORED_ENV_TOKEN_WARNING =
  "[headless-claude] Ignored inherited CLAUDE_CODE_OAUTH_TOKEN; sign in through Locus desktop or log in with the claude CLI."

function buildClaudeArgs(request: AgentRuntimeRunRequest): string[] {
  const args = [
    "-p",
    "--output-format",
    "text",
    "--no-session-persistence",
    "--permission-mode",
    request.context.mode === "plan" ? "plan" : "acceptEdits",
  ]
  if (request.providerBinding?.model) {
    args.push("--model", request.providerBinding.model)
  }
  args.push("--", request.prompt)
  return args
}

function getDefaultClaudeConfigDir(): string {
  return path.join(os.homedir(), ".claude")
}

function stripInheritedClaudeOAuthToken(env: Record<string, string>): {
  env: Record<string, string>
  strippedOAuthToken: boolean
} {
  const sanitized = { ...env }
  const strippedOAuthToken = Boolean(sanitized.CLAUDE_CODE_OAUTH_TOKEN)
  delete sanitized.CLAUDE_CODE_OAUTH_TOKEN
  return { env: sanitized, strippedOAuthToken }
}

async function buildClaudeRuntimeEnv(input: {
  jobId?: string
  request?: AgentRuntimeRunRequest
  dependencies?: ClaudeHeadlessRuntimeEnvDependencies
}): Promise<Record<string, string>> {
  const dependencies = input.dependencies ?? {}
  const buildEnv = dependencies.buildEnv ?? buildClaudeEnv
  const hasAnyAccount = dependencies.hasAnyAccount ?? hasAnyClaudeCodeAccount
  const getValidCredential =
    dependencies.getValidCredential ?? getValidClaudeCodeCredential
  const warn = dependencies.warn ?? console.warn
  const jobId = input.request?.identity.jobId ?? input.jobId
  if (!jobId) throw new Error("Claude headless job id is required")

  if (input.request?.providerBinding?.authMode === "provider-profile") {
    const binding = input.request.providerBinding
    if (!binding.gatewayEndpoint || !binding.gatewayToken) {
      throw new Error("Provider profile gateway binding is incomplete.")
    }
    const stripped = stripInheritedClaudeOAuthToken(
      buildEnv({
        enableTasks: true,
        customEnv: buildClaudeProviderEnv({
          model: binding.model ?? "provider-profile",
          baseUrl: binding.gatewayEndpoint,
          token: binding.gatewayToken,
          authMode: "auth_token",
        }),
      }),
    )
    const runtimeEnv = createClaudeAgentSdkRuntimeEnv({
      claudeEnv: stripped.env,
      claudeCodeToken: null,
      isolatedConfigDir:
        dependencies.getClaudeConfigDir?.() ??
        stripped.env.CLAUDE_CONFIG_DIR ??
        getDefaultClaudeConfigDir(),
    })

    return {
      ...runtimeEnv.env,
      LOCUS_HEADLESS_JOB_ID: jobId,
    }
  }

  const stripped = stripInheritedClaudeOAuthToken(
    buildEnv({ enableTasks: true }),
  )
  const claudeEnv = stripped.env
  let claudeCodeToken: string | null = null

  try {
    if (hasAnyAccount()) {
      const credential = await getValidCredential()
      claudeCodeToken = credential.accessToken
      if (!claudeCodeToken) {
        warn(APP_CREDENTIAL_FALLBACK_WARNING)
      }
    }
  } catch {
    warn(APP_CREDENTIAL_FALLBACK_WARNING)
  }
  if (stripped.strippedOAuthToken && !claudeCodeToken) {
    warn(IGNORED_ENV_TOKEN_WARNING)
  }

  const runtimeEnv = createClaudeAgentSdkRuntimeEnv({
    claudeEnv,
    claudeCodeToken,
    isolatedConfigDir:
      dependencies.getClaudeConfigDir?.() ??
      claudeEnv.CLAUDE_CONFIG_DIR ??
      getDefaultClaudeConfigDir(),
  })

  return {
    ...runtimeEnv.env,
    LOCUS_HEADLESS_JOB_ID: jobId,
  }
}

export async function runClaudeCodeHeadlessTask(
  request: AgentRuntimeRunRequest,
  observer: AgentRuntimeObserver,
): Promise<AgentRuntimeRunResult> {
  return runProcessAgentTask({
    request,
    observer,
    executable: getBundledClaudeBinaryPath(),
    args: buildClaudeArgs(request),
    env: await buildClaudeRuntimeEnv({ request }),
    label: "Claude Code",
  })
}

export const __testClaudeCodeHeadless = {
  buildClaudeArgs,
  buildClaudeRuntimeEnv,
  getDefaultClaudeConfigDir,
}
