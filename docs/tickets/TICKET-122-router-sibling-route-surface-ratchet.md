# TICKET-122 — Router sibling route surface ratchet coverage

## Status

待设计 / 未授权实施（Foundation 1c Yellow follow-up；2026-09-02）。

Foundation 1c does not implement this ticket. It remains outside the 1c fix and closeout
scope until a separate design, approved OpenSpec change, and Owner authorization exist.

## Context

Foundation 1c's `routeSurfaceRatchets` intentionally tracks only
`src/main/lib/trpc/routers/claude.ts` and `src/main/lib/trpc/routers/codex.ts`. A new sibling
file under `src/main/lib/trpc/routers/` can therefore contain or receive new business logic
without changing either tracked file, and `architecture:check` does not reject that route
surface growth.

Both fresh-context 1c review rounds independently found this P2 gap. The first review
reproduced it with a new sibling router file, and the superseding `CHANGES_REQUESTED`
review carried the finding forward. This does not weaken the two named-file ratchets'
narrow guarantees; it shows that they are not a directory-level new-route admission gate.

## Future design space (no decision yet)

A future approved change should evaluate directory-level governance without assuming an
implementation in this ticket. Candidate directions include:

- a checked-in directory-level registry that enumerates governed router modules and records
  each route's canonical owner and containment semantics; or
- a new-route admission gate that rejects newly added router modules until an explicit,
  reviewed admission record describes their transport role, owner, and applicable ratchet.

The design may combine these ideas or choose another mechanism. It must decide how router
discovery, root-router composition, generated/test-only files, per-route governance modes,
baseline tightening, and fail-closed parsing interact before implementation begins.

## Out of scope until approved

- Adding a directory scan, registry, admission manifest, or new guard in Foundation 1c.
- Expanding, replacing, or retiring the existing Claude temporary-owner ratchet or Codex
  orchestration-boundary no-growth ratchet.
- Choosing a universal line-count, export-count, or procedure-count policy for every router
  without an ownership inventory and design review.
- Moving product logic between routes and lib owners as part of this ticket registration.

## Acceptance outline for a future approved change

- A negative fixture proves that an unadmitted new sibling under
  `src/main/lib/trpc/routers/` is rejected, including when it is wired only through router
  composition and does not modify `claude.ts` or `codex.ts`.
- Every admitted route has explicit canonical ownership and governance semantics; a generic
  registry entry cannot silently waive containment.
- Registry/admission data, documentation mirrors, and committed baselines fail closed and
  cannot grow through an ordinary blocking run without the approved review path.
- Existing route-specific ratchets retain their distinct semantics unless the approved
  design explicitly migrates them, and `bun run check:full` remains green.
