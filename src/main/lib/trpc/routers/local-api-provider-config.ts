import { eq } from "drizzle-orm"
import { z } from "zod"
import { getDatabase, localApiProviderConfigs } from "../../db"
import {
  getLocalApiProviderTokenRequirement,
  getStoredProviderRow,
  localApiProviderPurposeSchema,
  rowToMetadata,
} from "../../local-api-provider-config"
import {
  encryptProviderToken,
  normalizeProviderBaseUrl,
  normalizeProviderToken,
} from "../../provider-token"
import { isSecureStorageAvailable } from "../../secure-storage"
import { publicProcedure, router } from "../index"

const providerPurposeInputSchema = z.object({
  purpose: localApiProviderPurposeSchema,
})

const saveInputSchema = providerPurposeInputSchema.extend({
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
  token: z.string().optional(),
})

export const localApiProviderConfigRouter = router({
  get: publicProcedure.input(providerPurposeInputSchema).query(({ input }) => {
    const row = getStoredProviderRow(input.purpose)

    return {
      config: row ? rowToMetadata(row) : null,
      encryptionAvailable:
        Boolean(row?.encryptedToken) && isSecureStorageAvailable(),
    }
  }),

  save: publicProcedure.input(saveInputSchema).mutation(({ input }) => {
    const model = input.model.trim()
    const baseUrl = normalizeProviderBaseUrl(input.baseUrl)
    const token = input.token ? normalizeProviderToken(input.token) : undefined
    const existing = getStoredProviderRow(input.purpose)

    if (!model || !baseUrl) {
      throw new Error("Model and base URL are required")
    }

    const tokenRequirement = getLocalApiProviderTokenRequirement({
      baseUrl,
      token,
      existingEncryptedToken: existing?.encryptedToken,
      existingBaseUrl: existing?.baseUrl,
    })

    if (tokenRequirement !== "none") {
      throw new Error(
        tokenRequirement === "destination_changed"
          ? "Token is required when changing provider endpoint"
          : "Token is required for a new provider config",
      )
    }

    const encryptedToken = token
      ? encryptProviderToken(token)
      : existing?.encryptedToken

    if (!encryptedToken) {
      throw new Error("Token is required for a new provider config")
    }

    const db = getDatabase()
    db.insert(localApiProviderConfigs)
      .values({
        id: input.purpose,
        model,
        baseUrl,
        encryptedToken,
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: localApiProviderConfigs.id,
        set: {
          model,
          baseUrl,
          encryptedToken,
          updatedAt: new Date(),
        },
      })
      .run()

    const row = getStoredProviderRow(input.purpose)
    return {
      config: row ? rowToMetadata(row) : null,
      encryptionAvailable: isSecureStorageAvailable(),
    }
  }),

  clear: publicProcedure
    .input(providerPurposeInputSchema)
    .mutation(({ input }) => {
      const db = getDatabase()
      db.delete(localApiProviderConfigs)
        .where(eq(localApiProviderConfigs.id, input.purpose))
        .run()

      return { success: true }
    }),
})
