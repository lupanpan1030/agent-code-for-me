import type { ChatTransport, UIMessage } from "ai"
import { toast } from "sonner"
import { normalizeChatImageAttachmentPart } from "../../../../shared/chat-attachments"
import type { ChatSessionBinding } from "../../../../shared/chat-session-binding"
import { normalizeCodexStreamChunk } from "../../../../shared/codex-tool-normalizer"
import {
  type LongTextAttachmentPart,
  normalizeLongTextAttachmentPart,
} from "../../../../shared/long-text-attachments"
import { codexLoginModalOpenAtom, sessionInfoAtom } from "../../../lib/atoms"
import { en, type TranslationKey, zhCN } from "../../../lib/i18n/dictionaries"
import { appStore } from "../../../lib/jotai-store"
import { trpcClient } from "../../../lib/trpc"
import {
  approvedGuardedRunContractsAtom,
  pendingAuthRetryMessageAtom,
} from "../atoms"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import {
  type AuthRetryTransportGeneration,
  isCurrentAuthRetryTransportGeneration,
  registerAuthRetryTransportGeneration,
  releaseAuthRetryTransportGeneration,
} from "./auth-retry-binding"
import {
  type AiSdkTransportChunk,
  type CodexTransportChunk,
  getCanonicalMessageParts,
  isDataImageMessagePart,
  isFileContentMessagePart,
  isTextMessagePart,
  toAiSdkTransportChunk,
} from "./chat-message-ui-adapter"
import { failCodexAuthErrorStream } from "./codex-auth-retry"
import { applyRuntimeEventStateChunk } from "./runtime-event-state"
import {
  composeCodexTransportModel,
  composeProviderProfileCodexTransportModel,
  resolveCodexAuthMethodForBindingSource,
  resolveCodexBoundCredentialState,
} from "./transport-model-selection"

function tr(key: TranslationKey, values?: Record<string, string | number>) {
  const useZh =
    typeof navigator !== "undefined" &&
    (navigator.language || navigator.languages?.[0] || "")
      .toLowerCase()
      .startsWith("zh")
  const template = (useZh ? zhCN[key] : en[key]) || en[key] || key

  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = values?.[name]
    return value === undefined ? match : String(value)
  })
}

type CodexAppServerChatTransportConfig = {
  chatId: string
  subChatId: string
  binding: ChatSessionBinding
  projectPath?: string
  mode: "plan" | "agent"
  provider: "codex"
}

type ImageAttachment = {
  base64Data?: string
  localRef?: string
  attachmentId?: string
  mediaType: string
  filename?: string
  sizeBytes?: number
  width?: number
  height?: number
  sha256?: string
}

// When a sub-chat hits auth-error, force one fresh Codex app-server session on next send.
const forceFreshSessionSubChats = new Set<string>()

async function getStoredCodexCredentials(): Promise<{
  hasApiKey: boolean
  hasSubscription: boolean
}> {
  // App-managed Codex API key is what "openai-api-key" runs use.
  let hasApiKey = false
  try {
    const status = await trpcClient.codex.getCodexApiKeyStatus.query()
    hasApiKey = Boolean(status.hasApiKey)
  } catch {
    hasApiKey = false
  }

  // Subscription state is owned by the Codex CLI login, not a stored flag.
  let hasSubscription = false
  try {
    const integration = await trpcClient.codex.getIntegration.query()
    hasSubscription = integration.state === "connected_chatgpt"
  } catch {
    hasSubscription = false
  }

  return {
    hasApiKey,
    hasSubscription,
  }
}

async function resolveCodexCredentialsForAuthError(): Promise<{
  hasApiKey: boolean
  hasSubscription: boolean
}> {
  const snapshot = await getStoredCodexCredentials()
  return {
    hasApiKey: snapshot.hasApiKey,
    hasSubscription: snapshot.hasSubscription,
  }
}

export class CodexAppServerChatTransport implements ChatTransport<UIMessage> {
  private readonly authRetryTransportGeneration: AuthRetryTransportGeneration
  private activeRunOwner: { unsubscribe: () => void } | null = null

  constructor(private config: CodexAppServerChatTransportConfig) {
    this.authRetryTransportGeneration = registerAuthRetryTransportGeneration(
      config.subChatId,
      config.binding,
    )
  }

  async sendMessages(options: {
    messages: UIMessage[]
    abortSignal?: AbortSignal
  }): Promise<ReadableStream<AiSdkTransportChunk>> {
    const lastUser = [...options.messages]
      .reverse()
      .find((message) => message.role === "user")

    const prompt = this.extractText(lastUser)
    const images = this.extractImages(lastUser)
    const longTextAttachments = this.extractLongTextAttachments(lastUser)

    const currentMode =
      useAgentSubChatStore
        .getState()
        .allSubChats.find((subChat) => subChat.id === this.config.subChatId)
        ?.mode || this.config.mode
    const forceNewSession = forceFreshSessionSubChats.has(this.config.subChatId)
    if (forceNewSession) {
      forceFreshSessionSubChats.delete(this.config.subChatId)
    }
    const selectedCodexModelSource =
      this.config.binding.modelSource ?? "chatgpt"
    const providerProfileId = this.config.binding.providerProfileId
    const codexAuthMethod = resolveCodexAuthMethodForBindingSource(
      selectedCodexModelSource,
    )
    const selectedModel = this.config.binding.modelId
      ? providerProfileId
        ? composeProviderProfileCodexTransportModel(this.config.binding.modelId)
        : composeCodexTransportModel(
            this.config.binding.modelId,
            this.config.binding.thinkingLevel,
          )
      : ""

    return new ReadableStream({
      start: (controller) => {
        const runId = crypto.randomUUID()
        let sub: { unsubscribe: () => void } | null = null
        let didUnsubscribe = false
        let lastRuntimeStatusError: string | null = null
        let runOwner: { unsubscribe: () => void } | null = null

        const safeUnsubscribe = () => {
          if (didUnsubscribe) return
          didUnsubscribe = true
          sub?.unsubscribe()
          if (runOwner && this.activeRunOwner === runOwner) {
            this.activeRunOwner = null
          }
        }
        const failAuthErrorStream = (error: Error) => {
          failCodexAuthErrorStream({
            error,
            errorStream: (streamError) => controller.error(streamError),
            unsubscribe: safeUnsubscribe,
          })
        }

        runOwner = { unsubscribe: safeUnsubscribe }
        const previousRunOwner = this.activeRunOwner
        this.activeRunOwner = runOwner
        previousRunOwner?.unsubscribe()

        sub = trpcClient.codex.chat.subscribe(
          {
            subChatId: this.config.subChatId,
            chatId: this.config.chatId,
            runId,
            prompt,
            ...(this.config.projectPath
              ? { projectPath: this.config.projectPath }
              : {}),
            ...(selectedModel ? { model: selectedModel } : {}),
            mode: currentMode,
            ...(forceNewSession ? { forceNewSession: true } : {}),
            ...(images.length > 0 ? { images } : {}),
            ...(longTextAttachments.length > 0 ? { longTextAttachments } : {}),
            ...(appStore
              .get(approvedGuardedRunContractsAtom)
              .get(this.config.subChatId)
              ? {
                  scopeContract: appStore
                    .get(approvedGuardedRunContractsAtom)
                    .get(this.config.subChatId),
                }
              : {}),
            ...(providerProfileId ? { providerProfileId } : {}),
            ...(providerProfileId ? {} : { codexAuthMethod }),
          },
          {
            onData: (chunk: CodexTransportChunk) => {
              if (chunk.type === "session-init") {
                appStore.set(sessionInfoAtom, {
                  tools: chunk.tools || [],
                  mcpServers: chunk.mcpServers || [],
                  plugins: chunk.plugins || [],
                  skills: chunk.skills || [],
                })
              }

              if (chunk.type === "auth-error") {
                forceFreshSessionSubChats.add(this.config.subChatId)

                if (providerProfileId) {
                  const error = new Error(
                    "Provider Profile authentication failed",
                  )
                  toast.error(tr("agent.transport.codexRequestFailed"), {
                    description: error.message,
                  })
                  failAuthErrorStream(error)
                  return
                }

                void (async () => {
                  const credentials =
                    await resolveCodexCredentialsForAuthError()
                  const boundCredential = resolveCodexBoundCredentialState(
                    selectedCodexModelSource,
                    credentials,
                  )
                  const shouldAutoRetryOnce =
                    boundCredential.hasBoundCredential && !forceNewSession

                  // Credential probes are asynchronous. A binding receipt can
                  // replace this same-id transport while they are pending; a
                  // retired transport must never resurrect its old prompt.
                  if (
                    !isCurrentAuthRetryTransportGeneration(
                      this.authRetryTransportGeneration,
                    )
                  ) {
                    return
                  }

                  appStore.set(pendingAuthRetryMessageAtom, {
                    subChatId: this.config.subChatId,
                    provider: "codex",
                    bindingIdentity:
                      this.authRetryTransportGeneration.bindingIdentity,
                    requiredCodexAuthMethod: codexAuthMethod,
                    prompt,
                    ...(images.length > 0 && { images }),
                    ...(longTextAttachments.length > 0 && {
                      longTextAttachments,
                    }),
                    readyToRetry: shouldAutoRetryOnce,
                  })

                  if (!boundCredential.hasBoundCredential) {
                    appStore.set(codexLoginModalOpenAtom, true)
                  } else if (!shouldAutoRetryOnce) {
                    toast.error(tr("agent.transport.codexAuthFailed"), {
                      description:
                        boundCredential.kind === "api-key"
                          ? tr("agent.transport.codexApiKeyRejected")
                          : tr("agent.transport.codexSubscriptionAuthFailed"),
                    })
                  }
                })()

                // Force stream status reset so retry can start once auth succeeds.
                failAuthErrorStream(new Error("Codex authentication required"))
                return
              }

              if (chunk.type === "error") {
                if (
                  !chunk.errorText ||
                  chunk.errorText !== lastRuntimeStatusError
                ) {
                  toast.error(tr("agent.transport.codexError"), {
                    description:
                      chunk.errorText ||
                      tr("agent.transport.unexpectedCodexError"),
                  })
                }
              }

              if (chunk.type === "runtime-status" && chunk.ok === false) {
                lastRuntimeStatusError = chunk.blocker?.message || null
                const description =
                  chunk.blocker?.hint && chunk.blocker?.message
                    ? `${chunk.blocker.message} ${chunk.blocker.hint}`
                    : chunk.blocker?.message ||
                      tr("agent.transport.unexpectedCodexError")
                toast.error(tr("agent.transport.codexError"), {
                  description,
                })
              }

              if (chunk.type === "capability-error") {
                lastRuntimeStatusError = chunk.errorText || null
                toast.error(tr("agent.transport.codexError"), {
                  description:
                    chunk.errorText ||
                    tr("agent.transport.unexpectedCodexError"),
                })
              }

              applyRuntimeEventStateChunk(
                {
                  subChatId: this.config.subChatId,
                  parentChatId: this.config.chatId,
                },
                chunk,
              )

              try {
                const normalizedChunk = normalizeCodexStreamChunk(chunk)
                controller.enqueue(toAiSdkTransportChunk(normalizedChunk))
              } catch {
                // Stream already closed
              }

              if (chunk.type === "finish") {
                const approvedContracts = appStore.get(
                  approvedGuardedRunContractsAtom,
                )
                if (approvedContracts.has(this.config.subChatId)) {
                  const nextContracts = new Map(approvedContracts)
                  nextContracts.delete(this.config.subChatId)
                  appStore.set(approvedGuardedRunContractsAtom, nextContracts)
                }
              }
            },
            onError: (error: Error) => {
              toast.error(tr("agent.transport.codexRequestFailed"), {
                description: error.message,
              })
              controller.error(error)
              safeUnsubscribe()
            },
            onComplete: () => {
              try {
                controller.close()
              } catch {
                // Stream already closed
              }
              safeUnsubscribe()
            },
          },
        )
        if (didUnsubscribe) sub.unsubscribe()

        options.abortSignal?.addEventListener("abort", () => {
          // Keep stop UX immediate in the client.
          try {
            controller.close()
          } catch {
            // Stream already closed
          }
          // Unsubscription reaches this subscription's main-process closure,
          // which owns the exact ActiveCodexStream object. A subChatId/runId
          // mutation cannot safely express this ownership when Runs alias.
          safeUnsubscribe()
        })
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<AiSdkTransportChunk> | null> {
    return null
  }

  cleanup(): void {
    releaseAuthRetryTransportGeneration(this.authRetryTransportGeneration)
    this.activeRunOwner?.unsubscribe()
    this.activeRunOwner = null
  }

  private extractText(message: UIMessage | undefined): string {
    if (!message) return ""

    const textParts: string[] = []
    const fileContents: string[] = []

    for (const part of getCanonicalMessageParts(message)) {
      if (isTextMessagePart(part)) {
        textParts.push(part.text)
      } else if (isFileContentMessagePart(part)) {
        const fileName =
          part.filePath.split("/").pop() || part.filePath || "file"
        fileContents.push(`\n--- ${fileName} ---\n${part.content}`)
      }
    }

    return textParts.join("\n") + fileContents.join("")
  }

  private extractImages(message: UIMessage | undefined): ImageAttachment[] {
    if (!message) return []

    const images: ImageAttachment[] = []

    for (const part of getCanonicalMessageParts(message)) {
      const attachment = normalizeChatImageAttachmentPart(part)
      if (attachment) {
        images.push({
          attachmentId: attachment.attachmentId,
          localRef: attachment.localRef,
          mediaType: attachment.mediaType,
          filename: attachment.filename,
          sizeBytes: attachment.sizeBytes,
          width: attachment.width,
          height: attachment.height,
          sha256: attachment.sha256,
        })
        continue
      }

      if (isDataImageMessagePart(part)) {
        if (part.data.base64Data && part.data.mediaType) {
          images.push({
            base64Data: part.data.base64Data,
            mediaType: part.data.mediaType,
            filename: part.data.filename,
          })
        }
      }
    }

    return images
  }

  private extractLongTextAttachments(
    message: UIMessage | undefined,
  ): LongTextAttachmentPart[] {
    return getCanonicalMessageParts(message).flatMap((part) => {
      const attachment = normalizeLongTextAttachmentPart(part)
      return attachment ? [attachment] : []
    })
  }
}
