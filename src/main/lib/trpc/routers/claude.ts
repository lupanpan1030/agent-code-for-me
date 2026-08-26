import { observable } from "@trpc/server/observable"
import { z } from "zod"
import {
  getChatImageAttachmentCapability,
  resolveChatImageModelVision,
} from "../../../../shared/chat-attachment-capabilities"
import {
  type GuardedGitStatusSnapshot,
  replaceActiveGuardedContractForSubChat,
  type ValidatedAgentScopeContract,
} from "../../agent-guard"
import {
  type ChatMaintenanceRunBlocker,
  claimDesktopRunAdmissionWithMaintenanceFence,
  formatChatMaintenanceBusyMessage,
  releaseChatMaintenanceRunBlocker,
  releaseDesktopRunAdmissionWithMaintenanceFence,
} from "../../agent-runtime/chat-maintenance-fence"
import { reserveDesktopRunAdmission } from "../../agent-runtime/desktop-run-admission-generation"
import { resolveDesktopRunCwdFromDb } from "../../agent-runtime/preflight"
import {
  desktopScopeExpansionResponseInputSchema,
  respondDesktopScopeExpansion,
} from "../../agent-runtime/scope-expansion"
import { admitClaudeChatSessionBindingRun } from "../../chat-session-binding"
import type { UIMessageChunk } from "../../claude"
import {
  createClaudeDesktopSessionIdentity,
  hasActiveClaudeSession,
  isActiveClaudeSessionSignal,
} from "../../claude/active-sessions"
import {
  abortClaudeAgentSdkDesktopRunRequest,
  cleanupClaudeAgentSdkDesktopRunSubscription,
} from "../../claude/agent-sdk-desktop-run-cleanup"
import { prepareClaudeAgentSdkDesktopRunControls } from "../../claude/agent-sdk-desktop-run-controls"
import { createClaudeAgentSdkDesktopRunEnvelope } from "../../claude/agent-sdk-desktop-run-envelope"
import { prepareClaudeAgentSdkDesktopRunInputs } from "../../claude/agent-sdk-desktop-run-inputs"
import { runClaudeAgentSdkDesktopRuntimeWithMcpReadiness } from "../../claude/agent-sdk-desktop-run-runtime"
import { prepareClaudeAgentSdkDesktopRunStartup } from "../../claude/agent-sdk-desktop-run-startup"
import { superviseClaudeAgentSdkDesktopRun } from "../../claude/agent-sdk-desktop-run-supervision"
import { createClaudeAgentSdkRuntimeErrorHandlers } from "../../claude/agent-sdk-runtime-errors"
import { createClaudeAgentSdkRuntimeSecretLifecycle } from "../../claude/agent-sdk-runtime-secrets"
import { claudeChatInputSchema } from "../../claude/chat-input-schema"
import { resolveClaudePendingToolApproval } from "../../claude/tool-approvals"
import { getDatabase } from "../../db"
import {
  getProviderProfileMetadata,
  getProviderProfileRuntimeMetadataFromDatabase,
} from "../../provider-profiles/storage"
import {
  addClaudeMcpServer,
  clearClaudeCaches,
  getAllMcpConfigHandler,
  getClaudeMcpAuthStatus,
  getClaudeMcpConfig,
  getPendingPluginMcpApprovals,
  refreshClaudeMcpConfig,
  removeClaudeMcpServer,
  resolveClaudeMcpServersForSdk,
  setClaudeMcpBearerToken,
  startClaudeMcpOAuth,
  updateClaudeMcpServer,
} from "../../runtime-mcp-config/claude"
import {
  mcpArgsInputSchema,
  mcpEnvInputSchema,
  mcpStringInputSchema,
  mcpUrlInputSchema,
} from "../../runtime-mcp-config/input-validation"
import { publicProcedure, router } from "../index"

export { clearClaudeCaches, getAllMcpConfigHandler }

const claudeBindingAdmissionDependencies = {
  getProviderProfileRuntimeMetadata:
    getProviderProfileRuntimeMetadataFromDatabase,
}

export const claudeRouter = router({
  /**
   * Stream chat with Claude - single subscription handles everything
   */
  chat: publicProcedure
    .input(claudeChatInputSchema)
    .subscription(({ input }) => {
      return observable<UIMessageChunk>((emit) => {
        const db = getDatabase()
        const initialBindingAdmission = admitClaudeChatSessionBindingRun(
          db,
          input.subChatId,
          {
            modelSource: input.modelSource,
            requestedModel: input.model,
          },
          claudeBindingAdmissionDependencies,
        )
        if (!initialBindingAdmission.ok) {
          const { emitPreflightBlocker } =
            createClaudeAgentSdkRuntimeErrorHandlers({
              cwd: input.cwd ?? "",
              mode: input.mode,
              runId: input.runId,
              emit: (chunk) => emit.next(chunk),
              complete: () => emit.complete(),
            })
          emitPreflightBlocker({
            id: "provider-profile",
            status: "mismatch",
            message: initialBindingAdmission.message,
            hint: initialBindingAdmission.hint,
          })
          return () => {}
        }
        const runAdmission = reserveDesktopRunAdmission(input.subChatId)

        const runtimeSecrets = createClaudeAgentSdkRuntimeSecretLifecycle()
        let resolvedInitialCwd: string
        try {
          resolvedInitialCwd = resolveDesktopRunCwdFromDb(db, {
            chatId: input.chatId,
            subChatId: input.subChatId,
          })
        } catch (error) {
          releaseDesktopRunAdmissionWithMaintenanceFence(runAdmission)
          runtimeSecrets.release()
          const errorHandlers = createClaudeAgentSdkRuntimeErrorHandlers({
            cwd: input.cwd ?? "",
            mode: input.mode,
            runId: input.runId,
            emit: (chunk) => emit.next(chunk),
            complete: () => emit.complete(),
          })
          errorHandlers.emitError(error, "Desktop run preflight failed")
          emit.next({ type: "finish" } as UIMessageChunk)
          emit.complete()
          return () => {}
        }
        const sessionIdentity = createClaudeDesktopSessionIdentity({
          requestedRunId: input.runId,
          createId: () => crypto.randomUUID(),
        })
        const { streamId, runId: activeRunId } = sessionIdentity
        const preRunErrorHandlers = createClaudeAgentSdkRuntimeErrorHandlers({
          cwd: resolvedInitialCwd,
          mode: input.mode,
          runId: activeRunId,
          getSecretHints: runtimeSecrets.getSecretHints,
          emit: (chunk) => emit.next(chunk),
          complete: () => emit.complete(),
        })
        let activeEnvelope: ReturnType<
          typeof createClaudeAgentSdkDesktopRunEnvelope
        > | null = null
        let runMaintenanceBlocker: ChatMaintenanceRunBlocker | null = null
        let startCancelled = false
        let guardedContract: ValidatedAgentScopeContract | null = null
        let guardedPreRunStatus: GuardedGitStatusSnapshot | null = null

        void (async () => {
          try {
            const runControls = await prepareClaudeAgentSdkDesktopRunControls({
              db,
              chatId: input.chatId,
              subChatId: input.subChatId,
              cwd: input.cwd ?? resolvedInitialCwd,
              projectPath: input.projectPath,
              mode: input.mode,
              scopeContract: input.scopeContract,
              runId: input.runId,
              fallbackRunId: streamId,
              emitError: preRunErrorHandlers.emitError,
              emit: (chunk) => emit.next(chunk),
              complete: () => emit.complete(),
            })
            if (!runControls.ok) {
              return
            }
            guardedContract = runControls.guardedContract
            guardedPreRunStatus = runControls.guardedPreRunStatus
            if (startCancelled) {
              return
            }
            const bindingAdmission = admitClaudeChatSessionBindingRun(
              db,
              input.subChatId,
              {
                modelSource: input.modelSource,
                requestedModel: input.model,
              },
              claudeBindingAdmissionDependencies,
            )
            if (!bindingAdmission.ok) {
              runtimeSecrets.release()
              preRunErrorHandlers.emitPreflightBlocker({
                id: "provider-profile",
                status: "mismatch",
                message: bindingAdmission.message,
                hint: bindingAdmission.hint,
              })
              return
            }
            const runClaim =
              claimDesktopRunAdmissionWithMaintenanceFence(
                runAdmission,
                activeRunId,
              )
            if (!runClaim.ok) {
              runtimeSecrets.release()
              if (runClaim.reason === "maintenance") {
                emit.next({
                  type: "error",
                  errorText: formatChatMaintenanceBusyMessage(
                    runClaim.error,
                    "run",
                  ),
                  ...runClaim.error,
                } as UIMessageChunk)
              }
              emit.next({ type: "finish" } as UIMessageChunk)
              emit.complete()
              return
            }
            runMaintenanceBlocker = runClaim.blocker

            const envelope = createClaudeAgentSdkDesktopRunEnvelope({
              subChatId: input.subChatId,
              requestedRunId: input.runId,
              createId: () => streamId,
              cwd: resolvedInitialCwd,
              mode: input.mode,
              emitNext: (chunk) => {
                emit.next(chunk)
              },
              emitComplete: () => {
                emit.complete()
              },
              getSecretHints: runtimeSecrets.getSecretHints,
            })
            activeEnvelope = envelope
            replaceActiveGuardedContractForSubChat(
              input.subChatId,
              guardedContract,
            )
            const {
              abortController,
              subId,
              streamStart,
              streamState,
              desktopRunState,
              emit: safeEmit,
              complete: safeComplete,
              emitError,
              emitPreflightBlocker,
            } = envelope

            await superviseClaudeAgentSdkDesktopRun({
              chatId: input.chatId,
              subChatId: input.subChatId,
              abortController,
              getGuardedContract: () => guardedContract,
              getDb: getDatabase,
              desktopRunState,
              streamState,
              subId,
              streamStart,
              emitError,
              emit: safeEmit,
              complete: safeComplete,
              cleanupRuntimeSecrets: runtimeSecrets.release,
              run: async () => {
                desktopRunState.setDb(db)
                const verifiedRunContext = runControls.preflight
                const runtimeCwd = runControls.runtimeCwd
                const permissionPolicy = runControls.permissionPolicy

                const imageCapability = getChatImageAttachmentCapability({
                  provider: "claude-code",
                  offlineModeEnabled: input.offlineModeEnabled ?? false,
                  modelVision: resolveChatImageModelVision({
                    provider: "claude-code",
                    modelSource: bindingAdmission.modelSource,
                    getProviderProfileMetadata,
                  }),
                })
                const runInputs = await prepareClaudeAgentSdkDesktopRunInputs({
                  db,
                  subChatId: input.subChatId,
                  activeSessionSignal: abortController.signal,
                  streamId,
                  prompt: input.prompt,
                  images: input.images,
                  imageCapability,
                  longTextAttachments: input.longTextAttachments,
                  historyEnabled: input.historyEnabled,
                  emitPreflightBlocker,
                  createId: () => crypto.randomUUID(),
                })
                if (!runInputs.ok) {
                  if (runInputs.reason === "stale-active-session") {
                    safeEmit({ type: "finish" } as UIMessageChunk)
                    safeComplete()
                  }
                  return
                }
                const { historyEnabled, resolvedImages, chatHistory } =
                  runInputs
                const {
                  existingMessages,
                  existingSessionId,
                  resumeAtUuid,
                  shouldForkResume,
                  forkResumeAtUuid,
                  messagesToSave,
                } = chatHistory

                const runStartup = await prepareClaudeAgentSdkDesktopRunStartup(
                  {
                    db,
                    mode: input.mode,
                    chatId: input.chatId,
                    subChatId: input.subChatId,
                    cwd: runtimeCwd,
                    prompt: input.prompt,
                    runId: activeRunId,
                    cancel: () => {
                      abortClaudeAgentSdkDesktopRunRequest({
                        subChatId: input.subChatId,
                        abortController,
                      })
                    },
                    streamId,
                    preflight: verifiedRunContext,
                    permissionPolicy,
                    requestedModel: bindingAdmission.requestedModel,
                    modelSource: bindingAdmission.modelSource,
                    offlineModeEnabled: input.offlineModeEnabled ?? false,
                    enableTasks: input.enableTasks ?? true,
                    images: input.images,
                    longTextAttachments: input.longTextAttachments,
                    signal: abortController.signal,
                    existingSessionId,
                    emitPreflightBlocker,
                    onRuntimeSecretsResolved: ({ secretHints, cleanup }) => {
                      runtimeSecrets.register({ secretHints, cleanup })
                      if (abortController.signal.aborted) {
                        runtimeSecrets.revoke()
                      }
                    },
                    desktopRunState,
                  },
                )
                if (!runStartup.ok) {
                  if (runStartup.reason === "stale-active-session") {
                    safeEmit({ type: "finish" } as UIMessageChunk)
                    safeComplete()
                  }
                  return
                }
                if (
                  !isActiveClaudeSessionSignal(
                    input.subChatId,
                    abortController.signal,
                  ) ||
                  abortController.signal.aborted
                ) {
                  safeEmit({ type: "finish" } as UIMessageChunk)
                  safeComplete()
                  return
                }
                const {
                  desktopRunRequest,
                  resumeSessionId,
                  runtimeStartup,
                  isolatedConfigReady,
                  providerStartup: {
                    claudeCodeToken,
                    claudeCredentialMetadata,
                    finalCustomConfig,
                    isUsingOllama,
                  },
                } = runStartup

                const {
                  mcpServersForSdk,
                  mcpReadinessStatus,
                  mcpRegistryVerificationTargets,
                } = await resolveClaudeMcpServersForSdk({
                  isolatedConfigReady,
                  projectPath: input.projectPath,
                  runtimeCwd,
                })

                if (
                  !isActiveClaudeSessionSignal(
                    input.subChatId,
                    abortController.signal,
                  ) ||
                  abortController.signal.aborted
                ) {
                  safeEmit({ type: "finish" } as UIMessageChunk)
                  safeComplete()
                  return
                }

                const runtimeResult =
                  await runClaudeAgentSdkDesktopRuntimeWithMcpReadiness({
                    desktopRunRequest,
                    mcpReadinessStatus,
                    runtimeQuery: {
                      existingMessages,
                      rawMcpServers: mcpServersForSdk,
                      mcpRegistryVerificationTargets,
                      shouldForkResume,
                      forkResumeAtUuid,
                      resumeAtUuid,
                      maxThinkingTokens: input.maxThinkingTokens,
                      projectPath: input.projectPath,
                    },
                    runtimePrompt: {
                      images: resolvedImages,
                      longTextAttachments: input.longTextAttachments,
                    },
                    runtimeStartupDiagnostics: {
                      runtimeStartup,
                      resumeSessionId,
                      credentialMetadata: claudeCredentialMetadata,
                      existingSessionId,
                    },
                    streamState,
                    desktopRunState,
                    isUsingOllama,
                    customConfig: finalCustomConfig,
                    oauthToken: claudeCodeToken,
                    historyEnabled,
                    db,
                    messagesToSave,
                    secretHints: runtimeSecrets.getSecretHints(),
                    guardedContract,
                    guardedPreRunStatus,
                    subId,
                    emitError,
                    emit: safeEmit,
                    complete: safeComplete,
                    streamStart,
                  })
                if (runtimeResult.status === "failed") {
                  return
                }
              },
            })
          } catch (error) {
            if (!startCancelled) {
              preRunErrorHandlers.emitError(
                error,
                "Desktop run preflight failed",
              )
              emit.next({ type: "finish" } as UIMessageChunk)
              emit.complete()
            }
            runtimeSecrets.release()
          } finally {
            releaseDesktopRunAdmissionWithMaintenanceFence(runAdmission)
            if (runMaintenanceBlocker) {
              releaseChatMaintenanceRunBlocker(runMaintenanceBlocker)
              runMaintenanceBlocker = null
            }
          }
        })()

        // Cleanup on unsubscribe
        return () => {
          startCancelled = true
          releaseDesktopRunAdmissionWithMaintenanceFence(runAdmission)
          const envelope = activeEnvelope
          if (!envelope) {
            runtimeSecrets.revoke()
            return
          }
          cleanupClaudeAgentSdkDesktopRunSubscription({
            subId: envelope.subId,
            subChatId: input.subChatId,
            sessionId: envelope.streamState.currentSessionId,
            abortController: envelope.abortController,
            guardedContract,
            getDb: getDatabase,
            desktopRunState: envelope.desktopRunState,
            cleanupRuntimeSecrets: runtimeSecrets.revoke,
          })
        }
      })
    }),

  /**
   * Get MCP servers configuration for a project
   * This allows showing MCP servers in UI before starting a chat session
   * NOTE: Does NOT fetch OAuth metadata here - that's done lazily when user clicks Auth
   */
  getMcpConfig: publicProcedure
    .input(z.object({ projectPath: z.string() }))
    .query(async ({ input }) => {
      return getClaudeMcpConfig(input)
    }),

  /**
   * Get ALL MCP servers configuration (global + all projects)
   * Returns grouped data for display in settings
   * Also warms the Runtime MCP Config service cache
   */
  getAllMcpConfig: publicProcedure.query(getAllMcpConfigHandler),

  refreshMcpConfig: publicProcedure.mutation(() => {
    refreshClaudeMcpConfig()
    return { success: true }
  }),

  /**
   * Check if session is active
   */
  isActive: publicProcedure
    .input(z.object({ subChatId: z.string() }))
    .query(({ input }) => hasActiveClaudeSession(input.subChatId)),
  respondToolApproval: publicProcedure
    .input(
      z.object({
        approvalId: z.string(),
        approved: z.boolean(),
        message: z.string().optional(),
        updatedInput: z.object({}).passthrough().optional(),
      }),
    )
    .mutation(({ input }) => {
      const decision = {
        approved: input.approved,
        message: input.message,
        updatedInput: input.updatedInput,
      }
      return {
        ok: resolveClaudePendingToolApproval({
          approvalId: input.approvalId,
          decision,
        }),
      }
    }),
  respondScopeExpansion: publicProcedure
    .input(desktopScopeExpansionResponseInputSchema)
    .mutation(async ({ input }) => {
      return respondDesktopScopeExpansion(input)
    }),

  /**
   * Start MCP OAuth flow for a server
   * Fetches OAuth metadata internally when needed
   */
  startMcpOAuth: publicProcedure
    .input(
      z.object({
        serverName: z.string(),
        projectPath: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      return startClaudeMcpOAuth(input)
    }),

  /**
   * Get MCP auth status for a server
   */
  getMcpAuthStatus: publicProcedure
    .input(
      z.object({
        serverName: z.string(),
        projectPath: z.string(),
      }),
    )
    .query(async ({ input }) => {
      return getClaudeMcpAuthStatus(input)
    }),

  addMcpServer: publicProcedure
    .input(
      z.object({
        name: z
          .string()
          .min(1)
          .regex(
            /^[a-zA-Z0-9_-]+$/,
            "Name must contain only letters, numbers, underscores, and hyphens",
          ),
        scope: z.enum(["global", "project"]),
        projectPath: z.string().optional(),
        transport: z.enum(["stdio", "http"]),
        command: mcpStringInputSchema.optional(),
        args: mcpArgsInputSchema.optional(),
        env: mcpEnvInputSchema.optional(),
        url: mcpUrlInputSchema.optional(),
        authType: z.enum(["none", "oauth", "bearer"]).optional(),
        bearerToken: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return addClaudeMcpServer(input)
    }),

  updateMcpServer: publicProcedure
    .input(
      z.object({
        name: z.string(),
        scope: z.enum(["global", "project"]),
        projectPath: z.string().optional(),
        newName: z
          .string()
          .regex(/^[a-zA-Z0-9_-]+$/)
          .optional(),
        command: mcpStringInputSchema.optional(),
        args: mcpArgsInputSchema.optional(),
        env: mcpEnvInputSchema.optional(),
        url: mcpUrlInputSchema.optional(),
        authType: z.enum(["none", "oauth", "bearer"]).optional(),
        bearerToken: z.string().optional(),
        disabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return updateClaudeMcpServer(input)
    }),

  removeMcpServer: publicProcedure
    .input(
      z.object({
        name: z.string(),
        scope: z.enum(["global", "project"]),
        projectPath: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return removeClaudeMcpServer(input)
    }),

  setMcpBearerToken: publicProcedure
    .input(
      z.object({
        name: z.string(),
        scope: z.enum(["global", "project"]),
        projectPath: z.string().optional(),
        token: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      return setClaudeMcpBearerToken(input)
    }),

  getPendingPluginMcpApprovals: publicProcedure
    .input(z.object({ projectPath: z.string().optional() }))
    .query(async ({ input }) => {
      return getPendingPluginMcpApprovals(input)
    }),
})
