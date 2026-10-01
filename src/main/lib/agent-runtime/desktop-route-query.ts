import type { DesktopRunRequest } from "./desktop-run-request"
import type {
  DesktopPermissionPolicy,
  DesktopPermissionRuntime,
} from "./permission-policy"
import type { AgentRuntimePermissionPolicySummary } from "./run-contract"
import type { RouteQuery } from "./runtime-route-catalog"

/**
 * The route-query summary of a desktop permission policy: desktop chat
 * always carries the visible user's interaction channel. The policy owner's
 * enforcement and diagnostics are copied, never re-derived here.
 */
export function summarizeDesktopPermissionPolicy(
  policy: DesktopPermissionPolicy,
): AgentRuntimePermissionPolicySummary {
  return {
    kind: "desktop",
    interaction: "visible-user",
    enforcement: String(policy.enforcement),
    diagnostics: [...(policy.diagnostics ?? [])],
  }
}

/**
 * The fixed-runtime interactive route query a named desktop host issues for
 * its admitted Run (design D1): the host's own runtime, the desktop entry,
 * the Run's mode and the capabilities the desktop request owner derived.
 * It carries no prompt, secret or provider input.
 */
export function createDesktopRuntimeRouteQuery(
  runtimeId: DesktopPermissionRuntime,
  request: Pick<
    DesktopRunRequest,
    "context" | "permissionPolicy" | "requestedCapabilities"
  >,
): RouteQuery {
  return {
    runtimeId,
    entry: "desktop",
    kind: "agent",
    mode: request.context.mode,
    executionProfile: "interactive",
    permissionPolicy: summarizeDesktopPermissionPolicy(
      request.permissionPolicy,
    ),
    requiredCapabilities: [...new Set(request.requestedCapabilities ?? [])],
    requiredExtensions: [],
  }
}
