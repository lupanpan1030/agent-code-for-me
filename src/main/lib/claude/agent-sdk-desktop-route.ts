import { createDesktopRuntimeRouteQuery } from "../agent-runtime/desktop-route-query"
import type { DesktopRunRequest } from "../agent-runtime/desktop-run-request"
import {
  type ClaudeDesktopRuntimeRouteDelegate,
  RUNTIME_ROUTE_CATALOG_UNAVAILABLE_MESSAGE,
  type RuntimeRouteCatalogState,
  resolveRuntimeRoute,
} from "../agent-runtime/runtime-route-catalog"

/**
 * The Claude desktop host's fixed route (design D1, P12/P34): queries the
 * runtime route catalog for `claude-code` on the desktop entry and asserts
 * the typed Agent SDK route before any secret-bearing input reaches the
 * leaf. Any refusal or catalog fault surfaces only the sanitized message.
 * The catalog argument is the host's test-only option, forwarded unchanged.
 */
export function resolveClaudeAgentSdkDesktopRouteDelegate(
  request: Pick<
    DesktopRunRequest,
    "context" | "permissionPolicy" | "requestedCapabilities"
  >,
  runtimeRouteCatalog?: RuntimeRouteCatalogState,
): ClaudeDesktopRuntimeRouteDelegate {
  const route = resolveRuntimeRoute(
    createDesktopRuntimeRouteQuery("claude-code", request),
    runtimeRouteCatalog,
  )
  if (
    !route.ok ||
    route.runtimeId !== "claude-code" ||
    route.executionSurface !== "desktop-sdk" ||
    typeof route.delegate !== "function"
  ) {
    throw new Error(RUNTIME_ROUTE_CATALOG_UNAVAILABLE_MESSAGE)
  }
  return route.delegate as ClaudeDesktopRuntimeRouteDelegate
}
