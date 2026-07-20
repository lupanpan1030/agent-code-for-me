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

Representative, non-exhaustive indirect (transitive) reach-throughs are
documented so implementers do not "fix" them in this change (each example is
reached via a wrapper module, not a direct import):
`agent-runtime/runtime-feature-settings.ts` → `../electron-app`; `../db`
(db/index.ts touches `electron.app`); `headless/provider-binding.ts` →
`../provider-token` → `secure-storage`; `headless/completion-runner.ts` →
`../local-only` (direct electron inside local-only.ts) and →
`../utility-chat-completion`; `headless/runtime-readiness.ts` →
`../claude-credentials` and → `../codex/cli-path` / `../codex/runtime-status`
→ `../electron-app`. This list is not an allowlist and does not claim to
enumerate every transitive path.

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
  2. tRPC packages: `@trpc/*`, `trpc-electron`, and
     `trpc-electron/*`
  3. any specifier whose resolved path lands in `src/main/lib/trpc/`
     (relative forms such as `../trpc/...`, `../../trpc/...`)
  4. any specifier resolving into `src/renderer/` or using the `@/` alias
  5. any specifier resolving into `src/preload/`
  Scan `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs`
  files. Static `import ... from`, side-effect `import "..."`,
  `export ... from`, dynamic `import(...)`, and CommonJS loader calls count.
  CommonJS coverage includes direct or parenthesized `require(...)`,
  `module.require(...)`, simple aliases assigned from `require` or
  `module.require`, and loaders created from an imported Node
  `createRequire`. `import type { ... } from` and inline
  `import { type ... } from` count too. Only literal and no-substitution
  template specifiers are classified; import-like text that appears only in
  comments or ordinary string literals does not count.
- Decision: new lib owner `src/main/lib/local-api-provider-config.ts` receives
  (moves, not copies) the non-route logic from the router module:
  `localApiProviderPurposeSchema`, `LocalApiProviderPurpose`,
  `LocalApiProviderRuntimeConfig`, `getLocalApiProviderTokenRequirement`,
  `getStoredProviderRow`, `rowToMetadata`, `getActiveLocalApiProviderConfig`,
  and the private `LocalApiProviderMetadata` type required by `rowToMetadata`.
  This is the complete move list; the router-local input schemas and the
  complete `get`, `save`, and `clear` procedure bodies remain in place. In
  particular, persistence writes, token encryption, secure-storage checks,
  and delete behavior do not move into or expand inside the new owner. The
  router imports the listed helpers from the lib owner; nothing imports those
  helpers from the router. Sibling routers currently importing via the
  relative `"./local-api-provider-config"` specifier (voice, chats-sub-chats,
  chats-pr, chats-diff, chats-generation) switch to the lib owner. If any
  module still imports a moved symbol from the router path after the move,
  that is a task-1 bug, not a reason to re-export.
- Decision: self-test first. The assert validates itself against in-memory
  synthetic fixtures before scanning the tree, mirroring
  `assertDangerousRouterInputGuardSelfTest`. The fixture matrix covers every
  banned category, every scanned extension, static and side-effect imports,
  export-from, dynamic import, direct and parenthesized require,
  `module.require`, simple require/createRequire aliases,
  `import type { ... }`, and `import { type ... }`; it also includes an
  allowed import, an ordinary string containing import-like text, and a
  comment containing a banned-looking import. The expected finding set must
  match exactly, so both a missed violation and a clean/comment false positive
  fail the whole guard run.
- Alternatives considered: ESLint no-restricted-imports (rejected — repo uses
  Biome, no ESLint infra); dependency-cruiser (rejected — new dependency for
  one rule; the in-house AST/regex checker already owns this class of rule).

## Risks / Trade-offs

- Risk: a hidden importer of a moved symbol breaks `ts:check`. → Mitigation:
  task 1.3 requires a whole-`src/` grep for each moved symbol; `bun run check`
  catches stragglers.
- Risk: specifier-pattern false negatives through computed specifiers,
  arbitrary wrapper functions, or dynamically reassigned loader aliases.
  → Accepted: the rule is a direct-dependency tripwire, not a whole-program
  proof; the self-test pins the literal and simple-alias forms that must keep
  working.
- Risk: collision with active `update-trpc-capability-boundary` edits to the
  same router. → Mitigation: this change keeps the router's procedure surface
  byte-identical apart from imports; land whichever is ready first, rebase the
  other.

## Migration Plan

Single change, no flags. Commit granularity is not prescribed by task order.
Rollback the guard, ownership-map documentation, import-path updates, and
dependency inversion together. If an emergency rollback must be staged, remove
the guard before restoring the old lib-to-router import; reverting the
inversion alone while the guard remains active would intentionally fail the
architecture check.

## Open Questions

None.
