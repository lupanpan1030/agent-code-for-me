import { beforeEach, describe, expect, mock, test } from "bun:test"
import { resolve } from "node:path"
import * as schema from "../src/main/lib/db/schema"
import { PathBoundaryError } from "../src/main/lib/fs/path-boundary"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

let testDb = createAgentJobTestDb()

mock.module("../src/main/lib/db", () => ({
  ...schema,
  getDatabase: () => testDb,
}))

const {
  resolveRegisteredChatWorktreeRoot,
  resolveRegisteredFileRoot,
  resolveRegisteredProjectRoot,
} = await import("../src/main/lib/fs/registered-roots")

beforeEach(() => {
  testDb = createAgentJobTestDb()
})

function seedProject(input: {
  id?: string
  path: string
  removedAt?: Date | null
}) {
  testDb
    .insert(schema.projects)
    .values({
      id: input.id ?? "project-1",
      name: "Registered Project",
      path: input.path,
      removedAt: input.removedAt ?? null,
    })
    .run()
}

describe("registered root resolvers", () => {
  test("resolves active registered project roots", () => {
    seedProject({ path: "/tmp/locus-registered-project" })

    expect(resolveRegisteredProjectRoot("/tmp/locus-registered-project")).toBe(
      resolve("/tmp/locus-registered-project"),
    )
  })

  test("rejects unregistered project roots", () => {
    expect(() =>
      resolveRegisteredProjectRoot("/tmp/locus-unregistered-project"),
    ).toThrow(PathBoundaryError)
    expect(() =>
      resolveRegisteredProjectRoot("/tmp/locus-unregistered-project"),
    ).toThrow("Project root is not registered")
  })

  test("rejects removed project roots", () => {
    seedProject({
      path: "/tmp/locus-removed-project",
      removedAt: new Date("2026-07-03T00:00:00Z"),
    })

    expect(() =>
      resolveRegisteredProjectRoot("/tmp/locus-removed-project"),
    ).toThrow("Project root is not registered")
  })

  test("rejects empty project root input", () => {
    expect(() => resolveRegisteredProjectRoot("")).toThrow(
      "Project root is required",
    )
  })

  test("resolves registered chat worktree roots", () => {
    seedProject({ path: "/tmp/locus-chat-project" })
    testDb
      .insert(schema.chats)
      .values({
        id: "chat-1",
        projectId: "project-1",
        name: "Chat",
        worktreePath: "/tmp/locus-chat-worktree",
      })
      .run()

    expect(resolveRegisteredChatWorktreeRoot("chat-1")).toBe(
      resolve("/tmp/locus-chat-worktree"),
    )
  })

  test("falls back to active project root for chats without worktrees", () => {
    seedProject({ path: "/tmp/locus-chat-project-root" })
    testDb
      .insert(schema.chats)
      .values({
        id: "chat-no-worktree",
        projectId: "project-1",
        name: "Chat",
        worktreePath: null,
      })
      .run()

    expect(resolveRegisteredChatWorktreeRoot("chat-no-worktree")).toBe(
      resolve("/tmp/locus-chat-project-root"),
    )
  })

  test("rejects chats for removed projects", () => {
    seedProject({
      path: "/tmp/locus-removed-chat-project",
      removedAt: new Date("2026-07-03T00:00:00Z"),
    })
    testDb
      .insert(schema.chats)
      .values({
        id: "chat-removed-project",
        projectId: "project-1",
        name: "Chat",
        worktreePath: "/tmp/locus-removed-chat-worktree",
      })
      .run()

    expect(() =>
      resolveRegisteredChatWorktreeRoot("chat-removed-project"),
    ).toThrow("Project root is not registered")
  })

  test("rejects unknown and empty chat ids", () => {
    expect(() => resolveRegisteredChatWorktreeRoot("missing-chat")).toThrow(
      "Chat worktree root is not registered",
    )
    expect(() => resolveRegisteredChatWorktreeRoot("")).toThrow(
      "Chat id is required",
    )
  })

  test("preserves file root compatibility for registered chat worktree paths", () => {
    testDb
      .insert(schema.chats)
      .values({
        id: "chat-file-root",
        projectId: null,
        name: "Chat",
        worktreePath: "/tmp/locus-file-worktree",
      })
      .run()

    expect(resolveRegisteredFileRoot("/tmp/locus-file-worktree")).toBe(
      resolve("/tmp/locus-file-worktree"),
    )
    expect(() =>
      resolveRegisteredFileRoot("/tmp/locus-file-unregistered"),
    ).toThrow("File read root is not registered")
  })
})
