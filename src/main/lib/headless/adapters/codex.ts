import { getClaudeShellEnvironment } from "../../claude/env"
import { resolveBundledCodexCliPath } from "../../codex/cli-path"
import {
  buildCodexProviderEnv,
  buildCodexProviderProfileArgs,
} from "../../codex/provider-runtime-binding"
import type {
  AgentRuntimeObserver,
  AgentRuntimeRunRequest,
  AgentRuntimeRunResult,
} from "../agent-runtime-contract"
import { runProcessAgentTask } from "../process-runner"

function codexProviderProfileBinding(request: AgentRuntimeRunRequest): {
  name: string
  baseUrl: string
  token: string
} | null {
  if (request.providerBinding?.authMode !== "provider-profile") return null
  if (
    !request.providerBinding.gatewayEndpoint ||
    !request.providerBinding.gatewayToken
  ) {
    throw new Error("Provider profile gateway binding is incomplete.")
  }
  return {
    name: request.providerBinding.providerProfileName ?? "Locus profile",
    baseUrl: request.providerBinding.gatewayEndpoint,
    token: request.providerBinding.gatewayToken,
  }
}

function buildCodexArgs(request: AgentRuntimeRunRequest): string[] {
  const args = [
    "exec",
    "--cd",
    request.context.cwd,
    "--color",
    "never",
    "--sandbox",
    request.context.mode === "plan" ? "read-only" : "workspace-write",
    "--skip-git-repo-check",
  ]
  const providerProfile = codexProviderProfileBinding(request)
  if (providerProfile) {
    args.push(
      ...buildCodexProviderProfileArgs({
        name: providerProfile.name,
        baseUrl: providerProfile.baseUrl,
      }),
    )
  }
  if (request.providerBinding?.model) {
    args.push("-m", request.providerBinding.model)
  }
  args.push("--", request.prompt)
  return args
}

function buildCodexEnv(
  request: AgentRuntimeRunRequest,
  processEnv: NodeJS.ProcessEnv = process.env,
  shellEnv: NodeJS.ProcessEnv = getClaudeShellEnvironment(),
): NodeJS.ProcessEnv {
  const providerProfile = codexProviderProfileBinding(request)
  return {
    ...buildCodexProviderEnv({
      processEnv,
      shellEnv,
      appManagedApiKey: null,
      providerGatewayToken: providerProfile?.token ?? null,
    }),
    LOCUS_HEADLESS_JOB_ID: request.identity.jobId,
  }
}

function filterCodexStderr(text: string): string {
  return text.replace(/^Reading additional input from stdin\.\.\.\n?/gm, "")
}

export async function runCodexHeadlessTask(
  request: AgentRuntimeRunRequest,
  observer: AgentRuntimeObserver,
): Promise<AgentRuntimeRunResult> {
  return runProcessAgentTask({
    request,
    observer,
    executable: resolveBundledCodexCliPath(),
    args: buildCodexArgs(request),
    env: buildCodexEnv(request),
    stderrFilter: filterCodexStderr,
    label: "Codex headless/batch",
  })
}

export const __testCodexHeadless = {
  buildCodexArgs,
  buildCodexEnv,
  filterCodexStderr,
}
