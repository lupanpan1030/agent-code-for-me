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
  router keeps only tRPC procedures and imports from the lib owner. Update all
  importers — `provider-profiles/storage.ts`, `utility-chat-completion.ts`,
  five sibling routers (voice, chats-sub-chats, chats-pr, chats-diff,
  chats-generation), and one test import; the full enumeration is in tasks.md
  1.3. No behavior change.
- Add an `assertRuntimeCoreImportBoundary` rule to
  `scripts/check-architecture-guards.mjs` (already wired into `bun run check`
  via `architecture:check`): files under the four runtime-core directories MUST
  NOT directly import `electron`, `src/main/lib/trpc/` modules, `src/preload/`
  code, or `src/renderer/` code (including the `@/` renderer alias). Direct
  import specifiers only — transitive reach-throughs via wrapper modules are
  explicitly out of scope (see design.md Non-Goals).
- Add a self-test for the new rule following the existing
  `assertDangerousRouterInputGuardSelfTest` pattern
  (`scripts/check-architecture-guards.mjs:818`), failing closed if the rule
  cannot detect a synthetic violation.
- Document the boundary in `docs/OWNERSHIP_MAP.md`.

No breaking changes. No schema, contract, renderer, or packaging changes.

## Preconditions

- `add-local-job-api-completion-kind` MUST be landed (committed + archived)
  first: `utility-chat-completion.ts` and `headless/completion-runner.ts` are
  currently uncommitted working-tree files belonging to that change, and this
  change edits one of them.

## Impact

- Affected specs: `architecture-ownership`
- Affected code:
  - `scripts/check-architecture-guards.mjs` (new assert + self-test + runner registration)
  - `src/main/lib/local-api-provider-config.ts` (new lib owner)
  - `src/main/lib/trpc/routers/local-api-provider-config.ts` (slimmed to route envelope)
  - `src/main/lib/provider-profiles/storage.ts` (import path fix)
  - `src/main/lib/utility-chat-completion.ts` (import path fix)
  - `docs/OWNERSHIP_MAP.md` (new boundary section)
- Coordination: `update-trpc-capability-boundary` (active change) also touches
  router files; this change only moves read logic out of one router and does
  not alter renderer-reachable procedure surfaces, but sequence the two to
  avoid merge noise in `local-api-provider-config.ts`. Note for whoever picks
  that change up next: its design.md:33 cites `local-api-provider-config.ts:118`
  for `save`/`clear`, which is already stale (`save` starts at line 130 today)
  and will shift again after this router is slimmed.
