import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const source = readFileSync(
  new URL(
    "../src/renderer/components/dialogs/settings-tabs/agents-project-worktree-tab.tsx",
    import.meta.url,
  ),
  "utf8",
)

describe("worktree config save targets", () => {
  test("offers only Locus and Cursor write targets", () => {
    const selectTargets = Array.from(
      source.matchAll(/<SelectItem value="([^"]+)"/g),
      (match) => match[1],
    )

    expect(selectTargets).toEqual(["locus", "cursor"])
    expect(source).toContain('useState<"locus" | "cursor">("locus")')
    expect(source).not.toContain('saveTarget === "1code"')
    expect(source).not.toContain(
      'setSaveTarget(v as "locus" | "cursor" | "1code")',
    )
  })

  test("loads a legacy source visibly but routes later saves to Locus", () => {
    expect(source).toContain(
      'configData.source === "cursor" ? "cursor" : "locus"',
    )
    expect(source).toContain('configData?.source === "1code"')
    expect(source).toContain('data-config-source="1code"')
    expect(source).toContain(".1code/worktree.json")
    expect(source).toContain(
      "saveMutation.mutate({ projectId, config, target: saveTarget })",
    )
    expect(source).toContain(
      'const isLegacyReadSource = configData?.source === "1code"',
    )
    expect(source).toContain('t("settings.projects.saveStatusLoadedFrom"')
    expect(source).toContain("statusConfigPath = isLegacyReadSource")
    expect(source).toContain("await refetchConfig()")
  })
})
