import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { createClaudeAgentSdkRuntimeSecretLifecycle } from "../src/main/lib/claude/agent-sdk-runtime-secrets"

describe("Claude Agent SDK runtime secret lifecycle", () => {
  test("revokes credentials immediately but retains redaction hints until release", () => {
    const lifecycle = createClaudeAgentSdkRuntimeSecretLifecycle()
    let cleanupCalls = 0

    lifecycle.register({
      secretHints: ["provider-token", "provider-token", "oauth-token"],
      cleanup: () => {
        cleanupCalls += 1
      },
    })

    lifecycle.revoke()
    lifecycle.revoke()
    expect(cleanupCalls).toBe(1)
    expect(lifecycle.getSecretHints()).toEqual([
      "provider-token",
      "oauth-token",
    ])

    lifecycle.register({
      secretHints: ["next-token"],
      cleanup: () => {
        cleanupCalls += 1
      },
    })
    expect(lifecycle.getSecretHints()).toEqual([
      "provider-token",
      "oauth-token",
      "next-token",
    ])

    lifecycle.release()
    expect(cleanupCalls).toBe(2)
    expect(lifecycle.getSecretHints()).toEqual([])
  })

  test("desktop subscription revokes on unsubscribe and releases only after supervision", () => {
    const source = readFileSync("src/main/lib/trpc/routers/claude.ts", "utf8")

    expect(source).toContain("cleanupRuntimeSecrets: runtimeSecrets.release")
    expect(source).toContain("cleanupRuntimeSecrets: runtimeSecrets.revoke")
    expect(source).toContain("getSecretHints: runtimeSecrets.getSecretHints")
  })
})
