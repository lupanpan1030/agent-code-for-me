# Design: add-runtime-core-import-boundary-guard

## Context

The 2026-07-17 verified audit measured the runtime-core boundary state:

- Direct `electron` imports in `agent-runtime/` + `headless/` + `agent-guard/`: 0.
- Direct tRPC imports in those three dirs: 0.
- `provider-profiles/` has exactly ONE violation:
  `storage.ts:33` → `../trpc/routers/local-api-provider-config` (value import).
- `scripts/check-architecture-guards.mjs` (1220 lines, runs in `bun run check`)
  has ten asserts, all single-owner/vocabulary/router-input rules — no
  import-boundary rule exists.
- Nothing named `RuntimeHostContext`/`HostPaths`/`SecretStore` exists in `src/`.

Known indirect (transitive) reach-throughs — documented so implementers do not
"fix" them in this change (each is reached via a wrapper module, not a direct
import): `agent-runtime/runtime-feature-settings.ts` → `../electron-app`;
`../db` (db/index.ts touches `electron.app`); `headless/provider-binding.ts` →
`../provider-token` → `secure-storage`; `headless/completion-runner.ts` →
`../local-only` (direct electron inside local-only.ts) and →
`../utility-chat-completion`; `headless/runtime-readiness.ts` →
`../claude-credentials` and → `../codex/cli-path` / `../codex/runtime-status`
→ `../electron-app`.

## Goals / Non-Goals

- Goals:
  - Enforce, in CI-equivalent local checks, that the four runtime-core dirs
    stay free of DIRECT electron/tRPC/preload/renderer imports.
  - Fix the one live violation by inverting the dependency (router → lib, never
    lib → router), removing the old import path in the same change per the
    No Duplicate Business Paths requirement.
- Non-Goals (explicitly out of scope; do NOT expand into these):
  - Transitive cleanliness: banning or refactoring the wrapper modules listed
    in Context (`electron-app`, `db`, `secure-storage`, `provider-token`,
    `local-only`, `claude-credentials`, `codex/cli-path`, `codex/runtime-status`,
    `utility-chat-completion`). Deferred until a consumer needs a
    non-Electron-hosted engine.
  - Introducing `RuntimeHostContext` or any host-abstraction interface.
  - Any package/workspace split.
  - `codex.ts` desktop-chat service extraction (separate future change).
  - Renderer changes of any kind.

## Decisions

- Decision: ban DIRECT import specifiers only. Rationale: direct bans are
  zero-false-positive and pass today (after the one inversion); transitive
  analysis needs a module graph and a fatter host abstraction, which has no
  consumer yet. Matching is on import/require specifier text per file, the
  same technique the existing asserts use — no new dependencies.
- Decision: banned specifier categories for files under
  `src/main/lib/{agent-runtime,headless,agent-guard,provider-profiles}/`:
  1. `electron` and `electron/*`
  2. any specifier whose resolved path lands in `src/main/lib/trpc/`
     (relative forms such as `../trpc/...`, `../../trpc/...`)
  3. any specifier resolving into `src/renderer/` or using the `@/` alias
  4. any specifier resolving into `src/preload/`
  Both `import ... from`, `export ... from`, dynamic `import(...)`, and
  `require(...)` count. Type-only imports count too (keeps the rule simple and
  the boundary honest; no type-only imports of these targets exist today).
- Decision: new lib owner `src/main/lib/local-api-provider-config.ts` receives
  (moves, not copies) the non-route logic from the router module:
  `localApiProviderPurposeSchema`, `LocalApiProviderPurpose`,
  `LocalApiProviderRuntimeConfig`, `getLocalApiProviderTokenRequirement`,
  `getStoredProviderRow`, `rowToMetadata`, `getActiveLocalApiProviderConfig`,
  and the private `LocalApiProviderMetadata` type required by `rowToMetadata`.
  The router imports from the lib owner; nothing imports from the router except
  the tRPC app router composition. Sibling routers currently importing via the
  relative `"./local-api-provider-config"` specifier (voice, chats-sub-chats,
  chats-pr, chats-diff, chats-generation) switch to the lib owner. If any
  module outside `trpc/` still imports a moved symbol from the router path
  after the move, that is a task-1 bug, not a reason to re-export.
- Decision: self-test first. The assert validates itself against in-memory
  synthetic fixtures (one violating sample per banned category + one clean
  sample) before scanning the tree, mirroring
  `assertDangerousRouterInputGuardSelfTest`; if the self-test fails, the whole
  guard run fails.
- Alternatives considered: ESLint no-restricted-imports (rejected — repo uses
  Biome, no ESLint infra); dependency-cruiser (rejected — new dependency for
  one rule; the in-house AST/regex checker already owns this class of rule).

## Risks / Trade-offs

- Risk: a hidden importer of a moved symbol breaks `ts:check`. → Mitigation:
  task 1.3 requires a whole-`src/` grep for each moved symbol; `bun run check`
  catches stragglers.
- Risk: specifier-pattern false negatives (e.g. an alias that hides `trpc`).
  → Accepted: the rule is a tripwire, not a proof; the self-test pins the
  patterns that must keep working.
- Risk: collision with active `update-trpc-capability-boundary` edits to the
  same router. → Mitigation: this change keeps the router's procedure surface
  byte-identical apart from imports; land whichever is ready first, rebase the
  other.

## Migration Plan

Single change, no flags. Rollback = revert the commit (guard rule and inversion
are independent commits if implemented in task order, so either can be reverted
alone).

## Open Questions

None.
