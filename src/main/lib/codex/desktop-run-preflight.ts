import {
  buildCodexCapabilityErrorChunk,
  buildCodexRuntimeStatusChunk,
  type CodexRuntimeAvailability,
  createCodexRuntimeBlocker,
} from "../../../shared/codex-runtime-status"
import {
  type DesktopRunPreflightBlocker,
  DesktopRunPreflightError,
} from "../agent-runtime/preflight"
import { assertOfficialCloudAllowed } from "../local-only"
import { getCodexRuntimeStatus } from "./runtime-status"

type CodexDesktopRuntimeStatus = Pick<
  CodexRuntimeAvailability,
  "ok" | "blockers"
>

export type CodexDesktopRunPreflightDependencies = {
  assertOfficialCloudAllowed: typeof assertOfficialCloudAllowed
  getRuntimeStatus: () => Promise<CodexDesktopRuntimeStatus>
}

export type CodexDesktopRunPreflightStage = {
  emitPreflightBlocker: (
    blocker: DesktopRunPreflightBlocker,
    chunks?: Record<string, unknown>[],
  ) => void
  emitLocalOnlyPreflightBlocker: (
    operation: string,
    url?: string | null,
  ) => boolean
  verifyRuntimeStatus: () => Promise<boolean>
}

const defaultDependencies: CodexDesktopRunPreflightDependencies = {
  assertOfficialCloudAllowed,
  getRuntimeStatus: getCodexRuntimeStatus,
}

export function createCodexDesktopRunPreflightStage(input: {
  emit: (chunk: Record<string, unknown>) => unknown
  complete: () => void
  dependencies?: Partial<CodexDesktopRunPreflightDependencies>
}): CodexDesktopRunPreflightStage {
  const dependencies = { ...defaultDependencies, ...input.dependencies }

  const emitPreflightBlocker = (
    blocker: DesktopRunPreflightBlocker,
    chunks: Record<string, unknown>[] = [],
  ) => {
    for (const chunk of chunks) input.emit(chunk)
    const error = new DesktopRunPreflightError(blocker)
    input.emit({
      type: blocker.status === "needs-auth" ? "auth-error" : "error",
      errorText: blocker.hint
        ? `${error.message} ${blocker.hint}`
        : error.message,
    })
    input.emit({ type: "finish" })
    input.complete()
  }

  const emitLocalOnlyPreflightBlocker = (
    operation: string,
    url?: string | null,
  ) => {
    try {
      dependencies.assertOfficialCloudAllowed(operation, url)
      return false
    } catch (localOnlyError) {
      const message =
        localOnlyError instanceof Error
          ? localOnlyError.message
          : String(localOnlyError)
      const blocker = createCodexRuntimeBlocker({
        id: "local-only",
        label: "Local-only policy",
        status: "blocked",
        ok: false,
        message,
        hint: "Choose a user-configured provider endpoint that is not an official upstream hosted URL, or explicitly disable local-only mode for hosted/internal testing.",
      })
      emitPreflightBlocker(
        {
          id: "local-only",
          status: "blocked",
          message: blocker.message,
          hint: blocker.hint,
        },
        [
          buildCodexRuntimeStatusChunk(blocker),
          buildCodexCapabilityErrorChunk(blocker),
        ],
      )
      return true
    }
  }

  const verifyRuntimeStatus = async () => {
    const runtimeStatus = await dependencies.getRuntimeStatus()
    if (runtimeStatus.ok) {
      return true
    }

    const blocker =
      runtimeStatus.blockers[0] ??
      createCodexRuntimeBlocker({
        id: "login-cli",
        label: "Codex runtime",
        status: "failed",
        ok: false,
        message: "Codex runtime is unavailable.",
        hint: "Check Codex runtime status and try again.",
      })
    emitPreflightBlocker(
      {
        id: "unsupported-capability",
        status: "blocked",
        message: blocker.message,
        hint: blocker.hint,
      },
      [buildCodexRuntimeStatusChunk(blocker)],
    )
    return false
  }

  return {
    emitPreflightBlocker,
    emitLocalOnlyPreflightBlocker,
    verifyRuntimeStatus,
  }
}
