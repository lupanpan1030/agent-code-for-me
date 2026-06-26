import { createHash } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { dialog } from "electron"
import { getDatabase, mcpCommandTrustDecisions } from "../db"

export type McpCommandTrustRuntime = "claude-code" | "codex"
export type McpCommandTrustScope = "global" | "project"
export type McpCommandTrustDatabase = ReturnType<typeof getDatabase>

export type McpCommandTrustInput = {
  runtime: McpCommandTrustRuntime
  name: string
  scope: McpCommandTrustScope
  projectPath?: string
  command: string
  args?: string[]
  env?: Record<string, string>
  envVars?: string[]
  cwd?: string
}

export type McpCommandTrustRequest = {
  runtime: McpCommandTrustRuntime
  name: string
  scope: McpCommandTrustScope
  projectPath?: string
  command: string
  args: string[]
  env: Record<string, string>
  envVars: string[]
  cwd?: string
  commandHash: string
}

type McpCommandTrustPrompt = (
  request: McpCommandTrustRequest,
) => Promise<boolean>

let promptForTest: McpCommandTrustPrompt | null = null
let databaseForTest: McpCommandTrustDatabase | null = null

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === "string" && typeof entry[1] === "string",
    )
    .sort(([a], [b]) => a.localeCompare(b))
  return Object.fromEntries(entries)
}

function normalizeMcpCommandTrustInput(
  input: McpCommandTrustInput,
): Omit<McpCommandTrustRequest, "commandHash"> {
  const name = input.name.trim()
  const command = input.command.trim()
  if (!name) {
    throw new Error("MCP command trust requires a server name.")
  }
  if (!command) {
    throw new Error("MCP command trust requires a stdio command.")
  }

  const envVars = normalizeStringArray(input.envVars)
    .map((name) => name.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
  const cwd = input.cwd?.trim()

  return {
    runtime: input.runtime,
    name,
    scope: input.scope,
    ...(input.projectPath?.trim()
      ? { projectPath: input.projectPath.trim() }
      : {}),
    command,
    args: normalizeStringArray(input.args),
    env: normalizeStringRecord(input.env),
    envVars,
    ...(cwd ? { cwd } : {}),
  }
}

function hashMcpCommandTrustDocument(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export function hashMcpCommandTrustInput(input: McpCommandTrustInput): string {
  const normalized = normalizeMcpCommandTrustInput(input)
  return hashMcpCommandTrustDocument({
    schemaVersion: 1,
    runtime: normalized.runtime,
    name: normalized.name,
    scope: normalized.scope,
    command: normalized.command,
    args: normalized.args,
    env: normalized.env,
    envVars: normalized.envVars,
    cwd: normalized.cwd ?? null,
  })
}

export function buildMcpCommandTrustRequest(
  input: McpCommandTrustInput,
): McpCommandTrustRequest {
  const normalized = normalizeMcpCommandTrustInput(input)
  return {
    ...normalized,
    commandHash: hashMcpCommandTrustInput(normalized),
  }
}

function dbForTrust(input?: {
  db?: McpCommandTrustDatabase
}): McpCommandTrustDatabase {
  return input?.db ?? databaseForTest ?? getDatabase()
}

export function isMcpCommandTrustApproved(input: {
  request: McpCommandTrustInput
  db?: McpCommandTrustDatabase
}): boolean {
  const request = buildMcpCommandTrustRequest(input.request)
  const db = dbForTrust(input)
  const decision = db
    .select()
    .from(mcpCommandTrustDecisions)
    .where(
      and(
        eq(mcpCommandTrustDecisions.commandHash, request.commandHash),
        eq(mcpCommandTrustDecisions.decision, "approved"),
      ),
    )
    .get()

  return Boolean(decision)
}

export function isMcpCommandTrustApprovedForRuntime(
  input: McpCommandTrustInput,
): boolean {
  try {
    return isMcpCommandTrustApproved({ request: input })
  } catch (error) {
    console.warn("[mcp-command-trust] Failed to verify command trust:", error)
    return false
  }
}

export function recordMcpCommandTrustApproval(input: {
  request: McpCommandTrustInput
  db?: McpCommandTrustDatabase
}): void {
  const request = buildMcpCommandTrustRequest(input.request)
  const db = dbForTrust(input)
  const existing = db
    .select()
    .from(mcpCommandTrustDecisions)
    .where(eq(mcpCommandTrustDecisions.commandHash, request.commandHash))
    .get()
  const now = new Date()

  if (existing) {
    db.update(mcpCommandTrustDecisions)
      .set({
        runtime: request.runtime,
        serverName: request.name,
        scope: request.scope,
        decision: "approved",
        updatedAt: now,
      })
      .where(eq(mcpCommandTrustDecisions.id, existing.id))
      .run()
    return
  }

  db.insert(mcpCommandTrustDecisions)
    .values({
      runtime: request.runtime,
      serverName: request.name,
      scope: request.scope,
      commandHash: request.commandHash,
      decision: "approved",
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

function formatJsonList(values: string[]): string {
  return values.length > 0
    ? values.map((value) => JSON.stringify(value)).join(" ")
    : "(none)"
}

function formatRedactedEnv(env: Record<string, string>): string {
  const names = Object.keys(env).sort((a, b) => a.localeCompare(b))
  return names.length > 0
    ? names.map((name) => `${name}=<redacted>`).join("\n")
    : "(none)"
}

function formatEnvVarNames(envVars: string[]): string {
  return envVars.length > 0 ? envVars.join(", ") : "(none)"
}

async function showNativeMcpCommandTrustPrompt(
  request: McpCommandTrustRequest,
): Promise<boolean> {
  const result = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Cancel", "Allow"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: "Approve MCP command",
    message: "Allow Locus to save this MCP stdio command?",
    detail: [
      `Runtime: ${request.runtime}`,
      `Name: ${request.name}`,
      `Scope: ${request.scope}`,
      ...(request.projectPath ? [`Project: ${request.projectPath}`] : []),
      `Command: ${request.command}`,
      `Args: ${formatJsonList(request.args)}`,
      `Env: ${formatRedactedEnv(request.env)}`,
      `Env vars: ${formatEnvVarNames(request.envVars)}`,
      ...(request.cwd ? [`Cwd: ${request.cwd}`] : []),
      `Fingerprint: ${request.commandHash}`,
    ].join("\n"),
  })

  return result.response === 1
}

export async function ensureMcpCommandWriteApproved(input: {
  request: McpCommandTrustInput
  db?: McpCommandTrustDatabase
}): Promise<McpCommandTrustRequest> {
  const request = buildMcpCommandTrustRequest(input.request)
  if (isMcpCommandTrustApproved({ request, db: input.db })) {
    return request
  }

  const approved = await (promptForTest ?? showNativeMcpCommandTrustPrompt)(
    request,
  )
  if (!approved) {
    throw new Error("MCP stdio command write was not approved.")
  }

  recordMcpCommandTrustApproval({ request, db: input.db })
  return request
}

export function buildMcpCommandTrustInputFromConfig(input: {
  runtime: McpCommandTrustRuntime
  name: string
  scope: McpCommandTrustScope
  projectPath?: string
  config: Record<string, unknown>
}): McpCommandTrustInput | null {
  const command =
    typeof input.config.command === "string" ? input.config.command.trim() : ""
  if (!command) return null

  return {
    runtime: input.runtime,
    name: input.name,
    scope: input.scope,
    projectPath: input.projectPath,
    command,
    args: normalizeStringArray(input.config.args),
    env: normalizeStringRecord(input.config.env),
    envVars: normalizeStringArray(input.config.envVars),
    cwd: typeof input.config.cwd === "string" ? input.config.cwd : undefined,
  }
}

export function setMcpCommandTrustPromptForTest(
  prompt: McpCommandTrustPrompt | null,
): void {
  promptForTest = prompt
}

export function setMcpCommandTrustDatabaseForTest(
  db: McpCommandTrustDatabase | null,
): void {
  databaseForTest = db
}
