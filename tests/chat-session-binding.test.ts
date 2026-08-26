import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { createCodexAppServerSmokeBindingTuple } from "../scripts/lib/codex-app-server-smoke-binding"
import {
  admitClaudeChatSessionBindingRun,
  admitCodexChatSessionBindingRun,
  attachBindingsToSubChats,
  backfillSubChatBindings,
  type ChatSessionBindingDatabase,
  copySubChatBinding,
  getSubChatBinding,
  seedSubChatBinding,
  updateSubChatBinding,
} from "../src/main/lib/chat-session-binding"
import {
  clearClaudeActiveSessionsForTest,
  setActiveClaudeSession,
} from "../src/main/lib/claude/active-sessions"
import {
  clearActiveCodexStreamsForTest,
  getActiveCodexStream,
  setActiveCodexStream,
} from "../src/main/lib/codex/active-streams"
import * as schema from "../src/main/lib/db/schema"
import {
  agentProviderProfiles,
  chats,
  projects,
  subChatBindings,
  subChats,
} from "../src/main/lib/db/schema"
import {
  createProviderProfileChatSessionBindingWrite,
  normalizeChatSessionBindingProviderProfile,
  normalizeChatSessionBindingWrite,
} from "../src/shared/chat-session-binding"

const bindingWriteDependencies = {
  getProviderProfileMetadata(
    db: ChatSessionBindingDatabase,
    profileId: string,
  ) {
    const row = db
      .select({
        id: agentProviderProfiles.id,
        targetRuntimesJson: agentProviderProfiles.targetRuntimesJson,
        defaultModel: agentProviderProfiles.defaultModel,
      })
      .from(agentProviderProfiles)
      .where(eq(agentProviderProfiles.id, profileId))
      .get()
    return row
      ? {
          id: row.id,
          targetRuntimes: JSON.parse(row.targetRuntimesJson) as string[],
          defaultModel: row.defaultModel,
        }
      : null
  },
}

const claudeRunAdmissionDependencies = {
  getProviderProfileRuntimeMetadata:
    bindingWriteDependencies.getProviderProfileMetadata,
}

type BindingTestDatabase = ReturnType<typeof drizzle<typeof schema>>

function createTestDatabase(): {
  sqlite: Database
  db: BindingTestDatabase
  ownerDb: ChatSessionBindingDatabase
} {
  const sqlite = new Database(":memory:")
  sqlite.exec("PRAGMA foreign_keys = ON")
  const db = drizzle(sqlite, { schema })
  migrate(db, {
    migrationsFolder: join(import.meta.dir, "../drizzle"),
  })
  db.insert(projects)
    .values({ id: "project-1", name: "Project", path: "/tmp/project-1" })
    .run()
  db.insert(chats).values({ id: "workspace-1", projectId: "project-1" }).run()

  return {
    sqlite,
    db,
    ownerDb: db as unknown as ChatSessionBindingDatabase,
  }
}

function insertSubChat(
  db: BindingTestDatabase,
  id: string,
  messages: unknown = [],
): void {
  db.insert(subChats)
    .values({
      id,
      chatId: "workspace-1",
      messages:
        typeof messages === "string" ? messages : JSON.stringify(messages),
    })
    .run()
}

function insertProviderProfile(
  db: BindingTestDatabase,
  id: string,
  targetRuntimes: string[],
  defaultModel = "provider-model",
): void {
  db.insert(agentProviderProfiles)
    .values({
      id,
      name: id,
      protocol: "openai-responses",
      baseUrl: "https://provider.example.com/v1",
      defaultModel,
      authMode: "none",
      targetRuntimesJson: JSON.stringify(targetRuntimes),
      capabilitiesJson: "{}",
    })
    .run()
}

afterEach(() => {
  clearActiveCodexStreamsForTest()
  clearClaudeActiveSessionsForTest()
})

describe("chat session binding normalization", () => {
  test("derives provider profile identity from the model source", () => {
    expect(
      normalizeChatSessionBindingProviderProfile({
        modelSource: " provider-profile:profile-a ",
        providerProfileId: "profile-b",
      }),
    ).toEqual({
      modelSource: "provider-profile:profile-a",
      providerProfileId: "profile-a",
    })

    expect(
      normalizeChatSessionBindingProviderProfile({
        modelSource: "chatgpt",
        providerProfileId: "stale-profile",
      }),
    ).toEqual({
      modelSource: "chatgpt",
      providerProfileId: null,
    })

    expect(
      normalizeChatSessionBindingWrite({
        runtime: "codex",
        modelSource: "provider-profile:profile-a",
        thinkingLevel: "xhigh",
      }),
    ).toMatchObject({
      providerProfileId: "profile-a",
      modelSource: "provider-profile:profile-a",
      thinkingLevel: null,
    })

    expect(
      normalizeChatSessionBindingWrite({
        runtime: "codex",
        modelSource: "provider-profile:profile-a",
        thinkingLevel: "none",
      }),
    ).toMatchObject({ thinkingLevel: null })

    expect(
      normalizeChatSessionBindingWrite({
        runtime: "codex",
        modelSource: "provider-profile:profile-a",
        thinkingLevel: "untrusted-stale-value",
      }),
    ).toMatchObject({ thinkingLevel: null })
  })

  test("snapshots a Provider Profile model with honest reasoning capability", () => {
    expect(
      createProviderProfileChatSessionBindingWrite({
        runtime: "codex",
        profile: { id: "profile-a", defaultModel: "provider-model/high" },
      }),
    ).toEqual({
      runtime: "codex",
      providerProfileId: "profile-a",
      modelId: "provider-model/high",
      modelSource: "provider-profile:profile-a",
      thinkingLevel: null,
    })
  })

  test("rejects unsupported runtime-scoped values", () => {
    expect(() =>
      normalizeChatSessionBindingWrite({ runtime: "deepseek-harness" }),
    ).toThrow("Unsupported chat session binding runtime")
    expect(() =>
      normalizeChatSessionBindingWrite({
        runtime: "claude-code",
        modelSource: "chatgpt",
      }),
    ).toThrow("Unsupported claude-code chat session binding model source")
    expect(() =>
      normalizeChatSessionBindingWrite({
        runtime: "claude-code",
        thinkingLevel: "high",
      }),
    ).toThrow("cannot persist thinkingLevel")
    expect(() =>
      normalizeChatSessionBindingWrite({
        runtime: "codex",
        thinkingLevel: "maximum",
      }),
    ).toThrow("Unsupported Codex chat session binding thinking level")
  })
})

describe("chat session binding owner", () => {
  test("returns an in-memory fallback without inventing a row", () => {
    const { sqlite, db, ownerDb } = createTestDatabase()
    try {
      insertSubChat(db, "sub-missing")

      expect(getSubChatBinding(ownerDb, "sub-missing")).toEqual({
        id: null,
        subChatId: "sub-missing",
        runtime: "claude-code",
        providerProfileId: null,
        modelId: null,
        modelSource: null,
        thinkingLevel: null,
        createdAt: null,
        updatedAt: null,
      })
      expect(db.select().from(subChatBindings).all()).toHaveLength(0)
    } finally {
      sqlite.close()
    }
  })

  test("seeds, normalizes, and updates one binding row", () => {
    const { sqlite, db, ownerDb } = createTestDatabase()
    try {
      insertSubChat(db, "sub-update")
      insertProviderProfile(db, "profile-a", ["codex"], "gpt-5.5")

      const seeded = seedSubChatBinding(
        ownerDb,
        "sub-update",
        {
          runtime: "codex",
          providerProfileId: "wrong-profile",
          modelId: " gpt-5.5 ",
          modelSource: "provider-profile:profile-a",
          thinkingLevel: "high",
        },
        bindingWriteDependencies,
      )
      expect(seeded).toMatchObject({
        subChatId: "sub-update",
        runtime: "codex",
        providerProfileId: "profile-a",
        modelId: "gpt-5.5",
        modelSource: "provider-profile:profile-a",
        thinkingLevel: null,
      })

      const duplicateSeed = seedSubChatBinding(
        ownerDb,
        "sub-update",
        { runtime: "claude-code" },
        bindingWriteDependencies,
      )
      expect(duplicateSeed.id).toBe(seeded.id)
      expect(duplicateSeed.runtime).toBe("codex")
      expect(db.select().from(subChatBindings).all()).toHaveLength(1)

      const updated = updateSubChatBinding(
        ownerDb,
        "sub-update",
        {
          modelSource: "chatgpt",
          providerProfileId: "stale-profile",
          modelId: "gpt-5.5",
          thinkingLevel: "high",
        },
        bindingWriteDependencies,
      )
      expect(updated).toMatchObject({
        providerProfileId: null,
        modelSource: "chatgpt",
      })

      expect(() =>
        updateSubChatBinding(
          ownerDb,
          "sub-update",
          { runtime: "deepseek-harness" } as never,
          bindingWriteDependencies,
        ),
      ).toThrow("Unsupported chat session binding runtime")
      expect(getSubChatBinding(ownerDb, "sub-update").runtime).toBe("codex")
    } finally {
      sqlite.close()
    }
  })

  test("rejects every Codex-owned binding mutation while its Run is active", () => {
    const { sqlite, db, ownerDb } = createTestDatabase()
    try {
      insertSubChat(db, "sub-active-codex")
      seedSubChatBinding(
        ownerDb,
        "sub-active-codex",
        {
          runtime: "codex",
          modelId: "gpt-5.5",
          modelSource: "chatgpt",
          thinkingLevel: "high",
        },
        bindingWriteDependencies,
      )
      const replacedOwner = {
        runId: "run-shared",
        controller: new AbortController(),
        cancelRequested: false,
      }
      const activeOwner = {
        runId: "run-shared",
        controller: new AbortController(),
        cancelRequested: false,
      }
      setActiveCodexStream("sub-active-codex", replacedOwner)
      setActiveCodexStream("sub-active-codex", activeOwner)
      expect(getActiveCodexStream("sub-active-codex")).toBe(activeOwner)

      for (const patch of [
        { modelId: "gpt-5.6", thinkingLevel: "xhigh" },
        { runtime: "claude-code" as const },
      ]) {
        expect(() =>
          updateSubChatBinding(
            ownerDb,
            "sub-active-codex",
            patch,
            bindingWriteDependencies,
          ),
        ).toThrow("while a Codex Run is active")
      }
      expect(getSubChatBinding(ownerDb, "sub-active-codex")).toMatchObject({
        runtime: "codex",
        modelId: "gpt-5.5",
        thinkingLevel: "high",
      })
      expect(getActiveCodexStream("sub-active-codex")).toBe(activeOwner)
      expect(activeOwner.controller.signal.aborted).toBe(false)
    } finally {
      sqlite.close()
    }
  })

  test("rejects every Claude-owned binding mutation while its Run is active", () => {
    const { sqlite, db, ownerDb } = createTestDatabase()
    try {
      insertSubChat(db, "sub-active-claude")
      seedSubChatBinding(
        ownerDb,
        "sub-active-claude",
        {
          runtime: "claude-code",
          modelId: "fable",
          modelSource: "claude-oauth",
        },
        bindingWriteDependencies,
      )
      setActiveClaudeSession("sub-active-claude", {
        runId: "run-active-claude",
        controller: new AbortController(),
      })

      for (const patch of [
        { modelId: "opus" },
        { runtime: "codex" as const },
      ]) {
        expect(() =>
          updateSubChatBinding(
            ownerDb,
            "sub-active-claude",
            patch,
            bindingWriteDependencies,
          ),
        ).toThrow("while a Claude Run is active")
      }
      expect(getSubChatBinding(ownerDb, "sub-active-claude")).toMatchObject({
        runtime: "claude-code",
        modelId: "fable",
        modelSource: "claude-oauth",
      })
    } finally {
      sqlite.close()
    }
  })

  test("admits new Provider Profile bindings only with an existing runtime target and explicit model snapshot", () => {
    const { sqlite, db, ownerDb } = createTestDatabase()
    try {
      insertSubChat(db, "sub-profile-admission")
      insertProviderProfile(db, "claude-only", ["claude"])
      insertProviderProfile(db, "codex-valid", ["codex"], "org/high")

      expect(() =>
        seedSubChatBinding(
          ownerDb,
          "sub-profile-admission",
          {
            runtime: "codex",
            modelSource: "provider-profile:missing-profile",
            modelId: "provider-model",
          },
          bindingWriteDependencies,
        ),
      ).toThrow("was not found")
      expect(() =>
        seedSubChatBinding(
          ownerDb,
          "sub-profile-admission",
          {
            runtime: "codex",
            modelSource: "provider-profile:claude-only",
            modelId: "provider-model",
          },
          bindingWriteDependencies,
        ),
      ).toThrow("does not support codex")
      expect(() =>
        seedSubChatBinding(
          ownerDb,
          "sub-profile-admission",
          {
            runtime: "codex",
            modelSource: "provider-profile:codex-valid",
            modelId: null,
          },
          bindingWriteDependencies,
        ),
      ).toThrow("requires a snapshotted modelId")
      expect(() =>
        seedSubChatBinding(
          ownerDb,
          "sub-profile-admission",
          {
            runtime: "codex",
            modelSource: "provider-profile:codex-valid",
            modelId: "stale-profile-default",
          },
          bindingWriteDependencies,
        ),
      ).toThrow("requires its current default model snapshot")
      expect(db.select().from(subChatBindings).all()).toHaveLength(0)

      expect(
        seedSubChatBinding(
          ownerDb,
          "sub-profile-admission",
          {
            runtime: "codex",
            modelSource: "provider-profile:codex-valid",
            modelId: "org/high",
            thinkingLevel: "xhigh",
          },
          bindingWriteDependencies,
        ),
      ).toMatchObject({
        providerProfileId: "codex-valid",
        modelId: "org/high",
        thinkingLevel: null,
      })
    } finally {
      sqlite.close()
    }
  })

  test("requires an explicit model when an update enters a Provider Profile", () => {
    const { sqlite, db, ownerDb } = createTestDatabase()
    try {
      insertSubChat(db, "sub-enter-profile")
      insertProviderProfile(db, "codex-profile", ["codex"], "org/high")
      insertProviderProfile(db, "claude-profile", ["claude"])
      seedSubChatBinding(
        ownerDb,
        "sub-enter-profile",
        {
          runtime: "codex",
          modelId: "gpt-5.5",
          modelSource: "chatgpt",
          thinkingLevel: "high",
        },
        bindingWriteDependencies,
      )

      expect(() =>
        updateSubChatBinding(
          ownerDb,
          "sub-enter-profile",
          { modelSource: "provider-profile:codex-profile" },
          bindingWriteDependencies,
        ),
      ).toThrow("requires an explicit snapshotted modelId")
      expect(getSubChatBinding(ownerDb, "sub-enter-profile")).toMatchObject({
        modelSource: "chatgpt",
        modelId: "gpt-5.5",
      })

      expect(() =>
        updateSubChatBinding(
          ownerDb,
          "sub-enter-profile",
          {
            modelSource: "provider-profile:missing-profile",
            modelId: "provider-model",
          },
          bindingWriteDependencies,
        ),
      ).toThrow("was not found")
      expect(() =>
        updateSubChatBinding(
          ownerDb,
          "sub-enter-profile",
          {
            modelSource: "provider-profile:claude-profile",
            modelId: "provider-model",
          },
          bindingWriteDependencies,
        ),
      ).toThrow("does not support codex")
      expect(() =>
        updateSubChatBinding(
          ownerDb,
          "sub-enter-profile",
          {
            modelSource: "provider-profile:codex-profile",
            modelId: "stale-profile-default",
          },
          bindingWriteDependencies,
        ),
      ).toThrow("requires its current default model snapshot")

      expect(
        updateSubChatBinding(
          ownerDb,
          "sub-enter-profile",
          {
            modelSource: "provider-profile:codex-profile",
            modelId: "org/high",
          },
          bindingWriteDependencies,
        ),
      ).toMatchObject({
        providerProfileId: "codex-profile",
        modelSource: "provider-profile:codex-profile",
        modelId: "org/high",
        thinkingLevel: null,
      })

      expect(() =>
        updateSubChatBinding(
          ownerDb,
          "sub-enter-profile",
          { modelId: "arbitrary-profile-model" },
          bindingWriteDependencies,
        ),
      ).toThrow("requires its current default model snapshot")
      db.update(agentProviderProfiles)
        .set({ defaultModel: "new-profile-default" })
        .where(eq(agentProviderProfiles.id, "codex-profile"))
        .run()
      expect(
        updateSubChatBinding(
          ownerDb,
          "sub-enter-profile",
          { modelId: "new-profile-default" },
          bindingWriteDependencies,
        ),
      ).toMatchObject({
        modelSource: "provider-profile:codex-profile",
        modelId: "new-profile-default",
        thinkingLevel: null,
      })
    } finally {
      sqlite.close()
    }
  })

  test("requires a complete first-party tuple when leaving a Provider Profile", () => {
    const { sqlite, db, ownerDb } = createTestDatabase()
    try {
      insertSubChat(db, "sub-leave-codex-profile")
      insertSubChat(db, "sub-leave-claude-profile")
      insertProviderProfile(
        db,
        "codex-profile",
        ["codex"],
        "provider-codex-model",
      )
      insertProviderProfile(
        db,
        "claude-profile",
        ["claude"],
        "provider-claude-model",
      )
      seedSubChatBinding(
        ownerDb,
        "sub-leave-codex-profile",
        {
          runtime: "codex",
          modelSource: "provider-profile:codex-profile",
          modelId: "provider-codex-model",
        },
        bindingWriteDependencies,
      )
      seedSubChatBinding(
        ownerDb,
        "sub-leave-claude-profile",
        {
          runtime: "claude-code",
          modelSource: "provider-profile:claude-profile",
          modelId: "provider-claude-model",
        },
        bindingWriteDependencies,
      )

      expect(() =>
        updateSubChatBinding(
          ownerDb,
          "sub-leave-codex-profile",
          { modelSource: null },
          bindingWriteDependencies,
        ),
      ).toThrow("requires an explicit first-party modelSource")
      expect(() =>
        updateSubChatBinding(
          ownerDb,
          "sub-leave-claude-profile",
          { modelSource: null },
          bindingWriteDependencies,
        ),
      ).toThrow("requires an explicit first-party modelSource")
      expect(
        getSubChatBinding(ownerDb, "sub-leave-codex-profile"),
      ).toMatchObject({
        providerProfileId: "codex-profile",
        modelSource: "provider-profile:codex-profile",
        modelId: "provider-codex-model",
        thinkingLevel: null,
      })
      expect(() =>
        updateSubChatBinding(
          ownerDb,
          "sub-leave-codex-profile",
          { modelSource: "chatgpt" },
          bindingWriteDependencies,
        ),
      ).toThrow("requires an explicit modelId")
      expect(() =>
        updateSubChatBinding(
          ownerDb,
          "sub-leave-codex-profile",
          { modelSource: "chatgpt", modelId: "gpt-5.5" },
          bindingWriteDependencies,
        ),
      ).toThrow("requires an explicit thinkingLevel")
      expect(
        updateSubChatBinding(
          ownerDb,
          "sub-leave-codex-profile",
          {
            modelSource: "chatgpt",
            modelId: "gpt-5.5",
            thinkingLevel: "xhigh",
          },
          bindingWriteDependencies,
        ),
      ).toMatchObject({
        providerProfileId: null,
        modelSource: "chatgpt",
        modelId: "gpt-5.5",
        thinkingLevel: "xhigh",
      })

      expect(() =>
        updateSubChatBinding(
          ownerDb,
          "sub-leave-claude-profile",
          { modelSource: "claude-oauth" },
          bindingWriteDependencies,
        ),
      ).toThrow("requires an explicit modelId")
      expect(
        updateSubChatBinding(
          ownerDb,
          "sub-leave-claude-profile",
          { modelSource: "claude-oauth", modelId: "fable" },
          bindingWriteDependencies,
        ),
      ).toMatchObject({
        providerProfileId: null,
        modelSource: "claude-oauth",
        modelId: "fable",
        thinkingLevel: null,
      })
    } finally {
      sqlite.close()
    }
  })

  test("fails stale Codex run payloads closed against the current DB binding", () => {
    const { sqlite, db, ownerDb } = createTestDatabase()
    try {
      insertSubChat(db, "sub-codex-run-admission")
      insertProviderProfile(db, "codex-run-profile", ["codex"], "vendor/none")
      seedSubChatBinding(
        ownerDb,
        "sub-codex-run-admission",
        {
          runtime: "codex",
          modelSource: "provider-profile:codex-run-profile",
          modelId: "vendor/none",
        },
        bindingWriteDependencies,
      )

      expect(
        admitCodexChatSessionBindingRun(ownerDb, "sub-codex-run-admission", {
          providerProfileId: "codex-run-profile",
          model: "vendor/none/none",
        }),
      ).toMatchObject({
        ok: true,
        providerProfileId: "codex-run-profile",
        codexAuthMethod: null,
        requestedModel: "vendor/none/none",
      })

      for (const staleRequest of [
        {
          providerProfileId: "stale-profile",
          model: "vendor/none/none",
        },
        {
          providerProfileId: "codex-run-profile",
          model: "stale-model/none",
        },
        {
          providerProfileId: "codex-run-profile",
          codexAuthMethod: "api_key" as const,
          model: "vendor/none/none",
        },
      ]) {
        expect(
          admitCodexChatSessionBindingRun(
            ownerDb,
            "sub-codex-run-admission",
            staleRequest,
          ),
        ).toMatchObject({ ok: false })
      }
    } finally {
      sqlite.close()
    }
  })

  test("keeps the bundled Codex smoke seed and route payload admission-compatible", () => {
    const { sqlite, db, ownerDb } = createTestDatabase()
    try {
      insertProviderProfile(
        db,
        "smoke-profile",
        ["codex"],
        "vendor/smoke-model",
      )

      for (const [subChatId, tuple] of [
        [
          "sub-smoke-profile",
          createCodexAppServerSmokeBindingTuple({
            authMode: "provider",
            providerProfileId: "smoke-profile",
            modelId: "vendor/smoke-model",
          }),
        ],
        [
          "sub-smoke-api-key",
          createCodexAppServerSmokeBindingTuple({
            authMode: "api_key",
            providerProfileId: null,
            modelId: "gpt-5.5",
          }),
        ],
      ] as const) {
        insertSubChat(db, subChatId)
        seedSubChatBinding(
          ownerDb,
          subChatId,
          tuple.binding,
          bindingWriteDependencies,
        )
        expect(
          admitCodexChatSessionBindingRun(ownerDb, subChatId, tuple.request),
        ).toMatchObject({ ok: true })
      }
    } finally {
      sqlite.close()
    }
  })

  test("admits only exact Claude payloads plus the run-scoped Profile divert", () => {
    const { sqlite, db, ownerDb } = createTestDatabase()
    try {
      insertSubChat(db, "sub-claude-run-admission")
      insertProviderProfile(db, "divert-profile", ["claude"])
      insertProviderProfile(db, "codex-only-divert", ["codex"])
      insertProviderProfile(db, "malformed-divert", ["claude"])
      db.update(agentProviderProfiles)
        .set({ targetRuntimesJson: "{not-json" })
        .where(eq(agentProviderProfiles.id, "malformed-divert"))
        .run()
      seedSubChatBinding(
        ownerDb,
        "sub-claude-run-admission",
        {
          runtime: "claude-code",
          modelSource: "claude-oauth",
          modelId: "fable",
        },
        bindingWriteDependencies,
      )

      expect(
        admitClaudeChatSessionBindingRun(
          ownerDb,
          "sub-claude-run-admission",
          {
            modelSource: "claude-oauth",
            requestedModel: "fable",
          },
          claudeRunAdmissionDependencies,
        ),
      ).toMatchObject({
        ok: true,
        modelSource: "claude-oauth",
        requestedModel: "fable",
        runScopedProfileDivert: false,
      })
      expect(
        admitClaudeChatSessionBindingRun(
          ownerDb,
          "sub-claude-run-admission",
          {
            modelSource: "provider-profile:divert-profile",
          },
          claudeRunAdmissionDependencies,
        ),
      ).toMatchObject({
        ok: true,
        modelSource: "provider-profile:divert-profile",
        requestedModel: null,
        runScopedProfileDivert: true,
      })

      for (const staleRequest of [
        { modelSource: "provider-profile:stale", requestedModel: "fable" },
        { modelSource: "provider-profile:missing-profile" },
        { modelSource: "provider-profile:codex-only-divert" },
        { modelSource: "provider-profile:malformed-divert" },
        { modelSource: "provider-profile:" },
        { modelSource: "claude-oauth", requestedModel: "opus" },
        { modelSource: "openai-api-key", requestedModel: "fable" },
      ]) {
        expect(
          admitClaudeChatSessionBindingRun(
            ownerDb,
            "sub-claude-run-admission",
            staleRequest,
            claudeRunAdmissionDependencies,
          ),
        ).toMatchObject({ ok: false })
      }
    } finally {
      sqlite.close()
    }
  })

  test("clears runtime-scoped fields when the runtime changes", () => {
    const { sqlite, db, ownerDb } = createTestDatabase()
    try {
      insertSubChat(db, "sub-switch")
      insertProviderProfile(db, "profile-a", ["codex"], "gpt-5.5")
      seedSubChatBinding(
        ownerDb,
        "sub-switch",
        {
          runtime: "codex",
          modelId: "gpt-5.5",
          modelSource: "provider-profile:profile-a",
          providerProfileId: "profile-a",
          thinkingLevel: "xhigh",
        },
        bindingWriteDependencies,
      )

      expect(
        updateSubChatBinding(
          ownerDb,
          "sub-switch",
          { runtime: "claude-code" },
          bindingWriteDependencies,
        ),
      ).toMatchObject({
        runtime: "claude-code",
        modelId: null,
        modelSource: null,
        providerProfileId: null,
        thinkingLevel: null,
      })
    } finally {
      sqlite.close()
    }
  })

  test("rejects runtime switches after the first persisted message", () => {
    const { sqlite, db, ownerDb } = createTestDatabase()
    try {
      insertSubChat(db, "sub-started", [
        { id: "user-1", role: "user", parts: [{ type: "text", text: "hi" }] },
      ])
      seedSubChatBinding(
        ownerDb,
        "sub-started",
        {
          runtime: "claude-code",
          modelId: "fable",
          modelSource: "claude-oauth",
        },
        bindingWriteDependencies,
      )

      expect(() =>
        updateSubChatBinding(
          ownerDb,
          "sub-started",
          { runtime: "codex" },
          bindingWriteDependencies,
        ),
      ).toThrow("only change before its first message")
      expect(getSubChatBinding(ownerDb, "sub-started")).toMatchObject({
        runtime: "claude-code",
        modelId: "fable",
        modelSource: "claude-oauth",
      })
    } finally {
      sqlite.close()
    }
  })

  test("fails closed when persisted messages cannot prove the chat is empty", () => {
    const { sqlite, db, ownerDb } = createTestDatabase()
    try {
      for (const [id, messages] of [
        ["sub-malformed-switch", "{not-json"],
        ["sub-non-array-switch", JSON.stringify({ messages: [] })],
      ] as const) {
        insertSubChat(db, id, messages)
        seedSubChatBinding(
          ownerDb,
          id,
          { runtime: "claude-code" },
          bindingWriteDependencies,
        )

        expect(() =>
          updateSubChatBinding(
            ownerDb,
            id,
            { runtime: "codex" },
            bindingWriteDependencies,
          ),
        ).toThrow("only change before its first message")
        expect(getSubChatBinding(ownerDb, id).runtime).toBe("claude-code")
      }
    } finally {
      sqlite.close()
    }
  })

  test("copies the source values into an independent fork binding", () => {
    const { sqlite, db, ownerDb } = createTestDatabase()
    try {
      insertSubChat(db, "sub-source")
      insertSubChat(db, "sub-fork")
      const source = seedSubChatBinding(
        ownerDb,
        "sub-source",
        {
          runtime: "codex",
          modelId: "gpt-5.5",
          modelSource: "openai-api-key",
          thinkingLevel: "medium",
        },
        bindingWriteDependencies,
      )

      const fork = copySubChatBinding(ownerDb, "sub-source", "sub-fork")
      expect(fork).toMatchObject({
        subChatId: "sub-fork",
        runtime: source.runtime,
        modelId: source.modelId,
        modelSource: source.modelSource,
        thinkingLevel: source.thinkingLevel,
      })
      expect(fork.id).not.toBe(source.id)

      updateSubChatBinding(
        ownerDb,
        "sub-source",
        { modelId: "gpt-5.6" },
        bindingWriteDependencies,
      )
      expect(getSubChatBinding(ownerDb, "sub-fork").modelId).toBe("gpt-5.5")
    } finally {
      sqlite.close()
    }
  })

  test("forks an exact historical Profile snapshot after the Profile is deleted", () => {
    const { sqlite, db, ownerDb } = createTestDatabase()
    try {
      insertSubChat(db, "sub-profile-source")
      insertSubChat(db, "sub-profile-fork")
      insertProviderProfile(db, "later-deleted", ["codex"], "vendor/none")
      const source = seedSubChatBinding(
        ownerDb,
        "sub-profile-source",
        {
          runtime: "codex",
          modelSource: "provider-profile:later-deleted",
          modelId: "vendor/none",
        },
        bindingWriteDependencies,
      )

      db.delete(agentProviderProfiles)
        .where(eq(agentProviderProfiles.id, "later-deleted"))
        .run()
      const fork = copySubChatBinding(
        ownerDb,
        "sub-profile-source",
        "sub-profile-fork",
      )

      expect(fork).toMatchObject({
        runtime: source.runtime,
        providerProfileId: source.providerProfileId,
        modelSource: source.modelSource,
        modelId: "vendor/none",
        thinkingLevel: null,
      })
    } finally {
      sqlite.close()
    }
  })

  test("attaches persisted bindings in input order and falls back per missing row", () => {
    const { sqlite, db, ownerDb } = createTestDatabase()
    try {
      insertSubChat(db, "sub-attached")
      insertSubChat(db, "sub-fallback")
      seedSubChatBinding(
        ownerDb,
        "sub-attached",
        { runtime: "codex" },
        bindingWriteDependencies,
      )

      expect(
        attachBindingsToSubChats(ownerDb, [
          { id: "sub-fallback", name: "Fallback" },
          { id: "sub-attached", name: "Attached" },
        ]).map((row) => ({
          id: row.id,
          name: row.name,
          bindingId: row.binding.id,
          runtime: row.binding.runtime,
        })),
      ).toEqual([
        {
          id: "sub-fallback",
          name: "Fallback",
          bindingId: null,
          runtime: "claude-code",
        },
        {
          id: "sub-attached",
          name: "Attached",
          bindingId: expect.any(String),
          runtime: "codex",
        },
      ])
    } finally {
      sqlite.close()
    }
  })

  test("bounds binding lookup batches when attaching a large chat", () => {
    const rowCount = 1_001
    const rows = Array.from({ length: rowCount }, (_, index) => ({
      id: `sub-attached-${index}`,
      name: `Attached ${index}`,
    }))
    const persistedRows = rows.map((row) => ({
      id: `binding-${row.id}`,
      subChatId: row.id,
      runtime: "codex" as const,
      providerProfileId: null,
      modelId: null,
      modelSource: null,
      thinkingLevel: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }))
    let lookupCount = 0

    const executor = {
      select: () => ({
        from: (table: unknown) => {
          if (table !== subChatBindings) {
            throw new Error("Unexpected attachment table")
          }
          return {
            where: () => {
              const start = lookupCount * 500
              lookupCount += 1
              return { all: () => persistedRows.slice(start, start + 500) }
            },
          }
        },
      }),
      insert: () => {
        throw new Error("Attachment reads must not insert")
      },
      update: () => {
        throw new Error("Attachment reads must not update")
      },
    } as unknown as ChatSessionBindingDatabase

    const attached = attachBindingsToSubChats(executor, rows)

    expect(lookupCount).toBe(3)
    expect(attached).toHaveLength(rowCount)
    expect(attached[0]?.binding.id).toBe("binding-sub-attached-0")
    expect(attached.at(-1)?.binding.id).toBe("binding-sub-attached-1000")
  })

  test("backfills legacy runtime inference once and leaves existing rows unchanged", () => {
    const { sqlite, db, ownerDb } = createTestDatabase()
    try {
      insertSubChat(db, "sub-provider", [{ metadata: { provider: "codex" } }])
      insertSubChat(db, "sub-codex-model", [
        { metadata: { model: "codex-mini-latest" } },
      ])
      insertSubChat(db, "sub-gpt-model", [{ metadata: { model: "gpt-5.5" } }])
      insertSubChat(db, "sub-default", [{ role: "user" }])
      insertSubChat(db, "sub-malformed", "{not-json")
      insertSubChat(db, "sub-existing", [
        { metadata: { provider: "claude-code" } },
      ])
      seedSubChatBinding(
        ownerDb,
        "sub-existing",
        { runtime: "codex", modelId: "keep-me" },
        bindingWriteDependencies,
      )

      expect(backfillSubChatBindings(ownerDb)).toBe(5)
      const rowsAfterFirstBackfill = db
        .select()
        .from(subChatBindings)
        .all()
        .sort((left, right) => left.subChatId.localeCompare(right.subChatId))
      expect(backfillSubChatBindings(ownerDb)).toBe(0)
      expect(
        db
          .select()
          .from(subChatBindings)
          .all()
          .sort((left, right) => left.subChatId.localeCompare(right.subChatId)),
      ).toEqual(rowsAfterFirstBackfill)
      expect(rowsAfterFirstBackfill).toHaveLength(6)

      for (const id of ["sub-provider", "sub-codex-model", "sub-gpt-model"]) {
        expect(getSubChatBinding(ownerDb, id)).toMatchObject({
          runtime: "codex",
          providerProfileId: null,
          modelId: null,
          modelSource: null,
          thinkingLevel: null,
        })
      }
      expect(getSubChatBinding(ownerDb, "sub-default").runtime).toBe(
        "claude-code",
      )
      expect(getSubChatBinding(ownerDb, "sub-malformed").runtime).toBe(
        "claude-code",
      )
      expect(getSubChatBinding(ownerDb, "sub-existing")).toMatchObject({
        runtime: "codex",
        modelId: "keep-me",
      })
    } finally {
      sqlite.close()
    }
  })

  test("reads existing binding IDs without expanding sub-chat IDs into an unbounded IN", () => {
    const rowCount = 100_001
    const chatRows = Array.from({ length: rowCount }, (_, index) => ({
      id: `sub-existing-${index}`,
      messages: "[]",
    }))
    const bindingRows = chatRows.map((row) => ({ subChatId: row.id }))
    let bindingLookupCompleted = false

    // The binding lookup intentionally exposes only all(). Any regression to
    // `.where(inArray(...allSubChatIds))` fails before it could assemble an
    // unbounded SQLite parameter list.
    const executor = {
      select: () => ({
        from: (table: unknown) => {
          if (table === subChats) {
            return { all: () => chatRows }
          }
          if (table === subChatBindings) {
            return {
              all: () => {
                bindingLookupCompleted = true
                return bindingRows
              },
            }
          }
          throw new Error("Unexpected backfill table")
        },
      }),
      insert: () => {
        throw new Error("Existing bindings must not be inserted again")
      },
      update: () => {
        throw new Error("Backfill must not update existing bindings")
      },
    } as unknown as ChatSessionBindingDatabase

    expect(backfillSubChatBindings(executor)).toBe(0)
    expect(bindingLookupCompleted).toBe(true)
  })

  test("binding rows cascade with their sub-chat", () => {
    const { sqlite, db, ownerDb } = createTestDatabase()
    try {
      insertSubChat(db, "sub-cascade")
      seedSubChatBinding(
        ownerDb,
        "sub-cascade",
        { runtime: "claude-code" },
        bindingWriteDependencies,
      )

      db.delete(subChats).where(eq(subChats.id, "sub-cascade")).run()

      expect(db.select().from(subChatBindings).all()).toHaveLength(0)
    } finally {
      sqlite.close()
    }
  })
})
