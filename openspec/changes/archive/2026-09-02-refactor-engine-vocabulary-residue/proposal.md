# Change: Retire residual engine vocabulary and duplicate engine-identity paths

## Why

The ratified D7 addendum (`docs/ideas/canonical-vocabulary.md` §8, 2026-08-25) fixes the naming
contract: **UI says Engine, API says `runtimeId`, Agent is reserved for persona**. The audit behind
the Foundation Stabilization batch found four residues that violate it, one of which is a true
canonical-owner debt:

- **Two independent enums define the same engine identity.** `agentChatProviders`
  (`src/shared/agent-chat-provider.ts:1`) and `CONTRACT_RUNTIME_IDS`
  (`src/shared/agent-runtime-capabilities.ts:1`) are content-identical `["claude-code","codex"]`
  literals with **no import, re-export, or conversion function between them** (grep-verified).
  `scripts/check-architecture-guards.mjs` guards i18n vocabulary but not this type-level dual
  enum. Worse, inside `AgentChatMessageMetadata` the word "provider" means *engine*
  (`metadata.provider`) while two lines down it means *credential source*
  (`metadata.providerProfileId` → `agent_provider_profiles`).
- **"ACP" carries three meanings in one repo**: the misnamed Codex transport (`ACPChatTransport`,
  which speaks `trpc.codex.chat` to `src/main/lib/codex/app-server-*.ts` and has nothing to do with
  the Agent Client Protocol), the *genuine* third-party `@mcpc-tech/acp-ai-provider` normalizer
  path, and the self-invented `locus acp` stdio protocol (`locus-acp-stdio.v1`), which is a
  Locus-owned JSON-RPC dialect, not ACP. The remove-experimental-runtimes archive explicitly
  deferred the transport rename to "its own change" — this is that change.
- **`new-chat-form.tsx` uses "Agent" as the engine noun** (`NewChatAgent`, `agents`,
  `selectedAgent`, `new-chat-form.tsx:195-205,467`), directly violating D7, and still lists a
  disabled `"cursor"` engine entry for the retired Cursor CLI.
- **The managed-worktree path regex is copied 4+ times** across renderer and main
  (identical regex in three files, a fourth hand-rolled parser, a fifth `includes()` check), and the
  legacy `.1code/worktree.json` fork config is still offered as a **write** target.

The roadmap phases that follow (Job Kernel v1.1, Interactive Runs, Portable Sessions) will mint new
persisted objects and public contracts around engine identity. If the dual enum and triple-meaning
"ACP" survive until then, they get baked into those contracts. The `locus acp` rename in particular
has exactly one cheap window: now, while the surface is documented-experimental with zero known
consumers (`docs/local-job-api-v1-consumer-guide.md` never mentions acp — grep-verified).

## What Changes

1. **Single engine-id source.** `agentChatProviders` derives from (re-exports)
   `CONTRACT_RUNTIME_IDS`; `AgentChatProvider` becomes a type alias of `AgentRuntimeContractId`.
   The persisted JSON key `provider` in message metadata and every runtime value are untouched.
   A new architecture-guard assertion fails the build if a second engine-id enum literal reappears.
   *Optional (gated):* mechanical rename `AgentChatProvider` → `ChatEngineId` if the ~47-reference
   blast radius stays compile-time only (see design.md Decision 2).
2. **Rename `ACPChatTransport` → `CodexAppServerChatTransport`**, including the file rename
   `src/renderer/features/agents/lib/acp-chat-transport.ts` →
   `codex-app-server-chat-transport.ts`. Zero persistence. The genuine third-party
   acp-ai-provider normalizer code and the persisted `tool-acp.*` part types are explicitly NOT
   touched (see scope guards).
3. **`new-chat-form.tsx` speaks Engine.** `NewChatAgent` → `NewChatEngine`, `agents` → `engines`,
   `selectedAgent` → `selectedEngine` (and derived identifiers); the disabled retired `"cursor"`
   option is deleted. Identifier-level only; i18n keys/values unchanged.
4. **Rename the self-owned stdio protocol away from "ACP".** `locus acp` → `locus jobs-stdio`;
   protocol string `locus-acp-stdio.v1` → `locus-jobs-stdio.v1`; file
   `src/main/lib/headless/acp-stdio.ts` → `jobs-stdio.ts`; `cli-args.ts` / `cli-dispatcher.ts` /
   docs updated. **No back-compat alias** (experimental surface, zero known consumers). Old
   protocol strings in historical `agent_jobs` rows stay as history — no migration. Per C7 a
   consumer-impact sweep is a pre-flight task; discovering any real external consumer is a RED
   stop (see W7 envelope).
5. **One owner for managed-worktree path parsing.** New `src/shared/worktree-path.ts` (pure,
   renderer-safe) owns the marker constant and `isManagedWorktreePath()` /
   `parseManagedWorktreeRelativePath()`. The five copies are deleted in the same change
   (`agent-tool-registry.tsx:97-98`, `git-activity.ts:190-191`,
   `use-changed-files-tracking.ts:57-59`, `claude-config.ts:316-339`, `info-section.tsx:472`).
   `.1code/worktree.json` is demoted from a write target to read-only compatibility in
   `agents-project-worktree-tab.tsx` (the read/detection chain in `git/worktree-config.ts` is
   unchanged).

### Explicitly NOT changed (scope guards)

A blanket grep on `acp`, `provider`, `agent`, `21st`, or `1code` will destroy working features or
ratified decisions. These stay:

| Surface | Why it survives |
| --- | --- |
| `src/shared/acp-tool-normalizer.ts`, `src/shared/chat-message-normalizer.ts` (acp branches), `src/main/lib/codex/ask-user-question.ts`, `@mcpc-tech/acp-ai-provider` | This "acp" is **real** — third-party package integration for Codex. |
| Persisted part types `tool-acp.*` in message JSON | Persisted data. Renaming requires a migration for zero value. |
| JSON key `provider` in `AgentChatMessageMetadata` (written into `sub_chats.messages`) | Persisted data; `inferAgentChatProviderFromMessages` reads it from historical messages. TS names may change, the JSON key may not. |
| `chats`/`sub_chats` table names, `subChatId` (~1,338 refs / 158 files) | Ruled out by `canonical-vocabulary.md` §7/§8 and the ratified `canonical-entity-vocabulary` spec ("The rename does not touch the code/data layer"). If ever done, it hangs off Portable Sessions. |
| `~/.21st/worktrees` and `~/.21st/repos` directories | `chats.worktreePath` and `.git/worktrees` metadata persist absolute paths; migration is expensive and no roadmap phase depends on the directory name. This change centralizes the *parsing* so a future move has one edit point. |
| Theme IDs `"21st-dark"`/`"21st-light"`, localStorage key `"21st-session-info"` | Persisted in user settings; migration cost exceeds value. |
| `lastSelectedAgentIdAtom` / `projectAgentIdAtomFamily` (renderer atoms in `src/renderer/features/agents/atoms/index.ts`) | Named "Agent" but carrying engine semantics — a D7 residue; their `atomWithStorage` keys (`agents:lastSelectedAgentId`, `agents:projectAgentIds`) are persisted in localStorage, so renaming touches persisted keys. Kept; rename logged as a Yellow follow-up. |
| `oauth.ts` CLIENT_NAMES `'1code'`, `platform/*.ts` legacy `1code` CLI launcher, `shared/local-only.ts` domain seals (`21st.dev`/`1code.dev`/`21st.sh`), `agent-guard/contract.ts` `.1code` protected path | Deliberate compatibility and **security allowlists**. Must be kept. |
| `.cursor/worktrees.json` and `.1code/worktree.json` **read** compatibility (`git/worktree-config.ts` priority chain) | Read-side compat is the ratified behavior (`runtime-security-baseline` references it); only the `.1code` *write* option is removed. |
| Renderer literal comparisons `provider === "codex"` / `"claude-code"` (~30 sites) | Values are unchanged; these are unaffected by the type-level merge. |
| `openspec/changes/archive/**` mentions of `acp-chat-transport` / `locus acp` | Archived changes are historical record. |

## Impact

- **Affected specs:**
  - `agent-protocol-interfaces` — RENAMED `Minimal ACP Stdio Boundary` → `Minimal Jobs Stdio
    Boundary` + MODIFIED (command/protocol-string rename, explicit not-ACP disclosure, historical
    rows scenario).
  - `canonical-entity-vocabulary` — ADDED requirement ratifying the D7 Engine addendum in spec
    form (Engine vocabulary for engine selection, single engine-id source, stable persisted key).
  - `fork-residue-hygiene` — ADDED requirement demoting legacy fork worktree config to read-only
    compatibility.
  - Items 2 and the helper-extraction half of item 5 are internal refactors with no
    externally-observable behavior change; they ride under the existing `architecture-ownership`
    requirements (no delta needed for them specifically).
- **Affected code (edit/rename):** `src/shared/agent-chat-provider.ts`,
  `src/shared/agent-runtime-capabilities.ts` (import source only),
  `scripts/check-architecture-guards.mjs`,
  `src/renderer/features/agents/lib/acp-chat-transport.ts` (→ `codex-app-server-chat-transport.ts`),
  `src/renderer/features/agents/main/active-chat.tsx` (~8 transport refs at :184, :5778,
  :5834-5840, :6091-6098), `src/renderer/features/onboarding/lib/use-setup-status.ts:125` (doc
  link), `src/renderer/features/agents/main/new-chat-form.tsx`,
  `src/main/lib/headless/acp-stdio.ts` (→ `jobs-stdio.ts`), `src/main/lib/headless/cli-args.ts`
  (:164, :797-801), `src/main/lib/headless/cli-dispatcher.ts` (:19, :1036-1073, :1144-1145),
  new `src/shared/worktree-path.ts`, `src/renderer/features/agents/ui/agent-tool-registry.tsx`,
  `src/renderer/features/agents/utils/git-activity.ts`,
  `src/renderer/features/agents/hooks/use-changed-files-tracking.ts`,
  `src/main/lib/claude-config.ts`,
  `src/renderer/features/details-sidebar/sections/info-section.tsx`,
  `src/renderer/components/dialogs/settings-tabs/agents-project-worktree-tab.tsx` (:278, :296-297,
  :426, :710, :744-753), `docs/OWNERSHIP_MAP.md` (:59 consumer row + new worktree-path owner row),
  and ~10 docs files (~20 `locus acp` / `locus-acp-stdio` references, incl. 2 text SVGs under
  `docs/assets/`).
- **Consumers of `src/shared/agent-chat-provider.ts` (14 files)** recompile unchanged: six
  `chats-*` tRPC routers (`chats-crud`, `chats-pr`, `chats-diff`, `chats-helpers`,
  `chats-sub-chats`, `chats-generation`), `shared/chat-message.ts`, and seven renderer files.
- **Source-text assertion suites that read `acp-chat-transport.ts` by path** (via
  `readFileSync`) break on the file rename and must be re-pointed at
  `codex-app-server-chat-transport.ts` in the same change (6 suites):
  `tests/onboarding-derived-status.test.ts:17`, `tests/provider-routing-ux.test.ts:69`,
  `tests/long-text-send-pipeline.test.ts:170`,
  `tests/agent-guard-runtime-pipeline.test.ts:198,251`,
  `tests/rich-chat-attachments-pipeline.test.ts:117`,
  `tests/provider-credential-storage.test.ts:118`.
- **Migration gate: none required.** No schema change, no persisted-key change, no data rewrite.
  The two persistence-adjacent touchpoints are explicitly frozen: `metadata.provider` JSON key
  stays; `agent_jobs.input.protocol` values written under `locus-acp-stdio.v1` remain as
  history and are never rewritten.

## Canonical owners (where each piece of logic lands)

| Logic | Canonical owner after this change | Old paths deleted in this change |
| --- | --- | --- |
| Engine id enum | `CONTRACT_RUNTIME_IDS` in `src/shared/agent-runtime-capabilities.ts` | Independent array literal in `agent-chat-provider.ts:1` (becomes derivation); guard prevents reintroduction |
| Chat-metadata engine vocabulary adapter (normalize/build/infer, JSON key `provider`) | `src/shared/agent-chat-provider.ts` (module retained as the adapter over persisted metadata) | — (no dual path; only its enum source changes) |
| Codex desktop chat transport | `src/renderer/features/agents/lib/codex-app-server-chat-transport.ts` | `acp-chat-transport.ts` file + `ACPChatTransport` symbol (rename, old file gone) |
| Engine selection UI (new chat) | `new-chat-form.tsx` with Engine identifiers | `NewChatAgent`/`agents`/`selectedAgent` identifiers; `"cursor"` entry |
| Locus stdio job protocol | `src/main/lib/headless/jobs-stdio.ts` + `cli-args.ts`/`cli-dispatcher.ts` under command `jobs-stdio` | `acp-stdio.ts` file, `acp` CLI command, `locus-acp-stdio.v1` string (no alias left behind) |
| Managed-worktree path parsing | `src/shared/worktree-path.ts` (pure string logic; main-side homedir resolution stays in its callers but uses the shared marker) | All five parsing copies listed in What Changes item 5 |
| Worktree config write targets | `agents-project-worktree-tab.tsx` offering `.locus` and `.cursor` only | `"1code"` save-target union member, its `SelectItem`, and the `.1code/worktree.json` write path (:426) |

No temporary dual path is planned anywhere in this change. If implementation discovers one is
unavoidable, it must carry the five required elements (canonical owner, migration gate, deletion
date/follow-up, boundary test/guard, deprecation comment) — and that discovery is itself a Yellow
log entry.

## Verification consumers

- `bun run check:full` (lint + architecture guards + ts + tests) — the guard added to
  `check-architecture-guards.mjs` runs inside it on every subsequent commit.
- New unit tests: `worktree-path` helper matrix (legacy + new path formats, non-worktree paths);
  `agent-chat-provider` derivation test asserting `agentChatProviders` is reference-derived from
  `CONTRACT_RUNTIME_IDS` and that normalize/infer behavior is byte-identical to before.
- Negative residue assertions (post-rename): no `ACPChatTransport`, no `locus-acp-stdio`, no
  `NewChatAgent`, no `"cursor"` engine entry, no worktree regex outside the shared owner.
- Manual smokes recorded in `verification.md`: `locus jobs-stdio` initialize handshake returns
  `locus-jobs-stdio.v1`; desktop smoke — engine picker shows exactly Claude Code and Codex, a
  Codex chat runs end-to-end through the renamed transport, worktree settings tab offers no
  `.1code` save target while an existing `.1code` config still loads.

## W7 autonomy envelope

- **Green (implementer may do autonomously):** every mechanical rename enumerated above; the enum
  derivation; the guard assertion; the `worktree-path.ts` extraction and five-copy deletion;
  deleting the `"cursor"` entry; docs text updates for `locus jobs-stdio` (including editing the
  two text SVGs if the change is a plain text-label edit); new unit tests and negative assertions.
- **Yellow (log a follow-up, do not implement):** the optional `ChatEngineId` type rename if any
  non-compile-time surface turns up mid-rename; rewording the i18n "Legacy 1Code config" values if
  the `.1code` demotion makes them misleading; regenerating (rather than text-editing) the docs
  SVGs; any *additional* worktree-regex copy discovered beyond the five listed whose semantics are
  not identical; collapsing the `AgentRuntimeId`/`AgentRuntimeContractId` alias pair
  (TICKET-108 territory, not this change); renaming `lastSelectedAgentIdAtom` /
  `projectAgentIdAtomFamily` (engine semantics under an "Agent" name, but their
  localStorage keys are persisted — a rename needs a key-migration decision).
- **Red (stop and ask Owner):** any real external consumer of `locus acp` /
  `locus-acp-stdio.v1` discovered during the pre-flight sweep or implementation (C7 public-surface
  impact); any change to persisted JSON keys or values (`metadata.provider`, `tool-acp.*` part
  types, `agent_jobs` rows) or any migration; touching the `chats`/`sub_chats` schema or
  `subChatId` identifiers; removing or reordering the worktree-config **read** chain (including
  `.cursor`/`.1code` read compat — security-adjacent per `runtime-security-baseline`); adding a
  back-compat alias for the `acp` command (contradicts the no-dual-path decision); touching the
  `local-only.ts` domain seals, oauth CLIENT_NAMES, or agent-guard protected paths.

## Out of scope (explicit)

- `chats`/`sub_chats` table rename and `subChatId` references (ruled out by
  `canonical-vocabulary.md` §7/§8 and the ratified spec).
- `~/.21st` directory migration (worktrees or repos).
- `"21st-dark"`/`"21st-light"` theme IDs and `21st-*` localStorage keys.
- oauth / platform launcher / `local-only.ts` legacy compat entries (security-relevant, keep).
- Collapsing `AgentRuntimeId` vs `AgentRuntimeContractId` public aliases (tracked separately).
- Any change to the genuine acp-ai-provider integration or Codex app-server backend.
- The other Foundation Stabilization drafts' subject matter (1a-1c). This change is NOT
  order-independent, however: it is sequenced **after** 1b (`add-chat-session-binding`),
  whose renderer surgery deletes/rewrites the `active-chat.tsx` anchors cited here — the
  `instanceof ACPChatTransport` back-inference (~`:5778`) and the two transport
  construction sites (`:5834-5840`, `:6091-6098`) — and moves the
  `inferAgentChatProviderFromMessages` usage out of `active-chat.tsx` into the binding
  backfill, changing this change's pre-flight inference assumptions. All `active-chat.tsx`
  and transport anchors MUST be re-verified against the post-1b tree at implementation
  time (line numbers are hints; symbols are authoritative).
