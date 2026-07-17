# Tasks: add-runtime-core-import-boundary-guard

## 0. Preconditions

- [ ] 0.1 Confirm `add-local-job-api-completion-kind` is landed (committed +
      archived); `git status` shows no uncommitted edits under
      `src/main/lib/headless/` or to `src/main/lib/utility-chat-completion.ts`.
      HARD STOP if not — do not proceed on a dirty tree.

## 1. Dependency inversion (fix the one live violation)

- [ ] 1.1 Create `src/main/lib/local-api-provider-config.ts` and MOVE (not
      copy) the non-route logic from
      `src/main/lib/trpc/routers/local-api-provider-config.ts`:
      `localApiProviderPurposeSchema`, `LocalApiProviderPurpose`,
      `LocalApiProviderRuntimeConfig`, `getLocalApiProviderTokenRequirement`,
      `getStoredProviderRow`, `rowToMetadata`,
      `getActiveLocalApiProviderConfig`, plus the private
      `LocalApiProviderMetadata` type (router lines 29-36) that `rowToMetadata`
      returns — it moves with `rowToMetadata` and may stay unexported. No logic
      edits; leave no dead copies behind.
- [ ] 1.2 Slim the router module to tRPC procedures only
      (`localApiProviderConfigRouter` and its input schemas), importing the
      moved names from the new lib owner. No re-exports of moved names from the
      router path.
- [ ] 1.3 Update EVERY importer of the moved symbols. Known sites, all of which
      must change:
      - `src/main/lib/provider-profiles/storage.ts:33`
      - `src/main/lib/utility-chat-completion.ts:2-5`
      - sibling routers importing via the RELATIVE specifier
        `"./local-api-provider-config"` (routers importing the lib owner is the
        correct direction): `src/main/lib/trpc/routers/voice.ts:10-13`,
        `chats-sub-chats.ts:36-38`, `chats-pr.ts:36-38`, `chats-diff.ts:36-38`,
        `chats-generation.ts:36-38`
      - `tests/local-api-provider-config-security.test.ts:24-25` (dynamic
        import of `getLocalApiProviderTokenRequirement` +
        `localApiProviderPurposeSchema` from the router path)
      Then grep all of `src/` AND `tests/` for each moved symbol name and for
      BOTH specifier forms — the full path
      `trpc/routers/local-api-provider-config` AND the relative
      `./local-api-provider-config` — to catch stragglers. Renderer code must
      not need changes; if it does, STOP and flag it.
- [ ] 1.4 Behavior unchanged: full existing test suite passes. The ONLY
      permitted test edit is the import-path update in
      `tests/local-api-provider-config-security.test.ts` (task 1.3); no test
      assertion or logic changes anywhere.

## 2. Architecture guard rule

- [ ] 2.1 Add `assertRuntimeCoreImportBoundary()` to
      `scripts/check-architecture-guards.mjs` using the existing
      `walkFiles`/`failures` pattern: for every `.ts` file under
      `src/main/lib/agent-runtime/`, `src/main/lib/headless/`,
      `src/main/lib/agent-guard/`, `src/main/lib/provider-profiles/`, flag any
      import/export-from/dynamic-import/require specifier that is (a)
      `electron` or `electron/*`, (b) resolves into `src/main/lib/trpc/`
      (relative forms like `../trpc/`, `../../trpc/`), (c) resolves into
      `src/renderer/` or starts with `@/`, (d) resolves into `src/preload/`.
      Type-only imports count.
- [ ] 2.2 Failure message names the offending file, the exact specifier, and
      points to the `docs/OWNERSHIP_MAP.md` "Runtime Core Import Boundary"
      section.
- [ ] 2.3 Add a self-test mirroring `assertDangerousRouterInputGuardSelfTest`
      (`scripts/check-architecture-guards.mjs:818`): synthetic in-memory
      fixtures — at least one violating sample per banned category (a–d) plus
      one clean sample — must produce the expected flag/no-flag results before
      the tree scan runs; a failing self-test fails the whole guard run.
- [ ] 2.4 Register the new assert in the runner list at the script tail
      (alongside `assertOwnershipDocs` … `assertCanonicalVocabularyI18n`).

## 3. Docs

- [ ] 3.1 Add a "Runtime Core Import Boundary" section to
      `docs/OWNERSHIP_MAP.md`: the four guarded directories, the four banned
      direct-import categories, the dependency direction rule (routers import
      lib owners, never the reverse), and an explicit note that transitive
      reach-throughs via wrapper modules (`electron-app`, `db`,
      `secure-storage`, `provider-token`, `local-only`, `claude-credentials`,
      `codex/cli-path`, `codex/runtime-status`, `utility-chat-completion`) are
      permitted at this stage and deferred by design.

## 4. Verification

- [ ] 4.1 `bun run check` green (lint, architecture:check, ts:check, full test
      suite); record counts in `verification.md`.
- [ ] 4.2 Negative proof beyond the self-test: temporarily add
      `import "electron"` to one file in each of the four guarded dirs →
      `bun run architecture:check` fails with the new message for each; revert;
      record the observed messages in `verification.md`.
- [ ] 4.3 Positive proof of the inversion: grep shows zero imports of
      `trpc/routers/local-api-provider-config` outside `src/main/lib/trpc/`;
      record the grep command + output in `verification.md`.
- [ ] 4.4 `openspec validate add-runtime-core-import-boundary-guard --strict
      --no-interactive` passes.
