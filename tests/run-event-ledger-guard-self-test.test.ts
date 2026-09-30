/**
 * Implementer unit test for the negative half of S38/S40 (refactor-canonical-
 * run-event-ledger architecture-ownership "Second event mapping definition
 * appears" / "Guard proves its own detection"; red-receipt §6: S38/S40
 * negative self-test observation). The architecture guard's fixture-driven
 * self-test exposes an inspectable summary; this test drives it with a
 * mutated copy of the immutable architecture-fixtures.json through the
 * guard's `--run-event-ledger-fixtures=` option and observes that a missing
 * detection and an unexpected detection each fail the guard by case id.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

type Finding = Record<string, string>
type ArchitectureFixture = {
  ownerSection: string
  cases: Array<{
    caseId: string
    category: string
    expectedFindings: Finding[]
  }>
}

const REPO_ROOT = join(import.meta.dir, "..")
const GUARD_TIMEOUT_MS = 180_000

const directories: string[] = []
afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop() as string, { recursive: true, force: true })
  }
})

describe("S38/S40 architecture guard negative self-test", () => {
  test(
    "a fixture whose expected findings disagree with the guard's detection fails the guard with the case id, the missing and the unexpected finding",
    () => {
      const fixture = JSON.parse(
        readFileSync(
          join(
            import.meta.dir,
            "fixtures/run-event-ledger/architecture-fixtures.json",
          ),
          "utf8",
        ),
      ) as ArchitectureFixture
      const total = fixture.cases.length
      const duplicate = fixture.cases.find(
        (entry) => entry.caseId === "duplicate-ledger-definition",
      )
      const clean = fixture.cases.find(
        (entry) => entry.caseId === "clean-owners",
      )
      if (!duplicate || !clean) throw new Error("fixture cases missing")
      expect(duplicate.expectedFindings).toHaveLength(1)
      const detected = duplicate.expectedFindings[0]
      // Mutation 1: the guard still detects the second ledger definition,
      // but the fixture no longer expects it (an unexpected finding).
      duplicate.expectedFindings = []
      // Mutation 2: the clean case now expects a finding the guard does not
      // produce (a missing detection).
      const bogus: Finding = {
        rule: "legacy-symbol",
        file: "src/main/lib/agent-runtime/run-event-ledger.ts",
        symbol: "appendAgentJobEvent",
        ownerSection: fixture.ownerSection,
      }
      clean.expectedFindings = [bogus]

      const directory = mkdtempSync(join(tmpdir(), "ledger-guard-fixture-"))
      directories.push(directory)
      const mutatedPath = join(directory, "architecture-fixtures.json")
      writeFileSync(mutatedPath, JSON.stringify(fixture, null, 2))

      const run = spawnSync(
        "node",
        [
          "scripts/check-architecture-guards.mjs",
          `--run-event-ledger-fixtures=${mutatedPath}`,
        ],
        {
          cwd: REPO_ROOT,
          encoding: "utf8",
          timeout: GUARD_TIMEOUT_MS - 10_000,
        },
      )
      const output = `${run.stdout}${run.stderr}`

      expect(run.status).toBe(1)
      expect(output).not.toContain("Architecture guard passed.")
      expect(output).toContain(
        `Run event ledger guard self-test: ${total - 2}/${total} fixture cases matched`,
      )
      expect(output).toContain(
        "Run event ledger guard self-test case duplicate-ledger-definition (duplicate-definition) missed nothing and produced unexpected",
      )
      expect(output).toContain(`"${detected.rule}"`)
      expect(output).toContain(
        "Run event ledger guard self-test case clean-owners (clean) missed",
      )
      expect(output).toContain('"appendAgentJobEvent"')
      expect(output).toContain("and produced unexpected nothing")
      // Only the two mutated cases fail; every other case still matches.
      expect(output.match(/guard self-test case /g)).toHaveLength(2)
    },
    GUARD_TIMEOUT_MS,
  )
})
