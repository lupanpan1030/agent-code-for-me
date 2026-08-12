# Design: Remove the experimental runtimes

## Context

`EXPERIMENTAL_RUNTIME_IDS = ["qwen-code", "kun"]` (`src/shared/agent-runtime-capabilities.ts:2`) sits
beside `CONTRACT_RUNTIME_IDS = ["claude-code", "codex"]`. Everything experimental — a persisted
Settings gate, a shared tRPC `chat` subscription, a shared renderer transport, a shared message
history store, two capability manifests, and 30 ratified spec requirements — exists to serve those
two ids. Removing both empties the set, which is what makes this a deletion rather than a refactor.

The two runtimes are also asymmetric in a way that matters for sequencing: `kun` is the *only*
runtime allowed to carry a guarded scope contract (`trpc/routers/agent-runtime.ts:578` rejects
`scopeContract` for every other runtime), while `qwen-code` has no agent-guard integration at all.
That asymmetry makes a staged removal actively dangerous — see Decision 2.

## Goals

- Delete both runtimes and every mechanism that exists only for them, leaving no half-alive scaffold.
- Keep `CONTRACT_RUNTIME_IDS`-scoped surfaces (Local Job API, headless, `locus acp`, schedules)
  bit-for-bit unchanged.
- End with `AgentRuntimeId ≡ AgentRuntimeContractId` and no experimental branch anywhere.

## Non-Goals

- **Not** renaming anything. `acp-chat-transport.ts` keeps its misleading name (it is Codex's); a
  rename belongs in its own change so this diff stays a pure removal.
- **Not** touching `openspec/changes/archive/**`. Archived changes are historical record.
- **Not** removing Qwen *models* or DashScope/Ollama support. Only the `qwen-code` **runtime** goes.
- **Not** adding a replacement extension point for future runtimes. If a third runtime is ever
  wanted, it gets designed then, informed by this removal.

## Decisions

**Decision 1: One change, not two.**
Remove both runtimes in a single change.
*Alternative considered:* two changes (`remove-qwen-code-runtime`, then `remove-kun-runtime`).
*Rejected* — staging leaves shared machinery in a deliberately broken interim state:
`qwen-chat-transport.ts:36` **defaults** `runtimeId` to `"qwen-code"` and would have to be flipped
to `"kun"` and then deleted; `qwen-ui-stream-normalizer.ts` exports runtime-neutral helpers that
must survive stage 1 and die in stage 2; `agents-models-tab.tsx:2990` renders the **Kun** section
using the `settings.models.qwenCli.docs` key, so a qwen-first stage breaks Kun's UI; and
`experimental-runtime-message-history.ts` plus `agent-runtime-core`'s
`Experimental Runtime Desktop Chat Dispatch` requirement would each survive serving exactly one
runtime. Every one of those is churn that a combined change simply deletes.

**Decision 2: Delete the guarded-scope-contract path and its input field together.**
`agent-runtime.ts:577-600` accepts a `scopeContract` only when `runtimeId === "kun"`.
*Alternative considered:* drop just the `!== "kun"` guard and let the path stay generic.
*Rejected* — that would expose a guarded-run path to `qwen-code`, which has **no agent-guard
enforcement**, i.e. a security regression introduced by a cleanup. Since both runtimes go, the whole
branch is unreachable: delete it, the `scopeContract` field on the input schema (`:100`), and the
now-unused `agent-guard` imports (`:10-13`).

**Decision 3: No legacy-value retention, because there is no legacy data.**
Normally this change would keep `"kun"` and `"qwen-code"` as read-only enum values in
`chat-message.ts:354` so historical transcripts still hydrate.
*Alternative considered:* retain them defensively anyway ("costs nothing").
*Rejected* — verified 2026-08-12 that this installation has zero rows for either runtime (339
`agent_jobs`, all `codex`; zero `sub_chats`), and Locus has no other users. Retaining dead enum
members would leave exactly the kind of unexplained residue this pruning exists to remove. The
verification step still opens the app against the real profile directory to confirm.

**Decision 4: Encode the removal with `REMOVED` deltas, against local precedent.**
The three dying capability dirs get `## REMOVED Requirements` blocks and are then deleted.
*Alternative considered:* the `remove-codex-acp-temporary-compat` pattern — `MODIFIED`-only deltas
carrying removal-*proving* scenarios, which is what this repo has actually done (0 `REMOVED` across
109 changes).
*Rejected for the dying dirs, adopted for the survivors.* That precedent removed a transport from
*within* surviving capabilities, so `MODIFIED` was the honest op. Here three whole capabilities
cease to exist, and `openspec/AGENTS.md:191-195` specifies `REMOVED` for exactly that. The
precedent's good habit is still adopted where it applies: the surviving `provider-routing-ux` and
`agent-chat-attachments` requirements are `MODIFIED` with scenarios that *prove* the runtimes are
gone rather than merely omitting them.

**Decision 5: Sweep orphaned on-disk state once, at startup.**
Delete `{userData}/kun-cli-settings.json`, `{userData}/qwen-cli-settings.json`,
`{userData}/runtimes/kun/` (potentially hundreds of MB of third-party binary), and
`{userData}/runtime-feature-settings.json`.
*Alternative considered:* leave them; they are inert.
*Rejected* for `runtimes/kun/` specifically — inert is not the same as free when it is disk. The
sweep is idempotent, guarded, and removed in a later release.

## Risks / Trade-offs

- **The renderer edits are the bulk of the diff and the least type-checked.**
  `agents-models-tab.tsx` alone has ~296 kun references across 22 contiguous blocks.
  → *Mitigation:* work ranges bottom-up so earlier line numbers stay valid; lean on
  `TranslationKey` (a deleted i18n key surfaces every stale `t()` call as a compile error).
- **Source-text assertions crash rather than fail.** Four test files `readFileSync` modules being
  deleted. → *Mitigation:* task 1.3 rewrites them **before** any deletion.
- **A provider profile whose only target was `kun` becomes unsaveable** with a message naming a
  runtime that no longer exists. → *Mitigation:* task 5.2 rewrites the guard and adds a regression
  test that loads and re-saves a profile stored as `target_runtimes_json = ["kun"]`.
- **First `REMOVED` delta in repo history**; validator behaviour unproven.
  → *Mitigation:* task 2.4 runs `openspec validate --strict` on the deltas alone, before code.
- **Trade-off accepted:** removing the feature-gate mechanism means a future third runtime must
  rebuild an enablement path. That is deliberate — the current one was built for two runtimes that
  are being deleted, and a future runtime's requirements are unknown.

## Migration Plan

1. Land the spec deltas and validate them, before touching code.
2. Rewrite the four source-text-asserting tests and neutralize the qwen smoke-evidence gate, so the
   suite stays green throughout.
3. Narrow `src/shared/` contracts. Typecheck — the compiler now enumerates the remaining work.
4. Delete `src/main/lib/{kun,qwen}/`, then the main-process references in dependency order.
5. Tear down the provider-profile target gate as its own commit (it changes save semantics).
6. Strip the tRPC router, then the renderer, then i18n (one commit, both locales).
7. Delete dead shared plumbing, add the startup sweep, update docs.
8. Verify: `bun run check`, `openspec validate --strict`, residue grep, and a desktop smoke.

**Rollback:** every step is a plain deletion with no data migration and no schema change, so
reverting the branch fully restores prior behaviour. The only irreversible action is the startup
sweep of `{userData}/runtimes/kun/`; it runs last and only removes a re-downloadable third-party
binary Locus can no longer install anyway (the managed-install allowlist is empty).

**Decision 6: Keep `agent-runtime.ts` as a one-procedure router.**
Of its 21 procedures, 17 are removed by this change. Of the 4 that remain, only one is live:

| Remaining procedure | Status |
| --- | --- |
| `listManifests` | **Live** — 3 renderer call sites (`runtime-manifest-store.ts:40`, `use-setup-status.ts:63`, `agents-models-tab.tsx:1567`). |
| `getManifest` | **No readers.** Appears only as `.invalidate()` at `agents-models-tab.tsx:1649,:1660`; no `useQuery` anywhere, so those invalidations are no-ops. Delete. |
| `checkCapability` | **Zero call sites** anywhere in `src/`. Delete. |
| `respondScopeExpansion` | **Duplicate.** `claude.ts:383` declares an identical procedure over the same `respondDesktopScopeExpansion(input)`; the renderer's single call site (`chat-input-area.tsx:502`) can point at that one. Delete. |

So the file collapses from 948 lines to roughly 30.
*Alternative considered:* fold `listManifests` into `claude.ts` or `codex.ts` and delete the file.
*Rejected* — the runtime capability manifest is runtime-neutral data, and hanging it off a
single engine's router is exactly the per-engine ownership drift `docs/OWNERSHIP_MAP.md` exists to
prevent. A ~30-line honest router is cheaper than that drift, and it is the natural home should a
third runtime ever be introduced.

## Open Questions

- **Follow-up, deliberately out of scope here:** `checkCapability` having zero call sites means the
  runtime capability manifest is never enforced at execution time — it is only *displayed*. Deleting
  the endpoint does not lose enforcement (there was none), but it does remove the appearance of it.
  Whether the manifest should become enforcing, or should be documented as advisory-only, deserves
  its own change.
