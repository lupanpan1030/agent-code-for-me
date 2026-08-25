/** Canonical exclusions shared by worktree diffs and conflict annotations. */
export const GIT_DIFF_EXCLUSION_ARGS = [
  ":!*.lock",
  ":!*-lock.*",
  ":!package-lock.json",
  ":!pnpm-lock.yaml",
  ":!yarn.lock",
] as const

export function isGitDiffExcludedPath(path: string): boolean {
  return path.endsWith(".lock") || path.includes("-lock.")
}
