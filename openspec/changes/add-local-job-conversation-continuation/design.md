# Design: Local Job API conversation continuation

## Context

The Local Job API treats each job as one durable unit with one ordered event
stream and one terminal result. Claude Code and Codex can resume native
conversations, but the current headless adapters intentionally do not expose or
preserve that identity for API consumers.

The design must preserve the existing job/event lifecycle, keep provider-native
identity private, and fail closed when the requested context cannot be resumed.

## Goals / Non-Goals

Goals:

- let a consumer opt a run into later continuation;
- resume through a new durable job rather than reopening a settled job;
- keep native session references inside the main-process owner;
- make binding failures explicit before provider work starts;
- leave default Local Job API behavior unchanged.

Non-goals:

- adding a live steering transport or mutating an active provider turn;
- appending events to a terminal job;
- exposing Claude or Codex session identifiers as public API;
- silently retrying a failed continuation as a cold run.

## Decisions

### Continue through a new job

A consumer creates a run with `continuable: true`, reads
`continuationHandle` from its terminal result, and submits that handle on the
next `runs create`. Each link remains an ordinary `source=api` job with its own
ID, event sequence, artifacts, and terminal result. Only the runtime
conversation continues.

An append-style API would make a terminal result and resumable event cursor
conditional. A new job keeps the existing one-job-one-event-stream contract
literal and records `continuationOfJobId` for inspection.

### Mint an opaque Locus-owned handle

The handle is a random token resolved through Host-owned storage. Its row binds
the previous job, runtime, project, canonical cwd, and native session reference.
The public token carries no provider-native material.

Provider session identifiers are not stable Locus contracts. Exposing one would
bind consumers to a particular CLI format and lifetime, and would make runtime
replacement or session pruning indistinguishable from context loss.

### Make persistence opt-in

The current Claude headless path disables session persistence. That behavior is
useful for runs nobody will continue. `continuable: true` scopes persistence to
the consumer that requested it, while omitted fields retain current behavior.

### Resolve and bind before execution

A continuation handle is an execution capability, not a hint. Resolution must
reject unknown, revoked, expired, runtime-mismatched, project-mismatched, or
cwd-mismatched handles before a provider process starts. A runtime that later
cannot honor a previously resolved native session fails the job with a
structured diagnostic.

There is no cold-start fallback: a follow-up instruction may be meaningful only
inside the prior conversation, so silent amnesia is less safe than a visible
failure.

### Keep native identity out of observable surfaces

Native session references may be captured by the adapter and stored by the
main-process continuation owner. They must not appear in API envelopes, event
payloads, artifacts, command argv diagnostics, renderer state, or logs.

The terminal result may expose only the opaque Locus handle. A cancelled run may
mint a handle only when the runtime has already reported a verified native
session; cancellation before that point returns no handle.

## Risks / Trade-offs

- Persisted runtime sessions consume local storage. Opt-in creation limits the
  cost; later lifecycle work may add expiry and revocation management.
- Runtime resume behavior can change across bundled upgrades. Runtime binding
  and fail-closed diagnostics prevent accidental cross-runtime fallback.
- Cancellation can race native-session discovery. The result must report the
  absence of a handle rather than inventing one or claiming resumability.
- The active runtime-readiness proposal also extends the Local Job API. Both
  changes stay additive and use feature advertisement so consumers can detect
  support independently.

## Migration Plan

No data migration is required for existing consumers. The implementation adds
nullable lineage plus a dedicated continuation mapping table. Existing jobs and
requests remain valid, and omission of the new fields preserves current
behavior.
