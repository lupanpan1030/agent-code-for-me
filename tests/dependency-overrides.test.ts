import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = join(__dirname, "..")

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf-8")
}

describe("dependency override security notes", () => {
  test("documents manually maintained Bun override pins", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>
      overrides?: Record<string, string>
    }
    const projectMap = read("PROJECT-MAP.md")

    expect(packageJson.dependencies.dompurify).toBe("^3.4.11")
    expect(packageJson.dependencies.mermaid).toBe("^11.16.0")
    expect(packageJson.dependencies["simple-git"]).toBe("^3.36.0")
    expect(packageJson.overrides).toMatchObject({
      dompurify: "3.4.11",
      uuid: "11.1.1",
    })

    expect(projectMap).toContain("2026-07-03 依赖追记")
    expect(projectMap).toContain("top-level `overrides` 是 Bun 生效")
    expect(projectMap).toContain("必须手动更新 override pin")
  })
})
