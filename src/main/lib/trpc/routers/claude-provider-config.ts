import { z } from "zod"
import {
  type ClaudeProviderAuthMode,
  type ClaudeProviderRuntimeConfig,
  claudeProviderAuthModeSchema,
  clearClaudeProviderConfig,
  getClaudeProviderConfigMetadata,
  importLegacyClaudeProviderConfig,
  saveClaudeProviderConfig,
} from "../../claude/provider-config-store"
import { normalizeProviderBaseUrl } from "../../provider-token"
import { publicProcedure, router } from "../index"

export type { ClaudeProviderAuthMode, ClaudeProviderRuntimeConfig }
export { claudeProviderAuthModeSchema }

const saveInputSchema = z.object({
  model: z.string().min(1),
  baseUrl: z
    .string()
    .min(1)
    .superRefine((value, ctx) => {
      try {
        normalizeProviderBaseUrl(value)
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: error instanceof Error ? error.message : "Invalid input",
        })
      }
    }),
  authMode: claudeProviderAuthModeSchema,
  token: z.string().optional(),
})

export const claudeProviderConfigRouter = router({
  get: publicProcedure.query(() => getClaudeProviderConfigMetadata()),

  save: publicProcedure
    .input(saveInputSchema)
    .mutation(({ input }) => saveClaudeProviderConfig(input)),

  clear: publicProcedure.mutation(() => clearClaudeProviderConfig()),

  importLegacy: publicProcedure
    .input(saveInputSchema.extend({ token: z.string().min(1) }))
    .mutation(({ input }) => importLegacyClaudeProviderConfig(input)),
})
