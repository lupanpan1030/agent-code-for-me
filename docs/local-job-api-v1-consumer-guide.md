# Local Job API v1 Consumer Guide

Languages: English | [Simplified Chinese](local-job-api-v1-consumer-guide.zh-CN.md)

This guide is for downstream local applications that want to use Locus as the
runtime layer without importing Locus source code or reading `agents.db`
directly. The contract is runtime- and domain-neutral.

The v1 entrypoint is the machine-readable CLI group:

```bash
locus api ...
```

Machine-readable contract: [local-job-api-v1.schema.json](local-job-api-v1.schema.json)

Use `locus api` for integrations. Keep `locus run` and `locus jobs` for humans
and compatibility scripts.

## Documentation Model

This guide follows the structure of established official manuals:

- [GitHub CLI Manual](https://cli.github.com/manual/) separates installation,
  configuration, command reference, and examples for scriptable CLI use.
- [Stripe API Reference](https://docs.stripe.com/api?lang=curl) makes request
  and response envelopes explicit and treats errors as part of the integration
  contract.
- [Docker CLI Reference](https://docs.docker.com/reference/cli/docker/)
  documents environment/configuration rules, examples, subcommands, and
  sensitive configuration warnings.

The Locus guide applies those patterns to a local CLI + JSON contract rather
than an HTTP API.

## What v1 Provides

Local Job API v1 lets a consumer:

- list runtime capability manifests
- create an agent run
- create a single-shot completion
- submit an agent run or completion and receive its job ID before it runs,
  then wait for it with a bounded timeout (feature `async-submit`)
- read run status
- read normalized event envelopes
- read the final result envelope
- cancel a queued or running API job
- retry a failed, canceled, or interrupted API job, optionally
  asynchronously and with an idempotency key (feature `async-submit`)
- collect run-owned metadata artifacts
- register, inspect, and non-destructively unregister local project workspaces

It does not provide:

- an HTTP or WebSocket server
- hosted queues or cloud agents
- direct writes into downstream `final/` artifacts
- provider credential passing from the consumer
- access to Locus SQLite internals
- a complete OS sandbox
- project history deletion from CLI or Local Job API commands

## Install and Locate the CLI

The packaged app includes a `locus` launcher. During development, this repo uses:

```bash
resources/cli/locus api runtimes list --json
```

For a packaged macOS app, the launcher is under the app resources directory:

```bash
/Applications/Locus.app/Contents/Resources/cli/locus api runtimes list --json
```

For Windows, use the packaged `locus.cmd` launcher from the app resources
directory. Source-level shim behavior is tested, but Windows packaged
real-machine smoke is explicitly deferred and is not required for current
source/macOS consumer integration.

Development smoke can override the headless executable:

```bash
LOCUS_HEADLESS_EXECUTABLE=/path/to/locus-electron-wrapper \
LOCUS_USER_DATA_DIR=/tmp/locus-api-profile \
resources/cli/locus api runtimes list --json
```

Production consumers should not set `LOCUS_HEADLESS_EXECUTABLE`. It exists for
local QA and packaging smoke.

## Command Reference

```bash
locus api runtimes list --json
locus api runs submit --request <path|-> --json
locus api runs create --request <path|-> --json
locus api runs wait <job-id> [--timeout <milliseconds>] --json
locus api runs status <job-id> --json
locus api runs events <job-id> [--after <sequence>] [--follow] --jsonl
locus api runs result <job-id> --json
locus api runs cancel <job-id> --json
locus api runs retry <job-id> [--request <path|->] [--async] --json
locus api projects register --cwd <path> [--name <name>] --json
locus api projects status --cwd <path> --json
locus api projects unregister --cwd <path> [--force] --json
```

Rules:

- JSON commands write parseable JSON to stdout.
- Event streams write one JSON object per line.
- Diagnostics and validation errors go to stderr.
- `--request -` reads the create, submit or retry request from stdin.
- `--after <sequence>` returns events with `sequence` greater than that value.
- `create` and `retry` (without `--async`) run synchronously and return after
  the run reaches a terminal status. On builds with `async-submit` they are a
  submit followed by a wait in the same process, with the same output; see
  [Synchronous create and default retry](#synchronous-create-and-default-retry).
- `submit`, `wait`, `retry --async` and `retry --request` need the
  `async-submit` feature. `submit` returns as soon as the run is recorded and
  `wait` is a bounded, read-only wait; see
  [Asynchronous Submission](#asynchronous-submission-async-submit).
- `projects unregister` is non-destructive: it removes the project from active
  registration but does not delete chats, sub-chats, worktrees, job history, or
  repository files. Permanent project-history deletion is desktop UI only.

## Minimal Consumer Flow

1. Build or locate a downstream package directory.
2. Ensure `project.cwd` points to a Locus-registered local project or a
   subdirectory inside one.
3. Put `artifacts.baseDir` inside `project.cwd`.
4. List runtime capabilities.
5. Create a run with `locus api runs create`, or, with `async-submit`,
   submit it with `locus api runs submit` and keep the returned job ID.
6. Read `status`, `events`, and `result` by job ID (after a submit, use
   `locus api runs wait` to wait for the published result).
7. Let the downstream app promote or copy final business artifacts only after
   its own user review.

## Project Registration Commands

Consumers can register a project path before creating runs:

```bash
locus api projects register --cwd "$PROJECT_DIR" --json
locus api projects status --cwd "$PROJECT_DIR" --json
locus api projects unregister --cwd "$PROJECT_DIR" --json
```

Registration is idempotent by canonical project path. In the project lifecycle
change, re-registering a removed project restores the existing project
registration and keeps retained chat history linked to the same project.

`unregister` means "remove from the active Projects list." It is a soft removal
for automation safety:

- it does not delete chats or sub-chats
- it does not delete Locus worktrees
- it does not delete job history
- it does not delete repository files
- `--force` only bypasses the active-job refusal for active-list removal; it
  still does not delete project history

There is no `locus api projects delete-history` command in v1. Permanent project
history deletion is available only in the desktop UI, after the project has first
been removed from the active Projects list and the user confirms the affected
chat/worktree counts.

## Runtime Capabilities

Check runtime capabilities before creating a job:

```bash
locus api runtimes list --json
```

Response shape:

```json
{
  "apiVersion": "locus.local-job.v1",
  "features": [
    "runtime-readiness",
    "provider-binding",
    "completion",
    "canonical-run-ledger"
  ],
  "runtimes": [
    {
      "runtimeId": "codex",
      "readiness": {
        "state": "needs-auth",
        "detail": "Codex login is required.",
        "hint": "Connect Codex with ChatGPT login, use a Codex API key, or choose a provider profile."
      },
      "capabilities": [
        {
          "id": "planMode",
          "state": "supported",
          "scope": "runtime",
          "reason": "..."
        }
      ]
    }
  ]
}
```

Discovery features:

| Feature | Meaning |
| --- | --- |
| `runtime-readiness` | Each runtime carries the advisory `readiness` object described below. |
| `provider-binding` | Create requests honor the `provider` reference block. |
| `completion` | `kind: "completion"` requests are supported. |
| `canonical-run-ledger` | Events and results come from one committed Run ledger: dense per-record event projection, corrected terminal truth and optional native metadata. See [Canonical Run Ledger](#canonical-run-ledger). |
| `async-submit` | `runs submit`, `runs wait`, `runs retry --async` / `--request`, the optional `idempotencyKey` and the `execution` member of `runs status` are available, and `create`/`retry` run as submit plus wait. See [Asynchronous Submission](#asynchronous-submission-async-submit). |

A consumer that depends on a feature checks `features` before dispatch and
treats a missing identifier as unsupported. Existing create request fields do
not require a feature. `idempotencyKey` (accepted only by `runs submit` and
`runs retry --request`) and the `submit`, `wait`, `retry --async` and
`retry --request` command shapes require an `async-submit` preflight: an older
build rejects those command shapes with a stderr diagnostic and exit `2`, but
an older build silently ignores an `idempotencyKey` sent to `runs create` and
runs the job without idempotency. Never assume a silently dropped field was
honored. Locus does not negotiate extensions; the check is the consumer's own
preflight. The `discoveryFeature` enum in
[local-job-api-v1.schema.json](local-job-api-v1.schema.json) is closed: a
consumer that validates discovery output against a pinned older copy of the
schema must refresh that copy, because ignoring unknown fields does not cover
new enum values. `async-submit` extends that enum, so a copy pinned before
this feature rejects current discovery output at `async-submit` until it is
refreshed.

`readiness.state` is advisory and can be `ready`, `needs-auth`, `unavailable`,
or `unknown`. Discovery still exits 0 and returns the full manifest list when a
readiness probe fails; that runtime reports `unknown` and diagnostics go to
stderr. Use `locus api runtimes list --json --no-probe` to skip subprocess
status probes; skipped probed states report `unknown` rather than `ready`.

`readiness` describes the environment of the process that runs
`runtimes list`. On builds with `async-submit`, a run claimed by
`locus daemon run` executes in the daemon's environment (see
[Execution context](#execution-context)), so `ready` here does not prove that
the daemon is ready.

For a provider-omitted agent run, readiness follows the real execution order:
the runtime's headless default profile first, then native credentials only when
no default is configured. A usable, target-compatible default reports `ready`.
A configured default that is missing, malformed, undecryptable, or targets a
different runtime reports `unavailable` and does not advertise native auth as a
fallback, because the actual run would fail closed. `--no-probe` skips native
subprocess probes; it still performs this cheap default-profile check. This is
runtime-default readiness, not a diagnostic for an arbitrary profile supplied
on a future create request.

Use `runtime.requiredCapabilities` in the create request when the downstream
workflow depends on a capability. Locus rejects unsupported or degraded required
capabilities before provider work starts.

Common runtime IDs:

- `codex`
- `claude-code`
- `claude` as an accepted alias for `claude-code`

Common modes:

- `plan`
- `agent`

Execution profiles:

- omit `runtime.executionProfile` or set `batch`: default v1 behavior. Codex
  uses `codex exec`; Claude uses `claude -p` when capability and permission
  gates allow the run.
- `policy-grant`: advanced, explicit opt-in for a non-batch adapter profile.
  It currently requires `runtime.policyGrant.scopes` and is treated as
  admission/audit metadata in v1. The declared scope strings are not yet a
  stable per-scope app-server enforcement boundary.

Provider selection:

- omit `provider`: Locus first checks the headless default profile for the
  runtime (`claude-main` for Claude Code, `codex-main` for Codex). If no
  default profile is configured, the runtime uses its native credentials.
- set `provider.profileId`: Locus resolves that stored provider profile in the
  main process, creates a scoped local gateway token for this run, and fails
  closed if the profile is missing, targets another runtime, or cannot decrypt.
- set `provider.model`: passes a model override. When used without
  `provider.profileId`, it selects runtime-managed credentials and bypasses
  headless defaults.

If `provider` is present, it must contain at least one non-empty `profileId` or
`model`. Empty or nullable provider blocks are invalid; only omission of the
entire property selects the default-profile path.

Consumers must pass only provider references. Never send provider tokens,
headers, or environment variables in `provider`, `input`, or artifacts.

Completion jobs are stricter than agent jobs: they require
`provider.profileId` and do not use runtime defaults or native credential
fallback.

## Agent Create Request

Example for a generic local package:

```json
{
  "apiVersion": "locus.local-job.v1",
  "consumer": {
    "id": "docs-workbench",
    "runExternalId": "package-review-001"
  },
  "project": {
    "cwd": "/Users/alice/LocalPackages/example-package",
    "projectId": null
  },
  "runtime": {
    "id": "codex",
    "requiredCapabilities": ["planMode"]
  },
  "mode": "plan",
  "prompt": {
    "text": "Review this local package and produce a readiness note."
  },
  "provider": {
    "profileId": "codex-main",
    "model": "gpt-5.3-codex"
  },
  "input": {
    "contract": "example.local-package.v1",
    "packageDir": "/Users/alice/LocalPackages/example-package",
    "sourceMetadata": "source.json"
  },
  "artifacts": {
    "baseDir": "/Users/alice/LocalPackages/example-package/.locus/runs",
    "writePolicy": "metadata-only"
  }
}
```

Run it:

```bash
locus api runs create --request request.json --json
```

Or pipe it:

```bash
cat request.json | locus api runs create --request - --json
```

## Completion Create Request

Completion jobs are for one upstream model request with no tools, worktree,
artifacts, or runtime child process. They are selected with
`"kind": "completion"`.

Text completion:

```json
{
  "apiVersion": "locus.local-job.v1",
  "kind": "completion",
  "consumer": {
    "id": "generic-tool",
    "runExternalId": "text-task-001"
  },
  "provider": {
    "profileId": "completion-main",
    "model": "provider-model"
  },
  "messages": [
    {
      "role": "user",
      "content": "Summarize this generic text in one paragraph."
    }
  ],
  "responseFormat": {
    "type": "text"
  }
}
```

Structured completion:

```json
{
  "apiVersion": "locus.local-job.v1",
  "kind": "completion",
  "consumer": {
    "id": "generic-tool"
  },
  "provider": {
    "profileId": "completion-main"
  },
  "messages": [
    {
      "role": "user",
      "content": "Return a label and confidence for this generic input."
    }
  ],
  "responseFormat": {
    "type": "json_schema",
    "schema": {
      "type": "object",
      "required": ["label", "confidence"],
      "properties": {
        "label": { "type": "string" },
        "confidence": { "type": "number" }
      }
    }
  }
}
```

`responseFormat.schema` is caller-owned JSON Schema. Locus maps it to the
provider's native structured-output mechanism, validates the returned JSON
against it, and does not interpret the schema fields.

## Request Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `apiVersion` | yes | Must be `locus.local-job.v1`. |
| `consumer.id` | yes | Stable downstream app ID, such as `docs-workbench`. |
| `consumer.runExternalId` | no | Consumer-owned run ID for correlation. |
| `project.cwd` | yes | Absolute local path for the run. Must exist and be inside a registered Locus project. |
| `project.projectId` | no | Optional Locus project ID. If provided, `cwd` must be inside that project. |
| `runtime.id` | yes | `codex`, `claude-code`, or accepted alias `claude`. |
| `runtime.requiredCapabilities` | no | Capability IDs that must be supported before runtime work starts. |
| `runtime.executionProfile` | no | `batch` or `policy-grant`. Defaults to `batch`; existing v1 callers should omit it unless they need the explicit gated profile. |
| `runtime.policyGrant.scopes` | when `runtime.executionProfile` is `policy-grant` | Bounded scope labels for admission/audit. In v1 these labels do not yet bind app-server permission decisions. |
| `runtime.policyGrant.canDecideAutomatically` | no | Optional boolean. If false for `policy-grant`, Locus fails closed because no visible user is available. |
| `mode` | yes | `plan` or `agent`. |
| `prompt.text` | yes | Prompt text. Max size is 256 KiB. |
| `provider.profileId` | no | Stored provider profile ID. The request carries only the reference; Locus resolves credentials in the main process. |
| `provider.model` | no | Model override. Without `provider.profileId`, this uses runtime-managed credentials and does not consult defaults. |
| `input` | no | Consumer-owned structured metadata. Must not contain secrets. |
| `artifacts.baseDir` | no | Absolute directory for Locus run metadata. Must be inside `project.cwd`. |
| `artifacts.writePolicy` | no | `metadata-only` or `proposal-only`. Defaults to `metadata-only`. |

Completion-only fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `kind` | yes | Must be `completion`. Omitted `kind` means an agent request. |
| `provider.profileId` | yes | Stored provider profile ID. Completion jobs fail closed if it is absent or unusable. |
| `provider.model` | no | Model override for the selected profile. |
| `messages` | yes | Ordered `system`, `user`, or `assistant` messages. |
| `maxTokens` | no | Maximum output token count. |
| `temperature` | no | Number from `0` to `2`. |
| `responseFormat` | no | `{ "type": "text" }` or `{ "type": "json_schema", "schema": ... }`. Defaults to text. |

Completion requests reject agent-only fields such as `project`, `mode`,
`prompt`, `input`, and `artifacts`.

Identifier limits:

- `consumer.id`: 1-80 chars, letters, numbers, `.`, `_`, `:`, `-`
- `consumer.runExternalId`: 1-160 chars, same character set
- request JSON: max 1 MiB

## Artifact Contract

If `artifacts.baseDir` is set, Locus writes run-owned metadata here:

```text
<artifacts.baseDir>/<jobId>/
  request.json
  events.jsonl
  result.json
  artifacts.json
```

For a generic local package, the recommended layout is:

```text
example-package/
  source.json
  source.md
  notes.md
  drafts/
  final/
  .locus/
    runs/
      <jobId>/
        request.json
        events.jsonl
        result.json
        artifacts.json
```

Rules:

- `artifacts.baseDir` must be absolute.
- It must be inside `project.cwd`.
- It cannot be inside `.git`.
- It cannot be inside a path component named `final`.
- If it already exists, it must be a directory.
- Existing path components cannot be symlinks that escape the project.
- Locus does not promote output into downstream `final/` directories in v1.

Use `final/` only for downstream/user-approved material.

Every `artifacts` entry in the manifest and the result carries a `role`. Locus
run-dir files use `request`, `events`, `result` and `manifest`. On API create
and retry, the initial `artifact_created` for the prepared run-dir files still
precedes `job_started`.

On builds with `canonical-run-ledger`, the final `events.jsonl`, `result.json`
and `artifacts.json` are prepared from the run's frozen terminal prefix and
registered in the same durable commit as the run's one `completed`. They do not
emit their own `artifact_created` events. Once committed they are immutable:
their recorded SHA-256 keeps matching the bytes even when late diagnostics
arrive (see [Late observations](#late-observations)). If final file
preparation fails, the run cannot succeed; it settles `failed` (or keeps
`canceled`/`interrupted`) with `terminal_artifact_preparation_failed` in
`completed.payload.reasons` and no unverified entries.

The run's artifact owner also admits native artifact candidates. Codex
app-server runs (`runtime.executionProfile: "policy-grant"`) report the path of
a generated image (`imageGeneration.savedPath`), the paths of completed file
changes and the turn's cumulative diff as candidates. The runtime never creates
an artifact itself, and Locus grants no filesystem access beyond the run
directory:

- A candidate is admitted only as a stable regular file inside this run's
  directory. Its entry has role `native-image`, `native-file` or `native-diff`
  and the usual `path`, `sha256`, `contentType` and `sizeBytes`.
- Locus writes the turn's final diff into the run directory as
  `native-diff-<n>.patch` and then admits it. Diff content that contains an exact
  secret is not written.
- Every other candidate becomes a `status` record with
  `subtype: "artifact_admission"`, `result: "rejected"`, the candidate `role` and
  a `reason` of `missing`, `out_of_scope`, `ownership_mismatch`,
  `digest_mismatch` or `redaction_unsafe`. The record never carries the path or
  content. Workspace edits and images saved outside the run directory are
  therefore rejected as `out_of_scope`.
- An admitted entry's `artifact_created` precedes the run's `completed`. The
  final `result.json`, `artifacts.json` and the result envelope list admitted
  entries after the Locus run-dir files.
- `runs result` lists only entries whose digest the run's ledger registered, so
  files prepared for a terminal that has not been committed are never listed.

Batch Codex and Claude runs, completion runs and runs without
`artifacts.baseDir` submit no native candidates. Treat unknown roles as
additive.

## Create Response

`create` returns a v1 envelope with the serialized job and final result:

```json
{
  "apiVersion": "locus.local-job.v1",
  "job": {
    "id": "mpzcxv3xp2ji1fl2",
    "source": "api",
    "runtime": "codex",
    "mode": "plan",
    "status": "succeeded",
    "apiConsumerId": "docs-workbench",
    "apiConsumerRunId": "package-review-001",
    "artifactManifestPath": "/.../.locus/runs/mpzcxv3xp2ji1fl2/artifacts.json"
  },
  "result": {
    "apiVersion": "locus.local-job.v1",
    "jobId": "mpzcxv3xp2ji1fl2",
    "status": "succeeded",
    "runtime": "codex",
    "mode": "plan",
    "consumer": {
      "id": "docs-workbench",
      "runExternalId": "package-review-001"
    },
    "artifactManifestPath": "/.../.locus/runs/mpzcxv3xp2ji1fl2/artifacts.json",
    "providerProfileId": "codex-main",
    "modelOverride": "gpt-5.3-codex",
    "artifacts": [],
    "diagnostics": [],
    "resolvedProvider": {
      "source": "request-profile",
      "profileId": "codex-main",
      "model": "gpt-5.3-codex"
    },
    "result": {}
  }
}
```

The exact `job` object may include additional renderer-safe fields. Consumers
should require only fields documented in this guide.

On builds with `async-submit`, `create` is a `runs submit` plus a `runs wait`
in the same process, and its normal terminal output is this same envelope,
byte for byte. `create` rejects `idempotencyKey`; see
[Idempotency](#idempotency).

## Status

```bash
locus api runs status <job-id> --json
```

Response:

```json
{
  "apiVersion": "locus.local-job.v1",
  "job": {
    "id": "mpzcxv3xp2ji1fl2",
    "source": "api",
    "status": "succeeded"
  }
}
```

Only `source=api` jobs can be read through `locus api runs ...`.

On builds with `async-submit`, the status of a `queued` or `running` API job
also carries an advisory `execution` object; terminal jobs omit it. See
[Executor availability](#executor-availability).

## Events

```bash
locus api runs events <job-id> --after 0 --jsonl
```

Each line is one event envelope:

```json
{"apiVersion":"locus.local-job.v1","jobId":"mpzcxv3xp2ji1fl2","sequence":1,"type":"job_created","createdAt":"2026-06-04T10:33:00.000Z","payload":{}}
```

Stable v1 event types:

- `job_created`
- `job_started`
- `assistant_delta`
- `reasoning_delta`
- `tool_started`
- `tool_delta`
- `tool_finished`
- `usage_update`
- `artifact_created`
- `status`
- `error`
- `completed`

Envelope and payload rules:

- `payload` is the bare, redacted semantic payload of the record. There is no
  wrapper object: `runId`, `runEventSequence` and `redaction` keys never appear.
- Internal record types outside the twelve public types are delivered as
  `status` at their own sequence, with `payload.subtype` set to the internal
  type name (for example `command_output` or `permission_requested`) and their
  payload members kept.
- On builds with `canonical-run-ledger`, every committed record is projected
  exactly once at its original `sequence`. The sequence domain stays dense and
  is never renumbered, which increases the number of `status` events per run.
  Page with `--after`, and do not assume a bounded event count per run.
  Consumers that only handle their existing non-`status` types keep those
  semantics.
- Ignore unknown payload fields, unknown `status` subtypes and unknown
  `payload.extensions` namespaces.

Event continuation logic:

```text
lastSequence = 0
read events with --after lastSequence
for each event:
  process event
  lastSequence = event.sequence
repeat until job is terminal
```

Use `--follow` if you want the command to wait for new events until the job is
terminal. `--follow` exits after the terminal `completed` and does not wait for
late diagnostics; read again with `--after <completed sequence>` to collect them.

## Result

```bash
locus api runs result <job-id> --json
```

Response:

```json
{
  "apiVersion": "locus.local-job.v1",
  "jobId": "mpzcxv3xp2ji1fl2",
  "status": "succeeded",
  "runtime": "codex",
  "mode": "plan",
  "consumer": {
    "id": "docs-workbench",
    "runExternalId": "package-review-001"
  },
  "artifactManifestPath": "/.../.locus/runs/mpzcxv3xp2ji1fl2/artifacts.json",
  "artifacts": [
    {
      "role": "request",
      "path": "/.../request.json",
      "sha256": "...",
      "contentType": "application/json",
      "sizeBytes": 1234
    }
  ],
  "diagnostics": [],
  "resolvedProvider": {
    "source": "request-profile",
    "profileId": "codex-main",
    "model": "gpt-5.3-codex"
  },
  "result": {
    "finalMessage": "..."
  }
}
```

Read `diagnostics` before treating a non-success status as user-visible output.
`resolvedProvider` is authoritative only on terminal result envelopes. In-flight
status polling may show provisional provider fields while Locus is still
resolving defaults or minting scoped gateway tokens.

Completion result envelopes use the same outer result shape. The inner
`result` is:

```json
{
  "content": {
    "label": "example",
    "confidence": 0.91
  },
  "usage": {
    "inputTokens": 12,
    "outputTokens": 6
  },
  "resolvedProvider": {
    "source": "request-profile",
    "profileId": "completion-main",
    "model": "provider-model"
  }
}
```

For text completion, `content` is a string. For `json_schema` completion,
`content` is JSON that has already been validated against the caller schema.

Provider binding errors are fail-closed. If an explicitly selected profile or a
configured headless default profile is unavailable, the job fails with a
structured diagnostic such as `provider_profile_not_found`,
`provider_profile_required`, `provider_profile_runtime_mismatch`, or
`provider_profile_unavailable`. Locus does not silently fall back to native
runtime credentials in those cases.
`provider_profile_required`, `provider_profile_not_found`, and
`provider_profile_runtime_mismatch` are invalid request errors and exit `2`;
`provider_profile_unavailable` is a credential availability error and exits `4`;
`local_only_guard_blocked` means the configured profile targets a hosted Locus
or remote-sandbox service disabled by local-only mode and exits `6`.

## Canonical Run Ledger

Builds that list `canonical-run-ledger` in `features` record every run through
one committed ledger in the process that hosts the run. Commands, request
fields, the twelve event types, the six-field event envelope, `jobId` and the
`sequence` cursor are unchanged. What changes is which runs succeed, what the
single `completed` record carries, and how many `status` records a run has.

### What changes for consumers

- **Terminal truth (breaking).** A run's status comes from recorded evidence,
  not from a runtime's default success. A recorded denial, invalid output or
  empty output makes the run `failed` with exit `1` even when the runtime
  reported success. Empty output is accepted only when Locus's own internal
  request explicitly allows it. A retryable `error` followed by a live success
  with valid output stays `succeeded` with exit `0`. See
  [Outcome and exit examples](#outcome-and-exit-examples).
- **`completed.payload` is the ledger outcome.** Each run has exactly one
  `completed`. Its payload is `{status, reasons?, evidenceKeys, synthetic?,
  recovery?, code?, message?, lossPossible?, exitCode?, errorCode?,
  errorMessage?, result?}`. `exitCode`, `errorCode`, `errorMessage` and
  `result` keep the same meaning as before (the run's exit code, error code,
  redacted error message and public result, the same values `runs status` /
  `runs result` report). They are nullable: a settlement that has no such
  value carries `null`, never an invented value (for example `result` on a
  queued cancel, or `exitCode` and `result` on a worker recovery). `result`
  never carries Locus-internal members such as registered artifact refs.
  These four members have the same stability tier as the base job envelope
  fields: optional, nullable and additive. Require none of them, accept
  `null`, and ignore members you do not recognize.
- **More `status` records.** Every committed record is projected once at its
  original sequence (see [Events](#events)). Page with `--after`.
- **Redaction markers.** In persisted records, events, `events.jsonl`,
  `result.json` and diagnostics, values removed by a redaction rule (sensitive
  keys and known credential patterns) read `<redacted>`, and configured exact
  secret hints (such as a provider credential registered for the run) read
  `<mask>`. The store previously also wrote `[redacted]`, `[redacted-jwt]` or
  `[redacted-pem]` for some patterns. Treat every marker as opaque text; do not
  parse it.
- **Bare payloads.** API event payloads remain the bare semantic payload. The
  desktop-only `{runId, runtimeId, runEventSequence, redaction, payload}`
  wrapper is gone for new runs and never appears through `locus api`.
- **Optional native metadata.** Runtime-backed Codex app-server records can add
  `payload.extensions["runtime.codex.v1"]`. See
  [Native metadata](#native-metadata-runtimecodexv1).
- **Codex file changes.** Codex app-server file-change progress arrives as
  `tool_delta` with a `changeCount`, and turn-level diffs are `status` records
  with `subtype: "diff_observation"`. The desktop Workbench no longer renders
  separate Codex "file-change" rows; Workbench rendering is not part of this
  contract.
- **Stale workers.** A job whose worker stopped is settled `interrupted` with
  `recovery` evidence only after Locus confirms on the same host that the
  worker process is gone or never claimed the job. A stale heartbeat from a
  live or unknown worker leaves the job `running` and produces a host
  diagnostic on stderr or in the daemon log, not an event.
- **Historical runs.** See [Historical runs](#historical-runs).

### Outcome and exit examples

The ledger settles each run once, from recorded evidence, in this order:

1. An explicit cancel gives `canceled`.
2. An interrupt, a transport exit or a confirmed worker loss gives
   `interrupted`.
3. A recorded denial, invalid output, empty output, a failed post-run
   credential check or a live runtime failure gives `failed`.
4. Otherwise a live success, or a valid batch/completion host result, with valid
   output gives `succeeded`.

Missing success evidence is `failed`. An `error` event is evidence only; it
never ends a run by itself.

| Recorded evidence | `completed.payload` (abridged) | Result `diagnostics` | create/retry exit |
| --- | --- | --- | --- |
| Runtime success with recorded output | `{"status":"succeeded","evidenceKeys":["policy:no-recorded-denial","record:5","postrun:security-cleanup-ok"],"exitCode":0,"errorCode":null,"errorMessage":null,"result":{...}}` | `[]` | `0` |
| Retryable `error` (`willRetry: true`), then success with output | `{"status":"succeeded",...,"exitCode":0,"errorCode":null,"errorMessage":null,"result":{...}}` | `[]` | `0` |
| Runtime reported success, but a permission request was denied | `{"status":"failed","reasons":["policy_denied"],"evidenceKeys":["record:4",...],"exitCode":1,"errorCode":"policy_denied","errorMessage":"Run outcome failed: policy_denied.","result":{...}}` | `[{"code":"policy_denied","message":"Run outcome failed: policy_denied."}]` | `1` |
| Runtime reported success with no output | `{"status":"failed","reasons":["output_empty","output_evidence_missing"],...,"exitCode":1,"errorCode":"output_empty",...}` | `[{"code":"output_empty",...}]` | `1` |
| Codex app-server transport exited before a terminal | `{"status":"interrupted","reasons":["transport_exit"],"evidenceKeys":[],"synthetic":{"source":"transport_exit","transportId":"t1","exitCode":2,"signal":null},"exitCode":1,"errorCode":"transport_exit",...}` | runtime-specific | `1` |
| Cancel requested while running | `{"status":"canceled","reasons":["cancel_requested"],...,"synthetic":{"source":"cancel"},"exitCode":5,"errorCode":"job_canceled","errorMessage":"Job was canceled.",...}` | `[{"code":"job_canceled","message":"Job was canceled."}]` | `5` |
| Worker confirmed gone (read later with `runs status` / `runs result`) | `{"status":"interrupted","reasons":["worker_stopped"],...,"synthetic":{"source":"recovery"},"recovery":{"confidence":"confirmed","basis":"worker_process_absent","observedAt":"..."},"exitCode":null,"errorCode":"worker_interrupted","errorMessage":"Worker stopped before the job finished.","result":null}` | `[{"code":"worker_interrupted",...}]` | not applicable |

Field notes:

- `reasons` are informational strings, not a closed enum. Current values
  include `policy_denied`, `output_invalid`, `output_empty`,
  `output_evidence_missing`, `credential_postcheck_failed`, `native_failed`,
  `host_failed`, `success_evidence_missing`,
  `terminal_artifact_preparation_failed`, `transport_exit`, `worker_stopped`
  and cancel/interrupt reasons such as `cancel_requested` or `queued_cancel`.
- An `evidenceKeys` entry of the form `record:<n>` names the `sequence` of the
  committed record that supplied the evidence; other keys are opaque.
- `code` carries a native terminal code when one was observed, and `message`
  the last recorded error message of a failed run.
- The top-level `exitCode` is the run's Locus exit code (the create/retry exit
  column, or `null` when the settlement has none, as for a worker recovery).
  `synthetic.exitCode` is the exit code of the runtime transport process that
  ended; the two can differ.
- `lossPossible: true` means stream text withheld as a possible secret could not
  be released safely at the terminal and was dropped instead of published.
- The exit-code table in [Exit Codes](#exit-codes) is unchanged; only the
  status it is derived from is corrected.

### Errors

`error` payloads keep their existing members and add:

- `classification`: one of `diagnostic`, `retryable`, `fatal_candidate` or
  `policy_denial`. Coarse runtimes default to `diagnostic`, or `retryable` when
  `willRetry` is `true`.
- `willRetry` when the runtime supplied it.
- `code` with the native error code when present.

### Usage snapshots

`usage_update` payloads keep their existing members and add a normalized
snapshot:

```json
{"kind":"snapshot","total":{"inputTokens":90,"outputTokens":18,"totalTokens":108},"last":{"inputTokens":6,"outputTokens":2,"totalTokens":8},"delta":{"inputTokens":90,"outputTokens":18,"totalTokens":108},"dedupeKey":"...","asOfSequence":7}
```

- `total` is the run's cumulative vector and `last` the most recent call or turn
  vector.
- `delta` is `total` minus `baseline`. `baseline` is present when a resumed run
  established a starting point.
- `dedupeKey` identifies one snapshot revision; a repeated revision is not
  counted twice, while distinct calls with identical vectors both count.
- `asOfSequence` is the sequence the snapshot applies to.
- A counter decrease never yields a negative delta; `discontinuity: true` marks
  the reset.
- Vectors contain only the counters the runtime reported. Missing counters are
  absent, not zero.
- Usage that arrives after `completed` is a diagnostic-only late record; result
  usage stays as of the sealed prefix.

### Status records

`status` payloads carry `payload.subtype`. Treat unknown subtypes as ignorable
diagnostics.

| Subtype | Meaning |
| --- | --- |
| `system_lifecycle` | Host lifecycle status that has no subtype of its own. Existing host status such as `runtime_selected` / `runtime_selection_refused` keeps its `payload.status` and its string `payload.runtime`. |
| `guard_decision`, `permission_requested`, `scope_expansion_requested`, `question_pending`, `question_result`, `mcp_needs_auth`, `command_started`, `command_output`, `command_finished` | Internal record types outside the public twelve, projected with their payload members. |
| `late_event` | A diagnostic-only observation that arrived after the run sealed. See [Late observations](#late-observations). |
| `artifact_admission` | A rejected native artifact candidate, with its `role` and `reason`. See [Artifact Contract](#artifact-contract). |
| `interaction_boundary` | A native server request, a response send (`sent` or `failed`) or a resolution. It records an observation, not an interaction state or a grant. |
| `native_resume_validated`, `native_resume_rejected` | Correlated resume facts (Codex `thread/resume` response, Claude correlated `system/init`). A rejection neither settles the run nor changes the session binding. |
| `thread_lifecycle`, `turn_lifecycle`, `item_lifecycle`, `item_reconciliation`, `reasoning_part`, `plan`, `hook_lifecycle`, `compaction`, `review_mode`, `user_message`, `diff_observation`, `runtime_process`, `workspace_observation`, `approval_review`, `model_verification`, `mcp_lifecycle`, `reroute`, `warning`, `protocol_response` and similar | Codex app-server native boundaries, following the pinned disposition table of the `codex-runtime-parity` capability. |
| `unknown_native_method`, `unsupported_native_surface`, `raw_response_observed` | A native method outside the pinned table, an observed but deferred surface (realtime, remote control, Windows), or a raw response item. `contentOmitted: true` means the native content was deliberately not stored. |

### Late observations

After `completed`, a runtime can still emit trailing output, usage or exits.
Locus records them as `status` records with `subtype: "late_event"`,
`diagnosticOnly: true`, `terminalSequence` (the `completed` sequence),
`originalType`, an optional `nativeMethod` and a sanitized `observation`. A late
usage record keeps the observed `total`/`last` in its `observation`. Late
records never create a second `completed`, never change the result or its
usage, and never change the committed `events.jsonl` or `result.json` digests.
`--follow` stops at `completed`; an explicit
`runs events <job-id> --after <completed sequence>` returns the late records.

### Native metadata (`runtime.codex.v1`)

Object payloads of runtime-backed Codex app-server records can carry:

```json
{"text":"hello","extensions":{"runtime.codex.v1":{"schemaVersion":1,"maturity":"experimental","threadId":"th","turnId":"tu","itemId":"msg"}}}
```

- The namespace is optional and experimental (`schemaVersion: 1`,
  `maturity: "experimental"`). Its other members (`threadId`, `turnId`,
  `itemId`, `sessionId`, `requestId`, `callId` and possibly more) are redacted
  native identities that were present on that boundary.
- It is emitted only after the run bound its runtime execution. Lifecycle
  records written before that point, including `runtime_selected` and
  `runtime_selection_refused` status with their string `payload.runtime`, never
  carry it, and it is never added to a record afterwards.
- Codex `exec` runs (the default `batch` profile) produce coarse records without
  it. App-server-backed runs can carry it; for API jobs these are Codex runs
  with `runtime.executionProfile: "policy-grant"`. Claude runs do not use this
  namespace.
- It is not a native protocol stability promise and grants no live-attach or
  control capability. Native Codex events consumed directly from the runtime are
  outside this contract.

### Historical runs

Runs recorded before a `canonical-run-ledger` build keep their stored events,
sequences and IDs byte-for-byte. Locus does not add fact keys, provenance,
reconciliation records or a missing `completed` to them, and it never appends
to them. The distinction is internal; the public job envelope has no
`historyQuality` field.

A `canonical-run-ledger` build does not start or recover jobs that an older
build left `queued` or `running`. Before upgrading, drain them with the older
build: let them finish, cancel them, or let its recovery settle them. After
the upgrade, `runs retry` on a drained `failed`, `canceled` or `interrupted` job
creates a new run on the ledger.

### Upgrade checklist

1. Check `features` for `canonical-run-ledger` before relying on corrected
   terminal truth, and refuse or fall back when it is absent.
2. Refresh pinned copies of `local-job-api-v1.schema.json`.
3. Treat `completed.payload.exitCode`, `errorCode`, `errorMessage` and
   `result` as optional and nullable; `runs result` and the command exit code
   remain the authoritative outcome readers.
4. Expect `failed` and exit `1` for denied, invalid or empty-output runs that
   previously reported success.
5. Page events with `--after`; ignore unknown `status` subtypes and unknown
   extension namespaces.
6. Treat `<redacted>` and `<mask>` as opaque text.

## Asynchronous Submission (`async-submit`)

Builds that list `async-submit` in `features` accept a run without waiting for
it, return its job ID at once, and let the consumer wait for, observe, cancel
or retry it by that ID. The wire version stays `locus.local-job.v1`. The twelve
event types, the six-field event envelope, `runs result`, the artifact files,
`--after`/`--follow` and the meanings of exits `0`–`8` are unchanged. The only
new exit code is `9`, and only `runs wait` returns it.

### Submit

```bash
locus api runs submit --request <path|-> --json
```

The request is an agent or completion create request (see
[Agent Create Request](#agent-create-request) and
[Completion Create Request](#completion-create-request)) plus an optional
top-level `idempotencyKey` (see [Idempotency](#idempotency)). Every create
validation and every project, capability, profile, provider and secret check
runs first and fails with the same error, stream and exit as `create`. A
rejected request starts no provider work.

A fresh submission prints one line and exits `0`:

```json
{"apiVersion":"locus.local-job.v1","job":{"id":"job-A","status":"queued"}}
```

(`job` is the full serialized job; it is abridged here.)

- The acknowledgement means the run is durably recorded and can be claimed:
  its `job_created` event is committed and, for a run with
  `artifacts.baseDir`, its run directory and initial files are admitted. It
  does not mean the run has started.
- `job.status` is a snapshot taken at admission. Another process can claim the
  run before you read stdout; `runs status` then reports `running`.
- No executor is needed for the acknowledgement. A submitted run executes when
  an executor claims it: a running `locus daemon run` (foreground, started by
  the user or the consumer), or the in-process executor of a `runs create` /
  `runs retry` command for its own run. Without one it stays `queued`, and
  `runs status` and `runs wait` say so.
- Exiting the submitting process never cancels the run. Cancel by ID.
- The response has no `result`.

### Wait

```bash
locus api runs wait <job-id> [--timeout <milliseconds>] --json
```

`runs wait` reads one API job and never changes it: it does not settle,
cancel, retry or extend anything. Like every `locus api` command, it first runs
Locus's existing stale-worker recovery, which can settle a run whose worker
Locus confirms has stopped.

- `--timeout` defaults to `30000` ms and accepts integers from `0` to
  `86400000` (24 h). `0` performs exactly one observation.
- The run is ready when its `completed` event is committed and every terminal
  file registered by that commit is published and verified (digest and size).
  A run with no terminal files is ready as soon as `completed` is committed.
- Ready output is exactly the `create` envelope `{apiVersion, job, result}`,
  and the exit code is the run's outcome exit (`0`–`8`). `result.artifacts`
  lists the terminal files of that commit in order.
- If the run is not ready by the deadline, `wait` prints one timeout envelope
  and exits `9`. A ready final read at the deadline wins over the timeout.

```json
{"apiVersion":"locus.local-job.v1","job":{"id":"job-A","status":"queued"},"wait":{"state":"timeout","timeoutMs":30000,"reason":"executor_unavailable"}}
```

Exit `9` is not a run outcome: there is no `result`, and the run is
unchanged. Call `wait` again or read `status`.

| `job.status` | Observation | `wait.reason` |
| --- | --- | --- |
| `queued` | initial admission not committed (checked first) | `admission_incomplete` |
| `queued` | an executor is available | `run_pending` |
| `queued` | no executor | `executor_unavailable` |
| `queued` | executor state unknown | `executor_unknown` |
| `running` | any | `run_pending` |
| terminal | a registered terminal file is missing or does not match | `terminal_artifacts_pending` |

`terminal_artifacts_pending` keeps the real terminal `job.status`. It covers a
publication that has not finished or that failed, and also a published file
that was later deleted or modified: `wait` cannot tell these apart and reports
the run as not ready again. `runs result` and `runs events --follow` are
unchanged and are not a publication barrier; only `wait` checks the files.

| Condition | Output | Exit |
| --- | --- | --- |
| unknown ID, or an ID that is not an API job | stderr `Unknown job: <id>` | `3` |
| invalid `--timeout` | stderr `Invalid timeout: expected an integer from 0 to 86400000 milliseconds.` | `2` |
| store read failure after the job was read | stdout `{"apiVersion":"locus.local-job.v1","job":{…},"wait":{"state":"error","reason":"observation_failed"}}` | `8` |
| store read failure before the job was read | stderr `Failed to observe job: <id>` | `8` |

The stderr lines are plain text followed by a newline, not JSON. `runs status`
keeps its existing errors for unknown and non-API IDs (`Unknown API job: <id>`
and `Job <id> is not an API job`, exit `3`); the two commands' messages are
not promised to match.

### Executor availability

`runs status` on a `queued` or `running` API job adds an `execution` object.
Terminal jobs and every other envelope omit it.

```json
{"apiVersion":"locus.local-job.v1","job":{"id":"job-A","status":"queued"},"execution":{"state":"unavailable","reason":"no_executor","observedAt":"2026-10-01T00:00:00.000Z","hint":"locus daemon run"}}
```

| `state` | `reason` | When |
| --- | --- | --- |
| `unknown` | `admission_incomplete` | A queued run whose initial admission did not commit. No hint. |
| `available` | `executor_observed` | A queued run, and a `locus daemon run` of the same profile is alive with a fresh heartbeat. A running run whose own recorded worker is confirmed alive within the 120 s recovery heartbeat window. |
| `unavailable` | `no_executor` | No daemon lock, or its process is gone; for a running run, its worker process is gone. Carries `hint: "locus daemon run"`. |
| `unknown` | `probe_unavailable` | A stale, legacy or unreadable lock, a process Locus cannot probe, or a heartbeat it cannot trust. |

- `execution` is advisory. It is not runtime readiness (`runtimes list`), it
  never starts a daemon, and reading it changes nothing.
- It never contains a PID, nonce, hostname, lock path or secret. The existing
  `job.workerId` and `job.workerPid` identify the process that actually claimed
  the run: the daemon when the daemon claimed it, the caller's process when a
  `create`/`retry` command ran it. Do not signal `workerPid`; use
  `runs cancel`. `workerId` is opaque, and its format changed in this release.
- A daemon fills its slots with daemon jobs first, then schedule jobs, then
  API runs. Sustained daemon or schedule work can delay API runs; there is no
  priority scheduler.

### Synchronous create and default retry

On builds with `async-submit`, `runs create` and `runs retry <job-id>` without
`--async` are a submit plus a wait in the same process:

1. The request is admitted exactly like `runs submit`, without a key.
2. The command runs its own admitted run in-process, through the same
   executor that `locus daemon run` uses, restricted to that one run. No daemon
   is needed, and no other queued run is touched.
3. It waits for the terminal and prints it.

For a normal run, stdout (including the trailing newline) and the exit code
are byte for byte what the command printed before `async-submit`. The internal
wait has no deadline that leaks out: `create` and `retry` never exit `9` and
never print a timeout envelope.

**Daemon-first runs.** If a `locus daemon run` of the same profile claims the
run before the command does, the command does not run it a second time; it
waits for the daemon's result. In that case:

- The run executes in the daemon's environment, not the caller's (see
  [Execution context](#execution-context)), and `job.workerId` /
  `job.workerPid` identify the daemon.
- If the run makes no progress for 30 s while it is queued or while its
  worker's liveness is not confirmed, the command prints
  `{"apiVersion":"locus.local-job.v1","job":{…},"wait":{"state":"error","reason":"executor_unavailable"}}`
  and exits `8`. The reason is `executor_unavailable` when no executor is
  observed and `executor_unknown` otherwise. A committed event, a heartbeat change, or a worker confirmed alive within the
  120 s recovery heartbeat window counts as progress, so long runs, including a
  45 s completion call, are not cut off.
- If the daemon committed the terminal but its files are still not published
  30 s later, the command prints the same envelope with
  `"reason":"terminal_artifacts_pending"` and exits `8`.
- A store read failure prints the same envelope with
  `"reason":"observation_failed"` and exits `8`.

That `wait.state: "error"` envelope carries the job ID and no `result`; it is
not the run's outcome. Read `runs status` or `runs result`, call `runs wait`,
or cancel by ID.

Failure behavior that stays as before:

- If the in-process executor completes the run but publishing its terminal
  files fails, the command still prints the terminal envelope with
  `result.artifacts: []` and the run's outcome exit. `runs wait` on the same
  run reports `terminal_artifacts_pending` and exits `9`.
- A failure of the in-process executor that is not a run outcome, or a store
  read failure while the command waits on its own in-process run, stops its own
  execution tree and keeps the previous stderr text and exit (`create`: `2`,
  or `3` for an "unsupported" message; `retry`: `3`) with nothing on stdout.
  An admitted run that never started is canceled; a stopped run settles as
  `canceled` when the store allows it. No terminal envelope is invented. The
  `observation_failed` envelope above is only for a run another process
  executes.

#### Execution context

A run executes in the environment of the process that claims it. When the
command's own executor claims it, that is the caller's environment, as before.
When `locus daemon run` claims it, the runtime child gets the daemon's
environment: each runtime adapter's allowed native-home variables (for example
`HOME`, `CODEX_HOME` and `CLAUDE_CONFIG_DIR` on POSIX; `USERPROFILE`,
`APPDATA` and `LOCALAPPDATA` on Windows) and `PATH`-family variables come from
the daemon, and proxy variables move only where that adapter forwards them.
Native credentials and their availability therefore follow the daemon.
Secret stripping is unchanged on both paths, and no snapshot of the caller's
environment is stored or transferred. A consumer that minimizes the
environment it passes to `locus` does not control the daemon's environment.
`runtimes list` readiness reports the CLI process's environment and does not
prove that the daemon is ready.

#### Aborting a waiting command

When the command runs its own run in-process, aborting it behaves as before:
killing the command's process tree stops the runtime child.

When a daemon claimed the run, the daemon keeps running it after the waiting
command dies. To cover that, the command relays a cancel of its own run, and
only its own run, on a catchable abort:

| Platform | Relayed (catchable) | Not relayed |
| --- | --- | --- |
| POSIX | `SIGINT`, `SIGTERM`, `SIGHUP`, armed stdin EOF | `SIGKILL` |
| Windows | Ctrl+C (`SIGINT`), Ctrl+Break (`SIGBREAK`), console window closed (`SIGHUP`), armed stdin EOF | parent `child.kill()` / `TerminateProcess`; logoff and shutdown console events |

- A signal that arrives before the command has observed another executor
  claiming the run is not relayed; the OS default disposition applies. Use
  `runs cancel <job-id>` to cancel the run reliably.
- On a relayed abort the command persists the cancel request, waits at most
  5 s for the run to reach a terminal status, writes nothing to stdout, and
  then re-raises the original signal so a POSIX parent sees that signal, or
  exits `8` for stdin EOF.
- Windows has no signal exit status. After a relayed Ctrl+C the command ends
  with exit `1` (Node terminates the process); after a relayed Ctrl+Break or
  console close it exits `8`. These Windows exits have not been verified on a
  Windows host.
- A Windows parent that wants a graceful stop can send Ctrl+Break
  (`GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, pid)`) to a command it started
  with `CREATE_NEW_PROCESS_GROUP`; Windows disables Ctrl+C in such a process
  group. A process without a console receives no console events at all. When
  the console window closes, Windows ends the process after a short
  system-defined grace, which can cut the 5 s acknowledgement wait short.
- stdin EOF is armed only if stdin was an open pipe when the run was admitted
  and closes later. Ignored or already-closed stdin, and the EOF that ends a
  `--request -` body, never cancel. A consumer that sends its request on stdin
  can still cancel by signal or by ID.
- A kill that follows the signal quickly (for example a 500 ms grace before
  `SIGKILL`) can cut the 5 s acknowledgement wait short. The cancel request is
  normally persisted before that, but delivery is not guaranteed after a hard
  kill.
- `SIGKILL`, and on Windows `TerminateProcess`, Node's `child.kill()` and
  the logoff/shutdown console events, cannot be relayed: the daemon's run
  keeps going and stays queryable.

`runs cancel <job-id>` is the only cancellation that works on every platform.
Keep the job ID: when you need to cancel reliably, especially on Windows, use
`runs submit`, which prints the ID before the run executes.

### Idempotency

`runs submit` and `runs retry <job-id> --request <path|->` accept an optional
`idempotencyKey`. No other command accepts it. `runs create` with an
`idempotencyKey` prints

```json
{"apiVersion":"locus.local-job.v1","error":{"code":"idempotency_key_not_supported","message":"idempotencyKey is not accepted by runs create; use runs submit."}}
```

exits `2` and runs nothing. Builds before `async-submit` silently ignore the
field on `create` and run the job without idempotency, so check the feature
first and send keys only to `submit` and `retry --request`.

Key rules:

- 1–160 ASCII characters from `[A-Za-z0-9._:-]`, case-sensitive and never
  trimmed.
- Scoped by the normalized `consumer.id`: the same key under two consumers
  names two different runs. `consumer.id` is attribution, not authentication.
- A key that looks like a secret is rejected as `secret_in_request`, even when
  it also breaks the character rule. A keyed request whose `consumer.id` Locus
  would alter by secret redaction is rejected the same way. Neither error
  echoes the key.
- Locus stores only a domain-separated hash of the key. The raw key never
  appears in the store, `request.json`, events, results, diagnostics or logs.
  The hash is not encryption: do not put secrets in keys.

**Same key, same request.** Requests are compared after normalizing defaults,
runtime aliases, canonical paths and object key order; the key, wait/async
choices and generated IDs are not part of the comparison. Locus returns the
retained run instead of creating another one, with no new provider work:

```json
{"apiVersion":"locus.local-job.v1","idempotentReplay":true,"job":{"id":"job-A","status":"running"}}
```

The replayed `job` is its current state (`queued`, `running` or terminal). A
keyed `runs retry --request` without `--async` prints the retained child's
terminal envelope instead. Only keyed replays carry `idempotentReplay`.

**Same key, different request.** stdout `idempotency_conflict`, exit `2`,
nothing created. A submit and a retry, or retries of different source jobs,
never replay each other.

**Retry body.** `runs retry <job-id> --request <path|->` reads:

```json
{"apiVersion":"locus.local-job.v1","consumer":{"id":"docs-workbench"},"idempotencyKey":"retry-1"}
```

It accepts only `apiVersion`, `consumer.id` and `idempotencyKey`; other
members are a stderr validation error with exit `2`. `consumer.id` must match
the source job's consumer, else stdout `consumer_mismatch` and exit `2`, before
any key lookup. `runs retry <job-id>` without `--request` keeps using the
source job's stored consumer and input.

**Pending submissions.** If a keyed submission was recorded but its creation or
initial admission never committed (a crash, or another process that is still
submitting), the same key returns

```json
{"apiVersion":"locus.local-job.v1","error":{"code":"submission_pending","message":"Submission is not yet admitted; retry the same key.","retryable":true}}
```

with exit `8`. Retrying the same key is safe and never creates a second run,
but `retryable` does not promise that the state will clear. An attempt left by
a crashed submitter stays pending until a later Locus repair (TICKET-128), and
Locus cannot tell it apart from a submitter that is still working. A new key is
the explicit remedy; it can duplicate work if the original submitter was in
fact still alive. If you already have the job ID, `runs cancel <job-id>`
settles it.

**Retention.** Locus keeps a key bound to its run for at least 30 days after
the run's terminal files were published and verified, or after its terminal
settlement when the run registers no terminal files (artifact-free runs,
recovery, cancel before admission, fail-closed claim checks). Expired keys are
removed before each `submit`, `create` or `retry` of the same consumer and on
every daemon loop iteration; after that, the same key creates a new run. A key
whose run never reached a verified terminal (still running, publication
failed, or a pending submission) never expires on its own. Reading or replaying
never extends retention. Retention applies only to the key binding; jobs,
events and files stay.

New request errors:

| Condition | Stream | Exit | `error.code` |
| --- | --- | --- | --- |
| `idempotencyKey` on `runs create` | stdout | `2` | `idempotency_key_not_supported` |
| key already bound to a different request | stdout | `2` | `idempotency_conflict` |
| retry `consumer.id` differs from the source job | stdout | `2` | `consumer_mismatch` |
| malformed key | stdout | `2` | `invalid_idempotency_key` |
| secret-like key, or a keyed `consumer.id` that redaction would change | stdout | `2` | `secret_in_request` |
| keyed submission recorded but not admitted | stdout | `8` | `submission_pending` (with `"retryable":true`) |

Each is one stdout line, `{"apiVersion":"locus.local-job.v1","error":{"code":…,"message":…}}`,
and is a request error, not a run status. Other errors keep their existing
shapes, streams and exits.

### Claim-time checks

A submitted run can wait in the queue. Before any provider call or child
process, the executor that claims an API run checks its admission again. A
failing check settles the run `failed` without running it:

| `completed.payload.reasons` entry | `job.errorCode` | Exit (`create`, default `retry`, `wait`) |
| --- | --- | --- |
| `project_unregistered` | `project_unregistered` | `7` |
| `cwd_identity_changed`: the cwd was replaced, moved, or no longer matches its recorded identity | `cwd_identity_changed` | `7` |
| `execution_profile_invalid`: the stored capability, profile or policy grant, or the explicit provider profile, is no longer valid | the provider-binding code when there is one, else `execution_profile_invalid` | binding unavailable `4`, invalid request `2`, local-only blocked `6`; otherwise `3` |
| `queued_age_exceeded`: queued for 24 h or longer | `queued_age_exceeded` | `1` |
| `artifact_admission_mismatch`: the admitted run directory or its initial files changed | `artifact_admission_mismatch` | `1` |
| `claim_gate_failed`: internal fallback when the check itself fails unexpectedly | `internal_error` | `8` |

- The maximum queued age is 24 h from `createdAt` and is not configurable. A
  running daemon also settles admitted API runs that reached that age without
  claiming them, oldest first and a bounded number per loop iteration. Without
  a daemon, an over-age run is settled when an executor tries to claim it.
- When several checks fail, the reported code depends on which step settles
  the run. The daemon's over-age settlement checks age only, while a claim
  checks the project, cwd and profile before the age. An over-age run in an
  unregistered project therefore settles `queued_age_exceeded` / `1` when the
  daemon's over-age settlement reaches it, but `project_unregistered` / `7`
  when a claim reaches it first. A daemon runs its over-age settlement before
  it claims queued runs in each loop iteration, so a run that was already over
  age when an iteration started gets `queued_age_exceeded` from that daemon,
  unless the run is beyond that iteration's 16-run settlement limit, or the
  daemon has reported that it could not settle the run and excluded it.
- These settlements register no terminal files: `result.artifacts` is `[]` and
  `wait` is ready at once.
- The public commitments are `job.errorCode` and the exit code.
  `completed.payload.reasons` values stay informational, as before. No exit
  code is added and `0`–`8` keep their meanings.
- Completion runs have no project, cwd or run directory, so only the profile,
  age and internal checks apply to them.
- If the run directory or initial admission of a new run fails after its
  creation was committed, the command reports the error as before, and the
  attempt stays as a `failed` job with `job.errorCode` `artifact_admission_failed`.
  A key used for it stays bound to that job.

### Cancel, recovery and terminal files

- Canceling a queued run whose initial admission committed publishes its
  terminal files (`result.json`, refreshed `events.jsonl` and `artifacts.json`)
  like a run that finished, and `result.artifacts` lists them.
- Canceling a queued run that has no run directory, or whose initial admission
  never committed, registers no terminal files: `result.artifacts` is `[]`.
  This is the remedy for a run stuck at `admission_incomplete` whose ID you
  know.
- A run that Locus recovers as `interrupted` after its worker stopped
  registers no new terminal files either: `result.artifacts` is `[]`, and its
  initial files stay as history.

### Known limits

- Creation and terminal publication are not yet fully atomic (TICKET-128). A
  crash can leave a pending submission, staged files or a partially published
  terminal; `wait` reports such runs as not ready rather than inventing a
  result.
- On Windows, runs with `artifacts.baseDir` fail closed until the run
  directory backend lands (TICKET-127), and each such attempt leaves a
  `failed` job with `job.errorCode` `artifact_admission_failed`.
- There is no HTTP or socket server, no priority scheduling and no background
  daemon launcher: `locus daemon run` is started by the user or the consumer.
- Running an older Locus build (CLI or daemon) against the same profile as an
  `async-submit` build is unsupported: the older build does not understand key
  reservations or pending submissions, and nothing stops it technically. Stop
  the older processes before upgrading, and roll back with a separate profile.

### Asynchronous flow example

```bash
OUT="$(locus api runs submit --request "$PACKAGE_DIR/request.json" --json)" || exit $?
JOB="$(printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{console.log(JSON.parse(s).job.id)})')"
locus api runs wait "$JOB" --timeout 600000 --json
case $? in
  9) echo "not ready yet; wait again or read status" ;;
esac
```

### Upgrade checklist (`async-submit`)

1. Check `features` for `async-submit` before using `submit`, `wait`,
   `retry --async`, `retry --request` or `idempotencyKey`. Older builds reject
   the new command shapes with exit `2`, but ignore a key sent to `create`.
2. Refresh pinned copies of `local-job-api-v1.schema.json`: `discoveryFeature`
   now includes `async-submit`. Use a JSON Schema 2020-12 validator; completion
   request members now live in `completionRequestMembers`, from which
   `completionCreateRequest` and `completionSubmitRequest` derive via `allOf`
   with `unevaluatedProperties: false`.
3. Do not send `idempotencyKey` to `runs create`.
4. Treat exit `9` from `runs wait` as "not ready yet", not as a run failure.
5. Handle `submission_pending` (exit `8`, `"retryable":true`): retry the same
   key, or accept the duplicate risk of a new key.
6. Treat a `wait.state: "error"` envelope (exit `8`) from `create`, `retry` or
   `wait` as an observation problem; the run's ID is in `job.id`.
7. Expect runs claimed by `locus daemon run` to use the daemon's environment
   and credentials.
8. Keep job IDs and cancel by ID; the abort relay does not cover hard kills.
9. Map the claim-time `job.errorCode` values onto your existing exit-code
   handling; they use existing exit codes.

## Cancel

```bash
locus api runs cancel <job-id> --json
```

Cancel is scoped to API jobs. A queued API job is completed as `canceled`
immediately. A running job receives a persisted cancel request that the runtime
runner observes.

On builds with `async-submit`, canceling a queued run whose initial admission
committed publishes its terminal files; see
[Cancel, recovery and terminal files](#cancel-recovery-and-terminal-files).
`runs cancel` is the only cancellation that works on every platform for a run
that a daemon claimed.

## Retry

```bash
locus api runs retry <job-id> --json
```

Retry is allowed only for API jobs in terminal retryable states:

- `failed`
- `canceled`
- `interrupted`

`retry` creates a new API job, links it with `retryOfJobId`, prepares a new
artifact run directory, runs synchronously, and returns the same envelope shape
as `create`.

On builds with `async-submit`:

```bash
locus api runs retry <job-id> [--request <path|->] [--async] --json
```

- `--async` returns the new job's admission envelope, like `runs submit`, and
  does not wait. Use `runs wait` with the new job ID.
- `--request` passes a retry body `{apiVersion, consumer:{id}, idempotencyKey?}`
  whose `consumer.id` must match the source job; see
  [Idempotency](#idempotency).
- Without `--async`, retry is a submit plus a wait like `create`; see
  [Synchronous create and default retry](#synchronous-create-and-default-retry).

Do not use `locus jobs retry` for API jobs. That command is reserved for
non-API human-oriented job flows.

## Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | Success. |
| `1` | Runtime failed. |
| `2` | Invalid arguments or invalid request/artifact contract. |
| `3` | Unsupported runtime, mode, or required capability. |
| `4` | Missing runtime credentials. |
| `5` | Job canceled. |
| `6` | Local-only guard blocked the run. |
| `7` | Invalid or unregistered `project.cwd`. |
| `8` | Internal failure. |
| `9` | `runs wait` only (feature `async-submit`): the bounded wait ended before the run was ready. Not a run outcome. |

On builds with `canonical-run-ledger`, create/retry exit codes follow the
ledger outcome. A runtime-reported success that the ledger settles as `failed`
(recorded denial, invalid or empty output, missing output evidence, failed
post-run credential check) exits `1`. See
[Outcome and exit examples](#outcome-and-exit-examples).

Codes `0`–`8` keep their meanings. On builds with `async-submit`, `create`
and `retry` never exit `9`; the claim-time checks and `submission_pending` use
existing codes (see [Claim-time checks](#claim-time-checks) and
[Idempotency](#idempotency)). Exit `8` can also come with a stdout envelope
that carries the job ID and `"wait":{"state":"error",…}`; it reports an
observation problem, not the run's outcome.

Consumers should parse stdout only when the exit code and command contract
allow it. Diagnostics are on stderr.

## Security Rules

Do not put these in the request:

- provider API keys
- OAuth tokens
- `Authorization` headers
- raw environment variables
- passwords
- private keys
- credential file contents

Locus resolves runtime credentials through its own main-process provider and
runtime setup paths. The consumer sends domain context, not provider secrets.
For provider-backed runs, send `provider.profileId` and optionally
`provider.model`; Locus owns the scoped gateway token lifecycle.

Secret-like keys or values are rejected before provider work starts.

## Integration Example

Recommended downstream app flow:

```text
1. User creates or reviews a local work package.
2. The downstream app creates a local package:

   packages/<example-package>/
     source.json
     source.md
     notes.md
     drafts/
     final/

3. The downstream app writes request.json with:
   project.cwd = packages/<example-package>
   input.packageDir = packages/<example-package>
   artifacts.baseDir = packages/<example-package>/.locus/runs

4. The downstream app runs:
   locus api runs create --request request.json --json

5. The downstream app reads result/artifacts/events.
6. The downstream app shows the user proposed output.
7. The downstream app writes or promotes final artifacts only after user approval.
```

Minimal shell example:

```bash
PACKAGE_DIR="$HOME/LocalPackages/example-package"
mkdir -p "$PACKAGE_DIR/.locus/runs" "$PACKAGE_DIR/drafts" "$PACKAGE_DIR/final"

cat > "$PACKAGE_DIR/request.json" <<EOF
{
  "apiVersion": "locus.local-job.v1",
  "consumer": {
    "id": "docs-workbench",
    "runExternalId": "example-package-001"
  },
  "project": {
    "cwd": "$PACKAGE_DIR"
  },
  "runtime": {
    "id": "codex",
    "requiredCapabilities": ["planMode"]
  },
  "mode": "plan",
  "prompt": {
    "text": "Review this local package and identify missing source material."
  },
  "input": {
    "contract": "example.local-package.v1",
    "packageDir": "$PACKAGE_DIR"
  },
  "artifacts": {
    "baseDir": "$PACKAGE_DIR/.locus/runs",
    "writePolicy": "metadata-only"
  }
}
EOF

locus api runs create --request "$PACKAGE_DIR/request.json" --json
```

`PACKAGE_DIR` must be inside a project already registered with Locus.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `project.cwd must be inside a registered project` | The package directory is not registered or not under a registered Locus project. | Open/register the project in Locus, or pass a cwd inside a registered project. |
| `artifacts.baseDir must be inside project.cwd` | Artifact base is outside the run cwd. | Use `<project.cwd>/.locus/runs`. |
| `artifacts.baseDir cannot be inside a final artifact directory` | Locus refuses to write metadata into downstream final material. | Move API metadata to `.locus/runs`. |
| `Unsupported runtime.id` | Runtime ID is not recognized. | Use `codex`, `claude-code`, or `claude`. |
| `Unsupported required capability` | Capability ID is unknown. | Inspect `locus api runtimes list --json`. |
| Exit `4` | Runtime credentials are missing. | Configure the runtime in Locus. Do not send credentials in the request. |
| JSON parse fails | The command may have failed and wrote diagnostics to stderr. | Check exit code and stderr before parsing stdout. |
| `completed.payload.exitCode` or `result` is `null` | The settlement had no such value (for example a queued cancel or a worker recovery). The members are optional and nullable. | Read `runs result` (`status`, `diagnostics`, `result`) and the command exit code. |
| The runtime reported success but the run is `failed` with `policy_denied`, `output_empty`, `output_invalid` or `output_evidence_missing` | Corrected terminal truth: denial, invalid output and empty output fail the run. | Inspect `diagnostics` and the run's `status`/`error` events. |
| Schema validation rejects `canonical-run-ledger` in `features` | A pinned older copy of the schema has a closed `discoveryFeature` enum. | Refresh your copy of `local-job-api-v1.schema.json`. |
| Schema validation rejects `async-submit` in `features` | Same closed enum; `async-submit` is newer than your copy. | Refresh your copy of `local-job-api-v1.schema.json`. |
| `runs wait` exits `9` | The run was not ready by the deadline (`wait.reason` says why). It is not a failure. | Wait again, or read `runs status`. For `executor_unavailable`, start `locus daemon run`. |
| `runs submit` succeeded but the run stays `queued` | No executor is running (`execution.reason: "no_executor"`). | Start `locus daemon run`, or use `runs create` to run it in-process. |
| `idempotency_conflict` | The key is already bound to a different request for this consumer. | Use a new key for a different request. |
| `submission_pending` (exit `8`) | A keyed submission was recorded but never admitted. | Retry the same key; if it never clears, cancel by ID or use a new key and accept the duplicate risk. |
| `idempotency_key_not_supported` | `runs create` does not accept keys. | Use `runs submit` (and `runs wait`). |
| A run failed with `queued_age_exceeded`, `cwd_identity_changed` or `project_unregistered` | A claim-time check failed after the run waited in the queue. | Fix the project or profile and submit again; see [Claim-time checks](#claim-time-checks). |

## Stability Contract

Stable in v1:

- command names under `locus api`
- `apiVersion: locus.local-job.v1`
- documented request fields
- documented response envelopes
- documented event envelope fields
- discovery feature identifiers, including `canonical-run-ledger` and
  `async-submit`
- with `async-submit`: the `runs submit`, `runs wait` and `runs retry --async`
  / `--request` command shapes; the `wait` envelope members and `wait.reason`
  values; exit `9` for `runs wait` only; the `execution` members and values;
  `idempotentReplay`; the new `error.code` values; and the `job.errorCode` and
  exit of each claim-time check
- with `canonical-run-ledger`: a dense per-run `sequence`, exactly one
  `completed` per run and `completed.payload.status`
- run metadata artifact file names
- secret rejection boundary
- non-destructive `projects unregister` semantics

Not stable in v1:

- extra fields inside serialized `job`
- internal SQLite schema
- internal event payload details beyond the v1 envelope, including `status`
  subtypes and their members and the values of `completed.payload.reasons` and
  `evidenceKeys`
- error `message` text, the format of `job.workerId`, and executor timing
  details (heartbeat cadence, per-iteration settlement bounds)
- `payload.extensions["runtime.codex.v1"]` (`maturity: "experimental"`)
- Workbench rendering details
- human CLI formatting under `locus run` and `locus jobs`

Use the documented v1 fields and ignore unknown JSON fields.
