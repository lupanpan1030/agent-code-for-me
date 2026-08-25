import {
  type DesktopRunRequest,
  type DesktopRunResult,
  withDesktopRunAttempt,
} from "../agent-runtime/desktop-run-request"
import {
  type DesktopRuntimeAdapter,
  DesktopRuntimeAdapterFactory,
} from "../agent-runtime/desktop-runner"
import { redactRuntimePayload } from "../agent-runtime/redaction"
import type { JsonValue } from "../agent-runtime/runtime-events"
import {
  ClaudeAgentSdkLoadError,
  ClaudeAgentSdkQueryStartError,
  type ClaudeAgentSdkStreamConsumer,
  createClaudeAgentSdkAdapter,
} from "./agent-sdk-adapter"
import {
  type ClaudeAgentSdkPolicyRetryState,
  createClaudeAgentSdkPolicyRetryState,
  resetClaudeAgentSdkPolicyRetryAttempt,
  waitForClaudeAgentSdkPolicyRetry,
} from "./agent-sdk-policy-retry"
import type { ClaudeAgentSdkQuery } from "./agent-sdk-query-loader"
import type { ClaudeAgentSdkQueryParams } from "./agent-sdk-query-options"
import type { PrepareClaudeAgentSdkDesktopRuntimeQueryResult } from "./agent-sdk-runtime-query"
import {
  type ClaudeAgentSdkStreamConsumerMutableState,
  type CreateClaudeAgentSdkStreamConsumerInput,
  createClaudeAgentSdkStreamConsumer,
  createClaudeAgentSdkStreamConsumerStateAccess,
  resetClaudeAgentSdkStreamConsumerAttemptState,
} from "./agent-sdk-stream-consumer"
import type { UIMessageChunk } from "./types"

export type RunClaudeAgentSdkAdapterWithPolicyRetryInput = {
  adapter: DesktopRuntimeAdapter
  request: DesktopRunRequest
  policyRetry: ClaudeAgentSdkPolicyRetryState
  beforeAttempt: () => void
  getChunkCount: () => number
  subId: string
  emitError: (error: unknown, context: string) => void
  emit: (chunk: UIMessageChunk) => void
  complete: () => void
  secretHints?: readonly string[]
  sleep?: (delayMs: number) => Promise<unknown>
  log?: (...args: any[]) => void
  error?: (...args: any[]) => void
}

export type RunClaudeAgentSdkDesktopAdapterInput = Omit<
  RunClaudeAgentSdkAdapterWithPolicyRetryInput,
  "adapter"
> & {
  query?: ClaudeAgentSdkQuery
  loadQuery?: () => Promise<ClaudeAgentSdkQuery>
  queryOptions: ClaudeAgentSdkQueryParams
  consumeStream: ClaudeAgentSdkStreamConsumer
  resolveAdapter?: typeof resolveClaudeAgentSdkDesktopAdapter
}

export type RunClaudeAgentSdkDesktopAdapterWithStreamConsumerInput = Omit<
  RunClaudeAgentSdkDesktopAdapterInput,
  "consumeStream" | "policyRetry" | "beforeAttempt" | "getChunkCount"
> & {
  streamConsumer: Omit<
    CreateClaudeAgentSdkStreamConsumerInput,
    "policyRetry" | "state"
  >
  streamState: ClaudeAgentSdkStreamConsumerMutableState
}

export type RunClaudeAgentSdkDesktopAdapterWithRuntimeConsumerInput = Omit<
  RunClaudeAgentSdkDesktopAdapterWithStreamConsumerInput,
  "streamConsumer" | "emit"
> &
  Omit<
    CreateClaudeAgentSdkStreamConsumerInput,
    | "policyRetry"
    | "state"
    | "emit"
    | "complete"
    | "subId"
    | "prompt"
    | "cwd"
    | "abortSignal"
    | "chatId"
    | "subChatId"
    | "mode"
    | "model"
    | "baseUrl"
  > & {
    emit: CreateClaudeAgentSdkStreamConsumerInput["emit"]
  }

export type RunClaudeAgentSdkDesktopAdapterWithPreparedRuntimeQueryInput = Omit<
  RunClaudeAgentSdkDesktopAdapterWithRuntimeConsumerInput,
  "queryOptions" | "mcpServers"
> & {
  runtimeQuery: Pick<
    PrepareClaudeAgentSdkDesktopRuntimeQueryResult,
    "queryOptions" | "mcpServers" | "mcpRegistryVerificationTargets"
  >
}

export async function runClaudeAgentSdkDesktopAdapter({
  query,
  loadQuery,
  queryOptions,
  consumeStream,
  resolveAdapter = resolveClaudeAgentSdkDesktopAdapter,
  ...runnerInput
}: RunClaudeAgentSdkDesktopAdapterInput): Promise<DesktopRunResult> {
  const adapter = createClaudeAgentSdkAdapter({
    query,
    loadQuery,
    queryOptions,
    consumeStream,
  })
  const desktopAdapter = resolveAdapter({
    adapter,
    request: runnerInput.request,
  })
  return runClaudeAgentSdkAdapterWithPolicyRetry({
    adapter: desktopAdapter,
    ...runnerInput,
  })
}

export function resolveClaudeAgentSdkDesktopAdapter({
  adapter,
  request,
}: {
  adapter: DesktopRuntimeAdapter
  request: DesktopRunRequest
}): DesktopRuntimeAdapter {
  return new DesktopRuntimeAdapterFactory([adapter]).get({
    runtimeId: request.context.runtimeId,
    source: "claude-agent-sdk",
  })
}

export async function runClaudeAgentSdkDesktopAdapterWithRuntimeConsumer({
  request,
  query,
  loadQuery,
  queryOptions,
  streamState,
  subId,
  emitError,
  emit,
  complete,
  sleep,
  log,
  error,
  ...streamConsumer
}: RunClaudeAgentSdkDesktopAdapterWithRuntimeConsumerInput): Promise<DesktopRunResult> {
  const { context } = request
  return runClaudeAgentSdkDesktopAdapterWithStreamConsumer({
    request,
    query,
    loadQuery,
    queryOptions,
    streamState,
    streamConsumer: {
      ...streamConsumer,
      prompt: request.prompt,
      cwd: context.cwd,
      abortSignal: request.signal,
      chatId: context.chatId,
      subChatId: context.subChatId,
      mode: context.mode,
      model: request.providerBinding.model,
      baseUrl: request.providerBinding.gatewayEndpoint,
      subId,
      emit,
      complete,
    },
    subId,
    emitError,
    emit,
    complete,
    sleep,
    log,
    error,
  })
}

export async function runClaudeAgentSdkDesktopAdapterWithPreparedRuntimeQuery({
  runtimeQuery,
  ...input
}: RunClaudeAgentSdkDesktopAdapterWithPreparedRuntimeQueryInput): Promise<DesktopRunResult> {
  return runClaudeAgentSdkDesktopAdapterWithRuntimeConsumer({
    ...input,
    queryOptions: runtimeQuery.queryOptions,
    mcpServers: runtimeQuery.mcpServers as Record<string, unknown> | undefined,
    mcpRegistryVerificationTargets: runtimeQuery.mcpRegistryVerificationTargets,
  })
}

export async function runClaudeAgentSdkDesktopAdapterWithStreamConsumer({
  streamConsumer,
  streamState,
  ...input
}: RunClaudeAgentSdkDesktopAdapterWithStreamConsumerInput): Promise<DesktopRunResult> {
  const policyRetry = createClaudeAgentSdkPolicyRetryState()
  return runClaudeAgentSdkDesktopAdapter({
    ...input,
    secretHints: streamConsumer.secretHints,
    policyRetry,
    consumeStream: createClaudeAgentSdkStreamConsumer({
      ...streamConsumer,
      policyRetry,
      state: createClaudeAgentSdkStreamConsumerStateAccess(streamState),
    }),
    beforeAttempt: () => {
      resetClaudeAgentSdkStreamConsumerAttemptState(streamState)
    },
    getChunkCount: () => streamState.chunkCount,
  })
}

export async function runClaudeAgentSdkAdapterWithPolicyRetry({
  adapter,
  request,
  policyRetry,
  beforeAttempt,
  getChunkCount,
  subId,
  emitError,
  emit,
  complete,
  secretHints,
  sleep,
  log = console.log,
  error = console.error,
}: RunClaudeAgentSdkAdapterWithPolicyRetryInput): Promise<DesktopRunResult> {
  let attempt = 0

  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1
    resetClaudeAgentSdkPolicyRetryAttempt(policyRetry)
    beforeAttempt()
    const attemptRequest = withDesktopRunAttempt(request, attempt)

    try {
      const adapterResult = await adapter.run(attemptRequest)
      if (adapterResult.status === "failed") {
        return adapterResult
      }
    } catch (adapterError) {
      if (adapterError instanceof ClaudeAgentSdkLoadError) {
        emitError(adapterError.originalError, "Failed to load Claude Agent SDK")
        log(
          `[SD] M:END sub=${subId} reason=sdk_load_error n=${getChunkCount()}`,
        )
        emit({ type: "finish" })
        complete()
        return { status: "failed", error: { message: "SDK load error" } }
      }

      const queryError =
        adapterError instanceof ClaudeAgentSdkQueryStartError
          ? adapterError.originalError
          : adapterError
      const redactedQueryError = redactRuntimePayload(
        queryError instanceof Error
          ? ({
              name: queryError.name,
              message: queryError.message,
              stack: queryError.stack ?? null,
            } as JsonValue)
          : String(queryError),
        {
          runtimeId: "claude-code",
          runId: request.identity.runId,
          jobId: request.identity.jobId,
          source: "runtime-diagnostic",
          secretHints,
        },
      ).payload
      error("[CLAUDE] ✗ Failed to create SDK query:", redactedQueryError)
      emitError(queryError, "Failed to start Claude query")
      log(`[SD] M:END sub=${subId} reason=query_error n=${getChunkCount()}`)
      emit({ type: "finish" })
      complete()
      return { status: "failed", error: { message: "SDK query error" } }
    }

    if (
      await waitForClaudeAgentSdkPolicyRetry({
        state: policyRetry,
        sleep,
        log,
      })
    ) {
      continue
    }

    return { status: "succeeded" }
  }
}
