export type ClaudeAgentSdkRuntimeSecretRegistration = {
  secretHints: readonly string[]
  cleanup: () => void
}

export type ClaudeAgentSdkRuntimeSecretLifecycle = {
  register(registration: ClaudeAgentSdkRuntimeSecretRegistration): void
  getSecretHints(): readonly string[]
  revoke(): void
  release(): void
}

/**
 * Keeps exact-redaction hints alive after credential revocation so terminal
 * events emitted during cancellation still pass through the same protection.
 */
export function createClaudeAgentSdkRuntimeSecretLifecycle(): ClaudeAgentSdkRuntimeSecretLifecycle {
  let secretHints: readonly string[] = []
  let revokeCredential: (() => void) | null = null

  const revoke = () => {
    const cleanup = revokeCredential
    revokeCredential = null
    cleanup?.()
  }

  return {
    register(registration) {
      revoke()
      secretHints = [...new Set([...secretHints, ...registration.secretHints])]
      revokeCredential = registration.cleanup
    },
    getSecretHints() {
      return secretHints
    },
    revoke,
    release() {
      try {
        revoke()
      } finally {
        secretHints = []
      }
    },
  }
}
