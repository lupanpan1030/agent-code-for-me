import { execSync, spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { normalizeHeaderSafeCredential } from "../../shared/secret-redaction-policy"
import { redactExactSecretHints } from "./agent-runtime/redaction"
import { getBundledClaudeBinaryPath } from "./claude/env"
import { buildExtendedPath, isWindows } from "./platform"

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken: string
    refreshToken?: string
    expiresAt?: number
    scopes?: string[]
  }
}

export interface ClaudeOAuthCredential {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  scopes?: string[]
  source?: ClaudeOAuthCredentialSource
}

export type ClaudeOAuthCredentialSource =
  | "macos_keychain"
  | "windows_credentials_file"
  | "linux_secret_service"
  | "linux_pass"
  | "credentials_file"

export const CLAUDE_CODE_OAUTH_CLIENT_ID =
  "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
export const CLAUDE_CODE_TOKEN_URL =
  "https://platform.claude.com/v1/oauth/token"
const CLAUDE_CREDENTIAL_ERROR_DETAIL_MAX_LENGTH = 500

type ClaudeCodeTokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

function normalizeClaudeOAuthCredential(
  credential: ClaudeOAuthCredential | null,
): ClaudeOAuthCredential | null {
  if (!credential) return null

  const accessToken = normalizeHeaderSafeCredential(credential.accessToken)
  const refreshToken =
    credential.refreshToken === undefined
      ? undefined
      : normalizeHeaderSafeCredential(credential.refreshToken)
  if (
    !accessToken ||
    (credential.refreshToken !== undefined && !refreshToken)
  ) {
    return null
  }

  return {
    accessToken,
    ...(refreshToken && { refreshToken }),
    ...(credential.expiresAt !== undefined && {
      expiresAt: credential.expiresAt,
    }),
    ...(credential.scopes !== undefined && { scopes: credential.scopes }),
    ...(credential.source !== undefined && { source: credential.source }),
  }
}

export function redactAndTruncateClaudeCredentialErrorDetail(
  value: string,
  secretHints: readonly string[],
): string {
  return redactExactSecretHints(value, secretHints).value.slice(
    0,
    CLAUDE_CREDENTIAL_ERROR_DETAIL_MAX_LENGTH,
  )
}

export async function exchangeClaudeCodeAuthCode(input: {
  authorizationCode: string
  state: string
  codeVerifier: string
  redirectUri: string
}): Promise<{
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  scopes?: string[]
}> {
  let response: Response
  try {
    response = await fetch(CLAUDE_CODE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: input.authorizationCode,
        redirect_uri: input.redirectUri,
        client_id: CLAUDE_CODE_OAUTH_CLIENT_ID,
        code_verifier: input.codeVerifier,
        state: input.state,
      }),
    })
  } catch {
    throw new Error("Claude Code token exchange failed.")
  }

  if (!response.ok) {
    throw new Error(
      `Claude Code token exchange failed (HTTP ${response.status}).`,
    )
  }

  let tokenResponse: ClaudeCodeTokenResponse
  try {
    tokenResponse = (await response.json()) as ClaudeCodeTokenResponse
  } catch {
    throw new Error("Claude Code token exchange returned an invalid response.")
  }
  const accessToken = normalizeHeaderSafeCredential(tokenResponse.access_token)
  const refreshToken =
    tokenResponse.refresh_token === undefined
      ? undefined
      : normalizeHeaderSafeCredential(tokenResponse.refresh_token)
  if (
    !accessToken ||
    (tokenResponse.refresh_token !== undefined && !refreshToken)
  ) {
    throw new Error(
      "Claude Code token exchange returned an invalid credential.",
    )
  }

  return {
    accessToken,
    ...(refreshToken && { refreshToken }),
    expiresAt: tokenResponse.expires_in
      ? Date.now() + tokenResponse.expires_in * 1000
      : undefined,
    scopes: tokenResponse.scope?.split(" ").filter(Boolean),
  }
}

/**
 * Read Claude OAuth credentials from system credential store
 * Dispatches to platform-specific implementation
 */
function readFromKeychain(
  credentialsDirectory: string,
): ClaudeOAuthCredential | null {
  if (process.platform === "darwin") {
    return readFromMacOSKeychain()
  } else if (process.platform === "win32") {
    return readFromWindowsCredentialManager(credentialsDirectory)
  } else if (process.platform === "linux") {
    return readFromLinuxSecretService()
  }
  return null
}

/**
 * Read Claude OAuth credentials from macOS Keychain
 */
function readFromMacOSKeychain(): ClaudeOAuthCredential | null {
  try {
    const result = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim()

    if (result) {
      const credentials: ClaudeCredentials = JSON.parse(result)
      if (credentials.claudeAiOauth) {
        return {
          accessToken: credentials.claudeAiOauth.accessToken,
          refreshToken: credentials.claudeAiOauth.refreshToken,
          expiresAt: credentials.claudeAiOauth.expiresAt,
          scopes: credentials.claudeAiOauth.scopes,
          source: "macos_keychain",
        }
      }
    }
  } catch {
    // Keychain entry not found or parse error
  }
  return null
}

/**
 * Read Claude OAuth credentials from Windows Credential Manager
 * Falls back to credentials file which Claude Code uses on Windows
 */
function readFromWindowsCredentialManager(
  credentialsDirectory: string,
): ClaudeOAuthCredential | null {
  try {
    // Read from the credentials file location that Claude Code uses on Windows
    const credentialsPath = join(credentialsDirectory, ".credentials.json")
    if (existsSync(credentialsPath)) {
      const content = readFileSync(credentialsPath, "utf-8")
      const credentials: ClaudeCredentials = JSON.parse(content)
      if (credentials.claudeAiOauth) {
        return {
          accessToken: credentials.claudeAiOauth.accessToken,
          refreshToken: credentials.claudeAiOauth.refreshToken,
          expiresAt: credentials.claudeAiOauth.expiresAt,
          scopes: credentials.claudeAiOauth.scopes,
          source: "windows_credentials_file",
        }
      }
    }
  } catch {
    // Credential Manager read failed
  }
  return null
}

/**
 * Read Claude OAuth credentials from Linux Secret Service (libsecret)
 * Uses secret-tool CLI which interfaces with GNOME Keyring or KDE Wallet
 */
function readFromLinuxSecretService(): ClaudeOAuthCredential | null {
  try {
    // Try secret-tool (works with GNOME Keyring, KDE Wallet via libsecret)
    const result = execSync(
      'secret-tool lookup service "Claude Code" account "credentials" 2>/dev/null',
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim()

    if (result) {
      const credentials: ClaudeCredentials = JSON.parse(result)
      if (credentials.claudeAiOauth) {
        return {
          accessToken: credentials.claudeAiOauth.accessToken,
          refreshToken: credentials.claudeAiOauth.refreshToken,
          expiresAt: credentials.claudeAiOauth.expiresAt,
          scopes: credentials.claudeAiOauth.scopes,
          source: "linux_secret_service",
        }
      }
    }
  } catch {
    // secret-tool not available or entry not found
  }

  // Fallback: try pass (password-store)
  try {
    const result = execSync("pass show claude-code/credentials 2>/dev/null", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()

    if (result) {
      const credentials: ClaudeCredentials = JSON.parse(result)
      if (credentials.claudeAiOauth) {
        return {
          accessToken: credentials.claudeAiOauth.accessToken,
          refreshToken: credentials.claudeAiOauth.refreshToken,
          expiresAt: credentials.claudeAiOauth.expiresAt,
          scopes: credentials.claudeAiOauth.scopes,
          source: "linux_pass",
        }
      }
    }
  } catch {
    // pass not available or entry not found
  }

  return null
}

/**
 * Read Claude OAuth credentials from credentials file (Linux/fallback)
 */
function readFromCredentialsFile(
  credentialsDirectory: string,
): ClaudeOAuthCredential | null {
  const credentialsPath = join(credentialsDirectory, ".credentials.json")

  try {
    if (existsSync(credentialsPath)) {
      const content = readFileSync(credentialsPath, "utf-8")
      const credentials: ClaudeCredentials = JSON.parse(content)
      if (credentials.claudeAiOauth) {
        return {
          accessToken: credentials.claudeAiOauth.accessToken,
          refreshToken: credentials.claudeAiOauth.refreshToken,
          expiresAt: credentials.claudeAiOauth.expiresAt,
          scopes: credentials.claudeAiOauth.scopes,
          source: "credentials_file",
        }
      }
    }
  } catch {
    // File not found or parse error
  }
  return null
}

/**
 * Resolve the same Claude configuration directory passed to the CLI runtime.
 * An explicitly selected directory is an isolation boundary: file discovery
 * must not fall back to the default directory when the selected directory is
 * missing or does not contain credentials.
 */
export function getClaudeCredentialConfigDir(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
): string {
  const configuredDirectory = environment.CLAUDE_CONFIG_DIR
  return configuredDirectory?.trim()
    ? configuredDirectory
    : join(homeDirectory, ".claude")
}

/**
 * Get existing Claude OAuth credentials from keychain or credentials file
 */
export function getExistingClaudeCredentials(): ClaudeOAuthCredential | null {
  const credentialsDirectory = getClaudeCredentialConfigDir()

  // Try keychain first (macOS, Windows, Linux)
  const keychainCreds = normalizeClaudeOAuthCredential(
    readFromKeychain(credentialsDirectory),
  )
  if (keychainCreds) {
    return keychainCreds
  }

  // Fall back to the file inside the runtime-selected configuration directory.
  return normalizeClaudeOAuthCredential(
    readFromCredentialsFile(credentialsDirectory),
  )
}

/**
 * Refresh Claude OAuth token using refresh token
 * Uses the same first-party Claude Code OAuth client as the local login flow.
 */
export async function refreshClaudeToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken?: string
  expiresAt?: number
}> {
  const normalizedRefreshToken = normalizeHeaderSafeCredential(refreshToken)
  if (!normalizedRefreshToken) {
    throw new Error(
      "Failed to refresh Claude token: invalid refresh credential.",
    )
  }

  let response: Response
  try {
    response = await fetch(CLAUDE_CODE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: normalizedRefreshToken,
        client_id: CLAUDE_CODE_OAUTH_CLIENT_ID,
      }),
    })
  } catch {
    throw new Error("Failed to refresh Claude token.")
  }

  if (!response.ok) {
    throw new Error(`Failed to refresh Claude token (HTTP ${response.status}).`)
  }

  let data: ClaudeCodeTokenResponse
  try {
    data = (await response.json()) as ClaudeCodeTokenResponse
  } catch {
    throw new Error("Failed to refresh Claude token: invalid response.")
  }
  const accessToken = normalizeHeaderSafeCredential(data.access_token)
  const replacementRefreshToken =
    data.refresh_token === undefined
      ? normalizedRefreshToken
      : normalizeHeaderSafeCredential(data.refresh_token)
  if (!accessToken || !replacementRefreshToken) {
    throw new Error(
      "Failed to refresh Claude token: invalid credential response.",
    )
  }

  return {
    accessToken,
    refreshToken: replacementRefreshToken,
    expiresAt: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
  }
}

/**
 * Check if a token is expired or will expire soon (within 5 minutes)
 */
export function isTokenExpired(expiresAt?: number): boolean {
  if (!expiresAt) {
    // If no expiry, assume token is still valid
    return false
  }
  // Consider expired if less than 5 minutes remaining
  const bufferMs = 5 * 60 * 1000
  return Date.now() + bufferMs >= expiresAt
}

/**
 * Build extended PATH with common installation locations
 * This is necessary because when running from Finder/Dock (macOS) or
 * Start Menu (Windows), the PATH may not include directories where
 * claude CLI is installed
 *
 * Delegates to platform provider for cross-platform support.
 */
function getExtendedPath(): string {
  return buildExtendedPath(process.env.PATH)
}

/**
 * Check if Claude CLI is installed (cross-platform)
 * Uses extended PATH to find claude even when running from Finder/Dock
 */
export function isClaudeCliInstalled(): boolean {
  try {
    // Use 'where' on Windows, 'which' on Unix-like systems
    const command = isWindows() ? "where claude" : "which claude"
    const fullPath = getExtendedPath()

    execSync(command, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PATH: fullPath },
    })
    return true
  } catch {
    return false
  }
}

/**
 * Run `claude setup-token` to authenticate with Claude
 * Returns a promise that resolves when the process completes
 *
 * Note: Uses pipe for stdio instead of inherit to prevent hanging in non-TTY
 * environments (like Electron apps launched from Finder/Dock)
 */
export function runClaudeSetupToken(
  onStatus: (message: string) => void,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    onStatus("Starting Claude setup-token...")

    const claudeBinaryPath = getBundledClaudeBinaryPath()
    const child = spawn(claudeBinaryPath, ["setup-token"], {
      // Don't use 'inherit' - it causes hang in non-TTY environments
      // Use 'ignore' for stdin and 'pipe' for stdout/stderr
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    })

    // Drain both pipes without forwarding their content. setup-token output is
    // credential-bound and may contain a token split across callbacks before
    // Locus can discover and register it as an exact-redaction hint.
    child.stdout?.on("data", () => {})
    child.stderr?.on("data", () => {})

    // Timeout after 2 minutes to prevent indefinite hang
    const timeout = setTimeout(() => {
      child.kill()
      resolve({
        success: false,
        error: "Authentication timed out after 2 minutes. Please try again.",
      })
    }, 120000)

    child.on("error", () => {
      clearTimeout(timeout)
      resolve({
        success: false,
        error: "Failed to start claude setup-token.",
      })
    })

    child.on("close", (code) => {
      clearTimeout(timeout)

      if (code === 0) {
        // Wait a moment for the token to be written to keychain
        setTimeout(() => {
          if (getExistingClaudeCredentials()?.accessToken) {
            resolve({ success: true })
          } else {
            resolve({
              success: false,
              error:
                "Token not found after setup. The authentication may have failed.",
            })
          }
        }, 500)
      } else {
        resolve({
          success: false,
          error:
            typeof code === "number"
              ? `Claude setup-token exited with code ${code}.`
              : "Claude setup-token was terminated.",
        })
      }
    })
  })
}
