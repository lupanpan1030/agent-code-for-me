# Change: Update tRPC capability boundary

## Why

Locus is a local Electron app whose renderer receives and displays untrusted repository files,
chat/markdown content, tool output, and local browser previews. The renderer also receives the
whole tRPC bridge through `exposeElectronTRPC()`, while the tRPC context carries only
`{ getWindow }` and mounted procedures are public or logging-wrapped public procedures. A
renderer influenced by untrusted content can therefore ask the main process to perform
filesystem, shell, network, credential, git, and runtime operations.

This is not a remote API authentication problem. A renderer-held login token would be controlled
by the same compromised renderer. The boundary must instead constrain what renderer-reachable
code can make the main process do.

## What Changes

- Maintain the dangerous-input guard's procedure-keyed field allowlist plus a reviewed
  privileged-operation cluster inventory across the 41 router modules under
  `src/main/lib/trpc/routers/` (excluding the index) and the mounted `changes` git router. The
  current app router mounts 33 namespaces; full capability taxonomy remains follow-up work.
- Record the implemented Phase 1 boundary slices: registered-root validation for the covered
  filesystem/configuration sinks, real-path protection for covered reads/listing, lexical
  containment for rename/delete, server-resolved Claude/Codex and terminal cwd, constrained
  terminal startup intents, and argv-based GitHub clone.
- Record the implemented renderer slices: production/development CSP separation, Streamdown
  sanitization/hardening for markdown HTML, a source guard limiting files that contain React
  `dangerouslySetInnerHTML` to a reviewed five-file list, Mermaid SVG sanitization, and text-only
  tool subtitles.
- Record the implemented MCP stdio native-consent, fingerprint, and fail-closed materialization
  boundary.

## 2026-09-02 Rebaseline

Owner approved D1-D6. This change now archives only implementation truth present at
`d77a4b48e8d60cdaf20b8ae02d5df9482239e24a`:

- retained: Phase 1 tasks 1.1-1.9, Phase 2 tasks 2.1/2.1a/2.5, and Phase 3 task 3.3a, with
  requirement text narrowed where the old wording exceeded the implementation;
- moved to follow-up A (`add-renderer-untrusted-content-hardening`): the remaining renderer
  content, webview/preview guest hardening, and desktop smoke work from 2.2-2.4;
- moved to follow-up B (`add-trpc-capability-consent-audit`): capability taxonomy/wrappers,
  non-MCP consent, audit, kill-switches, bare-procedure enforcement, and the `terminal.write`
  capability gate from 3.1-3.5 other than 3.3a;
- excluded from the certified requirement text: the inherited renderer-selected
  `projectPath` used for runtime MCP lookup, already documented against the TICKET-101/104
  lineage and the later Amadeus continuation slice; and parent-directory symlink escape for
  rename/delete, because those writes currently enforce lexical rather than real-path containment.

Follow-up A may be drafted after this change is archived and scheduled independently. Follow-up
B waits until Foundation 1d and the Amadeus continuation slice are complete. These destinations
are routing records only; neither follow-up is created by this change.

## Impact

- Affected spec: `runtime-security-baseline` (six added requirements, 18 scenarios).
- Product code and public APIs: no change in this rebaseline; it is documentation/spec-only.
- Compatibility: no renderer, preload, tRPC, runtime, filesystem, or persisted-data shape changes.
- Archive gate: fresh Claude multi-perspective review and Owner `ACCEPTED` are required against
  the frozen source SHA before normal OpenSpec archive. No `--skip-specs` archive is permitted.
- Non-goals: remote/user authentication for local tRPC, policy-grant scope enforcement, the two
  follow-up implementations, STATUS/TICKET updates before archive, push, or any remote action.
