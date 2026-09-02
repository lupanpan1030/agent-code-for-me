import { useAtom } from "jotai"
import { useEffect } from "react"
import {
  type ChatImageAttachmentPart,
  isSupportedChatImageMediaType,
} from "../../../../shared/chat-attachments"
import type { ChatEngineId } from "../../../../shared/chat-engine-id"
import type { ChatSessionBinding } from "../../../../shared/chat-session-binding"
import type { LongTextAttachmentPart } from "../../../../shared/long-text-attachments"
import { pendingAuthRetryMessageAtom } from "../atoms"
import { pendingAuthRetryMatchesBinding } from "../lib/auth-retry-binding"

type AuthRetryPart =
  | { type: "text"; text: string }
  | { type: "data-image"; data: unknown }
  | ChatImageAttachmentPart
  | LongTextAttachmentPart

type SendAuthRetryMessage = (
  message: {
    role: "user"
    parts: AuthRetryPart[]
  },
  expectedBindingIdentity: string,
) => Promise<boolean> | boolean

export function useAuthRetry({
  subChatId,
  provider,
  binding,
  isStreaming,
  sendMessage,
}: {
  subChatId: string
  provider: ChatEngineId
  binding: ChatSessionBinding
  isStreaming: boolean
  sendMessage: SendAuthRetryMessage
}) {
  const [pendingAuthRetry, setPendingAuthRetry] = useAtom(
    pendingAuthRetryMessageAtom,
  )

  useEffect(() => {
    if (
      !pendingAuthRetry ||
      pendingAuthRetry.subChatId !== subChatId ||
      pendingAuthRetry.provider !== provider
    ) {
      return
    }

    if (!pendingAuthRetryMatchesBinding(pendingAuthRetry, binding)) {
      setPendingAuthRetry(null)
      return
    }

    if (!pendingAuthRetry.readyToRetry || isStreaming) return

    setPendingAuthRetry(null)

    const parts: AuthRetryPart[] = [
      { type: "text", text: pendingAuthRetry.prompt },
    ]

    for (const img of pendingAuthRetry.images ?? []) {
      if (img.localRef && isSupportedChatImageMediaType(img.mediaType)) {
        parts.push({
          type: "attachment-image",
          attachmentId: img.attachmentId || img.localRef,
          localRef: img.localRef,
          filename: img.filename || "image",
          mediaType: img.mediaType,
          sizeBytes: img.sizeBytes || 0,
          width: img.width,
          height: img.height,
          sha256: img.sha256,
        })
      } else {
        parts.push({
          type: "data-image",
          data: {
            base64Data: img.base64Data,
            mediaType: img.mediaType,
            filename: img.filename,
          },
        })
      }
    }

    for (const attachment of pendingAuthRetry.longTextAttachments ?? []) {
      parts.push(attachment)
    }

    void Promise.resolve(
      sendMessage(
        {
          role: "user",
          parts,
        },
        pendingAuthRetry.bindingIdentity,
      ),
    ).catch((error) => {
      console.error(
        "[useAuthRetry] Failed to retry authenticated message",
        error,
      )
    })
  }, [
    pendingAuthRetry,
    provider,
    binding,
    isStreaming,
    sendMessage,
    setPendingAuthRetry,
    subChatId,
  ])
}
