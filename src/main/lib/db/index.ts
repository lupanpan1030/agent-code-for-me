import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import * as electron from "electron"
import { backfillSubChatBindings } from "../chat-session-binding"
import * as schema from "./schema"

let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let sqlite: Database.Database | null = null

/**
 * Get the database path in the app's user data directory
 */
function getDatabasePath(): string {
  const userDataPath = electron.app.getPath("userData")
  const dataDir = join(userDataPath, "data")

  // Ensure data directory exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  return join(dataDir, "agents.db")
}

/**
 * Get the migrations folder path
 * Handles both development and production (packaged) environments
 */
function getMigrationsPath(): string {
  if (electron.app.isPackaged) {
    // Production: migrations bundled in resources
    return join(process.resourcesPath, "migrations")
  }
  // Development: from out/main -> apps/desktop/drizzle
  return join(__dirname, "../../drizzle")
}

/**
 * Initialize the database with Drizzle ORM
 */
export function initDatabase() {
  if (db) {
    return db
  }

  const dbPath = getDatabasePath()
  console.log(`[DB] Initializing database at: ${dbPath}`)

  const connection = new Database(dbPath)

  try {
    connection.pragma("journal_mode = WAL")
    connection.pragma("busy_timeout = 5000")
    connection.pragma("foreign_keys = ON")

    const instance = drizzle(connection, { schema })

    // Run migrations before publishing the module-level singleton.
    const migrationsPath = getMigrationsPath()
    console.log(`[DB] Running migrations from: ${migrationsPath}`)
    migrate(instance, { migrationsFolder: migrationsPath })
    const backfilledBindings = backfillSubChatBindings(instance)

    sqlite = connection
    db = instance
    console.log(
      `[DB] Migrations completed; backfilled ${backfilledBindings} chat session binding(s)`,
    )
    return db
  } catch (error) {
    console.error("[DB] Migration error:", error)
    connection.close()
    throw error
  }
}

/**
 * Get the database instance
 */
export function getDatabase() {
  if (!db) {
    return initDatabase()
  }
  return db
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (sqlite) {
    sqlite.close()
    sqlite = null
    db = null
    console.log("[DB] Database connection closed")
  }
}

// Re-export schema for convenience
export * from "./schema"
