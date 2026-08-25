import { observable } from "@trpc/server/observable"
import { z } from "zod"
import {
  getChatImageAttachmentCapability,
  resolveChatImageModelVision,
} from "../../../../shared/chat-attachment-capabilities"
import type {
  GuardedGitStatusSnapshot,
  ValidatedAgentScopeContract,
} from "../../agent-guard"
import { resolveDesktopRunCwdFromDb } from "../../agent-runtime/preflight"
import {
  desktopScopeExpansionResponseInputSchema,
  respondDesktopScopeExpansion,
} from "../../agent-runtime/scope-expansion"
import type { UIMessageChunk } from "../../claude"
import { hasActiveClaudeSession } from "../../claude/active-sessions"
import {
  abortClaudeAgentSdkDesktopRunRequest,
  cancelClaudeAgentSdkActiveDesktopRun,
  cleanupClaudeAgentSdkDesktopRunSubscription,
} from "../../claude/agent-sdk-desktop-run-cleanup"
import { prepareClaudeAgentSdkDesktopRunControls } from "../../claude/agent-sdk-desktop-run-controls"
import { createClaudeAgentSdkDesktopRunEnvelope } from "../../claude/agent-sdk-desktop-run-envelope"
import { prepareClaudeAgentSdkDesktopRunInputs } from "../../claude/agent-sdk-desktop-run-inputs"
import { runClaudeAgentSdkDesktopRuntimeWithMcpReadiness } from "../../claude/agent-sdk-desktop-run-runtime"
import { prepareClaudeAgentSdkDesktopRunStartup } from "../../claude/agent-sdk-desktop-run-startup"
import { superviseClaudeAgentSdkDesktopRun } from "../../claude/agent-sdk-desktop-run-supervision"
import { claudeChatInputSchema } from "../../claude/chat-input-schema"
import { resolveClaudePendingToolApproval } from "../../claude/tool-approvals"
import { getDatabase } from "../../db"
import { getProviderProfileMetadata } from "../../provider-profiles/storage"
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
  normalizeMcpArgs,
  normalizeMcpEnv,
  normalizeMcpServerUrl,
} from "../../runtime-mcp-config/input-validation"
import { publicProcedure, router } from "../index"

export { clearClaudeCaches, getAllMcpConfigHandler }

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

const mcpEnvInputSchema = z
  .record(z.string(), z.string())
  .superRefine((value, ctx) => {
    try {
      normalizeMcpEnv(value)
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

export const claudeRouter = router({
  /**
   * Stream chat with Claude - single subscription handles everything
   */
  chat: publicProcedure
    .input(claudeChatInputSchema)
    .subscription(({ input }) => {
      return observable<UIMessageChunk>((emit) => {
        const db = getDatabase()
        let runtimeSecretHints: readonly string[] = []
        let runtimeSecretsCleanup: (() => void) | null = null
        const cleanupRuntimeSecrets = () => {
          const cleanup = runtimeSecretsCleanup
          runtimeSecretsCleanup = null
          try {
            cleanup?.()
          } finally {
            runtimeSecretHints = []
          }
        }
        const resolvedInitialCwd = resolveDesktopRunCwdFromDb(db, {
          chatId: input.chatId,
          subChatId: input.subChatId,
        })
        const {
          abortController,
          streamId,
          activeRunId,
          subId,
          streamStart,
          streamState,
          desktopRunState,
          emit: safeEmit,
          complete: safeComplete,
          emitError,
          emitPreflightBlocker,
        } = createClaudeAgentSdkDesktopRunEnvelope({
          subChatId: input.subChatId,
          requestedRunId: input.runId,
          createId: () => crypto.randomUUID(),
          cwd: resolvedInitialCwd,
          mode: input.mode,
          emitNext: (chunk) => {
            emit.next(chunk)
          },
          emitComplete: () => {
            emit.complete()
          },
          getSecretHints: () => runtimeSecretHints,
        })

        let guardedContract: ValidatedAgentScopeContract | null = null
        let guardedPreRunStatus: GuardedGitStatusSnapshot | null = null

        void superviseClaudeAgentSdkDesktopRun({
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
          cleanupRuntimeSecrets,
          run: async () => {
            desktopRunState.setDb(db)
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
              emitError,
              emit: safeEmit,
              complete: safeComplete,
            })
            if (!runControls.ok) {
              return
            }
            const verifiedRunContext = runControls.preflight
            const runtimeCwd = runControls.runtimeCwd
            guardedContract = runControls.guardedContract
            guardedPreRunStatus = runControls.guardedPreRunStatus
            const permissionPolicy = runControls.permissionPolicy

            const imageCapability = getChatImageAttachmentCapability({
              provider: "claude-code",
              offlineModeEnabled: input.offlineModeEnabled ?? false,
              modelVision: resolveChatImageModelVision({
                provider: "claude-code",
                modelSource: input.modelSource,
                getProviderProfileMetadata,
              }),
            })
            const runInputs = await prepareClaudeAgentSdkDesktopRunInputs({
              db,
              subChatId: input.subChatId,
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
              return
            }
            const { historyEnabled, resolvedImages, chatHistory } = runInputs
            const {
              existingMessages,
              existingSessionId,
              resumeAtUuid,
              shouldForkResume,
              forkResumeAtUuid,
              messagesToSave,
            } = chatHistory

            const runStartup = await prepareClaudeAgentSdkDesktopRunStartup({
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
              requestedModel: input.model,
              modelSource: input.modelSource,
              offlineModeEnabled: input.offlineModeEnabled ?? false,
              enableTasks: input.enableTasks ?? true,
              images: input.images,
              longTextAttachments: input.longTextAttachments,
              signal: abortController.signal,
              requestedSessionId: input.sessionId,
              existingSessionId,
              emitPreflightBlocker,
              onRuntimeSecretsResolved: ({ secretHints, cleanup }) => {
                runtimeSecretHints = secretHints
                runtimeSecretsCleanup = cleanup
                if (abortController.signal.aborted) {
                  cleanupRuntimeSecrets()
                }
              },
              desktopRunState,
            })
            if (!runStartup.ok) {
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
                secretHints: runtimeSecretHints,
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

        // Cleanup on unsubscribe
        return () => {
          cleanupClaudeAgentSdkDesktopRunSubscription({
            subId,
            subChatId: input.subChatId,
            sessionId: streamState.currentSessionId,
            abortController,
            guardedContract,
            getDb: getDatabase,
            desktopRunState,
            cleanupRuntimeSecrets,
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
   * Cancel active session
   */
  cancel: publicProcedure
    .input(z.object({ subChatId: z.string(), runId: z.string().optional() }))
    .mutation(({ input }) => {
      return cancelClaudeAgentSdkActiveDesktopRun(input)
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
        toolUseId: z.string(),
        approved: z.boolean(),
        message: z.string().optional(),
        updatedInput: z.object({}).passthrough().optional(),
      }),
    )
    .mutation(({ input }) => {
      return {
        ok: resolveClaudePendingToolApproval({
          toolUseId: input.toolUseId,
          decision: {
            approved: input.approved,
            message: input.message,
            updatedInput: input.updatedInput,
          },
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
