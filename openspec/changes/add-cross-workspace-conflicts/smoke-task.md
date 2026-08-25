# Task 6.4 — desktop smoke prompt (for Codex, or click through yourself)

Everything else in `add-cross-workspace-conflicts` is done and host-green (1437 pass / 0 fail).
The smoke FIXTURE IS ALREADY SEEDED — do not rebuild it:

- Scratch repo + two worktrees live under the session scratchpad:
  `/private/tmp/claude-501/-Users-ethan-Code-GitHub-agent-code-for-me/4cad2783-7f48-434f-b790-a4b91dadbe27/scratchpad/cwc-smoke/`
  - `ws-a` (branch `cwc-a`) and `ws-b` (branch `cwc-b`), both forked from `main`
  - `shared.ts`: conflicting UNCOMMITTED edits in both worktrees → tier-a annotation case
  - `conflict.ts`: conflicting COMMITTED edits in both branches → merge-trial case
- Dev DB (`~/Library/Application Support/Agent Code for Me Dev/data/agents.db`) has seeded rows:
  project `cwc-smoke-proj` ("CWC Smoke"), chats `cwc-smoke-a` ("Workspace A") / `cwc-smoke-b`
  ("Workspace B") with those worktree paths, `base_commit` NULL on purpose — the deep check must
  backfill it live (this smokes task 2.3's lazy backfill too).
- First launch will also apply drizzle migration 0022 (`base_commit`) to the dev DB — confirm no
  migration error dialog.

Run `bun run dev`, open the Agent Workbench view, then verify and RECORD in
`openspec/changes/add-cross-workspace-conflicts/desktop-smoke-evidence.md` (follow the archived
removal change's evidence format; append-only, real observations, no summaries of things not seen):

1. Both "CWC Smoke" task cards show the cross-workspace conflict annotation for `shared.ts`
   within one refresh, naming the sibling Workspace. Statuses/filters unchanged by it.
2. Clicking the annotation opens the existing per-Workspace diff filtered to `shared.ts`.
3. The deep-check affordance is visible EVEN considering `conflict.ts` has no tier-a warning
   (committed-only class). Run it: the merge trial reports a CONFLICT verdict for `conflict.ts`
   labeled committed-changes-only; the `shared.ts` uncommitted warning is NOT suppressed.
4. Verdict shows computed-at provenance. Edit any file in one worktree, refresh: the verdict
   marks stale, and does NOT silently re-run.
5. Switch app language to 简体中文: annotation, deep-check, verdict, and stale copy all render
   translated (no raw keys, no English fallback).
6. Git-version degradation: covered by unit tests (probe + labeled degrade); a live PATH-shim run
   is optional — if skipped, record "covered by tests, not exercised live".
7. No unhandled main-process exception in the dev console during any of the above.

CLEANUP after recording (do not skip):
  sqlite3 "$HOME/Library/Application Support/Agent Code for Me Dev/data/agents.db" \
    "DELETE FROM sub_chats WHERE chat_id LIKE 'cwc-smoke%'; DELETE FROM chats WHERE id LIKE 'cwc-smoke%'; DELETE FROM projects WHERE id='cwc-smoke-proj';"
  rm -rf "<the scratchpad cwc-smoke dir above>"
Then tick 6.4 in tasks.md. Do NOT run `bun run format`. Do NOT commit.
