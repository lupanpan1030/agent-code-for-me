import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import * as schema from "../src/main/lib/db/schema"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

let testDb = createAgentJobTestDb()

mock.module("electron", () => ({
  BrowserWindow: class {},
  app: {
    isPackaged: false,
    getPath() {
      return "/tmp/locus-legacy-provider-config-unused"
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) =>
      Buffer.from(`encrypted:${value}`, "utf-8"),
    decryptString(value: Buffer) {
      const raw = value.toString("utf-8")
      if (!raw.startsWith("encrypted:")) throw new Error("not encrypted")
      return raw.slice("encrypted:".length)
    },
  },
}))

mock.module("../src/main/lib/db", () => ({
  ...schema,
  getDatabase: () => testDb,
}))

const secureStorageModule = await import("../src/main/lib/secure-storage")
const claudeStore = await import("../src/main/lib/claude/provider-config-store")
const localStore = await import("../src/main/lib/local-api-provider-config")
const { localApiProviderConfigRouter } = await import(
  "../src/main/lib/trpc/routers/local-api-provider-config"
)

function createLegacyProviderTables(): void {
  testDb.$client.exec(`
    CREATE TABLE claude_provider_config (
      id text PRIMARY KEY NOT NULL,
      model text NOT NULL,
      base_url text NOT NULL,
      auth_mode text DEFAULT 'auth_token' NOT NULL,
      encrypted_token text NOT NULL,
      created_at integer,
      updated_at integer
    );
    CREATE TABLE local_api_provider_configs (
      id text PRIMARY KEY NOT NULL,
      model text NOT NULL,
      base_url text NOT NULL,
      encrypted_token text NOT NULL,
      created_at integer,
      updated_at integer
    );
  `)
}

function storedEncryptedToken(token: string): string {
  return Buffer.from(`encrypted:${token}`, "utf-8").toString("base64")
}

describe("legacy provider config storage security", () => {
  beforeEach(() => {
    testDb = createAgentJobTestDb()
    createLegacyProviderTables()
    secureStorageModule.setElectronSafeStorageForTest({
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf-8"),
      decryptString(value) {
        const raw = value.toString("utf-8")
        return raw.startsWith("encrypted:")
          ? raw.slice("encrypted:".length)
          : ""
      },
    })
  })

  afterEach(() => {
    secureStorageModule.setElectronSafeStorageForTest(null)
  })

  test("safe saves keep metadata and runtime reads on one canonical URL", async () => {
    const claudeSaved = claudeStore.saveClaudeProviderConfig({
      model: "claude-model",
      baseUrl: " https://api.example.com/v1/// ",
      authMode: "auth_token",
      token: "token123",
    })
    expect(claudeSaved.config?.baseUrl).toBe("https://api.example.com/v1")
    expect(claudeSaved.config?.credentialUsable).toBe(true)
    expect(claudeStore.getActiveClaudeProviderConfig()?.baseUrl).toBe(
      "https://api.example.com/v1",
    )
    const originalClaudeCiphertext = testDb
      .select()
      .from(schema.claudeProviderConfig)
      .get()?.encryptedToken
    testDb
      .update(schema.claudeProviderConfig)
      .set({ baseUrl: "https://api.example.com/v1///" })
      .run()
    claudeStore.saveClaudeProviderConfig({
      model: "updated-claude-model",
      baseUrl: "https://api.example.com/v1",
      authMode: "auth_token",
    })
    expect(claudeStore.getActiveClaudeProviderConfig()?.token).toBe("token123")
    expect(
      testDb.select().from(schema.claudeProviderConfig).get()?.encryptedToken,
    ).toBe(originalClaudeCiphertext)

    const localCaller = localApiProviderConfigRouter.createCaller({
      getWindow: () => null,
    })
    const localSaved = await localCaller.save({
      purpose: "commit_message",
      model: "helper-model",
      baseUrl: "https://helper.example.com/v1///",
      token: "token123",
    })
    expect(localSaved.config?.baseUrl).toBe("https://helper.example.com/v1")
    expect(localSaved.config?.credentialUsable).toBe(true)
    expect(
      localStore.getActiveLocalApiProviderConfig("commit_message")?.baseUrl,
    ).toBe("https://helper.example.com/v1")
    await localCaller.save({
      purpose: "commit_message",
      model: "updated-helper-model",
      baseUrl: "https://helper.example.com/v1",
    })
    expect(
      localStore.getActiveLocalApiProviderConfig("commit_message")?.token,
    ).toBe("token123")
  })

  test("normalizes legacy stored models and rejects blank stored models", async () => {
    testDb
      .insert(schema.claudeProviderConfig)
      .values({
        id: "default",
        model: "  legacy-claude-model  ",
        baseUrl: "https://api.example.com/v1",
        authMode: "auth_token",
        encryptedToken: storedEncryptedToken("token123"),
      })
      .run()
    testDb
      .insert(schema.localApiProviderConfigs)
      .values({
        id: "commit_message",
        model: "  legacy-helper-model  ",
        baseUrl: "https://helper.example.com/v1",
        encryptedToken: storedEncryptedToken("token123"),
      })
      .run()

    expect(claudeStore.getClaudeProviderConfigMetadata().config?.model).toBe(
      "legacy-claude-model",
    )
    expect(claudeStore.getActiveClaudeProviderConfig()?.model).toBe(
      "legacy-claude-model",
    )
    const localCaller = localApiProviderConfigRouter.createCaller({
      getWindow: () => null,
    })
    await expect(
      localCaller.get({ purpose: "commit_message" }),
    ).resolves.toMatchObject({ config: { model: "legacy-helper-model" } })
    expect(
      localStore.getActiveLocalApiProviderConfig("commit_message")?.model,
    ).toBe("legacy-helper-model")

    testDb.update(schema.claudeProviderConfig).set({ model: "   " }).run()
    testDb.update(schema.localApiProviderConfigs).set({ model: "   " }).run()

    expect(claudeStore.getClaudeProviderConfigMetadata().config).toMatchObject({
      model: "",
      credentialUsable: false,
    })
    expect(claudeStore.getActiveClaudeProviderConfig()).toBeUndefined()
    await expect(
      localCaller.get({ purpose: "commit_message" }),
    ).resolves.toMatchObject({
      config: { model: "", credentialUsable: false },
    })
    expect(
      localStore.getActiveLocalApiProviderConfig("commit_message"),
    ).toBeUndefined()
  })

  test("legacy Claude import trims the model and rejects blank input", () => {
    expect(() =>
      claudeStore.importLegacyClaudeProviderConfig({
        model: "   ",
        baseUrl: "https://api.example.com/v1",
        authMode: "auth_token",
        token: "token123",
      }),
    ).toThrow("Model and base URL are required")
    expect(claudeStore.getClaudeProviderConfigMetadata().config).toBeNull()

    expect(
      claudeStore.importLegacyClaudeProviderConfig({
        model: "  imported-claude-model  ",
        baseUrl: "https://api.example.com/v1",
        authMode: "auth_token",
        token: "token123",
      }),
    ).toMatchObject({ migrated: true, reason: null })
    expect(claudeStore.getClaudeProviderConfigMetadata().config?.model).toBe(
      "imported-claude-model",
    )
    expect(testDb.select().from(schema.claudeProviderConfig).get()?.model).toBe(
      "imported-claude-model",
    )
  })

  test("save paths reject literal and percent-encoded URL credentials", async () => {
    expect(() =>
      claudeStore.saveClaudeProviderConfig({
        model: "claude-model",
        baseUrl: "https://user:password@api.example.com/v1",
        authMode: "auth_token",
        token: "token123",
      }),
    ).toThrow("must not include a username or password")

    const localCaller = localApiProviderConfigRouter.createCaller({
      getWindow: () => null,
    })
    await expect(
      localCaller.save({
        purpose: "commit_message",
        model: "helper-model",
        baseUrl: "https://us%65r:p%40ss@api.example.com/v1",
        token: "token123",
      }),
    ).rejects.toThrow("must not include a username or password")

    expect(claudeStore.getClaudeProviderConfigMetadata().config).toBeNull()
    expect(localStore.getStoredProviderRow("commit_message")).toBeUndefined()
  })

  test("omitted-token updates reject short or unreadable stored credentials", async () => {
    testDb
      .insert(schema.claudeProviderConfig)
      .values({
        id: "default",
        model: "existing-claude-model",
        baseUrl: "https://api.example.com/v1",
        authMode: "auth_token",
        encryptedToken: storedEncryptedToken("1234567"),
      })
      .run()
    testDb
      .insert(schema.localApiProviderConfigs)
      .values({
        id: "commit_message",
        model: "existing-helper-model",
        baseUrl: "https://helper.example.com/v1",
        encryptedToken: Buffer.from("not-encrypted", "utf-8").toString(
          "base64",
        ),
      })
      .run()

    expect(claudeStore.getClaudeProviderConfigMetadata().config).toMatchObject({
      hasToken: true,
      credentialUsable: false,
    })
    const localCaller = localApiProviderConfigRouter.createCaller({
      getWindow: () => null,
    })
    await expect(
      localCaller.get({ purpose: "commit_message" }),
    ).resolves.toMatchObject({
      config: { hasToken: true, credentialUsable: false },
    })

    expect(() =>
      claudeStore.saveClaudeProviderConfig({
        model: "changed-claude-model",
        baseUrl: "https://api.example.com/v1",
        authMode: "auth_token",
      }),
    ).toThrow("Re-enter the token before saving")

    await expect(
      localCaller.save({
        purpose: "commit_message",
        model: "changed-helper-model",
        baseUrl: "https://helper.example.com/v1",
      }),
    ).rejects.toThrow("Re-enter the token before saving")

    expect(testDb.select().from(schema.claudeProviderConfig).get()?.model).toBe(
      "existing-claude-model",
    )
    expect(
      testDb.select().from(schema.localApiProviderConfigs).get()?.model,
    ).toBe("existing-helper-model")
  })

  test("omitted-token updates require re-entry for endpoint or auth-mode changes", () => {
    claudeStore.saveClaudeProviderConfig({
      model: "claude-model",
      baseUrl: "https://api.example.com/v1",
      authMode: "auth_token",
      token: "token123",
    })

    expect(() =>
      claudeStore.saveClaudeProviderConfig({
        model: "changed-model",
        baseUrl: "https://other.example.com/v1",
        authMode: "auth_token",
      }),
    ).toThrow("Token is required when changing provider endpoint or auth mode")
    expect(() =>
      claudeStore.saveClaudeProviderConfig({
        model: "changed-model",
        baseUrl: "https://api.example.com/v1",
        authMode: "api_key",
      }),
    ).toThrow("Token is required when changing provider endpoint or auth mode")
    expect(claudeStore.getActiveClaudeProviderConfig()).toMatchObject({
      model: "claude-model",
      baseUrl: "https://api.example.com/v1",
      authMode: "auth_token",
      token: "token123",
    })

    claudeStore.saveClaudeProviderConfig({
      model: "changed-model",
      baseUrl: "https://other.example.com/v1",
      authMode: "api_key",
      token: "replacement-token",
    })
    expect(claudeStore.getActiveClaudeProviderConfig()).toMatchObject({
      model: "changed-model",
      baseUrl: "https://other.example.com/v1",
      authMode: "api_key",
      token: "replacement-token",
    })
  })

  test("metadata and runtime reads fail closed for stored URL credentials", async () => {
    testDb
      .insert(schema.claudeProviderConfig)
      .values({
        id: "default",
        model: "claude-model",
        baseUrl: "https://us%65r:p%40ss@api.example.com/v1",
        authMode: "auth_token",
        encryptedToken: storedEncryptedToken("token123"),
      })
      .run()
    testDb
      .insert(schema.localApiProviderConfigs)
      .values({
        id: "commit_message",
        model: "helper-model",
        baseUrl: "https://user:password@api.example.com/v1",
        encryptedToken: storedEncryptedToken("token123"),
      })
      .run()

    expect(() => claudeStore.getClaudeProviderConfigMetadata()).toThrow(
      "must not include a username or password",
    )
    expect(() => claudeStore.getActiveClaudeProviderConfig()).toThrow(
      "must not include a username or password",
    )
    expect(() =>
      localStore.getActiveLocalApiProviderConfig("commit_message"),
    ).toThrow("must not include a username or password")

    const localCaller = localApiProviderConfigRouter.createCaller({
      getWindow: () => null,
    })
    await expect(
      localCaller.get({ purpose: "commit_message" }),
    ).rejects.toThrow("must not include a username or password")
  })

  test("legacy Claude metadata and runtime reads fail closed for an invalid auth mode", () => {
    testDb
      .insert(schema.claudeProviderConfig)
      .values({
        id: "default",
        model: "claude-model",
        baseUrl: "https://api.example.com/v1",
        authMode: "unexpected-auth-mode",
        encryptedToken: storedEncryptedToken("token123"),
      })
      .run()

    expect(() => claudeStore.getClaudeProviderConfigMetadata()).toThrow()
    expect(() => claudeStore.getActiveClaudeProviderConfig()).toThrow()
  })
})
