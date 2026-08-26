import { CLAUDE_AGENT_SDK_DESKTOP_ADAPTER_METADATA } from "../agent-runtime/desktop-adapter-metadata"
import type {
  DesktopRunRequest,
  DesktopRunResult,
} from "../agent-runtime/desktop-run-request"
import {
  type DesktopRuntimeAdapter,
  emitDesktopRuntimeAdapterStarted,
} from "../agent-runtime/desktop-runner"
import { isActiveClaudeSessionSignal } from "./active-sessions"
import {
  type ClaudeAgentSdkQuery,
  getClaudeAgentSdkQuery,
} from "./agent-sdk-query-loader"
import type { ClaudeAgentSdkQueryParams } from "./agent-sdk-query-options"

export type ClaudeAgentSdkStream = AsyncIterable<any>

export type ClaudeAgentSdkStreamConsumer = (input: {
  request: DesktopRunRequest
  stream: ClaudeAgentSdkStream
}) => Promise<DesktopRunResult>

export type CreateClaudeAgentSdkAdapterInput = {
  query?: ClaudeAgentSdkQuery
  loadQuery?: () => Promise<ClaudeAgentSdkQuery>
  queryOptions: ClaudeAgentSdkQueryParams
  consumeStream: ClaudeAgentSdkStreamConsumer
  isRequestAuthoritative?: ClaudeAgentSdkRequestAuthority
}

export type ClaudeAgentSdkRequestAuthority = (
  request: DesktopRunRequest,
) => boolean

export function isAuthoritativeClaudeAgentSdkRequest(
  request: DesktopRunRequest,
): boolean {
  return (
    !request.signal.aborted &&
    isActiveClaudeSessionSignal(request.context.subChatId, request.signal)
  )
}

export class ClaudeAgentSdkLoadError extends Error {
  originalError: unknown

  constructor(originalError: unknown) {
    super("Failed to load Claude Agent SDK")
    this.name = "ClaudeAgentSdkLoadError"
    this.originalError = originalError
  }
}

export class ClaudeAgentSdkQueryStartError extends Error {
  originalError: unknown

  constructor(originalError: unknown) {
    super("Failed to start Claude query")
    this.name = "ClaudeAgentSdkQueryStartError"
    this.originalError = originalError
  }
}

export function createClaudeAgentSdkAdapter({
  query,
  loadQuery = getClaudeAgentSdkQuery,
  queryOptions,
  consumeStream,
  isRequestAuthoritative = isAuthoritativeClaudeAgentSdkRequest,
}: CreateClaudeAgentSdkAdapterInput): DesktopRuntimeAdapter {
  return {
    metadata: CLAUDE_AGENT_SDK_DESKTOP_ADAPTER_METADATA,

    async run(request: DesktopRunRequest): Promise<DesktopRunResult> {
      if (!isRequestAuthoritative(request)) {
        return { status: "canceled" }
      }

      let sdkQuery = query
      if (!sdkQuery) {
        try {
          sdkQuery = await loadQuery()
        } catch (error) {
          throw new ClaudeAgentSdkLoadError(error)
        }
      }

      if (!isRequestAuthoritative(request)) {
        return { status: "canceled" }
      }

      emitDesktopRuntimeAdapterStarted(
        request,
        CLAUDE_AGENT_SDK_DESKTOP_ADAPTER_METADATA,
      )

      let stream: ClaudeAgentSdkStream
      try {
        stream = sdkQuery(queryOptions) as ClaudeAgentSdkStream
      } catch (error) {
        throw new ClaudeAgentSdkQueryStartError(error)
      }

      return consumeStream({ request, stream })
    },
  }
}
