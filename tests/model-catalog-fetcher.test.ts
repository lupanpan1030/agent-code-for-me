import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createModelCatalogFetcher,
  getModelCatalogCachePath,
  MODEL_CATALOG_URL,
  resolveModelCatalogUrl,
} from "../src/main/lib/model-catalog/fetcher"
import { BUILTIN_MODEL_CATALOG } from "../src/shared/model-catalog"

const tempDirectories: string[] = []

function createTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "locus-model-catalog-test-"))
  tempDirectories.push(directory)
  return directory
}

function validManifest(id = "remote-model") {
  return {
    schemaVersion: 1,
    claude: [{ id, label: id }],
    codex: [],
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("model catalog fetcher", () => {
  test("honors the TTL across repeated calls and cache reloads", async () => {
    const userDataPath = createTempDirectory()
    let now = Date.parse("2026-07-23T00:00:00.000Z")
    let fetchCalls = 0
    const fetchImpl = async () => {
      fetchCalls += 1
      return jsonResponse(validManifest(`remote-${fetchCalls}`))
    }
    const fetcher = createModelCatalogFetcher({
      userDataPath,
      isPackaged: false,
      env: {},
      localOnlyMode: () => false,
      fetchImpl,
      ttlMs: 1_000,
      now: () => now,
      onDiagnostic: () => undefined,
    })

    expect((await fetcher.refresh()).source).toBe("remote")
    expect(fetchCalls).toBe(1)
    await fetcher.refresh()
    now += 999
    await fetcher.refresh()
    expect(fetchCalls).toBe(1)

    const reloaded = createModelCatalogFetcher({
      userDataPath,
      isPackaged: false,
      env: {},
      localOnlyMode: () => false,
      fetchImpl,
      ttlMs: 1_000,
      now: () => now,
      onDiagnostic: () => undefined,
    })
    expect((await reloaded.refresh()).source).toBe("cache")
    expect(fetchCalls).toBe(1)

    now += 1
    expect((await reloaded.refresh()).source).toBe("remote")
    expect(fetchCalls).toBe(2)
  })

  test("invalid remote data falls back to cache, then built-ins", async () => {
    const cachedUserDataPath = createTempDirectory()
    const writer = createModelCatalogFetcher({
      userDataPath: cachedUserDataPath,
      isPackaged: false,
      env: {},
      localOnlyMode: () => false,
      fetchImpl: async () => jsonResponse(validManifest("last-good")),
      now: () => Date.parse("2026-07-22T00:00:00.000Z"),
      onDiagnostic: () => undefined,
    })
    await writer.refresh()

    const invalidWithCache = createModelCatalogFetcher({
      userDataPath: cachedUserDataPath,
      isPackaged: false,
      env: {},
      localOnlyMode: () => false,
      fetchImpl: async () =>
        jsonResponse({ ...validManifest(), unexpected: true }),
      ttlMs: 1,
      now: () => Date.parse("2026-07-23T00:00:00.000Z"),
      onDiagnostic: () => undefined,
    })
    const cachedFallback = await invalidWithCache.refresh()
    expect(cachedFallback.source).toBe("cache")
    expect(
      cachedFallback.catalog.claude.some((model) => model.id === "last-good"),
    ).toBe(true)

    const invalidWithoutCache = createModelCatalogFetcher({
      userDataPath: createTempDirectory(),
      isPackaged: false,
      env: {},
      localOnlyMode: () => false,
      fetchImpl: async () => jsonResponse({ schemaVersion: 2 }),
      onDiagnostic: () => undefined,
    })
    const builtinFallback = await invalidWithoutCache.refresh()
    expect(builtinFallback.source).toBe("builtin")
    expect(builtinFallback.catalog.claude.map((model) => model.id)).toEqual([
      "fable",
      "opus",
      "sonnet",
      "haiku",
    ])
  })

  test("aborts and cancels a streamed response as soon as it exceeds the byte limit", async () => {
    let requestSignal: AbortSignal | undefined
    let cancelReason: unknown
    const oversizedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(9))
      },
      cancel(reason) {
        cancelReason = reason
      },
    })
    const fetcher = createModelCatalogFetcher({
      userDataPath: createTempDirectory(),
      isPackaged: false,
      env: {},
      localOnlyMode: () => false,
      fetchImpl: async (_input, init) => {
        requestSignal = init?.signal ?? undefined
        return new Response(oversizedBody, { status: 200 })
      },
      maxResponseBytes: 8,
      onDiagnostic: () => undefined,
    })

    expect((await fetcher.refresh()).source).toBe("builtin")
    expect(requestSignal?.aborted).toBe(true)
    expect(cancelReason).toBeInstanceOf(Error)
    expect((cancelReason as Error).message).toBe(
      "Model catalog response exceeded size limit.",
    )
  })

  test("local-only mode never invokes the catalog fetch implementation", async () => {
    let fetchCalls = 0
    const fetcher = createModelCatalogFetcher({
      userDataPath: createTempDirectory(),
      isPackaged: false,
      env: {},
      localOnlyMode: () => true,
      fetchImpl: async () => {
        fetchCalls += 1
        return jsonResponse(validManifest())
      },
      onDiagnostic: () => undefined,
    })

    expect((await fetcher.get()).source).toBe("builtin")
    expect((await fetcher.refresh()).source).toBe("builtin")
    expect(fetchCalls).toBe(0)
  })

  test("local-only mode ignores a warm remote cache and returns built-ins", async () => {
    const userDataPath = createTempDirectory()
    const writer = createModelCatalogFetcher({
      userDataPath,
      isPackaged: false,
      env: {},
      localOnlyMode: () => false,
      fetchImpl: async () => jsonResponse(validManifest("cached-remote")),
      onDiagnostic: () => undefined,
    })
    expect((await writer.refresh()).source).toBe("remote")

    let fetchCalls = 0
    const localOnlyFetcher = createModelCatalogFetcher({
      userDataPath,
      isPackaged: false,
      env: {},
      localOnlyMode: () => true,
      fetchImpl: async () => {
        fetchCalls += 1
        return jsonResponse(validManifest("unexpected-remote"))
      },
      onDiagnostic: () => undefined,
    })

    expect(await localOnlyFetcher.get()).toEqual({
      catalog: BUILTIN_MODEL_CATALOG,
      source: "builtin",
      fetchedAt: null,
    })
    expect(await localOnlyFetcher.refresh()).toEqual({
      catalog: BUILTIN_MODEL_CATALOG,
      source: "builtin",
      fetchedAt: null,
    })
    expect(fetchCalls).toBe(0)
  })

  test("writes the last-good cache with owner-only permissions", async () => {
    const userDataPath = createTempDirectory()
    const fetcher = createModelCatalogFetcher({
      userDataPath,
      isPackaged: false,
      env: {},
      localOnlyMode: () => false,
      fetchImpl: async () => jsonResponse(validManifest()),
      onDiagnostic: () => undefined,
    })

    await fetcher.refresh()
    const cachePath = getModelCatalogCachePath({ userDataPath })
    const cache = JSON.parse(readFileSync(cachePath, "utf8"))
    expect(cache.catalog).toEqual(validManifest())
    if (process.platform !== "win32") {
      expect(statSync(cachePath).mode & 0o777).toBe(0o600)
    }
  })

  test("honors the URL override only in unpackaged mode", () => {
    const override = "http://127.0.0.1:4567/catalog.json"
    expect(
      resolveModelCatalogUrl({
        isPackaged: false,
        env: { LOCUS_MODEL_CATALOG_URL: override },
      }).toString(),
    ).toBe(override)
    expect(
      resolveModelCatalogUrl({
        isPackaged: true,
        env: { LOCUS_MODEL_CATALOG_URL: override },
      }).toString(),
    ).toBe(MODEL_CATALOG_URL)
  })
})
