import { z } from "zod"
import { testProviderProfile } from "../../provider-profiles/gateway"
import { PROVIDER_PROFILE_PRESETS } from "../../provider-profiles/presets"
import {
  deleteProviderProfile,
  getProviderDefaults,
  getProviderProfileRuntimeConfig,
  listProviderProfiles,
  providerProfileAuthModeSchema,
  providerProfileCapabilitiesSchema,
  providerProfileDefaultPurposeSchema,
  providerProfileProtocolSchema,
  providerProfileTargetSchema,
  saveProviderProfile,
  setProviderDefault,
} from "../../provider-profiles/storage"
import { normalizeProviderBaseUrl } from "../../provider-token"
import { publicProcedure, router } from "../index"

const headersSchema = z.record(z.string(), z.string()).default({})

function zodMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid input"
}

const providerBaseUrlInputSchema = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    try {
      normalizeProviderBaseUrl(value)
    } catch (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: zodMessage(error) })
    }
  })

const saveInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  presetId: z.string().nullable().optional(),
  protocol: providerProfileProtocolSchema,
  baseUrl: providerBaseUrlInputSchema,
  defaultModel: z.string().min(1),
  authMode: providerProfileAuthModeSchema,
  token: z.string().optional(),
  headers: headersSchema.optional(),
  targetRuntimes: z.array(providerProfileTargetSchema).min(1),
  capabilities: providerProfileCapabilitiesSchema.optional(),
})

export const providerProfilesRouter = router({
  listPresets: publicProcedure.query(() => ({
    presets: PROVIDER_PROFILE_PRESETS,
  })),

  listProfiles: publicProcedure.query(() => ({
    profiles: listProviderProfiles(),
  })),

  getDefaults: publicProcedure.query(() => ({
    defaults: getProviderDefaults(),
  })),

  saveProfile: publicProcedure.input(saveInputSchema).mutation(({ input }) => ({
    profile: saveProviderProfile(input),
  })),

  deleteProfile: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ input }) => {
      deleteProviderProfile(input.id)
      return { success: true }
    }),

  setDefault: publicProcedure
    .input(
      z.object({
        purpose: providerProfileDefaultPurposeSchema,
        profileId: z.string().nullable(),
        modelOverride: z.string().nullable().optional(),
      }),
    )
    .mutation(({ input }) => {
      setProviderDefault(input)
      return { defaults: getProviderDefaults() }
    }),

  testProfile: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const profile = getProviderProfileRuntimeConfig(input.id)
      if (!profile) {
        throw new Error("Provider profile not found")
      }
      const status = await testProviderProfile(profile)
      return { status }
    }),
})
