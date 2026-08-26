import { afterEach, describe, expect, mock, test } from "bun:test"

type FakeDatabaseConnection = {
  path: string
  closed: boolean
  pragmas: string[]
  pragma: (value: string) => void
  close: () => void
}

let shouldFailMigration = false
const connections: FakeDatabaseConnection[] = []
const migrationCalls: Array<{ db: unknown; migrationsFolder: string }> = []
const backfillCalls: unknown[] = []
const initializationSteps: string[] = []

class FakeDatabase implements FakeDatabaseConnection {
  closed = false
  pragmas: string[] = []

  constructor(public path: string) {
    connections.push(this)
  }

  pragma(value: string): void {
    this.pragmas.push(value)
  }

  close(): void {
    this.closed = true
  }
}

mock.module("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => "/tmp/locus-db-test",
  },
}))

mock.module("better-sqlite3", () => ({
  default: FakeDatabase,
}))

mock.module("drizzle-orm/better-sqlite3", () => ({
  drizzle: (connection: FakeDatabaseConnection, options: unknown) => ({
    connection,
    options,
  }),
}))

mock.module("drizzle-orm/better-sqlite3/migrator", () => ({
  migrate: (db: unknown, options: { migrationsFolder: string }) => {
    initializationSteps.push("migrate")
    migrationCalls.push({ db, migrationsFolder: options.migrationsFolder })
    if (shouldFailMigration) {
      throw new Error("migration boom")
    }
  },
}))

mock.module("../src/main/lib/chat-session-binding", () => ({
  backfillSubChatBindings: (db: unknown) => {
    initializationSteps.push("backfill")
    backfillCalls.push(db)
    return 0
  },
}))

const { closeDatabase, getDatabase, initDatabase } = await import(
  "../src/main/lib/db"
)

afterEach(() => {
  shouldFailMigration = false
  closeDatabase()
  connections.length = 0
  migrationCalls.length = 0
  backfillCalls.length = 0
  initializationSteps.length = 0
})

describe("database initialization", () => {
  test("does not cache or leak a connection when migrations fail", () => {
    shouldFailMigration = true

    expect(() => initDatabase()).toThrow("migration boom")
    expect(connections).toHaveLength(1)
    expect(connections[0]?.closed).toBe(true)
    expect(backfillCalls).toHaveLength(0)

    shouldFailMigration = false
    const recovered = getDatabase()

    expect(connections).toHaveLength(2)
    expect(connections[1]?.closed).toBe(false)
    expect(recovered).toBe(migrationCalls.at(-1)?.db)
    expect(backfillCalls).toEqual([recovered])
    expect(initializationSteps).toEqual(["migrate", "migrate", "backfill"])
  })
})
