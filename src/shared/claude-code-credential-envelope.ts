import { normalizeHeaderSafeCredential } from "./secret-redaction-policy"

export type ClaudeOAuthCredentialSource =
  | "macos_keychain"
  | "windows_credentials_file"
  | "linux_secret_service"
  | "linux_pass"
  | "credentials_file"

export type ClaudeCodeCredentialStorageFormat =
  | "envelope"
  | "legacy_plain_token"

export type ClaudeCodeCredentialEnvelope = {
  version: 1
  kind: "claude_code_oauth"
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  scopes?: string[]
  source?: ClaudeOAuthCredentialSource | "hosted_oauth" | "manual" | "legacy_db"
  importedAt: string
  updatedAt: string
}

export type ClaudeOAuthCredentialLike = {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  scopes?: string[]
  source?: ClaudeOAuthCredentialSource
}

export type StoredClaudeCodeCredential = {
  envelope: ClaudeCodeCredentialEnvelope
  storageFormat: ClaudeCodeCredentialStorageFormat
}

const CLAUDE_CREDENTIAL_SOURCES = new Set<
  NonNullable<ClaudeCodeCredentialEnvelope["source"]>
>([
  "macos_keychain",
  "windows_credentials_file",
  "linux_secret_service",
  "linux_pass",
  "credentials_file",
  "hosted_oauth",
  "manual",
  "legacy_db",
])

function normalizeSource(
  source: ClaudeCodeCredentialEnvelope["source"] | undefined,
): ClaudeCodeCredentialEnvelope["source"] {
  const normalized = source ?? "manual"
  if (!CLAUDE_CREDENTIAL_SOURCES.has(normalized)) {
    throw new Error("Claude Code credential source is invalid.")
  }
  return normalized
}

function requireCredential(value: unknown, kind: "access" | "refresh"): string {
  const normalized = normalizeHeaderSafeCredential(value)
  if (!normalized) {
    throw new Error(`Claude Code ${kind} credential is invalid.`)
  }
  return normalized
}

export function createClaudeCodeCredentialEnvelope(
  credential: ClaudeOAuthCredentialLike,
  source?: ClaudeCodeCredentialEnvelope["source"],
  previous?: ClaudeCodeCredentialEnvelope,
): ClaudeCodeCredentialEnvelope {
  const now = new Date().toISOString()
  const accessToken = requireCredential(credential.accessToken, "access")
  const refreshToken =
    credential.refreshToken === undefined
      ? undefined
      : requireCredential(credential.refreshToken, "refresh")
  if (
    credential.expiresAt !== undefined &&
    (!Number.isFinite(credential.expiresAt) || credential.expiresAt <= 0)
  ) {
    throw new Error("Claude Code credential expiry is invalid.")
  }
  if (
    credential.scopes !== undefined &&
    (!Array.isArray(credential.scopes) ||
      !credential.scopes.every((scope) => typeof scope === "string"))
  ) {
    throw new Error("Claude Code credential scopes are invalid.")
  }
  const importedAt = previous?.importedAt ?? now
  if (!Number.isFinite(Date.parse(importedAt))) {
    throw new Error("Claude Code credential import timestamp is invalid.")
  }

  return {
    version: 1,
    kind: "claude_code_oauth",
    accessToken,
    ...(refreshToken && { refreshToken }),
    ...(credential.expiresAt !== undefined && {
      expiresAt: credential.expiresAt,
    }),
    ...(credential.scopes !== undefined && { scopes: [...credential.scopes] }),
    source: normalizeSource(source ?? credential.source),
    importedAt,
    updatedAt: now,
  }
}

function parseEnvelope(value: unknown): ClaudeCodeCredentialEnvelope | null {
  if (!value || typeof value !== "object") return null

  const candidate = value as Partial<ClaudeCodeCredentialEnvelope>
  if (
    candidate.version !== 1 ||
    candidate.kind !== "claude_code_oauth" ||
    typeof candidate.importedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.importedAt)) ||
    typeof candidate.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.updatedAt)) ||
    (candidate.source !== undefined &&
      !CLAUDE_CREDENTIAL_SOURCES.has(candidate.source)) ||
    (candidate.expiresAt !== undefined &&
      (!Number.isFinite(candidate.expiresAt) || candidate.expiresAt <= 0)) ||
    (candidate.scopes !== undefined &&
      (!Array.isArray(candidate.scopes) ||
        !candidate.scopes.every((scope) => typeof scope === "string")))
  ) {
    return null
  }

  const accessToken = normalizeHeaderSafeCredential(candidate.accessToken)
  const refreshToken =
    candidate.refreshToken === undefined
      ? undefined
      : normalizeHeaderSafeCredential(candidate.refreshToken)
  if (!accessToken || (candidate.refreshToken !== undefined && !refreshToken)) {
    return null
  }

  return {
    version: 1,
    kind: "claude_code_oauth",
    accessToken,
    ...(refreshToken && { refreshToken }),
    ...(candidate.expiresAt !== undefined && {
      expiresAt: candidate.expiresAt,
    }),
    ...(candidate.scopes !== undefined && { scopes: [...candidate.scopes] }),
    source: candidate.source ?? "manual",
    importedAt: candidate.importedAt,
    updatedAt: candidate.updatedAt,
  }
}

export function parseClaudeCodeCredentialPayload(
  payload: string,
): StoredClaudeCodeCredential | null {
  const trimmed = payload.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    const envelope = parseEnvelope(parsed)
    return envelope ? { envelope, storageFormat: "envelope" } : null
  } catch {
    // Legacy rows decrypt to a bare access token string.
  }

  const accessToken = normalizeHeaderSafeCredential(payload)
  if (!accessToken) return null

  return {
    envelope: {
      version: 1,
      kind: "claude_code_oauth",
      accessToken,
      source: "legacy_db",
      importedAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    storageFormat: "legacy_plain_token",
  }
}
