import { createDesktopRuntimeRouteQuery } from "../agent-runtime/desktop-route-query"
import type { DesktopRunResult } from "../agent-runtime/desktop-run-request"
import {
  type CodexDesktopRuntimeRouteDelegate,
  RUNTIME_ROUTE_CATALOG_UNAVAILABLE_MESSAGE,
  type RuntimeRouteCatalogState,
  resolveRuntimeRoute,
} from "../agent-runtime/runtime-route-catalog"
import type { CodexAppServerDesktopAdapterInput } from "./app-server-adapter-runner"

/**
 * The post-admission run body of `codex.chat` (design D1, P11): the request
 * and secret-bearing ports the procedure already built, plus the host's
 * test-only catalog option.
 */
export type CodexDesktopChatRunOptions = CodexAppServerDesktopAdapterInput & {
  /**
   * Test-only runtime route catalog state (design D1 host seam). Production
   * callers never set it; the default is the validated production catalog.
   */
  runtimeRouteCatalog?: RuntimeRouteCatalogState
}

/**
 * The named Codex desktop host. It queries the runtime route catalog for
 * its fixed runtime and asserts the typed app-server route before handing
 * the verified request and secret-bearing ports to the catalog delegate,
 * and returns the delegate's result unchanged for the procedure's existing
 * finalizer. It records nothing in the Run ledger, emits no terminal chunk
 * and never falls back to another adapter: any refusal or catalog fault
 * surfaces only the sanitized message.
 */
export async function runCodexDesktopChatRun({
  runtimeRouteCatalog,
  ...input
}: CodexDesktopChatRunOptions): Promise<DesktopRunResult> {
  const route = resolveRuntimeRoute(
    createDesktopRuntimeRouteQuery("codex", input.request),
    runtimeRouteCatalog,
  )
  if (
    !route.ok ||
    route.runtimeId !== "codex" ||
    route.executionSurface !== "desktop-app-server" ||
    typeof route.delegate !== "function"
  ) {
    throw new Error(RUNTIME_ROUTE_CATALOG_UNAVAILABLE_MESSAGE)
  }
  const delegate = route.delegate as CodexDesktopRuntimeRouteDelegate
  return delegate(input)
}
