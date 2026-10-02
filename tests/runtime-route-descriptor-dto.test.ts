/**
 * Implementer test for refactor-unified-runtime-route-catalog T3-3 (final
 * design review P3-2): the design D2 shared DTO module carries only
 * serializable types, imports nothing from main, and is the one type both the
 * main binding read model and the renderer construction site use for the
 * stamped transportId.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"

const REPO_ROOT = join(import.meta.dir, "..")
const DTO = "src/shared/runtime-route-descriptor.ts"

function read(file: string): string {
  return readFileSync(join(REPO_ROOT, file), "utf8")
}

describe("shared runtime route descriptor DTOs", () => {
  test("the module declares exported types only and has no import", () => {
    const sourceFile = ts.createSourceFile(
      DTO,
      read(DTO),
      ts.ScriptTarget.Latest,
      true,
    )
    expect(
      sourceFile.statements.map((statement) => ({
        kind: ts.SyntaxKind[statement.kind],
        exported: Boolean(
          ts.canHaveModifiers(statement) &&
            ts
              .getModifiers(statement)
              ?.some(
                (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
              ),
        ),
      })),
    ).toEqual([{ kind: "TypeAliasDeclaration", exported: true }])
  })

  test("the main read model and the renderer construction site both type the stamp through it", () => {
    expect(
      read("src/main/lib/agent-runtime/runtime-route-read-model.ts"),
    ).toContain(
      'import type { RuntimeRouteTransportStamp } from "../../../shared/runtime-route-descriptor"',
    )
    const activeChat = read("src/renderer/features/agents/main/active-chat.tsx")
    expect(activeChat).toContain(
      'import type { RuntimeRouteTransportStamp } from "../../../../shared/runtime-route-descriptor"',
    )
    expect(activeChat).toContain(
      "(read.binding as RuntimeRouteTransportStamp).transportId",
    )
    expect(activeChat).not.toContain("transportId?: unknown")
  })
})
