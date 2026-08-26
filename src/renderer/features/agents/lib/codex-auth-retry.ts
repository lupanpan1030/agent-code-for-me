export type CodexLoginMethod = "chatgpt" | "api_key"

type PendingCodexAuthRetry = {
  provider: "claude-code" | "codex"
  requiredCodexAuthMethod?: CodexLoginMethod
}

export function resolveRequiredCodexAuthRetryMethod(
  pending: PendingCodexAuthRetry | null,
): CodexLoginMethod | null {
  if (pending?.provider !== "codex") return null
  return pending.requiredCodexAuthMethod ?? null
}

export function didCodexAuthRetryLoginSatisfyBinding(input: {
  pending: PendingCodexAuthRetry | null
  successfulMethod: CodexLoginMethod
}): boolean {
  const requiredMethod = resolveRequiredCodexAuthRetryMethod(input.pending)
  return requiredMethod !== null && requiredMethod === input.successfulMethod
}

/**
 * Ends the exact captured Codex subscription whenever an auth error terminates
 * its renderer stream. The finally keeps ownership cleanup reliable even when
 * the stream controller was already closed and rejects the error transition.
 */
export function failCodexAuthErrorStream(input: {
  error: Error
  errorStream: (error: Error) => void
  unsubscribe: () => void
}): void {
  try {
    input.errorStream(input.error)
  } finally {
    input.unsubscribe()
  }
}
