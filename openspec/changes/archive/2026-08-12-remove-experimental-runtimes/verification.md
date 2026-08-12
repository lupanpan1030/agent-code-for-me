# Verification

## 2026-08-12 — Task 10.3 residue criterion correction

The task's original raw grep returned 20 matching lines across nine files; it did not produce the
recorded zero-hit result. Those matches are not live retired-runtime product paths. They are the
startup cleanup required by Decision 5/task 9.1, negative and compatibility tests required by task
10.3b, the protected Ollama `qwen-coder` model surface, and the checker itself.

The executable gate is now the task criterion:

```text
node scripts/check-retired-runtime-residue.mjs
Retired-runtime residue check passed (1108 files scanned, 9 allowlisted).
```

This establishes zero unallowlisted residue while keeping every intentional reference literal and
reviewable. The proposal, design decisions, and delta specs were not changed.

## 2026-08-12 — Independent provider-profile gate commit

Commit `6b5680aa` keeps the task 5 save-semantics change independently reviewable. At that boundary,
the storage schema excludes the retired target while its exported Zod types remain compatible with
the not-yet-narrowed shared contract. The following implementation commit narrows the shared type
and removes the temporary schema exclusion.

An isolated checkout of `6b5680aa` passed `bun run check`: lint, architecture guards, and TypeScript
were green; tests reported `1458 pass / 0 fail / 7394 assertions / 263 files`.
