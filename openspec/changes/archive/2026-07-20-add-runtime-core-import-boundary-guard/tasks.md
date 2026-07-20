# Tasks: add-runtime-core-import-boundary-guard

## 0. Preconditions

- [x] 0.1 Confirm `add-local-job-api-completion-kind` is landed (committed +
      archived), as recorded in proposal.md; `git status` shows no uncommitted
      edits under
      `src/main/lib/headless/` or to `src/main/lib/utility-chat-completion.ts`.
      HARD STOP if not — do not proceed on a dirty tree.

## 1. Dependency inversion (fix the one live violation)

- [x] 1.1 Create `src/main/lib/local-api-provider-config.ts` and MOVE (not
      copy) the non-route logic from
      `src/main/lib/trpc/routers/local-api-provider-config.ts`:
      `localApiProviderPurposeSchema`, `LocalApiProviderPurpose`,
      `LocalApiProviderRuntimeConfig`, `getLocalApiProviderTokenRequirement`,
      `getStoredProviderRow`, `rowToMetadata`,
      `getActiveLocalApiProviderConfig`, plus the private
      `LocalApiProviderMetadata` type (router lines 29-36) that `rowToMetadata`
      returns — it moves with `rowToMetadata` and may stay unexported. No logic
      edits; export moved helpers only where the router or existing importers
      require them, and leave no dead copies behind.
- [x] 1.2 Slim the router module to tRPC procedures only
      (`localApiProviderConfigRouter` and its input schemas), importing the
      moved names from the new lib owner. Keep the complete `get`, `save`, and
      `clear` procedure bodies in the router, including persistence writes,
      token encryption, secure-storage checks, and delete behavior; do not
      extract, redesign, or expand those bodies. No symbols beyond the exact
      task-1.1 list move, and there are no re-exports of moved names from the
      router path.
- [x] 1.3 Update EVERY importer of the moved symbols. Known sites, all of which
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
- [x] 1.4 Behavior unchanged: full existing test suite passes. The ONLY
      permitted test edit is the import-path update in
      `tests/local-api-provider-config-security.test.ts` (task 1.3); no test
      assertion or logic changes anywhere.

## 2. Architecture guard rule

- [x] 2.1 Add `assertRuntimeCoreImportBoundary()` to
      `scripts/check-architecture-guards.mjs` using the existing
      `walkFiles`/`failures` pattern: for every `.ts`, `.tsx`, `.mts`, `.cts`,
      `.js`, `.jsx`, `.mjs`, and `.cjs` file under
      `src/main/lib/agent-runtime/`, `src/main/lib/headless/`,
      `src/main/lib/agent-guard/`, `src/main/lib/provider-profiles/`, flag any
      import/export-from/dynamic-import/require specifier that is (a)
      `electron` or `electron/*`, (b) `@trpc/*`, `trpc-electron`, or
      `trpc-electron/*`, (c) resolves into `src/main/lib/trpc/` (relative
      forms like `../trpc/`, `../../trpc/`), (d) resolves into
      `src/renderer/` or starts with `@/`, or (e) resolves into `src/preload/`.
      Static imports, side-effect imports, export-from, dynamic imports, and
      CommonJS loader calls count. CommonJS coverage includes direct and
      parenthesized `require(...)`, `module.require(...)`, simple aliases
      assigned from `require`/`module.require`, and loaders created from an
      imported Node `createRequire`. Both `import type { ... }` and
      `import { type ... }` count. Ignore import-like text found only in
      comments or ordinary string literals.
- [x] 2.2 Failure message names the offending file, the exact specifier, and
      points to the `docs/OWNERSHIP_MAP.md` "Runtime Core Import Boundary"
      section.
- [x] 2.3 Add a self-test mirroring
      `assertDangerousRouterInputGuardSelfTest` that runs before the tree scan.
      Its synthetic in-memory fixture matrix MUST cover:
      - every banned category (a–e);
      - every scanned extension (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`,
        `.mjs`, `.cjs`);
      - static `import ... from`, side-effect `import "..."`,
        `export ... from`, dynamic `import(...)`, direct and parenthesized
        `require(...)`, `module.require(...)`, simple
        `require`/`module.require` aliases, imported Node `createRequire`
        loaders, `import type { ... } from`, and
        `import { type ... } from`;
      - a clean allowed import, an ordinary string containing import-like text,
        and a comment containing a banned-looking import.
      Assert the exact expected findings so a missed violation or any
      clean/comment false positive fails the whole guard run.
- [x] 2.4 Register the new assert in the runner list at the script tail
      (alongside `assertOwnershipDocs` … `assertCanonicalVocabularyI18n`).

## 3. Docs

- [x] 3.1 Add a "Runtime Core Import Boundary" section to
      `docs/OWNERSHIP_MAP.md`: the four guarded directories, the five banned
      direct-import categories, the dependency direction rule (routers import
      lib owners, never the reverse — specifically the local API provider
      config lib owner and its router), and an explicit note that
      representative,
      non-exhaustive transitive reach-throughs via wrapper modules
      (`electron-app`, `db`, `secure-storage`, `provider-token`, `local-only`,
      `claude-credentials`, `codex/cli-path`, `codex/runtime-status`,
      `utility-chat-completion`) are permitted at this stage and deferred by
      design.

## 4. Verification

- [x] 4.1 `bun run check` green (lint, architecture:check, ts:check, full test
      suite); record counts in `verification.md`.
- [x] 4.2 Negative proof beyond the self-test: temporarily add
      `import "electron"` to one file in each of the four guarded dirs →
      `bun run architecture:check` fails and names all four files/specifiers.
      Then create temporary sentinel files under one guarded directory that,
      across `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs`,
      exercise every banned category and every syntax form from task 2.3;
      verify every sentinel is reported, including the CommonJS loader forms.
      Remove all temporary edits/files and record commands, expected findings,
      and observed messages in `verification.md`.
- [x] 4.3 False-positive proof beyond the self-test: temporarily create clean
      and comment-only sentinels under a guarded directory, including an
      allowed import, an ordinary string with banned-looking import text, and
      a comment with a banned-looking import; `bun run architecture:check`
      remains green. Remove the sentinels and record commands/results in
      `verification.md`.
- [x] 4.4 Positive proof of the inversion: grep shows zero imports of
      `trpc/routers/local-api-provider-config` outside `src/main/lib/trpc/`;
      grep also shows zero moved-symbol imports from the router path and all
      known sibling/test importers point to the lib owner; record commands and
      output in `verification.md`.
- [x] 4.5 `openspec validate add-runtime-core-import-boundary-guard --strict
      --no-interactive` passes.
