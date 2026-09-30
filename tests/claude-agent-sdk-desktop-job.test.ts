import { describe, expect, test } from "bun:test"
import { resolveDesktopPermissionPolicy } from "../src/main/lib/agent-runtime/permission-policy"
import type { RuntimeExecutionProvenance } from "../src/main/lib/agent-runtime/run-event-ledger"
import type { getOrCreateRunEventLedger } from "../src/main/lib/agent-runtime/run-event-ledger-host"
import {
  completeClaudeAgentSdkDesktopJobAfterRun,
  createClaudeAgentSdkDesktopJob,
  createClaudeAgentSdkDesktopRunStartup,
  requestCancelClaudeAgentSdkDesktopJob,
} from "../src/main/lib/claude/agent-sdk-desktop-job"
import type { DesktopAgentJobHandle } from "../src/main/lib/desktop-agent-jobs"

const TEST_PROVENANCE = {
  kind: "runtime",
  installationId: "inst-claude-code-test",
  runtimeId: "claude-code",
  adapterSource: "claude-agent-sdk",
  version: "2.1.5",
  executableRef: "exe-claude-test",
  binarySha256: "c".repeat(64),
  protocolName: "claude-agent-sdk-stream-json",
  protocolVersion: "1",
  schemaFiles: [
    {
      path: "claude-agent-sdk/stream-json-messages.json",
      sha256: "d".repeat(64),
    },
  ],
} as const

/**
 * Host ledger stand-in: the desktop job setup composes the job's ledger and
 * binds the captured execution tuple through it (the design replaced the
 * former chunk mapper and trace emitter).
 */
function createLedgerStub(bound: unknown[] = []) {
  return {
    bindExecutionProvenance: async (tuple: unknown) => {
      bound.push(tuple)
      return []
    },
  }
}

describe("Claude Agent SDK desktop job setup", () => {
  test("creates a Claude desktop job, composes its ledger and binds the captured execution tuple", async () => {
    const db = {} as any
    const registrations: any[] = []
    const ledgerInputs: unknown[] = []
    const bound: unknown[] = []
    const ledger = createLedgerStub(bound)
    const cancel = () => {}

    const setup = await createClaudeAgentSdkDesktopJob({
      db,
      mode: "agent",
      chatId: "chat-1",
      subChatId: "sub-1",
      cwd: "/repo",
      prompt: "hello",
      runId: "run-1",
      cancel,
      secretHints: ["run-secret-hint"],
      dependencies: {
        createAndRegisterDesktopChatAgentJob: (dbArg, input) => {
          registrations.push({ db: dbArg, input })
          return Promise.resolve({
            job: { id: "job-1" },
            workerId: "worker-1",
            cwd: input.cwd,
          } as unknown as DesktopAgentJobHandle)
        },
        getRunEventLedger: (async (
          dbArg: unknown,
          job: unknown,
          options: unknown,
        ) => {
          ledgerInputs.push({ db: dbArg, job, options })
          return ledger
        }) as unknown as typeof getOrCreateRunEventLedger,
        captureExecutionProvenance: async () =>
          TEST_PROVENANCE as unknown as RuntimeExecutionProvenance,
      },
    })

    expect(setup.jobId).toBe("job-1")
    expect(setup.handle.workerId).toBe("worker-1")
    expect(registrations).toEqual([
      {
        db,
        input: {
          runtime: "claude-code",
          mode: "agent",
          chatId: "chat-1",
          subChatId: "sub-1",
          cwd: "/repo",
          prompt: "hello",
          runId: "run-1",
          cancel,
        },
      },
    ])
    expect(ledgerInputs).toEqual([
      {
        db,
        job: { id: "job-1" },
        options: { secretHints: ["run-secret-hint"] },
      },
    ])
    expect(setup.ledger).toBe(ledger as unknown as typeof setup.ledger)
    expect(bound).toEqual([TEST_PROVENANCE])
  })

  test("creates desktop job and DesktopRunRequest as one startup unit", async () => {
    const db = {} as any
    const cancel = () => {}
    const ledger = createLedgerStub()
    const abortController = new AbortController()
    const permissionPolicy = resolveDesktopPermissionPolicy({
      runtimeId: "claude-code",
      mode: "agent",
    })

    const startup = await createClaudeAgentSdkDesktopRunStartup({
      db,
      mode: "agent",
      chatId: "chat-1",
      subChatId: "sub-1",
      cwd: "/repo",
      prompt: "hello",
      runId: "run-1",
      cancel,
      streamId: "stream-1",
      preflight: {
        cwd: "/repo",
        chat: { id: "chat-1", projectId: "project-1" },
        subChat: { id: "sub-1", chatId: "chat-1" },
        project: { id: "project-1", path: "/repo" },
      } as any,
      permissionPolicy,
      customConfig: {
        model: "profile-model",
        baseUrl: "https://provider.example.com",
      },
      requestedModel: "request-model",
      modelSource: "provider:profile-1",
      selectedProviderProfileId: "profile-1",
      signal: abortController.signal,
      existingSessionId: "session-1",
      dependencies: {
        createAndRegisterDesktopChatAgentJob: (_dbArg, input) =>
          Promise.resolve({
            job: { id: "job-1" },
            workerId: "worker-1",
            cwd: input.cwd,
          } as unknown as DesktopAgentJobHandle),
        getRunEventLedger: (async () =>
          ledger) as unknown as typeof getOrCreateRunEventLedger,
        captureExecutionProvenance: async () =>
          TEST_PROVENANCE as unknown as RuntimeExecutionProvenance,
      },
    })

    expect(startup.desktopJob.jobId).toBe("job-1")
    expect(startup.resumeSessionId).toBe("session-1")
    expect(startup.desktopRunRequest.identity).toEqual({
      runId: "run-1",
      streamId: "stream-1",
      jobId: "job-1",
    })
    expect(startup.desktopRunRequest.context).toMatchObject({
      runtimeId: "claude-code",
      mode: "agent",
      chatId: "chat-1",
      subChatId: "sub-1",
      cwd: "/repo",
    })
    expect(startup.desktopRunRequest.providerBinding).toMatchObject({
      model: "profile-model",
      modelSource: "provider:profile-1",
      providerProfileId: "profile-1",
      gatewayEndpoint: "https://provider.example.com",
      authMode: "provider-profile",
    })
    expect(startup.desktopRunRequest.session).toEqual({
      resumeSessionId: "session-1",
      parentSessionId: "session-1",
    })
    // The request carries the job's host ledger instead of a trace emitter.
    expect(startup.desktopRunRequest.ledger).toBe(
      ledger as unknown as typeof startup.desktopRunRequest.ledger,
    )
  })

  test("completes Claude desktop jobs with runtime result metadata", async () => {
    const db = {} as any
    const completed: any[] = []
    const abortController = new AbortController()

    await completeClaudeAgentSdkDesktopJobAfterRun({
      db,
      jobId: "job-1",
      chatId: "chat-1",
      subChatId: "sub-1",
      abortSignal: abortController.signal,
      reachedNaturalFinish: true,
      sawError: false,
      dependencies: {
        completeDesktopChatAgentJobSafely: async (dbArg, input) => {
          completed.push({ db: dbArg, input })
          return null
        },
      },
    })

    expect(completed).toEqual([
      {
        db,
        input: {
          jobId: "job-1",
          runtime: "claude-code",
          aborted: false,
          reachedNaturalFinish: true,
          sawError: false,
          result: {
            runtime: "claude-code",
            subChatId: "sub-1",
            chatId: "chat-1",
          },
        },
      },
    ])
  })

  test("requests Claude desktop job cancellation as desktop chat", () => {
    const db = {} as any
    const canceled: any[] = []

    requestCancelClaudeAgentSdkDesktopJob({
      db,
      jobId: "job-1",
      reachedNaturalFinish: false,
      sawError: true,
      dependencies: {
        requestCancelDesktopChatAgentJobSafely: async (dbArg, input) => {
          canceled.push({ db: dbArg, input })
          return null
        },
      },
    })

    expect(canceled).toEqual([
      {
        db,
        input: {
          jobId: "job-1",
          sawError: true,
          reachedNaturalFinish: false,
          requestedBy: "desktop-chat",
        },
      },
    ])
  })
})
