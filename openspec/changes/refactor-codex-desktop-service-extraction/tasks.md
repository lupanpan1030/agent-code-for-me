# Tasks: Extract the Codex desktop chat service out of the tRPC router

## 1. Pre-flight

- [ ] 1.1 Capture a baseline `bun run check` receipt on the pre-change commit so later
      failures are attributable.
- [ ] 1.2 Inventory every source-text assertion on `src/main/lib/trpc/routers/codex.ts`
      (`grep -rln "routers/codex" tests/`) and map each asserted substring to the block it
      pins (state Maps, adapter construction, preflight, binding, persistence, MCP zod).
      This inventory drives the per-commit test re-pointing in sections 3–6.
- [ ] 1.3 Re-verify the anchors this change moves (line numbers are hints, symbols are
      authoritative): `activeStreams`/`pendingCodexToolApprovals` (`codex.ts:207-236`),
      `buildCodexAppServerAssistantMessage` (`codex.ts:161`), both `db.update(subChats)`
      writes (`codex.ts:956`, `codex.ts:981`), `createCodexAppServerAdapter` call
      (`codex.ts:1115`), reverse imports (`src/main/index.ts:36`,
      `src/main/windows/main.ts:28-30`).

## 2. State extraction (registry + approvals)

- [ ] 2.1 Create `src/main/lib/codex/active-streams.ts` mirroring
      `lib/claude/active-sessions.ts`: `ActiveCodexStream` type, typed accessors
      (get/set/delete-if-run, `hasActiveCodexStreams`, `abortAllCodexStreams`), a
      `...ForTest` reset hook. Preserve `runId`-authoritative semantics exactly.
- [ ] 2.2 Create `src/main/lib/codex/tool-approvals.ts` mirroring
      `lib/claude/tool-approvals.ts`: pending store keyed by `toolUseId`,
      `clearPendingCodexApprovals(reason, subChatId)`, resolve helper, test reset hook.
- [ ] 2.3 Rewire all `codex.ts` internal uses (subscription registration at `:520-531`,
      persistence guard, cancel callback at `:1053-1072`, finalize at `:1244-1272`,
      `cancel` (`:1274`) / `respondToolApproval` (`:1298`) procedures) to the new
      modules; delete the
      module-level Maps and helpers from the router.
- [ ] 2.4 Rewire `src/main/windows/main.ts` (imports at `:27-31`; call sites `:547`,
      `:564`, `:615`, `:619`, `:635`) and `src/main/index.ts` (import at `:36`; call sites
      `:646`, `:659`, `:741`, `:756`) to `lib/codex/active-streams.ts`. Point
      `index.ts:881` at `getAllCodexMcpConfigHandler` from
      `src/main/lib/runtime-mcp-config/codex.ts` directly and delete the router re-export
      (`codex.ts:127`). ACCEPTANCE: `grep -rn "trpc/routers/codex" src/main/` matches only
      the tRPC router registry.
- [ ] 2.5 Unit tests for both new modules (register/abort/authoritative-run/clear
      semantics), mirroring existing Claude counterpart coverage.

## 3. Run pipeline stage extraction (one commit per stage, run order)

- [ ] 3.1 `src/main/lib/codex/desktop-run-preflight.ts`: move `emitPreflightBlocker`,
      `emitLocalOnlyPreflightBlocker`, and the runtime-status gate (`codex.ts:652-725`)
      into stage functions taking injected emit/complete callbacks. Re-point
      `tests/agent-runtime-preflight.test.ts` assertions that pin moved text.
- [ ] 3.2 `src/main/lib/codex/desktop-run-provider-binding.ts`: move the three-way binding
      selection (provider profile / app-managed API key / ChatGPT login,
      `codex.ts:764-931`) and the scoped gateway token issue/revoke lifecycle
      (`codex.ts:539-551`) beside `provider-runtime-binding.ts`. Return a binding result
      (profile, gateway endpoint+token, auth mode, secret hints, idempotent `revoke()`).
      ACCEPTANCE: revoke fires exactly once across finally + unsubscribe paths, covered by
      a unit test; `tests/provider-credential-storage.test.ts` /
      `tests/provider-routing-ux.test.ts` re-pointed.
- [ ] 3.3 `src/main/lib/codex/desktop-run-persistence.ts`: move history load
      (`parseCodexStoredMessages` call), duplicate-prompt detection (prompt + long-text +
      image signatures, `codex.ts:934-944`), user-message build/persist, the
      authoritative-run guard, both `db.update(subChats)` writes, and
      `buildCodexAppServerAssistantMessage` (`codex.ts:161-199`) plus the
      natural-finish assistant persistence (`codex.ts:1186-1199`). ACCEPTANCE: a unit test
      locks the persisted message JSON shape (ids, parts, metadata, `updatedAt` handling)
      against the pre-change builder output; no `db.update(subChats)` remains in any
      router (`grep -n "subChats" src/main/lib/trpc/routers/` shows reads at most —
      expected: none in `codex.ts` after 3.3).
- [ ] 3.4 `src/main/lib/codex/desktop-run-finalize.ts`: move the run-flag state
      (`sawError` / `reachedNaturalFinish` / `adapterFailed`, `codex.ts:534-538`), desktop
      job registration glue (`createAndRegisterDesktopChatAgentJob` call + cancel callback,
      `codex.ts:1053-1073`), the `finally` finalize (`completeDesktopChatAgentJobSafely`,
      `codex.ts:1225-1249`), and the unsubscribe cancel path
      (`requestCancelDesktopChatAgentJobSafely`, `codex.ts:1252-1272`). Mirror
      `lib/claude/agent-sdk-desktop-run-state.ts` / `-cleanup.ts` shape (a split into two
      files is acceptable if the OWNERSHIP_MAP entry names what ships).

## 4. Adapter construction through the factory

- [ ] 4.1 Create `src/main/lib/codex/app-server-adapter-runner.ts` mirroring
      `lib/claude/agent-sdk-adapter-runner.ts`: consume
      `resolveCodexDesktopAdapterSelection`, build the app-server adapter config —
      moving the `LOCUS_CODEX_APP_SERVER_EXPERIMENTAL_API`,
      `LOCUS_CODEX_APP_SERVER_CONTROLLED_EDIT_EXECUTOR`, and
      `LOCUS_CODEX_APP_SERVER_APPLY_PATCH_EXPERIMENT` env reads and the smoke-only
      `configOverrides` block down from `codex.ts:1115-1156` — and dispatch through
      `DesktopRuntimeAdapterFactory` (`lib/agent-runtime/desktop-runner.ts`).
- [ ] 4.2 Delete the direct `createCodexAppServerAdapter` import (`codex.ts:47`) and call
      from the router; the router passes emit/approval callbacks (now lib-owned) and the
      `DesktopRunRequest`. ACCEPTANCE: `grep -rn "createCodexAppServerAdapter" src/main/lib/trpc/`
      is empty; `grep -rn "LOCUS_CODEX_APP_SERVER" src/main/lib/trpc/` is empty.
- [ ] 4.3 Re-point `tests/desktop-runtime-adapter-factory.test.ts` ("keeps Codex desktop
      chat on the app-server adapter boundary", `:141`) at the adapter runner, and add the
      positive assertion that Codex construction goes through the factory.

## 5. MCP zod wrapper dedupe

- [ ] 5.1 Move the wrapper schemas (`mcpStringInputSchema`, `mcpArgsInputSchema`,
      `mcpEnvInputSchema`, `mcpUrlInputSchema`, `zodMessage`) into
      `src/main/lib/runtime-mcp-config/input-validation.ts` beside the normalizers they
      wrap; export them for router use.
- [ ] 5.2 Delete both router-local copies (`claude.ts` ~`:57-92`, `codex.ts` ~`:129-155`)
      and import from the owner. ACCEPTANCE: `grep -rn "mcpStringInputSchema"
      src/main/lib/trpc/routers/` shows imports only; `tests/mcp-config-boundaries.test.ts`
      re-pointed and green.

## 6. Docs and manifest evidence

- [ ] 6.1 `docs/OWNERSHIP_MAP.md`: rewrite the "Codex Desktop Chat Runtime" section
      (`:240-251`) — canonical owners are the new `lib/codex` modules; the router retains
      input validation + tRPC stream envelope only; drop the "temporary owner until
      service extraction" clause. Leave the `claude.ts` clause (`:232-238`) untouched.
- [ ] 6.2 Update `src/shared/agent-runtime-capabilities.ts` `references` arrays only where
      the named evidence moved out of `codex.ts` (e.g. `providerProfiles`,
      `usageMetadata`); keep `routers/codex.ts` where envelope-level evidence remains.
- [ ] 6.3 Log the Yellow follow-ups as tickets/backlog notes (no implementation):
      `startLogin` spawn state machine → `lib/codex/login-session.ts`;
      `claude-settings.ts` persistent-state extraction (reverse imports at
      `lib/runtime-mcp-config/claude.ts:48`, `lib/agent-builder/claude-native-agents.ts:9`,
      `lib/mcp-auth.ts:25`, and the dynamic import at
      `lib/claude/agent-sdk-config-dir.ts:79`); remaining `claude.ts` inline residuals.

## 7. Regression pinning

- [ ] 7.1 Add negative source-text assertions (`.not.toContain`, precedent:
      `tests/agent-runtime-registry.test.ts`) pinning the post-extraction router:
      `routers/codex.ts` MUST NOT contain `new Map<`, `db.update(`,
      `createCodexAppServerAdapter`, `buildCodexAppServerAssistantMessage`,
      `LOCUS_CODEX_APP_SERVER`, `revokeProviderGatewayToken`, or `getProviderGatewayEndpoint`;
      `src/main/index.ts` and `src/main/windows/main.ts` MUST NOT contain
      `trpc/routers/codex`. These land after the moves (they would fail before).
- [ ] 7.2 Sweep the section 1.2 inventory: every re-pointed assertion suite passes and no
      suite still asserts moved text against the router file.

## 8. Verification

- [ ] 8.1 `bun run check:full` green (lint, architecture guards, typecheck, tests,
      `spec:validate`, build, diff check). `spec:validate --all --strict` passes for this
      delta-free change only because the change directory's `.openspec.yaml` carries
      `skip_specs: true` — confirm the marker is present. Account for every test-count delta
      against the 1.1 baseline.
- [ ] 8.2 Desktop smoke (`bun run dev`), evidence recorded in the change directory: Codex
      chat end to end on an existing sub-chat (history intact after the run); a tool
      approval prompt answered; cancel mid-run then re-run; provider-profile run issues
      and revokes a gateway token; app quit with an active Codex stream triggers the
      confirm-and-abort path; error path still emits `error` + `finish` once.
- [ ] 8.3 Behavior-preservation spot check: diff a pre-change and post-change
      `subChats.messages` row for an identical scripted run shape; confirm identical
      structure. Note the receipt in `verification.md`.
- [ ] 8.4 Confirm no-spec-delta status: repo `openspec validate --strict --no-interactive`
      passes for all changes including this one (via the `.openspec.yaml` `skip_specs: true`
      marker in the change directory); this change is documented in `proposal.md` Impact as a
      pure internal refactor to be archived with `--skip-specs`.

## 9. Closeout (repo standard)

- [ ] 9.1 Commit the integrated source, run `bun run check:full` on the exact source SHA,
      and bind the SHA + receipt into `verification.md`.
- [ ] 9.2 Record `IMPLEMENTATION_VERIFIED` (Codex) and fresh-context `REVIEW_APPROVED`
      (Claude Code independent review) for that same SHA in `verification.md`.
- [ ] 9.3 Obtain Owner product acceptance for the same SHA.
- [ ] 9.4 Fast-forward the reviewed source locally into `main` and run the post-merge gate
      on the local merge SHA; record `remote not authorized / not performed`.
- [ ] 9.5 Archive:
      `openspec archive refactor-codex-desktop-service-extraction --skip-specs --yes`
      (the `.openspec.yaml` `skip_specs: true` marker travels with the change directory),
      then `openspec validate --strict --no-interactive` to confirm the archived state.
