import { afterEach, describe, expect, test } from "bun:test"
import {
  clearClaudeActiveSessionsForTest,
  getActiveClaudeSession,
  setActiveClaudeSession,
} from "../src/main/lib/claude/active-sessions"
import { prepareClaudeAgentSdkDesktopRunStartup } from "../src/main/lib/claude/agent-sdk-desktop-run-startup"
import type { ClaudeAgentSdkProviderDesktopStartupResult } from "../src/main/lib/claude/agent-sdk-provider-startup"

function createBaseInput() {
  const abortController = new AbortController()
  setActiveClaudeSession("sub-1", {
    controller: abortController,
    runId: "run-1",
  })
  const desktopJobs: any[] = []
  const blockers: any[] = []
  return {
    abortController,
    desktopJobs,
    blockers,
    input: {
      db: { id: "db-1" } as any,
      mode: "agent" as const,
      chatId: "chat-1",
      subChatId: "sub-1",
      cwd: "/repo",
      prompt: "hello",
      runId: "run-1",
      cancel: () => undefined,
      streamId: "stream-1",
      preflight: { cwd: "/repo", project: { id: "project-1" } } as any,
      permissionPolicy: { runtimeId: "claude-code" } as any,
      requestedModel: "claude-sonnet",
      modelSource: "profile:provider-1",
      offlineModeEnabled: false,
      enableTasks: true,
      images: [{ mediaType: "image/png", localRef: "local-image-1" }],
      longTextAttachments: [
        {
          attachmentId: "long-1",
          localRef: "local-text-1",
          filename: "note.txt",
          byteLength: 10,
          kind: "pasted" as const,
        },
      ],
      signal: abortController.signal,
      existingSessionId: "existing-session",
      emitPreflightBlocker: (blocker: any) => {
        blockers.push(blocker)
      },
      desktopRunState: {
        setDesktopJob: (input: any) => {
          desktopJobs.push(input)
        },
      },
    },
  }
}

describe("Claude Agent SDK desktop run startup", () => {
  afterEach(() => {
    clearClaudeActiveSessionsForTest()
  })

  test("stops before job creation when provider startup is blocked", async () => {
    const base = createBaseInput()
    const calls: string[] = []

    const result = await prepareClaudeAgentSdkDesktopRunStartup({
      ...base.input,
      dependencies: {
        prepareProviderStartup: async (input) => {
          calls.push("provider")
          input.emitPreflightBlocker?.({
            id: "provider-profile",
            status: "needs-auth",
            message: "Provider unavailable",
          })
          return {
            ok: false,
            blocker: {
              id: "provider-profile",
              status: "needs-auth",
              message: "Provider unavailable",
            },
          }
        },
        createDesktopRunStartup: (() => {
          calls.push("job")
          throw new Error("job should not be created")
        }) as any,
        prepareRuntimeStartup: (() => {
          calls.push("runtime")
          throw new Error("runtime startup should not run")
        }) as any,
      },
    })

    expect(result).toEqual({
      ok: false,
      reason: "provider-startup-blocked",
    })
    expect(calls).toEqual(["provider"])
    expect(base.blockers).toEqual([
      {
        id: "provider-profile",
        status: "needs-auth",
        message: "Provider unavailable",
      },
    ])
    expect(base.desktopJobs).toEqual([])
  })

  test("prepares provider, desktop run request, run state, and runtime startup", async () => {
    const base = createBaseInput()
    const calls: Array<{
      type: "provider" | "job" | "runtime"
      input: unknown
    }> = []
    const streamEventMapper = { map: () => [] }
    const desktopRunRequest = { id: "desktop-request-1" } as any
    const runtimeStartup = {
      finalEnv: { ANTHROPIC_AUTH_TOKEN: "token-1" },
      resolvedModel: "claude-sonnet",
      isolatedConfigDir: "/tmp/config",
      isolatedConfig: {} as any,
    } as any
    const cleanupRuntimeSecrets = () => undefined
    const resolvedRuntimeSecrets: Array<{
      secretHints: readonly string[]
      cleanup: () => void
    }> = []

    const result = await prepareClaudeAgentSdkDesktopRunStartup({
      ...base.input,
      onRuntimeSecretsResolved: (input) => {
        resolvedRuntimeSecrets.push(input)
      },
      dependencies: {
        prepareProviderStartup: async (input) => {
          calls.push({ type: "provider", input })
          return {
            ok: true,
            connectionMethod: "api-key",
            startup: {
              selectedProviderProfileId: "provider-1",
              claudeCodeToken: "claude-token",
              claudeCredentialMetadata: { source: "oauth" },
              finalCustomConfig: {
                model: "claude-sonnet",
                baseUrl: "https://gateway.example",
                token: "provider-token",
                authMode: "auth_token",
              },
              isUsingOllama: false,
              secretHints: ["provider-token", "claude-token"],
              cleanupRuntimeSecrets,
            },
          }
        },
        createDesktopRunStartup: (input) => {
          calls.push({ type: "job", input })
          return {
            desktopJob: {
              jobId: "job-1",
              streamEventMapper,
            },
            desktopRunRequest,
            resumeSessionId: "resume-session",
          }
        },
        prepareRuntimeStartup: async (input) => {
          calls.push({ type: "runtime", input })
          return {
            runtimeStartup,
            isolatedConfigReady: true,
          }
        },
      },
    })

    expect(result).toEqual({
      ok: true,
      desktopRunRequest,
      resumeSessionId: "resume-session",
      connectionMethod: "api-key",
      isolatedConfigReady: true,
      runtimeStartup,
      providerStartup: {
        selectedProviderProfileId: "provider-1",
        claudeCodeToken: "claude-token",
        claudeCredentialMetadata: { source: "oauth" },
        finalCustomConfig: {
          model: "claude-sonnet",
          baseUrl: "https://gateway.example",
          token: "provider-token",
          authMode: "auth_token",
        },
        isUsingOllama: false,
        secretHints: ["provider-token", "claude-token"],
        cleanupRuntimeSecrets,
      },
    })
    expect(base.desktopJobs).toEqual([
      {
        jobId: "job-1",
        streamEventMapper,
      },
    ])
    expect(calls.map((call) => call.type)).toEqual([
      "provider",
      "job",
      "runtime",
    ])
    expect(calls[0].input).toMatchObject({
      modelSource: "profile:provider-1",
      offlineModeEnabled: false,
      emitPreflightBlocker: base.input.emitPreflightBlocker,
    })
    expect(calls[1].input).toMatchObject({
      db: base.input.db,
      cwd: "/repo",
      runId: "run-1",
      streamId: "stream-1",
      selectedProviderProfileId: "provider-1",
      requestedModel: "claude-sonnet",
      existingSessionId: "existing-session",
      secretHints: ["provider-token", "claude-token"],
    })
    expect(calls[2].input).toMatchObject({
      projectId: "project-1",
      chatId: "chat-1",
      subChatId: "sub-1",
      isUsingOllama: false,
      requestedModel: "claude-sonnet",
      enableTasks: true,
      claudeCodeToken: "claude-token",
      logPrefix: "[sub-1] ",
    })
    expect(resolvedRuntimeSecrets).toEqual([
      {
        secretHints: ["provider-token", "claude-token"],
        cleanup: cleanupRuntimeSecrets,
      },
    ])
  })

  test("stops before job creation when the exact owner changes during provider startup", async () => {
    const base = createBaseInput()
    let resolveProviderStartup!: (
      value: ClaudeAgentSdkProviderDesktopStartupResult,
    ) => void
    const providerStartup =
      new Promise<ClaudeAgentSdkProviderDesktopStartupResult>((resolve) => {
        resolveProviderStartup = resolve
      })
    const calls: string[] = []
    let cleanupCalls = 0

    const result = prepareClaudeAgentSdkDesktopRunStartup({
      ...base.input,
      dependencies: {
        prepareProviderStartup: () => {
          calls.push("provider")
          return providerStartup
        },
        createDesktopRunStartup: () => {
          calls.push("job")
          throw new Error("stale job should not be created")
        },
        prepareRuntimeStartup: async () => {
          calls.push("runtime")
          throw new Error("stale runtime startup should not run")
        },
      },
    })
    const controllerB = new AbortController()
    setActiveClaudeSession("sub-1", {
      controller: controllerB,
      runId: "run-1",
    })
    base.abortController.abort()
    resolveProviderStartup({
      ok: true,
      connectionMethod: "api-key",
      startup: {
        selectedProviderProfileId: null,
        claudeCodeToken: null,
        claudeCredentialMetadata: null,
        finalCustomConfig: null,
        isUsingOllama: false,
        secretHints: [],
        cleanupRuntimeSecrets: () => {
          cleanupCalls += 1
        },
      },
    })

    await expect(result).resolves.toEqual({
      ok: false,
      reason: "stale-active-session",
    })
    expect(calls).toEqual(["provider"])
    expect(base.desktopJobs).toEqual([])
    expect(cleanupCalls).toBe(1)
    expect(getActiveClaudeSession("sub-1")?.controller).toBe(controllerB)
    expect(controllerB.signal.aborted).toBe(false)
  })

  test("cleans resolved runtime secrets when later desktop startup fails", async () => {
    const base = createBaseInput()
    let cleanupCalls = 0
    const cleanupRuntimeSecrets = () => {
      cleanupCalls += 1
    }

    await expect(
      prepareClaudeAgentSdkDesktopRunStartup({
        ...base.input,
        dependencies: {
          prepareProviderStartup: async () => ({
            ok: true,
            connectionMethod: "custom-model",
            startup: {
              selectedProviderProfileId: "provider-1",
              claudeCodeToken: null,
              claudeCredentialMetadata: null,
              finalCustomConfig: {
                model: "claude-sonnet",
                baseUrl: "https://gateway.example",
                token: "provider-token",
                authMode: "auth_token",
              },
              isUsingOllama: false,
              secretHints: ["provider-token"],
              cleanupRuntimeSecrets,
            },
          }),
          createDesktopRunStartup: () => {
            throw new Error("desktop job failed")
          },
        },
      }),
    ).rejects.toThrow("desktop job failed")
    expect(cleanupCalls).toBe(1)
  })
})
