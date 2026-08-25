# Contributing to Locus

## Building From Source

Prerequisites: Bun, Python, and Xcode Command Line Tools on macOS.

```bash
bun install
bun run dev
bun run build
bun run package:mac
```

Download bundled agent binaries before packaging:

```bash
bun run claude:download
bun run codex:download
```

## Windows Packaging

Build Windows x64 packages on a Windows machine or the `Package Windows` GitHub Actions workflow. This app includes native Electron dependencies such as SQLite and PTY support, so macOS cross-packaging can fail when those modules need Windows-native rebuilds.

For local Windows packaging:

```bash
bun install
node scripts/download-claude-binary.mjs --version=2.1.177 --platform win32-x64
node scripts/download-codex-binary.mjs --version=0.139.0 --platform win32-x64
bun run build
bun run package:win -- --x64
```

Unsigned Windows builds are suitable for limited internal testing, but Windows SmartScreen may warn users. Public distribution should use a proper code-signing certificate.

The GitHub Actions artifact is named `locus-windows-x64`.

## Release Hygiene

Locus does not use `electron-updater` or an automatic hosted update feed in the default local-first build. Settings > About performs a manual GitHub Releases check only; users must choose whether to open the release page, download an artifact, and install it.

Generate release attachment metadata after packaging:

```bash
bun run release:manifest
```

The manifest generator accepts the current friend-build macOS artifacts, such as `Locus-0.0.73-arm64-friend.zip`, and electron-builder default ZIP names. Attach the generated manifest and release artifacts to GitHub Releases manually.

Run the macOS DMG smoke helper before sharing a build:

```bash
bun run release:smoke:mac
```

This verifies the DMG, mounts it, copies `Locus.app` into a temporary install location, and reports code-signing/notarization status. Pass `--launch` to request a launch check; unsigned or ad-hoc builds may be blocked by Gatekeeper. Finish the UI smoke manually by launching the DMG-installed app, selecting a real repository, confirming the selected repo is visible before agent actions, and checking Claude Code and Codex status in Settings.

Distribution policy for the current phase:

- The source repository may be opened before signing infrastructure is ready.
- Source builds do not require Apple Developer ID, notarization, or Windows code signing.
- Desktop artifacts shared through GitHub Releases before signing is configured must be labeled as unsigned pre-release/test builds.
- Internal macOS builds may be unsigned or ad-hoc signed, and internal Windows builds may be unsigned.
- Broad public installer distribution should wait for macOS Developer ID signing, hardened runtime, notarization/stapling, and Windows code signing.

Current repo config does not define a macOS notarization step.

## Local-Only Boundary

This repository runs in **Local-only mode by default**. Hosted upstream product surfaces are removed or isolated from the default local-first build, and the Local-only guard remains as defense-in-depth against accidental upstream calls.

Local-only can only be disabled explicitly for development or internal compatibility checks:

```bash
LOCUS_LOCAL_ONLY=false bun run dev
# or
MAIN_VITE_LOCAL_ONLY=false bun run dev
```

User-configured providers, Ollama, local projects, Git, and GitHub operations remain available in Local-only mode.

| Feature | Local-first build | Hosted upstream |
|---------|-------------------|-----------------|
| Local AI chat | Yes | Yes |
| Claude Code integration | Yes | Yes |
| Codex integration | Yes | Yes |
| Git worktrees | Yes | Yes |
| Terminal | Yes | Yes |
| Sign in / sync | Removed from default build | Upstream only |
| Inbox / automations | Removed from default build | Upstream only |
| Remote sandbox / Open Locally import | Hidden from default build | Upstream only |
| Background agents | Removed from default build | Upstream only |
| Auto-updates | No automatic install; manual GitHub Releases check only | Upstream only |

## Analytics & Telemetry

Hosted analytics and error tracking are not included in the default local-first build. Do not add telemetry or crash reporting without an explicit product/privacy proposal and opt-in design.

## Contribution Workflow

1. Read `AGENTS.md`, `docs/OWNERSHIP_MAP.md`, and the relevant approved OpenSpec change.
2. Keep one bounded change per branch/worktree and assign file ownership before parallel work.
3. Preserve Local-only behavior unless an approved change explicitly targets hosted/internal mode.
4. Replace internal paths atomically: do not leave old and new business implementations alive together.
5. For a public/versioned contract, complete `docs/consumer-impact-template.zh-CN.md` and obtain the Owner's compatibility decision before implementation.
6. Record targeted tests, manual/packaged smoke, known limitations, and verdicts in the change's `verification.md`.
7. Run `bun run check:full` before completion.

The default AI collaboration is Codex implementation plus fresh-context Claude Code review. Both
technical verdicts must name the same exact source SHA; any later code change invalidates them.
Owner product acceptance is still separate and required.

Local commits are allowed. Pushes, remote PR changes, remote merge, releases, and repository-rules
changes require explicit Owner authorization for that external action.

## Phase Completion Checklist

Before treating a phase as complete:

```bash
bun run check:full
```

`check:full` runs changed-file lint, architecture guards, typechecking, isolated tests, strict
OpenSpec validation, the production build, and patch whitespace checks. On a feature branch the
whitespace gate checks both local edits and the merge-base-to-`HEAD` patch; CI and exact-SHA closeout
set `DIFF_BASE_SHA` explicitly. Add the approved change's
targeted and manual/packaged smoke; the aggregate command does not replace those product gates.

Also confirm the phase-specific product boundary:

- Local-only startup does not contact upstream hosted auth, sandbox, telemetry, updater, automations, or inbox surfaces.
- Claude Code and Codex status surfaces still reflect local credentials/providers.
- Repository onboarding does not allow agent actions without a confirmed local project.
- Settings panels report loading, empty, and error states without adding new cloud entrypoints.
- Release artifacts are manual GitHub Releases assets unless a future approved updater proposal changes that.

## License

Apache License 2.0.
