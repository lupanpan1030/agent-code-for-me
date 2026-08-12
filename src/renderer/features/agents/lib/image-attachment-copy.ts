import type { ChatImageAttachmentBlockReason } from "../../../../shared/chat-attachment-capabilities"

export type ImageAttachmentBlockDescriptionKey =
  | "agent.attachments.imagesUnsupportedOffline"
  | "agent.attachments.imagesUnsupportedModel"

export function imageAttachmentBlockDescriptionKey(
  reason: ChatImageAttachmentBlockReason | undefined,
): ImageAttachmentBlockDescriptionKey {
  if (reason === "offline") {
    return "agent.attachments.imagesUnsupportedOffline"
  }
  return "agent.attachments.imagesUnsupportedModel"
}
