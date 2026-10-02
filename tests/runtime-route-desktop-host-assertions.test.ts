/**
 * Implementer unit for refactor-unified-runtime-route-catalog touch-up T1-5b:
 * both named desktop hosts assert the route the catalog resolves for their
 * fixed runtime. A validated test catalog that resolves the fixed runtime to
 * the other runtime's route (with the host's own execution surface) or to
 * the right runtime on a non-desktop execution surface must be refused with
 * exactly the sanitized catalog message and zero delegate calls. Removing
 * either the runtimeId or the executionSurface assertion makes the matching
 * case call the delegate and fail.
 */
import { describe, expect, mock, test } from "bun:test"
import { createDesktopRuntimeRouteQuery } from "../src/main/lib/agent-runtime/desktop-route-query"
import { toAgentRuntimeId } from "../src/shared/agent-runtime-capabilities"
import {
  baseDeclarationFixture,
  buildTestCatalog,
  CATALOG_UNAVAILABLE_MESSAGE,
  claudeHostInput,
  codexHostOptions,
  createReferencePorts,
  desktopRunRequest,
  emptyEmissions,
  type Loose,
  REPO_ROOT,
  recordingLedger,
  requireCatalogModule,
  requireCodexDesktopChatRun,
} from "./runtime-route-catalog-core-kit"

mock.module("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath() {
      return REPO_ROOT
    },
  },
}))

type HostRuntime = "claude-code" | "codex"

type HostCase = {
  name: string
  hostRuntime: HostRuntime
  /** The runtime declared in the table whose desktop route is resolved. */
  resolvedRuntime: HostRuntime
  /** The execution surface that resolved desktop route declares. */
  resolvedSurface: string
}

const DESKTOP_ROUTE_ID: Record<HostRuntime, string> = {
  "claude-code": "claude-code.desktop.agent-sdk",
  codex: "codex.desktop.app-server",
}

const DESKTOP_FACTORY_REF: Record<HostRuntime, string> = {
  "claude-code": "factory:claude-desktop-sdk",
  codex: "factory:codex-desktop-app-server",
}

const CASES: HostCase[] = [
  {
    name: "Codex host, Claude route on the app-server surface (runtimeId assertion)",
    hostRuntime: "codex",
    resolvedRuntime: "claude-code",
    resolvedSurface: "desktop-app-server",
  },
  {
    name: "Codex host, Codex route on a non-desktop surface (executionSurface assertion)",
    hostRuntime: "codex",
    resolvedRuntime: "codex",
    resolvedSurface: "headless-app-server",
  },
  {
    name: "Claude host, Codex route on the Agent SDK surface (runtimeId assertion)",
    hostRuntime: "claude-code",
    resolvedRuntime: "codex",
    resolvedSurface: "desktop-sdk",
  },
  {
    name: "Claude host, Claude route on a non-desktop surface (executionSurface assertion)",
    hostRuntime: "claude-code",
    resolvedRuntime: "claude-code",
    resolvedSurface: "headless-exec",
  },
]

/**
 * A validated catalog holding only `resolvedRuntime`, whose desktop route
 * declares `resolvedSurface`; the normalize port maps the host's fixed
 * runtime onto it (an otherwise legal reference-port table).
 */
async function wrongRouteCatalog(entry: HostCase) {
  const catalog = await requireCatalogModule()
  const { declarations, ports } = baseDeclarationFixture()
  const runtimes = declarations.filter(
    (runtime) => runtime.runtimeId === entry.resolvedRuntime,
  )
  expect(runtimes).toHaveLength(1)
  const routes = runtimes[0].routes as Loose[]
  const desktop = routes.find(
    (route) => route.routeId === DESKTOP_ROUTE_ID[entry.resolvedRuntime],
  )
  if (!desktop) throw new Error("fixture desktop route missing")
  desktop.executionSurface = entry.resolvedSurface
  const recording = createReferencePorts(ports)
  recording.references.normalizeRuntimeId = (raw: unknown) =>
    raw === entry.hostRuntime
      ? entry.resolvedRuntime
      : toAgentRuntimeId(typeof raw === "string" ? raw : null)
  const state = buildTestCatalog(catalog, runtimes, recording)
  return { catalog, state, ports: recording }
}

function hostRequest(runtimeId: HostRuntime) {
  return desktopRunRequest({
    runtimeId,
    mode: "agent",
    cwd: REPO_ROOT,
    signal: new AbortController().signal,
    ledger: recordingLedger().ledger,
    session: { resumeSessionId: null, parentSessionId: null },
  })
}

async function settle(run: () => Promise<unknown>) {
  try {
    return { fulfilled: true as const, value: await run() }
  } catch (error) {
    return {
      fulfilled: false as const,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

describe("named desktop hosts refuse a catalog route that is not their own", () => {
  for (const entry of CASES) {
    test(entry.name, async () => {
      const { catalog, state, ports } = await wrongRouteCatalog(entry)
      const request = hostRequest(entry.hostRuntime)

      // Precondition: the catalog itself resolves the wrong route, so only
      // the host's own assertion can refuse it.
      const resolution = catalog.resolveRuntimeRoute(
        createDesktopRuntimeRouteQuery(entry.hostRuntime, request as never),
        state,
      ) as Loose
      expect({
        ok: resolution.ok,
        runtimeId: resolution.runtimeId,
        executionSurface: resolution.executionSurface,
        delegate: typeof resolution.delegate,
      }).toEqual({
        ok: true,
        runtimeId: entry.resolvedRuntime,
        executionSurface: entry.resolvedSurface,
        delegate: "function",
      })

      const nativeQueryCalls: unknown[] = []
      let settled: Awaited<ReturnType<typeof settle>>
      if (entry.hostRuntime === "codex") {
        const runCodexDesktopChatRun = await requireCodexDesktopChatRun()
        settled = await settle(() =>
          runCodexDesktopChatRun(
            codexHostOptions({
              request,
              emissions: emptyEmissions(),
              runtimeRouteCatalog: state,
              providerGatewayToken: null,
              appManagedApiKey: "fixture-app-managed-key",
            }),
          ),
        )
      } else {
        const { runClaudeAgentSdkDesktopRuntimeWithMcpReadiness } =
          await import("../src/main/lib/claude/agent-sdk-desktop-run-runtime")
        const input = await claudeHostInput({
          request,
          nativeQueryCalls,
          emissions: emptyEmissions(),
          db: null,
          runtimeRouteCatalog: state,
          oauthToken: "fixture-oauth-token",
        })
        settled = await settle(() =>
          runClaudeAgentSdkDesktopRuntimeWithMcpReadiness(
            input as unknown as Parameters<
              typeof runClaudeAgentSdkDesktopRuntimeWithMcpReadiness
            >[0],
          ),
        )
      }

      expect(settled).toEqual({
        fulfilled: false,
        message: CATALOG_UNAVAILABLE_MESSAGE,
      })
      expect(CATALOG_UNAVAILABLE_MESSAGE).toBe(
        "Runtime route catalog is unavailable.",
      )
      expect(ports.log.invocations).toEqual([])
      expect(nativeQueryCalls).toEqual([])
      // The resolved route's delegate was looked up but never invoked.
      expect(ports.log.factoryLookups).toContain(
        DESKTOP_FACTORY_REF[entry.resolvedRuntime],
      )
    })
  }
})
