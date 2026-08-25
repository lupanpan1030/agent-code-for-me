import { describe, expect, test } from "bun:test"
import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const CANONICAL_PARSER = "src/shared/unified-diff-parser.ts"
const RETIRED_MAIN_PARSER = "src/main/lib/git/diff-parser.ts"
const RENDERER_CONSUMER = "src/renderer/features/agents/ui/agent-diff-view.tsx"

function sourceFiles(root: string): string[] {
  const files: string[] = []
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(path)
      } else if (isTypeScriptSource(entry)) {
        files.push(relative(process.cwd(), path))
      }
    }
  }

  visit(root)
  return files.sort()
}

function isTypeScriptSource(entry: Dirent): boolean {
  return (
    entry.isFile() &&
    (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
  )
}

describe("unified diff parser ownership", () => {
  test("keeps one shared parser implementation with no retired facade", () => {
    const files = sourceFiles("src")
    const parserDefinitions = files.filter((file) => {
      const source = readFileSync(file, "utf8")
      return /(?:function|const)\s+(?:splitUnifiedDiffByFile|decodeGitPath|validateDiffHunk|hunkHeaderRegex)\b/.test(
        source,
      )
    })
    const legacyImports = files.filter((file) =>
      readFileSync(file, "utf8").includes("git/diff-parser"),
    )
    const duplicateContracts = files.filter((file) => {
      if (file === CANONICAL_PARSER) return false
      return /interface\s+(?:ParsedDiffFile|ParsedDiffResponse)\b/.test(
        readFileSync(file, "utf8"),
      )
    })

    expect(parserDefinitions).toEqual([CANONICAL_PARSER])
    expect(legacyImports).toEqual([])
    expect(duplicateContracts).toEqual([])
    expect(existsSync(RETIRED_MAIN_PARSER)).toBe(false)
  })

  test("makes the renderer consume quoted-path, rename, and hunk behavior directly", () => {
    const canonicalSource = readFileSync(CANONICAL_PARSER, "utf8")
    const rendererSource = readFileSync(RENDERER_CONSUMER, "utf8")

    expect(canonicalSource).toContain("function decodeGitPath")
    expect(canonicalSource).toContain("const hunkHeaderRegex")
    expect(canonicalSource).toContain("hasCompleteRename")
    expect(rendererSource).toContain(
      'from "../../../../shared/unified-diff-parser"',
    )
    expect(rendererSource).not.toContain("function decodeGitPath")
    expect(rendererSource).not.toContain("const hunkHeaderRegex")
    expect(rendererSource).not.toMatch(
      /(?:function|const)\s+splitUnifiedDiffByFile\b/,
    )
  })
})
