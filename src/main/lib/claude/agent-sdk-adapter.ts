import { CLAUDE_AGENT_SDK_DESKTOP_ADAPTER_METADATA } from "../agent-runtime/desktop-adapter-metadata"
import type {
  DesktopRunRequest,
  DesktopRunResult,
} from "../agent-runtime/desktop-run-request"
import {
  type DesktopRuntimeAdapter,
  recordDesktopRuntimeAdapterStarted,
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

/**
 * SDK message ingress of the correlated resume facts (design "Resume
 * Validation and Snapshot Repair"): the query's system/init and result
 * messages are submitted to the Run's ledger with the query's resume intent;
 * the ledger records native_resume_validated/rejected. Only the fields the
 * predicate needs are forwarded; the stream itself is passed through
 * unchanged to the existing consumer.
 */
async function* withCorrelatedInitIngress(
  request: DesktopRunRequest,
  queryOptions: ClaudeAgentSdkQueryParams,
  stream: ClaudeAgentSdkStream,
): ClaudeAgentSdkStream {
  const ledger = request.ledger ?? null
  const options = queryOptions.options as Record<string, unknown>
  const queryId = `claude-query:${request.identity.runId}`
  const resumeIntent =
    typeof options.resume === "string" && options.resume.length > 0
      ? {
          queryId,
          resume: options.resume,
          forkSession: options.forkSession === true,
          ...(typeof options.resumeSessionAt === "string"
            ? { resumeSessionAt: options.resumeSessionAt }
            : {}),
        }
      : undefined
  let messageCounter = 0
  for await (const message of stream) {
    if (
      ledger &&
      message &&
      typeof message === "object" &&
      ((message.type === "system" && message.subtype === "init") ||
        message.type === "result")
    ) {
      messageCounter += 1
      void ledger
        .ingestClaudeMessage({
          observationKey: `${queryId}:message:${messageCounter}`,
          queryId,
          message: {
            type: message.type,
            ...(typeof message.subtype === "string"
              ? { subtype: message.subtype }
              : {}),
            ...(typeof message.session_id === "string"
              ? { session_id: message.session_id }
              : {}),
            ...(message.is_error === true ? { is_error: true } : {}),
            ...(Array.isArray(message.errors)
              ? {
                  errors: message.errors.filter(
                    (entry: unknown) => typeof entry === "string",
                  ),
                }
              : {}),
          },
          ...(resumeIntent ? { resumeIntent } : {}),
        })
        .catch(() => {})
    }
    yield message
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

      await recordDesktopRuntimeAdapterStarted(
        request,
        CLAUDE_AGENT_SDK_DESKTOP_ADAPTER_METADATA,
      )

      let stream: ClaudeAgentSdkStream
      try {
        stream = sdkQuery(queryOptions) as ClaudeAgentSdkStream
      } catch (error) {
        throw new ClaudeAgentSdkQueryStartError(error)
      }

      return consumeStream({
        request,
        stream: withCorrelatedInitIngress(request, queryOptions, stream),
      })
    },
  }
}
