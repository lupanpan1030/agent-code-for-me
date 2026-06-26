import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("legacy custom Claude config migration", () => {
  test("does not persist custom Claude tokens in renderer storage after migration", () => {
    const atomsSource = readFileSync(
      join(process.cwd(), "src/renderer/lib/atoms/index.ts"),
      "utf-8",
    )
    const migrationsSource = readFileSync(
      join(
        process.cwd(),
        "src/renderer/features/onboarding/lib/use-legacy-migrations.ts",
      ),
      "utf-8",
    )
    const atomSource = atomsSource.slice(
      atomsSource.indexOf("export const customClaudeConfigAtom"),
      atomsSource.indexOf("// Auto-fallback to offline mode"),
    )
    const providerMigrationSource = migrationsSource.slice(
      migrationsSource.indexOf(
        "// Legacy renderer-stored custom Claude provider token",
      ),
    )

    expect(atomsSource).toContain(
      'LEGACY_CUSTOM_CLAUDE_CONFIG_STORAGE_KEY =\n  "agents:claude-custom-config"',
    )
    expect(atomSource).not.toContain("token:")
    expect(migrationsSource).toContain(
      "window.localStorage.removeItem(LEGACY_CUSTOM_CLAUDE_CONFIG_STORAGE_KEY)",
    )
    expect(providerMigrationSource).toContain(
      "removeLegacyCustomClaudeConfigStorage()",
    )
    expect(providerMigrationSource).toContain("setLegacyCustomClaudeConfig(RESET)")
    expect(providerMigrationSource).not.toContain(
      'setLegacyCustomClaudeConfig({ model: "", token: "", baseUrl: "" })',
    )
    expect(providerMigrationSource).not.toContain("window.localStorage.setItem")
  })
})
