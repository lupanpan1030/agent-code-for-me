# Change: Add runtime-core import boundary guard

## Why

A verified audit (2026-07-17) confirmed the runtime-core main-process
directories (`src/main/lib/agent-runtime/`, `src/main/lib/headless/`,
`src/main/lib/agent-guard/`, `src/main/lib/provider-profiles/`) are almost
clean of direct `electron` and tRPC imports — but nothing enforces that
boundary, and one live violation exists today:
`src/main/lib/provider-profiles/storage.ts:33` value-imports
`getActiveLocalApiProviderConfig` from `../trpc/routers/local-api-provider-config`
(lib → router, wrong dependency direction). `src/main/lib/utility-chat-completion.ts`
has the same wrong-direction import, which gives `headless/completion-runner.ts`
a transitive reach into tRPC route code. Without a guard, every future change
can silently reintroduce electron/tRPC/renderer coupling into the engine core,
which is what makes the codebase feel tangled and blocks any later extraction.

## What Changes

- Extract the non-route local API provider config read logic out of
  `src/main/lib/trpc/routers/local-api-provider-config.ts` into a new
  main-process lib owner (`src/main/lib/local-api-provider-config.ts`); the
  router imports those helpers from the lib owner. Only the symbols enumerated
  in tasks.md 1.1 move: the `get`, `save`, and `clear` procedure bodies and
  route-local input schemas stay in the router and are not refactored or
  expanded. Update all importers — `provider-profiles/storage.ts`,
  `utility-chat-completion.ts`, five sibling routers (voice, chats-sub-chats,
  chats-pr, chats-diff, chats-generation), and one test import; the full
  enumeration is in tasks.md 1.3. No behavior change.
- Add an `assertRuntimeCoreImportBoundary` rule to
  `scripts/check-architecture-guards.mjs` (already wired into `bun run check`
  via `architecture:check`): `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`,
  `.mjs`, and `.cjs` files under the four runtime-core directories MUST NOT
  directly import `electron`, tRPC packages (`@trpc/*` or `trpc-electron`),
  `src/main/lib/trpc/` modules, `src/preload/` code, or `src/renderer/` code
  (including the `@/` renderer alias). Direct import specifiers only —
  transitive reach-throughs via wrapper modules are explicitly out of scope
  (see design.md Non-Goals).
- Add a self-test for the new rule following the existing
  `assertDangerousRouterInputGuardSelfTest` pattern. It covers static imports,
  side-effect imports, export-from, dynamic imports, direct and parenthesized
  `require`, `module.require`, simple `require`/`createRequire` aliases, both
  `import type` forms, every banned category, every scanned extension, and
  clean/comment-only false-positive cases; it fails closed on any mismatch.
- Document the boundary in `docs/OWNERSHIP_MAP.md`.

No breaking changes. No schema, contract, renderer, or packaging changes.

## Preconditions

- `add-local-job-api-completion-kind` has been landed (committed + archived),
  satisfying this change's sequencing prerequisite. Implementation still MUST
  begin from a tree with no uncommitted edits under `src/main/lib/headless/` or
  to `src/main/lib/utility-chat-completion.ts`; task 0.1 verifies that state.

## Impact

- Affected specs: `architecture-ownership`
- Affected code:
  - `scripts/check-architecture-guards.mjs` (new assert + self-test + runner registration)
  - `src/main/lib/local-api-provider-config.ts` (new lib owner)
  - `src/main/lib/trpc/routers/local-api-provider-config.ts` (read helpers
    removed; procedure bodies unchanged)
  - `src/main/lib/provider-profiles/storage.ts` (import path fix)
  - `src/main/lib/utility-chat-completion.ts` (import path fix)
  - `src/main/lib/trpc/routers/voice.ts` (import path fix)
  - `src/main/lib/trpc/routers/chats-sub-chats.ts` (import path fix)
  - `src/main/lib/trpc/routers/chats-pr.ts` (import path fix)
  - `src/main/lib/trpc/routers/chats-diff.ts` (import path fix)
  - `src/main/lib/trpc/routers/chats-generation.ts` (import path fix)
  - `tests/local-api-provider-config-security.test.ts` (import path fix only)
  - `docs/OWNERSHIP_MAP.md` (new boundary section)
  - `openspec/changes/add-runtime-core-import-boundary-guard/verification.md`
    (implementation evidence)
- Coordination: `update-trpc-capability-boundary` (active change) also touches
  router files; this change only moves read logic out of one router and does
  not alter renderer-reachable procedure surfaces, but sequence the two to
  avoid merge noise in `local-api-provider-config.ts`. Note for whoever picks
  that change up next: its design.md:33 cites `local-api-provider-config.ts:118`
  for `save`/`clear`, which is already stale (`save` starts at line 130 today)
  and will shift again after this router is slimmed.
