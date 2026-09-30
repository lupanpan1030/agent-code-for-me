/**
 * Implementer unit test for S41 "Transport forwards protocol boundary
 * shapes" (refactor-canonical-run-event-ledger codex-runtime-parity; red-
 * receipt §6 implementer-unit: spy-ledger injection on the Codex transport),
 * driven by the immutable fixture ingress-boundaries.jsonl: the Codex
 * app-server adapter forwards the resume response, a notification, a server
 * request, its response send and the resolved notification to the matching
 * ledger port exactly once, in arrival order, with an observation key and
 * the request context; resolved is not also sent as a generic notification,
 * and no thread/started or session fallback is invented for a resume.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { DesktopRunRequest } from "../src/main/lib/agent-runtime/desktop-run-request"
import { resolveDesktopPermissionPolicy } from "../src/main/lib/agent-runtime/permission-policy"
import { createCodexAppServerAdapter } from "../src/main/lib/codex/app-server-adapter"
import { ScriptedCodexAppServerTransport } from "./helpers/codex-app-server-scripted-transport"

type Json = Record<string, unknown>
type BoundaryCase = {
  caseId: string
  port: string
  observationKey: string
  input: Json
  expected: Json
}

const BOUNDARIES = readFileSync(
  join(import.meta.dir, "fixtures/run-event-ledger/ingress-boundaries.jsonl"),
  "utf8",
)
  .trim()
  .split("\n")
  .slice(1)
  .map((line) => JSON.parse(line) as BoundaryCase)

function caseOf(caseId: string): BoundaryCase {
  const found = BOUNDARIES.find((entry) => entry.caseId === caseId)
  if (!found) throw new Error(`ingress-boundaries.jsonl lacks ${caseId}`)
  return found
}

const BOUNDARY_PORTS = new Set([
  "ingestResponse",
  "ingestNotification",
  "ingestServerRequest",
  "recordServerResponseSend",
  "recordServerRequestResolved",
])

/** Records every ledger port call the adapter makes, in call order. */
function spyLedger() {
  const calls: Array<{ port: string; input: Json }> = []
  const record =
    (port: string) =>
    async (input: Json): Promise<unknown[]> => {
      calls.push({ port, input: structuredClone(input) })
      return []
    }
  const ledger = {
    addSecretHints: () => {},
    appendSystemEvent: record("appendSystemEvent"),
    ingestResponse: record("ingestResponse"),
    ingestNotification: record("ingestNotification"),
    ingestServerRequest: record("ingestServerRequest"),
    recordServerResponseSend: record("recordServerResponseSend"),
    recordServerRequestResolved: record("recordServerRequestResolved"),
    ingestTransportExit: record("ingestTransportExit"),
    ingestRuntimeObservation: record("ingestRuntimeObservation"),
    repairFromSnapshot: record("repairFromSnapshot"),
    whenIdle: async () => {},
    readUsage: async () => null,
    readNativeContext: async () => null,
  }
  return { ledger, calls }
}

function request(ledger: unknown): DesktopRunRequest {
  const resumed = caseOf("response").input.request as Json
  const threadId = String((resumed.params as Json).threadId)
  return {
    identity: { runId: "run-ingress", jobId: "job-ingress" },
    context: {
      runtimeId: "codex",
      mode: "plan",
      projectId: "project-1",
      chatId: "chat-1",
      subChatId: "sub-1",
      cwd: "/repo",
    },
    prompt: "continue",
    permissionPolicy: resolveDesktopPermissionPolicy({
      runtimeId: "codex",
      mode: "plan",
      codexAdapterSource: "codex-app-server",
    }),
    providerBinding: { authMode: "runtime-managed" },
    mcp: { status: "skipped", serverNames: [], blockers: [] },
    attachments: [],
    ledger: ledger as DesktopRunRequest["ledger"],
    signal: new AbortController().signal,
    session: { resumeSessionId: threadId, parentSessionId: threadId },
  }
}

describe("S41 Codex transport forwards protocol boundary shapes (ingress-boundaries.jsonl)", () => {
  test("each boundary reaches its ledger port once, in arrival order, with an observation key and request context", async () => {
    const response = caseOf("response")
    const notification = caseOf("notification")
    const serverRequest = caseOf("request")
    const resolved = caseOf("resolved")
    const { ledger, calls } = spyLedger()
    const transport = new ScriptedCodexAppServerTransport({
      threadResume: () => (response.input.message as Json).result,
      turn: async (scripted, threadId) => {
        scripted.emit(notification.input.message as never)
        const message = serverRequest.input.message as Json
        await scripted.emitServerRequest({
          id: message.id as number,
          method: String(message.method),
          params: message.params,
        })
        scripted.emit(resolved.input.message as never)
        scripted.emit({
          method: "turn/completed",
          params: {
            threadId,
            turn: { id: "tu", status: "completed", error: null },
          },
        })
      },
    })

    const result = await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
    }).run(request(ledger))
    expect(result).toMatchObject({ status: "succeeded" })

    const boundaryCalls = calls.filter((call) => BOUNDARY_PORTS.has(call.port))
    const fixturePorts = BOUNDARIES.map((entry) => entry.port)
    // The fixture's five boundaries, in arrival order, each exactly once;
    // the adapter's own initialize, mcpServerStatus/list and turn/start
    // responses and its terminal notification follow their arrival too.
    const ownResponses = new Set([
      "initialize",
      "mcpServerStatus/list",
      "turn/start",
    ])
    const ordered = boundaryCalls.filter(
      (call) =>
        !(
          call.port === "ingestResponse" &&
          ownResponses.has(String((call.input.request as Json)?.method))
        ) &&
        !(
          call.port === "ingestNotification" &&
          (call.input.message as Json)?.method === "turn/completed"
        ),
    )
    expect(ordered.map((call) => call.port)).toEqual(fixturePorts)
    // T2-8 / S-03: every client response is forwarded once, in request
    // order, correlated by the JSON-RPC id the transport sent it under.
    const responses = boundaryCalls.filter(
      (call) => call.port === "ingestResponse",
    )
    expect(
      responses.map((call) => (call.input.request as Json).method),
    ).toEqual([
      "initialize",
      "thread/resume",
      "mcpServerStatus/list",
      "turn/start",
    ])
    for (const call of responses) {
      const request = call.input.request as Json
      const sent = transport.requests.find(
        (entry) => entry.method === request.method,
      )
      expect(request.id).toBe(sent?.id)
      expect((call.input.message as Json).id).toBe(sent?.id)
    }

    const keys = boundaryCalls.map((call) => call.input.observationKey)
    expect(new Set(keys).size).toBe(keys.length)
    for (const call of boundaryCalls) {
      expect(typeof call.input.observationKey).toBe("string")
      expect(typeof call.input.transportId).toBe("string")
    }

    const [resumeCall] = ordered
    expect(resumeCall.input.request).toMatchObject({
      method: "thread/resume",
      params: { threadId: "th" },
      intent: "resume",
    })
    expect(resumeCall.input.message).toMatchObject({
      result: (response.input.message as Json).result,
    })
    expect((resumeCall.input.message as Json).id).toBe(
      (resumeCall.input.request as Json).id,
    )
    expect(ordered[1].input.message).toEqual(notification.input.message)
    expect(ordered[2].input.message).toMatchObject({
      id: (serverRequest.input.message as Json).id,
      method: (serverRequest.input.message as Json).method,
    })
    expect(ordered[3].input).toMatchObject({
      requestId: caseOf("send").input.requestId,
      result: caseOf("send").input.result,
    })
    expect(ordered[4].input).toMatchObject({
      requestId: resolved.input.requestId,
    })

    // resolved is forwarded once, never also as a generic notification, and a
    // resumed thread gets no invented thread/started.
    const genericMethods = calls
      .filter((call) => call.port === "ingestNotification")
      .map((call) => (call.input.message as Json).method)
    expect(genericMethods).not.toContain("serverRequest/resolved")
    expect(genericMethods).not.toContain("thread/started")
    expect(
      calls.filter((call) => call.port === "recordServerRequestResolved"),
    ).toHaveLength(1)
    // The spy committed nothing, so no validated resume triggers a repair.
    expect(calls.map((call) => call.port)).not.toContain("repairFromSnapshot")
  })
})
