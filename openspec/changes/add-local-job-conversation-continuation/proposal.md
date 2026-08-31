# Change: Add Local Job API conversation continuation

## Why

Every Local Job API run is a cold start. `runs create` accepts no reference to
prior work, `runs result` returns no way to reach the run again, and the headless
adapters discard runtime session state. A consumer that wants to refine finished
or intentionally interrupted work must therefore rebuild all context in a fresh
prompt.

Both supported runtimes already expose resumable native conversations, but those
identifiers are provider-owned details. Locus needs an opaque, bound handle if it
is going to offer continuation without leaking native session identities or
silently starting cold when a resume cannot be honored.

## What Changes

- Add an opt-in `continuable` request flag to `locus api runs create`.
- Return an opaque `continuationHandle` from a terminal continuable run.
- Accept `continuation.handle` on a later `runs create`, producing a new durable
  job whose runtime resumes the referenced conversation.
- Bind handles to runtime, project, and cwd; keep native session identifiers in
  the main process and out of API envelopes, events, artifacts, and logs.
- Reject unknown, revoked, expired, or mismatched handles before provider work
  starts instead of silently degrading to a cold run.
- Record continuation lineage separately from retry lineage.

Explicitly out of scope: a new live-control transport, in-process prompt
injection, steering revisions, and a graceful interrupt distinct from cancel.
Continuation is the prerequisite those later controls can build on without
changing the one-job-one-terminal-event-stream contract.

## Impact

- Affected spec: `local-job-api`
- Affected code: Local Job API request/result contracts, headless CLI parsing,
  runtime adapters, job storage, migrations, and focused tests
- Security: handles are opaque capability references bound to one runtime,
  project, and cwd; native runtime session identifiers remain private
- Compatibility: additive; requests that omit the new fields keep the current
  non-persistent cold-start behavior
