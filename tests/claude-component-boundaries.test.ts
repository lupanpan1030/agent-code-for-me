import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import * as schema from "../src/main/lib/db/schema"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

const tempDirs: string[] = []
let testDb = createAgentJobTestDb()

mock.module("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => tmpdir(),
  },
}))

mock.module("../src/main/lib/db", () => ({
  ...schema,
  getDatabase: () => testDb,
}))

mock.module("../src/main/lib/claude", () => ({
  getBundledClaudeBinaryPath: () => "/tmp/locus-test-claude",
}))

mock.module("../src/main/lib/codex/bundled-cli", () => ({
  getBundledCodexCliPath: () => "/tmp/locus-test-codex",
}))

mock.module("../src/main/lib/plugins", () => ({
  getPluginComponentPaths: () => ({
    agents: "/tmp/locus-test-plugin/agents",
    commands: "/tmp/locus-test-plugin/commands",
    skills: "/tmp/locus-test-plugin/skills",
  }),
}))

mock.module("../src/main/lib/plugins/runtime-gates", () => ({
  discoverAllowedClaudePluginRuntimeComponents: async () => [],
}))

mock.module("../src/main/lib/trpc/routers/claude-settings", () => ({
  getEnabledPlugins: async () => [],
}))

mock.module("../src/main/lib/runtime-executable", () => ({
  getRuntimeExecutableStatus: async () => ({ available: false }),
}))

const { agentsRouter } = await import("../src/main/lib/trpc/routers/agents")
const { commandsRouter } = await import("../src/main/lib/trpc/routers/commands")
const { skillsRouter } = await import("../src/main/lib/trpc/routers/skills")

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  const resolved = resolve(dir)
  tempDirs.push(resolved)
  return resolved
}

function seedProject(projectPath: string, id = "project-components") {
  testDb
    .insert(schema.projects)
    .values({
      id,
      name: "Component Boundary Project",
      path: projectPath,
    })
    .run()
}

beforeEach(() => {
  testDb = createAgentJobTestDb()
})

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

describe("Claude project component route boundaries", () => {
  test("project-scoped agents, skills, and commands write inside registered project roots", async () => {
    const projectPath = await makeTempDir("locus-components-project-")
    seedProject(projectPath)

    const agents = agentsRouter.createCaller({ getWindow: () => null })
    const skills = skillsRouter.createCaller({ getWindow: () => null })
    const commands = commandsRouter.createCaller({ getWindow: () => null })

    await agents.create({
      source: "project",
      cwd: projectPath,
      name: "Review Bot",
      description: "Reviews changes",
      prompt: "Review the current change.",
    })
    await skills.create({
      source: "project",
      cwd: projectPath,
      name: "Release Notes",
      description: "Writes release notes",
      content: "Write release notes.",
    })
    await commands.create({
      source: "project",
      projectPath,
      name: "Ship It",
      description: "Prepare shipping notes",
      content: "Summarize the release.",
    })

    await expect(
      readFile(
        join(projectPath, ".claude", "agents", "review-bot.md"),
        "utf-8",
      ),
    ).resolves.toContain("Review the current change.")
    await expect(
      readFile(
        join(projectPath, ".claude", "skills", "release-notes", "SKILL.md"),
        "utf-8",
      ),
    ).resolves.toContain("Write release notes.")
    await expect(
      readFile(join(projectPath, ".claude", "commands", "ship-it.md"), "utf-8"),
    ).resolves.toContain("Summarize the release.")
  })

  test("project-scoped writes reject unregistered roots", async () => {
    const unregisteredPath = await makeTempDir("locus-components-unregistered-")
    const agents = agentsRouter.createCaller({ getWindow: () => null })
    const skills = skillsRouter.createCaller({ getWindow: () => null })
    const commands = commandsRouter.createCaller({ getWindow: () => null })

    await expect(
      agents.create({
        source: "project",
        cwd: unregisteredPath,
        name: "Bad Agent",
        description: "Bad",
        prompt: "Bad",
      }),
    ).rejects.toThrow("Project root is not registered")
    await expect(
      skills.create({
        source: "project",
        cwd: unregisteredPath,
        name: "Bad Skill",
        description: "Bad",
        content: "Bad",
      }),
    ).rejects.toThrow("Project root is not registered")
    await expect(
      commands.create({
        source: "project",
        projectPath: unregisteredPath,
        name: "Bad Command",
        description: "Bad",
        content: "Bad",
      }),
    ).rejects.toThrow("Project root is not registered")
  })

  test("project-scoped lists reject .claude symlink escapes", async () => {
    const projectPath = await makeTempDir("locus-components-symlink-project-")
    const outsidePath = await makeTempDir("locus-components-symlink-outside-")
    seedProject(projectPath)
    await mkdir(join(outsidePath, "agents"), { recursive: true })
    await mkdir(join(outsidePath, "skills"), { recursive: true })
    await mkdir(join(outsidePath, "commands"), { recursive: true })
    await symlink(outsidePath, join(projectPath, ".claude"))

    const agents = agentsRouter.createCaller({ getWindow: () => null })
    const skills = skillsRouter.createCaller({ getWindow: () => null })
    const commands = commandsRouter.createCaller({ getWindow: () => null })

    await expect(agents.list({ cwd: projectPath })).rejects.toThrow(
      "Path escapes allowed directory",
    )
    await expect(skills.list({ cwd: projectPath })).rejects.toThrow(
      "Path escapes allowed directory",
    )
    await expect(commands.list({ projectPath })).rejects.toThrow(
      "Path escapes allowed directory",
    )
  })

  test("project-scoped skill updates reject traversal paths", async () => {
    const projectPath = await makeTempDir("locus-components-traversal-project-")
    seedProject(projectPath)
    const skills = skillsRouter.createCaller({ getWindow: () => null })

    await expect(
      skills.update({
        cwd: projectPath,
        path: "../outside/SKILL.md",
        name: "escape",
        description: "escape",
        content: "escape",
      }),
    ).rejects.toThrow("Path traversal not allowed")
  })
})
