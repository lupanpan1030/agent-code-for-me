export const OPERATION_TIMED_OUT = Symbol("deep-conflict-operation-timed-out")
export const MAX_DEEP_CONFLICT_DIFF_BYTES = 2 * 1024 * 1024

export function exceedsDeepConflictDiffLimit(diff: string): boolean {
  return Buffer.byteLength(diff, "utf8") > MAX_DEEP_CONFLICT_DIFF_BYTES
}

export type DeepConflictRequestBudget = {
  deadlineAt: number
  monotonicNow: () => number
}

export type DeepConflictOperationContext = {
  signal: AbortSignal
  timeoutMs: number
}

export function normaliseDuration(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value))
}

export async function settleWithTimeout<Result>(
  operation: Promise<Result>,
  timeoutMs: number,
): Promise<Result | typeof OPERATION_TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<typeof OPERATION_TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(OPERATION_TIMED_OUT), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export async function settleWithinRequest<Result>(
  operation: (context: DeepConflictOperationContext) => Promise<Result>,
  budget: DeepConflictRequestBudget,
): Promise<Result | typeof OPERATION_TIMED_OUT> {
  const remainingMs = budget.deadlineAt - budget.monotonicNow()
  if (remainingMs <= 0) return OPERATION_TIMED_OUT

  // Never schedule the timer before a fractional monotonic deadline.
  const timeoutMs = Math.max(1, Math.ceil(remainingMs))
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(() =>
        operation({ signal: controller.signal, timeoutMs }),
      ),
      new Promise<typeof OPERATION_TIMED_OUT>((resolve) => {
        timer = setTimeout(() => {
          // Publish timeout provenance before abort listeners can settle the
          // operation with a generic fallback value.
          resolve(OPERATION_TIMED_OUT)
          controller.abort()
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function isRequestBudgetExceeded(
  budget: DeepConflictRequestBudget,
): boolean {
  return budget.monotonicNow() >= budget.deadlineAt
}
