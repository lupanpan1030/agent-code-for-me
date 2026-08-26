import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolveDesktopPermissionPolicy } from "../src/main/lib/agent-runtime/permission-policy"
import type { DesktopRunPreflightResult } from "../src/main/lib/agent-runtime/preflight"
import { claudeChatInputSchema } from "../src/main/lib/claude/chat-input-schema"
import { createClaudeDesktopRunRequestFromRuntimeStartup } from "../src/main/lib/claude/desktop-run-request"
import { codexChatInputSchema } from "../src/main/lib/codex/chat-input-schema"

const claudeInput = {
  subChatId: "sub-chat-a",
  chatId: "chat-a",
  runId: "run-a",
  prompt: "hello",
}

const codexInput = {
  subChatId: "sub-chat-a",
  chatId: "chat-a",
  runId: "run-a",
  prompt: "hello",
}

describe("desktop native session provenance", () => {
  test("rejects renderer-supplied foreign or stale native session ids", () => {
    for (const sessionId of ["foreign-session", "stale-session"]) {
      expect(
        claudeChatInputSchema.safeParse({ ...claudeInput, sessionId }).success,
      ).toBe(false)
      expect(
        codexChatInputSchema.safeParse({ ...codexInput, sessionId }).success,
      ).toBe(false)
    }
  })

  test("builds Claude resume and parent provenance only from the main-owned DB value", () => {
    const request = createClaudeDesktopRunRequestFromRuntimeStartup({
      runId: "run-a",
      streamId: "stream-a",
      jobId: "job-a",
      mode: "agent",
      preflight: {
        kind: "project",
        cwd: "/repo",
        chat: { id: "chat-a", projectId: "project-a" },
        subChat: { id: "sub-chat-a", chatId: "chat-a" },
        project: { id: "project-a", path: "/repo" },
      } as DesktopRunPreflightResult,
      prompt: "hello",
      permissionPolicy: resolveDesktopPermissionPolicy({
        runtimeId: "claude-code",
        mode: "agent",
      }),
      signal: new AbortController().signal,
      existingSessionId: "db-session-a",
      emitTrace: () => {},
    })

    expect(request.session).toEqual({
      resumeSessionId: "db-session-a",
      parentSessionId: "db-session-a",
    })
  })

  test("has no renderer mutation route or router read for native session provenance", () => {
    const chatsRouter = readFileSync(
      "src/main/lib/trpc/routers/chats-sub-chats.ts",
      "utf8",
    )
    const claudeRouter = readFileSync(
      "src/main/lib/trpc/routers/claude.ts",
      "utf8",
    )
    const codexRouter = readFileSync(
      "src/main/lib/trpc/routers/codex.ts",
      "utf8",
    )

    expect(chatsRouter).not.toContain("updateSubChatSession")
    expect(claudeRouter).not.toContain("requestedSessionId: input.sessionId")
    expect(codexRouter).not.toContain("input.sessionId ??")
    expect(codexRouter).toContain("getLastCodexSessionId(existingMessages)")
  })
})
