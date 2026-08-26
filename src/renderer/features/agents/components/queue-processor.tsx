"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { trackMessageSent } from "../../../lib/analytics"
import { useI18n } from "../../../lib/i18n"
import { appStore } from "../../../lib/jotai-store"
import { clearLoading, loadingSubChatsAtom, setLoading } from "../atoms"
import {
  isChatSessionOperationCancelledError,
  withChatSessionBindingGate,
} from "../lib/chat-session-binding-gate"
import { buildAgentMessageParts } from "../lib/message-parts"
import type { AgentQueueItem } from "../lib/queue-utils"
import { agentChatStore } from "../stores/agent-chat-store"
import { useMessageQueueStore } from "../stores/message-queue-store"
import { useStreamingStatusStore } from "../stores/streaming-status-store"
import { useAgentSubChatStore } from "../stores/sub-chat-store"

// Delay between processing queue items (ms)
const QUEUE_PROCESS_DELAY = 1000

/**
 * Global queue processor component.
 *
 * This component runs at the app level (AgentsLayout) and processes
 * message queues for ALL sub-chats, regardless of which one is currently active.
 *
 * Key insight: Unlike the previous local useEffect in ChatViewInner which only
 * processed the currently active sub-chat's queue, this component listens to
 * ALL queues and streaming statuses globally.
 */
export function QueueProcessor() {
  const { t } = useI18n()
  // Track which sub-chats are currently being processed to avoid double-sends
  const processingRef = useRef<Set<string>>(new Set())
  // Track timers for cleanup
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  useEffect(() => {
    // Function to process queue for a specific sub-chat
    const processQueue = async (subChatId: string) => {
      // Check if already processing this sub-chat
      if (processingRef.current.has(subChatId)) {
        return
      }

      // Check streaming status
      const status = useStreamingStatusStore.getState().getStatus(subChatId)
      if (status !== "ready") {
        return
      }

      // Get queue for this sub-chat
      const queue = useMessageQueueStore.getState().queues[subChatId] || []
      if (queue.length === 0) {
        return
      }

      // Mark as processing
      processingRef.current.add(subChatId)
      let item: AgentQueueItem | undefined

      try {
        await withChatSessionBindingGate(subChatId, async () => {
          // Re-read every send precondition and the Chat inside the gate. A
          // binding transition may have replaced the transport while this
          // queue item was waiting to acquire it.
          const currentStatus = useStreamingStatusStore
            .getState()
            .getStatus(subChatId)
          if (currentStatus !== "ready") return

          const currentQueue =
            useMessageQueueStore.getState().queues[subChatId] || []
          if (currentQueue.length === 0) return

          const chat = agentChatStore.get(subChatId)
          if (!chat) return

          const poppedItem = useMessageQueueStore
            .getState()
            .popItem(subChatId, currentQueue[0].id)
          if (!poppedItem) return
          item = poppedItem

          // Build message parts from queued item. New image attachments stay as
          // local refs; legacy queued images can still fall back to data-image.
          const parts = buildAgentMessageParts({
            text: poppedItem.message,
            images: poppedItem.images,
            files: poppedItem.files,
            textContexts: poppedItem.textContexts?.map((context) => ({
              ...context,
              preview: context.text.slice(0, 50),
            })),
            diffTextContexts: poppedItem.diffTextContexts?.map((context) => ({
              ...context,
              preview: context.text.slice(0, 50),
            })),
            pastedTexts: poppedItem.pastedTexts,
          })

          const subChatMeta = useAgentSubChatStore
            .getState()
            .allSubChats.find((sc) => sc.id === subChatId)
          const mode = subChatMeta?.mode || "agent"

          trackMessageSent({
            workspaceId: subChatId,
            messageLength: poppedItem.message.length,
            mode,
          })

          useAgentSubChatStore.getState().updateSubChatTimestamp(subChatId)

          const parentChatId = agentChatStore.getParentChatId(subChatId)
          if (parentChatId) {
            setLoading(
              (fn) =>
                appStore.set(
                  loadingSubChatsAtom,
                  fn(appStore.get(loadingSubChatsAtom)),
                ),
              subChatId,
              parentChatId,
            )
          }

          // Signal active-chat to scroll before sendMessage awaits the stream.
          useMessageQueueStore.getState().triggerQueueSent(subChatId)

          await chat.sendMessage({ role: "user", parts })
        })
      } catch (error) {
        if (isChatSessionOperationCancelledError(error)) return
        console.error(`[QueueProcessor] Error processing queue:`, error)

        // Requeue the item at the front so it can be retried
        if (item) {
          useMessageQueueStore.getState().prependItem(subChatId, item)
        }

        // Set error status (will be cleared on next successful send or manual retry)
        useStreamingStatusStore.getState().setStatus(subChatId, "error")

        // Clear loading state since send failed
        clearLoading(
          (fn) =>
            appStore.set(
              loadingSubChatsAtom,
              fn(appStore.get(loadingSubChatsAtom)),
            ),
          subChatId,
        )

        // Notify user
        toast.error(t("agent.queue.failed"))
      } finally {
        processingRef.current.delete(subChatId)
        // Re-kick after releasing lock to avoid lost wakeups
        setTimeout(checkAllQueues, 0)
      }
    }

    // Schedule processing for a sub-chat with delay
    const scheduleProcessing = (subChatId: string) => {
      // Clear any existing timer for this sub-chat
      const existingTimer = timersRef.current.get(subChatId)
      if (existingTimer) {
        clearTimeout(existingTimer)
      }

      // Schedule new processing
      const timer = setTimeout(() => {
        timersRef.current.delete(subChatId)
        processQueue(subChatId)
      }, QUEUE_PROCESS_DELAY)

      timersRef.current.set(subChatId, timer)
    }

    // Check all queues and schedule processing for ready sub-chats
    function checkAllQueues() {
      const queues = useMessageQueueStore.getState().queues

      for (const subChatId of Object.keys(queues)) {
        const queue = queues[subChatId]
        if (!queue || queue.length === 0) continue

        const status = useStreamingStatusStore.getState().getStatus(subChatId)

        // Process when ready, or retry on error status
        if (
          (status === "ready" || status === "error") &&
          !processingRef.current.has(subChatId)
        ) {
          // If error status, clear it before retrying
          if (status === "error") {
            useStreamingStatusStore.getState().setStatus(subChatId, "ready")
          }
          scheduleProcessing(subChatId)
        }
      }
    }

    // Subscribe to queue changes with selector (requires subscribeWithSelector middleware)
    const unsubscribeQueue = useMessageQueueStore.subscribe(
      (state) => state.queues,
      () => checkAllQueues(),
    )

    // Subscribe to streaming status changes with selector
    const unsubscribeStatus = useStreamingStatusStore.subscribe(
      (state) => state.statuses,
      () => checkAllQueues(),
    )

    // Initial check
    checkAllQueues()

    // Cleanup
    return () => {
      unsubscribeQueue()
      unsubscribeStatus()

      // Clear all timers
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer)
      }
      timersRef.current.clear()
    }
  }, [t])

  // This component doesn't render anything
  return null
}
