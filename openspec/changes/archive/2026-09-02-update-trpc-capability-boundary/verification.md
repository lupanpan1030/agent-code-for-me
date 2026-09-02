# Verification: 2026-09-02 rebaseline and archive gate

## Scope and authority

- Owner approved D1-D6 on 2026-09-02.
- The pre-archive rebaseline is documentation/spec-only and changes only
  `openspec/changes/update-trpc-capability-boundary/**` before the archive gate.
- After normal archive, task 5.6 authorizes only the mechanical STATUS/TICKET and archived-receipt
  closeout. No product code, public API, remote branch, pull request, release, or repository rule
  is changed. No push or other remote operation is authorized.
- The change must not be archived until a fresh Claude multi-perspective review and Owner
  `ACCEPTED` are recorded against the frozen source SHA.
- Owner D3 is resolved with the no-GUI branch: packaged production CSP smoke and development
  CSP/HMR smoke remain historical statements with no receipt and are not certified here.

## Certified rebaseline scope

This change certifies only:

- Phase 1 tasks 1.1-1.9 as narrowed in the rewritten requirement text;
- Phase 2 tasks 2.1, 2.1a, and 2.5;
- Phase 3 task 3.3a, renamed to the bounded MCP stdio native-consent requirement.

The delta contains six ADDED requirements and 18 scenarios. Follow-up A owns remaining renderer/
webview/desktop-smoke work. Follow-up B owns general capability taxonomy, wrappers, non-MCP
consent, audit, kill-switches, bare-procedure enforcement, and terminal-input capability. The
inherited runtime MCP `projectPath` residual is excluded from the certified R3 text. Parent-
directory symlink escape for lexical rename/delete targets is excluded from R2. Remembered MCP
stdio approval is not claimed to bind `projectPath`.

## Step 0 and pre-freeze refresh

- Audit timestamp: `2026-09-02T18:07:35+12:00` (Pacific/Auckland).
- Audited source: `d77a4b48e8d60cdaf20b8ae02d5df9482239e24a` on local `main`.
- Initial worktree: clean; local `main` was one commit ahead of `origin/main`. No fetch, pull,
  push, or other remote operation was performed.
- Three independent read-only audits covered code anchors, tests, and OpenSpec aggregates before
  any package edit.
- Two additional read-only pre-freeze reviews challenged the rewritten claims against current
  code. Their R1 completeness, R2 symlink, file-level HTML guard, Claude ignore-vs-reject, and
  anchor corrections were applied before the source commit.

### Stale or over-broad plan items corrected

| 2026-08-26 plan claim | Current-main finding | Rebaseline correction |
| --- | --- | --- |
| Baseline was `4c5d78ba`. | Current requested baseline is `d77a4b48`; 1a/1b/1c/#18 are integrated. | Every implementation statement and receipt is rebound to current main. |
| R1's broad procedure inventory and dangerous-input guard amounted to a complete privileged-route inventory. | The mechanical guard detects only 12 exact schema field names. The reviewed design inventory is operation-cluster level; privileged lifecycle/setup/scope procedures can be effectful without those fields. The 50-entry allowlist itself is not exact/live because it contains a stale entry. | R1 now requires matching procedure-keyed field allowlisting for detected enumerated fields plus a reviewed operation-cluster inventory. Procedure-complete capability taxonomy and stale-entry enforcement remain follow-up B. |
| 32 mounted routers and 41 files. | There are 42 `.ts` files including `index.ts`, 41 router modules excluding it, and 33 mounted namespaces including `changes`. | Proposal/design/tasks use 41 modules + index / 33 mounts. |
| Dangerous-input guard was at `:755-1460` with about 68 allowlist entries. | Field set is `:2105-2118`; allowlist `:2120-2517`; self-test `:2732-2756`; assertion `:2758-2790`; main call `:4218`. There are exactly 50 declared entries. | All anchors/counts are refreshed. Follow-up B starts from the post-1c layout. |
| The guard/1c ratchet implied an only-shrink live allowlist. | One declared entry, `agent-runtime.ts:chat`, is stale; the guard does not reject stale entries or mechanically enforce only-shrink behavior. | Verification distinguishes the current input-field guard from future capability/ratchet work. |
| Runtime preflight implementation was `claude.ts:105`; `agentRuntime.chat` was an implemented route. | Resolver owner is `agent-runtime/preflight.ts:162-170`; Claude calls it at `claude.ts:120-123`. Experimental `agentRuntime.chat` was removed by `79417d18`. | R3/task 1.4 names Claude and Codex only and removes the experimental route claim. |
| R2 applied to every renderer-reachable filesystem target and rejected symlink escape for rename/delete. | Covered files/components/terminal/config routes are hardened, but e.g. `external.openInApp/openFileInEditor` still accept renderer path/cwd inputs. Reads/listing use real-path checks; rename/delete use lexical `resolvePathWithinRoot`, so a parent-directory symlink can escape the real root. | R2 is limited by sink class: real-path guarantees for reads/listing, symlink omission for search, registered root for watch, and lexical containment/traversal/null-byte/replacement checks for rename/delete. The write-path symlink residual is not certified. |
| R3 said cwd, project path, permission context, and project-scoped configuration were all server-derived. | Execution cwd is server-resolved, but renderer `input.projectPath` still participates in Claude/Codex runtime MCP lookup. This inherited P3 is already recorded in the 1b verification against TICKET-101/104. | R3 certifies server-resolved Claude/Codex cwd and terminal cwd/intents only; the residual is a routing record, not a completed task. |
| R6 said markdown raw HTML never passes through or gets inserted. | Streamdown 2.1.0 sanitizes/hardens raw HTML: safe elements may remain; active/scriptable content is removed. | R6 now requires sanitizer/hardener passage and active-content removal, not blanket raw-HTML removal. |
| `renderer-html-sinks.test.ts` proved markdown raw-HTML behavior or every HTML insertion surface. | Its three tests prove the five-file React `dangerouslySetInnerHTML` inventory, Mermaid sanitizer wiring, and four Shiki-backed file records; an allowed file can gain another insertion without changing the set. It does not scan direct `.innerHTML` assignments (for example mentions-editor undo/redo at `:991,1019`) or render-test Streamdown raw HTML. | The file-level source-guard proof and dependency behavior are stated separately; per-insertion, direct-DOM inventory, and direct sanitizer regression coverage remain follow-up A gaps. |
| Follow-up A said local browser had no navigation or partition policy. | Main-frame navigation/window-open guards and local-browser URL policy plus per-chat non-persistent partition already exist. Permission handlers, guest attach/window-open controls, bridge/preload isolation proof, JavaScript-surface audit, and desktop smoke remain absent. | Follow-up A is expressed as incremental guest hardening on the existing controls. |
| Follow-up A assumed an unsafe chat HTML export preview. | Current export supports only `json`, `markdown`, and `text`, using text download/clipboard paths; no HTML preview surface was found. | Follow-up A must re-enumerate sinks instead of asserting this surface exists. |
| General capability decisions were implemented or absent without qualification. | No unified tRPC capability wrapper/meta, decision layer, audit owner, or kill-switch exists; MCP stdio has its own implemented native-consent gate. | D1 narrows R5 to MCP stdio only; the unified layer goes to follow-up B. |
| MCP stdio fingerprint memory was project-bound or fully dimension-tested. | The hash includes runtime, name, scope, command, args, env, env-var refs, and cwd, but intentionally excludes `projectPath`; retained tests prove command-change re-prompting, not every individual dimension. | R5 states the implemented fingerprint behavior without claiming project binding or exhaustive dimension tests. Project identity/revocation semantics are an explicit follow-up B question. |
| The original ten targeted files were the full implementation inventory. | All ten still exist, but eight directly relevant files were omitted or added by 1a/1b/#18. | The exact-source receipt uses 18 files. |
| CSP tasks 4.4/4.5 were completed evidence. | The change had no `verification.md`, no smoke receipt/runbook was found, and this WSL2 host has no usable GUI session. | They are non-checkbox historical statements with no receipt and an Owner-directed future TICKET-114 destination. |
| Living `runtime-security-baseline` had eight requirements. | It has 9 requirements / 17 scenarios. | Normal archive is expected to produce 15 requirements / 35 scenarios. |
| Aggregate/archive counts were 52/52 and 102/108, with 103/109 expected after archive. | Baseline is changes 2/2, specs 52/52, all 54/54, archived 106 passed / 6 failed / 112 total. | Expected post-archive: changes 1/1, specs 52/52, all 53/53, archived 107 passed / 6 failed / 113 total. |
| `PROJECT-MAP.md` could serve as the refreshed code-anchor inventory. | It preserves useful historical commit narratives, but still says 32 mounts and carries old Claude route/preflight anchors and reject semantics. | This package records refreshed anchors locally; the shared map is historical supporting evidence only and is not edited in this phase. |

The six archived failures are pre-existing debt and contain 59 unfinished checkbox tasks:

- `2026-06-06-add-claude-dynamic-workflows-adapter` (32);
- `2026-06-17-refactor-fork-saas-residue` (1);
- `2026-06-17-remove-dead-settings-state` (1);
- `2026-06-19-refactor-runtime-mcp-config-service` (1);
- `2026-06-22-add-codex-app-server-mcp-tool-observability` (21);
- `2026-06-24-add-model-aware-image-gating` (3).

Their aggregate exit 1 is expected and must not be reported as this change failing. After archive,
this change itself must appear as passing while the same six old debts remain.

## Refreshed implementation anchors

| Boundary | Current source anchor | Current test evidence |
| --- | --- | --- |
| Registered roots and path containment | project/chat/file roots `src/main/lib/fs/registered-roots.ts:50-144`; component roots `:146-231`; lexical boundary `src/main/lib/fs/path-boundary.ts:35-62` | `registered-roots` 9; `trpc-path-boundaries` 9; `claude-component-boundaries` 4; `project-registry` 8 |
| Runtime cwd | `src/main/lib/agent-runtime/preflight.ts:162-170`; Claude resolves/ignores renderer cwd at `src/main/lib/trpc/routers/claude.ts:120-123`; Codex verifies/rejects mismatch at `src/main/lib/trpc/routers/codex.ts:513-518` | `agent-runtime-preflight` 9; `codex-desktop-run-preflight` 5; `desktop-run-binding-admission-order` 6; `codex-desktop-service-boundary` 3 |
| Terminal boundary | `src/main/lib/trpc/routers/terminal.ts:25-55,157-167`; `src/main/lib/terminal/trusted-session-input.ts:17-105` | `terminal-create-session-boundary` 11 |
| GitHub clone | `src/main/lib/projects/github-clone.ts:52-117`; route `src/main/lib/trpc/routers/projects.ts:249-276` | `github-clone-boundary` 3 |
| MCP/provider validation and stdio trust | normalization/fingerprint/approval `src/main/lib/runtime-mcp-config/mcp-command-trust.ts:42-157`; dialog/write gate `:216-262` | `mcp-config-boundaries` 7; `local-api-provider-config-security` 3; `mcp-registry-service` 12; `runtime-mcp-config-service` 14 |
| Renderer CSP | `src/main/windows/renderer-csp.ts:12-29,39-61,70-107`; install `src/main/windows/main.ts:482-487` | `renderer-csp-policy` 7 |
| Mermaid, subtitle, and HTML sinks | `src/renderer/lib/security/mermaid-svg-sanitizer.ts:1-99`; `src/renderer/components/mermaid-block.tsx:146,257,481,558`; `src/renderer/features/agents/ui/agent-tool-call.tsx:33-58`; sink guard `tests/renderer-html-sinks.test.ts:27-68` | `renderer-mermaid-xss` 2; `renderer-agent-tool-call-xss` 2; `renderer-html-sinks` 3 |
| Dangerous router inputs | exact 12-field set `scripts/check-architecture-guards.mjs:2105-2118`; 50-entry declarations `:2120-2517`; self-test/assertions `:2732-2810`; invocation `:4218` | `bun run architecture:check` self-test/package-chain gate; no claim of nested/aliased fields, stale-entry rejection, or procedure-complete classification |

## Targeted test inventory

The 18-file receipt command is:

```bash
bun test --isolate \
  tests/registered-roots.test.ts \
  tests/trpc-path-boundaries.test.ts \
  tests/claude-component-boundaries.test.ts \
  tests/terminal-create-session-boundary.test.ts \
  tests/github-clone-boundary.test.ts \
  tests/agent-runtime-preflight.test.ts \
  tests/codex-desktop-run-preflight.test.ts \
  tests/desktop-run-binding-admission-order.test.ts \
  tests/project-registry.test.ts \
  tests/mcp-config-boundaries.test.ts \
  tests/local-api-provider-config-security.test.ts \
  tests/mcp-registry-service.test.ts \
  tests/runtime-mcp-config-service.test.ts \
  tests/codex-desktop-service-boundary.test.ts \
  tests/renderer-csp-policy.test.ts \
  tests/renderer-mermaid-xss.test.ts \
  tests/renderer-agent-tool-call-xss.test.tsx \
  tests/renderer-html-sinks.test.ts
```

Step-0 read-only inventory probes at the untouched baseline produced:

- original ten files: 67 pass / 0 fail / 313 expectations;
- expanded 18 files: 117 pass / 0 fail / 476 expectations.

These probes establish the refreshed inventory only. They are not the required frozen-source
acceptance receipt and will be rerun after the source commit.

## Historical implementation evidence

All listed commits are ancestors of the rebaseline source:

- registered-root/component/terminal/runtime/config/guard slices:
  `583096cc`, `d941aa23`, `da8f688f`, `c8bc01e1`, `bb4f7d97`, `0c805948`;
- terminal startup input and argv clone: `87ff09c4`, `a3eeee3f`;
- MCP stdio native consent/fingerprint/fail-closed materialization: `b0323255`;
- renderer exploit evidence, Mermaid/subtitle/CSP slices:
  `217ee604`, `9f29ebfd`, `b270b6a9`, `abbaad75`, `ca4d02e9`, `5619551d`;
- experimental runtime removal: `79417d18`.

`PROJECT-MAP.md` retains the historical renderer-XSS, terminal, clone, and MCP stdio narratives
and commit references. Its 32-mount and Claude route/preflight anchors are stale, so it is not the
current anchor authority. It is supporting history referenced by this package and is not edited by
the rebaseline.

## GUI smoke disposition (Owner D3)

This host is WSL2 with empty `DISPLAY` and `WAYLAND_DISPLAY`, `XDG_SESSION_TYPE=tty`, and no
`Xvfb`, `xvfb-run`, `xdpyinfo`, or system Electron executable. An X11 socket alone is not a usable
or inspectable GUI receipt. The repository also has no dedicated CSP smoke runbook/receipt.

Therefore:

- historical 4.4 packaged production CSP smoke: no retained receipt; not rerun; not certified;
- historical 4.5 development CSP/HMR smoke: no retained receipt; not rerun; not certified;
- Owner-directed future destination: TICKET-114 GUI rerun checklist;
- phase-bound scope truth: TICKET-114 was not edited during rebaseline drafting and review. The
  post-archive closeout now adds both still-unchecked rerun entries without treating either as passed.

## Frozen-source implementation verification

Status: **PASS**.

- Frozen docs-only source SHA: `f89c7ee4a104c79d4c362972be8cac9c982dbc68`
- Frozen tree: `1570c453c4d7a6bb33ccc76e822c0da92545d806`
- Source commit time: `2026-09-02T18:31:08+12:00`
- Branch: `codex/update-trpc-capability-boundary-rebaseline`
- Receipt window ended: `2026-09-02T18:33:53+12:00` (Pacific/Auckland, WSL2)
- Source commit worktree before tests: clean.
- Source commit worktree after all receipts: clean; `HEAD` still exactly the frozen SHA; both
  unstaged and staged diffs were empty.

Commands that must run on the exact frozen source SHA:

1. the expanded 18-file targeted command above;
2. `bun run architecture:check`;
3. `bun run check:full`;
4. `bun x openspec validate update-trpc-capability-boundary --strict --no-interactive`;
5. `bun x openspec validate --changes --strict --no-interactive`;
6. `bun x openspec validate --specs --strict --no-interactive`;
7. `bun x openspec validate --all --strict --no-interactive`;
8. `bun x openspec validate --archived --strict --no-interactive` (expected aggregate exit 1 from
   the six pre-existing debts; this is an audit receipt, not a green aggregate gate).

### Exact-source results

| Receipt | Result |
| --- | --- |
| Expanded 18-file targeted suite | exit 0; **117 pass / 0 fail / 476 expectations** across 18 files |
| `bun run architecture:check` | exit 0; `Architecture guard passed.` |
| `bun run check:full` | exit 0; full chain completed: changed-file lint, architecture guard, retired-runtime residue, TypeScript, full isolated tests, spec validation, production build, and patch-whitespace diff check |
| Strict target validation | exit 0; `Change 'update-trpc-capability-boundary' is valid` |
| Strict active-change validation | exit 0; **2 passed / 0 failed / 2 items** |
| Strict living-spec validation | exit 0; **52 passed / 0 failed / 52 items** |
| Strict all validation | exit 0; **54 passed / 0 failed / 54 items** |
| Strict archived audit | expected exit 1; **106 passed / 6 failed / 112 items**, with exactly the six pre-existing task debts listed above |

No product/source file changed during verification. Expected rejection-path stack traces in the
targeted/full test logs did not represent test failures; both commands exited 0.

## Independent review and Owner gate

- Fresh Claude multi-perspective review bound to `f89c7ee4`: **REVIEW_APPROVED x3**; detailed
  record follows below and is committed in `08021f29`.
- Owner-authorized wording-only successor `38ef174cd8423c05874aebdfbd9f921fad1c5a7a`:
  **FROZEN AND RE-VERIFIED; TARGETED DIFF REVIEW APPROVED** in `c9f8c69c`.
- Owner `ACCEPTED` bound to the reviewed successor SHA: **ACCEPTED 2026-09-02**.
- Archive authorization: **GRANTED FOR NORMAL LOCAL ARCHIVE AND MECHANICAL CLOSEOUT**; no
  remote action is authorized.

The three full review verdicts remain historical evidence for `f89c7ee4`. Per Owner direction, the
bounded wording-only successor receives exact-SHA re-verification and targeted review of only
`08021f29..38ef174c`; it does not rerun the three full review lenses. Any product-code edit or
additional substantive spec change exceeds that exception and requires fresh full verification and
review. Evidence-only edits may record receipts without altering the frozen source under review.

## Local integration and pre-archive gate

- Main integration base after the independently completed Foundation 1d archive:
  `2450318c1f80079369cb34244c2246cb00286c29`.
- Accepted rebaseline evidence head: `e5d35de5c8943254dafeb85e7e395ac5c90b12aa`.
- Local merge SHA/tree: `a86f5ba301c5743f8a15ca8b7bd86baec07613ba` /
  `c38548aa5dc63d6c13cf4c5023f1738ccbfc52d0`.
- Merge result: no conflict; the first-parent diff contains only the five
  `openspec/changes/update-trpc-capability-boundary/**` documents, with the reviewed six
  requirements / 18 scenarios unchanged.
- Exact-merge `bun run check:full`: exit 0; **1928 pass / 0 fail / 9350 expectations** across
  304 files, architecture and retired-runtime guards passed, strict OpenSpec validation passed
  **53/53**, the production build completed, and patch-whitespace diff check passed.
- Receipt window ended: `2026-09-02T19:43:39+12:00` (Pacific/Auckland, WSL2); `HEAD` remained the
  exact merge SHA and the worktree was clean.
- Remote action: not authorized and not performed.

## Archive receipt

Status: **PASS — LOCALLY ARCHIVED 2026-09-02**.

- Archive input: clean local `main` at `f8f03e9cfd6596e6c851558fe4f2647fefa2f1a5`.
- Command: `bun x openspec archive update-trpc-capability-boundary --yes`; `--skip-specs` was not
  used. The command exited 0, reported the two expected still-open mechanical closeout items,
  applied `+ 6 added` to `runtime-security-baseline`, and created
  `openspec/changes/archive/2026-09-02-update-trpc-capability-boundary`.
- Mechanical archive commit: `41a1dfbdbe431b16e0d08e3b7322390b3ddd4501`.
- Living result: 15 requirements / 35 scenarios; strict target-spec validation passes; file
  SHA-256 `1df9e94cce51d83c0499f30f33ffb657700d2b92825b978ce7781d54b8df60f5`.
- Final aggregate after Foundation 1d archived first: no active changes; living specs
  **52 passed / 0 failed / 52**, strict all **52/52**, and archived audit's expected nonzero exit
  is **108 passed / 6 failed / 114**, with this archive passing and only the six pre-existing
  incomplete-task debts remaining.
- Historical CSP smoke 4.4/4.5 remains unreceipted and uncertified. TICKET-114 now lists separate
  packaged-production and development-CSP/HMR reruns; neither item is checked or treated as passed.
- Follow-up A may now be drafted and scheduled independently. Follow-up B remains sequenced after
  Foundation 1d (now complete) and the Amadeus continuation slice.
- Push, remote merge, release, and every other remote operation were not authorized or performed.

## Post-archive exact-SHA verification

Status: **PASS**.

- Closeout source SHA/tree: `c61ffb70987759663d0b2579d9033adb35942a64` /
  `a6f897a20d5c6dac5d7bcd31429ed5e428a7cea0`.
- Source commit time: `2026-09-02T23:24:45+12:00`; receipt window ended
  `2026-09-03T03:29:22+12:00` (Pacific/Auckland, WSL2).
- Before and after verification, `HEAD` remained the exact closeout source SHA and the worktree
  was clean.
- `bun run check:full`: exit 0. Changed-file lint had no supported source files; the architecture
  guard passed; retired-runtime residue passed with 1,600 files scanned / 10 allowlisted; TypeScript
  passed; the full isolated suite passed **1,928 tests / 0 failures / 9,350 expectations across 304
  files**; strict OpenSpec validation, production build, and patch-whitespace check all passed.
- A same-SHA isolated test rerun retained the exact **1,928 / 0 / 9,350 across 304 files** result.
- Strict post-archive validation: no active changes; living specs **52/52**; all **52/52**; archived
  audit expected exit 1 at **108 passed / 6 failed / 114 total**, with this archive passing and only
  the six pre-existing debts failing.
- Living `runtime-security-baseline`: 15 requirements / 35 scenarios; SHA-256
  `1df9e94cce51d83c0499f30f33ffb657700d2b92825b978ce7781d54b8df60f5`.
- No GUI CSP smoke was run or inferred. Both TICKET-114 entries remain unchecked. No push or other
  remote operation was performed.

## Fresh-context Claude multi-view review (2026-09-02, per Owner D4)

- Reviewed frozen source SHA: `f89c7ee4a104c79d4c362972be8cac9c982dbc68`; receipts read at
  evidence commit `d8ff2d1b` (independently confirmed docs-only / evidence-only).
- Three independent fresh-context lenses, each in its own uniquely-assigned isolated detached
  worktree (rb-review-a/b/c; removed after review; main worktree untouched):
  delta-vs-reality, governance/receipts, and overclaim-hunter.

**All three lenses: `REVIEW_APPROVED` for `f89c7ee4`. No P0/P1.**

Key confirmations (each independently reproduced): all 6 requirements / 18 scenarios traced
to implementation and adversarial tests at exact file:line anchors; every self-reported
receipt reproduced exactly (18-file suite 117/0/476; architecture guard pass; openspec
target/changes/specs/all green; archived audit 106/6/112 with precisely the six pre-existing
debts; build and diff:check green; full `check:full` blocked only by the documented
TICKET-114 host limitation — node-pty/Electron natives); D1–D6 each implemented to the
Owner's wording, including honest non-checkbox handling of unreceipted 4.4/4.5; descoped
items each routed exactly once to follow-up A/B or residuals with no truth silently dropped;
~40 spot-checked anchors accurate except one 2-line end-anchor drift.

**One P2, fix required before archive** (coordination decision — the archived text must not
carry change-relative wording into the living spec):

- R2's "hardened by this change" becomes a dangling reference after verbatim merge into
  `openspec/specs/runtime-security-baseline/spec.md`; that phrase is the load-bearing
  exclusion for renderer path/cwd sinks that are NOT hardened. Fix: replace with an explicit,
  self-contained enumeration (or reference to the scenario list) of the hardened route
  families.

P3 notes to bundle into the same touch-up (all one-line disclosures/corrections):
① `github-clone.ts:52-119` end-anchor → `:52-117`; ② task 5.6 closeout enumeration should
include the TICKET-114 CSP-smoke routing update; ③ R5: add one sentence disclosing that the
approval fingerprint intentionally excludes `projectPath` (approved stdio commands re-approve
across projects); ④ R6: add one sentence noting the sanitizer guarantee rests on Streamdown
2.1.0's default chain with no retained in-repo malicious-HTML regression test (registered for
follow-up A); ⑤ R1: name a living home (or explicit non-home disclosure) for the reviewed
operation-cluster inventory after design.md archives. Remaining P3s (overlapping
registered-root requirements post-archive → follow-up B consolidation; task 0.2 provenance
anachronism; node-pty reproduction caveat) are recorded here and need no pre-archive action.

Gate status: technical review complete for `f89c7ee4`; a wording touch-up + re-freeze +
targeted delta re-verification (scope: the touch-up diff only) precede Owner `ACCEPTED` and
archive. No merge, archive, push, or remote operation is authorized by this record.

## Post-review wording touch-up re-freeze

- Touch-up baseline: review-record commit `08021f29b44889c3c3d4f7c2763532392cca1ba6`.
- Scope: the single required R2 self-containment fix plus the five bundled P3 disclosures/
  corrections recorded above; task bookkeeping additionally separates completed full review from
  the pending targeted diff review.
- New frozen wording source SHA: `38ef174cd8423c05874aebdfbd9f921fad1c5a7a`.
- Frozen tree: `1a1fe718e9d9a254025264df9bab38b39d90f00a`.
- Source commit time: `2026-09-02T19:05:04+12:00`.
- Receipt window ended: `2026-09-02T19:08:19+12:00` (Pacific/Auckland, WSL2).
- Targeted review diff: `08021f29b44889c3c3d4f7c2763532392cca1ba6..38ef174cd8423c05874aebdfbd9f921fad1c5a7a`
  (**REVIEW_APPROVED**, recorded in `c9f8c69cf0ec3ea715d9c46e3e72ee36e2181668`); the range contains only `design.md`, the runtime-security-baseline delta,
  `tasks.md`, and `verification.md`, and `git diff --check` passes.
- Exact-SHA re-verification receipt: **PASS**. Before and after all commands, `HEAD` was exactly
  `38ef174cd8423c05874aebdfbd9f921fad1c5a7a` and the worktree was clean.
- Targeted Claude wording-diff verdict: **REVIEW_APPROVED** for the exact frozen source SHA.
- Owner `ACCEPTED`: **ACCEPTED 2026-09-02** for the exact frozen source SHA.

| Successor receipt | Result |
| --- | --- |
| Expanded 18-file targeted suite | exit 0; **117 pass / 0 fail / 476 expectations** across 18 files |
| `bun run architecture:check` | exit 0; `Architecture guard passed.` |
| `bun run check:full` | exit 0; full chain completed, including **1917 pass / 0 fail / 9294 expectations** across 302 files, strict all validation, production build, and patch-whitespace diff check |
| Strict target validation | exit 0; `Change 'update-trpc-capability-boundary' is valid` |
| Strict active-change validation | exit 0; **2 passed / 0 failed / 2 items** |
| Strict living-spec validation | exit 0; **52 passed / 0 failed / 52 items** |
| Strict all validation | exit 0; **54 passed / 0 failed / 54 items** |
| Strict archived audit | expected exit 1; **106 passed / 6 failed / 112 items**, unchanged pre-existing task debts |

The original `f89c7ee4` implementation receipts and three-view review record remain unchanged
above. This section records only the wording-only successor and must not relabel old receipts as
having run on the successor.

## Targeted touch-up re-verification (2026-09-02, task 5.3a)

- Scope reviewed: `08021f29..38ef174c` (wording touch-up only), receipts at `d27b4a47`
  (independently confirmed: tasks 5.2a checkbox + receipts only).
- Performed by the coordination session per the multi-view review's pre-declared protocol
  (targeted diff review; full multi-view review not rerun).
- Verified item-by-item: the P2 (R2 change-relative wording) is resolved by a renamed,
  self-contained requirement enumerating the exact governed route families, with scenarios
  updated and no over-inclusion (terminal sessions and global Codex/provider config remain
  outside R2); all five bundled P3s landed (anchor `:52-117`; task 5.6 TICKET-114 routing;
  R5 cross-project fingerprint disclosure; R6 Streamdown-chain dependency and missing
  regression-test disclosure with follow-up A ownership; R1 historical-evidence status for
  the operation-cluster inventory). Task-ledger split 5.2a/5.3/5.3a is accurate and does not
  rewrite `f89c7ee4` history. Diff containment confirmed: zero changes outside the change
  directory; worktree clean.

**Targeted re-verification: APPROVED for `38ef174cd8423c05874aebdfbd9f921fad1c5a7a`.**
The Owner then replied `rebaseline ACCEPTED` on 2026-09-02, explicitly accepting the same frozen
source after reading the targeted review record. Tasks 5.3a and 5.4 are therefore complete, and the
normal local archive (5.5) plus mechanical closeout (5.6) are authorized. Push, remote merge,
release, and every other remote operation remain unauthorized.
