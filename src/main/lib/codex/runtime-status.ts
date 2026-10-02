import { getAgentRuntimeCapabilityManifest } from "../../../shared/agent-runtime-capabilities"
import {
  buildCodexRuntimeAvailabilityFromComponents,
  createCodexRuntimeComponent,
} from "../../../shared/codex-runtime-status"
import { CODEX_APP_SERVER_DESKTOP_ADAPTER_METADATA } from "../agent-runtime/desktop-adapter-metadata"
import type { DesktopRuntimeAdapterMetadata } from "../agent-runtime/desktop-runner"
import { listRuntimeRoutes } from "../agent-runtime/runtime-route-catalog"
import { getElectronApp } from "../electron-app"
import { isLocalOnlyMode } from "../local-only"
import type { CodexDesktopAdapterSource } from "./adapter-types"
import { BUNDLED_CODEX_CLI_VERSION } from "./cli-path"
import {
  type CodexAppContext,
  createCodexLoginCliComponent,
  getCodexLoginCliStatus,
  probeCodexLoginComponent,
} from "./native-runtime-status"

/** The private codex.getRuntimeStatus projection of the desktop route. */
export type CodexDesktopAdapterSelection = {
  source: CodexDesktopAdapterSource
  useAppServer: true
  reason: string
}

const CODEX_DESKTOP_ADAPTER_SELECTION_REASON =
  "Codex app-server is the only desktop chat adapter."

export type CodexAdapterRuntimeStatusMetadata = {
  bundledCodexVersion: string
  current: DesktopRuntimeAdapterMetadata
  selection: CodexDesktopAdapterSelection
}

type EnvLike = Record<string, string | undefined>

/**
 * The Codex desktop adapter selection is read-only route metadata from the
 * runtime route catalog (P30): the catalog's single Codex desktop route
 * names the adapter source; this status projection keeps its private
 * `adapters.selection` shape and hint text. No native probe runs here.
 */
function codexDesktopAdapterSelection(): CodexDesktopAdapterSelection {
  const [desktopRoute] = listRuntimeRoutes({
    runtimeId: "codex",
    entry: "desktop",
  })
  if (desktopRoute?.adapterSource !== "codex-app-server") {
    throw new Error("Codex desktop route metadata is unavailable.")
  }
  return {
    source: desktopRoute.adapterSource,
    useAppServer: true,
    reason: CODEX_DESKTOP_ADAPTER_SELECTION_REASON,
  }
}

export function buildCodexAdapterRuntimeStatusMetadata(
  // The environment never selects the desktop adapter (the catalog does).
  _input: { env?: EnvLike } = {},
): CodexAdapterRuntimeStatusMetadata {
  return {
    bundledCodexVersion: BUNDLED_CODEX_CLI_VERSION,
    current: CODEX_APP_SERVER_DESKTOP_ADAPTER_METADATA,
    selection: codexDesktopAdapterSelection(),
  }
}

/**
 * The private codex.getRuntimeStatus IPC projection: the native login CLI
 * and login status (./native-runtime-status) composed with the desktop
 * route metadata. The readiness leaf probe uses the native status only.
 */
export async function getCodexRuntimeStatus(
  input: { appContext?: CodexAppContext; env?: EnvLike } = {},
) {
  const env = input.env ?? process.env
  const appContext = input.appContext ?? getElectronApp()

  const loginCli = getCodexLoginCliStatus(appContext)
  const adapterStatus = buildCodexAdapterRuntimeStatusMetadata({ env })
  const adapterMetadata = adapterStatus.current
  const runtimeAvailability = buildCodexRuntimeAvailabilityFromComponents([
    createCodexLoginCliComponent(loginCli),
  ])
  const extraComponents = [
    createCodexRuntimeComponent({
      id: "adapter-source",
      label: "Codex desktop adapter",
      status: "ready",
      ok: true,
      blocking: false,
      error: null,
      hint: [
        `${adapterMetadata.source}: ${adapterStatus.selection.reason}`,
        `Bundled Codex version: ${adapterStatus.bundledCodexVersion}.`,
      ].join(" "),
    }),
    createCodexRuntimeComponent({
      id: "provider-profile",
      label: "Codex provider profile",
      status: "unknown",
      ok: true,
      blocking: false,
      error: null,
      hint: "Provider profile availability is checked for the selected run.",
    }),
    createCodexRuntimeComponent({
      id: "mcp",
      label: "Codex MCP configuration",
      status: "unknown",
      ok: true,
      blocking: false,
      error: null,
      hint: "MCP configuration and auth are checked for the selected project before each run.",
    }),
    createCodexRuntimeComponent({
      id: "local-only",
      label: "Local-only policy",
      status: isLocalOnlyMode() ? "ready" : "unknown",
      ok: true,
      blocking: false,
      error: null,
      hint: isLocalOnlyMode()
        ? "Local-only policy is active; Codex runs use local runtime components and user-selected providers."
        : "Local-only policy is disabled by environment configuration.",
    }),
  ]

  extraComponents.unshift(await probeCodexLoginComponent(loginCli))
  const availability = buildCodexRuntimeAvailabilityFromComponents([
    ...runtimeAvailability.components,
    ...extraComponents,
  ])

  return {
    runtime: "codex" as const,
    requiresGlobalCli: false,
    ok: availability.ok,
    loginCli,
    adapter: adapterMetadata,
    adapters: adapterStatus,
    components: availability.components,
    blockers: availability.blockers,
    capabilities: getAgentRuntimeCapabilityManifest("codex").capabilities,
  }
}
