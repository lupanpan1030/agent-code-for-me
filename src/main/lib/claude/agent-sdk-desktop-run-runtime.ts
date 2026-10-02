import {
  createDesktopRunMcpReadiness,
  type DesktopRunMcpReadiness,
  type DesktopRunRequest,
  withDesktopRunMcpReadiness,
} from "../agent-runtime/desktop-run-request"
import type { RuntimeRouteCatalogState } from "../agent-runtime/runtime-route-catalog"
import { resolveClaudeAgentSdkDesktopRouteDelegate } from "./agent-sdk-desktop-route"
import type { ClaudeAgentSdkDesktopRunState } from "./agent-sdk-desktop-run-state"
import {
  type RunClaudeAgentSdkDesktopRuntimeLifecycleInput,
  type RunClaudeAgentSdkDesktopRuntimeLifecycleResult,
  runClaudeAgentSdkDesktopRuntimeLifecycle,
} from "./agent-sdk-runtime-lifecycle"

export type RunClaudeAgentSdkDesktopRuntimeWithRunStateInput = Omit<
  RunClaudeAgentSdkDesktopRuntimeLifecycleInput,
  "desktopJobSawError" | "isObservableActive"
> & {
  desktopRunState: Pick<
    ClaudeAgentSdkDesktopRunState,
    "isObservableActive" | "sawError" | "setReachedNaturalFinish"
  >
  runLifecycle?: typeof runClaudeAgentSdkDesktopRuntimeLifecycle
}

export type ClaudeAgentSdkDesktopRunMcpReadinessStatus =
  DesktopRunMcpReadiness["status"]

export type RunClaudeAgentSdkDesktopRuntimeWithMcpReadinessInput = Omit<
  RunClaudeAgentSdkDesktopRuntimeWithRunStateInput,
  "request" | "runDesktopAdapter"
> & {
  desktopRunRequest: DesktopRunRequest
  mcpReadinessStatus: ClaudeAgentSdkDesktopRunMcpReadinessStatus
  /**
   * Test-only runtime route catalog state (design D1 host seam). Production
   * callers never set it; the default is the validated production catalog.
   */
  runtimeRouteCatalog?: RuntimeRouteCatalogState
}

export async function runClaudeAgentSdkDesktopRuntimeWithRunState({
  desktopRunState,
  runLifecycle = runClaudeAgentSdkDesktopRuntimeLifecycle,
  ...input
}: RunClaudeAgentSdkDesktopRuntimeWithRunStateInput): Promise<RunClaudeAgentSdkDesktopRuntimeLifecycleResult> {
  const runtimeResult = await runLifecycle({
    ...input,
    isObservableActive: desktopRunState.isObservableActive,
    desktopJobSawError: desktopRunState.sawError(),
  })
  desktopRunState.setReachedNaturalFinish(runtimeResult.reachedNaturalFinish)
  return runtimeResult
}

/**
 * The named Claude desktop host (design D1, P12/P34): after the router's
 * admission it queries the runtime route catalog for its fixed runtime and
 * asserts the typed Agent SDK route before any secret-bearing input reaches
 * the leaf, then injects the catalog delegate along the lifecycle chain.
 */
export async function runClaudeAgentSdkDesktopRuntimeWithMcpReadiness({
  desktopRunRequest,
  mcpReadinessStatus,
  runtimeQuery,
  runtimeRouteCatalog,
  ...input
}: RunClaudeAgentSdkDesktopRuntimeWithMcpReadinessInput): Promise<RunClaudeAgentSdkDesktopRuntimeLifecycleResult> {
  const runDesktopAdapter = resolveClaudeAgentSdkDesktopRouteDelegate(
    desktopRunRequest,
    runtimeRouteCatalog,
  )
  const request = withDesktopRunMcpReadiness(
    desktopRunRequest,
    createDesktopRunMcpReadiness({
      status: mcpReadinessStatus,
      serverNames: Object.keys(runtimeQuery.rawMcpServers ?? {}),
    }),
  )

  return runClaudeAgentSdkDesktopRuntimeWithRunState({
    ...input,
    request,
    runtimeQuery,
    runDesktopAdapter,
  })
}
