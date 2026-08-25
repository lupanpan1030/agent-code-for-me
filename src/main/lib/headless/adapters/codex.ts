import { getClaudeShellEnvironment } from "../../claude/env"
import {
  assertCodexAppServerShellSnapshotsScrubbed,
  scrubCodexAppServerShellSnapshots,
} from "../../codex/app-server-shell-snapshots"
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
import { AGENT_RUNTIME_SECURITY_CLEANUP_ERROR_CODE } from "../agent-runtime-contract"
import { runProcessAgentTask } from "../process-runner"

export type CodexHeadlessTaskRunnerDependencies = {
  buildRuntimeEnv?: typeof buildCodexEnv
  resolveExecutable?: typeof resolveBundledCodexCliPath
  runProcess?: typeof runProcessAgentTask
}

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

export function createCodexHeadlessTaskRunner(
  dependencies: CodexHeadlessTaskRunnerDependencies = {},
) {
  const buildRuntimeEnv = dependencies.buildRuntimeEnv ?? buildCodexEnv
  const resolveExecutable =
    dependencies.resolveExecutable ?? resolveBundledCodexCliPath
  const runProcess = dependencies.runProcess ?? runProcessAgentTask

  return async function runCodexHeadlessTaskWithDependencies(
    request: AgentRuntimeRunRequest,
    observer: AgentRuntimeObserver,
  ): Promise<AgentRuntimeRunResult> {
    const runtimeEnv = buildRuntimeEnv(request)
    assertCodexAppServerShellSnapshotsScrubbed(
      scrubCodexAppServerShellSnapshots({ runtimeEnv }),
      "pre-start",
    )
    let processResult: AgentRuntimeRunResult | null = null
    let processFailure: { error: unknown } | null = null
    try {
      processResult = await runProcess({
        request,
        observer,
        executable: resolveExecutable(),
        args: buildCodexArgs(request),
        env: runtimeEnv,
        stderrFilter: filterCodexStderr,
        label: "Codex headless/batch",
      })
    } catch (error) {
      processFailure = { error }
    }

    try {
      assertCodexAppServerShellSnapshotsScrubbed(
        scrubCodexAppServerShellSnapshots({ runtimeEnv }),
        "post-run",
      )
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      observer.appendEvent("error", {
        errorCode: AGENT_RUNTIME_SECURITY_CLEANUP_ERROR_CODE,
        errorMessage,
        phase: "post-run",
      })
      return {
        status: "failed",
        exitCode: 1,
        errorCode: AGENT_RUNTIME_SECURITY_CLEANUP_ERROR_CODE,
        errorMessage,
        result: {
          ...(processResult?.result === undefined
            ? {}
            : { runtimeResult: processResult.result }),
          ...(processFailure
            ? {
                runtimeError:
                  processFailure.error instanceof Error
                    ? processFailure.error.message
                    : String(processFailure.error),
              }
            : {}),
        },
      }
    }

    if (processFailure) throw processFailure.error
    if (!processResult) {
      throw new Error("Codex headless process returned no result.")
    }
    return processResult
  }
}

export const runCodexHeadlessTask = createCodexHeadlessTaskRunner()

export const __testCodexHeadless = {
  buildCodexArgs,
  buildCodexEnv,
  createCodexHeadlessTaskRunner,
  filterCodexStderr,
}
