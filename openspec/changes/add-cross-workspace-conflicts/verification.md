# Verification

## 2026-08-13 — Suite progression and specification gates

The host-verified suite stayed at zero failures through every implementation batch and the final
documentation batch:

| Checkpoint | Result | Change from prior checkpoint |
| --- | --- | --- |
| Post-removal baseline | 1378 pass / 0 fail | — |
| Batch 1 — substrate fixes | 1393 pass / 0 fail | +15 tests |
| Batch 2 — fork-commit persistence | 1400 pass / 0 fail | +7 tests |
| Batch 3 — always-on path overlap | 1410 pass / 0 fail | +10 tests |
| Batch 4 — on-demand deep checks | 1430 pass / 0 fail | +20 tests |
| Final docs/spec batch | 1430 pass / 0 fail | no test changes |

That accounts for all 52 tests added after the 1378-test baseline. These progression receipts are
host numbers. Restricted sandboxes can deny loopback/listener operations, so a sandbox result with
that environmental failure must not replace the host receipt. The final docs-only rerun in this
workspace completed without that limitation:

```text
bun run check
Architecture guard passed.
1430 pass
0 fail
7036 expect() calls
Ran 1430 tests across 261 files.
```

Strict OpenSpec validation also passed:

```text
openspec validate add-cross-workspace-conflicts --strict --no-interactive
Change 'add-cross-workspace-conflicts' is valid

openspec validate --changes --strict --no-interactive
Totals: 7 passed, 0 failed (7 items)

openspec validate --specs --strict --no-interactive
Totals: 49 passed, 0 failed (49 items)
```

## 2026-08-13 — Task 6.3 `listTasks` subprocess count

### Source audit and before/after basis

`getDiffSummary` has the same Git invocation sites before and after tier (a): one `git.status()`
call, followed only for a changed Workspace by parallel unstaged and cached `git.diff()` numstat
calls. The feature reads paths from the already-returned `status.files`; conflict aggregation and
status hashing are in-process set/hash work. Comparing the file against `HEAD` shows no added or
changed `git.status()` or `git.diff()` call line. The separate `checkConflicts` mutation owns the
deep-check Git calls and is not reachable from `listTasks`.

The resulting per-Workspace invocation contract is unchanged:

| Workspace summary state | Git subprocesses |
| --- | ---: |
| Changed | 3 (`status`, unstaged numstat, cached numstat) |
| Clean | 1 (`status`) |
| Null `worktreePath` | 0 |

For three changed Workspaces, the source-audited pre-feature count is therefore 9. The empirical
post-feature count below is also 9.

### Throwaway empirical check

A throwaway test created one temporary Git repository and two linked worktrees, producing three
real Workspaces at a common commit. It changed one tracked file in each worktree, registered all
three paths in the repository's in-memory database fixture, imported the real
`agentWorkbenchRouter`, and invoked its `listTasks` summary path. Repository setup used
`/usr/bin/git` directly. During the measured invocation, `PATH` placed this counting shim first:

```sh
#!/bin/sh
printf '%s\n' "$*" >> "${LOCUS_GIT_CALL_LOG:?}"
exec /usr/bin/git "$@"
```

To reproduce the harness without adding a repository file:

1. In a throwaway Bun test, import `createAgentJobTestDb` from
   `tests/helpers/agent-job-test-db.ts` and the production DB schema. Mock `electron`, then mock
   `src/main/lib/db` so `getDatabase` returns that fixture; only after both mocks, dynamically
   import `src/main/lib/trpc/routers/agent-workbench.ts`.
2. Use `/usr/bin/git` to initialize a `main` repository with one committed `shared.ts`, create
   branches `locus/worktree-one` and `locus/worktree-two`, and attach one linked worktree for each.
3. Insert one `projects` row and three `chats` rows. Give each chat its real worktree path, matching
   branch, `baseBranch: "main"`, and a distinct id. Change `shared.ts` once in every worktree.
4. Put the shim above in a temporary `bin/git`, clear its log, and call
   `agentWorkbenchRouter.createCaller({ getWindow: () => null }).listTasks({ filter: "all" })`.
   Count non-empty log lines and inspect the three returned `diff` summaries.
5. Restore `shared.ts` in all three worktrees with `/usr/bin/git`, clear the log, and call the same
   procedure for the clean measurement. Finally set every fixture chat's `worktreePath` to null,
   clear the log, and call it once more for the null-path measurement.

The measured test was invoked as follows (`/tmp` resolves to `/private/tmp` on this host):

```sh
PATH=/tmp/locus-listtasks-count/bin:/usr/bin:/bin:/usr/sbin:/sbin \
LOCUS_GIT_CALL_LOG=/tmp/locus-listtasks-count/git-calls.log \
/opt/homebrew/bin/bun test /tmp/locus-listtasks-count/listtasks-count.test.ts
```

The throwaway test source had SHA-256
`0650d5c34b842f7998443d6e85ba5f3c8d2b6adebab8c11b714ac9217d19ec90`.

The same invocation was repeated after restoring all three worktrees, then after setting all three
`worktreePath` values to null. The measured output was:

```text
dirty: 9 total, 3/workspace
  3 x status --porcelain -b -u --null
  3 x diff --numstat
  3 x diff --cached --numstat
  summaries: fileCount=1, additions=1, deletions=1 for each Workspace

clean: 3 total, 1/workspace
  3 x status --porcelain -b -u --null

null worktreePath: 0 total, 0/workspace
```

The throwaway test itself reported `1 pass / 0 fail / 7 expect() calls`; the repository's focused
`agent-workbench-list-tasks` test reported `4 pass / 0 fail / 29 expect() calls`. No measurement
script was added to the repository. `Promise.all` can reorder log lines, but not their multiset or
count; the shim counts top-level Git executables and does not attempt to count external diff drivers
or hooks.

## 2026-08-13 — Batch 4 empirical `merge-tree` contract

Apple Git 2.50.1 was exercised against temporary committed branches with
`git merge-tree --write-tree --name-only -z -- <left> <right>`:

- a clean committed-tree trial exited 0 and wrote `<tree-sha>\0`
- a content-conflict trial exited 1 with empty stderr and wrote
  `<tree-sha>\0file.txt\0\0` followed by NUL-separated informational tuples
- the first empty NUL field is therefore the boundary between the conflict-path list and messages;
  the parser intentionally stops there
- exit codes other than 0 or 1 are treated as an unavailable/failed trial, not as a conflict

Only Git 2.50.1 was run empirically. Git 2.38 through 2.49 were not available in the batch
environment, so their exact NUL-layout compatibility remains unverified despite the capability
gate accepting versions at or above 2.38.

## Task 6.4 — desktop smoke checklist

Completed by a supervised Codex desktop run on 2026-08-13. The annotation, filtered diff,
committed-only deep verdict, lazy fork-commit backfill, provenance, stale behavior, old-Git
degradation through a live 2.37.0 PATH shim, and both English and Simplified Chinese feature copy
were observed in the running Electron app. The run found and corrected two implementation defects
before passing; full observations are preserved in
`desktop-smoke-evidence.md`.

## 2026-08-13 — Remediation (final review)

| Finding | Disposition |
| --- | --- |
| A — committed-changes blind spot | Fixed: tier-(a) is explicitly status-derived/uncommitted-only, while every eligible branch-mode non-archived sibling set can invoke the deep check without a warning; a committed-only fixture covers the merge-trial verdict. |
| B — staleness blind spots | Fixed: observed status-hash mismatch now latches stale, a successful check refreshes `listTasks`, prior success remains visible while pending, and the presentation/spec state the passive and committed-tree scope honestly. |
| C — missing refs reported as conflicts | Fixed: merge-tree exit 1 with empty stdout is unavailable with `trial-failed`, covered by a deleted-branch fixture. |
| D — same-directory self-conflict | Fixed: tasks with the same resolved worktree path never pair, covered by two chats sharing `project.path`. |
| E — focus-doc marketplace falsehood | Fixed in both mirrors: the shipped runtime-scoped marketplace center remains, while only further expansion is parked. |
| F1 — numstat failure loses paths | Fixed: the already-computed file array survives with null counts and is covered by regression test. |
| F2 — quoted Unicode header paths | Fixed in both parsers: decode first, then strip the `a/` or `b/` prefix; quoted-Unicode coverage added. |
| F3 — unbounded input and identical tips | Fixed: the input is capped at 10 task IDs and equal non-null HEAD tips skip merge trial, both covered. |
| F4 — delete/delete mislabeled | Fixed: all-delete participants produce `delete-delete` with paired English/Simplified Chinese copy and coverage. |
| F5 — hidden deep-check error detail | Fixed: the tRPC error message is shown when available, with generic-copy fallback. |
| F6 — unsafe suffix click-through | Fixed: suffix selection requires a `/` boundary so `nested/README.md` cannot select `README.md`. |
| F7 — archived participation | Fixed: archived tasks may display but never enter the conflict map; coverage added. |
| F8 — lock-file mismatch | Fixed: conflict-map input applies the diff surface's lock-file exclusions without changing `files` or `fileCount`; coverage added. |
| F9 — awkward `n/a` provenance | Fixed: a dedicated short unknown-value key lands in English and Simplified Chinese together. |
| F10 — dead porcelain helper and inaccurate record | Fixed: the production-dead helper/helper-only test are deleted; dated corrections describe the structured simple-git status and count-only numstat mechanism. |
| F11 — unlabeled source-grep tests | Fixed: all three UI source-grep suites identify themselves as static source guards. |

### Specification amendments

- **A2:** `Cross-Workspace Change Aggregation` now owns the committed-changes gap: tier-(a) paths
  are status-derived and cover uncommitted/status-visible work, while a committed-only pair remains
  reachable through the warning-independent deep check.
- **B3:** `Conflict Verdict Honesty` now limits passive staleness to observed status hashes, latches
  a seen mismatch until successful re-run, and requires committed-only scope plus computed-at
  provenance in the verdict presentation.

### Deliberate non-fixes

- **Probe TTL nit — skipped deliberately:** the process-lifetime, one-time cached Git capability
  probe remains the approved design. Detecting a Git binary/version change inside the same running
  desktop process is outside this bounded remediation and does not weaken per-invocation verdict
  classification once the capability is known.
- **No second non-fix:** no other final-review finding or nit in the supplied defect list was
  consciously skipped; every A–E and F1–F11 item above has a remediation disposition.

### Post-remediation acceptance receipt

The final integrated acceptance run completed after every remediation lane landed:

```text
bun run check
Biome reported diagnostics only outside changed lines; ignoring legacy file diagnostics.
Architecture guard passed.
1437 pass
0 fail
7096 expect() calls
Ran 1437 tests across 260 files.
```

The count reconciles exactly from the pre-remediation 1430/0 baseline: deleting the production-dead
`porcelain-paths.test.ts` removed 9 helper-only tests and one test file; the remediation added 16
regression tests in existing test files, for a net `1430 - 9 + 16 = 1437` tests and
`261 - 1 = 260` files. The seven focused conflict/parser/i18n suites also passed independently at
56/0 before the final unrestricted suite itself passed at 1437/0.

Independent integration review found and closed two additional honesty gaps before the final run:
tier-(b)'s current-HEAD gate now applies even when a committed-only pair has no tier-(a) warnings,
and the real committed-only integration test now accepts the specified graceful degradation on a
supported Git older than 2.38 while still requiring a real merge verdict when capability is
available. Numeric and string representations of merge-tree exit code 1 are both covered.

The final strict validation receipts are:

```text
openspec validate add-cross-workspace-conflicts --strict --no-interactive
Change 'add-cross-workspace-conflicts' is valid

openspec validate --changes --strict --no-interactive
Totals: 7 passed, 0 failed (7 items)

openspec validate --specs --strict --no-interactive
Totals: 49 passed, 0 failed (49 items)
```

The final `listTasks` source audit preserves the zero-new-subprocess contract. Eligibility,
archive/path filtering, lock-file filtering, and conflict-map construction are in-process. A dirty
Workspace still invokes only the pre-existing `status` plus unstaged and cached numstat calls (3);
a clean Workspace invokes only `status` (1); a null-path Workspace invokes none (0). HEAD, base,
diff parsing, capability probing, and merge-tree remain reachable only through the explicit
`checkConflicts` mutation.

## 2026-08-13 — Desktop-smoke remediation and final-review follow-up

The supervised desktop run found two real integration defects before task 6.4 passed:

- conflict annotation click-through navigated to the Workspace without opening the current Details
  diff surface; routing now reuses Details on desktop, mobile diff mode on mobile, and full-page diff
  as a non-mobile fallback;
- lazy fork-commit backfill mistook empty output from quiet `rev-parse` as a successful remote-ref
  resolution; ref existence now requires a non-empty resolved commit SHA.

Final review then closed the adjacent historical-source ambiguity. Existing rows do not retain
whether their named base branch was selected locally or remotely. Backfill now considers both
available refs, deduplicates their merge bases, and selects the candidate with the shortest commit
distance to the Workspace HEAD. If distinct candidates are equally close, it persists nothing and
lets tier (b) degrade instead of inventing fork history. Local-only, remote-only, both divergent
directions, equal-distance ambiguity, and router persistence are covered.

The live Git-version degradation run used a fresh process with a PATH wrapper reporting Git 2.37.0.
It preserved the path warning and hunk reason while visibly labeling the merge trial unavailable
because Git 2.38.0+ is required. No main-process exception occurred.

## 2026-08-13 — Final post-smoke acceptance receipt

The full repository gates were rerun on the final working tree after the desktop-smoke fixes,
mobile diff-routing correction, and historical base-ref ambiguity correction:

```text
bun run check
Biome reported diagnostics only outside changed lines; ignoring legacy file diagnostics.
Architecture guard passed.
1444 pass
0 fail
7111 expect() calls
Ran 1444 tests across 261 files.
```

The increase from the earlier 1437/0 receipt is accounted for by one local-only ref regression,
two divergent-ref selection regressions, one equal-distance ambiguity regression, and three
diff-surface routing tests: `1437 + 1 + 2 + 1 + 3 = 1444`.

Final validation receipts:

```text
openspec validate add-cross-workspace-conflicts --strict --no-interactive
Change 'add-cross-workspace-conflicts' is valid

openspec validate --changes --strict --no-interactive
Totals: 7 passed, 0 failed (7 items)

openspec validate --specs --strict --no-interactive
Totals: 49 passed, 0 failed (49 items)

git diff --check
exit 0; no output
```

## 2026-08-25 — Integrated pre-merge hardening

An independent code audit found five integration risks in the otherwise complete change. All were
closed before local merge:

| Finding | Resolution |
| --- | --- |
| Mutable deep-check snapshot / branch refs | Each Workspace is collected as `HEAD-before → diff → HEAD-after`; a changed HEAD fails both deeper tiers closed, and merge-tree receives only captured commit SHAs. A real Git fixture deletes both source branch refs after SHA capture and still produces the expected conflict. |
| Unbounded pair subprocess work | Pair trials default to concurrency 3 (hard maximum 4), a 15-second per-pair timeout, and a 30-second whole-batch deadline. Queued work no longer starts after the deadline; each degradation is machine-readable and visibly localized. |
| Racy lazy fork-commit write | `baseCommit` backfill is now `UPDATE ... WHERE base_commit IS NULL`; a losing caller rereads the stored winner. A barrier-based concurrent test proves one persisted update and a single returned value. |
| UI-only eligibility | Listing and mutation call one canonical validator. The mutation rejects archived, missing, mixed-project, duplicate, branchless/worktree-less, same-directory, and oversized inputs, then checks every registered root before Git IO. |
| Main/renderer parser duplication | Parsing moved to `src/shared/unified-diff-parser.ts`; all callers import it directly, the old main path and renderer implementation are deleted, and a static ownership test forbids regression. |

The unavailable-detail UI was extended in the same batch so snapshot changes, missing captured HEAD,
pair timeout, and batch deadline do not collapse into one opaque failure string in either language.

Targeted verification on the integrated working tree:

```text
bun test --isolate <15 cross-workspace/parser/migration/i18n/config test files>
104 pass
0 fail
455 expect() calls

bun run ts:check
exit 0

bun run architecture:check
exit 0

git diff --check
exit 0; no output
```

The MCP configuration regression test was bracketed with a SHA-256 check of the real
`/home/chen/.codex/config.toml`; the hash remained
`290689036d77458b496c4386c864384aaf7c21975241b6c1c4a7fe49379881d9`, and the test-only
`registry_remote` block was absent before and after. The test now clears/restores ambient
`CODEX_HOME`, so it uses the isolated HOME fixture rather than a real user configuration.

This is a pre-commit receipt only. Exact source SHA, aggregate `check:full`, and both AI verdicts
are appended after the integrated commit; historical 2026-08-13 GUI smoke is retained rather than
misrepresented as a new Linux desktop run.

## 2026-08-25 — Independent integrated-review follow-up

The fresh integrated review reproduced one merge-blocking snapshot bug and identified two adjacent
boundary gaps before the source commit:

| Finding | Resolution |
| --- | --- |
| Old list summary mixed with a newer diff | The router no longer supplies an observed summary to the mutation. `deep-conflicts.ts` owns one prepared snapshot, and path warnings, files/hunks, and fingerprints all derive from that snapshot. A formerly empty list followed by overlapping dirty edits can no longer return `no-overlap`. |
| Request deadline began after preparation | The 30-second deadline now starts at function entry and bounds capability, base-commit, HEAD, summary/raw collection, and merge trials. Injected hangs in each preparation phase return an unavailable verdict rather than leaving the mutation pending. |
| Parser type ownership remained duplicated | `ParsedDiffFile` and `ParsedDiffResponse` are exported only by the canonical shared parser. Shared/renderer consumers reference those types directly, the renderer `as any` bridge is gone, and the static ownership guard rejects copied interfaces. |

The snapshot collector performs two status-summary/raw-diff samples between captured HEAD reads.
If HEAD is stable but dirty content changes between samples, hunk adjudication fails closed with
machine detail `workspace-diff-changed`; the committed-tree trial may still use the stable captured
SHA. `listTasks` and deep checking reuse the same summary collector so a successful unchanged check
does not become stale immediately on refetch.

Post-fix focused receipt:

```text
bun test <deep-conflict, listing, readiness, parser, and i18n regression set>
81 pass
0 fail
333 expect() calls

bun run ts:check
exit 0

bun run architecture:check
exit 0

git diff --check
exit 0; no output
```

The exact committed-source aggregate receipt and fresh Claude Code verdict remain task 9.8.

## 2026-08-25 — Follow-up reviewer remediation

The next focused review closed six additional correctness and resource-boundary gaps without
changing the warning-independent deep-check entry point or the committed-only merge contract:

| Finding | Resolution |
| --- | --- |
| C-quoted binary paths | The canonical shared parser reads a quoted `diff --git` path as one token and decodes it even when a binary patch has no `---`/`+++` headers. Unquoted binary paths containing spaces retain their existing behavior. |
| Diff-entry filter reset | Opening the diff surface now reconciles selection and filtering in one helper. A supplied conflict-review filter wins over an unrelated first parsed file, survives the narrow collapsed layout, and clears when the surface closes. |
| `null → SHA` reported as a moved HEAD | `workspace-head-changed` now requires two successfully captured, non-null, distinct SHAs. A one-sided/missing capture records no fingerprint SHA and degrades hunk/merge evidence with the existing missing-HEAD reasons instead of claiming movement. |
| Unbounded raw diff parsing | Each Workspace raw diff is capped at `2 * 1024 * 1024` UTF-8 bytes. Oversized content is dropped before parsing, hunk evidence fails closed with `workspace-diff-too-large`, path warnings remain available, and a committed-tree trial may continue from stable immutable SHAs. |
| Synchronous parsing could overrun the request | The shared request budget is checked immediately before and after unified-diff parsing. Evidence completed after the deadline is discarded and returned as `batch-deadline-exceeded`. |
| Timed-out Git continued below the promise race | Request-bounded snapshot dependencies now receive an AbortSignal plus remaining timeout. The canonical `createGit` factory preserves its numeric-timeout API while adding opt-in signal and absolute-timeout options; HEAD, status/numstat, and raw worktree diff production paths use those options, and the router forwards the same deadline context. |

The filter-state and parser fixes retain their single canonical owners; no parallel parser, renderer
filter path, or deep-snapshot implementation was introduced. The status-file normalization helper
was placed in the existing Agent Workbench status owner so `workspace-conflict-snapshot.ts` remains
below its architecture size guard.

Focused pre-commit receipt:

```text
bun test --isolate <11 cross-workspace/parser/filter/i18n ownership test files>
87 pass
0 fail
405 expect() calls

bun run lint:changed
Biome reported diagnostics only outside changed lines; ignoring legacy file diagnostics.

bun run ts:check
exit 0

bun run architecture:check
Architecture guard passed.

bun run diff:check
exit 0; no output
```

The deadline regression observes the injected dependency signal transition to aborted; production
HEAD/status/diff wiring uses simple-git's abort plugin plus a non-resetting absolute timeout. This
is still a working-tree receipt. Task 9.8 remains open for the exact committed SHA, aggregate
`check:full`, and fresh-context review; task 9.9 remains open for Owner acceptance and archive.

## 2026-08-25 — Base-commit cancellation follow-up

A subsequent independent review found that the earlier deadline statement was incomplete: the
router forwarded the request budget to HEAD/status/raw-diff operations, but its `ensureBaseCommit`
adapter discarded the callback's second options argument. Lazy fork-commit discovery could
therefore continue below the request race and later persist a result after the response had already
degraded to `batch-deadline-exceeded`.

The remediation keeps one canonical backfill path:

- the production router now passes `signal` and the remaining `timeoutMs` into
  `ensureChatBaseCommit`;
- local/remote merge-base reads and commit-distance ranking use canonical `createGit` with that
  signal, timeout, and a non-resetting absolute timeout;
- the canonical local-ref probe accepts and applies the same options through `createGit`;
- the backfill owner checks cancellation after awaited discovery/ranking and immediately before
  its compare-and-set, so a dependency that deliberately ignores abort cannot cause a late durable
  write.

Focused working-tree receipt:

```text
bun test --isolate tests/chat-base-commit.test.ts \
  tests/agent-workbench-deep-conflict-ownership.test.ts \
  tests/agent-workbench-deep-conflicts.test.ts \
  tests/agent-workbench-list-tasks.test.ts
57 pass
0 fail
245 expect() calls

bun run ts:check
exit 0

bun run architecture:check
Architecture guard passed.

DIFF_BASE_SHA=df72d425ea9c7e404a568a4c93c26f3792074ad0 bun run lint:changed
Biome reported diagnostics only outside changed lines; ignoring legacy file diagnostics.

bun run diff:check
exit 0; no output

bun x openspec validate add-cross-workspace-conflicts --strict --no-interactive
Change 'add-cross-workspace-conflicts' is valid

bun x openspec validate --changes --strict --no-interactive
5 passed, 0 failed

bun x openspec validate --specs --strict --no-interactive
49 passed, 0 failed
```

This is still a working-tree receipt. Task 9.8 remains the exact-source full gate and fresh-review
gate; any later code change invalidates technical verdicts until they are rerun on one source SHA.

## 2026-08-26 — Frozen-source implementation verification

- Frozen source SHA: `bdd2e2e57143a69f86f34ed96f84aa9a5e076fd4`
- Branch: `codex/remove-experimental-runtimes`
- Verified at: `2026-08-26 04:20:58 NZST (+1200)`
- Batch scope: `add-cross-workspace-conflicts`,
  `add-headless-provider-binding`, `add-remote-model-catalog`, and
  `add-local-job-api-runtime-readiness`
- The worktree was clean and `HEAD` still resolved to the frozen source SHA
  before and after the exact-source gates and smokes.
- `/home/chen/.codex/config.toml` remained unchanged at SHA-256
  `290689036d77458b496c4386c864384aaf7c21975241b6c1c4a7fe49379881d9`.

Exact-source full gate:

```text
bun run check:full
exit 0
lint:changed passed
architecture guard passed
retired-runtime residue check passed (1565 files scanned, 10 allowlisted)
TypeScript passed
1642 tests passed, 0 failed, 7921 assertions, 278 files
OpenSpec strict validation: 54 passed, 0 failed
production Electron/Vite build passed
diff check passed
```

The build emitted only the existing dynamic-import/chunk, non-module script,
and stale Browserslist-data warnings; none was a failing gate.

The same clean frozen source also passed both built-Electron integration
smokes on Linux. `scripts/smoke-headless-provider-binding.cjs` exited 0 for the
profile and native Codex paths, preserved the one-request routing contract,
and passed all scoped/ambient secret checks.
`scripts/smoke-headless-claude-credential-source.cjs` exited 0 for app-only,
CLI-only, both, and neither credential rows; the expected outcomes were
respectively success/app, success/CLI, success/app precedence, and
`runtime_auth_required` exit 4. Its Career Kit consumer smoke also succeeded
with one `locus-ai` draft entry. The Linux harness used an isolated Xvfb
display and temporary Secret Service; no real account, external model,
billable request, or persistent user credential was used.

Platform coverage note: descriptor-backed stable-directory behavior was
exercised through Linux `/proc/self/fd`. The Darwin `/dev/fd` anchor remains a
macOS smoke boundary; unsupported platforms fail closed and do not fall back
to a path-based business implementation.

### Verdict state

- Codex implementation verdict for the frozen source:
  **`IMPLEMENTATION_VERIFIED`**
- Claude Code independent fresh-context verdict: **pending**;
  `REVIEW_APPROVED` is not asserted here.
- Owner acceptance: **pending**.
- Local merge and archive: **not performed**.
- Push, remote PR mutation, release, and all other remote operations:
  **not authorized and not performed**.

## Independent review — fresh-context Claude Code (2026-08-26)

- Source SHA under review: `bdd2e2e57143a69f86f34ed96f84aa9a5e076fd4` (worktree at review time: `f9a16c70`, which differs from the source SHA by evidence-docs commits only).
- Review mode: read-only fresh-context review subagent dispatched by the Claude Code coordination session; implementation context not reused; no product files edited during review; working tree confirmed clean after any spot-run tests.
- Cross-cutting security pass over the same SHA: `REVIEW_APPROVED` (full record: `openspec/changes/add-headless-provider-binding/verification.md`).
- Verdict: **`REVIEW_APPROVED`** for `bdd2e2e57143a69f86f34ed96f84aa9a5e076fd4` — zero P0/P1/P2 findings. Technical verdict for this exact SHA only; it does not constitute Owner product acceptance and does not authorize push, remote PR mutation, remote merge, release, or repository-rules changes. Any subsequent code change to the source invalidates this verdict.
- P3 notes (non-blocking, recorded for follow-up triage):
  - `openspec/changes/add-cross-workspace-conflicts/desktop-smoke-evidence.md` — Desktop GUI smoke evidence predates the 9.x cancellation/determinism hardening. The only recorded desktop-smoke run (including the git-version-degradation PATH-shim scenario) is dated 2026-08-13, before commits 50337646 (deterministic deadlines), 1d4be1a1, and bdd2e2e5 (task 9.12 base-commit cancellation fix) landed. verification.md is transparent about this (explicitly says historical smoke is retained rather than re-labeled, and defers the exact-SHA full gate/smoke to task 9.8/9.9), so this is disclosed rather than hidden. The narrow deadline/cancellation changes are covered by strong targeted unit/integration tests (spot-verified: 57/57 pass in tests/chat-base-commit.test.ts + agent-workbench-deep-conflict*.test.ts, and 15/15 + 9/9 in the original smoke-defect regression set), so this is a low-risk gap, not a correctness defect. Recommend a fresh GUI smoke pass (or at least the git-version-degradation and deep-check-cancellation scenarios) before/around task 9.9 owner acceptance, since that is the only path that exercises the real Electron main-process timers/AbortController plumbing end-to-end.
  - `src/main/lib/agent-workbench/merge-tree.ts` — probeMergeTreeCapability caches a failed/old-git probe for the process lifetime. createMergeTreeCapabilityProbe memoizes the first result of `git --version` indefinitely (module-level `probeMergeTreeCapabilityOnce`). If the probe races a transient PATH/env issue at first use, or if the user upgrades git mid-session, tier-(c) merge-tree trials will stay degraded (or stay enabled after a downgrade) until app restart. This is a reasonable, intentional perf trade-off given git version rarely changes mid-session, and the UI clearly labels 'committed changes only' / unavailable states, so it's not blocking — flagging for awareness only.

### Reviewer summary

Reviewed the cross-workspace conflict adjudication stack at bdd2e2e57143a69f86f34ed96f84aa9a5e076fd4 (openspec/changes/add-cross-workspace-conflicts), scoped via `git log main..bdd2e2e5` and the relevant commits (3eda17e8 feature landing, 50337646 deterministic-deadline fix, bdd2e2e5 base-commit cancellation hardening / task 9.12).

Verified in code:
- conflicts.ts is pure computation (path-overlap tier, admission validator `validateAgentWorkbenchDeepCheckCandidates`, eligible-sibling computation) with zero git subprocess calls, matching its documented contract.
- deep-conflicts.ts is the sole facade re-exporting types/functions from hunk-conflicts.ts, merge-tree.ts, workspace-conflict-snapshot.ts, deep-conflict-deadline.ts — matches docs/OWNERSHIP_MAP.md's described split.
- deep-conflict-deadline.ts's 50337646 fix (resolve(OPERATION_TIMED_OUT) before controller.abort(), floor→ceil for timeout scheduling) is correct: resolving before abort ensures the timeout-provenance microtask is queued first, so Promise.race deterministically reports timeout rather than a generic abort-triggered fallback.
- workspace-conflict-snapshot.ts implements the HEAD-before → summary/raw double-sample → HEAD-after protocol carefully, fails closed (`snapshotUnavailableDetail`) on deadline exhaustion, oversized diffs (2 MiB cap), and dirty-state drift, and discards synchronously-parsed evidence that crosses the deadline.
- chat-base-commit.ts (bdd2e2e5 / task 9.12): the production router (agent-workbench.ts:373) now forwards `{signal, timeoutMs}` into `ensureChatBaseCommit`; `resolveBackfillBaseCommit` checks `options.signal?.aborted` before/after every awaited step and again immediately before the compare-and-set write, so a dependency that ignores abort and resolves late cannot durably persist a stale base commit. `getMergeBase`/`getCommitDistance`/`refExistsLocally` route through canonical `createGit` with the request signal + remaining timeout + `absoluteTimeout: true`. Confirmed with a direct test read (tests/chat-base-commit.test.ts:509-555) that asserts zero DB writes and a null `baseCommit` after cancellation with a deliberately-late dependency.
- Migration 0022 (`ALTER TABLE chats ADD base_commit text`, nullable) is a safe additive migration; drizzle journal/snapshot updated consistently; lazy CAS backfill (`WHERE id=? AND baseCommit IS NULL`) correctly handles concurrent callers.
- unified-diff-parser.ts: single-owner guard test (tests/unified-diff-parser-ownership.test.ts) passes; grep confirms no duplicate `ParsedDiffFile`/`ParsedDiffResponse` definitions and no lingering `git/diff-parser` imports; the old `src/main/lib/git/diff-parser.ts` is deleted.
- checkConflicts tRPC input is validated server-side (`z.object({ taskIds: z.array(...).min(2).max(10).refine(unique) })`), and the mutation independently re-validates project/branch/worktree/archived/shared-directory eligibility plus `assertRegisteredWorktree` (fail-closed, DB-registration-based) before any Git IO — consistent with task 9.4's claim.
- merge-tree.ts's git-version gating (`MERGE_TREE_MINIMUM_VERSION = 2.38.0`, `parseGitMergeTreeCapability`) matches the desktop-smoke-evidence.md's PATH-shim 2.37.0-degradation narrative (labeled 'git-too-old', surfaced without throwing).
- No console/logger calls anywhere in the reviewed agent-workbench conflict files or chat-base-commit.ts — no diff/path/secret leakage risk in this stack. This feature is pure local-git computation with no hosted/credential surface, so local-vs-hosted capability boundaries don't apply.
- Renderer state (conflict-verdict-state.ts staleness latch, diff-surface-routing.ts, workspace-conflict-section.tsx React Query mutation + local component state) is straightforward, correctly resets staleness only on successful re-run, and refetches `listTasks` before rendering a fresh verdict — matches task 4.3/7.2's design intent.

Findings: none rise to P0/P1. Two P3 observations noted above (stale GUI smoke relative to the latest cancellation/determinism hardening — though explicitly disclosed in verification.md; and indefinite in-process caching of the merge-tree capability probe).

Verification performed:
- `bun test --isolate tests/chat-base-commit.test.ts tests/agent-workbench-deep-conflict-ownership.test.ts tests/agent-workbench-deep-conflicts.test.ts tests/agent-workbench-list-tasks.test.ts` → 57 pass / 0 fail / 245 expect() calls, exactly matching the receipt claimed in verification.md's 2026-08-25 base-commit cancellation follow-up section.
- `bun test --isolate tests/unified-diff-parser-ownership.test.ts tests/agent-workbench-conflicts.test.ts tests/agent-workbench-conflicts-ui.test.ts tests/agent-workbench-diff-surface-routing.test.ts tests/diff-open-filter-state.test.ts tests/db-migrations.test.ts tests/chat-create-base-commit.test.ts` → 28 pass / 0 fail / 108 expect() calls.
- `bun run ts:check` → exit 0 (no diagnostics).
- `bun run architecture:check` → "Architecture guard passed."
- `git status --porcelain` before and after all test runs → clean (no dirtying).
- Read-only source inspection of conflicts.ts, deep-conflicts.ts, deep-conflict-deadline.ts, merge-tree.ts, hunk-conflicts.ts, workspace-conflict-snapshot.ts, deep-conflict-types.ts, chat-base-commit.ts, agent-workbench.ts (router), conflict-verdict-state.ts, diff-surface-routing.ts, workspace-conflict-section.tsx, diff-open-filter-state.ts, path-validation.ts, drizzle/0022_*.sql, and docs/OWNERSHIP_MAP.md's Agent Workbench Conflict Adjudication section.
- Did not run `bun run check:full` (build) given its cost and read-only-review scope; ts:check + architecture:check + targeted test files were used as a proportionate spot-check instead, and all matched the verification.md claims exactly.

No product/Owner acceptance is implied by this verdict — it is a technical review of source SHA bdd2e2e57143a69f86f34ed96f84aa9a5e076fd4 only, per AGENTS.md's independent-review role.
