import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { z } from "zod"
import { isCustomAgentModel } from "../../../../shared/custom-agent-models"
import { listClaudeNativeAgents } from "../../agent-builder/claude-native-agents"
import {
  ensureRegisteredClaudeProjectComponentRoot,
  resolveExistingRegisteredClaudeProjectComponentRoot,
  resolveRegisteredClaudeProjectComponentPath,
  resolveRegisteredClaudeProjectComponentRoot,
  resolveRegisteredProjectRoot,
} from "../../fs/registered-roots"
import { getPluginComponentPaths } from "../../plugins"
import { discoverAllowedClaudePluginRuntimeComponents } from "../../plugins/runtime-gates"
import { publicProcedure, router } from "../index"
import { type AgentModel, generateAgentMd, parseAgentMd } from "./agent-utils"
import { getEnabledPlugins } from "./claude-settings"

const agentModelSchema = z.custom<AgentModel>(isCustomAgentModel)

// Shared procedure for listing agents
const listAgentsProcedure = publicProcedure
  .input(
    z
      .object({
        cwd: z.string().optional(),
      })
      .optional(),
  )
  .query(async ({ input }) => {
    const projectRoot = input?.cwd
      ? (
          await resolveExistingRegisteredClaudeProjectComponentRoot(
            input.cwd,
            "agents",
          )
        )?.projectRoot
      : undefined
    return listClaudeNativeAgents({ cwd: projectRoot })
  })

export const agentsRouter = router({
  /**
   * List all agents from filesystem
   * - User agents: ~/.claude/agents/
   * - Project agents: .claude/agents/ (relative to cwd)
   */
  list: listAgentsProcedure,

  /**
   * Alias for list - used by @ mention
   */
  listEnabled: listAgentsProcedure,

  /**
   * Get single agent by name
   */
  get: publicProcedure
    .input(z.object({ name: z.string(), cwd: z.string().optional() }))
    .query(async ({ input }) => {
      const projectRoot = input.cwd
        ? resolveRegisteredProjectRoot(input.cwd)
        : undefined
      const locations = [
        {
          dir: path.join(os.homedir(), ".claude", "agents"),
          source: "user" as const,
        },
        ...(projectRoot
          ? [
              {
                dir: path.join(projectRoot, ".claude", "agents"),
                source: "project" as const,
              },
            ]
          : []),
      ]

      for (const { dir, source } of locations) {
        try {
          const agentPath =
            source === "project" && projectRoot
              ? await resolveRegisteredClaudeProjectComponentPath({
                  projectPath: projectRoot,
                  component: "agents",
                  targetPath: path.join(dir, `${input.name}.md`),
                })
              : path.join(dir, `${input.name}.md`)
          const content = await fs.readFile(agentPath, "utf-8")
          const parsed = parseAgentMd(content, `${input.name}.md`)
          return {
            ...parsed,
            source,
            path: agentPath,
          }
        } catch {}
      }

      // Search in plugin directories
      const enabledPluginSources = await getEnabledPlugins()
      const allowedPluginComponents =
        await discoverAllowedClaudePluginRuntimeComponents(enabledPluginSources)
      for (const { plugin } of allowedPluginComponents) {
        const paths = getPluginComponentPaths(plugin)
        const agentPath = path.join(paths.agents, `${input.name}.md`)
        try {
          const content = await fs.readFile(agentPath, "utf-8")
          const parsed = parseAgentMd(content, `${input.name}.md`)
          return {
            ...parsed,
            source: "plugin" as const,
            pluginName: plugin.source,
            path: agentPath,
          }
        } catch {}
      }
      return null
    }),

  /**
   * Create a new agent
   */
  create: publicProcedure
    .input(
      z.object({
        name: z.string(),
        description: z.string(),
        prompt: z.string(),
        tools: z.array(z.string()).optional(),
        disallowedTools: z.array(z.string()).optional(),
        model: agentModelSchema.optional(),
        source: z.enum(["user", "project"]),
        cwd: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      // Validate name (kebab-case, no special chars)
      const safeName = input.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")
      if (!safeName || safeName.includes("..")) {
        throw new Error("Invalid agent name")
      }

      // Determine target directory
      let targetDir: string
      let projectRoot: string | undefined
      if (input.source === "project") {
        if (!input.cwd) {
          throw new Error("Project path (cwd) required for project agents")
        }
        const roots = await ensureRegisteredClaudeProjectComponentRoot(
          input.cwd,
          "agents",
        )
        projectRoot = roots.projectRoot
        targetDir = roots.componentRoot
      } else {
        targetDir = path.join(os.homedir(), ".claude", "agents")
      }

      // Ensure directory exists
      await fs.mkdir(targetDir, { recursive: true })

      const agentPath = projectRoot
        ? await resolveRegisteredClaudeProjectComponentPath({
            projectPath: projectRoot,
            component: "agents",
            targetPath: path.join(targetDir, `${safeName}.md`),
          })
        : path.join(targetDir, `${safeName}.md`)

      // Check if already exists
      try {
        await fs.access(agentPath)
        throw new Error(`Agent "${safeName}" already exists`)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          throw err
        }
      }

      // Generate and write file
      const content = generateAgentMd({
        name: safeName,
        description: input.description,
        prompt: input.prompt,
        tools: input.tools,
        disallowedTools: input.disallowedTools,
        model: input.model,
      })

      await fs.writeFile(agentPath, content, "utf-8")

      return {
        name: safeName,
        path: agentPath,
        source: input.source,
      }
    }),

  /**
   * Update an existing agent
   */
  update: publicProcedure
    .input(
      z.object({
        originalName: z.string(),
        name: z.string(),
        description: z.string(),
        prompt: z.string(),
        tools: z.array(z.string()).optional(),
        disallowedTools: z.array(z.string()).optional(),
        model: agentModelSchema.optional(),
        source: z.enum(["user", "project"]),
        cwd: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      // Validate names
      const safeOriginalName = input.originalName
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
      const safeName = input.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")
      if (!safeOriginalName || !safeName || safeName.includes("..")) {
        throw new Error("Invalid agent name")
      }

      // Determine target directory
      let targetDir: string
      let projectRoot: string | undefined
      if (input.source === "project") {
        if (!input.cwd) {
          throw new Error("Project path (cwd) required for project agents")
        }
        const roots = resolveRegisteredClaudeProjectComponentRoot(
          input.cwd,
          "agents",
        )
        projectRoot = roots.projectRoot
        targetDir = roots.componentRoot
      } else {
        targetDir = path.join(os.homedir(), ".claude", "agents")
      }

      const originalPath = projectRoot
        ? await resolveRegisteredClaudeProjectComponentPath({
            projectPath: projectRoot,
            component: "agents",
            targetPath: path.join(targetDir, `${safeOriginalName}.md`),
          })
        : path.join(targetDir, `${safeOriginalName}.md`)
      const newPath = projectRoot
        ? await resolveRegisteredClaudeProjectComponentPath({
            projectPath: projectRoot,
            component: "agents",
            targetPath: path.join(targetDir, `${safeName}.md`),
          })
        : path.join(targetDir, `${safeName}.md`)

      // Check original exists
      try {
        await fs.access(originalPath)
      } catch {
        throw new Error(`Agent "${safeOriginalName}" not found`)
      }

      // If renaming, check new name doesn't exist
      if (safeOriginalName !== safeName) {
        try {
          await fs.access(newPath)
          throw new Error(`Agent "${safeName}" already exists`)
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            throw err
          }
        }
      }

      // Generate and write file
      const content = generateAgentMd({
        name: safeName,
        description: input.description,
        prompt: input.prompt,
        tools: input.tools,
        disallowedTools: input.disallowedTools,
        model: input.model,
      })

      // Delete old file if renaming
      if (safeOriginalName !== safeName) {
        await fs.unlink(originalPath)
      }

      await fs.writeFile(newPath, content, "utf-8")

      return {
        name: safeName,
        path: newPath,
        source: input.source,
      }
    }),

  /**
   * Delete an agent
   */
  delete: publicProcedure
    .input(
      z.object({
        name: z.string(),
        source: z.enum(["user", "project"]),
        cwd: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const safeName = input.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")
      if (!safeName || safeName.includes("..")) {
        throw new Error("Invalid agent name")
      }

      let targetDir: string
      let projectRoot: string | undefined
      if (input.source === "project") {
        if (!input.cwd) {
          throw new Error("Project path (cwd) required for project agents")
        }
        const roots = resolveRegisteredClaudeProjectComponentRoot(
          input.cwd,
          "agents",
        )
        projectRoot = roots.projectRoot
        targetDir = roots.componentRoot
      } else {
        targetDir = path.join(os.homedir(), ".claude", "agents")
      }

      const agentPath = projectRoot
        ? await resolveRegisteredClaudeProjectComponentPath({
            projectPath: projectRoot,
            component: "agents",
            targetPath: path.join(targetDir, `${safeName}.md`),
          })
        : path.join(targetDir, `${safeName}.md`)

      await fs.unlink(agentPath)

      return { deleted: true }
    }),
})
