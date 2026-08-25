import { beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  assertValidCodexApiKey,
  clearCachedCodexApiKeyModelIds,
  getCachedCodexApiKeyModelIds,
  subscribeCodexApiKeyModelIds,
  validateCodexApiKey,
} from "../src/main/lib/codex/api-key-validation"

describe("Codex API key validation", () => {
  beforeEach(() => clearCachedCodexApiKeyModelIds())

  test("probes OpenAI models with the app-managed key without exposing it", async () => {
    const seen: Array<{ url: string; authorization: string | null }> = []
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("Authorization"),
      })
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }

    await expect(
      validateCodexApiKey("sk-valid_for_test", { fetchImpl }),
    ).resolves.toEqual({ ok: true })

    expect(seen).toEqual([
      {
        url: "https://api.openai.com/v1/models",
        authorization: "Bearer sk-valid_for_test",
      },
    ])
  })

  test("classifies rejected OpenAI keys as needs-auth and redacts provider output", async () => {
    const apiKey = "sk-rejected_for_test"
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          error: {
            message: `Incorrect API key provided: ${apiKey}.`,
            type: "invalid_request_error",
            code: "invalid_api_key",
          },
        }),
        { status: 401 },
      )

    const result = await validateCodexApiKey(apiKey, { fetchImpl })

    expect(result).toMatchObject({
      ok: false,
      category: "auth_failed",
      status: "needs-auth",
      httpStatus: 401,
    })
    expect(JSON.stringify(result)).not.toContain(apiKey)
    expect(JSON.stringify(result)).toContain("Incorrect API key provided: ***.")
  })

  test("caches only Codex-capable ids from the existing models probe", async () => {
    let requestCount = 0
    const fetchImpl = async () => {
      requestCount += 1
      return new Response(
        JSON.stringify({
          data: [
            { id: "gpt-5.5" },
            { id: "o3-pro" },
            { id: "codex-next" },
            { id: "gpt-evil;drop" },
            { id: "gpt-5.5" },
            { id: "text-embedding-3-large" },
            { id: 42 },
            null,
          ],
        }),
        { status: 200 },
      )
    }

    await expect(
      validateCodexApiKey("sk-valid_for_test", { fetchImpl }),
    ).resolves.toEqual({ ok: true })
    expect(requestCount).toBe(1)
    expect(getCachedCodexApiKeyModelIds()).toEqual([
      "gpt-5.5",
      "o3-pro",
      "codex-next",
    ])
  })

  test("publishes live model ids after the existing validation probe", async () => {
    const snapshots: string[][] = []
    const unsubscribe = subscribeCodexApiKeyModelIds((modelIds) => {
      snapshots.push(modelIds)
    })

    try {
      await expect(
        validateCodexApiKey("sk-valid_for_test", {
          fetchImpl: async () =>
            new Response(
              JSON.stringify({ data: [{ id: "gpt-live-after-validation" }] }),
              { status: 200 },
            ),
        }),
      ).resolves.toEqual({ ok: true })
      expect(snapshots).toEqual([["gpt-live-after-validation"]])
    } finally {
      unsubscribe()
    }
  })

  test("caps unique safe live model ids", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          data: Array.from({ length: 600 }, (_, index) => ({
            id: `gpt-safe-${index}`,
          })),
        }),
        { status: 200 },
      )

    await expect(
      validateCodexApiKey("sk-valid_for_test", { fetchImpl }),
    ).resolves.toEqual({ ok: true })
    expect(getCachedCodexApiKeyModelIds()).toHaveLength(500)
    expect(getCachedCodexApiKeyModelIds().at(-1)).toBe("gpt-safe-499")
  })

  test("keeps validation successful and clears live ids for oversized streamed bodies", async () => {
    await validateCodexApiKey("sk-valid_for_test", {
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: [{ id: "gpt-5.5" }] }), {
          status: 200,
        }),
    })
    expect(getCachedCodexApiKeyModelIds()).toEqual(["gpt-5.5"])

    let cancelled = false
    const oversizedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            JSON.stringify({ data: [{ id: "gpt-too-large" }] }),
          ),
        )
      },
      cancel() {
        cancelled = true
      },
    })

    await expect(
      validateCodexApiKey("sk-valid_for_test", {
        fetchImpl: async () => new Response(oversizedBody, { status: 200 }),
        maxResponseBytes: 16,
      }),
    ).resolves.toEqual({ ok: true })
    expect(cancelled).toBe(true)
    expect(getCachedCodexApiKeyModelIds()).toEqual([])
  })

  test("keeps validation successful and clears live ids for malformed bodies", async () => {
    await validateCodexApiKey("sk-valid_for_test", {
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: [{ id: "gpt-5.5" }] }), {
          status: 200,
        }),
    })
    expect(getCachedCodexApiKeyModelIds()).toEqual(["gpt-5.5"])

    await expect(
      validateCodexApiKey("sk-valid_for_test", {
        fetchImpl: async () => new Response("not-json", { status: 200 }),
      }),
    ).resolves.toEqual({ ok: true })
    expect(getCachedCodexApiKeyModelIds()).toEqual([])
  })

  test("redacts masked OpenAI key echoes from validation errors", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          error: {
            message:
              "Incorrect API key provided: sk-**************************0608.",
          },
        }),
        { status: 401 },
      )

    const result = await validateCodexApiKey("sk-invalid_for_test", {
      fetchImpl,
    })

    expect(JSON.stringify(result)).toContain(
      "Incorrect API key provided: sk-***.",
    )
    expect(JSON.stringify(result)).not.toContain("0608")
  })

  test("throws clear save-time errors for invalid keys", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: "Unauthorized" } }), {
        status: 401,
      })

    await expect(
      assertValidCodexApiKey("sk-invalid_for_test", { fetchImpl }),
    ).rejects.toThrow("OpenAI rejected the saved Codex API key (401).")
  })

  test("keeps Codex key validation ahead of save, job creation, and adapter startup", () => {
    const codexRouterSource = readFileSync(
      join(process.cwd(), "src/main/lib/trpc/routers/codex.ts"),
      "utf-8",
    )
    const providerBindingSource = readFileSync(
      join(
        process.cwd(),
        "src/main/lib/codex/desktop-run-provider-binding.ts",
      ),
      "utf-8",
    )

    expect(codexRouterSource).toContain("../../codex/api-key-validation")
    expect(codexRouterSource).toContain(
      "const validation = await validateCodexApiKey(input.apiKey)",
    )
    // Save must still hard-reject a key that is confirmed bad, while a transient
    // network/rate-limit failure is allowed to store as unverified.
    expect(codexRouterSource).toContain('validation.category === "auth_failed"')

    const validationIndex = providerBindingSource.indexOf(
      "const apiKeyValidation = await dependencies.validateCodexApiKey",
    )
    const bindingReturnIndex = providerBindingSource.indexOf(
      "providerBinding: {",
      validationIndex,
    )
    const bindingResolutionIndex = codexRouterSource.indexOf(
      "const providerBindingResult = await providerBindingStage.resolve",
    )
    const jobCreationIndex = codexRouterSource.indexOf(
      "const desktopJob = createAndRegisterCodexDesktopRunJob",
    )
    const adapterCreationIndex = codexRouterSource.indexOf(
      "const codexAdapter = createCodexAppServerAdapter",
    )

    expect(validationIndex).toBeGreaterThan(0)
    expect(bindingReturnIndex).toBeGreaterThan(validationIndex)
    expect(bindingResolutionIndex).toBeGreaterThan(0)
    expect(jobCreationIndex).toBeGreaterThan(bindingResolutionIndex)
    expect(adapterCreationIndex).toBeGreaterThan(bindingResolutionIndex)
    expect(providerBindingSource).toContain(
      "buildCodexRuntimeStatusChunk(blocker)",
    )
    expect(providerBindingSource).toContain(
      "buildCodexCapabilityErrorChunk(blocker)",
    )
  })
})
