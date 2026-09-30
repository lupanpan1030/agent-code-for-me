/**
 * Implementer unit tests for the Claude Agent SDK pre-spawn executable check
 * (refactor-canonical-run-event-ledger tasks 6.1, verification gap G4): the
 * SDK adapter re-checks the execution tuple the host bound to the Run right
 * before the SDK spawns the executable, like the process runner and the
 * Codex app-server launch. A capture-to-launch change fails closed before the
 * query starts and before any runtime record.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DesktopRunRequest } from "../src/main/lib/agent-runtime/desktop-run-request"
import { resolveDesktopPermissionPolicy } from "../src/main/lib/agent-runtime/permission-policy"
import {
  createCanonicalRunEventLedger,
  type RuntimeExecutionProvenance,
} from "../src/main/lib/agent-runtime/run-event-ledger"
import type { getOrCreateRunEventLedger } from "../src/main/lib/agent-runtime/run-event-ledger-host"
import { captureRunExecutionProvenance } from "../src/main/lib/agent-runtime/run-provenance"
import {
  clearClaudeActiveSessionsForTest,
  setActiveClaudeSession,
} from "../src/main/lib/claude/active-sessions"
import {
  ClaudeAgentSdkQueryStartError,
  createClaudeAgentSdkAdapter,
} from "../src/main/lib/claude/agent-sdk-adapter"
import { runClaudeAgentSdkAdapterWithPolicyRetry } from "../src/main/lib/claude/agent-sdk-adapter-runner"
import { createClaudeAgentSdkDesktopRunStartup } from "../src/main/lib/claude/agent-sdk-desktop-job"
import { createClaudeAgentSdkPolicyRetryState } from "../src/main/lib/claude/agent-sdk-policy-retry"
import type { ClaudeAgentSdkQuery } from "../src/main/lib/claude/agent-sdk-query-loader"
import type { ClaudeAgentSdkQueryParams } from "../src/main/lib/claude/agent-sdk-query-options"
import type { DesktopAgentJobHandle } from "../src/main/lib/desktop-agent-jobs"

type LedgerRow = { sequence: number; type: string; payload?: unknown }

const directories: string[] = []
afterEach(() => {
  clearClaudeActiveSessionsForTest()
  while (directories.length > 0) {
    rmSync(directories.pop() as string, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "claude-exe-check-"))
  directories.push(directory)
  return directory
}

async function capturedExecutable(content = "#!/bin/sh\necho claude\n") {
  const directory = tempDir()
  const executablePath = join(directory, "claude")
  writeFileSync(executablePath, content, { mode: 0o755 })
  const provenance = await captureRunExecutionProvenance({
    runtimeId: "claude-code",
    adapterSource: "claude-agent-sdk",
    version: "2.1.5",
    protocolName: "claude-agent-sdk-stream-json",
    protocolVersion: "1",
    executablePath,
    schemaDocuments: [
      { path: "claude-agent-sdk/stream-json-messages.json", content: "{}" },
    ],
  })
  return { directory, executablePath, provenance }
}

/** In-memory host ledger of one Run bound to `provenance`. */
function boundLedger(runId: string, provenance: RuntimeExecutionProvenance) {
  const rows: LedgerRow[] = []
  const ledger = createCanonicalRunEventLedger({
    runId,
    runtimeId: "claude-code",
    provenance,
    durableStore: {
      appendExact(input: { records: unknown[] }) {
        rows.push(...(input.records as LedgerRow[]))
        return input.records
      },
      read(_runId: string, after = 0) {
        return rows.filter((row) => row.sequence > after)
      },
    },
  })
  return { ledger, rows }
}

function createRequest(input: {
  ledger: unknown
  executionProvenance: RuntimeExecutionProvenance | null
}): DesktopRunRequest {
  const controller = new AbortController()
  setActiveClaudeSession("sub-exe", { controller, runId: "run-exe" })
  return {
    identity: { runId: "run-exe", jobId: "job-exe" },
    context: {
      runtimeId: "claude-code",
      mode: "agent",
      projectId: "project-1",
      chatId: "chat-1",
      subChatId: "sub-exe",
      cwd: "/repo",
    },
    prompt: "hello",
    permissionPolicy: resolveDesktopPermissionPolicy({
      runtimeId: "claude-code",
      mode: "agent",
    }),
    providerBinding: {},
    mcp: { status: "skipped", serverNames: [], blockers: [] },
    attachments: [],
    ledger: input.ledger as DesktopRunRequest["ledger"],
    executionProvenance: input.executionProvenance,
    signal: controller.signal,
    session: {},
  }
}

async function* initStream() {
  yield { type: "system", subtype: "init", session_id: "session-exe" }
  yield { type: "result", subtype: "success", session_id: "session-exe" }
}

function recordingAdapter(executablePath: string) {
  const queryCalls: unknown[] = []
  const queryOptions = {
    prompt: "hello",
    options: { pathToClaudeCodeExecutable: executablePath },
  } as unknown as ClaudeAgentSdkQueryParams
  const adapter = createClaudeAgentSdkAdapter({
    query: ((params: unknown) => {
      queryCalls.push(params)
      return initStream()
    }) as unknown as ClaudeAgentSdkQuery,
    queryOptions,
    consumeStream: async ({ stream }) => {
      for await (const _message of stream) {
        // drain
      }
      return { status: "succeeded" }
    },
    isRequestAuthoritative: () => true,
  })
  return { adapter, queryCalls }
}

async function runError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  return null
}

function adapterStartedOnly(rows: LedgerRow[]) {
  return rows.map((row) => ({
    type: row.type,
    status: (row.payload as Record<string, unknown> | undefined)?.status,
  }))
}

describe("Claude Agent SDK pre-spawn executable check", () => {
  test("an unchanged bound executable starts the query and its runtime records follow", async () => {
    const { executablePath, provenance } = await capturedExecutable()
    const { ledger, rows } = boundLedger("run-exe", provenance)
    const { adapter, queryCalls } = recordingAdapter(executablePath)

    const result = await adapter.run(
      createRequest({ ledger, executionProvenance: provenance }),
    )
    await ledger.whenIdle()

    expect(result).toEqual({ status: "succeeded" })
    expect(queryCalls).toHaveLength(1)
    expect(rows.map((row) => row.type)).toContain("status")
    expect(rows.length).toBeGreaterThan(1)
  })

  test("executable bytes changed after capture fail closed before the SDK spawns, with no runtime record", async () => {
    const { executablePath, provenance } = await capturedExecutable()
    const { ledger, rows } = boundLedger("run-exe", provenance)
    const { adapter, queryCalls } = recordingAdapter(executablePath)
    writeFileSync(executablePath, "#!/bin/sh\necho tampered\n")

    const error = await runError(() =>
      adapter.run(createRequest({ ledger, executionProvenance: provenance })),
    )
    await ledger.whenIdle()

    expect(error).toBeInstanceOf(ClaudeAgentSdkQueryStartError)
    expect(
      String((error as ClaudeAgentSdkQueryStartError).originalError),
    ).toContain("changed between capture and launch")
    expect(queryCalls).toEqual([])
    // Only the host adapter-started fact exists: no runtime observation.
    expect(adapterStartedOnly(rows)).toEqual([
      { type: "status", status: "desktop_runtime_adapter_started" },
    ])
  })

  test("a query configured with a different executable path or an unknown executable reference fails closed", async () => {
    const captured = await capturedExecutable()
    const sibling = join(captured.directory, "claude-copy")
    writeFileSync(sibling, "#!/bin/sh\necho claude\n", { mode: 0o755 })
    const { ledger } = boundLedger("run-exe", captured.provenance)

    const other = recordingAdapter(sibling)
    const pathError = await runError(() =>
      other.adapter.run(
        createRequest({ ledger, executionProvenance: captured.provenance }),
      ),
    )
    expect(
      String((pathError as ClaudeAgentSdkQueryStartError).originalError),
    ).toContain("differs from the executable captured")
    expect(other.queryCalls).toEqual([])

    const unknown = recordingAdapter(captured.executablePath)
    const unknownError = await runError(() =>
      unknown.adapter.run(
        createRequest({
          ledger,
          executionProvenance: {
            ...captured.provenance,
            executableRef: "exe-never-captured-by-this-host",
          },
        }),
      ),
    )
    expect(
      String((unknownError as ClaudeAgentSdkQueryStartError).originalError),
    ).toContain("unknown to this host")
    expect(unknown.queryCalls).toEqual([])
  })

  test("the policy-retry runner reports a failed start instead of retrying a tampered executable", async () => {
    const { executablePath, provenance } = await capturedExecutable()
    const { ledger } = boundLedger("run-exe", provenance)
    const { adapter, queryCalls } = recordingAdapter(executablePath)
    writeFileSync(executablePath, "#!/bin/sh\necho tampered\n")
    const errors: string[] = []
    const emitted: unknown[] = []

    const result = await runClaudeAgentSdkAdapterWithPolicyRetry({
      adapter,
      request: createRequest({ ledger, executionProvenance: provenance }),
      policyRetry: createClaudeAgentSdkPolicyRetryState(),
      beforeAttempt: () => {},
      getChunkCount: () => 0,
      subId: "sub-exe",
      emitError: (_error, context) => {
        errors.push(context)
      },
      emit: (chunk) => {
        emitted.push(chunk)
      },
      complete: () => {},
      log: () => {},
      error: () => {},
      isRequestAuthoritative: () => true,
    })

    expect(result).toEqual({
      status: "failed",
      error: { message: "SDK query error" },
    })
    expect(errors).toEqual(["Failed to start Claude query"])
    expect(queryCalls).toEqual([])
  })

  test("the desktop run startup hands the bound tuple to the request the SDK adapter checks", async () => {
    const { provenance } = await capturedExecutable()
    const bound: unknown[] = []
    const ledger = {
      bindExecutionProvenance: async (tuple: unknown) => {
        bound.push(tuple)
        return []
      },
    }
    const startup = await createClaudeAgentSdkDesktopRunStartup({
      db: {} as never,
      mode: "agent",
      chatId: "chat-1",
      subChatId: "sub-1",
      cwd: "/repo",
      prompt: "hello",
      runId: "run-1",
      cancel: () => {},
      streamId: "stream-1",
      preflight: {
        cwd: "/repo",
        chat: { id: "chat-1", projectId: "project-1" },
        subChat: { id: "sub-1", chatId: "chat-1" },
        project: { id: "project-1", path: "/repo" },
      } as never,
      permissionPolicy: resolveDesktopPermissionPolicy({
        runtimeId: "claude-code",
        mode: "agent",
      }),
      signal: new AbortController().signal,
      dependencies: {
        createAndRegisterDesktopChatAgentJob: (_db, input) =>
          Promise.resolve({
            job: { id: "job-1" },
            workerId: "worker-1",
            cwd: input.cwd,
          } as unknown as DesktopAgentJobHandle),
        getRunEventLedger: (async () =>
          ledger) as unknown as typeof getOrCreateRunEventLedger,
        captureExecutionProvenance: async () => provenance,
      },
    })

    expect(bound).toEqual([provenance])
    expect(startup.desktopJob.executionProvenance).toBe(provenance)
    expect(startup.desktopRunRequest.executionProvenance).toBe(provenance)
  })
})
