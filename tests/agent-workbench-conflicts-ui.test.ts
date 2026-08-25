import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"

const workbenchDirectory = "src/renderer/features/agents/workbench"
const taskCardPath = `${workbenchDirectory}/agent-workbench.tsx`
const conflictOwnerPath = `${workbenchDirectory}/workspace-conflict-section.tsx`

function readWorkbenchSources() {
  return readdirSync(workbenchDirectory)
    .filter((fileName) => /\.(?:ts|tsx)$/.test(fileName))
    .map((fileName) => ({
      fileName,
      source: readFileSync(`${workbenchDirectory}/${fileName}`, "utf8"),
    }))
}

describe("agent workbench conflict routing static source guard", () => {
  test("routes overlapping paths through the existing filtered diff state", () => {
    const taskCardSource = readFileSync(taskCardPath, "utf8")
    const conflictOwnerSource = readFileSync(conflictOwnerPath, "utf8")
    const diffViewSource = readFileSync(
      "src/renderer/features/agents/ui/agent-diff-view.tsx",
      "utf8",
    )

    expect(conflictOwnerSource).toContain(
      't("workbench.crossWorkspaceConflicts")',
    )
    expect(conflictOwnerSource).toContain('t("workbench.conflictAnnotation"')
    expect(conflictOwnerSource).toContain('t("workbench.deleteEditConflict"')
    expect(conflictOwnerSource).toContain(
      "onReviewConflicts(reviewConflictPaths)",
    )
    expect(conflictOwnerSource).toContain("paths.add(file.renamedTo)")
    expect(taskCardSource).toContain("<WorkspaceConflictSection")
    expect(taskCardSource).toContain("onReviewConflicts={handleConflictReview}")
    expect(taskCardSource).toContain("setFilteredDiffFiles(filteredFiles)")
    expect(taskCardSource).toContain(
      "setFilteredSubChatId(task.latestSubChat?.id ?? null)",
    )
    expect(taskCardSource).toContain("setSelectedDiffFilePath(null)")
    expect(taskCardSource).toContain(
      "const openDetailsWidget = useOpenDetailsWidget(task.id)",
    )
    expect(taskCardSource).toContain("openWorkbenchDiffSurface({")
    expect(taskCardSource).toContain("openDiffSurface()")
    expect(taskCardSource).not.toContain("conflictDiffFilesAtom")
    const suffixBoundaryExpression =
      "filePath.endsWith(`/" + "$" + "{filterPath}`)"
    expect(diffViewSource).toContain(suffixBoundaryExpression)
    expect(diffViewSource).not.toContain("filterPath.endsWith(filePath)")
    expect(diffViewSource).toContain(
      'from "../../../../shared/unified-diff-parser"',
    )
    expect(diffViewSource).not.toContain("decodeGitPath")
  })
})

describe("agent workbench deep-check invocation static source guard", () => {
  test("invokes deep conflict checks only from the explicit card action", () => {
    const taskCardSource = readFileSync(taskCardPath, "utf8")
    const conflictOwnerSource = readFileSync(conflictOwnerPath, "utf8")
    const handlerStart = conflictOwnerSource.indexOf(
      "const handleDeepCheck = useCallback",
    )
    const handlerEnd = conflictOwnerSource.indexOf(
      "const summary =",
      handlerStart,
    )
    const handlerSource = conflictOwnerSource.slice(handlerStart, handlerEnd)
    const deepCheckIdsStart = conflictOwnerSource.indexOf(
      "const deepCheckTaskIds = useMemo",
    )
    const deepCheckIdsEnd = conflictOwnerSource.indexOf(
      "useEffect(() =>",
      deepCheckIdsStart,
    )
    const deepCheckIdsSource = conflictOwnerSource.slice(
      deepCheckIdsStart,
      deepCheckIdsEnd,
    )
    const tasksQueryStart = taskCardSource.indexOf(
      "const tasksQuery = trpc.agentWorkbench.listTasks.useQuery",
    )
    const tasksQueryEnd = taskCardSource.indexOf(
      "const cliJobsQuery =",
      tasksQueryStart,
    )
    const tasksQuerySource = taskCardSource.slice(
      tasksQueryStart,
      tasksQueryEnd,
    )

    expect(handlerStart).toBeGreaterThan(-1)
    expect(handlerSource).toContain(
      "checkConflictsMutation.mutate({ taskIds: deepCheckTaskIds })",
    )
    expect(
      conflictOwnerSource.match(/checkConflictsMutation\.mutate\(/g) ?? [],
    ).toHaveLength(1)
    expect(conflictOwnerSource).toContain(
      "trpc.agentWorkbench.checkConflicts.useMutation(",
    )
    expect(conflictOwnerSource).toContain("onClick={handleDeepCheck}")
    expect(deepCheckIdsSource).toContain("eligibleDeepCheckTaskIds.filter")
    expect(deepCheckIdsSource).toContain(".slice(0, 9)")
    expect(deepCheckIdsSource).not.toContain("conflicts")
    expect(conflictOwnerSource).toContain(
      "const canDeepCheck = deepCheckTaskIds.length >= 2",
    )
    expect(conflictOwnerSource).toContain("const action = canDeepCheck ? (")
    expect(conflictOwnerSource).toContain("conflictPaths.length > 0 ? (")
    expect(conflictOwnerSource).toContain('t("workbench.deepCheckNoWarnings")')
    expect(conflictOwnerSource).not.toContain(
      "agentWorkbench.checkConflicts.useQuery",
    )
    expect(conflictOwnerSource).not.toMatch(/handleDeepCheck\(\)/)
    expect(taskCardSource).not.toContain(
      "agentWorkbench.checkConflicts.useMutation",
    )
    expect(tasksQuerySource).not.toContain("checkConflicts")
  })
})

describe("agent workbench verdict rendering static source guard", () => {
  test("keeps stale deep-check verdicts readable beside path warnings", () => {
    const source = readFileSync(conflictOwnerPath, "utf8")

    expect(source).toContain("conflictVerdictStalenessLatch.isPairStale(")
    expect(source).toContain("conflictVerdictStalenessLatch.observePair(")
    expect(source).toContain("lastSuccessfulConflictCheck.pairs.map")
    expect(source).toContain("trpcUtils.agentWorkbench.listTasks.invalidate()")
    expect(source).toContain("checkConflictsMutation.error.message?.trim()")
    expect(source).not.toContain("checkConflictsMutation.data &&")
    expect(source).toContain('t("workbench.conflictVerdictStale")')
    expect(source).toContain('t("workbench.pathOverlapWarning")')
    expect(source).toContain('t("workbench.mergeTrialCleanCommittedOnly")')
    expect(source).not.toContain("useEffect(() => handleDeepCheck")
    expect(source).not.toContain("setInterval(handleDeepCheck")
  })

  test("keeps conflict presentation and label logic in one owner", () => {
    const sources = readWorkbenchSources()
    const mutationOwners = sources
      .filter(({ source }) =>
        source.includes("agentWorkbench.checkConflicts.useMutation"),
      )
      .map(({ fileName }) => fileName)
    const hunkLabelOwners = sources
      .filter(({ source }) => source.includes("function getHunkCheckLabel("))
      .map(({ fileName }) => fileName)
    const mergeLabelOwners = sources
      .filter(({ source }) => source.includes("function getMergeTrialLabel("))
      .map(({ fileName }) => fileName)
    const taskCardSource = readFileSync(taskCardPath, "utf8")

    expect(mutationOwners).toEqual(["workspace-conflict-section.tsx"])
    expect(hunkLabelOwners).toEqual(["workspace-conflict-section.tsx"])
    expect(mergeLabelOwners).toEqual(["workspace-conflict-section.tsx"])
    expect(taskCardSource).toContain('from "./workspace-conflict-section"')
    expect(taskCardSource).not.toContain("getHunkCheckLabel")
    expect(taskCardSource).not.toContain("getMergeTrialLabel")
    expect(taskCardSource).not.toContain("lastSuccessfulConflictCheck")
    expect(taskCardSource).not.toContain("createConflictVerdictStalenessLatch")
  })
})
