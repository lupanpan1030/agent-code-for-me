# Tasks: Remove the experimental runtimes

## 1. Pre-flight scope guards (do these before deleting anything)

- [x] 1.1 Confirm the keep/delete boundary in `proposal.md` → "Explicitly NOT changed". Specifically
      verify by reading, not grepping, that `renderer/features/agents/lib/acp-chat-transport.ts` is
      instantiated only for `chatProvider === "codex"`, and that `headless/acp-stdio.ts` has zero
      qwen references.
- [x] 1.2 Re-confirm the router audit behind design.md Decision 6 still holds at implementation
      time: `getManifest` has no `useQuery` reader (only no-op `.invalidate()` calls),
      `checkCapability` has zero call sites, and `respondScopeExpansion` is duplicated at
      `claude.ts:383`. If all three still hold, `agent-runtime.ts` keeps `listManifests` only.
- [x] 1.3 Rewrite the four tests that `readFileSync` files scheduled for deletion, so they fail
      cleanly instead of throwing ENOENT: `agent-runtime-registry.test.ts:304-305`,
      `provider-routing-ux.test.ts:51-54`, `agent-guard-runtime-pipeline.test.ts:185-186`,
      `onboarding-derived-status.test.ts:108-119`. Also invert the router source-text assertions at
      `agent-runtime-registry.test.ts:220-261`.
- [x] 1.4 Neutralize the qwen smoke-evidence gate: delete `package.json` script
      `qwen-acp:smoke:evidence`, delete `scripts/check-qwen-acp-smoke-evidence.mjs`, and delete the
      three coupled blocks in `tests/proof-evidence-gates.test.ts` (`:28-29`, `:86-93`, `:96-107`).
      Leave `openspec/changes/archive/2026-06-23-add-qwen-acp-spike/` untouched.
- [x] 1.5 Capture a baseline: `bun run check` output on the pre-change commit, so later failures are
      attributable.

## 2. Specs first (repo convention — no code until validated) — DONE 2026-08-12

> Deltas were authored in this change directory, then the live `openspec/specs/` tree was
> synchronized manually in the final batch so the 10.3 residue check can pass before archival.
> Because the live specs already contain these deltas (and OpenSpec 1.3.1 rejects an all-removed
> capability as an empty spec), the later archive MUST use
> `openspec archive remove-experimental-runtimes --skip-specs --yes`; applying specs again would
> duplicate this synchronization.

- [x] 2.1 `REMOVED` deltas written: `kun-runtime` (16), `qwen-code-runtime` (7),
      `qwen-cli-setup-guidance` (7).
- [x] 2.2 `REMOVED` deltas written for the three Kun-scoped requirements in
      `provider-runtime-bindings`, and for `Experimental Runtime Desktop Chat Dispatch` in
      `agent-runtime-core`.
- [x] 2.3 `MODIFIED` deltas written for `provider-routing-ux` (2 modified + 1 removed) and
      `agent-chat-attachments` (1), each pasting the FULL requirement body verbatim and adding a
      scenario that *proves* the runtimes are gone.
- [x] 2.4 `openspec validate remove-experimental-runtimes --strict --no-interactive` → valid.
      Repo-wide `--changes` (7/7) and `--specs` (49/49) also pass. Note: this is the repo's first
      `REMOVED` delta and the validator accepted it, so the `MODIFIED`-only fallback is not needed.

## 3. Shared contracts (`src/shared/`)

- [x] 3.1 `agent-runtime-capabilities.ts`: set `EXPERIMENTAL_RUNTIME_IDS` to `[]`; delete
      `shouldEnableKunRuntime`, `resolveKunRuntimeEnabled`, `shouldEnableQwenCodeRuntime`,
      `resolveQwenCodeRuntimeEnabled`, the `allowKunEnvOverride` / `allowQwenEnvOverride` options and
      their switch arms, the `"qwen"` alias, both `toAgentRuntimeId` branches, both manifests
      (`KUN_RUNTIME_MANIFEST`, `QWEN_CODE_RUNTIME_MANIFEST`), and both `AGENT_RUNTIME_MANIFESTS`
      entries.
- [x] 3.2 Verify an empty `EXPERIMENTAL_RUNTIME_IDS` tuple does not break derived types
      (`AgentRuntimeExperimentalId` becomes `never`; check every zod enum built from these ids —
      `z.enum` requires at least one member).
- [x] 3.3 `provider-profile-types.ts` (drop the `kun` target and capability),
      `chat-attachment-capabilities.ts` (drop both union members and both disjuncts),
      `chat-message.ts:354` (drop both from the provider enum).
- [x] 3.4 `agent-chat-provider.ts` — **atomic edit**: remove both ids from `agentChatProviders`,
      from `normalizeAgentChatProvider`, AND from the model-string inference in
      `inferAgentChatProviderFromMessages` (including the `.includes("kun")` substring match) in one
      change. ACCEPTANCE: a unit test asserts an unknown/legacy provider string falls through to
      `"claude-code"` and never returns a string outside the union.
- [x] 3.5 `tsc --noEmit`. The error list is the worklist for sections 4–7.

## 4. Main process

- [x] 4.1 `rm -r src/main/lib/kun/` (8 files, 3,308 lines) and `rm -r src/main/lib/qwen/`
      (4 files, 1,741 lines).
- [x] 4.2 Delete `agent-runtime/desktop-adapter-metadata.ts` entries for both adapters; strip the
      adapter-source union members and guards in `agent-runtime/desktop-runner.ts`.
- [x] 4.3 Strip both runtimes from `agent-runtime/permission-policy.ts` (types, decision codes,
      mapping factories, all switch arms, reason strings, accessors).
- [x] 4.4 Delete `agent-runtime/runtime-feature-settings.ts` entirely and the experimental branches
      in `agent-runtime/runtime-registry.ts`.
- [x] 4.5 Delete `agent-runtime/experimental-runtime-message-history.ts` and its test.
- [x] 4.6 `desktop-agent-jobs.ts`: narrow `DesktopAgentRuntime`, simplify `assertDesktopRuntime`, and
      give `desktopRuntimeLabel()` an **explicit default** rather than an implicit fallthrough.
- [x] 4.7 `provider-profiles/presets.ts`: strip `"kun"` from `targetRuntimes` and `kun: true` from
      `capabilities` in all 13 presets. `provider-profiles/gateway.ts`: drop the capability
      projection, the target filter, and reword the "no Claude, Codex, or Kun runtime target"
      message. `headless/provider-binding.ts`: drop the `kun` target from `parseTargets()`.

## 5. Provider-profile target gate (separate commit — changes save semantics)

- [x] 5.1 `provider-profiles/storage.ts`: remove `kun` from the capabilities schema, the
      `kunRuntimeEnabled` option, `resolveKunRuntimeEnabledForSave`, the exported
      `normalizeProviderProfileTargetsForKunRuntimeGate`, and its call site.
      `trpc/routers/provider-profiles.ts`: remove the gate plumbing.
- [x] 5.2 Rewrite the empty-targets guard so it no longer says
      `"Kun runtime is disabled. Select another provider target."` — that message now fires for a
      legacy kun-only profile and names a runtime that no longer exists.
      ACCEPTANCE: a test loads a profile stored as `target_runtimes_json = ["kun"]`, confirms it
      reads back with empty targets rather than throwing, and re-saves it with a valid target.
- [x] 5.3 Delete `tests/provider-profile-runtime-gate.test.ts` (it exists solely to test this gate).

## 6. tRPC router

- [x] 6.1 Delete the 10 kun procedures and the 4 qwen procedures, plus their imports.
- [x] 6.2 **Delete the guarded-scope-contract path** (`:577-600`) together with the `scopeContract`
      input field (`:100`) and the now-unused `agent-guard` imports (`:10-13`).
      ACCEPTANCE: no code path accepts a scope contract from a desktop chat subscription; grep for
      `prepareActiveGuardedRunContract` returns no router hits.
- [x] 6.3 Remove the shared experimental plumbing the router owns: the `chat` subscription itself,
      the runtime-id input enum, the experimental chat-id type, the tool-approval union,
      `activeRuntimeStreams`, `pendingRuntimeToolApprovals`, the enablement checks, and
      `respondToolApproval`.
- [x] 6.4 Collapse the router to `listManifests` only (design.md Decision 6): also delete
      `getRuntimeFeatureSettings`, `getManifest`, `checkCapability`, and `respondScopeExpansion`.
      Re-point `chat-input-area.tsx:502` at the identical `claude.respondScopeExpansion`, and drop
      the two dead `getManifest.invalidate()` calls in `agents-models-tab.tsx`.
      ACCEPTANCE: `agent-runtime.ts` is ~30 lines with one procedure; `bun run check` green.

## 7. Renderer

- [x] 7.1 Atoms first: delete the kun model-source atoms and family, drop `"kun-cli"` from
      `lib/atoms/index.ts`, and drop `"qwen"` from `OnboardingProviderMode`.
- [x] 7.2 Delete `qwen-chat-transport.ts`, `qwen-ui-stream-normalizer.ts`, and
      `onboarding/components/panels/qwen-action.tsx`. Simplify transport selection in
      `active-chat.tsx` to Codex vs Claude. **Do not touch `acp-chat-transport.ts`.**
- [x] 7.3 `runtime-model-selector.tsx`, `agent-engine-selector.tsx`, `runtime-manifest-store.ts`,
      `provider-profile-editor.tsx`: remove both runtimes and the kun gate.
- [x] 7.4 `new-chat-form.tsx`, `chat-input-area.tsx`, `active-chat.tsx`: remove engine entries,
      status text, run payloads and approval routing for both.
- [x] 7.5 `agents-models-tab.tsx` (~296 kun + qwen refs across 22 blocks): delete the status/reason
      maps, all tRPC hooks and mutation handles, all handlers, the invalidation helpers, both
      runtime toggles, both CLI sections, the section refs and deep-link branches, and the
      `kunRuntimeEnabled` prop. Work ranges **bottom-up** so earlier line numbers stay valid.
      Keep `RECOMMENDED_MODEL` (Ollama).
- [x] 7.6 Onboarding: `ai-path-panel.tsx`, `onboarding-status.ts`, `derive-setup-status.ts`,
      `use-setup-status.ts`. ACCEPTANCE: first-run onboarding shows the remaining paths with no
      empty slot.
- [x] 7.7 **Retire the now-unreachable `runtime-transport` block reason** (review finding, batch 2
      2026-08-12). Batch 2 removed the `provider === "qwen-code" || provider === "kun"` early return
      in `src/shared/chat-attachment-capabilities.ts`, which was its **only** producer — a repo-wide
      grep for `blockReason: "runtime-transport"` now returns zero assignment sites, while the union
      member and two consumer branches survive as dead code. Delete the `"runtime-transport"` member
      from `ChatImageAttachmentBlockReason` (`chat-attachment-capabilities.ts:15`) and its dead
      branches at `src/renderer/features/agents/lib/image-attachment-copy.ts:11` and
      `src/main/lib/chat-attachments.ts:345`, plus the corresponding i18n string if it has a
      dedicated key (fold into section 8 if so).
      ACCEPTANCE: `grep -rn "runtime-transport" src/` returns nothing; `bun run ts:check` clean.
      The `agent-chat-attachments` spec delta has already been updated to remove the scenario, so
      leaving this reason in place would put the code and the spec out of sync.

## 8. i18n (one commit, both locales)

- [x] 8.1 Delete all 89 kun-named keys and ~65 qwen-named keys from `en` **and** their `zhCN` twins
      (219 definitions total). Splitting this across commits is a hard TS error in one direction and
      a silent English fallback in the other.
- [x] 8.2 **Reword, do not delete,** `onboarding.aiPath.engineNote` in both locales — it names both
      dying runtimes in its *value* and has no runtime-scoped key name, so a key-name grep misses it.
      It is rendered at `onboarding/components/ai-path-panel.tsx`.
- [x] 8.3 `tsc --noEmit`. ACCEPTANCE: zero errors — every stale `t()` call surfaces here because
      `TranslationKey` is derived from `en`.

## 9. Cleanup, docs, and stale proposals

- [x] 9.1 One-time startup sweep: unlink `{userData}/kun-cli-settings.json` and
      `{userData}/qwen-cli-settings.json`, recursively remove `{userData}/runtimes/kun/`, and delete
      `{userData}/runtime-feature-settings.json`. Idempotent and guarded; note in the code that it is
      removable in a later release.
- [x] 9.2 Delete the 14 obsolete test suites; update the surviving suites where their rules still
      apply to Claude Code and Codex.
- [x] 9.3 Docs: `CLAUDE.md` (runtime bullets, tech-stack row, Current Status), `PROJECT-MAP.md`,
      `docs/OWNERSHIP_MAP.md`, `docs/tickets/TICKET-001:48`, and a Status note on
      `docs/ideas/cross-engine-delegation.md` (do not silently edit a dated analysis).
- [x] 9.4 Rescope the three active proposals whose text assumes these runtimes exist:
      `update-trpc-capability-boundary/design.md:30` (its High-risk row enumerates 6 kun procedures
      that are about to vanish — this proposal's scope genuinely shrinks),
      `add-headless-provider-binding/design.md:10,:19`,
      `add-local-job-api-runtime-readiness/design.md:10`.

## 10. Verification

- [x] 10.1 `bun run check` (lint + architecture:check + ts:check + test). ACCEPTANCE: green;
      compare the test count against the 1.5 baseline and account for every removed test.
      **Evidence (2026-08-12):** baseline `1462 tests / 264 files`; final
      `1378 tests / 251 files`. Fourteen deleted suites account for `-74` tests, eleven surviving
      suites account for a net `-13`, and the new cleanup suite adds `+3`; therefore
      `-74 - 13 + 3 = -84`. Files close as `-14 + 1 = -13`. The per-suite ledger is recorded in
      `desktop-smoke-evidence.md`.
- [x] 10.2 `openspec validate --strict --no-interactive` across all changes and specs.
- [x] 10.3 Residue gate — **must exclude binary/asset files and permit only reviewed,
      explicitly allowlisted compatibility/removal-proof references**:
      `node scripts/check-retired-runtime-residue.mjs`
      ACCEPTANCE: zero unallowlisted hits; every allowlisted file has a stated reason.
      **Result (2026-08-12): pass — 1108 files scanned, 9 explicitly allowlisted.**
      The original draft used a raw grep with zero-hit acceptance. That criterion was replaced
      during verification because it conflicts with the startup cleanup required by 9.1, the
      negative/rejection tests required by 10.3b, and the protected Ollama `qwen-coder` model
      surface. The mismatch and current raw-grep count are recorded in `verification.md`.
      Two gotchas, both hit during implementation:
      1. A case-insensitive (`-i`) grep produces false positives on `markUnviewed`,
         `RollbackUnsupported`, `SdkUnexpected` — the executable gate uses case-sensitive patterns.
      2. `src/renderer/assets/app-icons/cursor.svg` embeds a base64 PNG whose payload coincidentally
         contains `KunP` and `kunP`. **That is not residue and the asset must NOT be edited.** The
         first implementation attempt XML-entity-escaped the base64 to break the match; it was
         reverted on review. (The decoded PNG sha256 was verified identical before and after, so no
         image damage occurred — but mutating a shipped asset to satisfy a grep fixes the wrong
         thing.) The executable gate excludes asset extensions instead.
- [x] 10.3b **Restore removal-proving test coverage** (review finding, batch 1 2026-08-12).
      Task 1.3 legitimately deleted the source-text assertions in
      `tests/agent-runtime-registry.test.ts` that pinned the *old* router shape — but the surviving
      test now asserts only `listManifests`, which is true both before and after this change, so it
      detects nothing. Nothing currently fails if a later batch forgets a deletion.
      Add **negative** assertions pinning the post-removal state, using the `.not.toContain(...)`
      pattern already used in that file:
      - `agent-runtime.ts` MUST NOT contain `getManifest`, `checkCapability`,
        `respondScopeExpansion`, `getRuntimeFeatureSettings`, `chat: publicProcedure`,
        `respondToolApproval`, `activeRuntimeStreams`, `pendingRuntimeToolApprovals`,
        `scopeContract`, or any `Kun`/`Qwen` symbol.
      - `active-chat.tsx` MUST NOT contain `provider === "kun"` or `provider === "qwen-code"`.
      - `src/shared/agent-runtime-capabilities.ts` MUST NOT contain `KUN_RUNTIME_MANIFEST` or
        `QWEN_CODE_RUNTIME_MANIFEST`.
      These cannot be written before the code is removed (they would fail), which is why they land
      here rather than in section 1. ACCEPTANCE: the new assertions fail if reverted against the
      pre-change tree.
- [x] 10.4 Untouched-surface proof: `grep -rn "qwen" src/main/lib/ollama/ src/main/lib/provider-profiles/presets.ts`
      still returns the Ollama model names and the DashScope preset. ACCEPTANCE: scope guards held.
- [x] 10.5 Desktop smoke (`bun run dev`), recorded in `desktop-smoke-evidence.md`: engine picker
      offers only Claude Code and Codex; Settings → Agents & Models has no Kun or Qwen section and
      no dangling deep-link; onboarding shows no removed engine and the reworded `engineNote` reads
      correctly in **both** locales; a Codex chat runs end to end; a provider profile saves and
      re-saves; the History/Jobs surface lists existing `agent_jobs` rows without throwing.
- [x] 10.6 Confirm `AgentRuntimeId` and `AgentRuntimeContractId` are now structurally identical, and
      decide whether to collapse them (either do it here or file it as a follow-up).
      **Decision:** keep the two public aliases during this pure-removal change; collapse them in
      `docs/tickets/TICKET-108-collapse-agent-runtime-id-types.md` without mixing a broad type/API
      rename into this diff.
