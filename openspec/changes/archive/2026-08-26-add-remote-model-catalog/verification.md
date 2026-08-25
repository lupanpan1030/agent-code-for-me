# Verification: add-remote-model-catalog

## Task 0.1 — preconditions and anchor audit

- Audited: 2026-07-23 (Pacific/Auckland)
- Branch base: clean local `main` at `df72d425` (`chore: draft
  add-remote-model-catalog proposal`); implementation branch created from that
  exact commit as `codex/add-remote-model-catalog`.
- Repository visibility: `gh repo view lupanpan1030/agent-code-for-me` reported
  `PUBLIC`, preserving the raw-GitHub manifest precondition.
- Ownership read before implementation: `docs/OWNERSHIP_MAP.md`. The new durable
  fetch/cache/merge behavior is owned by `src/main/lib/model-catalog/`; the tRPC
  file is a transport-only consumer; renderer hydration belongs in the renderer
  catalog store; runtime request composition stays in the existing Claude/Codex
  transport owners; API-key validation state stays under
  `src/main/lib/codex/api-key-validation.ts`.

Current anchor audit (all described behavior still matches):

| Design context claim | Re-verified location |
| --- | --- |
| Claude built-ins and app-agent enum derivation | `src/shared/custom-agent-models.ts:12-77,79-104` |
| Codex built-ins, auth restriction, source resolver | `src/renderer/features/agents/lib/models.ts:19-81,83-132` |
| Claude renderer clamp | `src/renderer/features/agents/lib/ipc-chat-transport.ts:240-246` |
| Claude alias map | `src/renderer/features/agents/atoms/index.ts:421-427` |
| Codex renderer clamp and duplicate default | `src/renderer/features/agents/lib/acp-chat-transport.ts:75,129-156` |
| Main-process Codex empty-id fallback/pass-through | `src/main/lib/codex/model-selection.ts:1,32-40` |
| Claude route input and SDK query pass-through | `src/main/lib/trpc/routers/claude.ts:113`; `src/main/lib/claude/agent-sdk-query-options.ts:293` |
| OpenAI models probe response discard | `src/main/lib/codex/api-key-validation.ts:174-187` |
| Remote JSON fetch pattern | `src/main/lib/mcp-registry/official-provider.ts:1-260` |
| Raw local-only boolean versus hostname guard | `src/main/lib/local-only.ts:23-35` |
| Safe provider-model rule | `src/shared/local-job-api.ts:380-387` |
| Hidden-model atom | `src/renderer/lib/atoms/index.ts:611-616` |
| Chat picker static imports/filter | `src/renderer/features/agents/main/chat-input-area.tsx:119-120,621,636,652` |
| New-chat picker static imports/filter | `src/renderer/features/agents/main/new-chat-form.tsx:143-144,688,695,711` |
| Settings hidden-model checklist | `src/renderer/components/dialogs/settings-tabs/agents-models-tab.tsx:1994-2006,2093-2107` |
| Runtime-core guard directory list | `scripts/check-architecture-guards.mjs:175-180` |

No anchor drift requiring a ticket correction was found. Three audit details
were recorded without changing the approved design or acceptance criteria:

- The design's shortened `atoms/index.ts` reference resolves to the full Claude
  atom path shown above.
- `new-chat-form.tsx:688` reads the hidden-model state; the corresponding Codex
  filter expression is currently at line 695.
- The local-only hostname blocklist itself is in
  `src/shared/local-only.ts:28-45`; `src/main/lib/local-only.ts:27-35` is the
  main-process wrapper. Also, the current Codex normalizer rejects whitespace
  and the literal sentinel `codex` before otherwise passing model strings
  through (`src/main/lib/codex/model-selection.ts:3-15`).

## Task 5 — final verification

Verified: 2026-07-23 (Pacific/Auckland), on
`codex/add-remote-model-catalog`.

### 5.1 — repository checks

Final command:

```text
bun run check
```

Result: exit 0.

- Changed-line Biome lint: passed (only pre-existing diagnostics outside
  changed lines were ignored by the repository's existing wrapper).
- Import-boundary architecture guard: `Architecture guard passed.`
- TypeScript: `tsc --noEmit` passed.
- Tests: **1462 passed, 0 failed, 7404 assertions, 264 files**.

Focused catalog/security regression command also passed before the full suite:

```text
bun test tests/codex-api-key-validation.test.ts \
  tests/codex-api-key-model-store.test.ts \
  tests/model-catalog.test.ts \
  tests/model-catalog-fetcher.test.ts \
  tests/remote-model-catalog-renderer.test.ts \
  tests/model-catalog-main-validation.test.ts
```

Result: **33 passed, 0 failed, 120 assertions, 6 files**. This includes strict
schema/merge cases, streamed response caps, cache permissions, local-only with
a warm cache, custom/unknown transport pass-through, prototype-like aliases,
first-party main-process validation, malformed OpenAI model-list handling, and
safe persistence of the last validated API-key model snapshot. The latter is
updated in mounted pickers through a main-to-renderer subscription without an
extra provider request; the encrypted API-key payload is atomically replaced,
and snapshot-write failure is diagnostic-only so it cannot change validation
or run behavior.

### 5.2 — manual desktop smoke

All UI observations below were made in the real Electron development app with
fresh isolated `LOCUS_USER_DATA_DIR` directories. Temporary HTTP servers and
Electron processes were stopped after the scenarios.

#### (a) Fresh launch with the catalog endpoint offline

- Launch environment:
  `LOCUS_USER_DATA_DIR=/tmp/locus-catalog-offline-net.AL4BGs`,
  `LOCUS_LOCAL_ONLY=0`, and
  `LOCUS_MODEL_CATALOG_URL=http://127.0.0.1:9/model-catalog.json`.
- Main diagnostics recorded
  `[model-catalog] Remote catalog refresh failed; using local fallback.` with
  `TypeError: fetch failed`, proving this exercised network-failure fallback
  rather than the local-only short circuit.
- The fresh Claude picker contained exactly the built-in rows **Fable 5,
  Opus 4.8, Sonnet 4.6, Haiku 4.5**. The fresh Codex picker contained exactly
  **GPT-5.5, GPT-5.4, GPT-5.4 Mini, GPT-5.3-Codex Spark**. The new Custom row is
  a separate capability and not a catalog model.
- No catalog error appeared in the application UI.

#### (b) Locally served manifest adds a fake model without rebuild

- Launch environment:
  `LOCUS_USER_DATA_DIR=/tmp/locus-catalog-fake.IbNiaE`,
  `LOCUS_LOCAL_ONLY=0`, and
  `LOCUS_MODEL_CATALOG_URL=http://127.0.0.1:48192/model-catalog.json`.
- The request-counting server received `FAKE_REQUEST 1` and returned a valid
  manifest adding Claude `vendor/claude-smoke-v2` (label/version
  `Claude Smoke 2`) and Codex `gpt-smoke-remote` (`GPT Smoke Remote`). Both
  appeared in their picker without a renderer rebuild.
- `Claude Smoke 2` was selected in the live picker and remained the selected
  model after restarting the app against the same isolated user-data directory.
- An actual `claude.chat` Electron tRPC subscription was issued with trace id
  `9004`. `CLAUDE_REQUEST_TRACE` recorded
  `"model":"vendor/claude-smoke-v2"`; the subscription emitted `started`,
  `start`, `start-step`, and `session-init`. The main-process SDK diagnostic
  then recorded `[CLAUDE SDK ERROR] Model: vendor/claude-smoke-v2` before the
  expected no-credential auth failure. This proves the remote id reached the
  runtime unchanged rather than being clamped to a built-in.

#### (c) Invalid manifest falls back silently

- Launch environment:
  `LOCUS_USER_DATA_DIR=/tmp/locus-catalog-invalid.GlZtcJ`,
  `LOCUS_LOCAL_ONLY=0`, and the local server at port `48191`.
- The server returned an otherwise manifest-shaped object with a strict-schema
  violation (`unexpected`). It received the catalog request; main diagnostics
  contained the Zod validation failure.
- Both pickers showed the same built-ins listed in scenario (a). The
  Notifications surface remained empty and no catalog error was surfaced to
  the user.

#### (d) Custom id from each picker reaches its runtime request

- Claude: opened the inline Custom model form, entered
  `vendor/claude-custom-smoke`, and clicked **Use model**. The trigger rendered
  that exact id plus the Custom badge. Actual subscription trace id `9005`
  recorded the exact id in `CLAUDE_CUSTOM_REQUEST_TRACE`, emitted `started`,
  and the SDK diagnostic recorded
  `[CLAUDE SDK ERROR] Model: vendor/claude-custom-smoke` before the expected
  auth failure.
- Codex: switched to OpenAI Codex, opened the inline Custom model form, entered
  `gpt-custom-smoke`, and clicked **Use model**. The trigger rendered that exact
  id plus the Custom badge. Actual `codex.chat` subscription trace id `9006`
  emitted `started` with `"model":"gpt-custom-smoke/high"`. `/high` is the
  existing Codex thinking wire suffix required by task 3.4; the custom base id
  remained verbatim and was not replaced by a built-in. The local environment's
  unauthenticated Figma MCP then stopped the run at the existing MCP preflight,
  which is unrelated to model selection.

#### (e) Local-only mode makes zero catalog requests

- Launch environment:
  `LOCUS_USER_DATA_DIR=/tmp/locus-catalog-localonly.lLQZ8Q`,
  `LOCUS_LOCAL_ONLY=1`, with the request-counting server URL still configured.
- The server counter was **2** before launch. After opening Quick Chat, which
  mounts the catalog consumers, and waiting for refresh, it remained **2**:
  zero new catalog network requests.
- The pickers used built-ins. The automated warm-cache case additionally proves
  local-only returns the built-in catalog even when a remote cache file exists.

### 5.3 — strict OpenSpec validation

Final command:

```text
openspec validate add-remote-model-catalog --strict --no-interactive
```

Result: exit 0, `Change 'add-remote-model-catalog' is valid`.

### Boundary audit

- No bundled CLI download or binary path, Ollama gate, provider-profile
  behavior, headless surface, or app-agent model enum was changed.
- i18n structure was not changed; only the picker copy required by the approved
  design was added to the existing dictionaries.
- `proposal.md`, `design.md`, and `specs/model-catalog/spec.md` are unmodified.
  No implementation finding required changing the approved ticket.
- The change remains unmerged and unarchived for review.

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
  - `src/renderer/features/agents/lib/models.ts` — Dead export left behind by the clamp-removal refactor. isCodexApiKeySupportedModel (line ~38) is exported but has zero remaining call sites after the clamp/allowlist logic moved to model-catalog-selection.ts's buildCodexApiKeyModels/getVisibleCodexApiKeyModels. Not a functional problem (changed-line lint won't catch unused exports), just maintenance debt worth a follow-up cleanup.
  - `src/main/lib/trpc/routers/codex.ts` — Repeated full-file rewrite of the Codex API-key store on every chat turn. Line ~899 calls updateStoredCodexApiKeyModelIds(getCachedCodexApiKeyModelIds()) inside the preflight of every codex.chat run when using an app-managed API key, which unconditionally re-encrypts-free-rewrites api-key-store.ts's whole payload (temp file + rename) even when the model id list hasn't changed since the last run. Not a correctness bug (atomic write, diagnostic-only failure per design), just avoidable disk I/O worth a cheap equality check later.
  - `src/main/lib/model-catalog/fetcher.ts` — Every launch/24h period phones home to a hardcoded GitHub raw URL outside local-only mode. MODEL_CATALOG_URL (line 14-15) is fetched with no separate user-facing opt-out beyond the existing local-only toggle. This is the explicit, ratified design decision (proposal.md/design.md), not a defect, but worth flagging for product awareness since it is a new default network egress point for every non-local-only install.

### Reviewer summary

Reviewed add-remote-model-catalog at the frozen source SHA bdd2e2e57143a69f86f34ed96f84aa9a5e076fd4 (worktree HEAD f9a16c70 differs only by the later evidence-docs commit; confirmed via `git log 67541e51..bdd2e2e5 -- <catalog files>` that no commit after the feature landed touched any file in this change's scope, so the July 23 verification and the current code are the same implementation).

Implementation matches proposal.md/design.md/tasks.md closely:
- `src/shared/model-catalog.ts`: strict zod schema (`.strict()` at every object layer), id validated via the single exported `isSafeProviderModel` (`src/shared/local-job-api.ts:380`), merge semantics (`mergeModelCatalog`) add/update/deprecate but never delete a built-in, and preserve built-in i18n-keyed copy when the manifest omits summary/bestFor/tokenNote/latency (verified by spread-key-absence behavior in `mergeCatalogModels`).
- `src/main/lib/model-catalog/fetcher.ts`: 10s timeout, 2MB streamed size cap (both content-length and streaming-byte-count enforced), 24h TTL with stale-while-revalidate `get()`, last-good cache at `{userData}/model-catalog-cache.json` written via temp-file+rename with 0o600, `LOCUS_MODEL_CATALOG_URL` override gated strictly to `!isPackaged` (packaged builds always use the fixed https URL; even the dev override still must be http/https). Local-only gating uses the raw `isLocalOnlyMode()` boolean per design (not the hostname-blocklist `assertOfficialCloudAllowed`), and is fail-closed on guard-check error too. A dedicated test (`tests/model-catalog-fetcher.test.ts` "local-only mode ignores a warm remote cache and returns built-ins") shows the implementation is actually *stricter* than the design's minimum bar — it discards even a previously-cached remote catalog while local-only is active rather than merely skipping the network call — which is a safe, non-blocking deviation.
- `src/main/lib/trpc/routers/model-catalog.ts` + `routers/index.ts`: transport-only consumer of the fetcher, correctly registered.
- Renderer clamp removal verified exactly as designed: `src/renderer/features/agents/lib/transport-model-selection.ts` resolves Claude aliases via `Object.hasOwn(MODEL_ID_MAP, ...)` (prototype-pollution-safe, has a dedicated test) and passes unknown ids through verbatim; Codex composes `${id}/${thinking}` for any id. No remaining callers rewrite an unknown id to a default.
- Defense-in-depth beyond the design text: both `src/main/lib/claude/chat-input-schema.ts` and `src/main/lib/codex/chat-input-schema.ts` gained a `superRefine` that re-validates first-party model ids server-side with the same `isSafeProviderModel` rule (Codex normalizes off the `/thinking` suffix first), so a renderer bypass can't smuggle a malformed id into the SDK/app-server. `tests/model-catalog-main-validation.test.ts` explicitly covers the "renderer-bypassed unsafe id" scenario.
- OpenAI `/v1/models` parse (`src/main/lib/codex/api-key-validation.ts`) reads the previously-discarded response body only on `response.ok`, filters to `gpt-*`/`o*`/`codex*` and the same safe-charset rule, tolerates malformed bodies, and is cached/persisted (`api-key-store.ts`) alongside the still-encrypted key payload with atomic 0o600 writes; snapshot-persist failure is diagnostic-only and does not affect validation/run behavior.
- `docs/model-catalog.json` seed content is byte-for-byte metadata-equivalent to the current `CLAUDE_MODELS`/`CODEX_MODELS` built-ins, so merging it produces no observable drift.
- `docs/OWNERSHIP_MAP.md` and `scripts/check-architecture-guards.mjs`'s `RUNTIME_CORE_DIRECTORIES` were both updated to cover `src/main/lib/model-catalog/`; the fetcher only reaches Electron/local-only state through the explicitly allow-listed wrapper modules (`electron-app`, `local-only`), consistent with the boundary rule.
- No drizzle/schema changes are part of this change (the only migration on the branch, `drizzle/0022_legal_wendell_vaughn.sql`, belongs to the unrelated `add-cross-workspace-conflicts` change and adds an unrelated `chats.base_commit` column).
- Cross-change interference check: `6b5680aa refactor: remove retired provider target gate` (landed after this change) touches only `src/main/lib/provider-profiles/storage.ts` and `trpc/routers/provider-profiles.ts` — zero overlap with any model-catalog file, so the "later runtime hardening" note in the task did not regress this change's paths.

Verification performed: read proposal/design/tasks/verification.md/spec; read and cross-checked all touched source files against the design decisions (schema, fetcher, router, transport clamp removal, custom-model UI, hidden-models integration, API-key model parsing/store); ran the exact targeted test command from verification.md (`bun test tests/codex-api-key-validation.test.ts tests/codex-api-key-model-store.test.ts tests/model-catalog.test.ts tests/model-catalog-fetcher.test.ts tests/remote-model-catalog-renderer.test.ts tests/model-catalog-main-validation.test.ts`) — result 33 pass / 0 fail / 120 assertions / 6 files, matching the claim exactly; ran `node scripts/check-architecture-guards.mjs` — passed; confirmed `git status --porcelain` was empty before and after the test run (no tree mutation); confirmed via `git log 67541e51..bdd2e2e5 -- <files>` that no later commit touched any file in this change's scope, so the July 23 verification evidence is not stale relative to the frozen source. No P0/P1 findings; only P3 maintenance/observability notes.

## 2026-08-26 — Local integration, post-merge gate, and Owner acceptance

- Reviewed implementation source: `bdd2e2e57143a69f86f34ed96f84aa9a5e076fd4`.
- Evidence-only commits: Codex verification `f9a16c70c724767980a20587006845216f0f6d6f` and
  Claude review `2a41522c01e5bb7e55014218c087e814a28be583`.
- Local integration: `main` was fast-forwarded from
  `df72d425ea9c7e404a568a4c93c26f3792074ad0` to
  `2a41522c01e5bb7e55014218c087e814a28be583`, with no conflict and no merge commit.
  The range from the reviewed source to the local integration endpoint changes only the four
  change-owned `verification.md` files; it contains no product-code change.
- Post-merge gate: `bun run check:full` passed at the unchanged local-main SHA
  `2a41522c01e5bb7e55014218c087e814a28be583`: architecture and retired-runtime guards passed;
  TypeScript passed; 1,642 tests passed with 0 failures and 7,921 assertions across 278 files;
  OpenSpec strict validation passed 54/54; the production Electron/Vite build and diff check
  passed. Only the already-recorded non-failing Vite/Browserslist warnings remained.
- Owner decision received verbatim on 2026-08-26:
  **`ACCEPTED add-remote-model-catalog`**.
- Final change verdict: **`IMPLEMENTATION_VERIFIED` + `REVIEW_APPROVED` + `ACCEPTED`**.
  The independent review found zero P0/P1/P2 findings; its three non-blocking P3 notes remain
  recorded above for later triage.
- Archive state at this checkpoint: pending local archive and post-archive strict validation.
- Push, remote PR mutation, remote merge, release, and every other remote operation:
  **not authorized and not performed**.

## 2026-08-26 — Archive receipt

- `bun x openspec archive add-remote-model-catalog --yes` exited 0 and moved this change to
  `openspec/changes/archive/2026-08-26-add-remote-model-catalog/`.
- The archive created the canonical `model-catalog` spec with three requirements; its generated
  Purpose was replaced with the reviewed descriptive Purpose during mechanical closeout.
- `bun x openspec validate --all --strict --no-interactive` passed 52/52 after all four archives.
- The output of `bun x openspec validate --archived --strict --no-interactive` marks this entry
  `✓`. The command exits nonzero at an archive-wide aggregate of 102/108 because six older archived
  entries contain pre-existing incomplete task checkboxes; none is one of the four entries archived
  in this batch.
- Final archive state: **Owner `ACCEPTED`; locally archived and validated**.
- No push, remote PR mutation, remote merge, release, or other remote operation was performed.
