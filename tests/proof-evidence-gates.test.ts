import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

function runEvidenceGate(scriptPath: string) {
  return spawnSync("node", [scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
}

function read(path: string): string {
  return readFileSync(path, "utf8")
}

describe("OpenSpec proof evidence gates", () => {
  test("package scripts keep proof gates on the main test path", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts["settings-ia:smoke:evidence"]).toBe(
      "node scripts/check-settings-ia-smoke-evidence.mjs",
    )
    expect(packageJson.scripts["mcp-registry:proof:evidence"]).toBe(
      "node scripts/check-mcp-registry-proof-evidence.mjs",
    )
    expect(packageJson.scripts["runtime-control:smoke:evidence"]).toBe(
      "node scripts/check-runtime-control-smoke-evidence.mjs",
    )
    expect(packageJson.scripts.test).toBe("bun test --isolate tests")
    expect(packageJson.scripts.check).toContain("bun run test")
  })

  test("Settings IA manual smoke evidence gate stays enforced", () => {
    const result = runEvidenceGate(
      "scripts/check-settings-ia-smoke-evidence.mjs",
    )

    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")
    expect(result.stdout).toContain("[settings-ia-smoke] evidence status:")
    expect(result.stdout).toContain("[settings-ia-smoke] task 5.6:")
  })

  test("Settings IA gate keeps runbook and task-state safeguards", () => {
    const source = read("scripts/check-settings-ia-smoke-evidence.mjs")

    expect(source).toContain('join(changeDir, "manual-smoke-runbook.md")')
    expect(source).toContain("requiredRunbookMarkers")
    expect(source).toContain(
      "Do not check task 5.6 from source inspection alone.",
    )
    expect(source).toContain("bun test tests/proof-evidence-gates.test.ts")
    expect(source).toContain("task56Checked && notPassed.length > 0")
    expect(source).toContain("!task56Checked && notPassed.length === 0")
  })

  test("MCP registry runtime proof evidence gate stays enforced", () => {
    const result = runEvidenceGate(
      "scripts/check-mcp-registry-proof-evidence.mjs",
    )

    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")
    expect(result.stdout).toContain("[mcp-registry-proof] evidence status:")
    expect(result.stdout).toContain("claude-agent-sdk-mcp-observability")
    expect(result.stdout).toContain("claude-registry-real-run")
  })

  test("MCP registry gate keeps runbook, secret, and task-state safeguards", () => {
    const source = read("scripts/check-mcp-registry-proof-evidence.mjs")

    expect(source).toContain('join(changeDir, "runtime-proof-runbook.md")')
    expect(source).toContain("requiredRunbookMarkers")
    expect(source).toContain("assertNoSecretLikeValues(evidencePath, evidence)")
    expect(source).toContain("assertNoSecretLikeValues(runbookPath, runbook)")
    expect(source).toContain("bun test tests/proof-evidence-gates.test.ts")
    expect(source).toContain("taskIsChecked(tasks, taskId)")
    expect(source).toContain('checkedStatuses: ["passed", "deferred"]')
    expect(source).toContain("statusAllowsCheckedTask")
    expect(source).toContain("checked && !statusAllowsCheckedTask")
    expect(source).toContain("!checked && statusAllowsCheckedTask")
  })

  test("Runtime control desktop smoke evidence gate stays enforced", () => {
    const result = runEvidenceGate(
      "scripts/check-runtime-control-smoke-evidence.mjs",
    )

    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")
    expect(result.stdout).toContain("[runtime-control-smoke] evidence status:")
    expect(result.stdout).toContain("[runtime-control-smoke] task 6.6:")
  })

  test("Runtime control gate keeps evidence and task-state safeguards", () => {
    const source = read("scripts/check-runtime-control-smoke-evidence.mjs")

    expect(source).toContain('join(changeDir, "smoke-evidence.md")')
    expect(source).toContain('join(changeDir, "tasks.md")')
    expect(source).toContain("Provider call authorization: required")
    expect(source).toContain('"claude-plan"')
    expect(source).toContain('"claude-guard"')
    expect(source).toContain("historicalCodexScenarioPrefix")
    expect(source).toContain("unsupported status")
    expect(source).toContain("task66Checked && notPassed.length > 0")
    expect(source).toContain("!task66Checked && notPassed.length === 0")
  })
})
