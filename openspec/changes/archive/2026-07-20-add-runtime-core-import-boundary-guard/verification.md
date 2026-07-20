# Verification: add-runtime-core-import-boundary-guard

Date: 2026-07-18 (Pacific/Auckland)

## Preconditions

- Implementation started from clean local `main` commit `5776cdf4`.
- `add-local-job-api-completion-kind` was already committed and archived under
  `openspec/changes/archive/2026-07-17-add-local-job-api-completion-kind/`.
- No pre-existing edits were present under `src/main/lib/headless/` or in
  `src/main/lib/utility-chat-completion.ts`.

## Automated Checks

- `bun run check`
  - Result: pass.
  - `lint:changed`: pass. Biome reported only legacy unused-import diagnostics
    outside changed lines in the split chat routers.
  - `architecture:check`: pass.
  - `tsc --noEmit`: pass.
  - Tests: `1434 pass`, `0 fail`, `7299 expect()` calls across 259 files.
- `bun test tests/local-api-provider-config-security.test.ts`
  - Result: `3 pass`, `0 fail`, `7 expect()` calls.
- `openspec validate add-runtime-core-import-boundary-guard --strict
  --no-interactive`
  - Result: `Change 'add-runtime-core-import-boundary-guard' is valid`.
- `openspec validate --all --strict --no-interactive`
  - Result: `60 passed`, `0 failed`.
- `git diff --check`
  - Result: pass.

## Four-Directory Negative Proof

Temporary `__runtime_core_boundary_negative_fixture__.ts` files containing
exactly `import "electron"` were added by patch simultaneously under:

- `src/main/lib/agent-runtime/`
- `src/main/lib/headless/`
- `src/main/lib/agent-guard/`
- `src/main/lib/provider-profiles/`

Executed command:

```text
bun run architecture:check
```

Observed exit code: 1. Observed findings:

```text
src/main/lib/agent-runtime/__runtime_core_boundary_negative_fixture__.ts directly imports banned Electron dependency "electron" via side-effect import declaration; see docs/OWNERSHIP_MAP.md "Runtime Core Import Boundary".
src/main/lib/headless/__runtime_core_boundary_negative_fixture__.ts directly imports banned Electron dependency "electron" via side-effect import declaration; see docs/OWNERSHIP_MAP.md "Runtime Core Import Boundary".
src/main/lib/agent-guard/__runtime_core_boundary_negative_fixture__.ts directly imports banned Electron dependency "electron" via side-effect import declaration; see docs/OWNERSHIP_MAP.md "Runtime Core Import Boundary".
src/main/lib/provider-profiles/__runtime_core_boundary_negative_fixture__.ts directly imports banned Electron dependency "electron" via side-effect import declaration; see docs/OWNERSHIP_MAP.md "Runtime Core Import Boundary".
```

The four temporary files were removed by a deletion patch.

## Extension, Category, and Syntax Matrix

Eight temporary `__runtime_core_boundary_matrix_*` files were added by patch
under `src/main/lib/agent-runtime/`. Their exact specifiers and syntax were:

| Extension | Specifier | Syntax reported | Category |
| --- | --- | --- | --- |
| `.ts` | `electron/main` | side-effect import declaration | Electron |
| `.tsx` | `@trpc/server` | type-only import declaration | tRPC |
| `.mts` | `@trpc/server` | import declaration (inline type) | tRPC |
| `.cts` | `trpc-electron/main` | export-from declaration | tRPC |
| `.js` | `../../../renderer/lib/atoms` | dynamic import | renderer |
| `.jsx` | `../../../preload/index` | require call | preload |
| `.mjs` | `../trpc/routers/index` | import declaration | tRPC |
| `.cjs` | `@/features/agents` | require call | renderer |

Executed command:

```text
bun run architecture:check
```

Observed exit code: 1. Observed findings:

```text
src/main/lib/agent-runtime/__runtime_core_boundary_matrix_alias__.cjs directly imports banned renderer dependency "@/features/agents" via require call; see docs/OWNERSHIP_MAP.md "Runtime Core Import Boundary".
src/main/lib/agent-runtime/__runtime_core_boundary_matrix_dynamic__.js directly imports banned renderer dependency "../../../renderer/lib/atoms" via dynamic import; see docs/OWNERSHIP_MAP.md "Runtime Core Import Boundary".
src/main/lib/agent-runtime/__runtime_core_boundary_matrix_electron__.ts directly imports banned Electron dependency "electron/main" via side-effect import declaration; see docs/OWNERSHIP_MAP.md "Runtime Core Import Boundary".
src/main/lib/agent-runtime/__runtime_core_boundary_matrix_export__.cts directly imports banned tRPC dependency "trpc-electron/main" via export-from declaration; see docs/OWNERSHIP_MAP.md "Runtime Core Import Boundary".
src/main/lib/agent-runtime/__runtime_core_boundary_matrix_inline_type__.mts directly imports banned tRPC dependency "@trpc/server" via import declaration; see docs/OWNERSHIP_MAP.md "Runtime Core Import Boundary".
src/main/lib/agent-runtime/__runtime_core_boundary_matrix_require__.jsx directly imports banned preload dependency "../../../preload/index" via require call; see docs/OWNERSHIP_MAP.md "Runtime Core Import Boundary".
src/main/lib/agent-runtime/__runtime_core_boundary_matrix_static__.mjs directly imports banned tRPC dependency "../trpc/routers/index" via import declaration; see docs/OWNERSHIP_MAP.md "Runtime Core Import Boundary".
src/main/lib/agent-runtime/__runtime_core_boundary_matrix_type__.tsx directly imports banned tRPC dependency "@trpc/server" via type-only import declaration; see docs/OWNERSHIP_MAP.md "Runtime Core Import Boundary".
```

All eight files were removed by a deletion patch.

The guard's in-memory fail-closed self-test additionally covers import-equals
and inline `import("...")` type nodes.

## CommonJS Loader Negative Proof

Six additional temporary files were added by patch under
`src/main/lib/agent-runtime/` with these exact loader forms:

| File suffix | Loader form | Banned specifier |
| --- | --- | --- |
| `parenthesized_require.cjs` | `(require)("electron")` | `electron` |
| `module_require.js` | `module.require("@trpc/server")` | `@trpc/server` |
| `module_require_alias.cjs` | `const load = module["require"]; load("trpc-electron/main")` | `trpc-electron/main` |
| `require_alias.ts` | `const load = require; const loadAgain = load; loadAgain("@/features/agents")` | `@/features/agents` |
| `create_require_alias.mts` | named `createRequire` import → `load("../../../preload/index")` | `../../../preload/index` |
| `inline_create_require.mjs` | `nodeModule.createRequire(import.meta.url)("electron/main")` | `electron/main` |

Executed command:

```text
bun run architecture:check
```

Observed exit code: 1 in both runs. The first run exercised five files
simultaneously; a second targeted run exercised the `module.require` alias.
Observed findings:

```text
src/main/lib/agent-runtime/__runtime_core_boundary_create_require_alias__.mts directly imports banned preload dependency "../../../preload/index" via createRequire alias call; see docs/OWNERSHIP_MAP.md "Runtime Core Import Boundary".
src/main/lib/agent-runtime/__runtime_core_boundary_inline_create_require__.mjs directly imports banned Electron dependency "electron/main" via createRequire call; see docs/OWNERSHIP_MAP.md "Runtime Core Import Boundary".
src/main/lib/agent-runtime/__runtime_core_boundary_module_require__.js directly imports banned tRPC dependency "@trpc/server" via module.require call; see docs/OWNERSHIP_MAP.md "Runtime Core Import Boundary".
src/main/lib/agent-runtime/__runtime_core_boundary_parenthesized_require__.cjs directly imports banned Electron dependency "electron" via require call; see docs/OWNERSHIP_MAP.md "Runtime Core Import Boundary".
src/main/lib/agent-runtime/__runtime_core_boundary_require_alias__.ts directly imports banned renderer dependency "@/features/agents" via require alias call; see docs/OWNERSHIP_MAP.md "Runtime Core Import Boundary".
src/main/lib/agent-runtime/__runtime_core_boundary_module_require_alias__.cjs directly imports banned tRPC dependency "trpc-electron/main" via module.require alias call; see docs/OWNERSHIP_MAP.md "Runtime Core Import Boundary".
```

All six files were removed by deletion patches.

## False-Positive Proof

A temporary patched file
`src/main/lib/agent-runtime/__runtime_core_boundary_clean_fixture__.cjs`
contained:

```js
const allowed = require("./runtime-events")
const packageName = "electron"
const importExample = 'import type { AnyRouter } from "@trpc/server"'
const requireExample = "module.require('trpc-electron')"

// import "../../../renderer/index"
/* require("../../../preload/index") */
```

Executed `bun run architecture:check`; observed exit code 0 and
`Architecture guard passed.` The clean fixture was removed by a deletion
patch. Final cleanup command:

```text
find src/main/lib/agent-runtime src/main/lib/headless \
  src/main/lib/agent-guard src/main/lib/provider-profiles \
  -type f -name '*runtime_core_boundary*' -print
```

Observed output: none.

## Dependency-Inversion Proof

Old router-path command:

```text
rg -n 'trpc/routers/local-api-provider-config' src tests
```

Observed status: 1, meaning zero matches.

Known-owner import command:

```text
rg -n 'local-api-provider-config' \
  src/main/lib/provider-profiles/storage.ts \
  src/main/lib/utility-chat-completion.ts \
  src/main/lib/trpc/routers/local-api-provider-config.ts \
  src/main/lib/trpc/routers/voice.ts \
  src/main/lib/trpc/routers/chats-{sub-chats,pr,diff,generation}.ts \
  tests/local-api-provider-config-security.test.ts
```

Observed owner imports:

- `src/main/lib/provider-profiles/storage.ts:27`:
  `../local-api-provider-config`
- `src/main/lib/utility-chat-completion.ts:4`:
  `./local-api-provider-config`
- local API config router and five sibling routers:
  `../../local-api-provider-config`
- `tests/local-api-provider-config-security.test.ts:25`:
  `../src/main/lib/local-api-provider-config`

The moved-symbol audit loop ran `rg -n` over `src tests` for each of:
`localApiProviderPurposeSchema`, `LocalApiProviderPurpose`,
`LocalApiProviderRuntimeConfig`, `getLocalApiProviderTokenRequirement`,
`getStoredProviderRow`, `rowToMetadata`,
`getActiveLocalApiProviderConfig`, and `LocalApiProviderMetadata`. Definitions
are in the new owner, and consumers resolve through the owner paths above.
The independent renderer-local type named `LocalApiProviderPurpose` remains
unchanged and imports nothing from main. The only remaining route-relative
`from "./local-api-provider-config"` match is
`src/main/lib/trpc/routers/index.ts:25`, which composes
`localApiProviderConfigRouter`; it does not import a moved symbol.

## Smoke-Test Scope

This change moves existing main-process read helpers and adds a static
architecture guard. It changes no renderer, provider request, runtime startup,
packaged application, database schema, or user-visible behavior. A desktop UI
or packaged-app smoke was therefore not applicable; behavioral confidence
comes from the unchanged full suite, targeted provider-config security tests,
type checking, and the explicit positive/negative architecture proofs above.
