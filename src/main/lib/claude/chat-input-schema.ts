import { z } from "zod"
import { isSafeProviderModel } from "../../../shared/local-job-api"
import { agentScopeContractInputSchema } from "../agent-guard"

export const imageAttachmentSchema = z.object({
  base64Data: z.string().optional(),
  localRef: z.string().optional(),
  attachmentId: z.string().optional(),
  mediaType: z.string(),
  filename: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  sha256: z.string().optional(),
})

export type ImageAttachment = z.infer<typeof imageAttachmentSchema>

export const longTextAttachmentSchema = z.object({
  type: z.literal("long-text-attachment").optional(),
  attachmentId: z.string(),
  localRef: z.string(),
  filename: z.string(),
  byteLength: z.number().int().nonnegative(),
  preview: z.string().optional(),
  kind: z.enum(["pasted", "chatHistory"]),
})

export type LongTextAttachment = z.infer<typeof longTextAttachmentSchema>

export const claudeChatInputSchema = z
  .object({
    subChatId: z.string(),
    chatId: z.string(),
    runId: z.string().optional(),
    prompt: z.string(),
    cwd: z.string().optional(),
    projectPath: z.string().optional(),
    mode: z.enum(["plan", "agent"]).default("agent"),
    sessionId: z.string().optional(),
    model: z.string().optional(),
    modelSource: z.string().optional(),
    maxThinkingTokens: z.number().optional(),
    images: z.array(imageAttachmentSchema).optional(),
    longTextAttachments: z.array(longTextAttachmentSchema).optional(),
    historyEnabled: z.boolean().optional(),
    offlineModeEnabled: z.boolean().optional(),
    enableTasks: z.boolean().optional(),
    scopeContract: agentScopeContractInputSchema.optional(),
  })
  .superRefine((input, ctx) => {
    const isFirstPartyModelSource =
      !input.offlineModeEnabled &&
      (input.modelSource === undefined ||
        input.modelSource === "auto" ||
        input.modelSource === "claude-oauth")
    if (
      isFirstPartyModelSource &&
      input.model !== undefined &&
      !isSafeProviderModel(input.model)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["model"],
        message: "Invalid first-party Claude model id",
      })
    }
  })
