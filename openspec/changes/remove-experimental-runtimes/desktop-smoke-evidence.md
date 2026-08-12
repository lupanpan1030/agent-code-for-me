# Desktop Smoke Evidence

Date: 2026-08-12

Change: `remove-experimental-runtimes`

Task: 10.5

Final result: **PASS** (see the resolution and final interactive addenda). The original no-click
run below failed/incomplete and is preserved as an evidence trail.

- The requested command-line gates passed: `bun run check` reported 1378 pass / 0 fail, the
  retired-runtime residue script exited 0, and OpenSpec validated 7/7 changes and 49/49 specs.
- The dev app built, initialized the real dev database, created a window, reached `ready to show`,
  finished loading, and shut down cleanly after the smoke interval.
- Verification failed because the retired-runtime cleanup function is not imported or called from
  `src/main/index.ts`; the startup sweep therefore does not run.
- Verification also found split retired-runtime literals in four allowlisted tests. This is in
  apparent conflict with the prompt's explicit no-splitting constraint and needs review; static
  inspection does not establish why the strings were split. No files were changed to repair this
  during verification.
- All click-dependent checks remain unverified and need a human.

## Part A — programmatic checks

### Full repository check

Command:

```sh
bun run check
```

Captured terminal preamble (verbatim):

```text
$ bun run lint && bun run architecture:check && bun run ts:check && bun run test
$ bun run lint:changed
$ node scripts/run-biome-changed.mjs
Biome diagnostics on changed lines:
- warning lint/suspicious/noExplicitAny src/main/lib/provider-profiles/gateway.ts:194:66 Unexpected any. Specify a different type.
- warning lint/suspicious/noExplicitAny src/main/lib/provider-profiles/gateway.ts:197:46 Unexpected any. Specify a different type.
- warning lint/suspicious/noExplicitAny src/main/lib/provider-profiles/gateway.ts:1315:16 Unexpected any. Specify a different type.
- warning lint/suspicious/noExplicitAny tests/claude-agent-sdk-project-context.test.ts:15:11 Unexpected any. Specify a different type.
- warning lint/suspicious/noExplicitAny tests/claude-agent-sdk-project-context.test.ts:33:13 Unexpected any. Specify a different type.
Biome reported diagnostics only outside changed lines; ignoring legacy file diagnostics.
$ node scripts/check-architecture-guards.mjs
Architecture guard passed.
$ tsc --noEmit
$ bun test --isolate tests
bun test v1.3.14 (0d9b296a)
```

Captured terminal final summary (verbatim; the test runner emitted the individual passing test
lines between these two captured fragments):

```text
 1378 pass
 0 fail
 6874 expect() calls
Ran 1378 tests across 251 files. [10.42s]
```

Result: passed, exactly **1378 pass / 0 fail**.

### Retired-runtime residue gate

Command:

```sh
node scripts/check-retired-runtime-residue.mjs
```

Output:

```text
Retired-runtime residue check passed (1139 files scanned, 9 allowlisted).
```

The source has exactly nine allowlisted files, each with a stated reason:

| File | Stated reason |
| --- | --- |
| `src/main/lib/retired-runtime-state-cleanup.ts` | `deletes the retired runtimes' leftover userData paths; must name them` |
| `src/main/lib/ollama/detector.ts` | `Ollama MODEL names (qwen-coder / qwen2.5-coder); unrelated to the runtime` |
| `tests/retired-runtime-state-cleanup.test.ts` | `tests the cleanup above, including its symlink-escape guard` |
| `tests/agent-runtime-registry.test.ts` | `negative assertions proving the router no longer contains the retired symbols` |
| `tests/agent-chat-provider-routing.test.ts` | `regression: a legacy/unknown provider string must fall back inside the union` |
| `tests/provider-profile-storage-security.test.ts` | `regression: a stored kun-only provider profile must load and re-save` |
| `tests/local-job-api.test.ts` | `asserts the API rejects retired runtime ids` |
| `scripts/check-retired-runtime-residue.mjs` | `this gate itself: the pattern and the allowlist reasons name the retired ids` |
| `tests/local-job-api-schema.test.ts` | `asserts the published schema rejects retired runtime ids` |

This verification run did not edit the checker or its allowlist.

#### Split-literal review finding

Although the script exits 0, four allowlisted test files still construct `qwen-code` from split
fragments. `tests/agent-runtime-registry.test.ts` also splits the removed symbol names. These are
the exact current lines:

```text
tests/agent-runtime-registry.test.ts:87:    const retiredCliRuntimeId = ["qw", "en", "-code"].join("")
tests/agent-runtime-registry.test.ts:104:    for (const retiredSymbol of [["K", "un"].join(""), ["Q", "wen"].join("")]) {
tests/agent-runtime-registry.test.ts:112:      ["K", "UN_RUNTIME_MANIFEST"].join(""),
tests/agent-runtime-registry.test.ts:115:      ["Q", "WEN_CODE_RUNTIME_MANIFEST"].join(""),
tests/agent-chat-provider-routing.test.ts:40:    const retiredCliRuntimeId = ["qw", "en", "-code"].join("")
tests/local-job-api.test.ts:176:    const retiredRuntimeIds = [["qw", "en", "-code"].join(""), "kun"]
tests/local-job-api-schema.test.ts:115:      ["qw", "en", "-code"].join(""),
```

The Git diff confirms at least the Local Job API and schema assertions were changed from the plain
literal `qwen-code` to split fragments in the current implementation diff. This is in apparent
conflict with the smoke prompt's explicit no-splitting constraint and must be reviewed. Intent is
not inferred from the static diff, and the finding is reported rather than repaired here.

Checker caveat: the allowlist operates at whole-file granularity, so any matching line in an
allowlisted file is skipped. Also, the reported 1139 is the candidate-path count; 35 cached paths
deleted in the current worktree fail to read with `ENOENT` and are silently skipped, so 1104 files
were actually read. These observations do not change the command's exit status above.

### OpenSpec validation

Command:

```sh
openspec validate --changes --strict --no-interactive
```

Output:

```text
✓ change/add-agent-native-projection-writes
✓ change/add-headless-provider-binding
✓ change/add-local-job-api-runtime-readiness
✓ change/add-policy-grant-scope-enforcement
✓ change/add-remote-model-catalog
✓ change/remove-experimental-runtimes
✓ change/update-trpc-capability-boundary
Totals: 7 passed, 0 failed (7 items)
```

Command:

```sh
openspec validate --specs --strict --no-interactive
```

Output:

```text
✓ spec/agent-builder
✓ spec/agent-chat-attachments
✓ spec/agent-chat-commands
✓ spec/agent-context-recommendations
✓ spec/agent-long-text-context
✓ spec/agent-protocol-interfaces
✓ spec/agent-provider-profiles
✓ spec/agent-runtime-capabilities
✓ spec/agent-runtime-core
✓ spec/agent-scope-contracts
✓ spec/agent-workbench
✓ spec/app-agents
✓ spec/app-update-check
✓ spec/architecture-ownership
✓ spec/canonical-entity-vocabulary
✓ spec/chat-stream-rendering
✓ spec/claude-code-credentials
✓ spec/codex-runtime-parity
✓ spec/command-guide
✓ spec/desktop-agent-jobs
✓ spec/file-viewer-performance
✓ spec/first-run-onboarding
✓ spec/fork-residue-hygiene
✓ spec/general-assistant-chat
✓ spec/github-workflow-context
✓ spec/github-workflow-writeback
✓ spec/headless-agent-jobs
✓ spec/local-browser-workbench
✓ spec/local-job-api
✓ spec/local-only-cloud-guard
✓ spec/mcp-registry-install
✓ spec/project-lifecycle
✓ spec/project-onboarding
✓ spec/provider-credential-storage
✓ spec/provider-diagnostics
✓ spec/provider-routing-ux
✓ spec/provider-runtime-bindings
✓ spec/runtime-capability-projection
✓ spec/runtime-mcp-import-preview
✓ spec/runtime-mcp-settings-ux
✓ spec/runtime-plugins
✓ spec/runtime-security-baseline
✓ spec/settings-information-architecture
✓ spec/settings-state-integrity
✓ spec/skill-registry
✓ spec/ui-localization
✓ spec/usage-panel
✓ spec/voice-input
✓ spec/workspace-navigation
Totals: 49 passed, 0 failed (49 items)
```

Result: both passed.

### Closed runtime set

Source inspected: `src/shared/agent-runtime-capabilities.ts:1-6`.

```text
1  export const CONTRACT_RUNTIME_IDS = ["claude-code", "codex"] as const
2  export const EXPERIMENTAL_RUNTIME_IDS = [] as const
3  export const AGENT_RUNTIME_IDS = [
4    ...CONTRACT_RUNTIME_IDS,
5    ...EXPERIMENTAL_RUNTIME_IDS,
6  ] as const
```

Runtime assertion command:

```sh
bun -e 'import { AGENT_RUNTIME_IDS, EXPERIMENTAL_RUNTIME_IDS } from "./src/shared/agent-runtime-capabilities.ts"; console.log(JSON.stringify({ AGENT_RUNTIME_IDS, EXPERIMENTAL_RUNTIME_IDS }))'
```

Output:

```text
{"AGENT_RUNTIME_IDS":["claude-code","codex"],"EXPERIMENTAL_RUNTIME_IDS":[]}
```

Result: passed. `AGENT_RUNTIME_IDS` is exactly `["claude-code", "codex"]` at runtime and
`EXPERIMENTAL_RUNTIME_IDS` is exactly `[]`.

### Startup cleanup sweep

Wiring check:

```sh
rg -n "retired-runtime-state-cleanup|cleanupRetiredRuntimeState" src/main/index.ts
```

Output: none. Exit status: 1.

Repo-wide symbol check:

```sh
rg -n "cleanupRetiredRuntimeState" src/main/index.ts src/main/lib tests/retired-runtime-state-cleanup.test.ts
```

```text
tests/retired-runtime-state-cleanup.test.ts:16:import { cleanupRetiredRuntimeState } from "../src/main/lib/retired-runtime-state-cleanup"
tests/retired-runtime-state-cleanup.test.ts:58:    await cleanupRetiredRuntimeState(userDataPath)
tests/retired-runtime-state-cleanup.test.ts:59:    await cleanupRetiredRuntimeState(userDataPath)
tests/retired-runtime-state-cleanup.test.ts:76:    await cleanupRetiredRuntimeState(userDataPath, {
tests/retired-runtime-state-cleanup.test.ts:115:    await cleanupRetiredRuntimeState(userDataPath, {
src/main/lib/retired-runtime-state-cleanup.ts:65:export async function cleanupRetiredRuntimeState(
```

Result: **failed**. `cleanupRetiredRuntimeState` exists but is neither imported nor called by
`src/main/index.ts`. The GUI startup path at `src/main/index.ts:510-511` and the headless startup path
at `src/main/index.ts:446-447` do not invoke it. Therefore none of the intended upgrade deletions run
at startup.

Static inspection of the uncalled sweep:

- It targets exactly `{userData}/kun-cli-settings.json`,
  `{userData}/qwen-cli-settings.json`, `{userData}/runtimes/kun`, and
  `{userData}/runtime-feature-settings.json`.
- Each of the four operations has its own `try/catch`; `ENOENT` is ignored and any other failure is
  warned without blocking the remaining operations (`retired-runtime-state-cleanup.ts:107-119`).
- The `runtimes` parent must be a real directory and not a symlink (`:39-43`). Its realpath must
  equal `{real userData}/runtimes` (`:45-53`). A leaf `runtimes/kun` symlink is unlinked rather than
  followed (`:55-60`). Settings paths are fixed children and use `unlink`, which removes a leaf
  symlink rather than its target.
- With the trusted Electron `userDataPath`, all constructed targets are fixed descendants of that
  path. There is a residual check-then-delete race if another local process replaces `runtimes`
  between the realpath check and `rm`; the code is path-check based rather than descriptor based.

The guards are present in the module, but the requested startup wiring is absent, so Part A step 5
does not pass.

## Part B — desktop boot and log inspection

Launch command (stdout and stderr both captured):

```sh
bun run dev > /tmp/locus-smoke.log 2>&1 &
```

The clean capture launched at `2026-08-12T21:01:24+1200`. The background job was:

```text
[1]  + 70182 running    bun run dev > /tmp/locus-smoke.log 2>&1
```

After approximately 42 seconds, the Electron process was stopped with:

```sh
kill -TERM 72822
```

The app and its dev-server processes exited. The final log is 117 lines / 12053 bytes:

```text
591dc9aca363f913be3bb43f4c23ea924d5d2b53e6108977348840b0fc193e0c  /tmp/locus-smoke.log
```

Relevant captured output (verbatim):

```text
$ node scripts/ensure-electron-native-modules.mjs && electron-vite dev
[native] Electron native modules are ready.
vite v6.4.1 building SSR bundle for development...
transforming...
✓ 405 modules transformed.
rendering chunks...
out/main/offline-handler-CE9pEBPa.js      2.14 kB
out/main/agent-runtime-CBoHre7G.js       28.01 kB
out/main/index.js                     2,010.46 kB
✓ built in 2.27s

build the electron main process successfully

-----

vite v6.4.1 building SSR bundle for development...
transforming...
✓ 2 modules transformed.
rendering chunks...
out/preload/index.js  7.32 kB
✓ built in 19ms

build the electron preload files successfully

-----

dev server running for the electron renderer process at:

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose

start electron app...

[App] Using userData path: {userData} Code for Me Dev
[Protocol] Dev mode registration (locus-dev): success
[Protocol] Dev mode registration (agent-code-for-me-dev): success
[App] Starting Locus Dev...
[Protocol] Verification - isDefaultProtocolClient: true
[Analytics] Hosted telemetry removed from local-first build
[DB] Initializing database at: {userData} Code for Me Dev/data/agents.db
[DB] Running migrations from: ~/Code/GitHub/agent-code-for-me/drizzle
[DB] Migrations completed
[App] Database initialized
[Main] Created window 1 with stable ID "main" (total: 1)
[Auth Server] Listening on http://localhost:21322
Browserslist: browsers data (caniuse-lite) is 8 months old. Please run:
  npx update-browserslist-db@latest
  Why you should do it regularly: https://github.com/browserslist/update-db#readme
[MCP] Cache updated in 41ms. Working: 0/0
[Main] Window 1 ready to show
[Main] Page finished loading in window 1
[claude-binary] ========== BUNDLED BINARY DEBUG ==========
[claude-binary] isDev: true
[claude-binary] platform: darwin
[claude-binary] arch: arm64
[claude-binary] appPath: ~/Code/GitHub/agent-code-for-me
[claude-binary] resourcesPath: ~/Code/GitHub/agent-code-for-me/resources/bin/darwin-arm64
[claude-binary] binaryPath: ~/Code/GitHub/agent-code-for-me/resources/bin/darwin-arm64/claude
[claude-binary] exists: true
[claude-binary] size: 214.7 MB
[claude-binary] isExecutable: true
[claude-binary] ============================================
[claude-env] Using fast environment with 73 vars
[claude-env] Refreshed 33 environment variables from shell
[App] Shutting down...
[GitWatcher] All watchers cleaned up
[DB] Database connection closed
[Main] Window 1 closed
```

The build also emitted 13 Vite `(!)` dynamic/static-import chunking warning lines. The entire log,
including those warning lines, was scanned with this command:

```sh
node - <<'NODE'
const fs = require("node:fs")
const lines = fs.readFileSync("/tmp/locus-smoke.log", "utf8").trimEnd().split(/\r?\n/)
const warningOrError = lines.filter((line) => /\bwarn(?:ing)?\b|\berror\b|\(!\)/i.test(line))
const count = (source, pattern) => source.filter((line) => pattern.test(line)).length
console.log(JSON.stringify({
  totalLines: lines.length,
  retiredTokensAnywhere: count(lines, /kun|Kun|qwen-code|QwenC/),
  warningOrErrorLines: warningOrError.length,
  retiredTokensInWarningOrErrorLines: count(warningOrError, /kun|Kun|qwen-code|QwenC/),
  unsupportedDesktopJobRuntime: count(lines, /Unsupported desktop job runtime/),
  missingI18nKeyWarnings: count(lines, /missing.{0,40}(?:i18n|translation|locale|key)|(?:i18n|translation|locale).{0,40}missing/i),
  unhandledMainProcessMarkers: count(lines, /unhandled|uncaught|fatal|exception/i),
  stackTraceLines: count(lines, /^\s*at\s+/),
}, null, 2))
NODE
```

Output:

```json
{
  "totalLines": 117,
  "retiredTokensAnywhere": 0,
  "warningOrErrorLines": 13,
  "retiredTokensInWarningOrErrorLines": 0,
  "unsupportedDesktopJobRuntime": 0,
  "missingI18nKeyWarnings": 0,
  "unhandledMainProcessMarkers": 0,
  "stackTraceLines": 0
}
```

Log findings:

- Passed: a running window was created and fully loaded, with no unhandled main-process exception.
- Passed: zero occurrences of `kun`, `Kun`, `qwen-code`, or `QwenC` in warning/error lines; in fact,
  zero occurrences anywhere in the log.
- Passed: no `Unsupported desktop job runtime` error.
- Passed: no missing-i18n-key warning.
- Failed/inconclusive for sweep execution: the sweep logged nothing because it is not wired into
  startup. It did not throw, but it also did not run.
- Stack traces: **none present**, so there is no stack trace to reproduce verbatim.

## Part C — unverified, needs a human

- **UNVERIFIED — needs a human: Engine picker.** Open the Engine picker once in the new-chat form
  and once in an active-chat input; confirm both list only Claude Code and Codex.
- **UNVERIFIED — needs a human: Settings → Agents & Models.** Open the page and confirm there is no
  Kun section, no Qwen section, no runtime toggle, and no dangling deep-link destination.
- **UNVERIFIED — needs a human: First-run onboarding.** Start with a clean first-run profile and
  confirm there is no blank/empty slot where a removed engine used to render.
- **UNVERIFIED — needs a human: `onboarding.aiPath.engineNote` in both locales.** Read the note in
  English, switch to 简体中文, and confirm the reworded copy reads correctly in both.
- **UNVERIFIED — needs a human: Codex chat end to end.** Select Codex, send a harmless prompt, and
  confirm the response completes normally.
- **UNVERIFIED — needs a human: Provider Profile save and re-save.** Save a profile, reopen and
  save it again; repeat with any legacy profile that previously targeted Kun.
- **UNVERIFIED — needs a human: Jobs/History.** Open the Jobs/History surface and confirm existing
  `agent_jobs` rows render without an exception.

No repository was selected, no provider/model was selected, no chat was sent, and no renderer
controls were clicked during this no-click smoke.

## Acceptance handback

Task 10.5 should remain unchecked until:

1. The missing startup call to `cleanupRetiredRuntimeState(app.getPath("userData"))` (or the
   canonical equivalent) is reviewed and implemented outside this verification-only run.
2. The split retired-runtime test literals are reviewed against the explicit no-splitting
   constraint.
3. A human completes and records all seven click-dependent checks above.

---

## Resolution addendum (2026-08-12, supervising reviewer)

The smoke run above reported four blockers. Disposition of each, with root cause:

1. **Startup sweep not wired — CONFIRMED and FIXED.** Root cause was the supervising reviewer's
   formatter-noise revert, not the implementation: the batch-6 wiring in `src/main/index.ts` was
   classified as noise because its diff contains no retired-runtime keyword (`cleanupRetiredRuntimeState`
   names neither), and was reverted along with 513 genuinely-noisy files. This was the third miss of
   that keyword-based classifier (the first two, in task 7.7's files, were caught by `tsc`; this one
   compiled cleanly because the module is self-contained and separately tested). Re-wired as a
   10-line diff (import + guarded fire-and-forget call before database initialization). The call-site
   comment deliberately says "retired experimental runtimes" so `index.ts` needs no residue-gate
   allowance.
2. **String-split constructions in allowlisted tests — CONFIRMED and FIXED.** Seven remnant sites
   used variants (`["qw","en","-code"]`, `["K","un"]`, `["Q","wen"]`, `["K","UN_RUNTIME_MANIFEST"]`,
   `["Q","WEN_CODE_RUNTIME_MANIFEST"]`) that the earlier literal-restoration pass did not match.
   All are now plain literals; these files are explicitly allowlisted in
   `scripts/check-retired-runtime-residue.mjs`, so the splitting served no purpose. Repo-wide check
   confirms zero split constructions remain.
3. **tasks.md 16/33 checkbox mismatch — CONFIRMED, bookkeeping only.** Batches 2–5 were not
   instructed to tick boxes; every unchecked item except 10.5 was implemented, batch-reviewed, and
   covered by the green gates. Reconciled to 48 checked / 1 open (10.5).
4. **Seven UI checks — still open**, tracked under 10.5. These require a human clicking the app.

Post-fix verification: `bun run check` 1378 pass / 0 fail; `node scripts/check-retired-runtime-residue.mjs`
passed (1139 files, 9 allowlisted); `openspec validate` 7/7 changes, 49/49 specs. Note for readers:
an intermediate fix attempt ran `biome check --write` on the whole of `index.ts`, which reformatted
964 lines and broke `tests/headless-dock.test.ts` (a source-text assertion whose needle got wrapped);
that reformat was reverted in favor of the minimal hand-placed edit. Local paths in this document
were sanitized (`~`, `{userData}`) after the fact; content is otherwise as the smoke run wrote it.

---

## Final interactive smoke addendum (2026-08-12)

Final result: **PASS**. This addendum resolves the seven click-dependent checks above without
rewriting the original failed/incomplete run or its findings.

The final smoke used three scopes:

- a clean first-run `LOCUS_USER_DATA_DIR` for onboarding;
- the normal development profile for an initial new-chat/active-chat pass; and
- an isolated copy of the development schema seeded with one legacy provider profile and one
  legacy `agent_jobs` row. A temporary Codex home containing a copy of the existing authenticated
  session was used only for the isolated Codex chat. No credential value was printed or recorded.

### 10.5 interactive acceptance ledger

1. **Engine picker — passed.** The new-chat picker listed exactly `Claude Code` and
   `OpenAI Codex`. After the Codex chat completed, the active-chat picker again listed exactly those
   two entries.
2. **Settings → Models — passed.** The page contained no dedicated Kun or Qwen runtime section,
   runtime toggle, empty target control, or retired-runtime deep-link destination. The
   `Qwen / DashScope` provider preset and Ollama/local-model surfaces were still present; these are
   protected provider/model surfaces, not the removed runtime UI.
3. **First-run onboarding — passed.** The clean profile displayed three complete AI path cards:
   Claude, Codex, and Custom provider. There was no removed-engine card or empty grid slot.
4. **Bilingual `engineNote` — passed.** The rendered copy was verified in both locales:

   - English: `Connect one usable AI to start. You can switch engines later from the engine picker.`
   - Chinese: `先连接一个可用的 AI 即可开始。之后可在引擎选择器中切换引擎。`

5. **Codex end to end — passed.** In the isolated profile, the user sent
   `Reply exactly CODEX_REMOVE_RUNTIME_SMOKE_OK. Do not use tools.` through `OpenAI Codex` with
   `GPT-5.5`. The run completed and, after a renderer reload, displayed the exact assistant reply
   `CODEX_REMOVE_RUNTIME_SMOKE_OK`. The persisted assistant metadata identified the
   `codex-app-server` adapter.
6. **Provider profile save/re-save — passed.** The isolated database started with a profile whose
   stored target was the retired `kun` id. Opening it in Settings showed all four supported target
   buttons (Claude, Codex, Helpers, Local) unselected and no retired target. Codex was selected,
   Save produced `Provider Profile saved`, and a second Save produced the same success toast. A
   read-only database check then confirmed `target_runtimes_json = ["codex"]` and a Codex-only
   capability projection.
7. **Runs / History — passed.** A seeded succeeded API job with legacy runtime value `kun` rendered
   as `Existing retired-runtime history row` with status Succeeded. The surface retained the raw
   historical runtime label safely and showed no exception or error overlay.

The startup sweep remained wired before database initialization during this run. Both isolated
smoke directories were moved to Trash after shutdown. The copied `auth.json` and `installation_id`
files (including per-session copies) were then permanently unlinked from those recoverable
directories; no copied credential file remains there.

### Baseline and removed-test accounting (tasks 1.5 and 10.1)

The pre-change baseline at commit `67541e51` was **1462 tests / 264 files**. The final suite is
**1378 tests / 251 files**.

Deleted suites:

| Suite | Removed tests |
| --- | ---: |
| `experimental-runtime-message-history.test.ts` | 2 |
| `kun-cli-status.test.ts` | 6 |
| `kun-http-sse-adapter.test.ts` | 15 |
| `kun-http-sse-transport.test.ts` | 2 |
| `kun-managed-install.test.ts` | 6 |
| `kun-provider-config.test.ts` | 2 |
| `kun-serve-launcher.test.ts` | 6 |
| `provider-profile-runtime-gate.test.ts` | 5 |
| `qwen-acp-client.test.ts` | 8 |
| `qwen-cli-setup-guidance-ui.test.ts` | 3 |
| `qwen-cli-status.test.ts` | 10 |
| `qwen-desktop-run-request.test.ts` | 1 |
| `qwen-ui-stream-normalizer.test.ts` | 3 |
| `runtime-feature-settings.test.ts` | 5 |
| **Deleted-suite total** | **74** |

Surviving suites whose test declaration count changed:

| Suite | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `agent-chat-provider-routing.test.ts` | 6 | 5 | -1 |
| `agent-guard-runtime-pipeline.test.ts` | 6 | 5 | -1 |
| `agent-job-store.test.ts` | 8 | 7 | -1 |
| `agent-runtime-capabilities.test.ts` | 10 | 9 | -1 |
| `agent-runtime-permission-policy.test.ts` | 10 | 8 | -2 |
| `agent-runtime-registry.test.ts` | 7 | 5 | -2 |
| `onboarding-derived-status.test.ts` | 7 | 6 | -1 |
| `onboarding-setup-status.test.ts` | 16 | 15 | -1 |
| `proof-evidence-gates.test.ts` | 7 | 5 | -2 |
| `provider-profile-storage-security.test.ts` | 1 | 2 | +1 |
| `provider-routing-ux.test.ts` | 11 | 9 | -2 |
| **Surviving-suite net** |  |  | **-13** |

The new `retired-runtime-state-cleanup.test.ts` suite adds three tests and one file. The ledger
therefore closes exactly: tests `-74 - 13 + 3 = -84`, so `1462 - 84 = 1378`; files
`-14 + 1 = -13`, so `264 - 13 = 251`.

### Task 10.6 disposition

`AgentRuntimeId` and `AgentRuntimeContractId` both resolve to `"claude-code" | "codex"`. They remain
separate public aliases in this deletion-focused change. Their consolidation is filed as
`docs/tickets/TICKET-108-collapse-agent-runtime-id-types.md` so a future change can migrate the
headless and Local Job API consumers without obscuring this runtime-removal review.
