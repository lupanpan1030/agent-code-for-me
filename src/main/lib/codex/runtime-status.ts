import { getAgentRuntimeCapabilityManifest } from "../../../shared/agent-runtime-capabilities"
import {
  buildCodexRuntimeAvailabilityFromComponents,
  type CodexRuntimeComponentStatus,
  createCodexRuntimeComponent,
  type RuntimeExecutableLike,
} from "../../../shared/codex-runtime-status"
import { CODEX_APP_SERVER_DESKTOP_ADAPTER_METADATA } from "../agent-runtime/desktop-adapter-metadata"
import type { DesktopRuntimeAdapterMetadata } from "../agent-runtime/desktop-runner"
import { listRuntimeRoutes } from "../agent-runtime/runtime-route-catalog"
import { type ElectronAppLike, getElectronApp } from "../electron-app"
import { isLocalOnlyMode } from "../local-only"
import { getRuntimeExecutableStatus } from "../runtime-executable"
import type { CodexDesktopAdapterSource } from "./adapter-types"
import {
  BUNDLED_CODEX_CLI_VERSION,
  getBundledCodexCliMissingHint,
  getBundledCodexCliPath,
} from "./cli-path"
import { extractCodexError } from "./errors"
import { getCodexIntegrationStatus } from "./integration-status"
import { redactCodexLoginOutput } from "./login-output"

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

function executableStatus(
  executable: RuntimeExecutableLike,
): CodexRuntimeComponentStatus {
  if (executable.ok) return "ready"
  if (!executable.exists) return "missing"
  if (!executable.isExecutable) return "unavailable"
  return "failed"
}

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

export async function getCodexRuntimeStatus(
  input: {
    appContext?: Pick<ElectronAppLike, "isPackaged" | "getAppPath">
    env?: EnvLike
  } = {},
) {
  const env = input.env ?? process.env
  const appContext = input.appContext ?? getElectronApp()
  const cliHint = getBundledCodexCliMissingHint(appContext)

  const loginCli = getRuntimeExecutableStatus(
    getBundledCodexCliPath(appContext),
    cliHint,
  )
  const adapterStatus = buildCodexAdapterRuntimeStatusMetadata({ env })
  const adapterMetadata = adapterStatus.current
  const runtimeAvailability = buildCodexRuntimeAvailabilityFromComponents([
    createCodexRuntimeComponent({
      id: "login-cli",
      label: "Codex CLI",
      status: executableStatus(loginCli),
      ok: loginCli.ok,
      error: loginCli.error,
      hint: loginCli.hint,
      path: loginCli.path,
    }),
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

  if (loginCli.ok) {
    try {
      const integration = await getCodexIntegrationStatus()
      extraComponents.unshift(
        createCodexRuntimeComponent({
          id: "login",
          label: "Codex login",
          status: integration.isConnected ? "ready" : "needs-auth",
          ok: integration.isConnected,
          blocking: false,
          error: integration.isConnected
            ? null
            : "Codex login or API key is required for ChatGPT-backed Codex runs.",
          hint: integration.isConnected
            ? "Codex login is connected."
            : "Connect Codex with ChatGPT login, use a Codex API key, or choose a provider profile.",
        }),
      )
    } catch (error) {
      const normalized = extractCodexError(error, {
        redactLoginOutput: redactCodexLoginOutput,
      })
      extraComponents.unshift(
        createCodexRuntimeComponent({
          id: "login",
          label: "Codex login",
          status: "failed",
          ok: false,
          blocking: false,
          error: normalized.message,
          hint: "Codex login status could not be checked.",
        }),
      )
    }
  } else {
    extraComponents.unshift(
      createCodexRuntimeComponent({
        id: "login",
        label: "Codex login",
        status: "blocked",
        ok: false,
        blocking: false,
        error: "Codex CLI is unavailable, so login status cannot be checked.",
        hint: loginCli.hint,
      }),
    )
  }
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
