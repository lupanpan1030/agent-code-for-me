import { z } from "zod"
import {
  createMcpRegistryService,
  type McpRegistryService,
} from "../../mcp-registry/service"
import { assertMcpEnvName } from "../../runtime-mcp-config/input-validation"
import { publicProcedure, router } from "../index"

const optionalTrimmedStringSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}, z.string().min(1).optional())

const registryListInputSchema = z
  .object({
    cursor: optionalTrimmedStringSchema,
    limit: z.number().int().min(1).max(100).optional(),
    search: optionalTrimmedStringSchema,
    updatedSince: optionalTrimmedStringSchema,
    version: optionalTrimmedStringSchema,
    includeDeleted: z.boolean().optional(),
  })
  .optional()

const registryDetailInputSchema = z.object({
  serverName: z.string().trim().min(1),
  version: optionalTrimmedStringSchema,
  includeDeleted: z.boolean().optional(),
})

const registryPreviewInstallInputSchema = registryDetailInputSchema.extend({
  targetId: z.string().trim().min(1),
})

function zodMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid input"
}

const trimmedNoNullStringSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.includes("\0"), {
    message: "Value must not contain null bytes",
  })

const setupKeySchema = z.string().refine((value) => !value.includes("\0"), {
  message: "Setup key must not contain null bytes",
})

const envNameSchema = z.string().superRefine((value, ctx) => {
  try {
    assertMcpEnvName(value, "MCP registry env var")
  } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: zodMessage(error) })
  }
})

const registrySetupValueSchema = z.union([
  z.boolean(),
  trimmedNoNullStringSchema,
  z.object({
    value: trimmedNoNullStringSchema.optional(),
    envVar: envNameSchema.optional(),
  }),
])

const registrySetupResolutionSchema = z
  .object({
    env: z.record(setupKeySchema, registrySetupValueSchema).optional(),
    headers: z.record(setupKeySchema, registrySetupValueSchema).optional(),
    variables: z.record(setupKeySchema, registrySetupValueSchema).optional(),
    bearerTokenEnvRefs: z
      .record(setupKeySchema, envNameSchema.optional())
      .optional(),
    localDependencies: z.record(z.string(), z.boolean()).optional(),
    oauthAuthenticated: z.boolean().optional(),
    runtimeAuthenticated: z.boolean().optional(),
  })
  .optional()

const registryInstallInputSchema = registryPreviewInstallInputSchema.extend({
  runtime: z.enum(["claude-code", "codex"]),
  scope: z.enum(["global", "project"]),
  projectPath: optionalTrimmedStringSchema,
  installName: optionalTrimmedStringSchema,
  resolvedSetup: registrySetupResolutionSchema,
})

const registryCheckInstalledInputSchema = z.object({
  runtime: z.enum(["claude-code", "codex"]),
  serverName: z.string().trim().min(1),
  scope: z.enum(["global", "project"]),
  projectPath: optionalTrimmedStringSchema,
})

export type McpRegistryRouterDeps = {
  checkInstalled?: (input: {
    runtime: "claude-code" | "codex"
    serverName: string
    scope: "global" | "project"
    projectPath?: string
  }) => Promise<{
    success: boolean
    runtime: "claude-code" | "codex"
    serverName: string
    status:
      | "ready-to-verify"
      | "connected-unverified"
      | "installed-unverified"
      | "failed-check"
    toolCount: number
    toolNames: string[]
    reason?: string
  }>
}

export function createMcpRegistryRouter(
  service: McpRegistryService = createMcpRegistryService(),
  deps: McpRegistryRouterDeps = {},
) {
  const checkInstalled =
    deps.checkInstalled ??
    (async (input) => {
      if (input.runtime === "codex") {
        const { checkCodexMcpRegistryServer } = await import(
          "../../runtime-mcp-config/codex"
        )
        return checkCodexMcpRegistryServer({
          runtime: "codex",
          serverName: input.serverName,
          scope: input.scope,
          ...(input.projectPath ? { projectPath: input.projectPath } : {}),
        })
      }
      const { checkClaudeMcpRegistryServer } = await import(
        "../../runtime-mcp-config/claude"
      )
      return checkClaudeMcpRegistryServer(input)
    })

  return router({
    list: publicProcedure
      .input(registryListInputSchema)
      .query(async ({ input }) => {
        if (input?.search) {
          return service.searchEntries({
            ...input,
            search: input.search,
          })
        }
        return service.listEntries(input)
      }),

    detail: publicProcedure
      .input(registryDetailInputSchema)
      .query(async ({ input }) => {
        return service.getEntryDetail(input)
      }),

    previewInstall: publicProcedure
      .input(registryPreviewInstallInputSchema)
      .query(async ({ input }) => {
        return service.previewEntryInstall(input)
      }),

    install: publicProcedure
      .input(registryInstallInputSchema)
      .mutation(async ({ input }) => {
        return service.installEntry(input)
      }),

    checkInstalled: publicProcedure
      .input(registryCheckInstalledInputSchema)
      .mutation(async ({ input }) => {
        return checkInstalled(input)
      }),
  })
}

export const mcpRegistryRouter = createMcpRegistryRouter()
