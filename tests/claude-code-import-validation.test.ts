import { Database } from "bun:sqlite"
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/bun-sqlite"
import * as schema from "../src/main/lib/db/schema"
import {
  anthropicAccounts,
  anthropicSettings,
  claudeCodeCredentials,
} from "../src/main/lib/db/schema"

const testSafeStorage = {
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
}

mock.module("electron", () => ({
  app: {
    getPath() {
      return "/tmp/locus-test-user-data"
    },
  },
  safeStorage: testSafeStorage,
}))

const {
  CLAUDE_CODE_LOCAL_CREDENTIAL_INVALID_MESSAGE,
  createClaudeCodeCredentialEnvelope,
  decryptClaudeCodeCredential,
  getValidClaudeCodeCredential,
  importLocalClaudeCodeCredential,
} = await import("../src/main/lib/claude-credentials")
const {
  encryptStringForStorage,
  setElectronSafeStorageForTest,
  setSecureStorageMacKeychainPreflightForTest,
} = await import("../src/main/lib/secure-storage")

type CredentialDb = NonNullable<
  Parameters<typeof importLocalClaudeCodeCredential>[0]["db"]
>

function createCredentialTestDb() {
  const sqlite = new Database(":memory:")
  sqlite.exec(`
    CREATE TABLE claude_code_credentials (
      id text PRIMARY KEY NOT NULL,
      oauth_token text NOT NULL,
      connected_at integer,
      user_id text
    );
    CREATE TABLE anthropic_accounts (
      id text PRIMARY KEY NOT NULL,
      email text,
      display_name text,
      oauth_token text NOT NULL,
      connected_at integer,
      last_used_at integer,
      desktop_user_id text
    );
    CREATE TABLE anthropic_settings (
      id text PRIMARY KEY NOT NULL,
      active_account_id text,
      updated_at integer
    );
  `)
  return drizzle(sqlite, { schema })
}

describe("Claude Code local credential validation", () => {
  let db: ReturnType<typeof createCredentialTestDb>

  beforeEach(() => {
    setSecureStorageMacKeychainPreflightForTest(true)
    setElectronSafeStorageForTest(testSafeStorage)
    db = createCredentialTestDb()
  })

  afterEach(() => {
    setSecureStorageMacKeychainPreflightForTest(null)
    setElectronSafeStorageForTest(null)
  })

  const credentialDb = () => db as unknown as CredentialDb

  test("uses generic reconnect guidance for stale Claude Code credentials", () => {
    expect(CLAUDE_CODE_LOCAL_CREDENTIAL_INVALID_MESSAGE).toContain(
      "Sign in with Claude Code again",
    )
    expect(CLAUDE_CODE_LOCAL_CREDENTIAL_INVALID_MESSAGE).not.toContain(
      "instead of importing local credentials",
    )
  })

  test("rejects revoked local credentials before storing them", async () => {
    await expect(
      importLocalClaudeCodeCredential({
        db: credentialDb(),
        credential: {
          accessToken: "old-access-token",
          refreshToken: "bad-refresh-token",
          expiresAt: Date.now() + 60_000,
          source: "macos_keychain",
        },
        refreshClaudeTokenFn: async () => {
          throw new Error('{"error":"invalid_grant"}')
        },
      }),
    ).rejects.toThrow(CLAUDE_CODE_LOCAL_CREDENTIAL_INVALID_MESSAGE)

    expect(db.select().from(anthropicAccounts).all()).toEqual([])
    expect(db.select().from(claudeCodeCredentials).all()).toEqual([])
  })

  test("stores refreshed credentials after local credential validation succeeds", async () => {
    await importLocalClaudeCodeCredential({
      db: credentialDb(),
      credential: {
        accessToken: "old-access-token",
        refreshToken: "refresh-token",
        expiresAt: Date.now() + 60_000,
        source: "macos_keychain",
      },
      refreshClaudeTokenFn: async () => ({
        accessToken: "validated-access-token",
        refreshToken: "validated-refresh-token",
        expiresAt: Date.now() + 3_600_000,
      }),
    })

    const account = db.select().from(anthropicAccounts).get()
    expect(account?.id).toBeTruthy()
    expect(db.select().from(anthropicSettings).get()?.activeAccountId).toBe(
      account?.id,
    )
    const stored = decryptClaudeCodeCredential(account?.oauthToken ?? "")
    expect(stored?.envelope.accessToken).toBe("validated-access-token")
    expect(stored?.envelope.refreshToken).toBe("validated-refresh-token")
    expect(db.select().from(claudeCodeCredentials).all()).toEqual([])
  })

  test("rejects expired local credentials that cannot refresh", async () => {
    await expect(
      importLocalClaudeCodeCredential({
        db: credentialDb(),
        credential: {
          accessToken: "expired-access-token",
          expiresAt: Date.now() - 60_000,
          source: "macos_keychain",
        },
      }),
    ).rejects.toThrow(CLAUDE_CODE_LOCAL_CREDENTIAL_INVALID_MESSAGE)

    expect(db.select().from(anthropicAccounts).all()).toEqual([])
    expect(db.select().from(claudeCodeCredentials).all()).toEqual([])
  })

  test("reports policy-invalid persisted credentials as disconnected and unusable", async () => {
    const encrypted = encryptStringForStorage(
      JSON.stringify({
        version: 1,
        kind: "claude_code_oauth",
        accessToken: "short",
        source: "manual",
        importedAt: "2026-08-26T00:00:00.000Z",
        updatedAt: "2026-08-26T00:00:00.000Z",
      }),
    )
    db.insert(anthropicAccounts)
      .values({
        id: "invalid-account",
        displayName: "Invalid persisted credential",
        oauthToken: encrypted,
      })
      .run()
    db.insert(anthropicSettings)
      .values({ id: "singleton", activeAccountId: "invalid-account" })
      .run()

    const result = await getValidClaudeCodeCredential({ db: credentialDb() })

    expect(result.accessToken).toBeNull()
    expect(result.metadata).toMatchObject({
      accountId: "invalid-account",
      isConnected: false,
      credentialUsable: false,
      refreshable: false,
    })
  })

  test("clears an active Locus credential when runtime refresh is revoked", async () => {
    const envelope = createClaudeCodeCredentialEnvelope(
      {
        accessToken: "expired-access-token",
        refreshToken: "bad-refresh-token",
        expiresAt: Date.now() - 60_000,
      },
      "macos_keychain",
    )
    const encrypted = encryptStringForStorage(JSON.stringify(envelope))

    db.insert(anthropicAccounts)
      .values({
        id: "account-1",
        displayName: "Local Claude Code",
        oauthToken: encrypted,
        connectedAt: new Date("2026-06-01T00:00:00.000Z"),
      })
      .run()
    db.insert(anthropicSettings)
      .values({ id: "singleton", activeAccountId: "account-1" })
      .run()
    db.insert(claudeCodeCredentials)
      .values({ id: "default", oauthToken: encrypted })
      .run()

    await expect(
      getValidClaudeCodeCredential({
        db: credentialDb(),
        refreshClaudeTokenFn: async () => {
          throw new Error('{"error":"invalid_grant"}')
        },
      }),
    ).rejects.toThrow(CLAUDE_CODE_LOCAL_CREDENTIAL_INVALID_MESSAGE)

    expect(db.select().from(anthropicAccounts).all()).toEqual([])
    expect(db.select().from(claudeCodeCredentials).all()).toEqual([])
    expect(
      db
        .select()
        .from(anthropicSettings)
        .where(eq(anthropicSettings.id, "singleton"))
        .get()?.activeAccountId,
    ).toBeNull()
  })

  test("does not delete an account on invalid_grant if another refresh already updated it", async () => {
    const oldEnvelope = createClaudeCodeCredentialEnvelope(
      {
        accessToken: "expired-access-token",
        refreshToken: "old-refresh-token",
        expiresAt: Date.now() - 60_000,
      },
      "macos_keychain",
    )
    const updatedEnvelope = createClaudeCodeCredentialEnvelope(
      {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresAt: Date.now() + 3_600_000,
      },
      "macos_keychain",
      oldEnvelope,
    )
    const oldEncrypted = encryptStringForStorage(JSON.stringify(oldEnvelope))
    const updatedEncrypted = encryptStringForStorage(
      JSON.stringify(updatedEnvelope),
    )

    db.insert(anthropicAccounts)
      .values({
        id: "account-1",
        displayName: "Local Claude Code",
        oauthToken: oldEncrypted,
        connectedAt: new Date("2026-06-01T00:00:00.000Z"),
      })
      .run()
    db.insert(anthropicSettings)
      .values({ id: "singleton", activeAccountId: "account-1" })
      .run()

    await expect(
      getValidClaudeCodeCredential({
        db: credentialDb(),
        refreshClaudeTokenFn: async () => {
          db.update(anthropicAccounts)
            .set({ oauthToken: updatedEncrypted })
            .where(eq(anthropicAccounts.id, "account-1"))
            .run()
          throw new Error('{"error":"invalid_grant"}')
        },
      }),
    ).rejects.toThrow(CLAUDE_CODE_LOCAL_CREDENTIAL_INVALID_MESSAGE)

    const account = db
      .select()
      .from(anthropicAccounts)
      .where(eq(anthropicAccounts.id, "account-1"))
      .get()
    const stored = decryptClaudeCodeCredential(account?.oauthToken ?? "")
    expect(stored?.envelope.accessToken).toBe("new-access-token")
    expect(db.select().from(anthropicSettings).get()?.activeAccountId).toBe(
      "account-1",
    )
  })

  test("refreshes active canonical credentials without writing legacy storage", async () => {
    const envelope = createClaudeCodeCredentialEnvelope(
      {
        accessToken: "expired-access-token",
        refreshToken: "refresh-token",
        expiresAt: Date.now() - 60_000,
      },
      "macos_keychain",
    )
    const encrypted = encryptStringForStorage(JSON.stringify(envelope))

    db.insert(anthropicAccounts)
      .values({
        id: "account-1",
        displayName: "Local Claude Code",
        oauthToken: encrypted,
        connectedAt: new Date("2026-06-01T00:00:00.000Z"),
      })
      .run()
    db.insert(anthropicSettings)
      .values({ id: "singleton", activeAccountId: "account-1" })
      .run()

    const result = await getValidClaudeCodeCredential({
      db: credentialDb(),
      refreshClaudeTokenFn: async () => ({
        accessToken: "fresh-access-token",
        refreshToken: "fresh-refresh-token",
        expiresAt: Date.now() + 3_600_000,
      }),
    })
    const account = db
      .select()
      .from(anthropicAccounts)
      .where(eq(anthropicAccounts.id, "account-1"))
      .get()
    const stored = decryptClaudeCodeCredential(account?.oauthToken ?? "")

    expect(result.accessToken).toBe("fresh-access-token")
    expect(stored?.envelope.accessToken).toBe("fresh-access-token")
    expect(stored?.envelope.refreshToken).toBe("fresh-refresh-token")
    expect(db.select().from(claudeCodeCredentials).all()).toEqual([])
  })

  test("upserts refreshed credentials if the active account was concurrently removed", async () => {
    const envelope = createClaudeCodeCredentialEnvelope(
      {
        accessToken: "expired-access-token",
        refreshToken: "refresh-token",
        expiresAt: Date.now() - 60_000,
      },
      "macos_keychain",
    )
    const encrypted = encryptStringForStorage(JSON.stringify(envelope))

    db.insert(anthropicAccounts)
      .values({
        id: "account-1",
        email: "user@example.com",
        displayName: "Local Claude Code",
        oauthToken: encrypted,
        connectedAt: new Date("2026-06-01T00:00:00.000Z"),
        desktopUserId: "desktop-user-1",
      })
      .run()
    db.insert(anthropicSettings)
      .values({ id: "singleton", activeAccountId: "account-1" })
      .run()

    const result = await getValidClaudeCodeCredential({
      db: credentialDb(),
      refreshClaudeTokenFn: async () => {
        db.delete(anthropicAccounts)
          .where(eq(anthropicAccounts.id, "account-1"))
          .run()
        db.update(anthropicSettings)
          .set({ activeAccountId: null })
          .where(eq(anthropicSettings.id, "singleton"))
          .run()
        return {
          accessToken: "fresh-access-token",
          refreshToken: "fresh-refresh-token",
          expiresAt: Date.now() + 3_600_000,
        }
      },
    })

    const account = db
      .select()
      .from(anthropicAccounts)
      .where(eq(anthropicAccounts.id, "account-1"))
      .get()
    const stored = decryptClaudeCodeCredential(account?.oauthToken ?? "")

    expect(result.accessToken).toBe("fresh-access-token")
    expect(account?.email).toBe("user@example.com")
    expect(account?.displayName).toBe("Local Claude Code")
    expect(account?.desktopUserId).toBe("desktop-user-1")
    expect(stored?.envelope.accessToken).toBe("fresh-access-token")
    expect(stored?.envelope.refreshToken).toBe("fresh-refresh-token")
    expect(db.select().from(anthropicSettings).get()?.activeAccountId).toBe(
      "account-1",
    )
  })

  test("coalesces concurrent refreshes for the active credential", async () => {
    const envelope = createClaudeCodeCredentialEnvelope(
      {
        accessToken: "expired-access-token",
        refreshToken: "refresh-token",
        expiresAt: Date.now() - 60_000,
      },
      "macos_keychain",
    )
    const encrypted = encryptStringForStorage(JSON.stringify(envelope))

    db.insert(anthropicAccounts)
      .values({
        id: "account-1",
        displayName: "Local Claude Code",
        oauthToken: encrypted,
        connectedAt: new Date("2026-06-01T00:00:00.000Z"),
      })
      .run()
    db.insert(anthropicSettings)
      .values({ id: "singleton", activeAccountId: "account-1" })
      .run()

    let refreshCalls = 0
    const results = await Promise.all([
      getValidClaudeCodeCredential({
        db: credentialDb(),
        refreshClaudeTokenFn: async () => {
          refreshCalls += 1
          await Promise.resolve()
          return {
            accessToken: "fresh-access-token",
            refreshToken: "fresh-refresh-token",
            expiresAt: Date.now() + 3_600_000,
          }
        },
      }),
      getValidClaudeCodeCredential({
        db: credentialDb(),
        refreshClaudeTokenFn: async () => {
          refreshCalls += 1
          return {
            accessToken: "unexpected-second-token",
            refreshToken: "unexpected-second-refresh-token",
            expiresAt: Date.now() + 3_600_000,
          }
        },
      }),
    ])

    expect(refreshCalls).toBe(1)
    expect(results.map((result) => result.accessToken)).toEqual([
      "fresh-access-token",
      "fresh-access-token",
    ])

    const account = db
      .select()
      .from(anthropicAccounts)
      .where(eq(anthropicAccounts.id, "account-1"))
      .get()
    const stored = decryptClaudeCodeCredential(account?.oauthToken ?? "")
    expect(stored?.envelope.refreshToken).toBe("fresh-refresh-token")

    const expiredAgainEnvelope = createClaudeCodeCredentialEnvelope(
      {
        accessToken: "expired-again-access-token",
        refreshToken: "refresh-token",
        expiresAt: Date.now() - 60_000,
      },
      "macos_keychain",
      stored?.envelope,
    )
    db.update(anthropicAccounts)
      .set({
        oauthToken: encryptStringForStorage(
          JSON.stringify(expiredAgainEnvelope),
        ),
      })
      .where(eq(anthropicAccounts.id, "account-1"))
      .run()

    const refreshedAgain = await getValidClaudeCodeCredential({
      db: credentialDb(),
      refreshClaudeTokenFn: async () => {
        refreshCalls += 1
        return {
          accessToken: "second-fresh-access-token",
          refreshToken: "second-fresh-refresh-token",
          expiresAt: Date.now() + 3_600_000,
        }
      },
    })

    expect(refreshedAgain.accessToken).toBe("second-fresh-access-token")
    expect(refreshCalls).toBe(2)
  })
})
