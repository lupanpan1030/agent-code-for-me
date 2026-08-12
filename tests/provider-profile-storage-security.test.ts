import { beforeEach, describe, expect, mock, test } from "bun:test"
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

describe("provider profile storage security", () => {
  beforeEach(() => {
    testDb = createAgentJobTestDb()
  })

  test("requires token re-entry before reusing saved credentials for a new destination", () => {
    const existing = {
      existingEncryptedToken: "encrypted-token",
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
