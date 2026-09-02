# Tasks: Retire residual engine vocabulary and duplicate engine-identity paths

## 1. Pre-flight scope guards (do these before renaming anything)

- [x] 1.1 Verify the keep-list in `proposal.md` → "Explicitly NOT changed" by reading, not
      grepping: `src/shared/acp-tool-normalizer.ts` and the acp branches of
      `src/shared/chat-message-normalizer.ts` belong to the third-party
      `@mcpc-tech/acp-ai-provider` path; persisted `tool-acp.*` part types appear in message JSON;
      `metadata.provider` is written into `sub_chats.messages` via
      `buildAgentChatMessageMetadata` (called from `chats-crud.ts`) and read back by
      `inferAgentChatProviderFromMessages` (used by `active-chat.tsx` today; after 1b,
      by the binding backfill only — re-verify all `active-chat.tsx` and transport
      anchors against the post-1b tree, per proposal.md Out of scope).
- [x] 1.2 C7 consumer sweep for the stdio surface: re-confirm
      `docs/local-job-api-v1-consumer-guide.md` and `.zh-CN.md` contain zero `acp` mentions;
      search Owner-known consumer projects/scripts for `locus acp` or `locus-acp-stdio.v1`.
      ACCEPTANCE: sweep result recorded in `verification.md`. **If any real consumer is found,
      STOP (Red) and ask the Owner before task 6.**
- [x] 1.3 Capture a baseline `bun run check:full` receipt on the pre-change commit so later
      failures are attributable.

## 2. Specs first (repo convention — no code until validated)

- [x] 2.1 Land the three delta files in this change directory: `agent-protocol-interfaces`
      (RENAMED + MODIFIED), `canonical-entity-vocabulary` (ADDED), `fork-residue-hygiene` (ADDED).
- [x] 2.2 `openspec validate refactor-engine-vocabulary-residue --strict --no-interactive` → valid;
      repo-wide `--changes` and `--specs` also pass.

## 3. Single engine-id source (`src/shared/`)

- [x] 3.1 `agent-chat-provider.ts`: replace the independent literal at `:1` with a derivation from
      `CONTRACT_RUNTIME_IDS` (`import { CONTRACT_RUNTIME_IDS } from "./agent-runtime-capabilities"`;
      `export const agentChatProviders = CONTRACT_RUNTIME_IDS`); make `AgentChatProvider` an alias
      of `AgentRuntimeContractId`. Do NOT touch the JSON key `provider`, `normalizeAgentChatProvider`
      semantics, or `inferAgentChatProviderFromMessages` fallbacks.
      ACCEPTANCE: a unit test asserts `agentChatProviders` is reference-identical to (or derived
      element-for-element from) `CONTRACT_RUNTIME_IDS`, and normalize/infer outputs are unchanged
      for: `"claude-code"`, `"codex"`, unknown strings, legacy metadata with only a `model` field.
- [x] 3.2 Extend `scripts/check-architecture-guards.mjs` per design.md Decision 3: the module must
      import `CONTRACT_RUNTIME_IDS` and must not declare an `as const` array literal containing a
      contract runtime id. Failure message names the canonical owner and `docs/OWNERSHIP_MAP.md`.
      ACCEPTANCE: temporarily restoring the old literal makes `bun run check:full` fail.
- [x] 3.3 Optional gated rename (design.md Decision 2): `AgentChatProvider` → `ChatEngineId`
      across ~47 refs / ~14 files (six `chats-*` routers, `shared/chat-message.ts`, seven renderer
      files). Proceed only if `tsc` alone proves the change; if any serialized/IPC surface depends
      on the name, skip and log a Yellow follow-up.
      ACCEPTANCE: either the rename is complete with zero grep hits for `AgentChatProvider`, or a
      dated follow-up note exists and the alias derivation from 3.1 stands alone.
- [x] 3.4 `tsc --noEmit` green.

## 4. Transport rename (renderer, zero persistence)

- [x] 4.1 Rename `src/renderer/features/agents/lib/acp-chat-transport.ts` →
      `codex-app-server-chat-transport.ts`; rename `ACPChatTransport` →
      `CodexAppServerChatTransport` and `ACPChatTransportConfig` accordingly.
- [x] 4.2 Update the consumers: `active-chat.tsx` (~8 refs: import at `:184`, `instanceof` at
      `:5778`, constructions and union annotations at `:5834-5840`, `:6091-6098`, console labels)
      and the comment-only `file://` link at `use-setup-status.ts:125`.
- [x] 4.3 Update `docs/OWNERSHIP_MAP.md` "Runtime Chat UI Event State" consumers row (`:59`) to the
      new filename.
      ACCEPTANCE: `grep -rn "ACPChatTransport\|acp-chat-transport" src/ tests/ docs/OWNERSHIP_MAP.md`
      returns nothing (archive dirs excluded); Codex chat still streams in the desktop smoke (8.4).
- [x] 4.4 Re-point the six source-text assertion suites that read the old file path via
      `readFileSync` in the same change: `tests/onboarding-derived-status.test.ts:17`,
      `tests/provider-routing-ux.test.ts:69`, `tests/long-text-send-pipeline.test.ts:170`,
      `tests/agent-guard-runtime-pipeline.test.ts:198,251`,
      `tests/rich-chat-attachments-pipeline.test.ts:117`,
      `tests/provider-credential-storage.test.ts:118`.
      ACCEPTANCE: `bun test` green with every suite reading
      `codex-app-server-chat-transport.ts`.
- [x] 4.5 Update the 1b-installed guard references in `scripts/check-architecture-guards.mjs`
      that hard-code names this change renames: the transport-purity assertion naming
      `acp-chat-transport.ts` (→ `codex-app-server-chat-transport.ts`) and, if the optional
      3.3 module rename proceeds, the inference-retirement assertion naming
      `src/shared/agent-chat-provider.ts`. Same change.
      ACCEPTANCE: `bun run architecture:check` green after the renames.

## 5. `new-chat-form.tsx` speaks Engine

- [x] 5.1 Rename `NewChatAgent` → `NewChatEngine` (`:195`), `agents` → `engines` (`:202`),
      `selectedAgent`/`setSelectedAgent` → `selectedEngine`/`setSelectedEngine` (`:467` and the
      15+ derived sites: `selectedAgentIsRuntimeAllowed`, `enabledAgents`, `fallbackAgent`,
      `lastSelectedAgentId`, callback params). Identifiers only — i18n keys and values unchanged;
      the atom name `selectedAgentChatIdAtom` (a *chat* id, not an engine) is out of scope.
- [x] 5.2 Delete the retired disabled `"cursor"` entry (`:204`) and the `| "cursor"` union member
      (`:196`); remove any now-dead disabled-entry rendering branch.
      ACCEPTANCE: engine list renders exactly Claude Code and Codex; `grep -n "cursor"` in the file
      returns nothing (the `cursor.svg` app icon asset is untouched).

## 6. Stdio protocol rename (`locus acp` → `locus jobs-stdio`)

- [x] 6.1 Rename `src/main/lib/headless/acp-stdio.ts` → `jobs-stdio.ts`;
      `ACP_PROTOCOL_VERSION` → `JOBS_STDIO_PROTOCOL_VERSION = "locus-jobs-stdio.v1"` (`:46`); the
      initialize response (`:235`) and the job-input protocol tag (`:271`) follow the constant.
      No back-compat alias, per design.md Decision 4.
- [x] 6.2 `cli-args.ts`: `kind: "acp"` → `"jobs-stdio"` (`:164`), command parse `"acp"` →
      `"jobs-stdio"` (`:797-801`). `cli-dispatcher.ts`: import (`:19`), `acpCommand` →
      `jobsStdioCommand` (`:1036`), help text `locus acp` → `locus jobs-stdio` (`:1073`), dispatch
      case (`:1144-1145`).
- [x] 6.3 Confirm no migration is needed: nothing reads `agent_jobs.input.protocol` for routing;
      historical `locus-acp-stdio.v1` rows stay untouched. Record the confirming grep in
      `verification.md`.
- [x] 6.4 Docs: update ~20 `locus acp` / `locus-acp-stdio` references across ~10 files —
      living docs (`locus-workbench-focus{,.zh-CN}.md`, `locus-local-agent-platform{,.zh-CN}.md`,
      `locus-system-design.md`, `docs/OWNERSHIP_MAP.md` if it names the file) are edited; dated
      analyses (`locus-architecture-strategy-handoff.zh-CN.md`,
      `locus-adapt-open-source-direction.zh-CN.md`,
      `docs/ideas/locus-product-direction-harness-strategy.zh-CN.md`) get a dated status note
      rather than silent edits; the two text SVGs (`docs/assets/locus-agent-platform{,.zh-CN}.svg`)
      get a plain text-label edit, or a Yellow follow-up if layout breaks.
- [ ] 6.5 Smoke: pipe an initialize request into `locus jobs-stdio`; response advertises
      `"locus-jobs-stdio.v1"`; `locus acp` exits with the standard unknown-command error.
      Record both transcripts in `verification.md`.

## 7. Worktree path single owner + `.1code` write demotion

- [x] 7.1 Characterize existing behavior first: unit-test matrix against the current regex
      semantics (legacy `~/.21st/worktrees/{chatId}/{subChatId}/…`, current
      `~/.21st/worktrees/{projectSlug}/{worktreeFolder}/…`, non-worktree absolute paths,
      Windows-separator inputs) so extraction is provably behavior-preserving.
- [x] 7.2 Create `src/shared/worktree-path.ts` (pure string logic, no node imports; design.md
      Decision 5): marker constant, `isManagedWorktreePath()`,
      `parseManagedWorktreeRelativePath()`.
- [x] 7.3 Replace and DELETE the five copies in the same change:
      `agent-tool-registry.tsx:97-98`, `git-activity.ts:190-191`,
      `use-changed-files-tracking.ts:57-59`, the hand-rolled parser in
      `claude-config.ts:316-339` (its `os.homedir()` join stays, built from the shared marker),
      and the `includes(".21st/worktrees")` check at `info-section.tsx:472`.
      ACCEPTANCE: `grep -rn "21st/worktrees" src/` hits only `src/shared/worktree-path.ts` and
      main-side base-dir construction (`git/worktree.ts`, `claude-config.ts`) that uses the shared
      marker constant.
- [x] 7.4 `agents-project-worktree-tab.tsx`: remove `"1code"` from the `saveTarget` union (`:278`,
      `:710`), the `.1code/worktree.json` write mapping (`:426`), and the `SelectItem`
      (`:744-753`). Keep the read-side display mapping (`:296-297`). Reword the i18n
      "Legacy 1Code config" values only if now misleading — otherwise Yellow follow-up.
      ACCEPTANCE: a test (or recorded smoke) shows a project with only `.1code/worktree.json`
      still loads its config, and the save-target select offers `.locus` and `.cursor` only.

## 8. Verification

- [ ] 8.1 `bun run check:full` green; compare test counts against the 1.3 baseline and account for
      every added test.
- [x] 8.2 Negative residue greps (excluding `openspec/changes/archive/**`): zero hits for
      `ACPChatTransport`, `acp-chat-transport`, `locus-acp-stdio`, `NewChatAgent`, and the
      duplicated worktree regex outside `src/shared/worktree-path.ts`.
- [x] 8.3 Untouched-surface proof: `acp-tool-normalizer.ts`, `chat-message-normalizer.ts`,
      `codex/ask-user-question.ts`, `local-only.ts`, `oauth.ts`, `agent-guard/contract.ts`, and
      `git/worktree-config.ts` have no diff; `grep -rn "tool-acp\." src/shared/` still returns the
      persisted part types.
- [ ] 8.4 Desktop smoke (`bun run dev`), recorded in `verification.md`: engine picker offers
      exactly Claude Code and Codex (no Cursor row); a Codex chat streams end-to-end through
      `CodexAppServerChatTransport`; an old chat whose messages carry `metadata.provider` routes
      to the correct engine; worktree settings tab loads an existing `.1code` config read-only;
      changed-files tracking and the info-section worktree affordances still work in a managed
      worktree.
- [x] 8.5 `openspec validate --strict --no-interactive` across all changes and specs.

## 9. Closeout (repo standard)

- [ ] 9.1 Bind the exact source SHA and the final `bun run check:full` receipt into
      `verification.md`.
- [ ] 9.2 Record `IMPLEMENTATION_VERIFIED` (Codex) and fresh-context `REVIEW_APPROVED` (Claude)
      for the same SHA in `verification.md`.
- [ ] 9.3 Owner product acceptance recorded.
- [ ] 9.4 Local fast-forward merge; run the post-merge gate (`bun run check:full` on merged main).
- [ ] 9.5 Note in `verification.md`: remote push / remote PR mutation / remote merge **not
      authorized / not performed**.
- [ ] 9.6 `openspec archive refactor-engine-vocabulary-residue --yes` (this change HAS spec
      deltas — do not pass `--skip-specs`), then
      `openspec validate --strict --no-interactive` to confirm the archived change passes.
