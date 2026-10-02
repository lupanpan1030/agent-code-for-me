import type { DesktopRunRequest, DesktopRunResult } from "./desktop-run-request"
import type { DesktopPermissionRuntime } from "./permission-policy"

export type DesktopRuntimeAdapterSource =
  | "claude-agent-sdk"
  | "codex-app-server"

export type DesktopRuntimeAdapterMetadata = {
  runtimeId: DesktopPermissionRuntime
  source: DesktopRuntimeAdapterSource
  label: string
  temporaryFallback: boolean
  fallbackReason?: string | null
  defaultDisableCondition?: string | null
  removalCondition?: string | null
}

export type DesktopRuntimeAdapter = {
  metadata: DesktopRuntimeAdapterMetadata
  run(request: DesktopRunRequest): Promise<DesktopRunResult>
}

export function assertDesktopRuntimeAdapterMatchesRequest(
  request: DesktopRunRequest,
  metadata: DesktopRuntimeAdapterMetadata,
): void {
  if (metadata.runtimeId !== request.context.runtimeId) {
    throw new Error(
      `Desktop runtime adapter metadata mismatch: ${metadata.source} cannot run ${request.context.runtimeId}`,
    )
  }
}

/**
 * Records the adapter-started host fact through the Run's ledger (design:
 * replaces the former sequence=0 direct RunEvent). A request without a
 * durable job records nothing.
 */
export async function recordDesktopRuntimeAdapterStarted(
  request: DesktopRunRequest,
  metadata: DesktopRuntimeAdapterMetadata,
): Promise<void> {
  assertDesktopRuntimeAdapterMatchesRequest(request, metadata)
  await request.ledger?.appendSystemEvent({
    observationKey: `desktop-adapter-started:${request.identity.runId}:${metadata.source}`,
    type: "status",
    payload: {
      status: "desktop_runtime_adapter_started",
      adapterSource: metadata.source,
      adapterLabel: metadata.label,
      attempt: request.identity.attempt ?? 1,
      temporaryFallback: metadata.temporaryFallback,
      fallbackReason: metadata.fallbackReason ?? null,
      defaultDisableCondition: metadata.defaultDisableCondition ?? null,
      removalCondition: metadata.removalCondition ?? null,
    },
  })
}
