# Design: Retire residual engine vocabulary and duplicate engine-identity paths

## Context

D7 (`docs/ideas/canonical-vocabulary.md` §8, ratified 2026-08-25) is half-landed. The UI side
exists: `agent-engine-selector.tsx` (`AgentEngineSelector`, `EngineSwitchConfirmDialog`) and the
`agent.engine.*` i18n keys already say Engine. The API side exists: `runtimeId` is used ~221 times
against `CONTRACT_RUNTIME_IDS`. What remains is the residue in between:

- `src/shared/agent-chat-provider.ts:1` re-declares the engine id list as an independent
  `as const` literal with no bridge to `CONTRACT_RUNTIME_IDS` — the one confirmed type-level
  dual-owner enum in the repo. The i18n guard in `check-architecture-guards.mjs`
  (`assertDictionaryValuesExclude`) does not cover it.
- `ACPChatTransport` (`acp-chat-transport.ts:136`) is the Codex app-server transport
  (`trpc.codex.chat.subscribe`, config hardcodes `provider: "codex"`); "ACP" in its name is false.
- `new-chat-form.tsx:195-205` types the engine list as `NewChatAgent` and still carries a
  disabled `"cursor"` entry.
- `acp-stdio.ts:46` declares `ACP_PROTOCOL_VERSION = "locus-acp-stdio.v1"` for a Locus-owned
  JSON-RPC job dialect that is not the Agent Client Protocol; docs repeatedly admit this.
- The managed-worktree path regex `/\.21st\/worktrees\/[^/]+\/[^/]+\/(.+)$/` is copied verbatim in
  three renderer files, re-implemented by hand in `claude-config.ts:316-339` (which also handles
  the legacy two-segment format), and approximated by `includes(".21st/worktrees")` in
  `info-section.tsx:472`.

Constraint that shapes everything below: **persisted bytes are frozen.** `metadata.provider` (in
`sub_chats.messages` JSON), `tool-acp.*` part types, `agent_jobs.input.protocol` history, theme
IDs, and localStorage keys do not change. Only compile-time names, one experimental CLI surface,
and one UI write-target change.

## Goals / Non-Goals

- Goals: one enum source for engine identity plus a guard; "ACP" left meaning only the real Agent
  Client Protocol integration; Engine vocabulary in the new-chat engine selection code; one owner
  for managed-worktree path parsing; `.1code` write path retired.
- Non-Goals: no DB/table/column rename; no directory migration; no protocol *behavior* change for
  the stdio surface (rename only); no new runtime; no change to the third-party acp-ai-provider
  path; no collapse of the `AgentRuntimeId`/`AgentRuntimeContractId` aliases.

## Decisions

**Decision 1: Derive, don't delete, `agent-chat-provider.ts`.**
`agentChatProviders` becomes a re-export of `CONTRACT_RUNTIME_IDS` and `AgentChatProvider` a type
alias of `AgentRuntimeContractId`. The module survives as the *vocabulary adapter over persisted
chat metadata* — it owns the JSON key `provider`, `normalizeAgentChatProvider`,
`buildAgentChatMessageMetadata`, and `inferAgentChatProviderFromMessages` (read by
`active-chat.tsx` to route historical sub-chats).
*Alternative considered:* fold the module into `agent-runtime-capabilities.ts`. Rejected — 14
importers churn for no ownership gain, and it would put persistence-format knowledge (the JSON
key) inside the runtime-contract module, which is exactly the semantic collision ("provider" =
engine vs credential source) this change is reducing.

**Decision 2: The type rename is optional and gated.**
The blast radius of renaming `AgentChatProvider` → `ChatEngineId` is ~47 references across ~14
files. Audit says it is compile-time only; the implementer verifies during the rename that no
serialized surface, IPC payload key, or persisted string depends on the *name*. If that holds, do
it (Green) — `ChatEngineId` is engine-flavored, avoids "Agent" (reserved for persona) and avoids
"provider" (colliding with credential profiles). If any non-compile-time dependency turns up,
skip the rename entirely, keep the alias derivation from Decision 1, and log a Yellow follow-up.
Function names (`normalizeAgentChatProvider` → `normalizeChatEngineId`, etc.) and the module
filename follow the type rename only if the whole batch stays mechanical; otherwise they stay.
The JSON key `provider` and the metadata field names are untouched in every branch of this
decision. The ~30 renderer literal comparisons (`provider === "codex"`) compare *values* and are
unaffected in every branch.

**Decision 3: Guard shape — high-signal, structural, in the existing script.**
Extend `scripts/check-architecture-guards.mjs` (using its existing `readText`/`assertIncludes`
helpers) with two assertions on `src/shared/agent-chat-provider.ts` (or its renamed successor):
(a) it imports `CONTRACT_RUNTIME_IDS` from `./agent-runtime-capabilities`; (b) its source contains
no `as const` array literal that lists a contract runtime id (regex on
`["'](claude-code|codex)["']\s*,?\s*` inside a `[...] as const` declaration). This is file-scoped
and pattern-narrow, honoring the `architecture-ownership` spec's "avoid broad keyword-only
failures" rule.
*Alternative considered:* repo-wide scan for any array containing both ids. Rejected — tests and
fixtures legitimately enumerate runtimes; a repo-wide rule would be noise.

**Decision 4: Protocol rename with no alias.**
New command `locus jobs-stdio`, new protocol string `locus-jobs-stdio.v1`, constant renamed
`JOBS_STDIO_PROTOCOL_VERSION`, file renamed `jobs-stdio.ts`. The old `acp` command is **removed,
not aliased** — an alias would be a deliberate lingering dual path for a surface that is
documented-experimental with zero known consumers (`docs/local-job-api-v1-consumer-guide.md` and
its zh-CN twin contain zero acp mentions; grep-verified 2026-08-25). The initialize response
advertises only the new `protocolVersion`. Rows already written with
`agent_jobs.input.protocol = "locus-acp-stdio.v1"` are historical records; nothing reads that
field to make routing decisions, so no migration and no dual-read. The C7 consumer-impact note
ships in the proposal; discovery of any real consumer flips this to Red before the rename lands.
*Why now:* roadmap phases 4-5 (Explicit Handoff, third runtime) will very likely touch the real
ACP ecosystem; at that point `locus acp` ≠ ACP graduates from confusion to external contract debt.

**Decision 5: `worktree-path.ts` is pure and renderer-safe.**
The new `src/shared/worktree-path.ts` contains only string logic — the
`.21st/worktrees` marker constant, `isManagedWorktreePath(path)`, and
`parseManagedWorktreeRelativePath(path)` covering both the legacy
(`~/.21st/worktrees/{chatId}/{subChatId}/…`) and current
(`~/.21st/worktrees/{projectSlug}/{worktreeFolder}/…`) two-segment formats that
`claude-config.ts:316-339` distinguishes today. No `node:os`/`node:path` imports — renderer
callers (`agent-tool-registry.tsx`, `git-activity.ts`, `use-changed-files-tracking.ts`,
`info-section.tsx`) import it directly. Main-side callers that need `os.homedir()` resolution
(`claude-config.ts`; `git/worktree.ts:1012` default) keep their homedir join locally but build it
from the shared marker constant, so a future directory move has exactly one string to change.
Behavior is preserved bit-for-bit: the helper's regex semantics must match the existing three
identical copies, and `info-section.tsx`'s boolean check becomes `isManagedWorktreePath`.

**Decision 6: `.1code` demotion is write-side only.**
`agents-project-worktree-tab.tsx`: drop `"1code"` from the `saveTarget` union (:278, :710), the
`.1code/worktree.json` write mapping (:426), and the `SelectItem` (:744-753). The display mapping
that *shows* a detected `source === "1code"` config (:296-297) stays — users with an existing
`.1code/worktree.json` still see where their config comes from and it still loads via the
unchanged `detectWorktreeConfig` priority chain (`worktree-config.ts`: custom > `.locus` >
`.cursor` > `.1code`). `.cursor` remains a write target; only the fork-era `.1code` path is
demoted. The `runtime-security-baseline` scenario that reads setup commands from all three files
is unaffected.

## Risks / Trade-offs

- **[Rename misses a dynamic reference]** — `active-chat.tsx` has ~8 `ACPChatTransport`
  references including an `instanceof` check (:5778) and union type annotations; a missed one is
  a compile error (safe), but the `use-setup-status.ts:125` `file://` doc link is comment-only and
  silently rots. → Mitigation: task explicitly lists it; negative grep in verification.
- **[Guard false-positives]** — future legitimate refactors of `agent-chat-provider.ts` could trip
  the literal-array pattern. → Mitigation: guard message points to `CONTRACT_RUNTIME_IDS` and
  `docs/OWNERSHIP_MAP.md`; pattern is file-scoped so the blast radius of a false positive is one
  clear message, not a blocked unrelated change.
- **[Worktree regex drift]** — extracting five near-copies risks changing edge-case behavior
  (e.g. Windows separators: the existing renderer regexes match `/` only; `claude-config.ts` uses
  `path.join` separators). → Mitigation: the shared helper must normalize separators explicitly
  and the unit matrix includes Windows-style inputs; the existing per-copy behavior is
  characterized in tests *before* deletion.
- **[Docs SVGs]** — `docs/assets/locus-agent-platform{,.zh-CN}.svg` contain `locus acp` as text.
  Text-editing an SVG label is low-risk (they are plain text SVGs), but if the edit disturbs
  layout, regeneration is a Yellow follow-up rather than a blocker.
- **[Hidden consumer of `locus acp`]** — the surface is externally invocable. → Mitigation:
  pre-flight sweep task; Red stop if anything real is found.

## Migration Plan

None. No persisted data is touched (see proposal "Migration gate: none required"). Rollback is a
git revert; there is no data state to unwind. The only sequencing rule is that specs validate
before code lands (repo convention) and the guard lands in the same commit series as the enum
derivation so the dual path never has an unguarded window.

## Open Questions

- None blocking. The one deliberately deferred item is the `AgentRuntimeId` /
  `AgentRuntimeContractId` alias collapse (TICKET-108), which this change neither needs nor
  performs.
