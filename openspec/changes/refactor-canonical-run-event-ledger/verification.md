# Verification Ledger

Status: **DRAFT — awaiting Owner APPROVED**

This file is an evidence skeleton, not an implementation claim. At draft time no
product code or test has been changed, no runtime conformance scenario has been run,
and no Owner approval or acceptance is implied. Every future receipt must name the
exact source SHA, command/fixture, environment, result, and any limitation.

## 0. Draft-authoring Evidence

| Check | Result on 2026-09-06 (Pacific/Auckland) |
| --- | --- |
| Required base | `main` and pre-draft `HEAD` were `61cc6af64d08ea2d7efa5bd1240cdac1dedb9d27`. |
| Scope | Only `openspec/STATUS.md` and `openspec/changes/refactor-canonical-run-event-ledger/**`; no `src/` or `tests/` file. |
| Strict validation | Exit 0: `Change 'refactor-canonical-run-event-ledger' is valid` |
| Whitespace check | `git diff --check` and staged equivalent exit 0 with no output. |
| Product/runtime tests | Not run: this delivery is deliberately documentation-only and claims no implementation evidence. |

These receipts validate only this DRAFT's form and scope. Every implementation gate
below remains pending and must be rerun against the future frozen implementation SHA.

## 1. Governance Receipts

| Evidence | Exact source SHA | Receipt/result | State |
| --- | --- | --- | --- |
| Owner `APPROVED` for implementation | TBD | Must include disposition of C7 Red rows 2, 3, 4, 5, 7, and 8 | Pending |
| Amadeus native-surface classification | TBD | Public compatibility surface or internal lockstep consumer | Pending |
| Completion-truth decision | TBD | Public status/reason and valid-empty exception | Pending |
| RuntimeInstallation provenance-owner decision | TBD | This change or prerequisite owner | Pending |
| Late-event public visibility decision | TBD | Drain-before-completed or immutable diagnostic visibility | Pending |

## 2. Test-first Receipts

For every Scenario, attach the independent author's test path, the first failing
command/output on pre-implementation code, and the later passing command/output on the
same implementation SHA. A test added only after implementation must be identified and
does not satisfy the pilot's red-first evidence requirement.

| Scenario group | Red test evidence | Green evidence | State |
| --- | --- | --- | --- |
| Single owner, boundary ingestion, sequence, and persistence | TBD | TBD | Pending |
| Durable append failure/unknown commit/crash-before-projection recovery | TBD | TBD | Pending |
| Canonical Run/Job identity equality and retry-new-Run provenance | TBD | TBD | Pending |
| Native identity, thread/session separation, and stateful adjacent-fragment redaction | TBD | TBD | Pending |
| Assistant and reasoning delta/final reconciliation | TBD | TBD | Pending |
| Tool lifecycles and completed snapshots | TBD | TBD | Pending |
| Retry diagnostics, interrupt, transport exit, terminal, and late policy | TBD | TBD | Pending |
| Usage snapshot/dedupe/resume baseline | TBD | TBD | Pending |
| Artifact admission positive and negative cases | TBD | TBD | Pending |
| Unknown native method and stable status taxonomy | TBD | TBD | Pending |
| Runtime/protocol provenance and restart | TBD | TBD | Pending |
| Resume snapshot repair and rollout rehydrate | TBD | TBD | Pending |
| Desktop/headless/persistence/API convergence | TBD | TBD | Pending |
| Completion truth for denial/rejection/zero output | TBD | TBD | Pending |

## 3. Required Fixture Inventory

| Fixture/evidence | Required assertion | Receipt |
| --- | --- | --- |
| Trace `[EVENT-01..03]` probes | Every response/notification/request/send/resolved boundary is ordered; assistant/reasoning final snapshots do not duplicate; errors retain code/`willRetry`/IDs | TBD |
| Definite append failure / unknown commit | No pre-commit acknowledgement or fan-out; stable fact-key reconciliation persists the pending fact once before a later fact | TBD |
| Crash after commit / projection failure | Durable sequence survives; projection resumes from its cursor without rollback, renumbering, or duplicate API delivery | TBD |
| Run/job identity and retry | Event/public `jobId` equals canonical `runId`; mismatch fails before provider work; retry creates a new ledger/ID with source/root/attempt provenance | TBD |
| Assistant delta + final | Completed snapshot is authoritative; agreement/missing suffix/divergence are classified | TBD |
| Reasoning text/summary parts + final | Part boundaries and identity survive; no duplicate text | TBD |
| Command execution | started/progress/completed correlation and exactly one finish | TBD |
| File change | started/progress/completed correlation; path is only an artifact candidate | TBD |
| MCP tool call | started/progress/completed correlation without upgrading capability proof | TBD |
| Dynamic tool call | started/progress/completed correlation | TBD |
| Collaboration-agent tool call | started/progress/completed correlation | TBD |
| Web search | started/progress/completed correlation | TBD |
| Image generation | started/progress/completed correlation; image candidate requires admission | TBD |
| Image view | Native start/completed boundaries correlate without inventing a delta; viewed path remains only an artifact candidate | TBD |
| Retry error then success | Retry remains diagnostic and one successful terminal is emitted | TBD |
| Fatal error | Diagnostic evidence settles one failed terminal | TBD |
| Interrupt/cancel | Final status is correct and only one terminal is emitted | TBD |
| Usage repeat/increase/reset | Snapshot total/last/dedupe/discontinuity semantics hold | TBD |
| Unknown future method | Stable sanitized status/loss record, never empty projection | TBD |
| Duplicate/out-of-order/late input | Loss/reconciliation is visible; settled truth/text/terminal are immutable | TBD |
| Transport restart/exit | Only a pre-authorized same-Run replacement bound before its deadline continues the high-water sequence; every definitive exit has one synthetic terminal | TBD |
| Adjacent split-secret output | Per-channel withholding and terminal flush expose no exact secret in events or reconstructed/public output | TBD |
| `[CODEX-06]` missing/malformed/truncated rollout | Diagnostic only; no false snapshot/replay | TBD |
| `[CODEX-07]` cross-version completed snapshot | `repair.source=snapshot`, loss flag, and reconciliation result | TBD |
| `[CODEX-08]` error/failed rollout across reopen | Error and failed terminal are durable and remain terminal after rehydrate | TBD |
| Artifact negative matrix | Missing/out-of-scope/symlink/hardlink/cross-run/unstable/secret-bearing candidates never emit or manifest | TBD |

Trace §6.2's dynamically unmeasured 66-notification frequency/total-order cases must
be listed as follow-up evidence and must not be marked passed by the fixtures above.

## 4. Invariant and Deletion Evidence

Attach targeted source searches, architecture-guard results, and behavioral tests that
prove all of the following on the same frozen SHA:

- [ ] One ledger and one canonical sequence owner exists per Run.
- [ ] Event/internal/public `jobId`, when present, equals canonical `runId`; a retry
  creates a new ledger/ID and cannot mutate its terminal source Run.
- [ ] Durable atomic append is the acknowledgement/visibility barrier; definite or
  unknown failures cannot expose a record, let a later fact overtake it, reuse its
  accepted sequence for another fact, or roll back committed truth after projection
  failure.
- [ ] Durable job-event and Local Job API sequences use the ledger value; the existing
  optional `runEventSequence` compatibility alias, if present, equals envelope
  `sequence` and is never accepted as a second cursor.
- [ ] Exactly one `completed` is durably emitted for success, failure, cancel,
  interrupt, retry recovery, transport exit, and restart.
- [ ] No native input has an unknown/default `[]` or `null` path.
- [ ] No adapter or stream mapper allocates sequence or owns terminal truth.
- [ ] Stateful per-Run/item/channel redaction withholds an exact secret split across
  adjacent fragments and flushes safely before terminal fan-out.
- [ ] Desktop persistence does not reconstruct truth by blindly joining raw deltas.
- [ ] Headless does not strip the envelope or suppress ledger completion.
- [ ] Job persistence does not re-sequence or mint another completion.
- [ ] Thread/session substitution is absent.
- [ ] Artifact candidates cannot emit `artifact_created` before canonical admission,
  and no module outside `run-artifacts.ts` decides eligibility, owns manifest admission,
  or mints the event.
- [ ] The implementation gate and legacy branch are deleted before acceptance.
- [ ] A pre-authorized same-Run transport replacement is bounded by attempt identity,
  installation/protocol match, and deadline; every other exit settles synthetically and
  no post-terminal snapshot mutates output.
- [ ] The ownership guard proves detection against synthetic violating and clean
  fixtures.
- [ ] The ownership guard still pins `createRunEvent` to `runtime-events.ts` and
  `redactRuntimePayload`, `redactExactSecretHints`,
  `createExactSecretStreamRedactor`, and
  `createExactSecretStreamChannelRedactor` to `redaction.ts` while rejecting deleted
  raw renderer redaction/emitter paths.

Evidence: TBD.

## 5. Security and Provenance Evidence

- [ ] Secret-like native payloads are redacted before every renderer, persistence,
  headless, CLI, API, result, and artifact projection.
- [ ] Each record binds exact installation ID, executable identity/digest, and
  protocol/schema identity from an immutable pre-run snapshot.
- [ ] Missing required provenance fails closed before provider work.
- [ ] Artifact checks cover real path, symlink/hardlink escape, allowed root, Run
  ownership, file stability, digest, metadata, and redaction.
- [ ] Synthetic terminal and snapshot repair preserve both runtime provenance and
  their explicit synthetic/repair source.

Evidence: TBD.

## 6. Consumer Compatibility Evidence

| Consumer | Version / schema | Fixtures and assertions | Result / migration |
| --- | --- | --- | --- |
| Amadeus | TBD | Native assembler, assistant/reasoning, tool lifecycle, completion, ordering/cursor | TBD |
| Career Kit | TBD | Batch, structured output, completion status/exit/retry, result, artifact manifest | TBD |
| Desktop/Workbench | Repository SHA TBD | Renderer and persisted timeline derive from identical ledger facts | TBD |
| Headless/CLI | Repository SHA TBD | Full envelope, exact sequence, one terminal, replayable logs | TBD |
| Local Job API v1 | `locus.local-job.v1` | Exact 12 event types; existing envelope; `--after`/`--follow`; optional unknown-safe payload additions | TBD |
| Other consumers | `unknown` until inventory | Record discovery query and outcome | TBD |

Any failure that falls within a C7 Red row returns to Owner decision; it is not waived
as an internal refactor.

## 7. Command Evidence

Fill this table only with exact output captured on the frozen source SHA.

| Command | Expected gate | Exact output / receipt | State |
| --- | --- | --- | --- |
| Independent red-first test commands | Expected failures before implementation | TBD | Pending |
| Targeted ledger/adapters/persistence/API/security tests | Zero failures after implementation | TBD | Pending |
| `bun run check:full` | Exit 0 | TBD | Pending |
| `bun x openspec validate refactor-canonical-run-event-ledger --strict --no-interactive` | Valid | Draft-authoring result to be recorded; rerun on implementation SHA | Pending |
| `git diff --check` | No output, exit 0 | Draft-authoring result to be recorded; rerun on implementation SHA | Pending |
| Architecture guard / residue search | No legacy owner/path; synthetic self-test passes | TBD | Pending |
| Secret scan | No credential or unredacted fixture material | TBD | Pending |
| Packaged/runtime smoke, if environment permits | Desktop and headless evidence with limitations disclosed | TBD | Pending |

## 8. Review and Acceptance

| Gate | Reviewer / receipt | Source SHA | State |
| --- | --- | --- | --- |
| Correctness review | TBD | TBD | Pending |
| Architecture/ownership review | TBD | TBD | Pending |
| Consumer compatibility review | TBD | TBD | Pending |
| Security/provenance/artifact review | TBD | TBD | Pending |
| All P0/P1/P2 findings resolved or explicitly disposed | TBD | TBD | Pending |
| Owner `ACCEPTED` | Must be explicit and reference frozen evidence | TBD | Pending |

No merge, archive, or completion claim is permitted before Owner `ACCEPTED`. No push or
other remote operation is authorized by this document.
