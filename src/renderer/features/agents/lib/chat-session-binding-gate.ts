import { agentChatStore } from "../stores/agent-chat-store"

const bindingGateTails = new Map<string, Promise<void>>()
const pendingOperationCounts = new Map<string, number>()
const cancellationGenerations = new Map<string, number>()
const pendingOperationSettledCallbacks = new Map<string, Set<() => void>>()

export class ChatSessionOperationCancelledError extends Error {
  constructor(subChatId: string) {
    super(`Chat operation was cancelled for ${subChatId}`)
    this.name = "ChatSessionOperationCancelledError"
  }
}

export type ChatSessionOperationContext = {
  isCancelled: () => boolean
  throwIfCancelled: () => void
}

/**
 * A successful main-process mutation has already changed canonical binding
 * truth. Publish that receipt before honoring renderer-only cancellation so a
 * later reopen cannot revive the stale tuple. Cancellation still fences every
 * transport/UI continuation after publication.
 */
export function publishChatSessionBindingReceipt<T>(input: {
  context: ChatSessionOperationContext
  receipt: T
  publish: (receipt: T) => void
}): T {
  input.publish(input.receipt)
  input.context.throwIfCancelled()
  return input.receipt
}

function retainPendingChatSessionOperation(subChatId: string): () => void {
  pendingOperationCounts.set(
    subChatId,
    (pendingOperationCounts.get(subChatId) ?? 0) + 1,
  )
  return () => {
    const remaining = (pendingOperationCounts.get(subChatId) ?? 1) - 1
    if (remaining <= 0) {
      pendingOperationCounts.delete(subChatId)
      cancellationGenerations.delete(subChatId)
      const callbacks = pendingOperationSettledCallbacks.get(subChatId)
      pendingOperationSettledCallbacks.delete(subChatId)
      for (const callback of callbacks ?? []) {
        setTimeout(callback, 0)
      }
    } else {
      pendingOperationCounts.set(subChatId, remaining)
    }
  }
}

export function hasPendingChatSessionOperation(subChatId: string): boolean {
  return (pendingOperationCounts.get(subChatId) ?? 0) > 0
}

/**
 * Canonical normal-eviction policy for renderer Chat instances. Parent
 * navigation, resident-tab bounding, and detached-finish cleanup must all
 * retain the same runtime work. Explicit close uses the cancellation path.
 */
export function shouldRetainChatSessionDuringNormalEviction(input: {
  subChatId: string
  isStreaming: boolean
  queuedMessageCount: number
}): boolean {
  return (
    input.isStreaming ||
    input.queuedMessageCount > 0 ||
    hasPendingChatSessionOperation(input.subChatId)
  )
}

/**
 * Registers one normal-eviction recheck after the last pending operation
 * releases. Returns false when there is nothing to defer.
 */
export function deferUntilPendingChatSessionOperationsSettle(
  subChatId: string,
  callback: () => void,
): boolean {
  if (!hasPendingChatSessionOperation(subChatId)) return false
  const callbacks = pendingOperationSettledCallbacks.get(subChatId) ?? new Set()
  callbacks.add(callback)
  pendingOperationSettledCallbacks.set(subChatId, callbacks)
  return true
}

/**
 * Explicit tab close/delete cancels pending UI work. Normal workspace/tab
 * eviction must not call this: those paths retain a Chat until the operation
 * reaches the current binding transport.
 */
export function cancelPendingChatSessionOperations(subChatId: string): void {
  if (!hasPendingChatSessionOperation(subChatId)) return
  cancellationGenerations.set(
    subChatId,
    (cancellationGenerations.get(subChatId) ?? 0) + 1,
  )
}

export function isChatSessionOperationCancelledError(
  error: unknown,
): error is ChatSessionOperationCancelledError {
  return error instanceof ChatSessionOperationCancelledError
}

/**
 * Retains an in-flight UI operation across normal renderer eviction without
 * serializing it behind the binding gate. This is needed when a direct submit
 * is already waiting for the binding mutation that owns the gate.
 */
export async function withPendingChatSessionOperation<T>(
  subChatId: string,
  operation: (context: ChatSessionOperationContext) => Promise<T> | T,
  inheritedContext?: ChatSessionOperationContext,
): Promise<T> {
  if (inheritedContext) {
    inheritedContext.throwIfCancelled()
    try {
      const result = await operation(inheritedContext)
      inheritedContext.throwIfCancelled()
      return result
    } catch (error) {
      if (inheritedContext.isCancelled()) {
        inheritedContext.throwIfCancelled()
      }
      throw error
    }
  }

  const generation = cancellationGenerations.get(subChatId) ?? 0
  const release = retainPendingChatSessionOperation(subChatId)
  const context: ChatSessionOperationContext = {
    isCancelled: () =>
      (cancellationGenerations.get(subChatId) ?? 0) !== generation,
    throwIfCancelled: () => {
      if ((cancellationGenerations.get(subChatId) ?? 0) !== generation) {
        throw new ChatSessionOperationCancelledError(subChatId)
      }
    },
  }

  try {
    context.throwIfCancelled()
    const result = await operation(context)
    context.throwIfCancelled()
    return result
  } catch (error) {
    if (context.isCancelled()) {
      context.throwIfCancelled()
    }
    throw error
  } finally {
    release()
  }
}

/**
 * Serializes binding transitions and message sends for one sub-chat.
 *
 * Callers must resolve the current Chat/transport inside the operation so a
 * send queued behind a binding transition cannot retain a stale transport.
 */
export async function withChatSessionBindingGate<T>(
  subChatId: string,
  operation: (context: ChatSessionOperationContext) => Promise<T> | T,
  inheritedContext?: ChatSessionOperationContext,
): Promise<T> {
  return withPendingChatSessionOperation(subChatId, async (context) => {
    const previous = bindingGateTails.get(subChatId) ?? Promise.resolve()
    let release: (() => void) | undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => {}).then(() => current)
    bindingGateTails.set(subChatId, tail)

    await previous.catch(() => {})
    try {
      context.throwIfCancelled()
      const result = await operation(context)
      context.throwIfCancelled()
      return result
    } catch (error) {
      if (context.isCancelled()) {
        context.throwIfCancelled()
      }
      throw error
    } finally {
      release?.()
      if (bindingGateTails.get(subChatId) === tail) {
        bindingGateTails.delete(subChatId)
      }
    }
  }, inheritedContext)
}

/**
 * Runs against the Chat that owns the current transport after this operation
 * acquires the binding gate. A binding transition can replace a same-id Chat
 * while an operation is waiting, so callers must not close over a mounted
 * component's Chat or useChat callback.
 */
export async function withCurrentChatSessionBindingGate<T>(
  subChatId: string,
  operation: (
    chat: NonNullable<ReturnType<typeof agentChatStore.get>>,
    context: ChatSessionOperationContext,
  ) => Promise<T> | T,
  inheritedContext?: ChatSessionOperationContext,
): Promise<T> {
  return withChatSessionBindingGate(subChatId, (context) => {
    const currentChat = agentChatStore.get(subChatId)
    if (!currentChat) {
      throw new Error(`Chat transport is unavailable for ${subChatId}`)
    }
    // Keep this check adjacent to the transport hand-off. Inherited contexts
    // prevent an old outer continuation from claiming a fresh generation after
    // explicit close followed by a same-id reopen.
    context.throwIfCancelled()
    return operation(currentChat, context)
  }, inheritedContext)
}

/**
 * Force-send and queue-drain actions must stop the active run before waiting
 * for a binding update that may itself be queued behind that run's gate.
 */
export async function stopBeforePendingChatSessionBindingUpdate(input: {
  shouldStop: boolean
  stop: () => Promise<void>
  waitForBindingUpdate: () => Promise<boolean>
}): Promise<boolean> {
  if (input.shouldStop) {
    await input.stop()
  }
  return input.waitForBindingUpdate()
}

export function clearChatSessionBindingGatesForTest(): void {
  bindingGateTails.clear()
  pendingOperationCounts.clear()
  cancellationGenerations.clear()
  pendingOperationSettledCallbacks.clear()
}
