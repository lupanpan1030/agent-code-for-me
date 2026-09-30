import type { AgentJobMode } from "../../../shared/agent-jobs"
import {
  createDesktopRunContextFromPreflight,
  type DesktopRunMcpSessionServer,
  type DesktopRunProviderBinding,
  type DesktopRunRequest,
  getDesktopRunRequestedCapabilities,
} from "../agent-runtime/desktop-run-request"
import type { DesktopPermissionPolicy } from "../agent-runtime/permission-policy"
import type { DesktopRunPreflightResult } from "../agent-runtime/preflight"
import type { CanonicalDesktopRunLedger } from "../agent-runtime/run-event-ledger-host"

export type CodexDesktopRunImageAttachment = {
  attachmentId?: string
  localRef?: string
  mediaType?: string
  filename?: string
  sizeBytes?: number
}

export type CodexDesktopRunLongTextAttachment = {
  attachmentId?: string
  localRef?: string
  filename?: string
  byteLength?: number
}

export type CodexDesktopRunMcpServer = DesktopRunMcpSessionServer

export type CreateCodexDesktopRunRequestInput = {
  runId: string
  jobId: string
  mode: AgentJobMode
  preflight: DesktopRunPreflightResult
  prompt: string
  permissionPolicy: DesktopPermissionPolicy
  providerBinding: Omit<DesktopRunProviderBinding, "diagnostics">
  mcpServers: CodexDesktopRunMcpServer[]
  images?: CodexDesktopRunImageAttachment[]
  longTextAttachments?: CodexDesktopRunLongTextAttachment[]
  signal: AbortSignal
  resumeSessionId?: string | null
  parentSessionId?: string | null
  /** The Run's host-composed ledger the adapter ingests into. */
  ledger?: CanonicalDesktopRunLedger | null
}

export function createCodexDesktopRunRequest({
  runId,
  jobId,
  mode,
  preflight,
  prompt,
  permissionPolicy,
  providerBinding,
  mcpServers,
  images,
  longTextAttachments,
  signal,
  resumeSessionId,
  parentSessionId,
  ledger = null,
}: CreateCodexDesktopRunRequestInput): DesktopRunRequest {
  return {
    identity: {
      runId,
      jobId,
    },
    context: createDesktopRunContextFromPreflight("codex", mode, preflight),
    prompt,
    requestedCapabilities: getDesktopRunRequestedCapabilities(permissionPolicy),
    permissionPolicy,
    providerBinding: {
      ...providerBinding,
      diagnostics: permissionPolicy.diagnostics.map((message, index) => ({
        id: `permission-policy-${index + 1}`,
        status: "ready",
        message,
      })),
    },
    mcp: {
      status: "ready",
      serverNames: mcpServers.map((server) => server.name),
      blockers: [],
    },
    mcpSessionServers: mcpServers,
    attachments: [
      ...(images ?? []).map((image) => ({
        kind: "image" as const,
        attachmentId: image.attachmentId,
        localRef: image.localRef,
        mediaType: image.mediaType,
        filename: image.filename,
        byteLength: image.sizeBytes,
      })),
      ...(longTextAttachments ?? []).map((attachment) => ({
        kind: "long-text" as const,
        attachmentId: attachment.attachmentId,
        localRef: attachment.localRef,
        filename: attachment.filename,
        byteLength: attachment.byteLength,
      })),
    ],
    ledger,
    signal,
    session: {
      resumeSessionId,
      parentSessionId,
    },
  }
}
