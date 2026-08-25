import { afterEach, describe, expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import type { DesktopRunPreflightBlocker } from "../src/main/lib/agent-runtime/preflight"
import { createDesktopStreamEventMapper } from "../src/main/lib/agent-runtime/stream-event-mapper"
import {
  clearClaudeActiveSessionsForTest,
  getActiveClaudeSession,
} from "../src/main/lib/claude/active-sessions"
import { createClaudeAgentSdkDesktopRunEnvelope } from "../src/main/lib/claude/agent-sdk-desktop-run-envelope"
import { resolveClaudeAgentSdkProviderStartup } from "../src/main/lib/claude/agent-sdk-provider-startup"
import type { UIMessageChunk } from "../src/main/lib/claude/types"
import {
  createAgentJob,
  listAgentJobEvents,
} from "../src/main/lib/headless/job-store"
import { EXACT_SECRET_REDACTION_MARKER } from "../src/shared/secret-redaction-policy"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

describe("Claude Agent SDK desktop run envelope", () => {
  afterEach(() => {
    clearClaudeActiveSessionsForTest()
  })

  test("starts the active session and wires safe renderer emission", () => {
    const emitted: UIMessageChunk[] = []
    const completed: string[] = []
    const logs: unknown[][] = []

    const envelope = createClaudeAgentSdkDesktopRunEnvelope({
      subChatId: "sub-chat-12345678",
      requestedRunId: "run-1",
      cwd: "/repo",
      mode: "agent",
      createId: () => "stream-1",
      nowMs: () => 1000,
      log: (...args) => logs.push(args),
      emitNext: (chunk) => emitted.push(chunk),
      emitComplete: () => {
        completed.push("complete")
      },
    })

    expect(envelope.streamId).toBe("stream-1")
    expect(envelope.activeRunId).toBe("run-1")
    expect(envelope.subId).toBe("12345678")
    expect(envelope.streamStart).toBe(1000)
    expect(getActiveClaudeSession("sub-chat-12345678")).toMatchObject({
      runId: "run-1",
    })
    expect(logs).toEqual([
      ["[SD] M:START sub=12345678 stream=stream-1 mode=agent"],
    ])

    expect(
      envelope.emit({
        type: "runtime-status",
        ok: false,
        blocker: {
          component: "provider-profile",
          message: "failed with api_key=sk-supersecretvalue123456",
        },
      } as UIMessageChunk),
    ).toBe(true)

    expect(envelope.desktopRunState.sawError()).toBe(true)
    expect(emitted[0]).toMatchObject({
      type: "runtime-status",
      blocker: {
        message: "failed with api_key=<redacted>",
      },
    })
    expect(completed).toEqual([])
  })

  test("emits preflight blockers through the runtime error handler", () => {
    const emitted: UIMessageChunk[] = []
    const completed: string[] = []
    const envelope = createClaudeAgentSdkDesktopRunEnvelope({
      subChatId: "sub-chat-1",
      cwd: "/repo",
      mode: "plan",
      createId: () => "stream-2",
      log: () => {},
      emitNext: (chunk) => emitted.push(chunk),
      emitComplete: () => {
        completed.push("complete")
      },
    })
    const blocker: DesktopRunPreflightBlocker = {
      id: "provider-profile",
      status: "blocked",
      message: "Provider unavailable",
    }

    envelope.emitPreflightBlocker(blocker)

    expect(emitted[0]).toMatchObject({
      type: "error",
      errorText: "Desktop run preflight blocked: Provider unavailable",
    })
    expect(emitted[1]).toEqual({ type: "finish" } as UIMessageChunk)
    expect(completed).toEqual(["complete"])
  })

  test("redacts a dynamically resolved bare run secret from normal renderer chunks", () => {
    const gatewayToken = randomBytes(32).toString("hex")
    const emitted: UIMessageChunk[] = []
    let secretHints: readonly string[] = []
    const envelope = createClaudeAgentSdkDesktopRunEnvelope({
      subChatId: "sub-chat-secret",
      cwd: "/repo",
      mode: "agent",
      createId: () => "stream-secret",
      log: () => {},
      getSecretHints: () => secretHints,
      emitNext: (chunk) => emitted.push(chunk),
      emitComplete: () => {},
    })

    secretHints = [gatewayToken]
    envelope.emit({
      type: "text-delta",
      id: "text-secret",
      delta: `malicious SDK output ${gatewayToken}`,
    } as UIMessageChunk)

    expect(JSON.stringify(emitted)).not.toContain(gatewayToken)
    expect(JSON.stringify(emitted)).not.toContain("secretHints")
    expect(emitted[0]).toMatchObject({
      type: "text-delta",
      delta: `malicious SDK output ${EXACT_SECRET_REDACTION_MARKER}`,
    })
  })

  test("redacts upstream and gateway echoes from successful renderer, tool, and persisted RunEvent output", async () => {
    const upstreamToken = randomBytes(32).toString("hex")
    const gatewayToken = randomBytes(32).toString("hex")
    const providerStartup = await resolveClaudeAgentSdkProviderStartup({
      modelSource: "provider-profile:upstream-canary",
      dependencies: {
        parseProviderProfileSource: () => "upstream-canary",
        getProviderProfileRuntimeConfig: () => ({
          id: "upstream-canary",
          name: "Upstream canary",
          presetId: null,
          protocol: "anthropic",
          baseUrl: "https://provider.example.com/v1",
          defaultModel: "claude-canary",
          authMode: "bearer",
          token: upstreamToken,
          headers: {},
          targetRuntimes: ["claude"],
          capabilities: {},
        }),
        getProviderGatewayEndpoint: async () => ({
          providerId: "upstream-canary",
          baseUrl: "http://127.0.0.1:1234/profile/upstream-canary/anthropic/v1",
          token: gatewayToken,
        }),
        revokeProviderGatewayToken: () => true,
        checkOfflineFallback: async (config) => ({
          config,
          isUsingOllama: false,
        }),
        assertOfficialCloudAllowed: () => {},
      },
    })
    expect(providerStartup.ok).toBe(true)
    if (!providerStartup.ok) throw new Error("expected provider startup")
    const secretHints = providerStartup.startup.secretHints
    const db = createAgentJobTestDb()
    const job = createAgentJob(db, {
      source: "desktop",
      runtime: "claude-code",
      mode: "agent",
      cwd: "/repo",
      prompt: "echo canary",
    })
    const emitted: UIMessageChunk[] = []
    const envelope = createClaudeAgentSdkDesktopRunEnvelope({
      subChatId: "sub-chat-upstream-canary",
      requestedRunId: "run-upstream-canary",
      cwd: "/repo",
      mode: "agent",
      createId: () => "stream-upstream-canary",
      log: () => {},
      getSecretHints: () => secretHints,
      emitNext: (chunk) => emitted.push(chunk),
      emitComplete: () => {},
    })
    envelope.desktopRunState.setDb(db)
    envelope.desktopRunState.setDesktopJob({
      jobId: job.id,
      streamEventMapper: createDesktopStreamEventMapper({
        runtimeId: "claude-code",
        runId: "run-upstream-canary",
        jobId: job.id,
        secretHints,
      }),
    })

    const upstreamSplit = 17
    const gatewaySplit = 19
    for (const delta of [
      `success ${upstreamToken.slice(0, upstreamSplit)}`,
      `${upstreamToken.slice(upstreamSplit)} ${gatewayToken.slice(0, gatewaySplit)}`,
      gatewayToken.slice(gatewaySplit),
    ]) {
      envelope.emit({
        type: "text-delta",
        id: "assistant-canary",
        delta,
      } as UIMessageChunk)
    }
    envelope.emit({
      type: "text-end",
      id: "assistant-canary",
    } as UIMessageChunk)
    envelope.emit({
      type: "tool-output-available",
      toolCallId: "tool-canary",
      output: `tool echoed ${upstreamToken} and ${gatewayToken}`,
    } as UIMessageChunk)

    const rendererAndPersistence = JSON.stringify({
      emitted,
      events: listAgentJobEvents(db, job.id),
    })
    expect(rendererAndPersistence).not.toContain(upstreamToken)
    expect(rendererAndPersistence).not.toContain(gatewayToken)
    expect(rendererAndPersistence).toContain(EXACT_SECRET_REDACTION_MARKER)
    expect(
      emitted
        .filter((chunk) => chunk.type === "text-delta")
        .map((chunk) => chunk.delta)
        .join(""),
    ).toBe(
      `success ${EXACT_SECRET_REDACTION_MARKER} ${EXACT_SECRET_REDACTION_MARKER}`,
    )
    expect(emitted.find((chunk) => chunk.type === "text-end")).toEqual({
      type: "text-end",
      id: "assistant-canary",
    })
    expect(
      emitted.find((chunk) => chunk.type === "tool-output-available"),
    ).toMatchObject({
      toolCallId: "tool-canary",
      output: `tool echoed ${EXACT_SECRET_REDACTION_MARKER} and ${EXACT_SECRET_REDACTION_MARKER}`,
    })
    providerStartup.startup.cleanupRuntimeSecrets()
  })

  test("safe complete ignores already-closed transports", () => {
    const envelope = createClaudeAgentSdkDesktopRunEnvelope({
      subChatId: "sub-chat-1",
      cwd: "/repo",
      mode: "agent",
      createId: () => "stream-3",
      log: () => {},
      emitNext: () => {},
      emitComplete: () => {
        throw new Error("closed")
      },
    })

    expect(() => envelope.complete()).not.toThrow()
  })
})
