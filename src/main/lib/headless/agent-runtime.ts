import type { AgentJobSource } from "../../../shared/agent-jobs"
import { getAgentRunRequiredCapabilityIds } from "../../../shared/agent-runtime-capabilities"
import {
  type HeadlessRuntimeRouteDelegate,
  type RouteQuery,
  RUNTIME_ROUTE_CATALOG_UNAVAILABLE_MESSAGE,
  type RuntimeRouteCatalogState,
  type RuntimeRouteEntry,
  resolveRuntimeRoute,
} from "../agent-runtime/runtime-route-catalog"
import type {
  AgentRuntimeObserver,
  AgentRuntimeRunRequest,
  AgentRuntimeRunResult,
} from "./agent-runtime-contract"

export type RunAgentTaskOptions = {
  /**
   * Test-only catalog state (design D1 host seam). Production callers never
   * set it; the default is the validated production catalog.
   */
  runtimeRouteCatalog?: RuntimeRouteCatalogState
}

/** Request entry of a headless Run: API, protocol, else the headless hosts. */
function routeEntryForSource(source: AgentJobSource): RuntimeRouteEntry {
  if (source === "api") return "api"
  if (source === "protocol") return "protocol"
  return "headless"
}

function agentTaskRouteQuery(request: AgentRuntimeRunRequest): RouteQuery {
  return {
    runtimeId: request.context.runtimeId,
    entry: routeEntryForSource(request.context.source),
    kind: "agent",
    mode: request.context.mode,
    executionProfile: request.context.executionProfile ?? "batch",
    permissionPolicy: request.permissionPolicy,
    requiredCapabilities: [
      ...new Set([
        ...request.requestedCapabilities,
        ...getAgentRunRequiredCapabilityIds({
          mode: request.context.mode,
          hasScopeContract: request.context.hasScopeContract ?? false,
        }),
      ]),
    ],
    requiredExtensions: [],
  }
}

/**
 * The runtime-neutral headless runner. The runtime route catalog selects
 * the leaf (after the host's claim and provider binding); the leaf executes
 * through the existing observer/ledger flow. A refused selection keeps the
 * baseline `runtime_selection_refused` payload and adapter-local result; an
 * internal catalog fault surfaces only the sanitized message.
 */
export async function runAgentTask(
  request: AgentRuntimeRunRequest,
  observer: AgentRuntimeObserver,
  options: RunAgentTaskOptions = {},
): Promise<AgentRuntimeRunResult> {
  const executionProfile = request.context.executionProfile ?? "batch"
  const route = resolveRuntimeRoute(
    agentTaskRouteQuery(request),
    options.runtimeRouteCatalog,
  )
  if (!route.ok) {
    if (
      route.reason !== "policy_refused" &&
      route.reason !== "capability_refused"
    ) {
      throw new Error(RUNTIME_ROUTE_CATALOG_UNAVAILABLE_MESSAGE)
    }
    observer.appendEvent("status", {
      status: "runtime_selection_refused",
      runtime: request.context.runtimeId,
      source: request.context.source,
      adapterSource: route.candidateAdapterSource,
      executionProfile,
      reason: route.diagnostic.reason,
      message: route.diagnostic.message,
      errorCode: route.result.errorCode,
    })
    return { ...route.result }
  }

  if (
    route.delegate === null ||
    (route.executionSurface !== "headless-exec" &&
      route.executionSurface !== "headless-app-server")
  ) {
    throw new Error(RUNTIME_ROUTE_CATALOG_UNAVAILABLE_MESSAGE)
  }
  const delegate = route.delegate as HeadlessRuntimeRouteDelegate
  observer.appendEvent("status", {
    status: "runtime_selected",
    runtime: route.runtimeId,
    label: route.manifestRef.label,
    source: request.context.source,
    adapterSource: route.adapterSource,
    executionProfile,
    fallbackReason: route.diagnostic.fallbackReason,
    ...(route.diagnostic.policyGrantScopeBinding
      ? { policyGrantScopeBinding: route.diagnostic.policyGrantScopeBinding }
      : {}),
  })
  return delegate(request, observer)
}
