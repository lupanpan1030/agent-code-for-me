# Locus closeout pause handoff — 2026-08-25

> **COMPLETED 2026-08-26.** The Owner resumed this closeout and expanded step 8 from two changes
> to all four Verification/Acceptance changes. Source
> `bdd2e2e57143a69f86f34ed96f84aa9a5e076fd4` received both technical verdicts; local `main`
> fast-forwarded to evidence endpoint `2a41522c01e5bb7e55014218c087e814a28be583`; the post-merge
> full gate passed; the Owner explicitly accepted all four changes; and all four were archived under
> `openspec/changes/archive/2026-08-26-*`. Current changes/specs validate 52/52, and each of the
> four new archive entries passes archived-task validation. No push, remote PR mutation, remote
> merge, release, or other remote operation was authorized or performed. The original pause
> snapshot below is preserved unchanged as historical recovery evidence.

## Pause decision

Work paused at the Owner's request because the current AI token allowance is
low. Do not continue implementation, run broad verification, commit, merge,
archive OpenSpec changes, or push until the Owner explicitly resumes this
closeout.

This is a working-tree checkpoint, not a completion or approval receipt.

## Repository checkpoint

- Repository: `/home/chen/projects/agent-code-for-me`
- Branch: `codex/remove-experimental-runtimes`
- Working-tree base `HEAD`: `1d4be1a1955fb23928a12b3479f1d77238bf84d0`
- Local `main`: `df72d425ea9c7e404a568a4c93c26f3792074ad0`
- Merge-base: local `main`
- Working tree: intentionally dirty; all current closeout edits are uncommitted
- Remote action: not authorized and not performed
- Local merge: not performed
- OpenSpec archive: not performed
- `/home/chen/.codex/config.toml` SHA-256 at pause:
  `290689036d77458b496c4386c864384aaf7c21975241b6c1c4a7fe49379881d9`
- `git diff --check`: passed at the pause checkpoint

## Implemented or substantially implemented in the working tree

1. Existing integrated changes remain present for cross-workspace conflict
   adjudication, headless provider binding, public Local Job API documentation,
   retired-runtime guards, stateful stream redaction, provider binding, and
   Codex shell-snapshot cleanup.
2. Shared credential policy now owns the exact-redaction minimum length and an
   impossible-as-credential replacement marker. Provider URLs reject userinfo,
   query parameters, and fragments. Codex API keys use the same minimum length.
3. `hasToken` is being reduced to an edit-form placeholder. Legacy Claude,
   helper providers, and Provider Profiles now expose/use authoritative
   `credentialUsable` results derived by main-process decrypt-and-normalize
   validation.
4. Claude/headless/helper hardening is substantially implemented: native OAuth
   hints register before output, credential-bound raw diagnostics are omitted,
   legacy auth mode parsing fails closed, unsubscribe revokes credentials while
   retaining hints to terminal settlement, and title/commit/voice outputs use
   exact redaction.
5. Headless process and Codex app-server lifecycle hardening is substantially
   implemented: real exit state drives TERM-to-KILL escalation, transport exit
   settles pending requests and terminal state, invalid/missing terminal status
   fails closed, and Codex post-run snapshot security failure overrides cancel.
6. Local Job artifact writes have moved toward descriptor-anchored atomic
   writes with directory/file identity receipts. A canonical low-level owner
   now exists at `src/main/lib/filesystem/stable-directory.ts`.

## Explicitly unfinished at pause

1. The filesystem worker was interrupted while integrating the new stable
   directory owner. Local Job artifacts use the descriptor anchor in several
   paths, but Codex shell snapshots still contain path-based `renameSync`
   operations and have not completed the same integration. Treat both modules
   as under active security refactoring until reviewed together.
2. The deterministic check-to-rename directory-swap regression requested for
   artifact and snapshot paths was not finished or rerun.
3. `logProviderRequestFailure` still truncates the provider error body before
   exact redaction. Reverse this order so a credential crossing the truncation
   boundary cannot leave a prefix in logs; audit the other helper paths for the
   same ordering mistake.
4. Parallel workers were interrupted before their final type/lint/integration
   passes and file-by-file handoff. Reinspect their diffs rather than assuming
   their last targeted-test counts certify the current combined tree.
5. The new exact-redaction marker changes expectations on exact-hint paths.
   Update only exact-hint assertions; heuristic key/text redaction intentionally
   continues to use `<redacted>`.
6. Provider URL query/fragment rejection has a shared-policy test and a Provider
   Profile storage test, but legacy Claude and local-helper persisted-row/save
   coverage still needs confirmation after the interrupted integration.
7. No fresh full test suite, `check:full`, production build, or Electron smoke
   has run after the latest combined edits.
8. No exact-source commit exists, so there is no exact SHA for dual-AI review.
   Codex and Claude Code have not approved the same source SHA.
9. Claude Code was previously observed as not logged in. Confirm authentication
   before requesting the mandatory independent Claude review.

## Transient verification receipts (not exact-source certification)

These passed at intermediate working-tree states and may have been invalidated
by later edits:

- OpenSpec strict validation: 54 passed, 0 failed.
- Shared provider/token/redaction/Codex-key policy: 12 passed, 0 failed.
- Provider Profile storage security: 6 passed, 0 failed.
- Onboarding/profile credential usability: 16 passed, 0 failed.
- Claude/helper worker report: 54 targeted tests passed before interruption.
- Lifecycle worker report: 90 targeted tests passed before interruption.
- Artifact worker report before descriptor-anchor follow-up: artifact security
  tests and 9 snapshot tests passed; the later anchor refactor was interrupted.
- One `bun run ts:check` passed during integration, but a later run observed
  transient errors while the artifact worker was editing. Run it again first.

## Resume order

1. Confirm branch, both recorded SHAs, dirty status, and Codex config hash.
2. Inspect `stable-directory.ts`, finish descriptor-anchored artifact and
   snapshot integration, and add deterministic run-directory/snapshot-directory
   swap tests. Do not keep path-only and descriptor-backed business paths.
3. Fix redact-before-truncate in helper provider diagnostics and finish the
   Claude/helper review.
4. Run `bun run ts:check`, targeted lifecycle/filesystem/credential tests,
   `git diff --check`, architecture guards, retired-runtime guard, and strict
   OpenSpec validation.
5. Run the complete test/check/build gates and both isolated Electron smokes.
6. Commit the integrated source and freeze it. Record its exact SHA.
7. Obtain fresh Codex `IMPLEMENTATION_VERIFIED` and Claude Code
   `REVIEW_APPROVED` for that same exact SHA. Resolve findings by creating a new
   SHA and repeating both reviews.
8. Only after dual approval: fast-forward local `main`, run the post-merge gate,
   record Owner acceptance, archive `add-cross-workspace-conflicts` and
   `add-headless-provider-binding`, validate the archive, and commit the
   mechanical closeout.
9. Do not push without a new, explicit Owner authorization naming the remote
   action.
