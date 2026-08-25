import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"

type TableColumn = {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
}

describe("database migrations", () => {
  test("applies all migrations to a fresh database with nullable chats.base_commit", () => {
    const sqlite = new Database(":memory:")

    try {
      migrate(drizzle(sqlite), {
        migrationsFolder: join(import.meta.dir, "../drizzle"),
      })

      const columns = sqlite
        .query("PRAGMA table_info(chats)")
        .all() as TableColumn[]
      expect(
        columns.find((column) => column.name === "base_commit"),
      ).toMatchObject({
        type: "TEXT",
        notnull: 0,
        dflt_value: null,
      })
    } finally {
      sqlite.close()
    }
  })
})
