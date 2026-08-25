import { describe, expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { eq } from "drizzle-orm"
import {
  agentProviderDefaults,
  agentProviderProfiles,
} from "../src/main/lib/db/schema"
import type { AgentRuntimeRunRequest } from "../src/main/lib/headless/agent-runtime-contract"
import { runPersistedAgentJob } from "../src/main/lib/headless/job-runner"
import {
  appendAgentJobEvent,
  completeAgentJob,
  createAgentJob,
  getAgentJob,
  listAgentJobEvents,
  retryAgentJob,
} from "../src/main/lib/headless/job-store"
import { toLocalJobApiResultEnvelope } from "../src/main/lib/headless/local-job-api"
import {
  assertHeadlessProviderSelectionUsableAtCreate,
  type HeadlessProviderBindingDependencies,
  HeadlessProviderBindingError,
  resolveHeadlessProviderBinding,
} from "../src/main/lib/headless/provider-binding"
import { EXACT_SECRET_REDACTION_MARKER } from "../src/shared/secret-redaction-policy"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

function seedProviderProfile(
  db: ReturnType<typeof createAgentJobTestDb>,
  input: {
    id: string
    targets: string[]
    model?: string
    baseUrl?: string
    authMode?: "bearer" | "x-api-key" | "none"
    encryptedToken?: string | null
  },
) {
  db.insert(agentProviderProfiles)
    .values({
      id: input.id,
      name: input.id,
      protocol: "openai-responses",
      baseUrl: input.baseUrl ?? "https://provider.example.com/v1",
      defaultModel: input.model ?? "provider-default-model",
      authMode: input.authMode ?? "none",
      encryptedToken: input.encryptedToken ?? null,
      targetRuntimesJson: JSON.stringify(input.targets),
      capabilitiesJson: "{}",
    })
    .run()
}

function seedDefault(
  db: ReturnType<typeof createAgentJobTestDb>,
  profileId: string,
  modelOverride: string | null = null,
) {
  db.insert(agentProviderDefaults)
    .values({
      purpose: "codex-main",
      profileId,
      modelOverride,
    })
    .run()
}

function gatewayDependencies(
  events: string[] = [],
): HeadlessProviderBindingDependencies {
  return {
    async createGatewayEndpoint(profileId, kind) {
      events.push(`create:${profileId}:${kind}`)
      return {
        providerId: profileId,
        baseUrl: `http://127.0.0.1:1234/profile/${profileId}/${kind}/v1`,
        token: `token-for-${profileId}`,
      }
    },
    revokeGatewayToken(token) {
      events.push(`revoke:${token}`)
      return true
    },
  }
}

const LOCAL_ONLY_ENV_KEYS = [
  "LOCUS_LOCAL_ONLY",
  "AGENT_CODE_FOR_ME_LOCAL_ONLY",
  "ONECODE_LOCAL_ONLY",
  "MAIN_VITE_LOCAL_ONLY",
] as const

async function withLocalOnlyEnabled<T>(run: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(
    LOCAL_ONLY_ENV_KEYS.map((key) => [key, process.env[key]]),
  )
  for (const key of LOCAL_ONLY_ENV_KEYS) delete process.env[key]
  try {
    return await run()
  } finally {
    for (const key of LOCAL_ONLY_ENV_KEYS) {
      const value = previous[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe("headless provider binding", () => {
  test("keeps runtime-registered native credentials redacted through terminal materialization", async () => {
    const db = createAgentJobTestDb()
    const nativeOAuthToken = randomBytes(32).toString("hex")
    const job = createAgentJob(db, {
      source: "api",
      runtime: "claude-code",
      mode: "agent",
      cwd: process.cwd(),
      prompt: "Try to echo the native OAuth token",
    })

    const result = await runPersistedAgentJob({
      db,
      jobId: job.id,
      runner: async (_request, observer) => {
        observer.registerSecretHints([nativeOAuthToken])
        const split = Math.floor(nativeOAuthToken.length / 2)
        observer.appendEvent("assistant_delta", {
          text: nativeOAuthToken.slice(0, split),
        })
        observer.appendEvent("assistant_delta", {
          text: nativeOAuthToken.slice(split),
        })
        return {
          status: "failed",
          exitCode: 1,
          errorCode: `runtime_failed_${nativeOAuthToken}`,
          errorMessage: `runtime echoed ${nativeOAuthToken}`,
          result: { finalMessage: `terminal ${nativeOAuthToken}` },
        }
      },
    })

    const persistedAndPublic = JSON.stringify({
      job: result.job,
      events: result.events,
      api: toLocalJobApiResultEnvelope(result.job, [], result.events),
    })
    expect(persistedAndPublic).not.toContain(nativeOAuthToken)
    expect(persistedAndPublic).toContain(EXACT_SECRET_REDACTION_MARKER)
  })

  test("resolves explicit profile refs through a scoped gateway token", async () => {
    const db = createAgentJobTestDb()
    const events: string[] = []
    seedProviderProfile(db, {
      id: "codex-main",
      targets: ["codex"],
      model: "gpt-5.3-codex",
    })

    const resolved = await resolveHeadlessProviderBinding({
      db,
      runtime: "codex",
      providerProfileId: "codex-main",
      modelOverride: "gpt-5.4",
      dependencies: gatewayDependencies(events),
    })

    expect(resolved.resolvedProvider).toEqual({
      source: "request-profile",
      profileId: "codex-main",
      model: "gpt-5.4",
    })
    expect(resolved.providerBinding).toMatchObject({
      authMode: "provider-profile",
      providerProfileId: "codex-main",
      model: "gpt-5.4",
      gatewayToken: "token-for-codex-main",
    })
    resolved.cleanup()
    expect(events).toEqual([
      "create:codex-main:responses",
      "revoke:token-for-codex-main",
    ])
  })

  test("uses headless defaults only when no explicit model or profile was provided", async () => {
    const db = createAgentJobTestDb()
    const events: string[] = []
    seedProviderProfile(db, {
      id: "codex-default",
      targets: ["codex"],
      model: "gpt-default",
    })
    seedDefault(db, "codex-default", "gpt-default-override")

    const defaultResolved = await resolveHeadlessProviderBinding({
      db,
      runtime: "codex",
      dependencies: gatewayDependencies(events),
    })
    expect(defaultResolved.resolvedProvider).toEqual({
      source: "default-profile",
      profileId: "codex-default",
      model: "gpt-default-override",
    })

    const modelOnly = await resolveHeadlessProviderBinding({
      db,
      runtime: "codex",
      modelOverride: "gpt-native",
      dependencies: gatewayDependencies(events),
    })
    expect(modelOnly.resolvedProvider).toEqual({
      source: "native",
      profileId: null,
      model: "gpt-native",
    })
    expect(modelOnly.providerBinding).toMatchObject({
      authMode: "runtime-managed",
      model: "gpt-native",
    })
    expect(events).toEqual(["create:codex-default:responses"])
  })

  test.each([
    { source: "explicit", providerProfileId: "codex-blocked" },
    { source: "default", providerProfileId: undefined },
  ] as const)("blocks a $source hosted profile before creating a local gateway", async ({
    providerProfileId,
  }) => {
    await withLocalOnlyEnabled(async () => {
      const db = createAgentJobTestDb()
      seedProviderProfile(db, {
        id: "codex-blocked",
        targets: ["codex"],
        baseUrl: "https://api.1code.dev/v1",
      })
      if (!providerProfileId) seedDefault(db, "codex-blocked")

      let gatewayCreateCount = 0
      let runnerCalled = false
      const job = createAgentJob(db, {
        source: "api",
        runtime: "codex",
        mode: "agent",
        cwd: process.cwd(),
        prompt: "Do not reach the hosted provider",
        providerProfileId,
      })
      const result = await runPersistedAgentJob({
        db,
        jobId: job.id,
        providerBindingDependencies: {
          async createGatewayEndpoint() {
            gatewayCreateCount += 1
            throw new Error("gateway must not be created")
          },
        },
        runner: async () => {
          runnerCalled = true
          return { status: "succeeded", exitCode: 0 }
        },
      })

      expect(gatewayCreateCount).toBe(0)
      expect(runnerCalled).toBe(false)
      expect(result.exitCode).toBe(6)
      expect(result.job).toMatchObject({
        status: "failed",
        errorCode: "local_only_guard_blocked",
      })
    })
  })

  test("fails closed for missing or target-mismatched explicit profiles at create time", () => {
    const db = createAgentJobTestDb()
    seedProviderProfile(db, {
      id: "claude-only",
      targets: ["claude"],
    })

    expect(() =>
      assertHeadlessProviderSelectionUsableAtCreate({
        db,
        runtime: "codex",
        providerProfileId: "missing-profile",
      }),
    ).toThrow(HeadlessProviderBindingError)

    try {
      assertHeadlessProviderSelectionUsableAtCreate({
        db,
        runtime: "codex",
        providerProfileId: "claude-only",
      })
      throw new Error("expected mismatch")
    } catch (error) {
      expect(error).toBeInstanceOf(HeadlessProviderBindingError)
      expect((error as HeadlessProviderBindingError).code).toBe(
        "provider_profile_runtime_mismatch",
      )
    }
  })

  test("wraps runtime profile resolution failures as provider unavailable", async () => {
    const db = createAgentJobTestDb()
    try {
      await resolveHeadlessProviderBinding({
        db,
        runtime: "codex",
        providerProfileId: "codex-main",
        dependencies: {
          getProviderProfileRuntimeConfig: () => {
            throw new Error("secure storage unavailable")
          },
        },
      })
      throw new Error("expected unavailable")
    } catch (error) {
      expect(error).toBeInstanceOf(HeadlessProviderBindingError)
      expect((error as HeadlessProviderBindingError).code).toBe(
        "provider_profile_unavailable",
      )
    }
  })

  test("retains the default profile id when default profile runtime config is unavailable", async () => {
    const db = createAgentJobTestDb()
    seedProviderProfile(db, {
      id: "codex-default",
      targets: ["codex"],
      authMode: "bearer",
      encryptedToken: null,
    })
    seedDefault(db, "codex-default")

    try {
      await resolveHeadlessProviderBinding({
        db,
        runtime: "codex",
        dependencies: gatewayDependencies([]),
      })
      throw new Error("expected unavailable default")
    } catch (error) {
      expect(error).toBeInstanceOf(HeadlessProviderBindingError)
      expect((error as HeadlessProviderBindingError).code).toBe(
        "provider_profile_unavailable",
      )
      expect((error as HeadlessProviderBindingError).source).toBe(
        "default-profile",
      )
      expect((error as HeadlessProviderBindingError).profileId).toBe(
        "codex-default",
      )
    }
  })

  test("runner injects resolved bindings and revokes scoped tokens at terminal state", async () => {
    const db = createAgentJobTestDb()
    const events: string[] = []
    let capturedRequest: AgentRuntimeRunRequest | null = null
    seedProviderProfile(db, {
      id: "codex-default",
      targets: ["codex"],
      model: "gpt-default",
    })
    seedDefault(db, "codex-default")
    const job = createAgentJob(db, {
      source: "cli",
      runtime: "codex",
      mode: "agent",
      cwd: process.cwd(),
      prompt: "Run with defaults",
    })

    const result = await runPersistedAgentJob({
      db,
      jobId: job.id,
      providerBindingDependencies: gatewayDependencies(events),
      runner: async (request) => {
        capturedRequest = request
        return {
          status: "succeeded",
          exitCode: 0,
          result: {
            finalMessage: "done",
          },
        }
      },
    })

    expect(result.exitCode).toBe(0)
    expect(capturedRequest?.providerBinding).toMatchObject({
      providerProfileId: "codex-default",
      gatewayToken: "token-for-codex-default",
      authMode: "provider-profile",
    })
    expect(JSON.parse(result.job.resultJson ?? "{}")).toMatchObject({
      finalMessage: "done",
      resolvedProvider: {
        source: "default-profile",
        profileId: "codex-default",
        model: "gpt-default",
      },
    })
    expect(JSON.stringify(result.events)).not.toContain(
      "token-for-codex-default",
    )
    expect(events).toEqual([
      "create:codex-default:responses",
      "revoke:token-for-codex-default",
    ])
  })

  test("redacts a bare scoped gateway token from events, terminal storage, and API results", async () => {
    const db = createAgentJobTestDb()
    const gatewayToken = randomBytes(32).toString("hex")
    const gatewayLifecycle: string[] = []
    seedProviderProfile(db, {
      id: "codex-default",
      targets: ["codex"],
      model: "gpt-default",
    })
    seedDefault(db, "codex-default")
    const job = createAgentJob(db, {
      source: "api",
      runtime: "codex",
      mode: "agent",
      cwd: process.cwd(),
      prompt: "Try to echo the scoped gateway token",
    })

    const result = await runPersistedAgentJob({
      db,
      jobId: job.id,
      providerBindingDependencies: {
        async createGatewayEndpoint(profileId, kind) {
          gatewayLifecycle.push(`create:${profileId}:${kind}`)
          return {
            providerId: profileId,
            baseUrl: `http://127.0.0.1:1234/profile/${profileId}/${kind}/v1`,
            token: gatewayToken,
          }
        },
        revokeGatewayToken(token) {
          expect(token).toBe(gatewayToken)
          gatewayLifecycle.push("revoke")
          return true
        },
      },
      runner: async (request, observer) => {
        expect(request.providerBinding?.gatewayToken).toBe(gatewayToken)
        observer.appendEvent("assistant_delta", {
          text: `adapter emitted ${gatewayToken} without a secret label`,
        })
        observer.appendEvent("command_output", {
          stream: "stderr",
          text: `child stderr contained ${gatewayToken}`,
        })
        return {
          status: "failed",
          exitCode: 1,
          errorCode: `runtime_failed_${gatewayToken}`,
          errorMessage: `runtime failed after echoing ${gatewayToken}`,
          result: {
            finalMessage: `final output repeated ${gatewayToken}`,
            nested: [`bare value: ${gatewayToken}`],
          },
        }
      },
    })

    const apiEnvelope = toLocalJobApiResultEnvelope(
      result.job,
      [],
      result.events,
    )
    const persistedAndPublic = JSON.stringify({
      errorMessage: result.job.errorMessage,
      resultJson: result.job.resultJson,
      events: result.events,
      apiEnvelope,
    })

    expect(result.job.errorMessage).toBe(
      `runtime failed after echoing ${EXACT_SECRET_REDACTION_MARKER}`,
    )
    expect(result.job.errorCode).toBe(
      `runtime_failed_${EXACT_SECRET_REDACTION_MARKER}`,
    )
    expect(JSON.parse(result.job.resultJson ?? "{}")).toMatchObject({
      finalMessage: `final output repeated ${EXACT_SECRET_REDACTION_MARKER}`,
      nested: [`bare value: ${EXACT_SECRET_REDACTION_MARKER}`],
    })
    expect(persistedAndPublic).not.toContain(gatewayToken)
    expect(persistedAndPublic).toContain(EXACT_SECRET_REDACTION_MARKER)
    expect(gatewayLifecycle).toEqual([
      "create:codex-default:responses",
      "revoke",
    ])
  })

  test("keeps the upstream profile token main-process-only and redacts successful Local Job output", async () => {
    const db = createAgentJobTestDb()
    const upstreamToken = randomBytes(32).toString("hex")
    const gatewayToken = randomBytes(32).toString("hex")
    const lifecycle: string[] = []
    seedProviderProfile(db, {
      id: "codex-upstream-canary",
      targets: ["codex"],
      model: "gpt-canary",
    })
    const job = createAgentJob(db, {
      source: "api",
      runtime: "codex",
      mode: "agent",
      cwd: process.cwd(),
      prompt: "Return a successful upstream-token canary",
      providerProfileId: "codex-upstream-canary",
    })

    const result = await runPersistedAgentJob({
      db,
      jobId: job.id,
      providerBindingDependencies: {
        getProviderProfileRuntimeConfig: (_db, profileId) => ({
          id: profileId,
          name: "Upstream canary",
          presetId: null,
          protocol: "openai-responses",
          baseUrl: "https://provider.example.com/v1",
          defaultModel: "gpt-canary",
          authMode: "bearer",
          token: upstreamToken,
          headers: {},
          targetRuntimes: ["codex"],
          capabilities: {},
        }),
        async createGatewayEndpoint(profileId, kind) {
          lifecycle.push(`create:${profileId}:${kind}`)
          return {
            providerId: profileId,
            baseUrl: `http://127.0.0.1:1234/profile/${profileId}/${kind}/v1`,
            token: gatewayToken,
          }
        },
        revokeGatewayToken(token) {
          expect(token).toBe(gatewayToken)
          const terminalJob = getAgentJob(db, job.id)
          expect(terminalJob?.status).toBe("succeeded")
          expect(terminalJob?.resultJson).not.toContain(upstreamToken)
          expect(terminalJob?.resultJson).not.toContain(gatewayToken)
          expect(JSON.stringify(listAgentJobEvents(db, job.id))).not.toContain(
            upstreamToken,
          )
          lifecycle.push("revoke")
          return true
        },
      },
      runner: async (request, observer) => {
        expect(JSON.stringify(request.providerBinding)).not.toContain(
          upstreamToken,
        )
        expect(request.providerBinding?.gatewayToken).toBe(gatewayToken)
        const upstreamSplit = 17
        const gatewaySplit = 19
        for (const text of [
          `successful response echoed ${upstreamToken.slice(0, upstreamSplit)}`,
          `${upstreamToken.slice(upstreamSplit)} and ${gatewayToken.slice(0, gatewaySplit)}`,
          gatewayToken.slice(gatewaySplit),
        ]) {
          observer.appendEvent("assistant_delta", { text })
        }
        for (const text of [
          `stderr echoed ${upstreamToken.slice(0, upstreamSplit)}`,
          upstreamToken.slice(upstreamSplit),
        ]) {
          observer.appendEvent("command_output", {
            stream: "stderr",
            text,
          })
        }
        observer.appendEvent("tool_finished", {
          toolCallId: "tool-upstream-canary",
          output: `tool output echoed ${upstreamToken}`,
        })
        return {
          status: "succeeded",
          exitCode: 0,
          result: {
            finalMessage: `success ${upstreamToken}`,
            toolOutput: `tool success ${upstreamToken} ${gatewayToken}`,
          },
        }
      },
    })

    const apiEnvelope = toLocalJobApiResultEnvelope(
      result.job,
      [],
      result.events,
    )
    const persistedAndPublic = JSON.stringify({
      job: result.job,
      events: result.events,
      apiEnvelope,
    })

    expect(result.exitCode).toBe(0)
    expect(persistedAndPublic).not.toContain(upstreamToken)
    expect(persistedAndPublic).not.toContain(gatewayToken)
    expect(persistedAndPublic).toContain(EXACT_SECRET_REDACTION_MARKER)
    expect(
      result.events
        .filter((event) => event.type === "assistant_delta")
        .map((event) => JSON.parse(event.payloadJson).text ?? "")
        .join(""),
    ).toBe(
      `successful response echoed ${EXACT_SECRET_REDACTION_MARKER} and ${EXACT_SECRET_REDACTION_MARKER}`,
    )
    expect(
      result.events
        .filter((event) => event.type === "command_output")
        .map((event) => JSON.parse(event.payloadJson).text ?? "")
        .join(""),
    ).toBe(`stderr echoed ${EXACT_SECRET_REDACTION_MARKER}`)
    expect(JSON.parse(result.job.resultJson ?? "{}")).toMatchObject({
      finalMessage: `success ${EXACT_SECRET_REDACTION_MARKER}`,
      toolOutput: `tool success ${EXACT_SECRET_REDACTION_MARKER} ${EXACT_SECRET_REDACTION_MARKER}`,
      resolvedProvider: {
        source: "request-profile",
        profileId: "codex-upstream-canary",
        model: "gpt-canary",
      },
    })
    expect(lifecycle).toEqual([
      "create:codex-upstream-canary:responses",
      "revoke",
    ])
  })

  test("redacts an upstream token echoed before gateway resolution completes", async () => {
    const db = createAgentJobTestDb()
    const upstreamToken = randomBytes(32).toString("hex")
    seedProviderProfile(db, {
      id: "codex-gateway-failure",
      targets: ["codex"],
      model: "gpt-canary",
    })
    const job = createAgentJob(db, {
      source: "api",
      runtime: "codex",
      mode: "agent",
      cwd: process.cwd(),
      prompt: "Fail before gateway resolution",
      providerProfileId: "codex-gateway-failure",
    })
    let runnerCalled = false

    const result = await runPersistedAgentJob({
      db,
      jobId: job.id,
      providerBindingDependencies: {
        getProviderProfileRuntimeConfig: (_db, profileId) => ({
          id: profileId,
          name: "Gateway failure canary",
          presetId: null,
          protocol: "openai-responses",
          baseUrl: "https://provider.example.com/v1",
          defaultModel: "gpt-canary",
          authMode: "bearer",
          token: upstreamToken,
          headers: {},
          targetRuntimes: ["codex"],
          capabilities: {},
        }),
        createGatewayEndpoint: async () => {
          throw new Error(`gateway startup echoed ${upstreamToken}`)
        },
      },
      runner: async () => {
        runnerCalled = true
        return { status: "succeeded", exitCode: 0 }
      },
    })

    const apiEnvelope = toLocalJobApiResultEnvelope(
      result.job,
      [],
      result.events,
    )
    const persistedAndPublic = JSON.stringify({
      job: result.job,
      events: result.events,
      apiEnvelope,
    })
    expect(runnerCalled).toBe(false)
    expect(result.job).toMatchObject({
      status: "failed",
      errorCode: "provider_profile_unavailable",
      errorMessage: `gateway startup echoed ${EXACT_SECRET_REDACTION_MARKER}`,
    })
    expect(persistedAndPublic).not.toContain(upstreamToken)
    expect(persistedAndPublic).toContain(EXACT_SECRET_REDACTION_MARKER)
  })

  test("runner revokes scoped tokens on failure and cancellation", async () => {
    const db = createAgentJobTestDb()
    const events: string[] = []
    seedProviderProfile(db, {
      id: "codex-default",
      targets: ["codex"],
      model: "gpt-default",
    })
    seedDefault(db, "codex-default")

    const failedJob = createAgentJob(db, {
      source: "cli",
      runtime: "codex",
      mode: "agent",
      cwd: process.cwd(),
      prompt: "Run and fail",
    })
    const failed = await runPersistedAgentJob({
      db,
      jobId: failedJob.id,
      providerBindingDependencies: gatewayDependencies(events),
      runner: async () => ({
        status: "failed",
        exitCode: 1,
        errorCode: "runtime_failed",
        errorMessage: "failed after provider work",
      }),
    })
    expect(failed.job.status).toBe("failed")

    const canceledJob = createAgentJob(db, {
      source: "cli",
      runtime: "codex",
      mode: "agent",
      cwd: process.cwd(),
      prompt: "Run and cancel",
    })
    const canceled = await runPersistedAgentJob({
      db,
      jobId: canceledJob.id,
      providerBindingDependencies: gatewayDependencies(events),
      runner: async () => ({
        status: "canceled",
        exitCode: 5,
      }),
    })
    expect(canceled.job.status).toBe("canceled")
    expect(events).toEqual([
      "create:codex-default:responses",
      "revoke:token-for-codex-default",
      "create:codex-default:responses",
      "revoke:token-for-codex-default",
    ])
  })

  test("waits for runner cancellation cleanup before terminal state and credential revocation", async () => {
    const db = createAgentJobTestDb()
    const lifecycle: string[] = []
    const externalAbort = new AbortController()
    let markRunnerStarted: () => void = () => {}
    const runnerStarted = new Promise<void>((resolve) => {
      markRunnerStarted = resolve
    })
    let markRunnerSawAbort: () => void = () => {}
    const runnerSawAbort = new Promise<void>((resolve) => {
      markRunnerSawAbort = resolve
    })
    let releaseRunnerCleanup: () => void = () => {}
    const runnerCleanupGate = new Promise<void>((resolve) => {
      releaseRunnerCleanup = resolve
    })
    seedProviderProfile(db, {
      id: "codex-cancel-order",
      targets: ["codex"],
      model: "gpt-cancel-order",
    })
    const job = createAgentJob(db, {
      source: "cli",
      runtime: "codex",
      mode: "agent",
      cwd: process.cwd(),
      prompt: "Cancel after the runner starts",
      providerProfileId: "codex-cancel-order",
    })

    const runPromise = runPersistedAgentJob({
      db,
      jobId: job.id,
      signal: externalAbort.signal,
      providerBindingDependencies: {
        async createGatewayEndpoint(profileId, kind) {
          lifecycle.push("credential-created")
          return {
            providerId: profileId,
            baseUrl: `http://127.0.0.1:1234/profile/${profileId}/${kind}/v1`,
            token: "cancel-order-token",
          }
        },
        revokeGatewayToken() {
          lifecycle.push("credential-revoked")
          expect(lifecycle).toContain("runner-finally")
          expect(getAgentJob(db, job.id)?.status).toBe("canceled")
          return true
        },
      },
      runner: async (request) => {
        lifecycle.push("runner-started")
        markRunnerStarted()
        await new Promise<void>((resolve) => {
          if (request.signal.aborted) resolve()
          else
            request.signal.addEventListener("abort", () => resolve(), {
              once: true,
            })
        })
        lifecycle.push("runner-saw-abort")
        markRunnerSawAbort()
        try {
          await runnerCleanupGate
        } finally {
          lifecycle.push("runner-finally")
        }
        return { status: "canceled", exitCode: 5 }
      },
    })

    await runnerStarted
    externalAbort.abort()
    await runnerSawAbort

    expect(getAgentJob(db, job.id)).toMatchObject({
      status: "running",
      finishedAt: null,
    })
    expect(lifecycle).not.toContain("credential-revoked")

    releaseRunnerCleanup()
    const result = await runPromise

    expect(result.job).toMatchObject({
      status: "canceled",
      errorCode: "job_canceled",
    })
    expect(lifecycle).toEqual([
      "credential-created",
      "runner-started",
      "runner-saw-abort",
      "runner-finally",
      "credential-revoked",
    ])
  })

  test("keeps interleaved toolCallId streams isolated and flushes the matching tool before finish", async () => {
    const db = createAgentJobTestDb()
    const upstreamToken = randomBytes(32).toString("hex")
    const gatewayToken = randomBytes(32).toString("hex")
    seedProviderProfile(db, {
      id: "codex-tool-streams",
      targets: ["codex"],
      model: "gpt-tool-streams",
    })
    const job = createAgentJob(db, {
      source: "api",
      runtime: "codex",
      mode: "agent",
      cwd: process.cwd(),
      prompt: "Interleave two tool streams",
      providerProfileId: "codex-tool-streams",
    })
    const upstreamSplit = 19
    const gatewaySplit = 23
    const unfinishedGatewayPrefix = gatewayToken.slice(0, 7)

    const result = await runPersistedAgentJob({
      db,
      jobId: job.id,
      providerBindingDependencies: {
        getProviderProfileRuntimeConfig: (_db, profileId) => ({
          id: profileId,
          name: "Tool stream canary",
          presetId: null,
          protocol: "openai-responses",
          baseUrl: "https://provider.example.com/v1",
          defaultModel: "gpt-tool-streams",
          authMode: "bearer",
          token: upstreamToken,
          headers: {},
          targetRuntimes: ["codex"],
          capabilities: {},
        }),
        async createGatewayEndpoint(profileId, kind) {
          return {
            providerId: profileId,
            baseUrl: `http://127.0.0.1:1234/profile/${profileId}/${kind}/v1`,
            token: gatewayToken,
          }
        },
        revokeGatewayToken: () => true,
      },
      runner: async (_request, observer) => {
        observer.appendEvent("tool_delta", {
          toolCallId: "tool-a",
          id: "shared-fallback-id",
          delta: `A:${upstreamToken.slice(0, upstreamSplit)}`,
        })
        observer.appendEvent("tool_delta", {
          toolCallId: "tool-b",
          id: "shared-fallback-id",
          delta: `B:${gatewayToken.slice(0, gatewaySplit)}`,
        })
        observer.appendEvent("tool_delta", {
          toolCallId: "tool-a",
          id: "shared-fallback-id",
          delta: `${upstreamToken.slice(upstreamSplit)}|${unfinishedGatewayPrefix}`,
        })
        observer.appendEvent("tool_finished", {
          toolCallId: "tool-a",
          id: "shared-fallback-id",
          output: "A done",
        })
        observer.appendEvent("tool_delta", {
          toolCallId: "tool-b",
          id: "shared-fallback-id",
          delta: gatewayToken.slice(gatewaySplit),
        })
        observer.appendEvent("tool_finished", {
          toolCallId: "tool-b",
          id: "shared-fallback-id",
          output: "B done",
        })
        return { status: "succeeded", exitCode: 0 }
      },
    })

    const toolEvents = result.events
      .filter(
        (event) =>
          event.type === "tool_delta" || event.type === "tool_finished",
      )
      .map((event) => ({
        type: event.type,
        payload: JSON.parse(event.payloadJson) as {
          toolCallId?: string
          delta?: string
        },
      }))
    const deltasByTool = (toolCallId: string) =>
      toolEvents
        .filter(
          (event) =>
            event.type === "tool_delta" &&
            event.payload.toolCallId === toolCallId,
        )
        .map((event) => event.payload.delta ?? "")
        .join("")

    expect(deltasByTool("tool-a")).toBe(
      `A:${EXACT_SECRET_REDACTION_MARKER}|${unfinishedGatewayPrefix}`,
    )
    expect(deltasByTool("tool-b")).toBe(`B:${EXACT_SECRET_REDACTION_MARKER}`)
    expect(
      toolEvents.map(
        (event) => `${event.type}:${event.payload.toolCallId ?? "missing"}`,
      ),
    ).toEqual([
      "tool_delta:tool-a",
      "tool_delta:tool-b",
      "tool_delta:tool-a",
      "tool_delta:tool-a",
      "tool_finished:tool-a",
      "tool_delta:tool-b",
      "tool_finished:tool-b",
    ])
    expect(JSON.stringify(result.events)).not.toContain(upstreamToken)
    expect(JSON.stringify(result.events)).not.toContain(gatewayToken)
  })

  test("runner records default-profile resolved provider when runtime throws", async () => {
    const db = createAgentJobTestDb()
    const events: string[] = []
    seedProviderProfile(db, {
      id: "codex-default",
      targets: ["codex"],
      model: "gpt-default",
    })
    seedDefault(db, "codex-default", "gpt-default-override")
    const job = createAgentJob(db, {
      source: "api",
      runtime: "codex",
      mode: "agent",
      cwd: process.cwd(),
      prompt: "Run with defaults then throw",
    })

    const result = await runPersistedAgentJob({
      db,
      jobId: job.id,
      providerBindingDependencies: gatewayDependencies(events),
      runner: async () => {
        throw new Error("runtime crashed after provider resolution")
      },
    })

    expect(result.exitCode).toBe(1)
    expect(result.job).toMatchObject({
      status: "failed",
      errorCode: "runtime_error",
    })
    expect(JSON.parse(result.job.resultJson ?? "{}")).toMatchObject({
      resolvedProvider: {
        source: "default-profile",
        profileId: "codex-default",
        model: "gpt-default-override",
      },
    })
    expect(events).toEqual([
      "create:codex-default:responses",
      "revoke:token-for-codex-default",
    ])
  })

  test("result envelopes use provider resolution events for in-flight default-profile jobs", () => {
    const db = createAgentJobTestDb()
    const job = createAgentJob(db, {
      source: "api",
      runtime: "codex",
      mode: "agent",
      cwd: process.cwd(),
      prompt: "Poll while running",
    })
    appendAgentJobEvent(db, {
      jobId: job.id,
      type: "status",
      payload: {
        providerBinding: {
          resolvedProvider: {
            source: "default-profile",
            profileId: "codex-default",
            model: "gpt-default",
          },
        },
      },
    })

    const envelope = toLocalJobApiResultEnvelope(
      job,
      [],
      listAgentJobEvents(db, job.id),
    )

    expect(envelope.resolvedProvider).toEqual({
      source: "default-profile",
      profileId: "codex-default",
      model: "gpt-default",
    })
  })

  test("retried jobs fail closed when the stored explicit profile is deleted", async () => {
    const db = createAgentJobTestDb()
    seedProviderProfile(db, {
      id: "codex-main",
      targets: ["codex"],
      model: "gpt-default",
    })
    const original = createAgentJob(db, {
      source: "cli",
      runtime: "codex",
      mode: "agent",
      cwd: process.cwd(),
      prompt: "Run with explicit profile",
      providerProfileId: "codex-main",
    })
    completeAgentJob(db, {
      jobId: original.id,
      status: "failed",
      exitCode: 1,
      errorCode: "runtime_failed",
      errorMessage: "failed before retry",
    })
    db.delete(agentProviderProfiles)
      .where(eq(agentProviderProfiles.id, "codex-main"))
      .run()

    const retry = retryAgentJob(db, original.id)
    const result = await runPersistedAgentJob({
      db,
      jobId: retry.id,
      providerBindingDependencies: gatewayDependencies([]),
      runner: async () => {
        throw new Error("runner should not start without the stored profile")
      },
    })

    expect(result.exitCode).toBe(2)
    expect(result.job).toMatchObject({
      status: "failed",
      errorCode: "provider_profile_not_found",
    })
    expect(JSON.parse(result.job.resultJson ?? "{}")).toMatchObject({
      resolvedProvider: {
        source: "request-profile",
        profileId: "codex-main",
      },
    })
  })
})
