import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { eq } from "drizzle-orm"
import { chats, getDatabase, projects } from "../db"
import {
  PathBoundaryError,
  resolvePathWithinRoot,
  resolveRealPathWithinRoot,
} from "./path-boundary"

export type ClaudeProjectComponentRoot = "agents" | "commands" | "skills"

export type RegisteredClaudeProjectComponentRoot = {
  projectRoot: string
  componentRoot: string
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  )
}

function normalizeRootInput(rootPath: string, label: string): string {
  if (rootPath.length === 0) {
    throw new PathBoundaryError(`${label} is required`)
  }
  if (rootPath.includes("\0")) {
    throw new PathBoundaryError(`${label} contains invalid characters`)
  }
  return resolve(rootPath)
}

function assertActiveRegisteredProject(
  project:
    | {
        removedAt: Date | null
      }
    | null
    | undefined,
): void {
  if (!project || project.removedAt) {
    throw new PathBoundaryError("Project root is not registered")
  }
}

export function resolveRegisteredProjectRoot(projectPath: string): string {
  const resolvedRoot = normalizeRootInput(projectPath, "Project root")
  const db = getDatabase()
  const registeredProject = db
    .select({
      path: projects.path,
      removedAt: projects.removedAt,
    })
    .from(projects)
    .all()
    .find((project) => resolve(project.path) === resolvedRoot)

  assertActiveRegisteredProject(registeredProject)
  return resolvedRoot
}

export function resolveRegisteredChatWorktreeRoot(chatId: string): string {
  if (chatId.length === 0) {
    throw new PathBoundaryError("Chat id is required")
  }

  const db = getDatabase()
  const chat = db
    .select({
      projectId: chats.projectId,
      worktreePath: chats.worktreePath,
    })
    .from(chats)
    .where(eq(chats.id, chatId))
    .get()

  if (!chat) {
    throw new PathBoundaryError("Chat worktree root is not registered")
  }

  const project = chat.projectId
    ? db
        .select({
          path: projects.path,
          removedAt: projects.removedAt,
        })
        .from(projects)
        .where(eq(projects.id, chat.projectId))
        .get()
    : null

  if (chat.projectId) {
    assertActiveRegisteredProject(project)
  }

  if (chat.worktreePath) {
    return normalizeRootInput(chat.worktreePath, "Chat worktree root")
  }

  if (project) {
    return normalizeRootInput(project.path, "Chat project root")
  }

  throw new PathBoundaryError("Chat worktree root is not registered")
}

export function resolveRegisteredFileRoot(rootPath: string): string {
  const resolvedRoot = normalizeRootInput(rootPath, "File read root")
  const db = getDatabase()
  const registeredProject = db
    .select({
      path: projects.path,
      removedAt: projects.removedAt,
    })
    .from(projects)
    .all()
    .some(
      (project) => !project.removedAt && resolve(project.path) === resolvedRoot,
    )

  if (registeredProject) {
    return resolvedRoot
  }

  const registeredWorktree = db
    .select({ worktreePath: chats.worktreePath })
    .from(chats)
    .all()
    .some(
      (chat) =>
        typeof chat.worktreePath === "string" &&
        resolve(chat.worktreePath) === resolvedRoot,
    )

  if (!registeredWorktree) {
    throw new PathBoundaryError("File read root is not registered")
  }

  return resolvedRoot
}

export function resolveRegisteredClaudeProjectComponentRoot(
  projectPath: string,
  component: ClaudeProjectComponentRoot,
): RegisteredClaudeProjectComponentRoot {
  const projectRoot = resolveRegisteredProjectRoot(projectPath)
  const componentRoot = resolvePathWithinRoot({
    targetPath: join(projectRoot, ".claude", component),
    rootPath: projectRoot,
  })
  return { projectRoot, componentRoot }
}

export async function resolveExistingRegisteredClaudeProjectComponentRoot(
  projectPath: string,
  component: ClaudeProjectComponentRoot,
): Promise<RegisteredClaudeProjectComponentRoot | null> {
  const roots = resolveRegisteredClaudeProjectComponentRoot(
    projectPath,
    component,
  )

  try {
    await resolveRealPathWithinRoot({
      targetPath: roots.componentRoot,
      rootPath: roots.projectRoot,
    })
    return roots
  } catch (error) {
    if (isNotFoundError(error)) {
      return roots
    }
    throw error
  }
}

export async function ensureRegisteredClaudeProjectComponentRoot(
  projectPath: string,
  component: ClaudeProjectComponentRoot,
): Promise<RegisteredClaudeProjectComponentRoot> {
  const roots = resolveRegisteredClaudeProjectComponentRoot(
    projectPath,
    component,
  )
  const claudeRoot = resolvePathWithinRoot({
    targetPath: join(roots.projectRoot, ".claude"),
    rootPath: roots.projectRoot,
  })

  try {
    await resolveRealPathWithinRoot({
      targetPath: claudeRoot,
      rootPath: roots.projectRoot,
    })
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  await mkdir(roots.componentRoot, { recursive: true })
  await resolveRealPathWithinRoot({
    targetPath: roots.componentRoot,
    rootPath: roots.projectRoot,
  })

  return roots
}

export async function resolveRegisteredClaudeProjectComponentPath(input: {
  projectPath: string
  component: ClaudeProjectComponentRoot
  targetPath: string
}): Promise<string> {
  const roots = resolveRegisteredClaudeProjectComponentRoot(
    input.projectPath,
    input.component,
  )
  const lexicalPath = resolvePathWithinRoot({
    targetPath: input.targetPath,
    rootPath: roots.componentRoot,
  })

  return resolveRealPathWithinRoot({
    targetPath: lexicalPath,
    rootPath: roots.projectRoot,
  })
}
