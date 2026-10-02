import {
  buildCodexRuntimeAvailabilityFromComponents,
  type CodexRuntimeComponent,
  type CodexRuntimeComponentStatus,
  createCodexRuntimeComponent,
  type RuntimeExecutableLike,
} from "../../../shared/codex-runtime-status"
import { type ElectronAppLike, getElectronApp } from "../electron-app"
import {
  getRuntimeExecutableStatus,
  type RuntimeExecutableStatus,
} from "../runtime-executable"
import {
  getBundledCodexCliMissingHint,
  getBundledCodexCliPath,
} from "./cli-path"
import { extractCodexError } from "./errors"
import { getCodexIntegrationStatus } from "./integration-status"
import { redactCodexLoginOutput } from "./login-output"

/**
 * Low-level native Codex status: the bundled login CLI executable and the
 * Codex login probe. It never reads route metadata (no runtime route catalog
 * import), so the readiness leaf probe the catalog references cannot reach
 * the catalog again; `codex.getRuntimeStatus` composes it with the desktop
 * route metadata in ./runtime-status.
 */

export type CodexAppContext = Pick<ElectronAppLike, "isPackaged" | "getAppPath">

export function codexExecutableComponentStatus(
  executable: RuntimeExecutableLike,
): CodexRuntimeComponentStatus {
  if (executable.ok) return "ready"
  if (!executable.exists) return "missing"
  if (!executable.isExecutable) return "unavailable"
  return "failed"
}

/** The bundled Codex login CLI executable status (sync filesystem probe). */
export function getCodexLoginCliStatus(
  appContext: CodexAppContext,
): RuntimeExecutableStatus {
  const cliHint = getBundledCodexCliMissingHint(appContext)
  return getRuntimeExecutableStatus(getBundledCodexCliPath(appContext), cliHint)
}

export function createCodexLoginCliComponent(
  loginCli: RuntimeExecutableStatus,
): CodexRuntimeComponent {
  return createCodexRuntimeComponent({
    id: "login-cli",
    label: "Codex CLI",
    status: codexExecutableComponentStatus(loginCli),
    ok: loginCli.ok,
    error: loginCli.error,
    hint: loginCli.hint,
    path: loginCli.path,
  })
}

/** The Codex login component; probes login only when the CLI is usable. */
export async function probeCodexLoginComponent(
  loginCli: RuntimeExecutableStatus,
): Promise<CodexRuntimeComponent> {
  if (!loginCli.ok) {
    return createCodexRuntimeComponent({
      id: "login",
      label: "Codex login",
      status: "blocked",
      ok: false,
      blocking: false,
      error: "Codex CLI is unavailable, so login status cannot be checked.",
      hint: loginCli.hint,
    })
  }
  try {
    const integration = await getCodexIntegrationStatus()
    return createCodexRuntimeComponent({
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
    })
  } catch (error) {
    const normalized = extractCodexError(error, {
      redactLoginOutput: redactCodexLoginOutput,
    })
    return createCodexRuntimeComponent({
      id: "login",
      label: "Codex login",
      status: "failed",
      ok: false,
      blocking: false,
      error: normalized.message,
      hint: "Codex login status could not be checked.",
    })
  }
}

/**
 * Native-only Codex status for the readiness leaf probe: the login CLI and
 * login components, without the desktop adapter-selection composition.
 */
export async function getCodexNativeRuntimeStatus(
  input: { appContext?: CodexAppContext } = {},
) {
  const appContext = input.appContext ?? getElectronApp()
  const loginCli = getCodexLoginCliStatus(appContext)
  const login = await probeCodexLoginComponent(loginCli)
  const availability = buildCodexRuntimeAvailabilityFromComponents([
    createCodexLoginCliComponent(loginCli),
    login,
  ])
  return {
    runtime: "codex" as const,
    ok: availability.ok,
    loginCli,
    components: availability.components,
    blockers: availability.blockers,
  }
}
