import { spawn } from "node:child_process"
import { observable } from "@trpc/server/observable"
import { z } from "zod"
import {
  getChatImageAttachmentCapability,
  resolveChatImageModelVision,
} from "../../../../shared/chat-attachment-capabilities"
import {
  buildCodexCapabilityErrorChunk,
  buildCodexRuntimeStatusChunk,
  createCodexRuntimeBlocker,
} from "../../../../shared/codex-runtime-status"
import { MAX_HEADER_SAFE_CREDENTIAL_LENGTH } from "../../../../shared/secret-redaction-policy"
import {
  formatScopeValidationError,
  replaceActiveGuardedContractForSubChat,
  type ValidatedAgentScopeContract,
  validateAgentScopeContract,
} from "../../agent-guard"
import {
  type ChatMaintenanceRunBlocker,
  claimDesktopRunAdmissionWithMaintenanceFence,
  formatChatMaintenanceBusyMessage,
  releaseChatMaintenanceRunBlocker,
  releaseDesktopRunAdmissionWithMaintenanceFence,
} from "../../agent-runtime/chat-maintenance-fence"
import { reserveDesktopRunAdmission } from "../../agent-runtime/desktop-run-admission-generation"
import { resolveDesktopPermissionPolicy } from "../../agent-runtime/permission-policy"
import { verifyDesktopRunPreflight } from "../../agent-runtime/preflight"
import {
  appendRunEventsToAgentJob,
  redactRendererRuntimeChunk,
} from "../../agent-runtime/stream-event-mapper"
import { prepareChatImageAttachmentsForDesktopRun } from "../../chat-attachments"
import { admitCodexChatSessionBindingRun } from "../../chat-session-binding"
import {
  type ActiveCodexStream,
  getActiveCodexStream,
  setActiveCodexStream,
} from "../../codex/active-streams"
import {
  getStoredCodexApiKeyModelIds,
  getCodexApiKeyStatus as getStoredCodexApiKeyStatus,
  removeCodexApiKey as removeStoredCodexApiKey,
  saveCodexApiKey as saveStoredCodexApiKey,
} from "../../codex/api-key-store"
import {
  CodexApiKeyValidationError,
  clearCachedCodexApiKeyModelIds,
  getCachedCodexApiKeyModelIds,
  hasCachedCodexApiKeyModelIdsSnapshot,
  subscribeCodexApiKeyModelIds,
  validateCodexApiKey,
} from "../../codex/api-key-validation"
import { runCodexAppServerDesktopAdapter } from "../../codex/app-server-adapter-runner"
import { createCodexAppServerFinishGate } from "../../codex/app-server-finish-gate"
import { getLastCodexSessionId } from "../../codex/chat-history"
import { codexChatInputSchema } from "../../codex/chat-input-schema"
import { resolveBundledCodexCliPath } from "../../codex/cli-path"
import { runCodexCli } from "../../codex/cli-runner"
import {
  cleanupCodexDesktopRunSubscription,
  createAndRegisterCodexDesktopRunJob,
  createCodexDesktopRunState,
  finalizeCodexDesktopRunAfterLifecycle,
} from "../../codex/desktop-run-finalize"
import {
  loadCodexDesktopRunHistory,
  persistCodexDesktopAssistantAfterNaturalFinish,
  persistCodexDesktopRunUserMessage,
} from "../../codex/desktop-run-persistence"
import { createCodexDesktopRunPreflightStage } from "../../codex/desktop-run-preflight"
import { createCodexDesktopRunProviderBindingStage } from "../../codex/desktop-run-provider-binding"
import { createCodexDesktopRunRequest } from "../../codex/desktop-run-request"
import {
  extractCodexError as extractCodexErrorWithProviderRedaction,
  getCodexErrorDiagnostics,
  isCodexAuthError,
} from "../../codex/errors"
import {
  getCodexIntegrationStatus,
  isCodexIntegrationConnected,
  normalizeCodexIntegrationState,
} from "../../codex/integration-status"
import {
  appendCodexLoginOutput,
  redactCodexLoginOutput,
} from "../../codex/login-output"
import {
  cancelCodexLoginSession,
  createCodexLoginSession,
  getActiveCodexLoginSession,
  getCodexLoginSession,
  toCodexLoginSessionResponse,
} from "../../codex/login-session"
import { getCodexRuntimeStatus } from "../../codex/runtime-status"
import {
  deleteCodexPendingToolApproval,
  resolveCodexPendingToolApproval,
  setCodexPendingToolApproval,
} from "../../codex/tool-approvals"
import { getDatabase } from "../../db"
import { getProviderProfileMetadata } from "../../provider-profiles/storage"
import {
  addCodexMcpServer,
  type CodexMcpSnapshot,
  clearCodexMcpConfigCache,
  createEmptyCodexMcpSnapshot,
  getAllCodexMcpConfigHandler,
  logoutCodexMcpServer,
  removeCodexMcpServer,
  resolveCodexMcpSnapshotForDesktopRun,
  startCodexMcpOAuth,
} from "../../runtime-mcp-config/codex"
import {
  mcpArgsInputSchema,
  mcpStringInputSchema,
  mcpUrlInputSchema,
} from "../../runtime-mcp-config/input-validation"
import { publicProcedure, router } from "../index"

function getCodexApiKeyStatusResponse() {
  const status = getStoredCodexApiKeyStatus()
  const modelIds = hasCachedCodexApiKeyModelIdsSnapshot()
    ? getCachedCodexApiKeyModelIds()
    : getStoredCodexApiKeyModelIds()
  return {
    ...status,
    modelIds: status.hasApiKey ? modelIds : [],
  }
}

function extractCodexError(error: unknown): { message: string; code?: string } {
  return extractCodexErrorWithProviderRedaction(error, {
    redactLoginOutput: redactCodexLoginOutput,
  })
}

export const codexRouter = router({
  getRuntimeStatus: publicProcedure.query(() => getCodexRuntimeStatus()),

  getIntegration: publicProcedure.query(() => getCodexIntegrationStatus()),

  getCodexApiKeyStatus: publicProcedure.query(getCodexApiKeyStatusResponse),

  apiKeyModelUpdates: publicProcedure.subscription(() =>
    observable<ReturnType<typeof getCodexApiKeyStatusResponse>>((emit) => {
      emit.next(getCodexApiKeyStatusResponse())
      return subscribeCodexApiKeyModelIds(() => {
        emit.next(getCodexApiKeyStatusResponse())
      })
    }),
  ),

  saveCodexApiKey: publicProcedure
    .input(
      z.object({
        apiKey: z.string().min(1).max(MAX_HEADER_SAFE_CREDENTIAL_LENGTH),
      }),
    )
    .mutation(async ({ input }) => {
      const validation = await validateCodexApiKey(input.apiKey)
      // Only refuse to store a key we know is bad. Transient/network/rate-limit
      // failures must not block save (local-first: the key may be valid and the
      // user may simply be offline) — store it but flag it unverified so the UI
      // can warn instead of silently accepting an unchecked key.
      if (
        !validation.ok &&
        (validation.category === "auth_failed" ||
          validation.category === "invalid_format")
      ) {
        throw new CodexApiKeyValidationError(validation)
      }
      let status: ReturnType<typeof saveStoredCodexApiKey>
      try {
        status = saveStoredCodexApiKey(
          input.apiKey,
          {},
          validation.ok ? getCachedCodexApiKeyModelIds() : [],
        )
      } catch (error) {
        clearCachedCodexApiKeyModelIds()
        throw error
      }
      if (!validation.ok) {
        return {
          ...status,
          modelIds: [],
          verified: false as const,
          warning: validation.hint
            ? `${validation.message} ${validation.hint}`
            : validation.message,
        }
      }
      return {
        ...status,
        modelIds: getCachedCodexApiKeyModelIds(),
        verified: true as const,
      }
    }),

  removeCodexApiKey: publicProcedure.mutation(() => {
    clearCachedCodexApiKeyModelIds()
    const status = removeStoredCodexApiKey()
    return { ...status, modelIds: [] }
  }),

  logout: publicProcedure.mutation(async () => {
    const logoutResult = await runCodexCli(["logout"])
    const statusResult = await runCodexCli(["login", "status"])

    const statusOutput = [statusResult.stdout, statusResult.stderr]
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n")
      .trim()

    const state = normalizeCodexIntegrationState(statusOutput)
    const isConnected = isCodexIntegrationConnected(state)

    if (isConnected) {
      throw new Error("Failed to log out from Codex. Please try again.")
    }

    const logoutOutput = [logoutResult.stdout, logoutResult.stderr]
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n")
      .trim()

    return {
      success: true,
      state,
      isConnected: false,
      logoutExitCode: logoutResult.exitCode,
      logoutOutput,
      statusOutput,
    }
  }),

  startLogin: publicProcedure.mutation(() => {
    const existingSession = getActiveCodexLoginSession()
    if (existingSession) {
      return toCodexLoginSessionResponse(existingSession)
    }

    const codexCliPath = resolveBundledCodexCliPath()
    const sessionId = crypto.randomUUID()

    const child = spawn(codexCliPath, ["login"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      windowsHide: true,
    })

    const session = createCodexLoginSession({
      id: sessionId,
      process: child,
    })

    const handleChunk = (chunk: Buffer | string) => {
      appendCodexLoginOutput(session, chunk.toString("utf8"))
    }

    child.stdout.on("data", handleChunk)
    child.stderr.on("data", handleChunk)

    child.once("error", (error) => {
      session.state = "error"
      session.error = `[codex] Failed to start login flow: ${error.message}`
      session.process = null
    })

    child.once("close", (exitCode) => {
      session.exitCode = exitCode
      session.process = null

      if (session.state === "cancelled") {
        return
      }

      if (exitCode === 0) {
        session.state = "success"
        session.error = null
      } else {
        session.state = "error"
        session.error =
          session.error ||
          `Codex login exited with code ${exitCode ?? "unknown"}`
      }
    })

    return toCodexLoginSessionResponse(session)
  }),

  getLoginSession: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
      }),
    )
    .query(({ input }) => {
      const session = getCodexLoginSession(input.sessionId)
      if (!session) {
        throw new Error("Codex login session not found")
      }

      return toCodexLoginSessionResponse(session)
    }),

  cancelLogin: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
      }),
    )
    .mutation(({ input }) => {
      return cancelCodexLoginSession(input.sessionId)
    }),

  getAllMcpConfig: publicProcedure.query(async () => {
    try {
      return await getAllCodexMcpConfigHandler()
    } catch (error) {
      console.error("[codex.getAllMcpConfig] Error:", error)
      return {
        groups: [],
        error: extractCodexError(error).message,
      }
    }
  }),

  refreshMcpConfig: publicProcedure.mutation(() => {
    clearCodexMcpConfigCache()
    return { success: true }
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
        transport: z.enum(["stdio", "http"]),
        command: mcpStringInputSchema.optional(),
        args: mcpArgsInputSchema.optional(),
        url: mcpUrlInputSchema.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return addCodexMcpServer(input)
    }),

  removeMcpServer: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        scope: z.enum(["global", "project"]).default("global"),
      }),
    )
    .mutation(async ({ input }) => {
      return removeCodexMcpServer(input)
    }),

  startMcpOAuth: publicProcedure
    .input(
      z.object({
        serverName: z.string().min(1),
        projectPath: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await startCodexMcpOAuth(input)
      } catch (error) {
        return {
          success: false as const,
          error: extractCodexError(error).message,
        }
      }
    }),

  logoutMcpServer: publicProcedure
    .input(
      z.object({
        serverName: z.string().min(1),
        projectPath: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await logoutCodexMcpServer(input)
      } catch (error) {
        return {
          success: false as const,
          error: extractCodexError(error).message,
        }
      }
    }),

  chat: publicProcedure
    .input(codexChatInputSchema)
    .subscription(({ input }) => {
      return observable<any>((emit) => {
        const db = getDatabase()
        const initialBindingAdmission = admitCodexChatSessionBindingRun(
          db,
          input.subChatId,
          {
            providerProfileId: input.providerProfileId,
            codexAuthMethod: input.codexAuthMethod,
            model: input.model,
          },
        )
        if (!initialBindingAdmission.ok) {
          const { emitPreflightBlocker } = createCodexDesktopRunPreflightStage({
            emit: (chunk) => {
              emit.next(
                redactRendererRuntimeChunk({
                  runtimeId: "codex",
                  runId: input.runId,
                  jobId: null,
                  chunk,
                }),
              )
            },
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

        const abortController = new AbortController()
        const activeStreamOwner: ActiveCodexStream = {
          runId: input.runId,
          controller: abortController,
          cancelRequested: false,
        }
        let isActive = true
        let ownsActiveStream = false
        let runMaintenanceBlocker: ChatMaintenanceRunBlocker | null = null
        const desktopRunState = createCodexDesktopRunState()
        const appServerPersistenceChunks: Record<string, unknown>[] = []
        const providerBindingStage = createCodexDesktopRunProviderBindingStage()
        const providerSecretHints = providerBindingStage.getSecretHints

        const emitRendererChunk = (chunk: Record<string, unknown>) => {
          if (!isActive) return
          try {
            const rendererChunk = redactRendererRuntimeChunk({
              runtimeId: "codex",
              runId: input.runId,
              jobId: desktopRunState.getJobId(),
              chunk,
              secretHints: providerSecretHints(),
            })
            emit.next(rendererChunk)
          } catch {
            isActive = false
          }
        }

        const appServerFinishGate = createCodexAppServerFinishGate({
          enabled: () => true,
          emit: emitRendererChunk,
        })

        const safeEmit = (chunk: Record<string, unknown>) => {
          const redactedChunk = redactRendererRuntimeChunk({
            runtimeId: "codex",
            runId: input.runId,
            jobId: desktopRunState.getJobId(),
            chunk,
            secretHints: providerSecretHints(),
          }) as Record<string, unknown>
          appServerPersistenceChunks.push(redactedChunk)
          if (
            redactedChunk?.type === "error" ||
            redactedChunk?.type === "auth-error" ||
            redactedChunk?.type === "capability-error" ||
            (redactedChunk?.type === "runtime-status" &&
              redactedChunk?.ok === false)
          ) {
            desktopRunState.markSawError()
          }
          appServerFinishGate.emit(redactedChunk)
        }

        const safeComplete = () => {
          if (!isActive) return
          isActive = false
          try {
            emit.complete()
          } catch {
            // Ignore double completion
          }
        }

        let guardedContract: ValidatedAgentScopeContract | null = null

        ;(async () => {
          try {
            desktopRunState.setDb(db)
            const verifiedRunContext = verifyDesktopRunPreflight(db, {
              chatId: input.chatId,
              subChatId: input.subChatId,
              cwd: input.cwd,
            })
            const runtimeCwd = verifiedRunContext.cwd

            if (input.scopeContract) {
              try {
                const validated = await validateAgentScopeContract(
                  input.scopeContract,
                  {
                    cwd: runtimeCwd,
                    projectPath: input.projectPath,
                    chatId: input.chatId,
                    subChatId: input.subChatId,
                    runId: input.runId,
                  },
                )
                guardedContract = {
                  ...validated,
                  runId: validated.runId ?? input.runId,
                }
              } catch (guardError) {
                safeEmit({
                  type: "error",
                  errorText: `Guarded run contract rejected: ${formatScopeValidationError(guardError)}`,
                })
                safeEmit({ type: "finish" })
                safeComplete()
                return
              }
            }
            const permissionPolicy = resolveDesktopPermissionPolicy({
              runtimeId: "codex",
              mode: input.mode,
              workspaceKind: verifiedRunContext.kind,
              hasScopeContract: Boolean(guardedContract),
              codexAdapterSource: "codex-app-server",
            })

            const {
              emitPreflightBlocker,
              emitLocalOnlyPreflightBlocker,
              verifyRuntimeStatus,
            } = createCodexDesktopRunPreflightStage({
              emit: safeEmit,
              complete: safeComplete,
            })

            if (!(await verifyRuntimeStatus())) {
              return
            }

            if (!isActive || abortController.signal.aborted) {
              return
            }
            const bindingAdmission = admitCodexChatSessionBindingRun(
              db,
              input.subChatId,
              {
                providerProfileId: input.providerProfileId,
                codexAuthMethod: input.codexAuthMethod,
                model: input.model,
              },
            )
            if (!bindingAdmission.ok) {
              emitPreflightBlocker({
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
                input.runId,
              )
            if (!runClaim.ok) {
              if (runClaim.reason === "maintenance") {
                safeEmit({
                  type: "error",
                  errorText: formatChatMaintenanceBusyMessage(
                    runClaim.error,
                    "run",
                  ),
                  ...runClaim.error,
                })
              }
              safeEmit({ type: "finish" })
              safeComplete()
              return
            }
            runMaintenanceBlocker = runClaim.blocker
            const existingStream = getActiveCodexStream(input.subChatId)
            if (existingStream) {
              existingStream.cancelRequested = true
              existingStream.controller.abort()
            }
            setActiveCodexStream(input.subChatId, activeStreamOwner)
            ownsActiveStream = true
            replaceActiveGuardedContractForSubChat(
              input.subChatId,
              guardedContract,
            )

            const existingMessages = loadCodexDesktopRunHistory({
              db,
              subChatId: input.subChatId,
            })
            const codexProviderProfileMetadata =
              bindingAdmission.providerProfileId
                ? getProviderProfileMetadata(bindingAdmission.providerProfileId)
                : null
            const imageCapability = getChatImageAttachmentCapability({
              provider: "codex",
              modelVision: resolveChatImageModelVision({
                provider: "codex",
                providerProfileId: bindingAdmission.providerProfileId,
                getProviderProfileMetadata: (id) =>
                  id === bindingAdmission.providerProfileId
                    ? codexProviderProfileMetadata
                    : getProviderProfileMetadata(id),
              }),
            })
            const imageAttachments =
              await prepareChatImageAttachmentsForDesktopRun({
                images: input.images,
                imageCapability,
                emitPreflightBlocker,
              })
            if (!imageAttachments.ok) {
              return
            }
            const resolvedImages = imageAttachments.attachments
            const providerBindingResult = await providerBindingStage.resolve({
              providerProfileId:
                bindingAdmission.providerProfileId ?? undefined,
              codexAuthMethod: bindingAdmission.codexAuthMethod ?? undefined,
              requestedModel: bindingAdmission.requestedModel ?? undefined,
              providerProfileBoundModelId:
                bindingAdmission.providerProfileId
                  ? (bindingAdmission.binding.modelId ?? undefined)
                  : undefined,
              signal: abortController.signal,
              emit: safeEmit,
              complete: safeComplete,
              emitPreflightBlocker,
              emitLocalOnlyPreflightBlocker,
            })
            if (!providerBindingResult.ok) {
              return
            }
            const {
              providerProfile: codexProviderProfile,
              appManagedApiKey: appManagedCodexApiKey,
              metadataModel,
            } = providerBindingResult

            const userPersistence = persistCodexDesktopRunUserMessage({
              db,
              subChatId: input.subChatId,
              activeStreamOwner,
              existingMessages,
              prompt: input.prompt,
              images: input.images,
              longTextAttachments: input.longTextAttachments,
              metadataModel,
            })
            if (!userPersistence.authoritative) {
              safeEmit({ type: "finish" })
              safeComplete()
              return
            }
            const { messagesForStream } = userPersistence

            let mcpSnapshot: CodexMcpSnapshot = createEmptyCodexMcpSnapshot({
              toolsResolved: false,
            })
            try {
              mcpSnapshot = await resolveCodexMcpSnapshotForDesktopRun({
                projectPath: input.projectPath,
                runtimeCwd,
              })
            } catch (mcpError) {
              const message = extractCodexError(mcpError).message
              const blocker = createCodexRuntimeBlocker({
                id: "mcp",
                label: "Codex MCP configuration",
                status: "failed",
                ok: false,
                message: `Codex MCP configuration failed: ${message}`,
                hint: "Fix Codex MCP configuration or disable the failing MCP server.",
              })
              console.error("[codex] Failed to resolve MCP servers:", message)
              emitPreflightBlocker(
                {
                  id: "mcp",
                  status: "blocked",
                  message: blocker.message,
                  hint: blocker.hint,
                },
                [
                  buildCodexRuntimeStatusChunk(blocker),
                  buildCodexCapabilityErrorChunk(blocker),
                ],
              )
              return
            }

            const needsAuthMcpServer = mcpSnapshot.groups
              .flatMap((group) => group.mcpServers)
              .find(
                (server) => server.needsAuth || server.status === "needs-auth",
              )
            if (needsAuthMcpServer) {
              const blocker = createCodexRuntimeBlocker({
                id: "mcp",
                label: "Codex MCP auth",
                status: "needs-auth",
                ok: false,
                message: `Codex MCP server '${needsAuthMcpServer.name}' needs authentication.`,
                hint: "Authenticate the MCP server before starting this Codex run.",
              })
              emitPreflightBlocker(
                {
                  id: "mcp",
                  status: "needs-auth",
                  message: blocker.message,
                  hint: blocker.hint,
                },
                [
                  buildCodexRuntimeStatusChunk(blocker),
                  buildCodexCapabilityErrorChunk(blocker),
                ],
              )
              return
            }

            if (
              getActiveCodexStream(input.subChatId) !== activeStreamOwner ||
              abortController.signal.aborted
            ) {
              safeEmit({ type: "finish" })
              safeComplete()
              return
            }

            const desktopJob = createAndRegisterCodexDesktopRunJob({
              db,
              state: desktopRunState,
              mode: input.mode,
              chatId: input.chatId,
              subChatId: input.subChatId,
              cwd: runtimeCwd,
              prompt: input.prompt,
              runId: input.runId,
              activeStreamOwner,
              permissionPolicy,
            })
            const desktopJobId = desktopJob.job.id

            const persistedCodexSessionId =
              getLastCodexSessionId(existingMessages) ?? null
            const desktopRunRequest = createCodexDesktopRunRequest({
              runId: input.runId,
              jobId: desktopJobId,
              mode: input.mode,
              preflight: verifiedRunContext,
              prompt: input.prompt,
              permissionPolicy,
              providerBinding: providerBindingResult.providerBinding,
              mcpServers: mcpSnapshot.mcpServersForSession,
              images: input.images,
              longTextAttachments: input.longTextAttachments,
              signal: abortController.signal,
              resumeSessionId: input.forceNewSession
                ? null
                : persistedCodexSessionId,
              parentSessionId: persistedCodexSessionId,
              emitTrace: (event) => {
                appendRunEventsToAgentJob(db, [event])
              },
            })

            await appServerFinishGate.runWithDeferredFinish(
              () =>
                runCodexAppServerDesktopAdapter({
                  request: desktopRunRequest,
                  providerGatewayToken: codexProviderProfile?.token ?? null,
                  appManagedApiKey: appManagedCodexApiKey,
                  secretHints: providerSecretHints(),
                  resolvedImages,
                  guardedContract,
                  isCurrentRunOwner: () =>
                    getActiveCodexStream(input.subChatId) ===
                      activeStreamOwner && !abortController.signal.aborted,
                  emit: safeEmit,
                  registerPendingQuestion: (approvalId, pending) => {
                    setCodexPendingToolApproval(approvalId, pending)
                  },
                  unregisterPendingQuestion: (approvalId, pending) => {
                    return deleteCodexPendingToolApproval(approvalId, pending)
                  },
                }),
              (adapterResult) => {
                desktopRunState.setAdapterFailed(
                  adapterResult.status === "failed",
                )
                if (desktopRunState.adapterFailed()) {
                  desktopRunState.markSawError()
                  const adapterAlreadyEmittedError =
                    appServerPersistenceChunks.some(
                      (chunk) => chunk?.type === "error",
                    )
                  const adapterAlreadyEmittedFinish =
                    appServerPersistenceChunks.some(
                      (chunk) => chunk?.type === "finish",
                    )
                  if (!adapterAlreadyEmittedError) {
                    safeEmit({
                      type: "error",
                      errorText:
                        adapterResult.error?.message ??
                        "Codex desktop adapter failed.",
                    })
                  }
                  if (!adapterAlreadyEmittedFinish) {
                    safeEmit({ type: "finish" })
                  }
                }
                desktopRunState.setReachedNaturalFinish(
                  adapterResult.status === "succeeded" &&
                    !desktopRunState.sawError(),
                )
                if (desktopRunState.reachedNaturalFinish()) {
                  persistCodexDesktopAssistantAfterNaturalFinish({
                    db,
                    subChatId: input.subChatId,
                    activeStreamOwner,
                    messagesForStream,
                    chunks: appServerPersistenceChunks,
                    model: metadataModel,
                  })
                }
              },
            )
            safeComplete()
          } catch (error) {
            const normalized = extractCodexError(error)
            const redactedDiagnostics = redactRendererRuntimeChunk({
              runtimeId: "codex",
              runId: input.runId,
              jobId: desktopRunState.getJobId(),
              chunk: {
                subChatId: input.subChatId.slice(-8),
                ...getCodexErrorDiagnostics(error),
                message: normalized.message,
              },
              secretHints: providerSecretHints(),
            })

            console.error("[codex] chat stream error", redactedDiagnostics)
            if (isCodexAuthError(normalized)) {
              safeEmit({ type: "auth-error", errorText: normalized.message })
            } else {
              safeEmit({ type: "error", errorText: normalized.message })
            }
            safeEmit({ type: "finish" })
            safeComplete()
          } finally {
            releaseDesktopRunAdmissionWithMaintenanceFence(runAdmission)
            try {
              if (ownsActiveStream) {
                finalizeCodexDesktopRunAfterLifecycle({
                  state: desktopRunState,
                  activeStreamOwner,
                  guardedContract,
                  chatId: input.chatId,
                  subChatId: input.subChatId,
                  runId: input.runId,
                  getFallbackDb: getDatabase,
                  revokeProviderBinding: providerBindingStage.revoke,
                  clearProviderSecrets: providerBindingStage.release,
                })
              } else {
                providerBindingStage.revoke()
                providerBindingStage.release()
              }
            } finally {
              if (runMaintenanceBlocker) {
                releaseChatMaintenanceRunBlocker(runMaintenanceBlocker)
                runMaintenanceBlocker = null
              }
            }
          }
        })()

        return () => {
          releaseDesktopRunAdmissionWithMaintenanceFence(runAdmission)
          if (!ownsActiveStream) {
            isActive = false
            abortController.abort()
            providerBindingStage.revoke()
            return
          }
          cleanupCodexDesktopRunSubscription({
            state: desktopRunState,
            activeStreamOwner,
            guardedContract,
            subChatId: input.subChatId,
            markInactive: () => {
              isActive = false
            },
            getFallbackDb: getDatabase,
            revokeProviderBinding: providerBindingStage.revoke,
          })
        }
      })
    }),

  respondToolApproval: publicProcedure
    .input(
      z.object({
        approvalId: z.string(),
        approved: z.boolean(),
        message: z.string().optional(),
        updatedInput: z.unknown().optional(),
      }),
    )
    .mutation(({ input }) => {
      return {
        ok: resolveCodexPendingToolApproval({
          approvalId: input.approvalId,
          decision: {
            approved: input.approved,
            message: input.message,
            updatedInput: input.updatedInput,
          },
        }),
      }
    }),
})
