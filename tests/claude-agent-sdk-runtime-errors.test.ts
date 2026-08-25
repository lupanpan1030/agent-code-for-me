import { describe, expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import type { DesktopRunPreflightBlocker } from "../src/main/lib/agent-runtime/preflight"
import { createClaudeAgentSdkRuntimeErrorHandlers } from "../src/main/lib/claude/agent-sdk-runtime-errors"
import type { UIMessageChunk } from "../src/main/lib/claude/types"
import { EXACT_SECRET_REDACTION_MARKER } from "../src/shared/secret-redaction-policy"

describe("Claude Agent SDK runtime error handlers", () => {
  test("emits renderer error chunks with development diagnostics", () => {
    const emitted: UIMessageChunk[] = []
    const logged: unknown[][] = []
    const { emitError } = createClaudeAgentSdkRuntimeErrorHandlers({
      cwd: "/repo",
      mode: "agent",
      emit: (chunk) => emitted.push(chunk),
      complete: () => {},
      env: {
        NODE_ENV: "development",
        PATH: "0123456789".repeat(30),
      },
      error: (...args) => logged.push(args),
    })

    emitError(new Error("boom"), "Startup failed")

    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      type: "error",
      errorText: "Startup failed: boom",
      debugInfo: {
        context: "Startup failed",
        cwd: "/repo",
        mode: "agent",
        PATH: "0123456789".repeat(20),
      },
    })
    expect(logged[0]).toEqual(["[claude] Startup failed:", "boom"])
    expect(logged[1]?.[0]).toBe("[claude] Stack:")
  })

  test("omits renderer debug info in production", () => {
    const emitted: UIMessageChunk[] = []
    const { emitError } = createClaudeAgentSdkRuntimeErrorHandlers({
      cwd: "/repo",
      mode: "plan",
      emit: (chunk) => emitted.push(chunk),
      complete: () => {},
      env: {
        NODE_ENV: "production",
        PATH: "/bin",
      },
      error: () => {},
    })

    emitError("plain failure", "Runtime failed")

    expect(emitted).toEqual([
      {
        type: "error",
        errorText: "Runtime failed: plain failure",
      } as UIMessageChunk,
    ])
  })

  test("redacts dynamically resolved run secrets from error logs and chunks", () => {
    const gatewayToken = randomBytes(32).toString("hex")
    const emitted: UIMessageChunk[] = []
    const logged: unknown[][] = []
    const { emitError } = createClaudeAgentSdkRuntimeErrorHandlers({
      cwd: "/repo",
      mode: "agent",
      runId: "run-secret",
      getSecretHints: () => [gatewayToken],
      emit: (chunk) => emitted.push(chunk),
      complete: () => {},
      error: (...args) => logged.push(args),
    })

    emitError(
      new Error(`malicious runtime error echoed ${gatewayToken}`),
      "Runtime failed",
    )

    expect(JSON.stringify(logged)).not.toContain(gatewayToken)
    expect(JSON.stringify(emitted)).not.toContain(gatewayToken)
    expect(emitted[0]).toMatchObject({
      errorText: `Runtime failed: malicious runtime error echoed ${EXACT_SECRET_REDACTION_MARKER}`,
    })
  })

  test("does not log late runtime errors after the observer is inactive", () => {
    const logged: unknown[][] = []
    const { emitError } = createClaudeAgentSdkRuntimeErrorHandlers({
      cwd: "/repo",
      mode: "agent",
      isActive: () => false,
      emit: () => {},
      complete: () => {},
      error: (...args) => logged.push(args),
    })

    emitError(new Error("late error"), "Runtime failed")

    expect(logged).toEqual([])
  })

  test("emits preflight blockers as terminal frontend events", () => {
    const emitted: UIMessageChunk[] = []
    const completed: string[] = []
    const { emitPreflightBlocker } = createClaudeAgentSdkRuntimeErrorHandlers({
      cwd: "/repo",
      mode: "agent",
      emit: (chunk) => emitted.push(chunk),
      complete: () => completed.push("complete"),
      env: {
        NODE_ENV: "production",
        PATH: "/bin",
      },
      error: () => {},
    })
    const blocker: DesktopRunPreflightBlocker = {
      id: "provider",
      status: "blocked",
      message: "Provider unavailable",
    }

    emitPreflightBlocker(blocker)

    expect(emitted).toEqual([
      {
        type: "error",
        errorText: "Desktop run preflight blocked: Provider unavailable",
      } as UIMessageChunk,
      { type: "finish" } as UIMessageChunk,
    ])
    expect(completed).toEqual(["complete"])
  })
})
