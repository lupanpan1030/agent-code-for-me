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
  type ValidatedAgentScopeContract,
  validateAgentScopeContract,
} from "../../agent-guard"
import { resolveDesktopPermissionPolicy } from "../../agent-runtime/permission-policy"
import { verifyDesktopRunPreflight } from "../../agent-runtime/preflight"
import {
  appendRunEventsToAgentJob,
  redactRendererRuntimeChunk,
} from "../../agent-runtime/stream-event-mapper"
import { prepareChatImageAttachmentsForDesktopRun } from "../../chat-attachments"
import {
  deleteActiveCodexStreamIfRun,
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
import { createCodexAppServerAdapter } from "../../codex/app-server-adapter"
import { createCodexAppServerFinishGate } from "../../codex/app-server-finish-gate"
import { resolveCodexAppServerPluginConfigOverrides } from "../../codex/app-server-plugin-allowlist"
import { getLastCodexSessionId } from "../../codex/chat-history"
import { codexChatInputSchema } from "../../codex/chat-input-schema"
import { resolveBundledCodexCliPath } from "../../codex/cli-path"
import { runCodexCli } from "../../codex/cli-runner"
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
  clearPendingCodexApprovals,
  deleteCodexPendingToolApproval,
  resolveCodexPendingToolApproval,
  setCodexPendingToolApproval,
} from "../../codex/tool-approvals"
import { getDatabase } from "../../db"
import {
  completeDesktopChatAgentJobSafely,
  createAndRegisterDesktopChatAgentJob,
  requestCancelDesktopChatAgentJobSafely,
} from "../../desktop-agent-jobs"
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
  normalizeMcpArgs,
  normalizeMcpServerUrl,
} from "../../runtime-mcp-config/input-validation"
import { publicProcedure, router } from "../index"

function zodMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid input"
}

const mcpStringInputSchema = z
  .string()
  .refine((value) => !value.includes("\0"), {
    message: "Value must not contain null bytes",
  })

const mcpArgsInputSchema = z
  .array(mcpStringInputSchema)
  .superRefine((value, ctx) => {
    try {
      normalizeMcpArgs(value)
    } catch (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: zodMessage(error) })
    }
  })

const mcpUrlInputSchema = z.string().superRefine((value, ctx) => {
  try {
    normalizeMcpServerUrl(value)
  } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: zodMessage(error) })
  }
})

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
        const existingStream = getActiveCodexStream(input.subChatId)
        if (existingStream) {
          existingStream.cancelRequested = true
          existingStream.controller.abort()
        }

        const abortController = new AbortController()
        setActiveCodexStream(input.subChatId, {
          runId: input.runId,
          controller: abortController,
          cancelRequested: false,
        })

        let isActive = true
        let desktopJobId: string | null = null
        let desktopJobSawError = false
        let desktopJobReachedNaturalFinish = false
        let desktopJobAdapterFailed = false
        let desktopJobDb: ReturnType<typeof getDatabase> | null = null
        const appServerPersistenceChunks: Record<string, unknown>[] = []
        const providerBindingStage = createCodexDesktopRunProviderBindingStage()
        const providerSecretHints = providerBindingStage.getSecretHints

        const emitRendererChunk = (chunk: Record<string, unknown>) => {
          if (!isActive) return
          try {
            const rendererChunk = redactRendererRuntimeChunk({
              runtimeId: "codex",
              runId: input.runId,
              jobId: desktopJobId,
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
            jobId: desktopJobId,
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
            desktopJobSawError = true
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
            const db = getDatabase()
            desktopJobDb = db
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

            const existingMessages = loadCodexDesktopRunHistory({
              db,
              subChatId: input.subChatId,
            })
            const codexProviderProfileMetadata = input.providerProfileId
              ? getProviderProfileMetadata(input.providerProfileId)
              : null
            const imageCapability = getChatImageAttachmentCapability({
              provider: "codex",
              modelVision: resolveChatImageModelVision({
                provider: "codex",
                providerProfileId: input.providerProfileId,
                getProviderProfileMetadata: (id) =>
                  id === input.providerProfileId
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
              providerProfileId: input.providerProfileId,
              codexAuthMethod: input.codexAuthMethod,
              requestedModel: input.model,
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

            const { messagesForStream } = persistCodexDesktopRunUserMessage({
              db,
              subChatId: input.subChatId,
              existingMessages,
              prompt: input.prompt,
              images: input.images,
              longTextAttachments: input.longTextAttachments,
              metadataModel,
            })

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

            const desktopJob = createAndRegisterDesktopChatAgentJob(db, {
              runtime: "codex",
              mode: input.mode,
              chatId: input.chatId,
              subChatId: input.subChatId,
              cwd: runtimeCwd,
              prompt: input.prompt,
              runId: input.runId,
              permissionPolicy,
              cancel: () => {
                const activeStream = getActiveCodexStream(input.subChatId)
                if (activeStream?.runId !== input.runId) return
                activeStream.cancelRequested = true
                activeStream.controller.abort()
                clearPendingCodexApprovals(
                  "Session cancelled.",
                  input.subChatId,
                )
              },
            })
            desktopJobId = desktopJob.job.id

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
                : (input.sessionId ??
                  getLastCodexSessionId(existingMessages) ??
                  null),
              parentSessionId: input.sessionId ?? null,
              emitTrace: (event) => {
                appendRunEventsToAgentJob(db, [event])
              },
            })

            const appServerPluginConfig =
              await resolveCodexAppServerPluginConfigOverrides({
                projectId: desktopRunRequest.context.projectId,
                chatId: desktopRunRequest.context.chatId,
                subChatId: desktopRunRequest.context.subChatId,
              })

            const codexAdapter = createCodexAppServerAdapter({
              enabled: true,
              experimentalApi:
                process.env.LOCUS_CODEX_APP_SERVER_EXPERIMENTAL_API === "1" ||
                process.env.LOCUS_CODEX_APP_SERVER_CONTROLLED_EDIT_EXECUTOR ===
                  "1",
              // Smoke-only diagnostic hook for the 6.8 apply_patch
              // enablement probe. Product app-server runs leave this
              // unset unless a developer explicitly opts into the env gate.
              configOverrides:
                process.env.LOCUS_CODEX_APP_SERVER_APPLY_PATCH_EXPERIMENT ===
                "1"
                  ? {
                      "features.apply_patch_freeform": true,
                      "features.apply_patch_streaming_events": true,
                      include_apply_patch_tool: true,
                      "tools.apply_patch.enabled": true,
                      "tools.apply_patch.approval_mode": "prompt",
                      "model_providers.locus_profile.apply_patch_tool_type":
                        "freeform",
                      "model_providers.locus_profile.experimental_supported_tools":
                        ["apply_patch"],
                    }
                  : undefined,
              providerGatewayToken: codexProviderProfile?.token ?? null,
              secretHints: providerSecretHints(),
              appManagedApiKey: codexProviderProfile
                ? null
                : appManagedCodexApiKey,
              pluginConfig: appServerPluginConfig,
              controlledEditEnabled:
                process.env.LOCUS_CODEX_APP_SERVER_CONTROLLED_EDIT_EXECUTOR ===
                "1",
              resolvedImages,
              guardedContract,
              emit: safeEmit,
              registerPendingQuestion: (toolUseId, pending) => {
                setCodexPendingToolApproval(toolUseId, pending)
              },
              unregisterPendingQuestion: (toolUseId) => {
                deleteCodexPendingToolApproval(toolUseId)
              },
            })

            await appServerFinishGate.runWithDeferredFinish(
              () => codexAdapter.run(desktopRunRequest),
              (adapterResult) => {
                desktopJobAdapterFailed = adapterResult.status === "failed"
                if (desktopJobAdapterFailed) {
                  desktopJobSawError = true
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
                desktopJobReachedNaturalFinish =
                  adapterResult.status === "succeeded" && !desktopJobSawError
                if (desktopJobReachedNaturalFinish) {
                  persistCodexDesktopAssistantAfterNaturalFinish({
                    db,
                    subChatId: input.subChatId,
                    runId: input.runId,
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
              jobId: desktopJobId,
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
            providerBindingStage.revoke()
            if (desktopJobId) {
              const jobDb = desktopJobDb ?? getDatabase()
              completeDesktopChatAgentJobSafely(jobDb, {
                jobId: desktopJobId,
                runtime: "codex",
                aborted:
                  abortController.signal.aborted && !desktopJobAdapterFailed,
                reachedNaturalFinish: desktopJobReachedNaturalFinish,
                sawError: desktopJobSawError || desktopJobAdapterFailed,
                result: {
                  runtime: "codex",
                  subChatId: input.subChatId,
                  chatId: input.chatId,
                  runId: input.runId,
                },
              })
            }
            if (deleteActiveCodexStreamIfRun(input.subChatId, input.runId)) {
              clearPendingCodexApprovals("Session cancelled.", input.subChatId)
            }
            providerBindingStage.release()
          }
        })()

        return () => {
          isActive = false
          requestCancelDesktopChatAgentJobSafely(
            desktopJobDb ?? getDatabase(),
            {
              jobId: desktopJobId,
              sawError: desktopJobSawError,
              reachedNaturalFinish: desktopJobReachedNaturalFinish,
              requestedBy: "desktop-chat",
            },
          )
          abortController.abort()
          providerBindingStage.revoke()

          const activeStream = getActiveCodexStream(input.subChatId)
          if (activeStream?.runId === input.runId) {
            activeStream.cancelRequested = true
          }
        }
      })
    }),

  cancel: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        runId: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const activeStream = getActiveCodexStream(input.subChatId)
      if (!activeStream) {
        return { cancelled: false, ignoredStale: false }
      }

      if (activeStream.runId !== input.runId) {
        return { cancelled: false, ignoredStale: true }
      }

      activeStream.cancelRequested = true
      activeStream.controller.abort()
      clearPendingCodexApprovals("Session cancelled.", input.subChatId)

      return { cancelled: true, ignoredStale: false }
    }),

  respondToolApproval: publicProcedure
    .input(
      z.object({
        toolUseId: z.string(),
        approved: z.boolean(),
        message: z.string().optional(),
        updatedInput: z.unknown().optional(),
      }),
    )
    .mutation(({ input }) => {
      return {
        ok: resolveCodexPendingToolApproval({
          toolUseId: input.toolUseId,
          decision: {
            approved: input.approved,
            message: input.message,
            updatedInput: input.updatedInput,
          },
        }),
      }
    }),

  cleanup: publicProcedure
    .input(z.object({ subChatId: z.string() }))
    .mutation(({ input }) => {
      const activeStream = getActiveCodexStream(input.subChatId)
      if (activeStream) {
        activeStream.controller.abort()
        clearPendingCodexApprovals("Session cancelled.", input.subChatId)
        deleteActiveCodexStreamIfRun(input.subChatId, activeStream.runId)
      }

      return { success: true }
    }),
})
