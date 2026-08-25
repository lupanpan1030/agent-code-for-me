# Desktop smoke evidence

## 2026-08-13 — Task 6.4 supervised desktop run

Result: **PASS after two implementation defects found by the smoke were fixed and re-tested.**

The Electron development app was run in local-only mode with the seeded `CWC Smoke` project and
two linked worktrees. The final verification run used a temporary user-data directory copied from
the dev database so application settings and test writes stayed isolated:

```text
LOCUS_LOCAL_ONLY=1 AGENT_CODE_FOR_ME_LOCAL_ONLY=1 ONECODE_LOCAL_ONLY=1 \
MAIN_VITE_LOCAL_ONLY=1 VITE_LOCAL_ONLY=1 \
LOCUS_USER_DATA_DIR={temporary-user-data} bun run dev
```

Startup reached the renderer without hosted login. Drizzle migration 0022 completed, the database
initialized, and no migration error dialog appeared.

### Fixture verification and correction

The supplied scratch fixture did not initially match its prompt: `shared.ts` had been committed in
both branches, leaving both worktrees clean. Before evaluating the product, the scratch fixture was
corrected so each branch retained its committed `conflict.ts` change while `shared.ts` was restored
at the branch tip and edited differently as an uncommitted change in each worktree. The resulting
state was one uncommitted `shared.ts` per worktree plus the committed divergent `conflict.ts` pair.
Only scratch fixture data was changed.

### Observations

1. **Tier-(a) annotation and unchanged taxonomy — PASS.** Within one Agent Workbench refresh, both
   `Workspace A` and `Workspace B` remained `Needs review`; the `Needs review` filter count remained
   2. Both cards rendered `Cross-Workspace Conflicts` / `跨工作区冲突`, reported one overlapping
   file, and named the sibling Workspace. No conflict status or filter was introduced.
2. **Filtered diff click-through — PASS after fix.** The first live attempt navigated to Workspace A
   but failed to open a diff surface. The workbench callback only toggled the legacy diff sidebar,
   while the current desktop presentation used the Details widget. The implementation now opens the
   canonical Details diff widget and falls back to full-page diff when that widget is unavailable.
   Re-test opened Workspace A's existing `Changes` surface with exactly one selected file,
   `shared.ts`; `conflict.ts` was absent.
3. **Explicit deep check and independent tiers — PASS after fix.** `Deep check` remained visible on
   both cards and visibly entered `Checking...` / `检查中...`. The first run found the committed
   conflict but showed a missing fork-commit reason and left both `base_commit` rows NULL. Diagnosis
   showed that quiet `rev-parse` returned empty output for missing `origin/main`, which the shared
   ref helper incorrectly treated as success. After validating non-empty resolved-ref output, a
   clean re-run lazily stored the shared fork SHA `2c01c1a…` for both chats. The verdict then showed:
   `shared.ts · Path-overlap warning · Edit vs edit`, hunk checking unavailable because current HEAD
   commits differ, and `Committed changes only: merge trial found conflicts in conflict.ts`.
   The uncommitted `shared.ts` annotation remained visible.
4. **Provenance and staleness — PASS.** The result showed computed time plus Workspace A at
   `b29a100` and Workspace B at `4c56734`. Adding a new uncommitted file to one worktree and pressing
   Refresh preserved that exact prior result and provenance, added `Stale — Workspace state
   changed` / `已过期 — 工作区状态已改变`, and did not enter `Checking...`; no silent re-run occurred.
5. **English and Simplified Chinese presentation — PASS.** In English, the annotation, `Deep check`,
   `Checking...`, path warning, different-HEAD reason, committed-only merge result, computed
   provenance, and stale copy all rendered without raw translation keys. In Simplified Chinese,
   the corresponding visible strings were `跨工作区冲突`, `深度检查`, `检查中...`, `路径重叠警告`,
   `无法检查区块：工作区的当前 HEAD 提交不同`, `仅限已提交的改动：合并试验在 conflict.ts 中发现冲突`,
   `计算于`, and `已过期 — 工作区状态已改变`; there was no English fallback in those feature-owned
   strings. Workspace and fixture names remained their stored English data.
6. **Git-version degradation — PASS in a live PATH-shim run.** A fresh desktop process was started
   with a temporary `git` wrapper that reported `git version 2.37.0` for `--version` and delegated
   every other Git command to `/usr/bin/git`. The explicit deep check retained the `shared.ts`
   path warning and hunk-tier result, skipped the merge trial, and visibly rendered `Merge trial
   unavailable: Git 2.38.0+ is required (detected 2.37.0)`. It still showed computed-at Workspace
   provenance and did not throw. Unit tests separately cover unparseable and unavailable probes.
7. **Main-process stability — PASS.** The dev console was observed throughout startup, navigation,
   both deep checks, refreshes, and language switching. There was no unhandled main-process
   exception. Normal development output included Vite bundle warnings, a login-shell timeout with
   fallback environment, and zero configured MCP servers; none interrupted the flow.

### Focused defect verification

```text
bun test --timeout 15000 tests/chat-base-commit.test.ts \
  tests/agent-workbench-diff-surface-routing.test.ts \
  tests/agent-workbench-conflicts-ui.test.ts

15 pass
0 fail
67 expect() calls

bun test --timeout 15000 tests/agent-workbench-list-tasks.test.ts

9 pass
0 fail
50 expect() calls

bun run ts:check
exit 0
```

The regression coverage now includes local-only and remote-only bases, divergent local/remote
candidates in both directions, an ambiguous equal-distance case that degrades without persisting,
router-level lazy backfill for both committed-only workspaces, and the Details/mobile/full-page
diff-surface routing contract. The desktop Details path was observed live; the mobile path was
exercised at the routing boundary rather than through a resized desktop window.

### Cleanup

The app was stopped before cleanup. Exact seeded rows were removed from the original dev database
and verified absent. The exact scratch fixture, isolated temporary user-data directory, and old-Git
shim were moved to Trash for recoverability; no credentials were copied into the isolated profile
and no fixture or temporary path is part of the repository.
