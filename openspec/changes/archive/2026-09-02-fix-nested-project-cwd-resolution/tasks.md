# Tasks: fix-nested-project-cwd-resolution

## 1. Governance and baseline

- [x] 1.1 Confirm base `ce916a86a6f2559890e4fc2990b42d9ca49c8b15`,
      clean `main`, independent branch/worktree, canonical owner, relevant living
      specs, and active-change overlap.
- [x] 1.2 Record R2 scope, explicit non-goals, data/rollback posture, Consumer
      Impact, and Owner implementation approval.
- [x] 1.3 Strictly validate the OpenSpec change before source implementation.

## 2. Implementation and tests

- [x] 2.1 Replace implicit first-match return with a scan that selects the
      eligible matching canonical `projectReal` path of greatest length.
- [x] 2.2 Add the ordering-adversarial nested registration test, including a
      longer unrelated root, explicit `projectId` preservation, canonical result,
      and no query-side mutation.
- [x] 2.3 Prove the implementation contains no `.git`, `gitdir`, `commondir`, or
      worktree admission logic and does not change explicit resolution.

## 3. Verification and review

- [x] 3.1 Run targeted project-registry tests, TypeScript/architecture checks,
      strict OpenSpec validation, `git diff --check`, and `bun run check:full`.
- [x] 3.2 Freeze a local source commit and record the exact source/base SHA plus
      actual receipts in `verification.md`; record Codex `IMPLEMENTATION_VERIFIED`.
- [x] 3.3 Obtain fresh-context, read-only Claude Code review of the same exact
      source SHA and record findings plus `REVIEW_APPROVED` or
      `CHANGES_REQUESTED`.
- [x] 3.4 Stop before local integration. Owner `ACCEPTED`, local merge,
      post-merge validation, archive, push, remote merge, and release remain
      pending or unauthorized as applicable.

## 4. Accepted closeout

- [x] 4.1 Record Owner `ACCEPTED` for source SHA `1cce15b4` and supersede the
      historical stop point in 3.4 only for the explicitly authorized local
      integration, archive, and one-time coordinated `main` push.
- [x] 4.2 Merge evidence head `44c437f4` into the post-1c `main` with `--no-ff`,
      resolve only the authorized `openspec/STATUS.md` evidence-ledger conflict,
      preserve the reviewed source SHA in history, and pass `bun run check:full`
      on the exact merge SHA.
- [x] 4.3 Archive normally with
      `openspec archive fix-nested-project-cwd-resolution --yes` (apply the
      `project-lifecycle` delta; do not use `--skip-specs`), update
      `openspec/STATUS.md`, and strictly validate the archived state.
