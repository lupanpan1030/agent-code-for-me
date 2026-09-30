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
import { recordDesktopRuntimeAdapterStarted } from "../agent-runtime/desktop-runner"
import {
  type CodexAppServerPermissionMapping,
  getCodexAppServerPermissionMapping,
} from "../agent-runtime/permission-policy"
import { redactRuntimePayload } from "../agent-runtime/redaction"
import type { RuntimeExecutionProvenance } from "../agent-runtime/run-event-ledger"
import {
  bindRunExecutionProvenance,
  type CanonicalDesktopRunLedger,
  createDesktopRendererChannel,
} from "../agent-runtime/run-event-ledger-host"
import {
  assertRunExecutableUnchanged,
  captureRunExecutionProvenance,
} from "../agent-runtime/run-provenance"
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
  classifyCodexThreadSnapshot,
  codexAppServerSchemaDocuments,
  codexNativeArtifactEvidence,
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
import {
  BUNDLED_CODEX_CLI_VERSION,
  resolveBundledCodexCliPath,
} from "./cli-path"

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
  /**
   * Execution provenance of an injected transport (tests/smoke). The stdio
   * transport captures the tuple from the executable it actually resolves.
   */
  captureExecutionProvenance?: () => Promise<RuntimeExecutionProvenance>
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

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function codexTurnTerminalStatus(
  status: unknown,
): "succeeded" | "failed" | "interrupted" {
  if (status === "completed") return "succeeded"
  if (status === "interrupted") return "interrupted"
  // turn/completed carrying inProgress (or an unknown value) is a protocol
  // violation, not evidence of success.
  return "failed"
}

function codexTurnErrorMessage(turn: Record<string, unknown>): string | null {
  const error = isRecordValue(turn.error) ? turn.error : null
  const message =
    typeof error?.message === "string"
      ? error.message
      : typeof error?.code === "string"
        ? error.code
        : null
  if (message) return message
  if (turn.status === "inProgress") {
    return "Codex app-server returned non-terminal status inProgress for turn/completed."
  }
  if (
    turn.status !== "completed" &&
    turn.status !== "interrupted" &&
    turn.status !== "failed"
  ) {
    return `Codex app-server returned unknown terminal status ${String(turn.status)}.`
  }
  return null
}

function isValidatedResumeRecord(record: unknown): boolean {
  if (!isRecordValue(record) || record.type !== "status") return false
  const payload = isRecordValue(record.payload) ? record.payload : {}
  return payload.subtype === "native_resume_validated"
}

/**
 * Snapshot repair caller of the Codex resume path (design "Resume
 * Validation and Snapshot Repair", tasks 6.4): only after the ledger
 * committed `native_resume_validated` for the thread/resume response, the
 * thread snapshot it carried is submitted to `repairFromSnapshot` with its
 * schema disposition against the pinned item table, the creator version as
 * source provenance and, when the Run already observed that turn, the target
 * turn. Pre-seal it repairs item views only; post-seal the ledger records a
 * late_event. It never creates success, write authority or a replay cursor.
 */
export async function repairFromValidatedResumeSnapshot(input: {
  ledger: CanonicalDesktopRunLedger
  observationKey: string
  responseCommitted: Promise<unknown>
  response: unknown
}): Promise<unknown> {
  const committed = await input.responseCommitted
  if (!Array.isArray(committed) || !committed.some(isValidatedResumeRecord)) {
    return []
  }
  const snapshot = classifyCodexThreadSnapshot(input.response)
  if (!snapshot) return []
  const context = await input.ledger.readNativeContext()
  const targetTurnId =
    context && snapshot.turnIds.includes(context.turnId)
      ? context.turnId
      : undefined
  return input.ledger.repairFromSnapshot({
    observationKey: input.observationKey,
    snapshot: input.response,
    schemaDisposition: snapshot.schemaDisposition,
    sourceProvenance: {
      kind: "runtime",
      runtimeId: "codex",
      ...(snapshot.creatorVersion ? { version: snapshot.creatorVersion } : {}),
    },
    ...(targetTurnId ? { targetTurnId } : {}),
  })
}

/**
 * Launch caller of the Codex app-server executable (tasks 6.1): the actual
 * resolved executable is captured through run-provenance.ts and the host
 * binds the tuple to the Run before the process starts; the executable bytes
 * are re-checked right before spawn. An injected transport binds the tuple
 * its caller supplies.
 */
async function launchCodexAppServerTransport(input: {
  request: DesktopRunRequest
  ledger: CanonicalDesktopRunLedger | null
  providerBinding: CodexAppServerProviderBinding
  secretHints: readonly string[]
  createTransport: CreateCodexAppServerAdapterInput["createTransport"]
  captureExecutionProvenance: CreateCodexAppServerAdapterInput["captureExecutionProvenance"]
}): Promise<CodexAppServerTransport> {
  if (input.createTransport) {
    if (input.ledger && input.captureExecutionProvenance) {
      await bindRunExecutionProvenance(
        input.ledger,
        await input.captureExecutionProvenance(),
      )
    }
    return input.createTransport({
      request: input.request,
      providerBinding: input.providerBinding,
      secretHints: input.secretHints,
    })
  }
  const executable = resolveBundledCodexCliPath()
  if (input.ledger) {
    const provenance = await captureRunExecutionProvenance({
      runtimeId: "codex",
      adapterSource: "codex-app-server",
      version: BUNDLED_CODEX_CLI_VERSION,
      protocolName: "codex-app-server-jsonrpc",
      protocolVersion: "v2",
      executablePath: executable,
      schemaDocuments: codexAppServerSchemaDocuments(),
    })
    await bindRunExecutionProvenance(input.ledger, provenance)
    assertRunExecutableUnchanged(provenance)
  }
  return createCodexAppServerStdioTransport({
    executable,
    cwd: input.request.context.cwd,
    env: input.providerBinding.runtimeEnv,
    secretHints: input.secretHints,
  })
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
  captureExecutionProvenance,
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
      await recordDesktopRuntimeAdapterStarted(
        request,
        CODEX_APP_SERVER_DESKTOP_ADAPTER_METADATA,
      )

      if (!enabled) {
        throw new CodexAppServerAdapterDisabledError()
      }

      assertNoCodexAppServerRendererSecrets(request, "request", {
        // The Run ledger and committed-record consumer are main-process host
        // objects composed by the host, not renderer input.
        trustedSubtreePaths: [
          "request.mcpSessionServers",
          "request.ledger",
          "request.trace",
          "request.artifactCandidates",
          "request.executionProvenance",
        ],
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
      const ledger = request.ledger ?? null
      ledger?.addSecretHints(runtimeSecretHints)
      const renderer = createDesktopRendererChannel({
        runtimeId: "codex",
        runId: request.identity.runId,
        observationPrefix: `codex-desktop:${request.identity.runId}:stream`,
        getLedger: () => ledger,
        getSecretHints: () => runtimeSecretHints,
        emit: (chunk) => emit?.(chunk),
      })
      const emitRuntimeChunk = (chunk: Record<string, unknown>): void => {
        renderer.submit(chunk)
      }
      const redactRuntimeErrorMessage = (message: string): string => {
        const redacted = redactRuntimePayload(message, {
          runtimeId: "codex",
          runId: request.identity.runId,
          source: "runtime-diagnostic",
          secretHints: runtimeSecretHints,
        }).payload
        return typeof redacted === "string" && redacted.length > 0
          ? redacted
          : "Codex app-server failed."
      }
      const transport = await launchCodexAppServerTransport({
        request,
        ledger,
        providerBinding: appServerProviderBinding,
        secretHints: runtimeSecretHints,
        createTransport,
        captureExecutionProvenance,
      })
      const transportId = `codex-app-server:${request.identity.runId}`
      let observationCounter = 0
      const observationKey = (kind: string) => {
        observationCounter += 1
        return `codex:${request.identity.runId}:${kind}:${observationCounter}`
      }
      const receivedAt = () => new Date().toISOString()
      const recordCommitted = (committed: Promise<unknown> | undefined) => {
        if (committed) renderer.deliverCommitted(committed)
      }
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
      // Native identity observed on this Run's responses/notifications; the
      // interrupt target itself is read from the ledger's native context.
      let sessionId: string | null = null
      let threadId: string | null = null
      let turnId: string | null = null

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
        const method = notification.method
        const params = isRecordValue(notification.params)
          ? notification.params
          : {}
        const boundary = {
          observationKey: observationKey("notification"),
          transportId,
          receivedAt: receivedAt(),
          message: { method, params: notification.params },
        }
        const artifactCandidates = request.artifactCandidates ?? null
        if (artifactCandidates && method === "turn/completed") {
          // The turn's latest diff candidate is submitted before its
          // terminal notification, so an admission precedes completed.
          const completedTurnId = stringAt(params, ["turn", "id"])
          if (completedTurnId) artifactCandidates.flushTurn(completedTurnId)
        }
        if (ledger) {
          recordCommitted(
            method === "serverRequest/resolved"
              ? ledger.recordServerRequestResolved({
                  ...boundary,
                  requestId: params.requestId as string | number,
                })
              : ledger.ingestNotification(boundary),
          )
        }
        if (artifactCandidates) {
          for (const evidence of codexNativeArtifactEvidence(
            boundary.message,
          )) {
            artifactCandidates.observe(evidence)
          }
        }
        if (method === "thread/started") {
          threadId = stringAt(params, ["thread", "id"]) ?? threadId
          sessionId = stringAt(params, ["thread", "sessionId"]) ?? sessionId
        }
        if (method === "turn/started") {
          turnId = stringAt(params, ["turn", "id"]) ?? turnId
        }
        if (method !== "turn/completed") return
        // The native terminal notification only ends this adapter's wait;
        // the Run's outcome is settled by the host from committed evidence.
        const turn = isRecordValue(params.turn) ? params.turn : {}
        const status = codexTurnTerminalStatus(turn.status)
        const errorMessage = codexTurnErrorMessage(turn)
        const turnError = isRecordValue(turn.error) ? turn.error : null
        const nativeCode =
          typeof turnError?.code === "string" ||
          typeof turnError?.code === "number"
            ? turnError.code
            : undefined
        settleTerminal({
          status,
          sessionId,
          // The live native terminal this result derives from: the host
          // settles the Run from it (native_terminal evidence linked to the
          // committed turn/completed observation).
          ...(status === "succeeded" || status === "failed"
            ? {
                nativeTerminal: {
                  observationKey: boundary.observationKey,
                  status,
                  ...(nativeCode !== undefined ? { code: nativeCode } : {}),
                },
              }
            : {}),
          ...(status === "failed"
            ? {
                error: {
                  message: redactRuntimeErrorMessage(
                    errorMessage ??
                      "Codex app-server returned an invalid terminal status.",
                  ),
                },
              }
            : {}),
        })
      })
      removeTransportExit = transport.onExit((exit) => {
        transportExitError = exit.error
        for (const rejectPendingRequest of [...pendingTransportExitRejectors]) {
          rejectPendingRequest(exit.error)
        }
        if (ledger) {
          recordCommitted(
            ledger.ingestTransportExit({
              observationKey: observationKey("transport-exit"),
              transportId,
              exitCode: exit.code ?? null,
              signal: exit.signal ?? null,
            }),
          )
        }
        const message = redactRuntimeErrorMessage(exit.error.message)
        settleTerminal({
          status: request.signal.aborted ? "canceled" : "failed",
          sessionId,
          ...(request.signal.aborted ? {} : { error: { message } }),
        })
      })
      if (terminalSettled) removeTransportExit()

      const removeServerRequest = transport.onServerRequest((serverRequest) => {
        let response: unknown
        if (ledger) {
          recordCommitted(
            ledger.ingestServerRequest({
              observationKey: observationKey("server-request"),
              transportId,
              receivedAt: receivedAt(),
              message: {
                id: serverRequest.id,
                method: serverRequest.method,
                params: serverRequest.params,
              },
            }),
          )
        }
        const recordSend = (result: "sent" | "failed") => {
          if (!ledger) return
          recordCommitted(
            ledger.recordServerResponseSend({
              observationKey: observationKey("response-send"),
              transportId,
              receivedAt: receivedAt(),
              requestId: serverRequest.id,
              result,
            }),
          )
        }
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
          (): CodexAppServerTransportServerRequestResponse => {
            recordSend("sent")
            return {
              result: response,
              failClosedResult: failClosedServerRequestResponse(serverRequest),
              isResponseStillAuthorized: () =>
                runOwnerIsCurrent() &&
                (!guardedContract || isActiveGuardedContract(guardedContract)),
            }
          },
          (error: unknown) => {
            recordSend("failed")
            throw error
          },
        )
      })

      let abortHandled = false
      // Resolves once the interrupt request was handed to the transport (it
      // must precede transport.close()).
      let interruptIssued: Promise<void> = Promise.resolve()
      const abortHandler = () => {
        if (abortHandled) return
        abortHandled = true
        interruptIssued = (async () => {
          // The interrupt target is the Run's native context owned by the
          // ledger (read after the observations already submitted commit);
          // without an observed turn there is nothing to interrupt.
          if (!ledger) return
          await ledger.whenIdle()
          const target = await ledger.readNativeContext()
          if (target?.threadId && target.turnId) {
            void transport
              .request("turn/interrupt", {
                threadId: target.threadId,
                turnId: target.turnId,
              })
              .catch(() => {})
          }
        })().catch(() => {})
        settleTerminal({
          status: "canceled",
          sessionId,
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

      // Records the correlated response boundary of one client request so
      // the ledger owns resume validation and the native context.
      let responseCounter = 0
      let resumeResponseCommitted: Promise<unknown> | null = null
      const requestWithResponseBoundary = async (
        method: "thread/start" | "thread/resume" | "turn/start",
        params: unknown,
        context: { intent?: "start" | "resume"; expectedSessionId?: string },
      ): Promise<unknown> => {
        responseCounter += 1
        const correlationId = `locus-${responseCounter}`
        const boundaryRequest = {
          id: correlationId,
          method,
          params,
          ...(context.intent ? { intent: context.intent } : {}),
          ...(context.expectedSessionId
            ? { expectedSessionId: context.expectedSessionId }
            : {}),
        }
        try {
          const result = await requestWithCancellation(method, params)
          if (ledger) {
            const committed = ledger.ingestResponse({
              observationKey: observationKey("response"),
              transportId,
              receivedAt: receivedAt(),
              request: boundaryRequest,
              message: { id: correlationId, result },
            })
            recordCommitted(committed)
            if (method === "thread/resume") resumeResponseCommitted = committed
          }
          return result
        } catch (error) {
          const code =
            error && typeof error === "object" && "code" in error
              ? (error as { code?: unknown }).code
              : undefined
          if (
            ledger &&
            (typeof code === "number" || typeof code === "string")
          ) {
            recordCommitted(
              ledger.ingestResponse({
                observationKey: observationKey("response"),
                transportId,
                receivedAt: receivedAt(),
                request: boundaryRequest,
                message: {
                  id: correlationId,
                  error: {
                    code,
                    message: error instanceof Error ? error.message : "",
                  },
                },
              }),
            )
          }
          throw error
        }
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
          ? await requestWithResponseBoundary(
              "thread/resume",
              buildThreadResumeParams({
                request,
                providerBinding: appServerProviderBinding,
                permission,
                threadSandbox,
                config: appServerConfig,
                threadId: resumeThreadId,
              }),
              { intent: "resume", expectedSessionId: resumeThreadId },
            )
          : await requestWithResponseBoundary(
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
              { intent: "start" },
            )
        if (ledger && resumeThreadId && resumeResponseCommitted) {
          // Recorded before the new turn so the repair (and any usage
          // baseline it carries) precedes this Run's turn records.
          const repaired = repairFromValidatedResumeSnapshot({
            ledger,
            observationKey: observationKey("resume-snapshot"),
            responseCommitted: resumeResponseCommitted,
            response: threadStart,
          })
          recordCommitted(repaired)
          await repaired.catch(() => {})
        }
        // No thread/started is fabricated for a resumed thread: the response
        // is the native fact, and a missing session id stays missing.
        threadId = stringAt(threadStart, ["thread", "id"]) ?? threadId
        sessionId = stringAt(threadStart, ["thread", "sessionId"]) ?? sessionId
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
          emitRuntimeChunk({
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

        const turnStart = await requestWithResponseBoundary(
          "turn/start",
          {
            threadId,
            input,
            cwd: request.context.cwd,
            approvalPolicy: permission.appServerApprovalPolicy,
            approvalsReviewer: "user",
            sandboxPolicy: turnSandbox,
            model: request.providerBinding.model ?? null,
          },
          {},
        )
        turnId = stringAt(turnStart, ["turn", "id"]) ?? turnId
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
          sessionId,
          error: {
            message,
          },
        }
      } finally {
        request.signal.removeEventListener("abort", abortHandler)
        removeServerRequest()
        await interruptIssued
        // The adapter already has its own result: the deliberate close below
        // is a Locus-initiated shutdown, not an unexpected transport exit, so
        // the exit handler is detached first and the child ending is never
        // submitted as a transport-exit terminal candidate. An exit observed
        // while the Run was live has already reached ingestTransportExit.
        removeTransportExit()
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
            sessionId,
            error: { message },
          }
        }
        removeTerminalNotification()
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
          emitRuntimeChunk({
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
            sessionId,
            error: { message },
          }
        }

        // Native artifact candidates settle before the host settles the Run.
        await request.artifactCandidates?.drain()
        // Usage is read after every submitted observation committed.
        if (ledger) await ledger.whenIdle()
        const usage = ledger ? await ledger.readUsage() : null
        const last = usage?.last ?? null
        const total = usage?.total ?? null
        if (last) {
          runResult = {
            ...runResult,
            usage: {
              inputTokens: last.inputTokens,
              outputTokens: last.outputTokens,
              totalTokens: last.totalTokens,
            },
          }
        }
        // Renderer framing only: the Run's terminal is settled by the host
        // from committed evidence; this chunk carries no durable fact.
        emitRuntimeChunk({
          type: "finish",
          status: runResult.status,
          ...(runResult.error?.message
            ? { message: runResult.error.message }
            : {}),
          messageMetadata: {
            provider: "codex",
            adapterSource: "codex-app-server",
            threadId,
            turnId,
            sessionId,
            inputTokens: last?.inputTokens,
            outputTokens: last?.outputTokens,
            totalTokens: last?.totalTokens,
            cumulativeInputTokens: total?.inputTokens,
            cumulativeOutputTokens: total?.outputTokens,
            cumulativeTotalTokens: total?.totalTokens,
          },
        })
        await renderer.drain()
      }
      return runResult
    },
  }
}
