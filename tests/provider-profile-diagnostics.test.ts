import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

let userDataDir = ""

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

const storageModule = await import("../src/main/lib/provider-profiles/storage")
const gatewayModule = await import("../src/main/lib/provider-profiles/gateway")
const securityModule = await import("../src/shared/provider-profile-security")

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}

async function createProviderServer(
  handler: (params: {
    req: IncomingMessage
    res: ServerResponse
    body: string
  }) => void | Promise<void>,
) {
  const server = createServer((req, res) => {
    void readBody(req)
      .then((body) => handler({ req, res, body }))
      .catch((error) => {
        res.writeHead(500, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: String(error) }))
      })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new Error("failed to start test provider")
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

describe("provider diagnostics", () => {
  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), "locus-provider-diagnostics-"))
  })

  afterEach(async () => {
    await rm(userDataDir, { force: true, recursive: true })
    userDataDir = ""
  })

  test("classifies common provider setup failures", () => {
    expect(
      gatewayModule.classifyProviderDiagnosticFailure({
        errorName: "AbortError",
        message: "The operation timed out",
      }),
    ).toBe("endpoint_unreachable")
    expect(
      gatewayModule.classifyProviderDiagnosticFailure({
        status: 401,
        message: "bad key",
      }),
    ).toBe("auth_failed")
    expect(
      gatewayModule.classifyProviderDiagnosticFailure({
        status: 403,
        message: "model access denied",
      }),
    ).toBe("model_denied")
    expect(
      gatewayModule.classifyProviderDiagnosticFailure({
        status: 404,
        message: "route missing",
      }),
    ).toBe("protocol_mismatch")
  })

  test("redacts exact provider, gateway, and custom header secrets", () => {
    const redacted = securityModule.redactProviderSecrets(
      "bad provider-token-123 Bearer gateway-token-456 custom-header-secret",
      [
        "provider-token-123",
        "Bearer gateway-token-456",
        "custom-header-secret",
      ],
    )

    expect(redacted).not.toContain("provider-token-123")
    expect(redacted).not.toContain("gateway-token-456")
    expect(redacted).not.toContain("custom-header-secret")
    expect(redacted).toContain("***")
  })

  test("redacts overlapping exact provider secrets longest-first", () => {
    const shortSecret = "abcd"
    const longSecret = `${shortSecret}XYZ`
    const redacted = securityModule.redactProviderSecrets(
      `provider rejected ${longSecret}`,
      [shortSecret, longSecret],
    )

    expect(redacted).toBe("provider rejected ***")
    expect(redacted).not.toContain("XYZ")
  })

  test("redacts provider hints created by the exact replacement marker", () => {
    const redacted = securityModule.redactProviderSecrets("abcdXYZ", [
      "abcd",
      "***XYZ",
    ])

    expect(redacted).toBe("***")
    expect(redacted).not.toContain("***XYZ")
  })

  test("stores structured success diagnostics without exposing metadata headers", async () => {
    const provider = await createProviderServer(({ req, res, body }) => {
      expect(req.headers.authorization).toBe("Bearer provider-token-123")
      expect(req.headers["http-referer"]).toBe(
        "https://locus.local/diagnostics",
      )
      const parsed = JSON.parse(body || "{}") as { stream?: boolean }
      if (parsed.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" })
        res.end("data: [DONE]\n\n")
        return
      }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          id: "chatcmpl_test",
          choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        }),
      )
    })

    try {
      const runtimeProfile = {
        id: "profile_success",
        name: "Diagnostics Provider",
        presetId: "test",
        protocol: "openai-chat",
        baseUrl: provider.baseUrl,
        defaultModel: "test-model",
        authMode: "bearer",
        token: "provider-token-123",
        headers: { "HTTP-Referer": "https://locus.local/diagnostics" },
        targetRuntimes: ["codex", "helpers"],
        capabilities: { codex: true, helpers: true, streaming: true },
      } as const

      const status =
        await gatewayModule.runProviderProfileDiagnostics(runtimeProfile)
      expect(status).toMatchObject({
        ok: true,
        diagnosticVersion: 1,
        message: "Provider diagnostics completed",
      })
      expect(status.checks?.map((check) => check.id)).toEqual([
        "endpoint",
        "auth",
        "model",
        "protocol",
        "streaming",
        "tools",
        "vision",
        "gateway",
        "runtime",
        "codex_app_server",
      ])
      expect(
        status.checks?.find((check) => check.id === "streaming"),
      ).toMatchObject({
        status: "ok",
      })
      expect(
        status.checks?.find((check) => check.id === "codex_app_server"),
      ).toMatchObject({
        status: "ok",
        message: expect.stringContaining("app-server adapter is selected"),
      })
      expect(status.checks?.map((check) => check.id)).not.toContain("codex_sdk")

      expect(storageModule.headersForRenderer(runtimeProfile.headers)).toEqual({
        "HTTP-Referer": "<redacted>",
      })
      expect(JSON.stringify(status)).not.toContain("provider-token-123")
      expect(JSON.stringify(status)).not.toContain(
        "https://locus.local/diagnostics",
      )
    } finally {
      await provider.close()
    }
  })

  test("keeps legacy statuses and preserves safe headers when edit payload omits them", () => {
    const legacyStatus = storageModule.providerProfileTestStatusSchema.parse({
      ok: false,
      checkedAt: "2026-06-01T00:00:00.000Z",
      message: "Legacy failure",
    })
    const existingHeadersJson = JSON.stringify({
      "HTTP-Referer": "https://locus.local",
    })
    const dangerousHeadersJson = JSON.stringify({
      "x-custom-secret": "custom-header-secret",
    })

    expect(legacyStatus).toEqual({
      ok: false,
      checkedAt: "2026-06-01T00:00:00.000Z",
      message: "Legacy failure",
    })
    expect(
      storageModule.providerHeadersJsonForSave(undefined, existingHeadersJson),
    ).toBe(existingHeadersJson)
    expect(
      storageModule.providerHeadersJsonForSave(undefined, dangerousHeadersJson),
    ).toBe("{}")
    expect(
      storageModule.providerHeadersJsonForSave({}, existingHeadersJson),
    ).toBe("{}")
    expect(
      storageModule.headersForRenderer(JSON.parse(existingHeadersJson)),
    ).toEqual({
      "HTTP-Referer": "<redacted>",
    })
    expect(() =>
      storageModule.providerHeadersJsonForSave(
        { "x-custom-secret": "custom-header-secret" },
        existingHeadersJson,
      ),
    ).toThrow("Store credentials in the profile auth mode instead")
  })

  test("redacts failed diagnostic messages before returning and persisting", async () => {
    const provider = await createProviderServer(({ res }) => {
      res.writeHead(401, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          error: {
            message:
              "rejected provider-token-abc Bearer provider-token-abc https://locus.local/rejected",
          },
        }),
      )
    })

    try {
      const runtimeProfile = {
        id: "profile_rejected",
        name: "Rejected Provider",
        presetId: "test",
        protocol: "openai-chat",
        baseUrl: provider.baseUrl,
        defaultModel: "test-model",
        authMode: "bearer",
        token: "provider-token-abc",
        headers: { "HTTP-Referer": "https://locus.local/rejected" },
        targetRuntimes: ["codex"],
        capabilities: { codex: true },
      } as const

      const status =
        await gatewayModule.runProviderProfileDiagnostics(runtimeProfile)
      expect(status).toMatchObject({
        ok: false,
        diagnosticVersion: 1,
        category: "auth_failed",
      })
      expect(JSON.stringify(status)).not.toContain("provider-token-abc")
      expect(JSON.stringify(status)).not.toContain(
        "https://locus.local/rejected",
      )
    } finally {
      await provider.close()
    }
  })

  test("blocks local-only hosted diagnostics before any upstream fetch", async () => {
    const localOnlyKeys = [
      "LOCUS_LOCAL_ONLY",
      "AGENT_CODE_FOR_ME_LOCAL_ONLY",
      "ONECODE_LOCAL_ONLY",
      "MAIN_VITE_LOCAL_ONLY",
    ] as const
    const previousEnv = Object.fromEntries(
      localOnlyKeys.map((key) => [key, process.env[key]]),
    )
    for (const key of localOnlyKeys) delete process.env[key]
    const originalFetch = globalThis.fetch
    let fetchCount = 0
    globalThis.fetch = (async () => {
      fetchCount += 1
      throw new Error("fetch must not be called")
    }) as typeof fetch

    try {
      const status = await gatewayModule.runProviderProfileDiagnostics({
        id: "profile_local_only_blocked",
        name: "Blocked hosted provider",
        presetId: null,
        protocol: "openai-responses",
        baseUrl: "https://api.1code.dev/v1",
        defaultModel: "blocked-model",
        authMode: "bearer",
        token: "provider-token-local-only",
        headers: {},
        targetRuntimes: ["codex"],
        capabilities: { codex: true },
      })

      expect(fetchCount).toBe(0)
      expect(status).toMatchObject({ ok: false })
      expect(status.message).toContain(
        "Local-only mode blocks hosted upstream services",
      )
    } finally {
      globalThis.fetch = originalFetch
      for (const key of localOnlyKeys) {
        const value = previousEnv[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})
