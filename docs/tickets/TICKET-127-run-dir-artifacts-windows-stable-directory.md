# TICKET-127 — Run-dir artifacts fail closed on Windows (stable-directory has no win32 backend)

## Status

Open, registered 2026-10-01 during the targeted re-review of
`refactor-canonical-run-event-ledger` at `0e6d1273` (Lens C, out-of-diff
observation; recorded in that change's `verification.md` follow-up register).
**Pre-existing since `e1370a78`; not introduced by this change.** Needs its own
platform-specific OpenSpec change before any implementation.

## Problem

`src/main/lib/filesystem/stable-directory.ts` anchors a directory handle through a
verified directory-fd namespace only on Linux (`/proc/self/fd/<fd>`) and on
macOS/FreeBSD (`/dev/fd/<fd>`). On every other platform, including `win32`,
`resolveDirectoryFdAnchor` (`stable-directory.ts:41-66`) throws
`… cannot be secured because this platform or filesystem does not expose a verified
directory-fd anchor (win32)`, so `openStableDirectory`, `openRegisteredStableDirectory`
and `openStableDirectoryChild` all fail on Windows. The module's contract says callers
must never fall back to path-only writes when it rejects the platform.

Locus targets Windows and macOS (WSL/Linux is a development host only), so this is a
product gap on a target platform, not a development-host limitation.

## Affected surfaces

- **Local Job API run-dir artifacts.** `prepareLocalJobApiArtifactRunDir`
  (`src/main/lib/headless/local-job-api.ts:342`, via `openOrCreateArtifactBaseDirectory`
  at `:294` and `openStableDirectoryChild` at `:321`/`:378`) is called through
  `createAdmittedRunDir` (`:868`) by API create/submit and retry **after** the
  creation commit (design D3 of `add-local-job-api-async-submit`: only the
  reservation winner creates the run directory, at `:993` and `:1086`). On Windows
  every request with `artifacts.baseDir` therefore fails there, and the host settles
  the already-created attempt `failed` with `errorCode` `artifact_admission_failed`
  (`admittedRunDirOrSettleFailed`, `:1003`): each artifact-bearing attempt leaves a
  durable failed row (and a `runs submit` key stays bound to it), while stderr and the
  exit code of `runs create` / default `runs retry` are unchanged. Before that change
  the request failed before the job row existed and left no row. Requests without
  `artifacts.baseDir` are unaffected. The manifest reader behind `runs result`
  (`readArtifacts`, `:624`) returns no entries when it cannot anchor the manifest
  directory.
- **Run-dir file writing and terminal files.** `writeRunArtifactFile`,
  `readRunArtifactFile`, `describeRunArtifactFile` and the staged terminal publish
  (`publishRunArtifactFile`) in `src/main/lib/agent-runtime/run-artifacts.ts` all
  operate through a `RunArtifactRunDir` handle, so there are no `request.json`,
  `events.jsonl`, `result.json` or `artifacts.json` files on Windows.
- **Native artifact admission.** The host's native candidate sink
  (`createRunArtifactCandidateSink`, `src/main/lib/agent-runtime/run-event-ledger-host.ts`)
  exists only for a Run with an admitted run directory, and admission reads candidates
  through the run directory handle (`readRunDirArtifactCandidate`,
  `run-artifacts.ts:230-269`). On Windows no Run has such a directory, so Codex
  `native-file`/`native-image`/`native-diff` candidates are never admitted.
- **Related users of the same backend, outside this ticket's core scope; check them
  under the same OpenSpec:** the Codex app-server shell-snapshot scrub
  (`src/main/lib/codex/app-server-shell-snapshots.ts:282, 303`) and the local-browser
  guest file preview (`src/main/windows/local-browser-guest-policy.ts:897-898`;
  TICKET-126 §5.3 already records that file preview is disabled under the current
  win32 backend).

## Current behavior

Fail closed. No path-only fallback writes or reads any run-dir file, and no native
artifact is published. There is no silent success. The cost is the loss of the
feature on Windows: API runs cannot request an artifact directory (each such attempt
leaves a `failed` / `artifact_admission_failed` job), and consumers get no run-dir
files or native artifact refs.

## Proposed scope for a platform-specific OpenSpec

1. Add a win32 backend for `stable-directory.ts` that gives the same guarantees the
   POSIX anchor gives:
   - a directory handle opened without following reparse points (symlinks and
     junctions);
   - identity checks by volume serial number and file ID (`GetFileInformationByHandle`)
     in place of `dev`/`ino`;
   - child operations relative to the handle, for example `NtCreateFile` with a
     `RootDirectory` handle, or a verified alternative with an equivalent proof;
   - single-link checks, and atomic replace (`MoveFileEx`/`SetFileInformationByHandle`
     rename) inside the anchored directory.
   It must still reject any platform or filesystem where the anchor cannot be proven,
   and must never fall back to path-only operations.
2. Decide the native-module/FFI strategy, packaging and signing implications, and the
   supported filesystems (NTFS, ReFS, network shares, OneDrive-backed folders).
3. Port the existing hardening tests (symlink/junction swap, hard link, rename race,
   escape names, temp-file capture) to Windows CI and to a packaged Windows smoke run.
4. Update the Local Job API consumer guides and the OWNERSHIP_MAP entry, and re-verify
   the related users listed above. The shell-snapshot scrub and local-browser file
   preview can land in the same change or be split out explicitly.
5. Until then, the consumer guides state that `artifacts.baseDir` is unavailable on
   Windows and that each attempt leaves a `failed` / `artifact_admission_failed` job
   ("Admission failure after creation" and "Known limits", landed with
   `add-local-job-api-async-submit`).

## References

- `openspec/changes/refactor-canonical-run-event-ledger/verification.md` — follow-up
  register ("Lens C out-of-diff — Windows run-dir artifacts").
- `phase3-rereview-c-0e6d1273.md` (coordinator handoff reviews), out-of-diff
  observation.
- `docs/tickets/TICKET-126-renderer-hardening-gui-tracks.md` §5.3 (Windows packaged
  track records the disabled file preview under the current win32 backend).
