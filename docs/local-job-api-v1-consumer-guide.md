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
- read run status
- read normalized event envelopes
- read the final result envelope
- cancel a queued or running API job
- retry a failed, canceled, or interrupted API job
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
locus api runs create --request <path|-> --json
locus api runs status <job-id> --json
locus api runs events <job-id> [--after <sequence>] [--follow] --jsonl
locus api runs result <job-id> --json
locus api runs cancel <job-id> --json
locus api runs retry <job-id> --json
locus api projects register --cwd <path> [--name <name>] --json
locus api projects status --cwd <path> --json
locus api projects unregister --cwd <path> [--force] --json
```

Rules:

- JSON commands write parseable JSON to stdout.
- Event streams write one JSON object per line.
- Diagnostics and validation errors go to stderr.
- `--request -` reads the create request from stdin.
- `--after <sequence>` returns events with `sequence` greater than that value.
- `create` and `retry` run synchronously and return after the run reaches a
  terminal status.
- `projects unregister` is non-destructive: it removes the project from active
  registration but does not delete chats, sub-chats, worktrees, job history, or
  repository files. Permanent project-history deletion is desktop UI only.

## Minimal Consumer Flow

1. Build or locate a downstream package directory.
2. Ensure `project.cwd` points to a Locus-registered local project or a
   subdirectory inside one.
3. Put `artifacts.baseDir` inside `project.cwd`.
4. List runtime capabilities.
5. Create a run with `locus api runs create`.
6. Read `status`, `events`, and `result` by job ID.
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

A consumer that depends on a feature checks `features` before dispatch and
treats a missing identifier as unsupported. v1 has no request field that
requires a feature or an extension, and Locus does not negotiate extensions;
the check is the consumer's own preflight. The `discoveryFeature` enum in
[local-job-api-v1.schema.json](local-job-api-v1.schema.json) is closed: a
consumer that validates discovery output against a pinned older copy of the
schema must refresh that copy, because ignoring unknown fields does not cover
new enum values.

`readiness.state` is advisory and can be `ready`, `needs-auth`, `unavailable`,
or `unknown`. Discovery still exits 0 and returns the full manifest list when a
readiness probe fails; that runtime reports `unknown` and diagnostics go to
stderr. Use `locus api runtimes list --json --no-probe` to skip subprocess
status probes; skipped probed states report `unknown` rather than `ready`.

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

The run's artifact owner can also admit native artifact candidates, which add
entries with role `native`; a rejected candidate becomes a `status` record with
`subtype: "artifact_admission"`, `result: "rejected"` and a `reason` of
`missing`, `out_of_scope`, `ownership_mismatch`, `digest_mismatch` or
`redaction_unsafe`. No runtime adapter submits native candidates in the current
build, so results list only the Locus run-dir roles today. Treat unknown roles
as additive.

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
  recovery?, code?, message?, lossPossible?}` and no longer carries `exitCode`,
  `errorCode`, `errorMessage` or `result`. Read those from `runs result`
  (`status`, `diagnostics`, `result`) and from the create/retry exit code.
- **More `status` records.** Every committed record is projected once at its
  original sequence (see [Events](#events)). Page with `--after`.
- **Redaction marker.** Redacted values in persisted records, events,
  `events.jsonl`, `result.json` and diagnostics read `<redacted>`. The store
  previously also wrote `[redacted]`, `[redacted-jwt]` or `[redacted-pem]` for
  some patterns. Treat the marker as opaque text; do not parse it.
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
| Runtime success with recorded output | `{"status":"succeeded","evidenceKeys":["policy:no-recorded-denial","record:5","postrun:security-cleanup-ok"]}` | `[]` | `0` |
| Retryable `error` (`willRetry: true`), then success with output | `{"status":"succeeded",...}` | `[]` | `0` |
| Runtime reported success, but a permission request was denied | `{"status":"failed","reasons":["policy_denied"],"evidenceKeys":["record:4",...]}` | `[{"code":"policy_denied","message":"Run outcome failed: policy_denied."}]` | `1` |
| Runtime reported success with no output | `{"status":"failed","reasons":["output_empty","output_evidence_missing"],...}` | `[{"code":"output_empty",...}]` | `1` |
| Codex app-server transport exited before a terminal | `{"status":"interrupted","reasons":["transport_exit"],"evidenceKeys":[],"synthetic":{"source":"transport_exit","transportId":"t1","exitCode":1,"signal":null}}` | runtime-specific | `1` |
| Cancel requested while running | `{"status":"canceled","reasons":["cancel_requested"],...,"synthetic":{"source":"cancel"}}` | `[{"code":"job_canceled","message":"Job was canceled."}]` | `5` |
| Worker confirmed gone (read later with `runs status` / `runs result`) | `{"status":"interrupted","reasons":["worker_stopped"],...,"synthetic":{"source":"recovery"},"recovery":{"confidence":"confirmed","basis":"worker_process_absent","observedAt":"..."}}` | `[{"code":"worker_interrupted",...}]` | not applicable |

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
| `artifact_admission` | A rejected native artifact candidate. See [Artifact Contract](#artifact-contract). |
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
3. Read outcome details from `runs result` and the exit code, not from
   `completed.payload` members that are no longer there.
4. Expect `failed` and exit `1` for denied, invalid or empty-output runs that
   previously reported success.
5. Page events with `--after`; ignore unknown `status` subtypes and unknown
   extension namespaces.
6. Treat `<redacted>` as opaque text.

## Cancel

```bash
locus api runs cancel <job-id> --json
```

Cancel is scoped to API jobs. A queued API job is completed as `canceled`
immediately. A running job receives a persisted cancel request that the runtime
runner observes.

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

On builds with `canonical-run-ledger`, create/retry exit codes follow the
ledger outcome. A runtime-reported success that the ledger settles as `failed`
(recorded denial, invalid or empty output, missing output evidence, failed
post-run credential check) exits `1`. See
[Outcome and exit examples](#outcome-and-exit-examples).

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
| `completed.payload` has no `exitCode` or `result` | On `canonical-run-ledger` builds, `completed` carries only the ledger outcome. | Read `runs result` (`status`, `diagnostics`, `result`) and the command exit code. |
| The runtime reported success but the run is `failed` with `policy_denied`, `output_empty`, `output_invalid` or `output_evidence_missing` | Corrected terminal truth: denial, invalid output and empty output fail the run. | Inspect `diagnostics` and the run's `status`/`error` events. |
| Schema validation rejects `canonical-run-ledger` in `features` | A pinned older copy of the schema has a closed `discoveryFeature` enum. | Refresh your copy of `local-job-api-v1.schema.json`. |

## Stability Contract

Stable in v1:

- command names under `locus api`
- `apiVersion: locus.local-job.v1`
- documented request fields
- documented response envelopes
- documented event envelope fields
- discovery feature identifiers, including `canonical-run-ledger`
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
- `payload.extensions["runtime.codex.v1"]` (`maturity: "experimental"`)
- Workbench rendering details
- human CLI formatting under `locus run` and `locus jobs`

Use the documented v1 fields and ignore unknown JSON fields.
