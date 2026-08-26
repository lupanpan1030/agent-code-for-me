# Change: Mechanize the architecture boundaries as ratchets (guards, scripts, CI only)

> Foundation Stabilization draft **1c**. This change is sequenced **after** the 1a
> route-service-extraction change and the 1b dual-path-consolidation change so that every
> baseline it freezes captures the **post-extraction** state, not today's debt. All
> measurements quoted below were taken on the 2026-08-25 worktree as *hints*; each baseline
> is regenerated mechanically at implementation start against the merged post-1a/1b tree.

## Why

The 2026-08-25 architecture audit found that Locus's most load-bearing ownership rules are
documentation-only, and that its debt-control machinery has one-way gaps:

- The canonical event rule — persisted job events and renderer-visible diagnostics must pass
  through `src/main/lib/agent-runtime/stream-event-mapper.ts` / `runtime-events.ts` and
  `redaction.ts` (`docs/OWNERSHIP_MAP.md`, "Runtime Events, Trace, And Redaction") — is
  enforced only by behavior tests (`runtime-stream-event-mapper.test.ts`,
  `runtime-redaction.test.ts`). Nothing stops a second event→persisted mapping from growing
  inside `trpc/routers/` or a runtime adapter.
- `routers/claude.ts` (518 draft-time lines) is a *temporary* canonical owner until service
  extraction is completed. After Foundation 1a, `routers/codex.ts` is instead the canonical
  orchestration boundary over extracted run-stage owners, but its still-large surface also
  lacks a mechanical no-growth rule. The tRPC Route Boundary section is prose only; there is
  no mechanism that stops business logic from re-accreting into either route.
- The runtime-core import-boundary guard (`assertRuntimeCoreImportBoundary`,
  `scripts/check-architecture-guards.mjs`, `RUNTIME_CORE_DIRECTORIES` near L175) covers five
  directories; `src/main/lib/codex/`, `lib/claude/`, `lib/runtime-mcp-config/`,
  `lib/runtime-capability-projection/`, and `lib/agent-workbench/` are outside it, and the
  "lib never imports routers" direction rule is a documentation convention with seven live
  violations (in six files) today. The documented reach-through wrapper list (OWNERSHIP_MAP, "Runtime Core
  Import Boundary") is explicitly "not an allowlist" and nothing detects silent growth.
- Two guards are orphans and one wired gate is unlocked: `knip.json` is configured but
  `knip` is not even a devDependency and nothing runs it;
  `scripts/check-runtime-control-smoke-evidence.mjs` has only a manual
  script while its two siblings are executed and anti-tamper-asserted by
  `tests/proof-evidence-gates.test.ts`; and `scripts/check-retired-runtime-residue.mjs`,
  while already wired (package script `retired-runtime:check`, inside the blocking `check`
  chain, and run as a CI main-job step), sits outside the guard self-lock — nothing stops
  it being silently removed from `check` or CI.
- W4.3 ("touched modules get cleaner") is not mechanized: `scripts/run-biome-changed.mjs`
  blocks new-line diagnostics but explicitly "ignor[es] legacy file diagnostics", so a
  touched file may keep its stock of debt forever. Measured stock: 2,743 diagnostics
  (1,415 error / 1,156 warning / 172 info) across 685 files.

This change converts those rules into machine-enforced **ratchets**: frozen baselines that
fail on any growth and may only shrink. It is guards + scripts + CI wiring only; no product
behavior changes.

## What Changes

1. **Canonical event single-path guard** — new `assertRuntimeEventSinglePath` in
   `scripts/check-architecture-guards.mjs`:
   - The event-pipeline exports (`createRunEvent` in `agent-runtime/runtime-events.ts`;
     `mapDesktopStreamChunkToRunEvents`, `createDesktopStreamEventMapper`,
     `appendRunEventsToAgentJob`, `redactRendererDiagnosticChunk`,
     `redactRendererRuntimeChunk`, `createRuntimeRendererChunkEmitter` in
     `agent-runtime/stream-event-mapper.ts`; `createAgentJobRunEvent` in
     `agent-runtime/job-event-bridge.ts`; `redactRuntimePayload`, `redactExactSecretHints`
     in `agent-runtime/redaction.ts`) may be **defined** only in those owner modules
     (pattern: existing `assertGuardDecisionSingleOwner`).
   - The persisted write function `appendAgentJobEvent` stays exported only from
     `src/main/lib/headless/job-store.ts`, `insertAgentJobEventRecord` stays module-private,
     and files under `src/main/lib/trpc/routers/**`, `src/main/lib/codex/**`, and
     `src/main/lib/claude/**` must not import `appendAgentJobEvent` directly — they consume
     `appendRunEventsToAgentJob` / `createAgentJobRunEvent`. Direct importers are a frozen
     allowlist (today: `headless/completion-runner.ts`, `headless/job-runner.ts`,
     `headless/cli-dispatcher.ts`, `desktop-agent-jobs.ts`,
     `agent-runtime/stream-event-mapper.ts`).
2. **Route surface ratchets** — new `assertRouteSurfaceRatchets`: a
   machine-readable baseline (new `scripts/architecture-baselines.json`, section
   `routeSurfaceRatchets`) records line count and the exact named-export set of
   `trpc/routers/claude.ts` (hint: 518 lines; `clearClaudeCaches`,
   `getAllMcpConfigHandler`, `claudeRouter`) and `trpc/routers/codex.ts` (hint: 1,334
   lines; `getAllCodexMcpConfigHandler`, `hasActiveCodexStreams`, `abortAllCodexStreams`,
   `codexRouter`). Above-baseline line count or any export not in the baseline set fails;
   below-baseline fails with a "tighten the baseline to N" message so the checked-in number
   always equals reality. The shared mechanism has two deliberately different governance
   meanings:
   - `claude.ts` remains a **temporary-owner ratchet** and retires with the approved change
     that removes its temporary-owner clause.
   - `codex.ts` is an **orchestration-boundary no-growth ratchet**, not a temporary-owner
     marker. It retires only through an explicit Owner decision, or in the same approved
     change that structurally decomposes the route in a later phase such as Job Kernel.
3. **Import-boundary expansion + direction check + wrapper registry** — extend
   `assertRuntimeCoreImportBoundary`:
   - Add `src/main/lib/codex/`, `lib/claude/`, `lib/runtime-mcp-config/`,
     `lib/runtime-capability-projection/`, and `lib/agent-workbench/` to
     `RUNTIME_CORE_DIRECTORIES` (codex/, runtime-capability-projection/, and
     agent-workbench/ are clean today; claude/ has four direct `electron` imports and
     runtime-mcp-config/ has one `electron` import plus one router import — these
     pre-existing findings are frozen in `architecture-baselines.json` section
     `importBoundaryViolations`, keyed file + specifier + category; new entries fail,
     entries may only be removed).
   - New repo-wide direction check: every file under `src/main/lib/**` outside
     `src/main/lib/trpc/` must not import modules resolving under
     `src/main/lib/trpc/routers/**` (all syntaxes the existing AST machinery covers,
     including `import type` and dynamic `import()`). Pre-existing violations frozen in
     section `reverseDirectionImports` (today: 7 occurrences in 6 files — `mcp-auth.ts`,
     `claude/agent-sdk-config-dir.ts` (dynamic import), `agent-builder/read-model.ts`,
     `agent-builder/claude-native-agents.ts` ×2, `runtime-mcp-config/claude.ts`,
     `ollama/network-detector.ts` (→ `routers/debug`)). Deliberate gap: this direction
     check scans `src/main/lib/**` only; regressions of the app-shell reverse imports
     (`src/main/index.ts`, `src/main/windows/main.ts`) are covered by 1a's negative
     source-text assertions, not by this guard.
   - The documented reach-through wrapper list becomes machine-readable: section
   `reachThroughWrappers` (Owner-authorized first freeze: `electron-app`, `db`, `secure-storage`,
   `provider-token`, `local-only`, `claude-credentials`, `codex/cli-path`,
   `codex/runtime-status`, `utility-chat-completion`, `chat-attachments`, `mcp-auth`,
   `skills/registry`). The last three were discovered by the exact post-1a/1b one-hop scan
   and are one-time bootstrap additions authorized by the Owner on 2026-08-27; after this
   first freeze the registry may only shrink. The guard performs **one-hop**
     detection: a module outside the guarded directories that both (a) is imported by a
     guarded directory and (b) itself directly imports a banned category must appear in
     the registry, or the guard fails. The guard also asserts the OWNERSHIP_MAP prose list
     names exactly the registry entries, so doc and machine truth cannot drift. Full
     transitive closure stays deferred by design (unchanged posture).
4. **Wire the orphan guards and self-lock the residue gate**:
   - `scripts/check-retired-runtime-residue.mjs` is already wired as `retired-runtime:check`
     (blocking `check` chain + CI main-job step); the remaining gap is the self-lock: the
     guard (`assertPackageScripts` / `assertCiRunsArchitectureCheck`) is extended so
     `retired-runtime:check` cannot be silently removed from `check` or CI. No second entry
     point or script name is created.
   - `knip` added as a pinned devDependency with package script `debt:knip`; a
     `continue-on-error: true` step in the existing `debt-report` CI job (visibility only,
     non-blocking — same posture as `lint:all` and `bun audit` there).
   - `scripts/check-runtime-control-smoke-evidence.mjs` gains a block in
     `tests/proof-evidence-gates.test.ts` alongside its two siblings
     (`check-settings-ia-smoke-evidence.mjs`, `check-mcp-registry-proof-evidence.mjs`):
     the test spawns it and asserts the same class of anti-tamper source markers.
5. **Lint ratchet (W4.3)** — `scripts/run-biome-changed.mjs` gains a per-file baseline,
   `lint-baseline.json` (blocking = error + warning counts per file; info excluded),
   generated/refreshed only via an explicit `--update-lint-baseline` mode:
   - For every *touched* file, the full-file blocking count must be ≤ its baseline entry
     (absent entry = 0). Above → fail. Below → fail with a tighten instruction, keeping the
     baseline honest. New-line zero-tolerance behavior is unchanged.
   - Rename rule: a pure file rename may carry the old path's baseline entry over to the
     new path unchanged (delete old key, add new key, identical count) — a mechanical,
     reviewable baseline edit that is NOT the Red "manual baseline increase"; the total
     never grows. This keeps renames (e.g. 1d's transport rename) from forcing a file's
     legacy lint debt to be cleared first.
   - The ~1,080 mechanically auto-fixable legacy diagnostics (format, organizeImports,
     noUnusedImports, useNodejsImportProtocol, …) are **not** fixed here. A separate
     no-OpenSpec mechanical cleanup batch handles them (formatting-only changes are
     proposal-exempt per `openspec/AGENTS.md`), and `lint-baseline.json` simply shrinks as
     those batches land.
   - `tests/run-biome-changed.test.mjs` is extended to cover the ratchet paths.

### Out of scope

- Fixing any existing lint debt (separate mechanical batches, proposal-exempt).
- Fixing the frozen baseline entries themselves: migrating `src/main/lib/claude/`'s four
  direct `electron` imports to the `electron-app` wrapper, wrapping
  `runtime-mcp-config/mcp-command-trust.ts`'s `dialog` use, and relocating the
  router-owned helpers that `mcp-auth.ts`, `claude/agent-sdk-config-dir.ts`,
  `agent-builder/`, `runtime-mcp-config/claude.ts`, and `ollama/network-detector.ts` reach
  into (`trpc/routers/agent-utils`, `trpc/routers/claude-settings`, `trpc/routers/debug`) —
  logged as Yellow follow-ups; some may already be cleared by 1a/1b, in which case the
  regenerated baselines are simply smaller.
- Clearing the three newly frozen one-hop wrappers: direct Electron ownership in
  `src/main/lib/chat-attachments.ts` (TICKET-119), Electron plus router reach-through in
  `src/main/lib/mcp-auth.ts` (TICKET-120), and direct Electron ownership in
  `src/main/lib/skills/registry.ts` (TICKET-121). Each has a dedicated Yellow contraction
  path; none is implemented in 1c.
- Capability consent / dangerous-router-input elimination — owned by the blocked
  `update-trpc-capability-boundary` change; this change does not touch the
  `assertNoUnresolvedDangerousRouterInput` allowlist.
- Transitive wrapper-closure enforcement — stays deferred by design; only the
  machine-readable registry plus one-hop growth detection is new.
- InteractionRequest main-side owner guard — lands with the Interactive Runs change per
  the audit recommendation (Yellow follow-up here).
- Any change to product behavior, DB schema, persisted user data, or public contracts.

## Canonical owners

| Logic | Canonical owner |
| --- | --- |
| All architecture guard assertions (items 1–3) | `scripts/check-architecture-guards.mjs` (existing single guard owner; no second guard script) |
| Architecture ratchet baselines (route surfaces, import-boundary violations, reverse-direction imports, wrapper registry) | `scripts/architecture-baselines.json` (new; read only by the guard script; updated only via the guard's `--update-architecture-baselines` mode) |
| Lint ratchet logic | `scripts/run-biome-changed.mjs` (existing lint gate owner) |
| Lint baseline data | `lint-baseline.json` (new; read only by `run-biome-changed.mjs`; written only via `--update-lint-baseline`) |
| Residue gate | `scripts/check-retired-runtime-residue.mjs` via the existing `retired-runtime:check` script (invocation unchanged; gains a self-lock, not a copy) |
| Evidence-gate execution | `tests/proof-evidence-gates.test.ts` (existing owner of evidence-gate spawning) |
| Dead-code report | `knip` via `knip.json` (existing config, now actually executed) |

## Old-path deletion / dual-path statement

No behavior is duplicated by this change, so there is no old code path to delete. Two
near-dual representations are handled explicitly:

- **Wrapper list (doc vs machine)**: canonical truth becomes the machine-readable
  `reachThroughWrappers` registry. The OWNERSHIP_MAP prose list is retained as
  documentation but is guard-asserted to name exactly the registry entries (boundary
  guard), with a comment in both places naming the registry as canonical. This is a
  permanent doc-mirror, not a temporary dual path; the sync assertion is its gate.
- **Frozen violation baselines** are temporary by construction: canonical owner is the
  boundary rule itself; the migration gate is the baseline entry; the deletion follow-up is
  the Yellow list below (each entry names its file); the boundary guard is the ratchet
  (new entries fail, removals must tighten); the deprecation marker is the baseline file's
  header comment stating entries may only be deleted.

## Migration gate

None required. No persisted user data, DB schema, or drizzle migration is touched. The new
JSON baselines are repo-tracked source artifacts, not runtime data.

## Verification consumers

- `bun run architecture:check` — new guards ship with self-test fixtures in the same style
  as `assertRuntimeCoreImportBoundary`'s synthetic-fixture self-test (fail-closed if
  expected findings don't match).
- `tests/run-biome-changed.test.mjs` — extended for baseline ratchet pass/fail/tighten
  paths.
- `tests/proof-evidence-gates.test.ts` — extended for the runtime-control evidence gate.
- CI: main job (`Test, Typecheck, Build`) keeps running the existing `check` chain
  (already including `retired-runtime:check`, now self-locked); `debt-report` job gains the
  knip step.
- `bun run check:full` receipt bound to the source SHA in `verification.md` (closeout).
- Negative proof: temporarily reverting one baseline entry of each kind locally must turn
  the corresponding guard red (recorded in `verification.md`, not committed).

## W7 autonomy envelope

- **Green (implementer may do autonomously)**: implement the guards, scripts, tests, and CI
  wiring exactly as scoped; regenerate all baselines mechanically at the implementation
  SHA; tighten any baseline (remove entries / lower counts); add the pinned `knip`
  devDependency; extend the self-lock guard to cover `retired-runtime:check`; update the
  OWNERSHIP_MAP "Runtime Core Import Boundary" and "tRPC Route Boundary" sections to name
  the machine-readable registries.
- **Yellow (log a follow-up, do not implement)**: migrating `src/main/lib/claude/`'s
  `electron` imports to `electron-app`; wrapping `mcp-command-trust.ts`'s `dialog` use;
  moving `trpc/routers/agent-utils` / `trpc/routers/claude-settings` helpers to lib owners
  to clear the reverse-direction baseline; InteractionRequest main-side owner guard
  (Interactive Runs change); acting on knip findings; scheduling mechanical lint batches;
  migrating 1b's (`add-chat-session-binding`) inline binding-atom allowlist in
  `check-architecture-guards.mjs` into the centralized `architecture-baselines.json`
  registry; clearing `chat-attachments` / `mcp-auth` / `skills/registry` one-hop wrapper
  debt under TICKET-119 / TICKET-120 / TICKET-121.
- **Red (stop and ask Owner)**: raising any baseline number or adding any entry to
  `importBoundaryViolations`, `reverseDirectionImports`, `reachThroughWrappers`, or a
  route's export set **after the Owner-authorized first 12-wrapper freeze**; changing
  `check` / `check:full` composition beyond the scoped
  additions; touching the dangerous-router-input allowlist; weakening or deleting any
  existing guard; anything that alters product behavior, schema semantics, public
  contracts, or security boundaries.

## Impact

- Affected specs: `architecture-ownership` — MODIFIED `Runtime Core Import Boundary`
  (directory expansion, frozen-baseline semantics, direction rule, wrapper registry; also
  corrects the existing four-vs-five directory drift: the live guard already enforces
  `model-catalog`), ADDED `Canonical Runtime Event Mapping Single Path`, ADDED
  `Route Surface Growth Ratchets`. The orphan-guard wiring, residue-gate self-lock,
  knip step, and lint ratchet are delivery tooling with no owning capability spec and carry
  no delta. Because deltas exist, archive normally (no `--skip-specs`).
- Affected code: `scripts/check-architecture-guards.mjs`,
  `scripts/architecture-baselines.json` (new), `scripts/run-biome-changed.mjs`,
  `lint-baseline.json` (new), `package.json` (`debt:knip` script + `knip` devDependency),
  `.github/workflows/ci.yml` (debt-report step; the main-job `retired-runtime:check` step
  already exists),
  `tests/proof-evidence-gates.test.ts`, `tests/run-biome-changed.test.mjs`,
  `docs/OWNERSHIP_MAP.md` (Runtime Core registry pointers, neutral tRPC route-ratchet
  pointer, and the distinct Claude/Codex desktop-route containment and retirement rules).
  No unrelated OWNERSHIP_MAP section or `src/` product code is modified.
- Proposal-time conflicts: none. The then-active `add-cross-workspace-conflicts` change
  used a separate diff-parser ownership test and is now archived;
  `update-trpc-capability-boundary` remains blocked and its allowlist is untouched. 1a/1b
  landed first, and their extractions only shrink the baselines this change freezes.
