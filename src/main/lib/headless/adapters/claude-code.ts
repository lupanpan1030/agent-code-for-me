import os from "node:os"
import path from "node:path"
import {
  buildClaudeEnv,
  createClaudeAgentSdkRuntimeEnv,
  getBundledClaudeBinaryPath,
} from "../../claude/env"
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
  return [
    "-p",
    "--output-format",
    "text",
    "--no-session-persistence",
    "--permission-mode",
    request.context.mode === "plan" ? "plan" : "acceptEdits",
    "--",
    request.prompt,
  ]
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
  jobId: string
  dependencies?: ClaudeHeadlessRuntimeEnvDependencies
}): Promise<Record<string, string>> {
  const dependencies = input.dependencies ?? {}
  const buildEnv = dependencies.buildEnv ?? buildClaudeEnv
  const hasAnyAccount = dependencies.hasAnyAccount ?? hasAnyClaudeCodeAccount
  const getValidCredential =
    dependencies.getValidCredential ?? getValidClaudeCodeCredential
  const warn = dependencies.warn ?? console.warn

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
    LOCUS_HEADLESS_JOB_ID: input.jobId,
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
    env: await buildClaudeRuntimeEnv({ jobId: request.identity.jobId }),
    label: "Claude Code",
  })
}

export const __testClaudeCodeHeadless = {
  buildClaudeArgs,
  buildClaudeRuntimeEnv,
  getDefaultClaudeConfigDir,
}
