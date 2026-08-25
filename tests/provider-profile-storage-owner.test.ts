import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  agentProviderDefaults,
  agentProviderProfiles,
} from "../src/main/lib/db/schema"
import { toLocalJobApiRuntimeManifestEnvelope } from "../src/main/lib/headless/local-job-api"
import {
  type HeadlessProviderBindingError,
  inspectHeadlessDefaultProviderBinding,
  resolveHeadlessProviderBinding,
} from "../src/main/lib/headless/provider-binding"
import {
  getProviderProfileRuntimeConfigFromDatabase,
  ProviderProfileStorageReadError,
} from "../src/main/lib/provider-profiles/storage"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

function seedProfile(
  db: ReturnType<typeof createAgentJobTestDb>,
  input: {
    authMode?: string
    id: string
    targetRuntimesJson: string
    protocol?: string
  },
): void {
  db.insert(agentProviderProfiles)
    .values({
      id: input.id,
      name: input.id,
      protocol: input.protocol ?? "openai-responses",
      baseUrl: "https://provider.example.com/v1",
      defaultModel: "provider-model",
      authMode: input.authMode ?? "none",
      encryptedToken: null,
      headersJson: "{}",
      targetRuntimesJson: input.targetRuntimesJson,
      capabilitiesJson: "{}",
    })
    .run()
}

function seedCodexDefault(
  db: ReturnType<typeof createAgentJobTestDb>,
  profileId: string,
): void {
  db.insert(agentProviderDefaults)
    .values({
      purpose: "codex-main",
      profileId,
    })
    .run()
}

describe("provider profile storage ownership", () => {
  test("strict DB-injected runtime reads reject malformed JSON and enum values", () => {
    const db = createAgentJobTestDb()
    seedProfile(db, {
      id: "malformed-profile",
      targetRuntimesJson: "{not-json",
    })
    seedProfile(db, {
      id: "invalid-auth-profile",
      authMode: "unexpected-auth-mode",
      targetRuntimesJson: JSON.stringify(["codex"]),
    })
    seedProfile(db, {
      id: "invalid-protocol-profile",
      protocol: "unexpected-protocol",
      targetRuntimesJson: JSON.stringify(["codex"]),
    })

    for (const profileId of [
      "malformed-profile",
      "invalid-auth-profile",
      "invalid-protocol-profile",
    ]) {
      expect(() =>
        getProviderProfileRuntimeConfigFromDatabase(db, profileId),
      ).toThrow(ProviderProfileStorageReadError)
    }
  })

  test("headless default resolution fails closed instead of falling back for malformed storage", async () => {
    const db = createAgentJobTestDb()
    seedProfile(db, {
      id: "malformed-default",
      targetRuntimesJson: JSON.stringify(["codex"]),
      protocol: "invalid-protocol",
    })
    seedCodexDefault(db, "malformed-default")

    const inspection = inspectHeadlessDefaultProviderBinding({
      db,
      runtime: "codex",
    })
    expect(inspection).toMatchObject({
      state: "unavailable",
      code: "provider_profile_unavailable",
      profileId: "malformed-default",
    })

    await expect(
      resolveHeadlessProviderBinding({ db, runtime: "codex" }),
    ).rejects.toMatchObject({
      code: "provider_profile_unavailable",
      source: "default-profile",
      profileId: "malformed-default",
    } satisfies Partial<HeadlessProviderBindingError>)
  })

  test("runtime manifest uses the actual default-profile then native order", async () => {
    const db = createAgentJobTestDb()
    seedProfile(db, {
      id: "codex-default",
      targetRuntimesJson: JSON.stringify(["codex"]),
    })
    seedCodexDefault(db, "codex-default")
    let nativeCodexProbes = 0

    const manifest = await toLocalJobApiRuntimeManifestEnvelope({
      db,
      readinessDependencies: {
        hasAnyClaudeCodeAccount: () => false,
        getExistingClaudeCredentials: () => null,
        getCodexExecutableStatus: () => ({
          ok: true,
          path: "/tmp/codex",
          exists: true,
          isExecutable: true,
          error: null,
          hint: null,
        }),
        getCodexRuntimeStatus: async () => {
          nativeCodexProbes += 1
          return {
            components: [
              {
                id: "login-cli",
                status: "ready",
                error: null,
                hint: null,
              },
              {
                id: "login",
                status: "needs-auth",
                error: null,
                hint: null,
              },
            ],
          }
        },
      },
    })

    expect(
      manifest.runtimes.find((runtime) => runtime.runtimeId === "codex")
        ?.readiness,
    ).toMatchObject({ state: "ready" })
    expect(nativeCodexProbes).toBe(0)
  })

  test("runtime manifest rejects a target-mismatched default without native fallback", async () => {
    const db = createAgentJobTestDb()
    seedProfile(db, {
      id: "claude-only-default",
      targetRuntimesJson: JSON.stringify(["claude"]),
    })
    seedCodexDefault(db, "claude-only-default")
    let nativeCodexProbes = 0

    const manifest = await toLocalJobApiRuntimeManifestEnvelope({
      db,
      readinessDependencies: {
        hasAnyClaudeCodeAccount: () => false,
        getExistingClaudeCredentials: () => null,
        getCodexExecutableStatus: () => ({
          ok: true,
          path: "/tmp/codex",
          exists: true,
          isExecutable: true,
          error: null,
          hint: null,
        }),
        getCodexRuntimeStatus: async () => {
          nativeCodexProbes += 1
          return {
            components: [
              {
                id: "login-cli",
                status: "ready",
                error: null,
                hint: null,
              },
              {
                id: "login",
                status: "ready",
                error: null,
                hint: null,
              },
            ],
          }
        },
      },
    })

    expect(
      manifest.runtimes.find((runtime) => runtime.runtimeId === "codex")
        ?.readiness,
    ).toMatchObject({ state: "unavailable" })
    expect(nativeCodexProbes).toBe(0)
  })

  test("runtime manifest rejects a configured default whose profile is missing", async () => {
    const db = createAgentJobTestDb()
    db.$client.exec("PRAGMA foreign_keys = OFF")
    seedCodexDefault(db, "missing-default")
    db.$client.exec("PRAGMA foreign_keys = ON")
    let nativeCodexProbes = 0

    const inspection = inspectHeadlessDefaultProviderBinding({
      db,
      runtime: "codex",
    })
    expect(inspection).toMatchObject({
      state: "unavailable",
      code: "provider_profile_not_found",
      profileId: "missing-default",
    })

    const manifest = await toLocalJobApiRuntimeManifestEnvelope({
      db,
      readinessDependencies: {
        hasAnyClaudeCodeAccount: () => false,
        getExistingClaudeCredentials: () => null,
        getCodexExecutableStatus: () => ({
          ok: true,
          path: "/tmp/codex",
          exists: true,
          isExecutable: true,
          error: null,
          hint: null,
        }),
        getCodexRuntimeStatus: async () => {
          nativeCodexProbes += 1
          return {
            components: [
              {
                id: "login-cli",
                status: "ready",
                error: null,
                hint: null,
              },
              {
                id: "login",
                status: "ready",
                error: null,
                hint: null,
              },
            ],
          }
        },
      },
    })

    expect(
      manifest.runtimes.find((runtime) => runtime.runtimeId === "codex")
        ?.readiness,
    ).toMatchObject({ state: "unavailable" })
    expect(nativeCodexProbes).toBe(0)
  })

  test("provider binding contains no duplicate DB row or secret parser", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/main/lib/headless/provider-binding.ts"),
      "utf8",
    )

    expect(source).not.toContain("agentProviderProfiles")
    expect(source).not.toContain("agentProviderDefaults")
    expect(source).not.toContain("decryptProviderToken")
    expect(source).not.toContain("function parseJson")
    expect(source).not.toContain("function parseAuthMode")
    expect(source).not.toContain("function parseProtocol")
  })
})
