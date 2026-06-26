import * as electron from "electron"
import { join } from "path"
import { appendFile, mkdir, stat, readdir, unlink } from "fs/promises"
import { redactRuntimePayload } from "../agent-runtime/redaction"
import type { JsonValue } from "../agent-runtime/runtime-events"

// Dev-only diagnostic switch. Payloads are redacted before disk, but raw SDK
// traces can still reveal sensitive workflow context.
function isEnabled(): boolean {
  return process.env.CLAUDE_RAW_LOG === "1"
}
const MAX_LOG_SIZE = 10 * 1024 * 1024 // 10MB per file
const LOG_RETENTION_DAYS = 7 // Keep logs for 7 days

let logsDir: string | null = null
let currentLogFile: string | null = null
let currentSessionId: string | null = null
let getUserDataDir = () => electron.app.getPath("userData")

export function setClaudeRawLoggerUserDataDirProviderForTest(
  provider: (() => string) | null,
): void {
  getUserDataDir = provider ?? (() => electron.app.getPath("userData"))
  logsDir = null
  currentLogFile = null
  currentSessionId = null
}

async function ensureLogsDir(): Promise<string> {
  const desiredDir = join(getUserDataDir(), "logs", "claude")
  if (logsDir !== desiredDir) {
    logsDir = desiredDir
    currentLogFile = null
    currentSessionId = null
  }

  await mkdir(logsDir, { recursive: true })
  return logsDir
}

function sanitizeLogFileSegment(value: string): string {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9_-]/g, "_")
      .slice(0, 120) || "session"
  )
}

function toRedactableJsonValue(value: unknown): JsonValue {
  try {
    const serialized = JSON.stringify(value, (_key, child) =>
      typeof child === "bigint" ? child.toString() : child,
    )
    if (serialized === undefined) return String(value)
    return JSON.parse(serialized) as JsonValue
  } catch {
    return String(value)
  }
}

/**
 * Check if current log file should be rotated based on size
 */
async function shouldRotateLog(file: string): Promise<boolean> {
  try {
    const stats = await stat(file)
    return stats.size > MAX_LOG_SIZE
  } catch {
    // File doesn't exist or can't be accessed - no need to rotate
    return false
  }
}

/**
 * Clean up old log files (older than LOG_RETENTION_DAYS)
 * Called periodically to prevent disk space issues
 */
export async function cleanupOldLogs(): Promise<void> {
  if (!isEnabled()) return

  try {
    const dir = await ensureLogsDir()
    const files = await readdir(dir)

    const now = Date.now()
    const maxAge = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000

    for (const file of files) {
      // Only process .jsonl files
      if (!file.endsWith(".jsonl")) continue

      const filePath = join(dir, file)
      try {
        const stats = await stat(filePath)
        const age = now - stats.mtime.getTime()

        if (age > maxAge) {
          await unlink(filePath)
          console.log(`[raw-logger] Cleaned up old log: ${file}`)
        }
      } catch (err) {
        // Skip files we can't access
        console.warn(`[raw-logger] Failed to check file ${file}:`, err)
      }
    }
  } catch (err) {
    console.error("[raw-logger] Failed to cleanup old logs:", err)
  }
}

/**
 * Log a raw Claude message to JSONL file for debugging
 * Includes automatic log rotation and cleanup
 */
export async function logRawClaudeMessage(
  sessionId: string,
  msg: unknown,
): Promise<void> {
  if (!isEnabled()) return

  try {
    const dir = await ensureLogsDir()

    // Create new file for new session OR rotate if current file is too large
    const isNewSession = sessionId !== currentSessionId
    const needsNewFile =
      isNewSession ||
      (currentLogFile && (await shouldRotateLog(currentLogFile)))

    if (needsNewFile) {
      currentSessionId = sessionId
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
      const suffix = currentLogFile ? `-${Date.now()}` : ""
      const safeSessionId = sanitizeLogFileSegment(sessionId)
      currentLogFile = join(dir, `${safeSessionId}_${timestamp}${suffix}.jsonl`)

      // Run cleanup periodically (on new session start)
      if (isNewSession) {
        // Run cleanup in background, don't wait for it
        cleanupOldLogs().catch((err) =>
          console.error("[raw-logger] Background cleanup failed:", err),
        )
      }
    }

    const redaction = redactRuntimePayload(toRedactableJsonValue(msg), {
      runtimeId: "claude-code",
      runId: sessionId,
      source: "runtime-diagnostic",
    })

    const entry = {
      timestamp: new Date().toISOString(),
      data: redaction.payload,
      redaction: {
        status: redaction.appliedRules.length > 0 ? "redacted" : "unchanged",
        appliedRules: redaction.appliedRules,
      },
    }

    await appendFile(currentLogFile!, JSON.stringify(entry) + "\n")
  } catch (err) {
    // Don't let logging errors break the main flow
    console.error("[raw-logger] Failed to log:", err)
  }
}

/**
 * Get the directory where Claude logs are stored
 * Useful for UI to show "Open Logs" button
 */
export function getLogsDirectory(): string {
  return join(getUserDataDir(), "logs", "claude")
}
