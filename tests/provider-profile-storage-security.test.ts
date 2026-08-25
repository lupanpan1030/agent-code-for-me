import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import * as schema from "../src/main/lib/db/schema"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

const userDataDir = ""
let testDb = createAgentJobTestDb()

mock.module("electron", () => ({
  app: {
    isPackaged: false,
    getPath(name: string) {
      if (name !== "userData") {
        throw new Error(`unexpected app path request: ${name}`)
      }
      return userDataDir
    },
  },
  safeStorage: {
    isEncryptionAvailable() {
      return true
    },
    encryptString(value: string) {
      return Buffer.from(`encrypted:${value}`, "utf-8")
    },
    decryptString(value: Buffer) {
      const raw = value.toString("utf-8")
      if (!raw.startsWith("encrypted:")) {
        throw new Error("not encrypted")
      }
      return raw.slice("encrypted:".length)
    },
  },
}))

mock.module("../src/main/lib/db", () => ({
  ...schema,
  getDatabase: () => testDb,
}))

mock.module("../src/main/lib/claude/provider-config-store", () => ({
  getActiveClaudeProviderConfig: () => undefined,
}))

mock.module("../src/main/lib/local-api-provider-config", () => ({
  getActiveLocalApiProviderConfig: () => undefined,
}))

const storageModule = await import("../src/main/lib/provider-profiles/storage")
const secureStorageModule = await import("../src/main/lib/secure-storage")
const headlessBindingModule = await import(
  "../src/main/lib/headless/provider-binding"
)

function storedEncryptedToken(token: string): string {
  return Buffer.from(`encrypted:${token}`, "utf-8").toString("base64")
}

describe("provider profile storage security", () => {
  beforeEach(() => {
    testDb = createAgentJobTestDb()
    secureStorageModule.setElectronSafeStorageForTest({
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf-8"),
      decryptString(value) {
        const raw = value.toString("utf-8")
        if (!raw.startsWith("encrypted:")) throw new Error("not encrypted")
        return raw.slice("encrypted:".length)
      },
    })
  })

  afterEach(() => {
    secureStorageModule.setElectronSafeStorageForTest(null)
  })

  test("requires token re-entry before reusing saved credentials for a new destination", () => {
    const existing = {
      existingEncryptedToken: storedEncryptedToken("token123"),
      existingBaseUrl: "https://api.example.com/v1",
      existingProtocol: "openai-chat",
      existingAuthMode: "bearer",
    }

    expect(
      storageModule.getProviderProfileTokenRequirement({
        ...existing,
        protocol: "openai-chat",
        baseUrl: "https://api.example.com/v1",
        authMode: "bearer",
      }),
    ).toBe("none")

    expect(
      storageModule.getProviderProfileTokenRequirement({
        ...existing,
        protocol: "openai-chat",
        baseUrl: "https://evil.example.test/v1",
        authMode: "bearer",
      }),
    ).toBe("destination_changed")

    expect(
      storageModule.getProviderProfileTokenRequirement({
        ...existing,
        protocol: "anthropic",
        baseUrl: "https://api.example.com/v1",
        authMode: "bearer",
      }),
    ).toBe("destination_changed")

    expect(
      storageModule.getProviderProfileTokenRequirement({
        ...existing,
        protocol: "openai-chat",
        baseUrl: "https://api.example.com/v1",
        authMode: "x-api-key",
      }),
    ).toBe("destination_changed")

    expect(
      storageModule.getProviderProfileTokenRequirement({
        ...existing,
        protocol: "openai-chat",
        baseUrl: "https://evil.example.test/v1",
        authMode: "bearer",
        token: "sk-reentered",
      }),
    ).toBe("none")

    expect(() =>
      storageModule.getProviderProfileTokenRequirement({
        ...existing,
        protocol: "openai-chat",
        baseUrl: "https://api.example.com/v1",
        authMode: "bearer",
        token: "1234567",
      }),
    ).toThrow("8-16384")
  })

  test("fails closed when saving URL credentials or a token below the redaction floor", () => {
    const input = {
      name: "Secure provider",
      protocol: "openai-responses" as const,
      defaultModel: "provider-model",
      authMode: "bearer" as const,
      token: "token123",
      targetRuntimes: ["codex" as const],
    }

    for (const [id, baseUrl] of [
      ["literal-userinfo", "https://user:password@api.example.com/v1"],
      ["encoded-userinfo", "https://us%65r:p%40ss@api.example.com/v1"],
    ] as const) {
      expect(() =>
        storageModule.saveProviderProfile({ ...input, id, baseUrl }),
      ).toThrow("must not include a username or password")
      expect(storageModule.getProviderProfileMetadata(id)).toBeNull()
    }

    for (const [id, baseUrl, expectedMessage] of [
      [
        "query-credential",
        "https://api.example.com/v1?api_key=credential",
        "must not include query parameters",
      ],
      [
        "fragment-credential",
        "https://api.example.com/v1#credential",
        "must not include a fragment",
      ],
    ] as const) {
      expect(() =>
        storageModule.saveProviderProfile({ ...input, id, baseUrl }),
      ).toThrow(expectedMessage)
      expect(storageModule.getProviderProfileMetadata(id)).toBeNull()
    }

    expect(() =>
      storageModule.saveProviderProfile({
        ...input,
        id: "short-token",
        baseUrl: "https://api.example.com/v1",
        token: "1234567",
      }),
    ).toThrow("8-16384")
    expect(storageModule.getProviderProfileMetadata("short-token")).toBeNull()
  })

  test("preserves the existing credential when an update omits an optional token", () => {
    const id = "optional-token-update"
    const baseInput = {
      id,
      name: "Optional token update",
      protocol: "openai-responses" as const,
      baseUrl: "https://api.example.com/v1",
      defaultModel: "provider-model",
      authMode: "bearer" as const,
      targetRuntimes: ["codex" as const],
    }

    storageModule.saveProviderProfile({ ...baseInput, token: "token123" })
    storageModule.saveProviderProfile({ ...baseInput, token: "   " })

    expect(storageModule.getProviderProfileMetadata(id)).toMatchObject({
      hasToken: true,
      credentialUsable: true,
    })
    expect(
      storageModule.getProviderProfileRuntimeConfigFromDatabase(testDb, id)
        ?.token,
    ).toBe("token123")
  })

  test("normalizes stored identity metadata and marks blank profiles unusable", () => {
    testDb
      .insert(schema.agentProviderProfiles)
      .values([
        {
          id: "padded-identity",
          name: "  Padded provider  ",
          protocol: "openai-responses",
          baseUrl: "https://api.example.com/v1",
          defaultModel: "  provider-model  ",
          authMode: "none",
          targetRuntimesJson: JSON.stringify(["codex"]),
          capabilitiesJson: "{}",
        },
        {
          id: "blank-name",
          name: "   ",
          protocol: "openai-responses",
          baseUrl: "https://api.example.com/v1",
          defaultModel: "provider-model",
          authMode: "none",
          targetRuntimesJson: JSON.stringify(["codex"]),
          capabilitiesJson: "{}",
        },
        {
          id: "blank-model",
          name: "Blank model provider",
          protocol: "openai-responses",
          baseUrl: "https://api.example.com/v1",
          defaultModel: "   ",
          authMode: "none",
          targetRuntimesJson: JSON.stringify(["codex"]),
          capabilitiesJson: "{}",
        },
      ])
      .run()

    expect(
      storageModule.getProviderProfileMetadata("padded-identity"),
    ).toMatchObject({
      name: "Padded provider",
      defaultModel: "provider-model",
      credentialUsable: true,
    })
    expect(
      storageModule.getProviderProfileRuntimeConfigFromDatabase(
        testDb,
        "padded-identity",
      ),
    ).toMatchObject({
      name: "Padded provider",
      defaultModel: "provider-model",
    })

    expect(
      storageModule.getProviderProfileMetadata("blank-name"),
    ).toMatchObject({
      name: "",
      credentialUsable: false,
    })
    expect(
      storageModule.getProviderProfileMetadata("blank-model"),
    ).toMatchObject({
      defaultModel: "",
      credentialUsable: false,
    })
    for (const profileId of ["blank-name", "blank-model"]) {
      expect(() =>
        storageModule.getProviderProfileRuntimeConfigFromDatabase(
          testDb,
          profileId,
        ),
      ).toThrow(storageModule.ProviderProfileStorageReadError)
    }
  })

  test("rejects an omitted-token update when the stored credential is too short", () => {
    const id = "short-token-update"
    testDb
      .insert(schema.agentProviderProfiles)
      .values({
        id,
        name: "Existing provider",
        protocol: "openai-responses",
        baseUrl: "https://api.example.com/v1",
        defaultModel: "existing-model",
        authMode: "bearer",
        encryptedToken: storedEncryptedToken("1234567"),
        targetRuntimesJson: JSON.stringify(["codex"]),
        capabilitiesJson: "{}",
      })
      .run()

    expect(storageModule.getProviderProfileMetadata(id)).toMatchObject({
      hasToken: true,
      credentialUsable: false,
    })
    expect(() =>
      storageModule.saveProviderProfile({
        id,
        name: "Changed provider",
        protocol: "openai-responses",
        baseUrl: "https://api.example.com/v1",
        defaultModel: "changed-model",
        authMode: "bearer",
        targetRuntimes: ["codex"],
      }),
    ).toThrow("Re-enter the token before saving")

    const unchanged = testDb
      .select()
      .from(schema.agentProviderProfiles)
      .all()
      .find((row) => row.id === id)
    expect(unchanged).toMatchObject({
      name: "Existing provider",
      defaultModel: "existing-model",
      encryptedToken: storedEncryptedToken("1234567"),
    })
  })

  test("fails closed when stored URL credentials or short tokens reach runtime reads", async () => {
    testDb
      .insert(schema.agentProviderProfiles)
      .values([
        {
          id: "stored-userinfo",
          name: "Stored userinfo",
          protocol: "openai-responses",
          baseUrl: "https://us%65r:p%40ss@api.example.com/v1",
          defaultModel: "provider-model",
          authMode: "none",
          targetRuntimesJson: JSON.stringify(["codex"]),
          capabilitiesJson: "{}",
        },
        {
          id: "stored-short-token",
          name: "Stored short token",
          protocol: "openai-responses",
          baseUrl: "https://api.example.com/v1",
          defaultModel: "provider-model",
          authMode: "bearer",
          encryptedToken: storedEncryptedToken("1234567"),
          targetRuntimesJson: JSON.stringify(["codex"]),
          capabilitiesJson: "{}",
        },
        {
          id: "stored-query-credential",
          name: "Stored query credential",
          protocol: "openai-responses",
          baseUrl: "https://api.example.com/v1?api_key=credential",
          defaultModel: "provider-model",
          authMode: "none",
          targetRuntimesJson: JSON.stringify(["codex"]),
          capabilitiesJson: "{}",
        },
        {
          id: "stored-fragment-credential",
          name: "Stored fragment credential",
          protocol: "openai-responses",
          baseUrl: "https://api.example.com/v1#credential",
          defaultModel: "provider-model",
          authMode: "none",
          targetRuntimesJson: JSON.stringify(["codex"]),
          capabilitiesJson: "{}",
        },
      ])
      .run()
    testDb
      .insert(schema.agentProviderDefaults)
      .values({ purpose: "codex-main", profileId: "stored-short-token" })
      .run()

    expect(() =>
      storageModule.getProviderProfileMetadata("stored-userinfo"),
    ).toThrow("must not include a username or password")
    expect(() =>
      storageModule.getProviderProfileMetadata("stored-query-credential"),
    ).toThrow("must not include query parameters")
    expect(() =>
      storageModule.getProviderProfileMetadata("stored-fragment-credential"),
    ).toThrow("must not include a fragment")
    for (const profileId of [
      "stored-userinfo",
      "stored-short-token",
      "stored-query-credential",
      "stored-fragment-credential",
    ]) {
      expect(() =>
        storageModule.getProviderProfileRuntimeConfigFromDatabase(
          testDb,
          profileId,
        ),
      ).toThrow(storageModule.ProviderProfileStorageReadError)
    }

    expect(
      headlessBindingModule.inspectHeadlessDefaultProviderBinding({
        db: testDb,
        runtime: "codex",
      }),
    ).toMatchObject({
      state: "unavailable",
      code: "provider_profile_unavailable",
      profileId: "stored-short-token",
    })
    await expect(
      headlessBindingModule.resolveHeadlessProviderBinding({
        db: testDb,
        runtime: "codex",
      }),
    ).rejects.toMatchObject({
      code: "provider_profile_unavailable",
      profileId: "stored-short-token",
    })
  })

  test("loads a retired-only target as empty and re-saves with a valid target", () => {
    const retiredRuntimeId = "kun"
    const profileId = `legacy-${retiredRuntimeId}-only`
    testDb
      .insert(schema.agentProviderProfiles)
      .values({
        id: profileId,
        name: "Legacy retired-runtime profile",
        protocol: "openai-chat",
        baseUrl: "https://api.example.com/v1",
        defaultModel: "legacy-model",
        authMode: "none",
        targetRuntimesJson: JSON.stringify([retiredRuntimeId]),
        capabilitiesJson: JSON.stringify({ [retiredRuntimeId]: true }),
      })
      .run()

    const loaded = storageModule.getProviderProfileMetadata(profileId)
    expect(loaded?.targetRuntimes).toEqual([])

    if (!loaded) throw new Error("Legacy provider profile was not loaded")
    expect(() =>
      storageModule.saveProviderProfile({
        id: loaded.id,
        name: loaded.name,
        presetId: loaded.presetId,
        protocol: loaded.protocol,
        baseUrl: loaded.baseUrl,
        defaultModel: loaded.defaultModel,
        authMode: loaded.authMode,
        targetRuntimes: [],
      }),
    ).toThrow("Select at least one provider target.")

    const saved = storageModule.saveProviderProfile({
      id: loaded.id,
      name: loaded.name,
      presetId: loaded.presetId,
      protocol: loaded.protocol,
      baseUrl: loaded.baseUrl,
      defaultModel: loaded.defaultModel,
      authMode: loaded.authMode,
      targetRuntimes: ["codex"],
      capabilities: { codex: true },
    })

    expect(saved.targetRuntimes).toEqual(["codex"])
    expect(
      storageModule.getProviderProfileMetadata(profileId)?.targetRuntimes,
    ).toEqual(["codex"])
  })
})
