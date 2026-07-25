import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { z } from "zod"
import {
  BUILTIN_MODEL_CATALOG,
  type MergedModelCatalog,
  type ModelCatalogManifest,
  mergeModelCatalog,
  modelCatalogManifestSchema,
} from "../../../shared/model-catalog"
import { getElectronApp, getElectronUserDataPath } from "../electron-app"
import { isLocalOnlyMode } from "../local-only"

export const MODEL_CATALOG_URL =
  "https://raw.githubusercontent.com/lupanpan1030/agent-code-for-me/main/docs/model-catalog.json"
export const MODEL_CATALOG_CACHE_FILE = "model-catalog-cache.json"

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000

const cacheFileSchema = z
  .object({
    fetchedAt: z.string().datetime(),
    catalog: modelCatalogManifestSchema,
  })
  .strict()

type ModelCatalogFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export type ModelCatalogSource = "builtin" | "cache" | "remote"

export type ModelCatalogSnapshot = {
  catalog: MergedModelCatalog
  source: ModelCatalogSource
  fetchedAt: string | null
}

export type ModelCatalogFetcherOptions = {
  builtinCatalog?: MergedModelCatalog
  cachePath?: string
  userDataPath?: string
  env?: NodeJS.ProcessEnv
  isPackaged?: boolean
  fetchImpl?: ModelCatalogFetch
  timeoutMs?: number
  maxResponseBytes?: number
  ttlMs?: number
  now?: () => number
  localOnlyMode?: () => boolean
  onDiagnostic?: (message: string, error?: unknown) => void
}

export type ModelCatalogFetcher = {
  get: () => Promise<ModelCatalogSnapshot>
  refresh: () => Promise<ModelCatalogSnapshot>
  subscribe: (listener: (snapshot: ModelCatalogSnapshot) => void) => () => void
}

function defaultDiagnostic(message: string, error?: unknown): void {
  console.warn(`[model-catalog] ${message}`, error)
}

function resolveIsPackaged(options: ModelCatalogFetcherOptions): boolean {
  if (typeof options.isPackaged === "boolean") return options.isPackaged
  return getElectronApp().isPackaged === true
}

export function resolveModelCatalogUrl(
  options: Pick<ModelCatalogFetcherOptions, "env" | "isPackaged"> = {},
): URL {
  const isPackaged = resolveIsPackaged(options)
  const override = isPackaged
    ? undefined
    : (options.env ?? process.env).LOCUS_MODEL_CATALOG_URL?.trim()
  const url = new URL(override || MODEL_CATALOG_URL)
  if (url.protocol !== "https:" && (isPackaged || url.protocol !== "http:")) {
    throw new Error("Model catalog URL must use HTTP(S).")
  }
  return url
}

export function getModelCatalogCachePath(
  options: Pick<ModelCatalogFetcherOptions, "cachePath" | "userDataPath"> = {},
): string {
  return (
    options.cachePath ??
    join(
      options.userDataPath ?? getElectronUserDataPath(),
      MODEL_CATALOG_CACHE_FILE,
    )
  )
}

function withTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal
  abort: (reason: Error) => void
  cleanup: () => void
} {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error("Model catalog request timed out."))
  }, timeoutMs)
  return {
    signal: controller.signal,
    abort: (reason) => controller.abort(reason),
    cleanup: () => clearTimeout(timeout),
  }
}

async function readBoundedJson(
  response: Response,
  maxResponseBytes: number,
  abort: (reason: Error) => void,
): Promise<unknown> {
  const sizeLimitError = () =>
    new Error("Model catalog response exceeded size limit.")
  const contentLength = response.headers.get("content-length")
  if (contentLength && Number(contentLength) > maxResponseBytes) {
    const error = sizeLimitError()
    abort(error)
    await response.body?.cancel(error).catch(() => undefined)
    throw error
  }

  if (!response.body) {
    throw new Error("Model catalog returned invalid JSON.")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let responseBytes = 0
  let text = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      responseBytes += value.byteLength
      if (responseBytes > maxResponseBytes) {
        const error = sizeLimitError()
        abort(error)
        await reader.cancel(error).catch(() => undefined)
        throw error
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new Error("Model catalog returned invalid JSON.")
  }
}

async function fetchRemoteCatalog(input: {
  url: URL
  fetchImpl: ModelCatalogFetch
  timeoutMs: number
  maxResponseBytes: number
}): Promise<ModelCatalogManifest> {
  const timeout = withTimeoutSignal(input.timeoutMs)
  try {
    const response = await input.fetchImpl(input.url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: timeout.signal,
    })
    if (!response.ok) {
      throw new Error(
        `Model catalog request failed with status ${response.status}.`,
      )
    }
    return modelCatalogManifestSchema.parse(
      await readBoundedJson(response, input.maxResponseBytes, timeout.abort),
    )
  } finally {
    timeout.cleanup()
  }
}

async function readCachedCatalog(
  cachePath: string,
): Promise<{ fetchedAt: string; catalog: ModelCatalogManifest } | null> {
  try {
    const parsed = cacheFileSchema.safeParse(
      JSON.parse(await readFile(cachePath, "utf8")),
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

async function writeCachedCatalog(input: {
  cachePath: string
  fetchedAt: string
  catalog: ModelCatalogManifest
}): Promise<void> {
  await mkdir(dirname(input.cachePath), { recursive: true })
  const tempPath = `${input.cachePath}.tmp`
  try {
    await writeFile(
      tempPath,
      `${JSON.stringify(
        { fetchedAt: input.fetchedAt, catalog: input.catalog },
        null,
        2,
      )}\n`,
      { encoding: "utf8", mode: 0o600 },
    )
    await chmod(tempPath, 0o600)
    await rename(tempPath, input.cachePath)
    await chmod(input.cachePath, 0o600)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export function createModelCatalogFetcher(
  options: ModelCatalogFetcherOptions = {},
): ModelCatalogFetcher {
  const builtinCatalog = options.builtinCatalog ?? BUILTIN_MODEL_CATALOG
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const maxResponseBytes = Math.max(
    1,
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
  )
  const ttlMs = Math.max(1, options.ttlMs ?? DEFAULT_TTL_MS)
  const now = options.now ?? Date.now
  const readLocalOnlyMode = options.localOnlyMode ?? isLocalOnlyMode
  const diagnostic = options.onDiagnostic ?? defaultDiagnostic
  const listeners = new Set<(snapshot: ModelCatalogSnapshot) => void>()

  let snapshot: ModelCatalogSnapshot = {
    catalog: builtinCatalog,
    source: "builtin",
    fetchedAt: null,
  }
  let initializePromise: Promise<void> | null = null
  let refreshPromise: Promise<ModelCatalogSnapshot> | null = null
  let lastRefreshAttemptAt: number | null = null

  const initialize = async (): Promise<void> => {
    const cachePath = getModelCatalogCachePath(options)
    const cached = await readCachedCatalog(cachePath)
    if (!cached) return
    snapshot = {
      catalog: mergeModelCatalog(builtinCatalog, cached.catalog),
      source: "cache",
      fetchedAt: cached.fetchedAt,
    }
  }

  const ensureInitialized = async (): Promise<void> => {
    initializePromise ??= initialize()
    await initializePromise
  }

  const isNetworkBlocked = (): boolean => {
    try {
      const localOnly = readLocalOnlyMode()
      if (localOnly) {
        snapshot = {
          catalog: builtinCatalog,
          source: "builtin",
          fetchedAt: null,
        }
      }
      return localOnly
    } catch (error) {
      snapshot = {
        catalog: builtinCatalog,
        source: "builtin",
        fetchedAt: null,
      }
      diagnostic(
        "Local-only catalog guard failed; using built-ins without network.",
        error,
      )
      return true
    }
  }

  const refresh = async (): Promise<ModelCatalogSnapshot> => {
    await ensureInitialized()
    if (isNetworkBlocked()) return snapshot
    if (refreshPromise) return refreshPromise

    const currentTime = now()
    const fetchedAt = snapshot.fetchedAt
      ? Date.parse(snapshot.fetchedAt)
      : Number.NaN
    const throttleStart = lastRefreshAttemptAt ?? fetchedAt
    if (Number.isFinite(throttleStart) && currentTime - throttleStart < ttlMs) {
      return snapshot
    }
    lastRefreshAttemptAt = currentTime

    refreshPromise = (async () => {
      try {
        const catalog = await fetchRemoteCatalog({
          url: resolveModelCatalogUrl(options),
          fetchImpl,
          timeoutMs,
          maxResponseBytes,
        })
        const fetchedAtIso = new Date(currentTime).toISOString()
        try {
          await writeCachedCatalog({
            cachePath: getModelCatalogCachePath(options),
            fetchedAt: fetchedAtIso,
            catalog,
          })
        } catch (error) {
          diagnostic("Failed to persist the last-good catalog cache.", error)
        }
        snapshot = {
          catalog: mergeModelCatalog(builtinCatalog, catalog),
          source: "remote",
          fetchedAt: fetchedAtIso,
        }
        for (const listener of listeners) listener(snapshot)
      } catch (error) {
        diagnostic(
          "Remote catalog refresh failed; using local fallback.",
          error,
        )
      }
      return snapshot
    })().finally(() => {
      refreshPromise = null
    })

    return refreshPromise
  }

  return {
    get: async () => {
      await ensureInitialized()
      if (isNetworkBlocked()) return snapshot
      void refresh()
      return snapshot
    },
    refresh,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

let defaultFetcher: ModelCatalogFetcher | null = null

export function getDefaultModelCatalogFetcher(): ModelCatalogFetcher {
  defaultFetcher ??= createModelCatalogFetcher()
  return defaultFetcher
}

export function clearDefaultModelCatalogFetcherForTest(): void {
  defaultFetcher = null
}
