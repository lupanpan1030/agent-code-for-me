import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { normalizeCodexApiKey } from "../../../shared/codex-api-key"
import { getElectronUserDataPath } from "../electron-app"
import {
  decryptStringFromStorage,
  encryptStringForStorage,
  isSecureStorageAvailable,
} from "../secure-storage"
import { normalizeCodexApiModelIds } from "./api-key-validation"

type StoredCodexApiKeyPayload = {
  version: 1
  encryptedApiKey: string
  updatedAt: string
  modelIds?: string[]
}

export type CodexApiKeyStatus = {
  hasApiKey: boolean
  encryptionAvailable: boolean
  updatedAt: string | null
}

const CODEX_API_KEY_STORE_FILENAME = "codex-api-key.json"

type CodexApiKeyStoreOptions = {
  userDataPath?: string
  getUserDataPath?: () => string
}

function getStorePath(options: CodexApiKeyStoreOptions = {}): string {
  const userDataPath =
    options.userDataPath ??
    options.getUserDataPath?.() ??
    getElectronUserDataPath()
  return join(userDataPath, CODEX_API_KEY_STORE_FILENAME)
}

function readPayload(
  options: CodexApiKeyStoreOptions = {},
): StoredCodexApiKeyPayload | null {
  const path = getStorePath(options)
  if (!existsSync(path)) return null

  try {
    const raw = JSON.parse(
      readFileSync(path, "utf-8"),
    ) as Partial<StoredCodexApiKeyPayload>
    if (
      raw.version !== 1 ||
      typeof raw.encryptedApiKey !== "string" ||
      typeof raw.updatedAt !== "string"
    ) {
      return null
    }
    return {
      ...(raw as StoredCodexApiKeyPayload),
      modelIds: normalizeCodexApiModelIds(
        Array.isArray(raw.modelIds)
          ? raw.modelIds.map((id) => ({ id }))
          : undefined,
      ),
    }
  } catch {
    return null
  }
}

function writePayload(
  payload: StoredCodexApiKeyPayload,
  options: CodexApiKeyStoreOptions = {},
): void {
  const path = getStorePath(options)
  const temporaryPath = `${path}.tmp-${crypto.randomUUID()}`
  mkdirSync(dirname(path), { recursive: true })
  try {
    writeFileSync(temporaryPath, JSON.stringify(payload), {
      encoding: "utf-8",
      mode: 0o600,
    })
    chmodSync(temporaryPath, 0o600)
    renameSync(temporaryPath, path)
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    throw error
  }
}

export function getCodexApiKeyStatus(
  options: CodexApiKeyStoreOptions = {},
): CodexApiKeyStatus {
  const payload = readPayload(options)
  return {
    hasApiKey: Boolean(payload?.encryptedApiKey),
    encryptionAvailable: isSecureStorageAvailable(),
    updatedAt: payload?.updatedAt ?? null,
  }
}

export function saveCodexApiKey(
  apiKey: string,
  options: CodexApiKeyStoreOptions = {},
  modelIds: string[] = [],
): CodexApiKeyStatus {
  const normalized = normalizeCodexApiKey(apiKey)
  if (!normalized) {
    throw new Error("Invalid Codex API key")
  }

  const encryptedApiKey = encryptStringForStorage(normalized)
  const payload: StoredCodexApiKeyPayload = {
    version: 1,
    encryptedApiKey,
    updatedAt: new Date().toISOString(),
    modelIds: normalizeCodexApiModelIds(modelIds.map((id) => ({ id }))),
  }
  writePayload(payload, options)

  return getCodexApiKeyStatus(options)
}

export function getStoredCodexApiKeyModelIds(
  options: CodexApiKeyStoreOptions = {},
): string[] {
  return [...(readPayload(options)?.modelIds ?? [])]
}

export function updateStoredCodexApiKeyModelIds(
  modelIds: string[],
  options: CodexApiKeyStoreOptions = {},
): string[] {
  const payload = readPayload(options)
  if (!payload) return []

  const normalizedModelIds = normalizeCodexApiModelIds(
    modelIds.map((id) => ({ id })),
  )
  writePayload({ ...payload, modelIds: normalizedModelIds }, options)
  return [...normalizedModelIds]
}

export function readCodexApiKey(
  options: CodexApiKeyStoreOptions = {},
): string | null {
  const payload = readPayload(options)
  if (!payload?.encryptedApiKey) return null

  const decrypted = decryptStringFromStorage(payload.encryptedApiKey)
  if (!decrypted) return null

  return normalizeCodexApiKey(decrypted)
}

export function removeCodexApiKey(
  options: CodexApiKeyStoreOptions = {},
): CodexApiKeyStatus {
  const path = getStorePath(options)
  if (existsSync(path)) {
    unlinkSync(path)
  }
  return getCodexApiKeyStatus(options)
}
