import { z } from "zod"
import { CHAT_SESSION_BINDING_RUNTIMES } from "../../../shared/chat-session-binding"

export const chatSessionBindingInputSchema = z.object({
  runtime: z.enum(CHAT_SESSION_BINDING_RUNTIMES),
  providerProfileId: z.string().nullable().optional(),
  modelId: z.string().nullable().optional(),
  modelSource: z.string().nullable().optional(),
  thinkingLevel: z.string().nullable().optional(),
})

export const chatSessionBindingPatchSchema =
  chatSessionBindingInputSchema.partial()
