import type { ResolvedChatImageAttachment } from "../../../shared/chat-attachments"
import {
  isActiveGuardedContract,
  registerActiveGuardedScopeExpansionRequest,
  type ValidatedAgentScopeContract,
} from "../agent-guard"
import { CODEX_APP_SERVER_DESKTOP_ADAPTER_METADATA } from "../agent-runtime/desktop-adapter-metadata"
import type {
  DesktopRunMcpSessionServer,
  DesktopRunRequest,
  DesktopRunResult,
} from "../agent-runtime/desktop-run-request"
import { emitDesktopRuntimeAdapterStarted } from "../agent-runtime/desktop-runner"
import {
  type CodexAppServerPermissionMapping,
  getCodexAppServerPermissionMapping,
} from "../agent-runtime/permission-policy"
import {
  createRuntimeStreamChunkSecretRedactor,
  mapDesktopStreamChunkToRunEvents,
  redactRendererRuntimeChunk,
} from "../agent-runtime/stream-event-mapper"
import type { CodexDesktopAdapter } from "./adapter-types"
import {
  type CodexAppServerApplyPatchApprovalParams,
  type CodexAppServerCommandExecutionRequestApprovalParams,
  type CodexAppServerExecCommandApprovalParams,
  type CodexAppServerFileChangeRequestApprovalParams,
  type CodexAppServerPermissionsRequestApprovalParams,
  createCodexAppServerApprovalBridge,
} from "./app-server-approval"
import {
  buildCodexAppServerUserInputItems,
  prepareCodexAppServerRuntimePrompt,
} from "./app-server-attachments"
import {
  buildCodexControlledEditDynamicToolSpec,
  type CodexAppServerDynamicToolCallParams,
  type CodexAppServerDynamicToolSpec,
  codexControlledEditDeveloperInstructions,
} from "./app-server-controlled-edit"
import type { CodexAppServerResolvedPluginConfigOverrides } from "./app-server-plugin-config"
import {
  type CodexAppServerPluginHomeResult,
  prepareCodexAppServerIsolatedPluginHome,
} from "./app-server-plugin-home"
import {
  assertNoCodexAppServerRendererSecrets,
  buildCodexAppServerProviderBinding,
  type CodexAppServerProviderBinding,
} from "./app-server-provider-binding"
import {
  type CodexAppServerServerRequest,
  dispatchCodexAppServerServerRequest,
} from "./app-server-safety"
import {
  assertCodexAppServerShellSnapshotsScrubbed,
  scrubCodexAppServerShellSnapshots,
} from "./app-server-shell-snapshots"
import {
  type CodexAppServerNotification,
  createCodexAppServerRuntimeEventMapper,
} from "./app-server-stream-events"
import {
  type CodexAppServerTransport,
  type CodexAppServerTransportServerRequest,
  type CodexAppServerTransportServerRequestResponse,
  createCodexAppServerStdioTransport,
} from "./app-server-transport"
import {
  buildCodexAppServerMcpElicitationResponse,
  buildCodexAppServerUserInputResponse,
  type CodexAppServerMcpElicitationRequestParams,
  type CodexAppServerToolRequestUserInputParams,
  createCodexAppServerUserInteractionBridge,
} from "./app-server-user-interaction"
import type { CodexAskUserQuestionPending } from "./ask-user-question"

export type CreateCodexAppServerAdapterInput = {
  enabled?: boolean
  experimentalApi?: boolean
  configOverrides?: Record<string, unknown>
  pluginConfig?: CodexAppServerResolvedPluginConfigOverrides
  pluginConfigOverrides?: CodexAppServerPluginHomeResult["pluginConfigOverrides"]
  preparePluginHome?: (input: {
    request: DesktopRunRequest
    runtimeEnv: Record<string, string>
    pluginConfig: CodexAppServerResolvedPluginConfigOverrides
    mcpServers: DesktopRunMcpSessionServer[]
  }) => Promise<CodexAppServerPluginHomeResult>
  createTransport?: (input: {
    request: DesktopRunRequest
    providerBinding: CodexAppServerProviderBinding
    /** Main-process-only exact values for transport diagnostic redaction. */
    secretHints: readonly string[]
  }) => CodexAppServerTransport
  providerGatewayToken?: string | null
  appManagedApiKey?: string | null
  /** Main-process-only exact values for canonical runtime redaction. */
  secretHints?: readonly string[]
  controlledEditEnabled?: boolean
  processEnv?: NodeJS.ProcessEnv
  shellEnv?: NodeJS.ProcessEnv
  resolvedImages?: ResolvedChatImageAttachment[]
  guardedContract?: ValidatedAgentScopeContract | null
  /** Exact desktop lifecycle owner check; fail-closed around async callbacks. */
  isCurrentRunOwner?: () => boolean
  emit?: (chunk: Record<string, unknown>) => void
  registerPendingQuestion?: (
    approvalId: string,
    pending: CodexAskUserQuestionPending,
  ) => void
  unregisterPendingQuestion?: (
    approvalId: string,
    pending: CodexAskUserQuestionPending,
  ) => boolean
  userInputTimeoutMs?: number
  prepareRuntimePrompt?: typeof prepareCodexAppServerRuntimePrompt
}

export class CodexAppServerAdapterDisabledError extends Error {
  constructor() {
    super(
      "Codex app-server adapter is behind an explicit gate and is not enabled.",
    )
    this.name = "CodexAppServerAdapterDisabledError"
  }
}

export class CodexAppServerPermissionPolicyError extends Error {
  constructor() {
    super(
      "Codex app-server permission policy mapping is not available; refusing app-server startup.",
    )
    this.name = "CodexAppServerPermissionPolicyError"
  }
}

function assertCodexAppServerPermissionPolicyReady(
  request: DesktopRunRequest,
): CodexAppServerPermissionMapping {
  try {
    const permission = getCodexAppServerPermissionMapping(
      request.permissionPolicy,
    )
    if (
      permission.requiresApprovalGate &&
      permission.approvalHook.required &&
      permission.approvalHook.missing === "fail-closed" &&
      permission.approvalHook.delayed === "fail-closed"
    ) {
      return permission
    }
  } catch {
    throw new CodexAppServerPermissionPolicyError()
  }

  throw new CodexAppServerPermissionPolicyError()
}

function sandboxForRequest(request: DesktopRunRequest) {
  if (request.context.mode === "plan") {
    return {
      threadSandbox: "read-only",
      turnSandbox: { type: "readOnly", networkAccess: false },
    } as const
  }

  return {
    threadSandbox: "workspace-write",
    turnSandbox: {
      type: "workspaceWrite",
      writableRoots: [request.context.cwd],
      networkAccess: false,
      excludeTmpdirEnvVar: true,
      excludeSlashTmp: true,
    },
  } as const
}

function stringAt(value: unknown, path: string[]): string | null {
  let current = value
  for (const key of path) {
    if (typeof current !== "object" || current === null) return null
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === "string" ? current : null
}

function arrayAt(value: unknown, path: string[]): unknown[] {
  let current = value
  for (const key of path) {
    if (typeof current !== "object" || current === null) return []
    current = (current as Record<string, unknown>)[key]
  }
  return Array.isArray(current) ? current : []
}

function appServerMcpStatusSummary(value: unknown): {
  serverCount: number
  readyServerCount: number
  serverNames: string[]
  authStatuses: string[]
  toolNamesByServer: Record<string, string[]>
} {
  const servers = arrayAt(value, ["data"])
  const serverNames: string[] = []
  const authStatuses: string[] = []
  const toolNamesByServer: Record<string, string[]> = {}
  let readyServerCount = 0

  for (const server of servers) {
    if (typeof server !== "object" || server === null) continue
    const record = server as Record<string, unknown>
    const name = typeof record.name === "string" ? record.name : null
    if (name) serverNames.push(name)
    const authStatus =
      typeof record.authStatus === "string" ? record.authStatus : null
    if (authStatus) authStatuses.push(authStatus)
    const tools =
      typeof record.tools === "object" && record.tools !== null
        ? Object.keys(record.tools as Record<string, unknown>)
        : []
    if (name && tools.length > 0) {
      toolNamesByServer[name] = [...new Set(tools)].sort()
    }
    if (
      tools.length > 0 ||
      authStatus === "unsupported" ||
      authStatus === "bearerToken" ||
      authStatus === "oAuth"
    ) {
      readyServerCount += 1
    }
  }

  return {
    serverCount: servers.length,
    readyServerCount,
    serverNames,
    authStatuses,
    toolNamesByServer,
  }
}

function buildThreadStartParams(input: {
  request: DesktopRunRequest
  providerBinding: CodexAppServerProviderBinding
  permission: CodexAppServerPermissionMapping
  threadSandbox: "read-only" | "workspace-write"
  config: Record<string, unknown>
  dynamicTools?: CodexAppServerDynamicToolSpec[] | null
  developerInstructions?: string | null
}) {
  const params: Record<string, unknown> = {
    model: input.request.providerBinding.model ?? null,
    modelProvider: input.providerBinding.client.modelProvider ?? null,
    cwd: input.request.context.cwd,
    approvalPolicy: input.permission.appServerApprovalPolicy,
    approvalsReviewer: "user",
    sandbox: input.threadSandbox,
    config: Object.keys(input.config).length > 0 ? input.config : null,
    serviceName: "locus",
    ephemeral: false,
    sessionStartSource: "startup",
    threadSource: "user",
  }
  if (input.dynamicTools?.length) {
    params.dynamicTools = input.dynamicTools
  }
  if (input.developerInstructions) {
    params.developerInstructions = input.developerInstructions
  }
  return params
}

function buildThreadResumeParams(input: {
  request: DesktopRunRequest
  providerBinding: CodexAppServerProviderBinding
  permission: CodexAppServerPermissionMapping
  threadSandbox: "read-only" | "workspace-write"
  config: Record<string, unknown>
  threadId: string
}) {
  return {
    threadId: input.threadId,
    model: input.request.providerBinding.model ?? null,
    modelProvider: input.providerBinding.client.modelProvider ?? null,
    cwd: input.request.context.cwd,
    approvalPolicy: input.permission.appServerApprovalPolicy,
    approvalsReviewer: "user",
    sandbox: input.threadSandbox,
    config: Object.keys(input.config).length > 0 ? input.config : null,
  }
}

function defaultServerRequestResponse(
  request: CodexAppServerTransportServerRequest,
): unknown {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
    case "item/permissions/requestApproval":
    case "item/tool/requestUserInput":
    case "mcpServer/elicitation/request":
      return failClosedServerRequestResponse(request)
    case "account/chatgptAuthTokens/refresh":
    case "attestation/generate":
    case "item/tool/call":
    case "applyPatchApproval":
    case "execCommandApproval":
      throw new Error(
        `Codex app-server server request ${request.method} is not supported by this adapter.`,
      )
    default:
      throw new Error(
        `Unknown Codex app-server server request method refused by default: ${request.method}.`,
      )
  }
}

function failClosedServerRequestResponse(
  request: CodexAppServerTransportServerRequest,
): unknown {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return { decision: "decline" }
    case "item/permissions/requestApproval":
      return {
        permissions: {},
        scope: "turn",
        strictAutoReview: true,
      }
    case "execCommandApproval":
    case "applyPatchApproval":
      return { decision: "denied" }
    case "item/tool/call":
      return {
        success: false,
        contentItems: [
          { type: "inputText", text: "Codex run is no longer active." },
        ],
      }
    case "item/tool/requestUserInput":
      return buildCodexAppServerUserInputResponse(
        request.params as CodexAppServerToolRequestUserInputParams,
        {
          approved: false,
          message: "Codex run is no longer active.",
        },
      )
    case "mcpServer/elicitation/request":
      return buildCodexAppServerMcpElicitationResponse(
        request.params as CodexAppServerMcpElicitationRequestParams,
        {
          approved: false,
          message: "Codex run is no longer active.",
        },
      )
    default:
      // Requests without a protocol-valid denial never produce a successful
      // adapter response, so the transport emits its existing protocol error.
      throw new Error(
        `Codex app-server server request ${request.method} has no fail-closed response.`,
      )
  }
}

export function createCodexAppServerAdapter({
  enabled = false,
  experimentalApi = false,
  configOverrides,
  pluginConfig,
  pluginConfigOverrides,
  preparePluginHome,
  createTransport,
  providerGatewayToken = null,
  appManagedApiKey = null,
  secretHints = [],
  controlledEditEnabled = false,
  processEnv = process.env,
  shellEnv,
  resolvedImages = [],
  guardedContract = null,
  isCurrentRunOwner,
  emit,
  registerPendingQuestion,
  unregisterPendingQuestion,
  userInputTimeoutMs,
  prepareRuntimePrompt = prepareCodexAppServerRuntimePrompt,
}: CreateCodexAppServerAdapterInput = {}): CodexDesktopAdapter {
  return {
    metadata: CODEX_APP_SERVER_DESKTOP_ADAPTER_METADATA,

    async run(request: DesktopRunRequest): Promise<DesktopRunResult> {
      const runOwnerIsCurrent = (): boolean => {
        if (request.signal.aborted) return false
        try {
          return isCurrentRunOwner ? isCurrentRunOwner() === true : true
        } catch {
          return false
        }
      }
      emitDesktopRuntimeAdapterStarted(
        request,
        CODEX_APP_SERVER_DESKTOP_ADAPTER_METADATA,
      )

      if (!enabled) {
        throw new CodexAppServerAdapterDisabledError()
      }

      assertNoCodexAppServerRendererSecrets(request, "request", {
        trustedSubtreePaths: ["request.mcpSessionServers"],
      })
      const permission = assertCodexAppServerPermissionPolicyReady(request)

      const providerBinding = buildCodexAppServerProviderBinding({
        request,
        processEnv,
        shellEnv,
        providerGatewayToken,
        appManagedApiKey,
      })
      const resolvedPluginConfig = pluginConfig ?? {
        config: pluginConfigOverrides ?? {},
        entries: [],
      }
      const pluginHome = await (preparePluginHome
        ? preparePluginHome({
            request,
            runtimeEnv: providerBinding.runtimeEnv,
            pluginConfig: resolvedPluginConfig,
            mcpServers: request.mcpSessionServers ?? [],
          })
        : createTransport
          ? Promise.resolve({
              codexHome: providerBinding.runtimeEnv.CODEX_HOME ?? "",
              runtimeEnv: providerBinding.runtimeEnv,
              pluginConfigOverrides: resolvedPluginConfig.config,
              stagedEntries: [],
              blockedEntries: [],
              skillProjection: {
                registered: false,
                kind: "skill",
                runtimeId: "codex",
                records: [],
              },
            } satisfies CodexAppServerPluginHomeResult)
          : prepareCodexAppServerIsolatedPluginHome({
              chatId: request.context.chatId,
              subChatId: request.context.subChatId,
              runtimeEnv: providerBinding.runtimeEnv,
              pluginConfig: resolvedPluginConfig,
              mcpServers: request.mcpSessionServers ?? [],
            }))
      if (isCurrentRunOwner && !runOwnerIsCurrent()) {
        return { status: "canceled" }
      }
      const appServerProviderBinding: CodexAppServerProviderBinding = {
        ...providerBinding,
        runtimeEnv: pluginHome.runtimeEnv,
      }
      assertCodexAppServerShellSnapshotsScrubbed(
        scrubCodexAppServerShellSnapshots({
          runtimeEnv: appServerProviderBinding.runtimeEnv,
        }),
        "pre-start",
      )
      const runtimeSecretHints = [
        ...new Set(
          [providerGatewayToken, appManagedApiKey, ...secretHints].filter(
            (secret): secret is string => Boolean(secret),
          ),
        ),
      ]
      const transport =
        createTransport?.({
          request,
          providerBinding: appServerProviderBinding,
          secretHints: runtimeSecretHints,
        }) ??
        createCodexAppServerStdioTransport({
          cwd: request.context.cwd,
          env: appServerProviderBinding.runtimeEnv,
          secretHints: runtimeSecretHints,
        })
      const streamSecretRedactor = createRuntimeStreamChunkSecretRedactor()
      const redactRuntimeChunk = (
        chunk: Record<string, unknown>,
      ): Record<string, unknown> =>
        redactRendererRuntimeChunk({
          runtimeId: "codex",
          runId: request.identity.runId,
          jobId: request.identity.jobId,
          chunk,
          secretHints: runtimeSecretHints,
        }) as Record<string, unknown>
      const emitRuntimeChunk = (
        chunk: Record<string, unknown>,
      ): Record<string, unknown> => {
        const redactedChunk = redactRuntimeChunk(chunk)
        emit?.(redactedChunk)
        return redactedChunk
      }
      const redactRuntimeErrorMessage = (message: string): string => {
        const redacted = redactRuntimeChunk({ type: "error", message })
        return typeof redacted.message === "string"
          ? redacted.message
          : "Codex app-server failed."
      }
      const runtimeMapper = createCodexAppServerRuntimeEventMapper()
      const { threadSandbox, turnSandbox } = sandboxForRequest(request)
      const controlledEditToolEnabled =
        controlledEditEnabled &&
        experimentalApi &&
        request.context.mode === "agent" &&
        permission.controlLevel === "guarded" &&
        Boolean(guardedContract)
      const userInteractionBridge =
        emit && registerPendingQuestion && unregisterPendingQuestion
          ? createCodexAppServerUserInteractionBridge({
              subChatId: request.context.subChatId,
              isCurrentRunOwner: runOwnerIsCurrent,
              emit: emitRuntimeChunk,
              registerPending: registerPendingQuestion,
              unregisterPending: unregisterPendingQuestion,
              timeoutMs: userInputTimeoutMs,
            })
          : null
      const approvalBridge = createCodexAppServerApprovalBridge({
        subChatId: request.context.subChatId,
        permission,
        isCurrentRunOwner: runOwnerIsCurrent,
        controlledEditEnabled: controlledEditToolEnabled,
        guardedContract,
        emit: emit ? emitRuntimeChunk : undefined,
        registerPendingQuestion,
        unregisterPendingQuestion,
        timeoutMs: userInputTimeoutMs,
        secretHints: runtimeSecretHints,
        onGuardEvent: (event) => {
          if (
            event.type === "scope-expansion-request" &&
            (!guardedContract ||
              !registerActiveGuardedScopeExpansionRequest({
                contract: guardedContract,
                event,
              }))
          ) {
            return
          }
          emitRuntimeChunk({ type: "guard-event", event })
        },
        onObservedToolDecision: (event) => {
          emitRuntimeChunk({ type: "observed-tool-decision", ...event })
        },
      })
      let sequence = 0
      let lastError: DesktopRunResult["error"] | null = null
      let pendingTerminalChunk: Record<string, unknown> | null = null
      const emittedSessionInitThreadIds = new Set<string>()

      const emitMappedChunk = (
        chunk: Record<string, unknown>,
        preAppliedRules: readonly string[] = [],
      ): Record<string, unknown> | null => {
        if (chunk.type === "session-init") {
          const threadId =
            typeof chunk.threadId === "string" ? chunk.threadId : null
          if (threadId && emittedSessionInitThreadIds.has(threadId)) {
            return null
          }
          if (threadId) {
            emittedSessionInitThreadIds.add(threadId)
          }
        }
        const redactedChunk = emitRuntimeChunk(chunk)
        const events = mapDesktopStreamChunkToRunEvents({
          runtimeId: "codex",
          runId: request.identity.runId,
          jobId: request.identity.jobId,
          sequence: ++sequence,
          chunk,
          secretHints: runtimeSecretHints,
          preAppliedRules,
        })
        for (const event of events) {
          request.trace.emit(event)
        }
        return redactedChunk
      }
      const emitChunk = (
        chunk: Record<string, unknown>,
      ): Record<string, unknown>[] => {
        const emittedChunks: Record<string, unknown>[] = []
        for (const streamChunk of streamSecretRedactor.push(
          chunk,
          runtimeSecretHints,
        )) {
          const emitted = emitMappedChunk(
            streamChunk.chunk as Record<string, unknown>,
            streamChunk.appliedRules,
          )
          if (emitted) emittedChunks.push(emitted)
        }
        return emittedChunks
      }

      let resolveTerminal: (result: DesktopRunResult) => void = () => {}
      const terminal = new Promise<DesktopRunResult>((resolve) => {
        resolveTerminal = resolve
      })
      let terminalSettled = false
      let removeTerminalNotification = () => {}
      let removeTransportExit = () => {}
      let transportExitError: Error | null = null
      const pendingTransportExitRejectors = new Set<(error: Error) => void>()
      const settleTerminal = (result: DesktopRunResult) => {
        if (terminalSettled) return
        terminalSettled = true
        removeTerminalNotification()
        removeTransportExit()
        resolveTerminal(result)
      }

      removeTerminalNotification = transport.onNotification((notification) => {
        const chunks = runtimeMapper.map(
          notification as CodexAppServerNotification,
        )
        for (const chunk of chunks) {
          if (chunk.type === "finish") {
            // A runtime finish is only provisional until post-run credential
            // cleanup succeeds. Hold both the renderer chunk and durable
            // completed RunEvent so downstream consumers see one
            // authoritative terminal state.
            const redactedChunk = redactRuntimeChunk(chunk)
            pendingTerminalChunk = redactedChunk
            const metadata = redactedChunk.messageMetadata as
              | {
                  sessionId?: string | null
                  inputTokens?: number
                  outputTokens?: number
                  totalTokens?: number
                }
              | undefined
            const status =
              redactedChunk.status === "failed" ||
              redactedChunk.status === "canceled" ||
              redactedChunk.status === "interrupted" ||
              redactedChunk.status === "succeeded"
                ? redactedChunk.status
                : "failed"
            const terminalMessage =
              typeof redactedChunk.message === "string" &&
              redactedChunk.message.trim()
                ? redactedChunk.message
                : "Codex app-server returned an invalid terminal status."
            const terminalError =
              lastError ??
              (status === "failed" ? { message: terminalMessage } : null)
            settleTerminal({
              status,
              sessionId:
                runtimeMapper.getSessionId() ?? metadata?.sessionId ?? null,
              usage: {
                inputTokens: metadata?.inputTokens,
                outputTokens: metadata?.outputTokens,
                totalTokens: metadata?.totalTokens,
              },
              ...(terminalError ? { error: terminalError } : {}),
            })
            continue
          }
          for (const redactedChunk of emitChunk(chunk)) {
            if (redactedChunk.type === "error") {
              lastError = {
                message:
                  typeof redactedChunk.errorText === "string"
                    ? redactedChunk.errorText
                    : "Codex app-server error",
              }
            }
          }
        }
      })
      removeTransportExit = transport.onExit((exit) => {
        transportExitError = exit.error
        for (const rejectPendingRequest of [...pendingTransportExitRejectors]) {
          rejectPendingRequest(exit.error)
        }
        const message = redactRuntimeErrorMessage(exit.error.message)
        settleTerminal({
          status: request.signal.aborted ? "canceled" : "failed",
          sessionId: runtimeMapper.getSessionId(),
          ...(request.signal.aborted ? {} : { error: { message } }),
        })
      })
      if (terminalSettled) removeTransportExit()

      const removeServerRequest = transport.onServerRequest((serverRequest) => {
        let response: unknown
        return dispatchCodexAppServerServerRequest({
          request: {
            method: serverRequest.method,
            id: serverRequest.id,
            params: serverRequest.params,
          } satisfies CodexAppServerServerRequest,
          gate: { approvalHookInstalled: true },
          dispatch: async () => {
            if (
              serverRequest.method === "item/commandExecution/requestApproval"
            ) {
              response = await approvalBridge.handleCommandExecution({
                requestId: serverRequest.id,
                params:
                  serverRequest.params as CodexAppServerCommandExecutionRequestApprovalParams,
              })
              return response
            }
            if (serverRequest.method === "item/fileChange/requestApproval") {
              response = await approvalBridge.handleFileChange({
                requestId: serverRequest.id,
                params:
                  serverRequest.params as CodexAppServerFileChangeRequestApprovalParams,
              })
              return response
            }
            if (serverRequest.method === "item/permissions/requestApproval") {
              response = await approvalBridge.handlePermissions({
                requestId: serverRequest.id,
                params:
                  serverRequest.params as CodexAppServerPermissionsRequestApprovalParams,
              })
              return response
            }
            if (serverRequest.method === "execCommandApproval") {
              response = await approvalBridge.handleLegacyExecCommand({
                requestId: serverRequest.id,
                params:
                  serverRequest.params as CodexAppServerExecCommandApprovalParams,
              })
              return response
            }
            if (serverRequest.method === "applyPatchApproval") {
              response = await approvalBridge.handleLegacyApplyPatch({
                requestId: serverRequest.id,
                params:
                  serverRequest.params as CodexAppServerApplyPatchApprovalParams,
              })
              return response
            }
            if (serverRequest.method === "item/tool/call") {
              response = await approvalBridge.handleDynamicToolCall({
                requestId: serverRequest.id,
                params:
                  serverRequest.params as CodexAppServerDynamicToolCallParams,
              })
              return response
            }
            if (
              serverRequest.method === "item/tool/requestUserInput" &&
              userInteractionBridge
            ) {
              response = await userInteractionBridge.handleUserInputRequest({
                requestId: String(serverRequest.id),
                params:
                  serverRequest.params as CodexAppServerToolRequestUserInputParams,
              })
              return response
            }
            if (
              serverRequest.method === "mcpServer/elicitation/request" &&
              userInteractionBridge
            ) {
              response =
                await userInteractionBridge.handleMcpElicitationRequest({
                  requestId: String(serverRequest.id),
                  params:
                    serverRequest.params as CodexAppServerMcpElicitationRequestParams,
                })
              return response
            }

            response = defaultServerRequestResponse(serverRequest)
            return response
          },
        }).then(
          (): CodexAppServerTransportServerRequestResponse => ({
            result: response,
            failClosedResult: failClosedServerRequestResponse(serverRequest),
            isResponseStillAuthorized: () =>
              runOwnerIsCurrent() &&
              (!guardedContract || isActiveGuardedContract(guardedContract)),
          }),
        )
      })

      let abortHandled = false
      const abortHandler = () => {
        if (abortHandled) return
        abortHandled = true
        const interrupt = runtimeMapper.buildInterruptRequest()
        if (interrupt) {
          void transport
            .request(interrupt.method, interrupt.params)
            .catch(() => {})
        }
        settleTerminal({
          status: "canceled",
          sessionId: runtimeMapper.getSessionId(),
        })
      }
      request.signal.addEventListener("abort", abortHandler, { once: true })
      if (request.signal.aborted) {
        abortHandler()
      }

      const requestWithCancellation = (
        method: Parameters<CodexAppServerTransport["request"]>[0],
        params: unknown,
      ): Promise<unknown> => {
        if (!runOwnerIsCurrent()) {
          return Promise.reject(new Error("Codex app-server run canceled."))
        }
        if (transportExitError) return Promise.reject(transportExitError)
        return new Promise((resolve, reject) => {
          let settled = false
          const settle = (callback: () => void) => {
            if (settled) return
            settled = true
            request.signal.removeEventListener("abort", onAbort)
            pendingTransportExitRejectors.delete(onTransportExit)
            callback()
          }
          const onAbort = () => {
            settle(() => reject(new Error("Codex app-server run canceled.")))
          }
          const onTransportExit = (error: Error) => {
            settle(() => reject(error))
          }
          request.signal.addEventListener("abort", onAbort, { once: true })
          pendingTransportExitRejectors.add(onTransportExit)
          let pendingRequest: Promise<unknown>
          try {
            pendingRequest = transport.request(method, params)
          } catch (error) {
            settle(() => reject(error))
            return
          }
          void pendingRequest.then(
            (value) => settle(() => resolve(value)),
            (error) => settle(() => reject(error)),
          )
          if (request.signal.aborted) onAbort()
          else if (transportExitError) onTransportExit(transportExitError)
        })
      }

      let runResult: DesktopRunResult = {
        status: "failed",
        sessionId: null,
        error: {
          message: "Codex app-server did not produce a terminal result.",
        },
      }

      try {
        const preparedPrompt = await prepareRuntimePrompt({
          prompt: request.prompt,
          longTextAttachments: request.attachments
            .filter((attachment) => attachment.kind === "long-text")
            .map((attachment) => ({
              localRef: attachment.localRef ?? "",
              filename: attachment.filename ?? "attachment.txt",
              kind: "pasted",
              byteLength: attachment.byteLength ?? 0,
              attachmentId: attachment.attachmentId,
            })),
        })
        const input = buildCodexAppServerUserInputItems({
          prompt: preparedPrompt.prompt,
          attachmentRefs: request.attachments,
          resolvedImages,
          allowPreparedLongTextRefs: true,
        })

        await requestWithCancellation("initialize", {
          clientInfo: {
            name: "locus",
            title: "Locus",
            version: "0.0.0",
          },
          capabilities: {
            experimentalApi,
            requestAttestation: false,
          },
        })
        transport.notify("initialized")
        const appServerConfig = {
          ...(providerBinding.client.config ?? {}),
          ...(configOverrides ?? {}),
          ...pluginHome.pluginConfigOverrides,
        }

        const resumeThreadId = request.session.resumeSessionId ?? null
        const threadStart = resumeThreadId
          ? await requestWithCancellation(
              "thread/resume",
              buildThreadResumeParams({
                request,
                providerBinding: appServerProviderBinding,
                permission,
                threadSandbox,
                config: appServerConfig,
                threadId: resumeThreadId,
              }),
            )
          : await requestWithCancellation(
              "thread/start",
              buildThreadStartParams({
                request,
                providerBinding: appServerProviderBinding,
                permission,
                threadSandbox,
                config: appServerConfig,
                dynamicTools: controlledEditToolEnabled
                  ? [buildCodexControlledEditDynamicToolSpec()]
                  : null,
                developerInstructions: controlledEditToolEnabled
                  ? codexControlledEditDeveloperInstructions()
                  : null,
              }),
            )
        const responseThreadId = stringAt(threadStart, ["thread", "id"])
        if (!runtimeMapper.getThreadId() && responseThreadId) {
          const responseSessionId =
            stringAt(threadStart, ["thread", "sessionId"]) ?? responseThreadId
          for (const chunk of runtimeMapper.map({
            method: "thread/started",
            params: {
              thread: {
                id: responseThreadId,
                sessionId: responseSessionId,
              },
            },
          } as CodexAppServerNotification)) {
            emitChunk(chunk)
          }
        }
        const threadId = responseThreadId ?? runtimeMapper.getThreadId()
        if (!threadId) {
          throw new Error("Codex app-server did not return a thread id.")
        }

        try {
          const mcpStatus = await requestWithCancellation(
            "mcpServerStatus/list",
            {
              detail: "toolsAndAuthOnly",
            },
          )
          emitChunk({
            type: "runtime-status",
            ok: true,
            blocker: {
              component: "mcp",
              status: "ready",
              message: "Codex app-server MCP status list resolved.",
              hint: null,
            },
            mcp: appServerMcpStatusSummary(mcpStatus),
          })
        } catch (mcpStatusError) {
          emitRuntimeChunk({
            type: "runtime-status",
            ok: true,
            blocker: {
              component: "mcp",
              status: "unknown",
              message: "Codex app-server MCP status list was unavailable.",
              hint:
                mcpStatusError instanceof Error
                  ? mcpStatusError.message
                  : String(mcpStatusError),
            },
            mcp: {
              serverCount: request.mcp.serverNames.length,
              readyServerCount: 0,
              serverNames: request.mcp.serverNames,
              authStatuses: [],
              degraded: true,
            },
          })
        }

        const turnStart = await requestWithCancellation("turn/start", {
          threadId,
          input,
          cwd: request.context.cwd,
          approvalPolicy: permission.appServerApprovalPolicy,
          approvalsReviewer: "user",
          sandboxPolicy: turnSandbox,
          model: request.providerBinding.model ?? null,
        })
        const turnId =
          stringAt(turnStart, ["turn", "id"]) ?? runtimeMapper.getTurnId()
        if (!turnId) {
          throw new Error("Codex app-server did not return a turn id.")
        }

        runResult = await terminal
      } catch (error) {
        const message = redactRuntimeErrorMessage(
          error instanceof Error ? error.message : String(error),
        )
        runResult = {
          status: runOwnerIsCurrent() ? "failed" : "canceled",
          sessionId: runtimeMapper.getSessionId(),
          error: {
            message,
          },
        }
      } finally {
        request.signal.removeEventListener("abort", abortHandler)
        removeServerRequest()
        try {
          await transport.close()
        } catch (closeError) {
          const message = redactRuntimeErrorMessage(
            closeError instanceof Error
              ? closeError.message
              : String(closeError),
          )
          runResult = {
            status: "failed",
            sessionId: runtimeMapper.getSessionId(),
            error: { message },
          }
        }
        removeTerminalNotification()
        removeTransportExit()
        for (const streamChunk of streamSecretRedactor.flush(
          runtimeSecretHints,
        )) {
          emitMappedChunk(
            streamChunk.chunk as Record<string, unknown>,
            streamChunk.appliedRules,
          )
        }
        try {
          assertCodexAppServerShellSnapshotsScrubbed(
            scrubCodexAppServerShellSnapshots({
              runtimeEnv: appServerProviderBinding.runtimeEnv,
            }),
            "post-run",
          )
        } catch (scrubError) {
          const message =
            scrubError instanceof Error
              ? redactRuntimeErrorMessage(scrubError.message)
              : redactRuntimeErrorMessage(String(scrubError))
          emitChunk({
            type: "runtime-status",
            ok: false,
            blocker: {
              component: "security",
              status: "blocked",
              message,
              hint: null,
            },
          })
          runResult = {
            status: "failed",
            sessionId: runtimeMapper.getSessionId(),
            error: { message },
          }
        }

        emitChunk({
          ...(pendingTerminalChunk ?? { type: "finish" }),
          type: "finish",
          status: runResult.status,
          ...(runResult.error?.message
            ? { message: runResult.error.message }
            : {}),
        })
      }
      return runResult
    },
  }
}
