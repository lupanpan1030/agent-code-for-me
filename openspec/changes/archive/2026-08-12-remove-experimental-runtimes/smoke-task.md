# Task 10.5 — desktop smoke prompt (for Codex)

This is the ONLY unfinished task in `remove-experimental-runtimes`. Everything else is done and
`bun run check` is green (1378 pass / 0 fail). Paste the command in the section below into a
terminal at the repo root.

---

You are completing task 10.5 of an approved, already-implemented OpenSpec change:
`openspec/changes/remove-experimental-runtimes/`. Two engines (`kun`, `qwen-code`) were removed.
Everything is implemented; `bun run check` is green. Your job is **verification only** — do not
implement anything, and do not "fix" what you find without reporting it first.

READ FIRST: `openspec/changes/remove-experimental-runtimes/{proposal.md,tasks.md}` (task 10.5).

## Part A — programmatic checks (do these yourself, no GUI needed)

1. `bun run check` → must be green. Report the exact pass/fail counts.
2. `node scripts/check-retired-runtime-residue.mjs` → must pass. Note it uses an explicit allowlist
   (9 files, each with a stated reason). **Do not add entries to that allowlist to make it pass, and
   do not reword, split, or escape any string to dodge it** — three such evasions happened during
   implementation and were reverted on review. If you find genuine residue, report it.
3. `openspec validate --changes --strict --no-interactive` and `--specs` → both must pass.
4. Assert the runtime set is closed at two: read `src/shared/agent-runtime-capabilities.ts` and
   confirm `AGENT_RUNTIME_IDS` is exactly `["claude-code","codex"]` and `EXPERIMENTAL_RUNTIME_IDS`
   is `[]`.
5. Confirm the startup sweep is wired: `src/main/lib/retired-runtime-state-cleanup.ts` must be
   called from `src/main/index.ts`. Read the sweep and confirm it (a) guards every deletion,
   (b) refuses symlink/path escapes, (c) cannot touch anything outside `{userData}`.

## Part B — boot the app and inspect logs (no clicking required)

6. Launch the dev app in the background and capture BOTH stdout and stderr:
   `bun run dev > /tmp/locus-smoke.log 2>&1 &`
   Give it ~40 seconds to boot, then stop it.
7. From `/tmp/locus-smoke.log`, verify:
   - the app reached a running window without an unhandled main-process exception
   - **zero** occurrences of `kun`, `Kun`, `qwen-code`, or `QwenC` in any error/warning line
   - no `Unsupported desktop job runtime` error
   - no missing-i18n-key warnings (a deleted key still referenced would surface here, not in tsc)
   - if the sweep logged anything, it did not throw
8. Report any stack trace verbatim.

## Part C — what you CANNOT verify, and must hand back

You cannot click. Explicitly report these as **unverified, needs a human**, with a one-line
instruction each:
- Engine picker (new-chat form AND active-chat input) lists only Claude Code and Codex
- Settings → Agents & Models has no Kun section, no Qwen section, and no runtime toggle
- First-run onboarding shows no empty slot where a removed engine used to be
- The reworded `onboarding.aiPath.engineNote` reads correctly in **both** English and 简体中文
- A Codex chat runs end to end
- A provider profile saves and re-saves (especially one that previously targeted Kun)
- The Jobs/History surface lists existing `agent_jobs` rows without throwing

## Output

Write your findings to
`openspec/changes/remove-experimental-runtimes/desktop-smoke-evidence.md`
following the shape of `openspec/changes/archive/2026-06-22-remove-codex-acp-temporary-compat/desktop-smoke-evidence.md`.
Include the exact commands you ran and their real output — no summaries of output you did not
capture. Then report, in your final message, anything that failed or that you could not check.

Do NOT run `git commit`. Do NOT run `bun run format` (it reformats the whole repo — this already
caused a 628-file cleanup once).
