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
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

function seedProviderProfile(
  db: ReturnType<typeof createAgentJobTestDb>,
  input: {
    id: string
    targets: string[]
    model?: string
    authMode?: "bearer" | "x-api-key" | "none"
    encryptedToken?: string | null
  },
) {
  db.insert(agentProviderProfiles)
    .values({
      id: input.id,
      name: input.id,
      protocol: "openai-responses",
      baseUrl: "https://provider.example.com/v1",
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

describe("headless provider binding", () => {
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
      "runtime failed after echoing <redacted>",
    )
    expect(result.job.errorCode).toBe("runtime_failed_<redacted>")
    expect(JSON.parse(result.job.resultJson ?? "{}")).toMatchObject({
      finalMessage: "final output repeated <redacted>",
      nested: ["bare value: <redacted>"],
    })
    expect(persistedAndPublic).not.toContain(gatewayToken)
    expect(persistedAndPublic).toContain("<redacted>")
    expect(gatewayLifecycle).toEqual([
      "create:codex-default:responses",
      "revoke",
    ])
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
