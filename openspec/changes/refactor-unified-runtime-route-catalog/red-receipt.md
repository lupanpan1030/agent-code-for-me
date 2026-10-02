# RED receipt: refactor-unified-runtime-route-catalog

- Auditor: fresh-context Claude Code (Fable 5.1), independent of the four red-test authors and of any implementation context.
- Worktree: `/home/chen/projects/locus-refactor-unified-runtime-route-catalog-draft`; base `19986552d9f5bf2dd6ed2b2f38df2956ad8aad04` (product source identical to `6192b13f`: `git diff --stat 6192b13f 19986552 -- src tests scripts docs package.json` is empty).
- Approved spec `a9b74594`; design D1–D6, tasks §6/§7, verification §3 are the only authority used.
- Audit scope: read the four author reports; re-ran every suite file with `bun test --isolate` (per file and as one invocation); checked conventions; classified every red; built the S01–S53 coverage matrix; reconciled frozen shapes across authors and against the design; judged toy-stub satisfiability from the assertions and the authors' recorded dry runs. No test, src, scripts or fixture file was edited; no git mutation was run; this receipt is the only file written.
- Audit date: 2026-10-02.

**Verdict: CHANGES_REQUESTED** (three P1 items in §7; all are bounded, two are coordinator-only mechanical edits, one needs a shape adjudication and a relink confined to the capabilities kit/fixture). The suite's counts, red reasons and oracles are otherwise sound; after the P1 items are closed the suite is acceptable without re-auditing the unaffected files (re-run `capabilities.test.ts`, `discovery.test.ts` and `node scripts/check-retired-runtime-residue.mjs`).

## 1. Immutable file list (sha256 at audit; these supersede the hashes in the author reports, all of which were verified equal to the current bytes)

| File | sha256 | Domain |
| --- | --- | --- |
| tests/runtime-route-catalog-core-kit.ts | 3e0a78ffcc81b3a9abc9331e573fbc1e4a0df4ba855b81e6cfb2bb051072012d | catalog-core |
| tests/runtime-route-catalog-query.test.ts | 6a8a99d57a3dde233724e46208b0cbf149ba3b717d3655d0b58d3471574b74e6 | catalog-core |
| tests/runtime-route-catalog-routes.test.ts | 0218de1eee0467f0fd3b75288c22be706abd1071dab6de28065401e41578a1db | catalog-core |
| tests/runtime-route-catalog-provider.test.ts | 4bf7a2db1946dcef7da50ce837b1a3a6e1cba9a47d7b43beceb388884fe7d7bd | catalog-core |
| tests/runtime-route-catalog-completion.test.ts | c2263bbbcc73340bfd590106da5d4f12008752cf7aa5fcdde460daeecd0f75a0 | catalog-core |
| tests/runtime-route-catalog-capabilities-kit.ts | af972cdc1032aeaab4fa4708f4a1fc84d222d0d020fc4569a98b5988ba9171c7 | capabilities |
| tests/runtime-route-catalog-capabilities.test.ts | c14933541f4225c0238dab0144585e7260f8c8120cde9d7c9f991ff19e98f7dc | capabilities |
| tests/runtime-route-catalog-surfaces-kit.ts | 4a029807e8b70e9d00412361101e7cbf2b1668c50cfa823050674424b19d6846 | surfaces |
| tests/runtime-route-catalog-headless.test.ts | afa88029a2dfa390f96bd21d86d29be2a11c4945d9738f36af67d3688352fa92 | surfaces |
| tests/runtime-route-catalog-executor.test.ts | 2dc2d949c7d374d5986bd6d342a7cff2ec49a602c466fb16175e58a7528680eb | surfaces |
| tests/runtime-route-catalog-renderer.test.ts | 5dcbb3b109ab0b8b53fe2f2929d713f184688a8503a1fce3a83c15aedce8fc22 | surfaces |
| tests/runtime-route-catalog-guards-kit.ts | 566678025ce1bba1cc05bf5ec6bb078a72288e1b885b245684dc8f7d00e4524b | public-guards |
| tests/runtime-route-catalog-public-contract.test.ts | a81a04450141da6dfaafa28a795d839360616ab9184972b90ad66a367b5f1548 | public-guards |
| tests/runtime-route-catalog-discovery.test.ts | e187f6f89ca64cd5a6df19fde4ae163331cab6e10362c40972b0472be7e53625 | public-guards |
| tests/runtime-route-catalog-guards.test.ts | 15ae182fdd6d3fed05afbcf895827ea5ad283a0288a6173c5db013fd8836296c | public-guards |
| tests/fixtures/runtime-route-catalog/catalog.json (S01, S02, S33) | 3afbf419350ba38cb5ce98f9fa714dbd2703e080f99cfcadb433a3ad9a8e385c | catalog-core |
| tests/fixtures/runtime-route-catalog/routes.json (S03, S04, S31, S41, S42, S43, S49) | d91f0efc35032185fc0b4efc623965b83ab737459c8ea00f08712cb2c1316f6d | catalog-core |
| tests/fixtures/runtime-route-catalog/policy.json (S05, S08, S40, S44, S45) | ddcd4b809c8755e313518f4e71569b59fda639c273184a6503552107f21df7e4 | catalog-core |
| tests/fixtures/runtime-route-catalog/refusals.json (S06, S46) | 84948d7c791eddb4f30da9e341c8ab0242b3294c0006f0bfe1a335b1c72f5582 | catalog-core |
| tests/fixtures/runtime-route-catalog/provider.json (S32) | f3c774780f07251f931cc7f7d8e30c4e6bd6b85a3dbe38a0efe020ca90c49ed9 | catalog-core |
| tests/fixtures/runtime-route-catalog/completion.json (S09) | 496a343eea2c9e582a43c01816d4c2348967b5bfdd26103f2f0b479877d250e1 | catalog-core |
| tests/fixtures/runtime-route-catalog/capabilities.json (S10, S12, S34–S39, S47, S51, S52) | 4603ffb33033abb1ca326fa80d71847a4e0d61cc42f134b3328092cf9502eb06 | capabilities |
| tests/fixtures/runtime-route-catalog/readiness.json (S11 only; S23 must be merged in, see P1-2) | 7d5d6fe564e855f7da44e9cbdf613911e89220185accda2c92e5c131c5704bf0 | capabilities |
| tests/fixtures/runtime-route-catalog/extensions.json (S13) | a00b70e959554a86430cc793c458a47ed757512b1945e61b46154862be290cef | capabilities |
| tests/fixtures/runtime-route-catalog/headless.json (S14, S15) | f9011db5da94588d0d1ef66db12617dd9f8dbb07570ae7c130755164305e7b63 | surfaces |
| tests/fixtures/runtime-route-catalog/executor.json (S16, S17) | 2c1fda58aff53af1b7bdfa89e69f15f6616501684001d81e7f9e78472f9308f7 | surfaces |
| tests/fixtures/runtime-route-catalog/renderer.json (S07, S18, S19, S53) | a71e0dc6e7de046a36ff2e1f9aa5cdbfe7f4e60a1f860df9e893a06b5af0825f | surfaces |
| tests/fixtures/runtime-route-catalog/desktop-actions.json (S20) | b0984f3ae5142373732cd36129dcaa3d9042b63c21cb99384afb18515dea0063 | surfaces |
| tests/fixtures/runtime-route-catalog/public-contract.json (S21) | 66fdb337a048dc91c51b418eb7e0b07ecd6ac23640faddbd730fe5e241a1b680 | public-guards |
| tests/fixtures/runtime-route-catalog/errors.json (S24) | d9859fb840afd3fccf5950e63d612242736a59f69ee18bfc7f424c7e20144477 | public-guards |
| tests/fixtures/runtime-route-catalog/artifacts.json (S25) | 81d2c288db26b1e7dabcdfea70c09ecdba552b54de05f279962909c0f4a3868b | public-guards |
| tests/fixtures/runtime-route-catalog/discovery.json (S22) | 86a781c5637c1c688a0c7a72d6af9d886728cc766afb14bedad5a2239afe2418 | public-guards |
| tests/fixtures/runtime-route-catalog/readiness.public-guards.json (S23 side file; to be merged and deleted, P1-2) | ef1a4369b8d3b43ea0619dc51a4302f7c85c88139ebcac3b3a2933171192e498 | public-guards |
| tests/fixtures/runtime-route-catalog/architecture-fixtures.json (S26–S30, S48, S50; 77 cases) | 2384885720baac8cebac252dfbb948bcc3fb8287ef6761dcdf2b87a94dfbeb43 | public-guards |
| tests/fixtures/runtime-route-catalog/discovery-schema-before.json (S22 supporting; byte-identical to `6192b13f:docs/local-job-api-v1.schema.json`, verified) | 5953fe859f011ae56148b8b396417c810098e3ade610cec1d610efe2b80e3ed9 | public-guards |
| tests/fixtures/runtime-route-catalog/discovery-reader-before.ts (S22 supporting; neutral old reader) | 53ef10a76c09f4e68133275dfcf6382550421a9f87442f66800abe736788382b | public-guards |

Checks on this list: every scenario fixture carries the `{fixtureVersion:1, evidenceClass:"synthetic", sourceRefs, provenance}` header and only `Sxx` top-level keys; the two supporting files are not scenario fixtures and correctly carry no header. No fixture or test contains an absolute checkout path (the only `agent-code-for-me` hit is the GitHub `$id` URL inside the frozen base schema, byte-identical to base). `git status` shows no tracked modification; nothing under `src/` was created or changed. The fixture layout is flat and every spec GIVEN key loads, with one deviation (S23, P1-2).

## 2. Per-file counts on 19986552

Command per file: `bun test --isolate <file>` (logs in the session scratchpad). Combined: `bun test --isolate tests/runtime-route-catalog-*.test.ts` → **77 tests across 11 files, 69 fail, 8 pass, 76 expect() calls, 57.44 s, exit 1** (identical to the per-file sums).

| File | Tests | Red | Green-by-design | expect() calls | Wall time | Author count reconciled |
| --- | --- | --- | --- | --- | --- | --- |
| tests/runtime-route-catalog-query.test.ts | 8 | 8 | 0 | 9 | 0.12 s | yes |
| tests/runtime-route-catalog-routes.test.ts | 17 | 15 | 2 | 22 | 9.18 s | yes |
| tests/runtime-route-catalog-provider.test.ts | 2 | 2 | 0 | 2 | 0.15 s | yes |
| tests/runtime-route-catalog-completion.test.ts | 1 | 1 | 0 | 1 | 0.14 s | yes |
| tests/runtime-route-catalog-capabilities.test.ts | 13 | 13 | 0 | 13 | 0.30 s | yes |
| tests/runtime-route-catalog-headless.test.ts | 4 | 2 | 2 | 4 | 0.92 s | yes |
| tests/runtime-route-catalog-executor.test.ts | 4 | 4 | 0 | 4 | 0.36 s | yes |
| tests/runtime-route-catalog-renderer.test.ts | 12 | 8 | 4 | 12 | 28.68 s | yes |
| tests/runtime-route-catalog-public-contract.test.ts | 6 | 6 | 0 | 0 (all six fail by an uncaught import rejection, see P2-2) | 0.23 s | yes |
| tests/runtime-route-catalog-discovery.test.ts | 2 | 2 | 0 | 2 | 0.57 s | yes |
| tests/runtime-route-catalog-guards.test.ts | 8 | 8 | 0 | 7 (S30 integration leg fails by an uncaught import rejection) | 18.19 s | yes |
| **Total** | **77** | **69** | **8** | 76 | ~59 s | catalog-core 28/26/2, capabilities 13/13/0, surfaces 20/14/6, public-guards 16/16/0 |

Convention checks (all files): titles begin with exactly one `Sxx` and the text after it equals the spec scenario title for all 77 tests (living titles S14/S15/S33–S52 matched through their register comments); no `.skip/.only/.todo`; no `try/catch` in any test or kit; no `any`; `biome check` on all 36 files: 0 diagnostics, exit 0 (no `noExplicitAny`); NEW seams (`runtime-route-catalog`, `runtime-route-transport`, `runtime-route-read-model`, `codex/desktop-chat-run`) are imported only lazily inside tests/kits; temp dirs/DBs are per test (`mkdtempSync` in routes/surfaces/guards kits, `createMigratedLedgerDb` per test elsewhere, in-memory ledger DBs in capabilities); no `process.env` mutation or `HOME` read. Deterministic clock: `setSystemTime(2026-10-02T00:00:00.000Z)` per test in query/routes/provider/completion/public-contract/discovery/guards; capabilities drives the 30 000 ms readiness cache through an injected `now`; headless/executor/renderer deliberately use the real clock (see P3-8). Collect-then-expect: every red except the seven noted in P2-2 fails inside one collected `expect`.

## 3. Per-test red reasons (69 red tests)

Categories: **CA** = contract absence (the test's lazy import of a NEW seam fails; the oracle itself was shown satisfiable by the author's throwaway toy module, and the behavioral assertions are only reachable once the seam exists); **CA+BG** = the seam is missing and, with a toy seam, an existing entry point still misbehaves on base (recorded by the author and consistent with base code); **BG** = real behavior gap observed through existing entry points on base (confirmed from the run logs).

### tests/runtime-route-catalog-query.test.ts (8 red)
| # | Sxx | Red | Failing assertion on base |
| --- | --- | --- | --- |
| 1 | S01 validator verdicts (production/valid/completion-null-probe + 10 invalid variants; test constructor returns the validator's failure state; zero factory/probe calls) | CA | `{catalogModuleImportError: null}` ← `Cannot find module …/src/main/lib/agent-runtime/runtime-route-catalog.ts` |
| 2 | S01 failure state: resolve→catalog_invalid; list/projection reject; envelope and both `api runtimes list --json [--no-probe]` reject with exactly "Runtime route catalog is unavailable." and empty stdout | CA | same |
| 3 | S01 `run` with failure state settles failed/runtime_error/exit 1 with the sanitized message | CA | same |
| 4 | S01 both desktop hosts given the failure state surface only the sanitized message; no delegate/native SDK call (also needs NEW `runCodexDesktopChatRun`) | CA | same |
| 5 | S02 permuted tables / duplicate capabilities / stable routeId order / inert mutation / zero calls | CA | same |
| 6 | S06 overlap only at validation; unknown/retired/missing-entry/illegal → route_not_found; positive controls | CA | same |
| 7 | S33 production table validates; per-runtime metadata; duplicate rejected; renderer projection exact keys | CA | same |
| 8 | S46 public parsers keep "Unsupported runtime.id"/"Unsupported --runtime" exit 3 (baseline legs run first); internal query route_not_found | CA | same |

### tests/runtime-route-catalog-routes.test.ts (15 red, 2 green)
| # | Sxx | Red | Failing assertion on base |
| --- | --- | --- | --- |
| 9 | S03 Claude host after real admission invokes only the catalog SDK delegate once | CA | `{catalogModuleImportError: null}` |
| 10 | S03 Codex host (NEW `runCodexDesktopChatRun`) after real admission invokes only the app-server delegate once | CA | same |
| 11 | S03 source guards (codex.ts/claude.ts/agent-sdk-runtime-lifecycle.ts) | **BG** | findings must be `[]`; base yields 5: `codexRouter: value-imports runCodexAppServerDesktopAdapter`, `… value-imports app-server-adapter-runner`, `… does not import ../../codex/desktop-chat-run`, `… runCodexDesktopChatRun( is not called after admitCodexChatSessionBindingRun(`, `claudeLifecycle: value-imports runClaudeAgentSdkDesktopAdapterWithPreparedRuntimeQuery` |
| 12 | S03 codex.getRuntimeStatus adapters.selection + hint bytes | green-by-design | — |
| 13 | S04 10 entry/source pairs × 2 modes → batch source, headless-exec, identical delegate, probes uninvoked | CA | `{catalogModuleImportError: null}` |
| 14 | S05 direct Codex app-server leaf invalid inputs keep baseline codes, zero createDesktopAdapter | green-by-design | — |
| 15 | S05 resolver: valid Codex grant → headless-app-server/admission-audit-only; 12 refusal variants; refusal order | CA | `{catalogModuleImportError: null}` |
| 16 | S08 fallbackReason:null in diagnostic + public payload; interactive_channel_required kept; retired selector unimportable; no prefer* export | CA+BG | import failure first; with a toy catalog still red because `src/main/lib/headless/adapter-selector.ts` is importable on base |
| 17 | S08 guard leg: `--runtime-route-catalog-fixtures` with an obsolete-option case must report a D5 mismatch naming retired-route-selector/preferredAdapterSource and exit 1 | **BG** | observed `exitCode: 0`, `mismatchLineFound: false`, `mentionsOwnerSection: false` (flag unknown on base) |
| 18 | S31 runCodexDesktopChatRun invokes only the failing app-server delegate; result unchanged; exec never invoked; no ledger call; no host terminal | CA | `{catalogModuleImportError: null}` |
| 19 | S40 Codex grant → admission-audit-only exact runtime_selected; Claude grant and guarded scope → exact refused payloads | CA | same |
| 20 | S41 claude alias normalized; Claude batch delegate (real argv builder + process runner over fake spawn) via runAgentTask catalog option | CA | same |
| 21 | S42 Codex batch runner with injected process I/O via runAgentTask catalog option | CA | same |
| 22 | S43 headless/API defaults → batch; gateway sentinel absent; rich delegates/probes untouched | CA | same |
| 23 | S44 interactive callbacks without channel fail closed with exact refused payload; no delegate; prompt never echoed | CA | same |
| 24 | S45 exact runtime_selected/refused key sets; smuggled preference inert; sandbox-level evidence | CA | same |
| 25 | S49 committed ledger rows = baseline (redaction mask, order); CLI-projected events = committed rows; no raw secret; Codex desktop host makes no ledger call | CA | same |

### tests/runtime-route-catalog-provider.test.ts (2 red)
| 26 | S32 owner precedence + host sequence default→gateway→invoke→revoke for 7 cases × 2 runtimes | CA | `{catalogModuleImportError: null}` |
| 27 | S32 no sentinel/function values in descriptors/projections/resolutions; zero provider-storage reads | CA | same |

### tests/runtime-route-catalog-completion.test.ts (1 red)
| 28 | S09 API create for both families: one upstream call, locus-completion provenance, no agent delegate/spawn/run dir; invalid variants keep exit 2 (API legs baseline-green); catalog completion metadata contrasted with batch and desktop route_not_found | CA | `{catalogModuleImportError: null}` |

### tests/runtime-route-catalog-capabilities.test.ts (13 red)
All fail at `expect(loadState).toBe("runtime-route-catalog loaded")` ← `Cannot find module …/runtime-route-catalog.ts` (`requireCatalog()` lazy import inside each test).
| # | Sxx | Red | Note |
| --- | --- | --- | --- |
| 29 | S10 | CA+BG | after the seam exists, `toLocalJobApiRuntimeManifestEnvelope` must honor the `runtimeRouteCatalog` option for manifests; base ignores it (author shim run) |
| 30 | S11 | CA | 8 readiness cases byte-exact from base; 30 000 ms cache shared across routes; missing route/null probe → unknown |
| 31 | S12 | CA | exact desktop route view; projection owner registered/unregistered |
| 32 | S13 | CA | valid table ok; 7 malformed → catalog_invalid; unknown required → unsupported_required_extension, zero factory calls; producer agreement |
| 33 | S34 | CA | basic ok + 4 optional refusals with canonical messages |
| 34 | S35 | CA | renderer/public exact keys; DTO/CLI/main states |
| 35 | S36 | CA | conformance through real canUseTool / app-server bridge |
| 36 | S37 | CA | allow/deny/rewrite and guard events through actual ports |
| 37 | S38 | CA+BG | envelope option gap as S10 |
| 38 | S39 | CA | Codex rollback unsupported on 3 surfaces; capability_refused without delegate |
| 39 | S47 | CA | 5 cases × 2 union orders match base-selector bytes |
| 40 | S51 | CA | 15-row Codex state table across resolution/discovery/gate |
| 41 | S52 | CA | positive conformance through the bridge; 4 non-enforcing variants × 2 capabilities fail with enforcing-port-uncalled |

### tests/runtime-route-catalog-headless.test.ts (2 red, 2 green)
| 42 | S14 baseline argv/stdin/source/cancel/runtime_selected across 5 hosts × 2 runtimes | green-by-design | — |
| 43 | S14 every host forwards runtimeRouteCatalog: one post-binding lookup, one delegate call, no rich lookup | CA+BG | `expect("test catalog built")` ← module missing; with a toy module hosts ignore the option (`invocations: []`, `postBindingLookups: 0`) |
| 44 | S15 baseline runAgentTask selected/refused payloads | green-by-design | — |
| 45 | S15 runAgentTask(request, observer, {runtimeRouteCatalog}) invokes only the batch delegate; refusals call no delegate/rich lookup/native leaf | CA+BG | module missing; with a toy module the old selector still spawns the real leaf (`nativeLeafStarts: 1`) |

### tests/runtime-route-catalog-executor.test.ts (4 red)
| 46 | S16 two pumps on separate connections; winner timeline attempt→claimed→provider→lookup→invoke; loser attempt only; completion runner never touches the catalog; order/exclusions; no catalog rows | CA+BG | module missing; toy module: winner segments lack lookup/invoke, `nativeLeafStarts: 3` |
| 47 | S17 keyed submit replay → single lookup and invocation | CA+BG | module missing; toy module: `lookups: []`, `invocations: []` |
| 48 | S17 own-ID create wrapper forwards catalog; foreign Runs untouched | CA+BG | module missing; toy: `invocations: []`, `nativeLeafStarts: 1` |
| 49 | S17 jobs-stdio session acks before execution; protocol worker prefix; competing pump never looks up the catalog | CA+BG | module missing; toy: `ackSeenAtInvoke: []`, `sessionInvocations: []` |

### tests/runtime-route-catalog-renderer.test.ts (8 red, 4 green)
| 50 | S07 real claude.chat on a durable Codex subChat → rejectStaleRunPayload message/hint; zero host/secret/provider/credential calls | green-by-design | — |
| 51 | S07 strict chat inputs refuse routeId/transportId; neither transport sends them | green-by-design | — |
| 52 | S18 createRuntimeRouteTransport ok/unavailable/error/unknown_transport, zero constructor calls, retry | CA | `expect("helper loaded")` ← `Cannot find module ../src/renderer/features/agents/lib/runtime-route-transport` |
| 53 | S18 renderer-route-projection-bypass: repository + clean two-site fixture pass; 3 mutations reported | **BG** | repository summary null (no section), clean summary null, each mutation exits 0 with no mismatch line |
| 54 | S19 isolated catalog resolves fixture delegate; renderer projection exact keys; helper builds existing wire; production projection two runtimes | CA | `expect("test catalog built")` ← module missing |
| 55 | S19 event-state owner atom transitions | green-by-design | — |
| 56 | S19 guard flags a runtime branch in the helper | **BG** | as #53 |
| 57 | S20 cancel/retry exact owners and envelopes | green-by-design | — |
| 58 | S53 real getSubChat/createSubChat return binding.transportId = production renderer projection; no DB column | **BG**+CA | `transportId: null` for both runtimes (real gap); projection = module-missing message |
| 59 | S53 chats.get stamps each sub-chat binding (extra test, see P2-3) | **BG** | `{"s53-claude-sub": null, "s53-codex-sub": null}` |
| 60 | S53 withRuntimeRouteTransportId copies/omits for failure state; never mutates input | CA | `expect("modules loaded")` ← `Cannot find module ../src/main/lib/agent-runtime/runtime-route-read-model` |
| 61 | S53 guard flags a main-side runtimeId→transportId literal map | **BG** | as #53 |

### tests/runtime-route-catalog-public-contract.test.ts (6 red)
All six fail by an uncaught rejection `Cannot find module …/runtime-route-catalog.ts from tests/runtime-route-catalog-guards-kit.ts` raised by `productionCatalogState()`/`failureCatalogState()` inside the test body before any `expect` (P2-2).
| 62 | S21 agent create/submit/replay/conflict/wait/status/events/result/retry/cancel + claude-policy-grant/fail-closed/codex grant through `runtimeRouteCatalog`; failure-state control | CA |
| 63 | S21 completion contract (4 upstream calls, 0 agent leaf calls) | CA |
| 64 | S21 runAgentTask third-argument internal refusal/selected/refused exact key sets | CA |
| 65 | S24 surface refusal goldens (admission 3, parser 3, provider 2, grant/fail-closed 1, wait-only 9, claim gate, run/schedule regex, jobs-stdio -32700/-32601/-32602, adapter-local 1 vs normalized 3) | CA |
| 66 | S24 injected RuntimeRouteCatalogFailureState → runtime_error/1 "Runtime route catalog is unavailable.", 0 leaf calls; `runtimes list` rejects with empty stdout | CA |
| 67 | S25 win32 artifact_admission_failed (2) and incomplete publication non-ready (9) | CA |

### tests/runtime-route-catalog-discovery.test.ts (2 red)
| 68 | S22 routes present, both schemas accept, old reader unchanged, exact keys, leaks rejected, schemaRef resolves, producer and resolver agreement | **BG**+CA | `routesPresent {claude-code:false, codex:false}`, `summaries null`, `schemaRefResolution []`, `leakVerdicts.after true`, `vocabularyVerdicts true`; `catalogAgreement` = module missing |
| 69 | S23 no native probe, baseline readiness bytes, env-free route metadata, no persisted env sentinel | **BG**+CA | `routesPresent: false`; `catalogMetadata` = module missing (fidelity sub-assertions already hold) |

### tests/runtime-route-catalog-guards.test.ts (8 red)
Shared observation for 70–74, 76, 77: canonical run lacks `Runtime route catalog guard self-test: 77/77 …` (`canonicalSummary: false`); mutated fixture run exits 0 with 0 case lines (expected exit 1, `63/77`, 14 case lines); flag ignored on base.
| 70 | S26 | **BG** | shared observation |
| 71 | S27 | **BG** | shared + `retiredModulesPresent: [headless/adapter-selector.ts, agent-runtime/runtime-registry.ts]`, retired symbols in 7 src files, `activeChatHelperCalls: 0` (expected 2), direct transport construction present |
| 72 | S28 | **BG** | shared observation |
| 73 | S29 | **BG** | shared observation |
| 74 | S30 guard + production catalog scan | **BG** | shared + `productionCatalogExists: false` |
| 75 | S30 real API create and jobs-stdio job.run reach submitRun/pumpQueuedRuns with one leaf call per Run | CA | uncaught `Cannot find module …/runtime-route-catalog.ts` before any expect (P2-2) |
| 76 | S48 | **BG** | shared + OWNERSHIP_MAP lacks `## Runtime Route Catalog Single Owner`, still has `## Headless Runtime Adapter Selection` / adapter-selector owner line |
| 77 | S50 | **BG** | shared + retired modules/symbols present |

Totals: CA 44, CA+BG 12, BG 13 = 69. Every BG red fails on the asserted behavior (verified in the logs quoted above), not on a missing file or an unconditional throw. Every CA red fails at a lazy import of a NEW design-D1/D2/D3 seam inside the test body, with the "Enforces once … exists" comment present in the kit.

## 4. Green-by-design and registered-existing

Green-by-design characterizations (8; each pins a baseline the implementation must not move):
1. routes #12 S03 `codex.getRuntimeStatus` adapters.selection and adapter-source hint bytes (P30 baseline).
2. routes #14 S05 direct `createCodexAppServerHeadlessTaskRunner({createDesktopAdapter: recording})` invalid inputs keep `unsupported_runtime` / `unsupported_execution_profile` / `permission_policy_fail_closed` with zero adapter construction (retained P05 assertion).
3. headless #42 S14 baseline argv/stdin/source/cancel port and `runtime_selected` payload across CLI, daemon, schedule, protocol and API for both runtimes.
4. headless #44 S15 baseline `runAgentTask` selected/refused payloads (interactive-only fails closed through `no_interaction_channel`/`permission_policy_fail_closed` without a visible channel, `interactive_channel_required` with one).
5. renderer #50 S07 real `claude.chat` on a durable Codex subChat emits the original `rejectStaleRunPayload` message/hint; zero host/secret/provider/credential calls; binding unchanged.
6. renderer #51 S07 strict chat inputs refuse routeId/transportId; neither renderer transport sends them.
7. renderer #55 S19 event-state owner question/guard/finish atom transitions.
8. renderer #57 S20 cancel/retry exact ownership and baseline envelopes; owner sources reference no catalog.

Registered-existing (supporting evidence, not duplicated; all exist on base and pass there):
- S14: `tests/headless-runtime-adapters.test.ts` — "Claude adapter uses non-interactive print mode and plan permissions", "headless adapters place dash-prefixed prompts after end-of-options", "Claude adapter uses acceptEdits for basic agent runs".
- S16: `tests/local-job-api-async-executor.test.ts` — the two S28 daemon/pump race tests.
- S17: `tests/local-job-api-async-idempotency.test.ts` S08; `tests/local-job-api-async-submit-wait.test.ts` S34 (two tests); `tests/local-job-api-async-guards-protocol.test.ts` S29, S30, S32 (two).
- S11: `tests/runtime-readiness.test.ts` — thirty-second cache, broken default provider, no-probe, probe failure → unknown.
- S36/S37: `tests/claude-agent-sdk-tool-permission.test.ts` (three tests) and `tests/codex-app-server-approval.test.ts` (three tests).
- S35/S39/S51: `tests/agent-runtime-capabilities.test.ts` (three tests) and `tests/codex-runtime-capabilities.test.ts` (two tests).
- S33 and S40–S46 deliberately register no existing test: `tests/agent-runtime-registry.test.ts:12-70` and `tests/headless-adapter-selector.test.ts` exercise the facade/selector that design D5 retires; the red suite re-homes those oracles (byte-identical codes/messages copied from the base selector and leaf).

## 5. Coverage matrix S01–S53

Status: covered / partial (sub-clause gap named) / covered+registered-existing / characterization (green-by-design). No scenario is missing a test.

| ID | Tests (file#) | Status | Notes |
| --- | --- | --- | --- |
| S01 | query 1–4 | covered | production CLI mapping (`index.ts:435–437`) is explicitly not the bun entry → implementer-unit/smoke (§6) |
| S02 | query 5 | covered | |
| S03 | routes 9–12 | **partial** | admission-blocked variants only; no agent-runtime preflight-blocked variant (§6) |
| S04 | routes 13 | covered | |
| S05 | routes 14–15 | covered | |
| S06 | query 6 | covered | positive controls prevent route_not_found from swallowing policy refusals |
| S07 | renderer 50–51 | characterization | admission precedes any catalog seam by design |
| S08 | routes 16–17 | covered | guard leg uses a one-key (S27) fixture file (P2-1) |
| S09 | completion 28 | covered | base completion row stores `mode="agent"` (DB default); test asserts only that catalog completion metadata has no mode/installation — reading accepted |
| S10 | capabilities 29 | covered | envelope option is a real gap behind the seam |
| S11 | capabilities 30 | covered+registered-existing | |
| S12 | capabilities 31 | covered | "not guessed" half is an absence check tightened by exact route view and 0 adapter calls |
| S13 | capabilities 32 | covered | reader half is effectively green-by-design (old reader ignores `routes`); producer agreement static |
| S14 | headless 42–43 | covered+registered-existing | |
| S15 | headless 44–45 | covered | |
| S16 | executor 46 | covered+registered-existing | |
| S17 | executor 47–49 | covered+registered-existing | competing claimant starts after the session claim (lists nothing); the true race is S16 |
| S18 | renderer 52–53 | covered | |
| S19 | renderer 54–56 | covered | existing-wire-family consumption only, as the spec limits |
| S20 | renderer 57 | characterization | |
| S21 | public-contract 62–64 | covered | fidelity legs not demonstrated green on base (P2-2) |
| S22 | discovery 68 | covered | producer agreement checked statically (ledger literals + schema consts); no runtime.codex.v1 event emitted |
| S23 | discovery 69 | **partial** | process-level daemon/wrapper environment separation not observable in-process (TICKET-130 residual, §6); fixture in side file (P1-2) |
| S24 | public-contract 65–66 (+ query 4 for the desktop leg) | **partial** | desktop catalog-failure leg is covered by query #4 (S01), not by the S24 tests; null-returning agent-factory reference lookup variant not covered (§6) |
| S25 | public-contract 67 | covered | |
| S26 | guards 70 | covered | "no arbitrary reflection" clause governance-only |
| S27 | guards 71 | covered | |
| S28 | guards 72 | covered | |
| S29 | guards 73 | **partial** | "existing owner guards scan these fixtures" not exercised (ledger/async guards cannot consume route fixtures) |
| S30 | guards 74–75 | covered | integration leg reuses public-contract.json#S21.requests (P3-7) |
| S31 | routes 18 | covered | |
| S32 | provider 26–27 | covered | |
| S33 | query 7 | covered | "application starts" realized as `validateRuntimeRouteCatalog()` on the production table (Electron main not reachable in bun) |
| S34 | capabilities 33 | **partial** | "recording optional-feature ports remain uncalled" has no design seam; S02's zero-call purity oracle stands in |
| S35 | capabilities 34 | covered+registered-existing | |
| S36 | capabilities 35 | covered+registered-existing | governance clause not test-registered |
| S37 | capabilities 36 | covered+registered-existing | |
| S38 | capabilities 37 | **partial** | renderer-facing DTO (`agentRuntimeRouter.listManifests`) reads the shared owner directly (P22 B) and cannot be injected; discovery/CLI envelope and the catalog gate are checked instead |
| S39 | capabilities 38 | covered+registered-existing | governance clause not test-registered |
| S40 | routes 19 | covered | |
| S41 | routes 20 | covered | |
| S42 | routes 21 | covered | |
| S43 | routes 22 | covered | |
| S44 | routes 23 | covered | |
| S45 | routes 24 | covered | |
| S46 | query 8 | covered | |
| S47 | capabilities 39 | covered | |
| S48 | guards 76 | covered | |
| S49 | routes 25 | covered | correlation keys bound from committed rows and format-checked (`^corr-[0-9a-f]{20}$`); observationKey is ledger-internal |
| S50 | guards 77 | covered | governance clause not test-registered |
| S51 | capabilities 40 | covered+registered-existing | |
| S52 | capabilities 41 | covered | variant half is kit-evaluated (variants never call the recording port) |
| S53 | renderer 58–61 | covered (+1 extra test) | renderer #59 (chats.get) is beyond the spec's two named sites, pending adjudication (P2-3) |

Summary: 53 scenarios; 47 covered (12 of them characterization or covered+registered-existing), 6 partial (S03, S23, S24, S29, S34, S38), 0 missing.

## 6. Uncovered sub-clauses and implementer-unit assignments

| Item | Scenario | Assignment | Oracle the implementer's unit test must pin |
| --- | --- | --- | --- |
| Preflight-blocked desktop variant (spec GIVEN "blocked admission/preflight variants") | S03 | implementer-unit (`tests/agent-runtime-preflight.test.ts` keeps preflight ordering per D5; add a case asserting that a preflight-blocked Claude/Codex run calls no catalog delegate/provider/secret reader) | zero delegate/provider/secret calls; existing preflight message unchanged |
| Null-returning agent-factory reference lookup (validated test catalog; valid delegate at validation, `null` at post-binding lookup) | S24 | implementer-unit (the core kit's `lookupAgentFactory(ref)` port is the seam; a recording port that flips to null after `createRuntimeRouteCatalogForTests` returns) | API create settles `runtime_error`/exit 1 with exactly "Runtime route catalog is unavailable." through `job-runner.ts:820–836`; zero leaf calls; never `internal_error`/8; no frozen-table mutation |
| Desktop catalog-failure leg of S24 | S24 | already covered by query #4 (S01) — cross-reference only | both named hosts emit only the sanitized message through the existing error/finish channel |
| Production CLI mapping of an initialization failure (`[Headless] Failed:` stderr, exit 1, no stdout) | S01 | manual smoke §8.3 / implementer-unit on `src/main/index.ts:435–437` if a seam exists | not reachable from bun |
| Process-level submitter/daemon/wrapper environment separation | S23 | manual smoke §8.3 (child-process harness; TICKET-130 residual) | no env snapshot persisted; daemon uses its own permitted environment |
| "Recording optional-feature ports remain uncalled" | S34 | none required — no design seam; S02 purity oracle covers factory/probe/provider/spawn = 0 | — |
| Renderer-facing DTO for degraded/unsupported `hardToolGuard` | S38 | none in this slice — real manifests mark it supported and the DTO reads the shared owner directly (P22 B); record as spec limitation | — |
| Existing owner guards scanning route fixtures | S29 | none — ledger/async guards have their own fixture flags; the new section is exercised | — |
| Governance-only clauses (S26 reflection, S36/S39/S50/S51 checklist clauses) | — | not test-registered by the spec | — |

## 7. Findings

P1 = must fix before the RED-suite commit; P2/P3 = record (dispositions given).

### P1-1 — Two incompatible declaration/reference-port shapes for the same `validateRuntimeRouteCatalog(declarations, references)` API
- Where: `tests/runtime-route-catalog-core-kit.ts:348–447` with `catalog.json#S01.declarations/ports` (also loaded by `tests/runtime-route-catalog-surfaces-kit.ts:301–575`) versus `tests/runtime-route-catalog-capabilities-kit.ts:255–295` with `extensions.json#S13.declarationTable/references`; consumers `tests/runtime-route-catalog-capabilities.test.ts:518` (S10), `:823–865` (S13), `:1410` (S38).
- Finding: core/surfaces declare routes with `factoryRef`, `readinessProbeRef`, `enforcementEvidenceRef` plus the declared level `enforcementEvidence`, runtime-level `manifestRef/cancellation/sessionReference`, and references `{normalizeRuntimeId, getManifest(ref), lookupAgentFactory(ref), lookupReadinessProbe(ref), lookupEnforcementEvidence(ref)}`. Capabilities declares routes with `factory`, `readinessProbe`, `enforcementEvidence` as map keys, no runtime-level manifest/cancellation/session fields, and references `{getAgentRuntimeCapabilityManifest(runtimeId), normalizeRuntimeId, agentFactories{}, readinessProbes{}, enforcementEvidence{}}`. One implementation cannot satisfy both; tasks 2.2 promised a single frozen shape to the authors and it was never delivered.
- Disposition: coordinator adjudicates one shape and records the test-adjudication SHA (tasks 6.8). Recommended: adopt the core shape (used by three of four domains; public-guards is shape-agnostic) and relink only the capabilities kit, `extensions.json#S13` (rename keys, add `manifestRef/cancellation/sessionReference`, add the declared `enforcementEvidence` level next to `enforcementEvidenceRef`) and the S10/S38 partial references (`getAgentRuntimeCapabilityManifest` → `getManifest`, whose production port resolves a manifestRef alias through `resolveAgentRuntimeCapabilityManifest`). Re-run `capabilities.test.ts` (must remain 13 red at the import) and recompute the two hashes.

### P1-2 — S23 fixture lives in a side file that does not match its GIVEN clause
- Where: `tests/fixtures/runtime-route-catalog/readiness.public-guards.json`; `tests/runtime-route-catalog-discovery.test.ts` `fixtureKey("readiness.public-guards.json", "S23")`. Spec GIVEN and tasks §7: `readiness.json#S23`.
- Disposition: coordinator merges the `S23` key into `readiness.json` (keeping the existing header and `S11`), relinks the `fixtureKey` call to `"readiness.json"`, deletes the side file, re-runs `discovery.test.ts` (must remain 2 red) and recomputes both hashes.

### P1-3 — Retired-runtime residue guard fails on `refusals.json`; the tasks 6.1 ALLOWED entry is missing
- Where: `scripts/check-retired-runtime-residue.mjs` ALLOWED map; hits at `tests/fixtures/runtime-route-catalog/refusals.json:25,202,203`. Verified: `node scripts/check-retired-runtime-residue.mjs` exits 1 on the current tree.
- Disposition: in the same RED-suite commit add `["tests/fixtures/runtime-route-catalog/refusals.json", "S06/S46 retired-ID refusal fixtures"]` (design D5 / tasks 4.6 and 6.1; the registry-test entry stays until the implementation rename). No other suite file mentions a retired runtime id. This is a coordinator action, not author rework.

### P2-1 — Guard fixture-file keys used by the tests go beyond design D5's seven top-level keys
- Where: `tests/runtime-route-catalog-surfaces-kit.ts:1003 guardFixture(scenario, cases)` writes temp fixture files keyed `S18`, `S19`, `S53` (renderer #53, #56, #61); `tests/runtime-route-catalog-routes.test.ts:832–854` writes a file holding only `S27` (routes #17). D5 fixes the file layout as top-level `S26–S30/S48/S50` and says an illegal fixture exits 1. The guards kit (`GUARD_SCENARIOS`, `totalCaseCount`) only sums those seven keys for the canonical file and asserts nothing about unknown keys, so there is no inter-author test conflict, but a D5-literal guard that rejects unknown keys would leave three surfaces tests permanently red.
- Disposition: record an adjudication for the implementer (recommended): the guard accepts any non-empty set of top-level keys matching `/^S\d\d$/`, each `{cases:[…]}` in the D5 case shape; the summary counts all cases present; a one-key file is legal. Alternative: re-key the surfaces temp cases to `S27` (mutations) / `S29` (clean) in `renderer.json` and the kit.

### P2-2 — `public-contract.test.ts` (6 tests) and `guards.test.ts` S30 #75 fail by an uncaught import rejection rather than a collected `expect`; S21/S24/S25 golden fidelity legs are not demonstrated green on base
- Where: `tests/runtime-route-catalog-guards-kit.ts:160–182 loadCatalogModule/productionCatalogState/failureCatalogState`.
- Finding: the red is conditional and explainable (the lazy import of the NEW seam rejects), so it is not an unconditional throw, but the base run reaches no assertion, so the suite itself cannot show that the recorded 6192b13f goldens reproduce on base (the author's scratch re-render is not in the repo). Other domains split a green-by-design baseline leg for this purpose (S14/S15/S46).
- Disposition: record. Optional hardening (author or coordinator, not required for commit): wrap the module load in a settled result and `expect` it, so the failing assertion names the seam like the other kits. During implementation, a mismatch against these three fixtures is to be adjudicated against a fresh base run before it is treated as an implementation defect.

### P2-3 — S53 renderer #59 (`chats.get` stamping) exceeds the spec's two named composition sites and needs adjudication
- Where: `tests/runtime-route-catalog-renderer.test.ts:1081`; spec/design name `chats-sub-chats.ts:107` (getSubChat) and `:116` (createSubChat).
- Finding: the renderer construction site reads its binding from `agentSubChatsRef` (`active-chat.tsx:5852–5866`, `:6007–6054`), which is populated by `chats.get` (`chats-crud.ts:96 attachBindingsToSubChats`), so without stamping that read model the D3 renderer path would always map to not-loaded. The extra test is therefore in the spirit of D3 but not in its letter.
- Disposition: coordinator adjudicates; recommended KEEP, with the implementer note that `withRuntimeRouteTransportId` must be applied to all three binding read-model compositions (getSubChat, createSubChat, chats.get via `attachBindingsToSubChats`), never persisted, and that the guard's clean cases must accept the third call site.

### P2-4 — Desktop-route evidence and desktop query policy differ across authors (no direct test contradiction; implementer must know)
- Where: core test table `catalog.json#S01` models `codex.desktop.app-server` with `enforcementEvidence: "admission-audit"` (`evidence:codex-app-server-desktop`), while capabilities' production expectations are `pre-execution` for both desktop routes (`capabilities.json` S12 `expectedRoute`, S36, S37). Core's S33 desktop query uses `resolveNonDesktopPermissionPolicy({… hasVisibleUserInteractionChannel: true})` (kind `interactive-user`) for entry `desktop`, while capabilities uses `{kind:"desktop", interaction:"visible-user", enforcement: resolveDesktopPermissionPolicy(...).enforcement, diagnostics}`; core's host tests use `resolveDesktopPermissionPolicy` directly.
- Disposition: record. The production catalog must export `pre-execution` for both desktop routes (the only production assertion); the core table's value is test-local and self-consistent with its own evidence ports. The resolver must accept any `AgentRuntimePermissionPolicySummary` whose `interaction` is `visible-user` for entry `desktop` and must not narrow on `kind`. Optional: core author aligns the test table to `pre-execution` for coherence.

### P3 (recorded)
- P3-1 S03 preflight-blocked variant not exercised → §6.
- P3-2 S24 null-returning agent-factory reference lookup not covered → §6 (S24 desktop leg is covered by query #4).
- P3-3 S34 optional-feature recording ports: no seam; S02 purity stands in.
- P3-4 S38 renderer DTO cannot be injected (P22 B); spec limitation.
- P3-5 S23 process-level environment separation → TICKET-130 residual, manual smoke.
- P3-6 S29 "existing owner guards scan these fixtures" not exercised.
- P3-7 guards #75 (S30 integration leg) loads `public-contract.json#S21.requests` rather than `architecture-fixtures.json#S30`; acceptable reuse, recorded.
- P3-8 Clock: headless/executor/renderer do not pin the system clock (the pump/claim gates would trip the 24 h API age gate against DB-default creation times; no assertion depends on wall-clock), capabilities drives the 30 000 ms cache through an injected `now`; accepted deviation from the per-test `setSystemTime` convention.
- P3-9 Two `biome check --write` glob incidents reformatted sibling fixtures (whitespace only). All author-reported hashes equal the current bytes; §1 is authoritative.
- P3-10 Known weak oracles, accepted: S12 absence half; S13 reader half (green-by-design); S52 variant half (kit-evaluated); S49 correlation keys format-checked; S22 producer agreement static.
- P3-11 `discovery-schema-before.json` `$id` is the upstream GitHub URL from the base schema (byte-identical to `6192b13f`), not a checkout path.

## 8. Notes for the implementer

### 8.1 Frozen shapes (binding once the P1 adjudications are recorded; contradictions flagged)

Module and exports — `src/main/lib/agent-runtime/runtime-route-catalog.ts` exports `validateRuntimeRouteCatalog(declarations?, references?)`, `createRuntimeRouteCatalogForTests(declarations, references)`, `resolveRuntimeRoute(query, catalog?)`, `listRuntimeRoutes(filter, catalog?)`, `projectRuntimeRoutes(audience, catalog?)`, `probeRuntimeRouteReadiness(resolution, context)` (D1 names). NEW `src/main/lib/agent-runtime/runtime-route-read-model.ts` exports `withRuntimeRouteTransportId(binding, catalog?)`. NEW `src/renderer/features/agents/lib/runtime-route-transport.ts` exports `createRuntimeRouteTransport`. NEW `src/main/lib/codex/desktop-chat-run.ts` exports `runCodexDesktopChatRun(options: CodexDesktopChatRunOptions)`.

Declarations and reference ports (P1-1; recommended core shape) — `RuntimeRouteCatalogDeclarations = readonly {runtimeId, label, manifestRef, cancellation, sessionReference, routes: RuntimeRouteDeclaration[]}[]`; `RuntimeRouteDeclaration = {routeId, entries[], kind, modes[]|null, executionProfile|null, executionSurface, adapterSource, adapterLabel, transport, transportId|null, factoryRef|null, readinessProbeRef|null, enforcementEvidenceRef|null, enforcementEvidence, extensions: {namespace, schemaVersion, maturity, schemaRef, redactionOwner}[]}`. References `{normalizeRuntimeId(raw), getManifest(ref), lookupAgentFactory(ref) → delegate|null, lookupReadinessProbe(ref) → probe|null, lookupEnforcementEvidence(ref) → level|null}`; omitted inputs validate the real production table/ports; a partial references object is merged over the production ports. Reference lookups are counted separately from delegate invocations (tasks 2.2). `manifestRef` in production is an alias `resolveAgentRuntimeCapabilityManifest` accepts. Extension validity: namespace `runtime.<route runtimeId>.v1`, `schemaVersion` 1, `schemaRef` a `#/` JSON Pointer that resolves in `docs/local-job-api-v1.schema.json`, `redactionOwner` present (omitted from public summaries). No separate candidate declarations: the diagnostic candidate is the runtime's batch route on the same headless/api/protocol entry; Codex API policy-grant uses its own app-server route. Overlap = same runtime, kind and profile with intersecting entries and modes → `catalog_invalid` at validation only. Validator failure `offending` = any object whose JSON names the offending runtimeId/routeId (either route for an overlap). `validateRuntimeRouteCatalog([{routeId:"s24-malformed-declaration"}])` returns `{ok:false, reason:"catalog_invalid", …}` and that object is the `RuntimeRouteCatalogFailureState`; `createRuntimeRouteCatalogForTests` validates eagerly and returns the same failure state without throwing.

Queries — `RouteQuery` per D1; desktop queries arrive with either `resolveDesktopPermissionPolicy(...)`-derived summaries (`kind:"desktop"`) or `resolveNonDesktopPermissionPolicy` summaries with a visible channel (`kind:"interactive-user"`); both carry `interaction:"visible-user"` and must resolve (P2-4). Non-desktop queries use `resolveNonDesktopPermissionPolicy` with source `api` for entry `api` and `cli` otherwise; completion queries have `mode/executionProfile/permissionPolicy = null`. Required capabilities are the owner-derived union (`getAgentRunRequiredCapabilityIds` + explicit), order-independent.

Resolve results — `ok:true`: `routeId`, `runtimeId` (canonical), `entry`, `executionSurface`, `adapterSource`, `adapterLabel`, `delegate` (function for agent routes; `null` for completion), `transport`, `manifestRef` (`manifestRef.runtimeId` canonical where read as an object), `readinessProbe` (`null` for completion), `enforcementEvidence` (level string: `none | sandbox-level | admission-audit | pre-execution`; production: claude-code-batch/codex-batch `sandbox-level`, codex-app-server policy-grant `admission-audit`, both desktop routes `pre-execution`), `extensions`, `diagnostic{fallbackReason:null, policyGrantScopeBinding?, message}`; no `prefer*` key. `ok:false`: `reason` (`policy_refused | capability_refused | route_not_found | catalog_invalid | unsupported_required_extension`), `candidateAdapterSource`, `candidateAdapterLabel` (base labels "Codex app-server", "Codex headless/batch", "Claude Code batch"), `diagnostic{reason, message, capability}`, `result{status:"failed", exitCode:1, errorCode, errorMessage}`; no `delegate` key. Refusal order: fail-closed → grant enforcement → pre-execution → interactive → unsupported profile → capabilities; codes/messages are byte baselines from `adapter-selector.ts:209–343`.

Enumeration and projections — `listRuntimeRoutes({})` returns every descriptor sorted by routeId (code-point order), each carrying `runtimeId`, `runtimeLabel` (= manifest label), `entries`, `manifestRef`, `cancellation`, `sessionReference`, `adapterSource`, no function values; throws on a failure state. `projectRuntimeRoutes("renderer")` returns exactly `{routeId, runtimeId, transportId}` items, one per desktop route (`claude-chat-ipc`, `codex-chat-ipc`). `projectRuntimeRoutes("public")` returns `readonly {runtimeId, routes: PublicRouteSummary[]}[]` with exact route keys `{routeId, surface, kind, executionProfile, adapterSource, transport, extensions}` and extension keys `{namespace, schemaVersion, maturity, schemaRef}`; JSON-serializable, no functions. Both audiences throw on a failure state. Public transport values: batch → `process-stdio`, codex-app-server → `json-rpc-stdio`, locus-completion → `provider-http`; `runtimes[].routes` is emitted on every runtime with and without `--no-probe`; routeId is not pinned by any public test; route metadata contains none of `env, environment, readiness, ready, path, cwd, home, executable`.

Readiness — `probeRuntimeRouteReadiness(resolution, {probe?, dependencies?: RuntimeReadinessResolverDependencies, onDiagnostic?})` accepts an `ok:false` resolution and returns `unknown` without probing; reuses the module-level 30 000 ms cache in `runtime-readiness.ts` (`clearRuntimeReadinessCacheForTest` clears it).

Host seams — `runtimeRouteCatalog?: RuntimeRouteCatalogState` on `RunHeadlessCliCommandOptions` (forwarded by `api runs create/submit/wait/retry/status/events/result/cancel`, `daemon run`, `jobs-stdio`, `api runtimes list`, `run`, `schedules create`), `PumpQueuedRunsOptions`, `RunJobsStdioServerOptions`, `LocalJobApiRuntimeManifestEnvelopeOptions` (must drive the envelope's manifests, not only readiness), the Claude host input (`runClaudeAgentSdkDesktopRuntimeWithMcpReadiness`) and `CodexDesktopChatRunOptions` (= `runCodexAppServerDesktopAdapter` input + `runtimeRouteCatalog`; returns the delegate's `DesktopRunResult` unchanged; no host ledger calls). `runAgentTask(request, observer, {runtimeRouteCatalog})`: with a failure state it either rejects with or returns `errorMessage` "Runtime route catalog is unavailable." with zero leaf calls; through the job runner it settles `runtime_error`/1. Typed delegates are called with the existing leaf input: headless `(request, observer)`; Claude desktop = `runClaudeAgentSdkDesktopAdapterWithPreparedRuntimeQuery` input; Codex desktop = `runCodexAppServerDesktopAdapter` input. Lookup precedes invocation; hosts perform one post-binding factory lookup and one delegate call per Run and never look up rich factories for batch requests. Desktop catalog-fault channel: the rejection, an emitted `{type:"error", errorText}` chunk, or an `emitError` call carrying exactly "Runtime route catalog is unavailable."; "catalog_invalid" appears nowhere public. `api runtimes list` with a failure state: `runHeadlessCliCommand` rejects with the sanitized message and stdout is empty.

Renderer/main read model — `createRuntimeRouteTransport(input, config)` where `config = {chatId, subChatId, binding, projectPath?, mode}` is passed unchanged to the compiled wire constructor (an added `provider` field is tolerated); failures `route_descriptor_unavailable | route_descriptor_error | unknown_transport` with zero constructor/subscription calls. `withRuntimeRouteTransportId(binding, catalog?)` returns a copy, never mutates its input, omits `transportId` for a failure state; applied in getSubChat, createSubChat and (pending P2-3) chats.get; `PRAGMA table_info(sub_chat_bindings)` must show no `transportId` column.

Guard — flag `--runtime-route-catalog-fixtures=<path>`, default `tests/fixtures/runtime-route-catalog/architecture-fixtures.json` (77 cases; canonical summary `Runtime route catalog guard self-test: 77/77 fixture cases matched; repository ownership enforced.`); mutated-fixture self-check must exit 1 with `63/77` and 14 case lines; mismatch line must contain each finding's `rule` and `symbol` and end `See Runtime Route Catalog Single Owner.`; the `<keys>` rendering is not pinned. Fixture keys per P2-1 (any `/^S\d\d$/` key set recommended). Symbol conventions: dispatch = enclosing named declaration or map binding; retired = canonical export name, or module basename for a restored module (`adapter-selector`, `runtime-registry`); leaf = imported export name (type-only imports excluded); forbidden-dependency = import specifier as written (readiness cycle reported on `runtime-readiness.ts`; router-through-wrapper reported on the catalog); owner-bypass = imported symbol, `"process.env"`, or the fs/config specifier, with owners `headless/job-store.ts`, `agent-runtime/run-event-ledger.ts`, `agent-runtime/run-artifacts.ts`, `provider-profiles/storage.ts` (env/fs/config reads → the catalog path); duplicate = validator or test-constructor name; test-port = `"runtimeRouteCatalog"` or the called query function's name; renderer-bypass = enclosing declaration (`getOrCreateChat`, `createNewSubChat`, `createRuntimeRouteTransport`) or the literal map binding (`TRANSPORT_ID_BY_RUNTIME`). `owner` is the catalog path for every rule except owner-bypass; `ownerSection` is always `Runtime Route Catalog Single Owner`. Production scans: `active-chat.tsx` has no `new CodexAppServerChatTransport(` / `new IPCChatTransport(` and exactly two `createRuntimeRouteTransport(` calls; `OWNERSHIP_MAP.md` has `## Runtime Route Catalog Single Owner` naming the catalog path and no `## Headless Runtime Adapter Selection`; no `LOCUS_*(ROUTE|SELECTOR|DUAL_PATH)*` name in `src/`; the catalog source has no `process.env`, `fs` import, `claude-config`, `user-data-path` or `electron-store`.

### 8.2 Raw SQL / table names the tests bind to (renames break the suite)
`agent_jobs`, `agent_job_events`, `agent_provider_profiles`, `projects`, `chats`, `sub_chats`, `sub_chat_bindings` (including `PRAGMA table_info(sub_chat_bindings)`); the tests read `agent_jobs`/`agent_job_events` rows directly for S16/S17/S49 ordering, worker ids and redaction, and insert profiles/projects/chats/sub-chats for setup.

### 8.3 Baseline tests obsoleted by this slice (design D5; replacement coverage in this suite)
| Baseline file | D5 disposition | Red-suite replacement |
| --- | --- | --- |
| tests/headless-adapter-selector.test.ts | rewrite onto catalog query/refusal | routes S04, S05, S08 (fallbackReason:null retained; preferredAdapterSource seam deleted) |
| tests/agent-runtime-registry.test.ts | rename to tests/agent-runtime-router-surface.test.ts keeping the :72–143 source scans verbatim; facade tests :12–70 migrate | query S06 (unknown/retired IDs), capabilities S10 (manifest truth); residue ALLOWED entry re-pointed atomically at rename |
| tests/desktop-runtime-adapter-factory.test.ts | typed catalog factory | routes S03 |
| tests/codex-desktop-adapter-selection.test.ts | status projection | routes S03 (#12 baseline), S31 |
| tests/claude-agent-sdk-adapter-runner.test.ts | typed delegate / test catalog ports; keep native policy retry | routes S03 |
| tests/codex-app-server-adapter-runner.test.ts | typed delegate / test ports; keep native cancellation/failure | routes S03, S31 |
| tests/agent-runtime-preflight.test.ts | drop registry import; shared manifest; keep preflight ordering | cross-validated by routes S03 (plus §6 preflight-blocked unit) |
| tests/run-event-ledger-desktop-request.test.ts | catalog typed delegate instead of factory construction | routes S49 oracle |

### 8.4 Adjudications the coordinator must record before the RED-suite commit
1. P1-1 declaration/reference shape (recommended: core shape).
2. P1-2 S23 merge into `readiness.json`.
3. P1-3 residue ALLOWED entry for `refusals.json`.
4. P2-1 guard fixture key set (recommended: any `/^S\d\d$/` key set).
5. P2-3 S53 chats.get stamping (recommended: keep; stamp all three read-model compositions).
Items 4–5 do not block the commit but, left unrecorded, would block the implementer.

## 9. Coordinator adjudications (2026-10-02, recorded before the RED-suite commit; tasks 6.8 test-adjudication record)

Authority: Owner 2026-10-02 self-iteration mandate (red tests, adjudications and implementation dispatch are coordinator-acted; only red-light items return to the Owner). None of the items below is a red light: no public contract changes, no design change, no scope change.

| Item | Decision | Action taken / binding note for the implementer |
| --- | --- | --- |
| P1-1 declaration / reference-port shape | **Core shape adopted** (catalog.json#S01 declarations with `factoryRef / readinessProbeRef / enforcementEvidenceRef` + declared `enforcementEvidence` level, runtime-level `manifestRef / cancellation / sessionReference`; references `{normalizeRuntimeId, getManifest, lookupAgentFactory, lookupReadinessProbe, lookupEnforcementEvidence}`, partial references merged over production ports, lookups counted separately from invocations). Rationale: three of four domains and the shared surfaces kit are frozen on it; the spec's "getAgentRuntimeCapabilityManifest owner port" names the production manifest owner, which `getManifest(ref)` resolves through, not a reference-port key name. | Capabilities kit, `capabilities.test.ts` S10/S13/S38 consumers and `extensions.json#S13` relinked by the coordinator's executor; all 13 capabilities tests stay red at the lazy import. §1 hashes superseded by §10. |
| P1-2 S23 fixture location | **Merged** into `readiness.json#S23` (header + S11 kept; sourceRefs union; provenance.S23 records the merge); `discovery.test.ts` relinked to `fixtureKey("readiness.json", "S23")`; side file `readiness.public-guards.json` deleted. | discovery.test.ts re-run: 2 tests / 2 red (unchanged reasons). |
| P1-3 retired-runtime residue | **ALLOWED entry added** in `scripts/check-retired-runtime-residue.mjs`: `tests/fixtures/runtime-route-catalog/refusals.json` — "S06/S46 retired-ID refusal fixtures (… tasks 6.1 / design D5)". The `tests/agent-runtime-registry.test.ts` entry stays until the §4.6 rename, which must re-point it atomically. | `node scripts/check-retired-runtime-residue.mjs` exits 0 once the fixture is tracked (the guard treats allowances for untracked files as unused). |
| P2-1 guard fixture key set | **Adjudicated**: the guard accepts any non-empty set of top-level keys matching `/^S\d\d$/`, each `{cases:[…]}` in the D5 case shape; the summary counts all cases present; a one-key file is legal; the canonical file keeps S26–S30/S48/S50. A file with no such key, or a key whose value is not `{cases:[…]}`, is an illegal fixture (exit 1) as D5 states. | Surfaces temp fixtures keyed S18/S19/S53 and the routes one-key S27 file stay as written. Implementer: do not hard-code the seven keys. |
| P2-2 public-contract / guards #75 fail at the lazy import | **Recorded, no edit**: the red is the NEW seam's import rejection; the author's base re-render of the 6192b13f goldens is not in the repo. Rule for implementation: any mismatch against `public-contract.json#S21`, `errors.json#S24`, `artifacts.json#S25` is first re-rendered on a fresh base (6192b13f product source) and adjudicated by the coordinator before being treated as an implementation defect; the goldens are byte baselines and are not re-recorded by the implementer. | — |
| P2-3 S53 `chats.get` stamping test | **KEEP**. `withRuntimeRouteTransportId` is applied to all three binding read-model compositions — getSubChat, createSubChat and `chats.get` via `attachBindingsToSubChats` (chats-crud.ts) — never persisted; the architecture guard's clean cases accept the third call site. Design D3 / spec S53 name two sites; the third is required for the renderer path to be live (active-chat.tsx reads bindings populated by chats.get). This is an internal (C7 §9.1) composition detail, not a contract change; implementer records it in verification as an adjudicated extension of S53. | — |
| P2-4 desktop evidence / policy-shape divergence | **Recorded**: production catalog exports `pre-execution` for both desktop routes (the only production assertion); the core test table's `admission-audit` for its synthetic desktop route is test-local. The resolver accepts any `AgentRuntimePermissionPolicySummary` whose `interaction` is `visible-user` for entry `desktop` (both `kind:"desktop"` and `kind:"interactive-user"` summaries) and must not narrow on `kind`. | — |
| P3-1…P3-11 | Recorded as written in §7; §6 implementer-unit items stand. | — |
| P1-4 S03 desktop-host `lookedUpOtherRuntime` oracle (found at Phase II 258e4081 by the implementer and both reviewers; reproduced) | **Test defect, adjudicated (tasks 6.8)**: the oracle counted every `lookupAgentFactory` call in `ports.log.factoryLookups`, including the lookups the catalog makes while validating the two-runtime `catalog.json#S01` table eagerly — which S01 (agent-missing-factory variant), S24 and tasks 2.2 require. The author's intent is the post-binding host behavior ("invokes only the catalog SDK/app-server delegate … queries its fixed runtime"). Fix: snapshot `factoryLookups.length` right after `testCatalog()` and count only later lookups (the surfaces kit already separates `validationLookups` from `lookups`). No implementation change; `routes.test.ts` 17/17 at 258e4081 after the edit. | Edited by the coordinator in `tests/runtime-route-catalog-routes.test.ts` (two blocks: Claude host, Codex host); §10 hash for that file updated below; the immutable zero-diff reference moves to the adjudication commit. |

Immutable set after adjudication = §1 file list minus `readiness.public-guards.json`, plus the `scripts/check-retired-runtime-residue.mjs` ALLOWED edit (one entry; the script otherwise unchanged). The implementer must not edit any file in the immutable set; contract doubts return to the coordinator (tasks 6.8).

## 10. Final immutable file hashes (sha256 at the RED-suite commit, routes.test.ts re-hashed at the P1-4 adjudication commit; supersede §1 where they differ — capabilities kit/test and extensions.json relinked per §9 P1-1, readiness.json merged and discovery.test.ts relinked per §9 P1-2, side file deleted, all files biome-formatted)

| File | sha256 |
| --- | --- |
| tests/fixtures/runtime-route-catalog/architecture-fixtures.json | 2384885720baac8cebac252dfbb948bcc3fb8287ef6761dcdf2b87a94dfbeb43 |
| tests/fixtures/runtime-route-catalog/artifacts.json | 81d2c288db26b1e7dabcdfea70c09ecdba552b54de05f279962909c0f4a3868b |
| tests/fixtures/runtime-route-catalog/capabilities.json | 4603ffb33033abb1ca326fa80d71847a4e0d61cc42f134b3328092cf9502eb06 |
| tests/fixtures/runtime-route-catalog/catalog.json | 3afbf419350ba38cb5ce98f9fa714dbd2703e080f99cfcadb433a3ad9a8e385c |
| tests/fixtures/runtime-route-catalog/completion.json | 496a343eea2c9e582a43c01816d4c2348967b5bfdd26103f2f0b479877d250e1 |
| tests/fixtures/runtime-route-catalog/desktop-actions.json | b0984f3ae5142373732cd36129dcaa3d9042b63c21cb99384afb18515dea0063 |
| tests/fixtures/runtime-route-catalog/discovery-reader-before.ts | 53ef10a76c09f4e68133275dfcf6382550421a9f87442f66800abe736788382b |
| tests/fixtures/runtime-route-catalog/discovery-schema-before.json | 5953fe859f011ae56148b8b396417c810098e3ade610cec1d610efe2b80e3ed9 |
| tests/fixtures/runtime-route-catalog/discovery.json | 86a781c5637c1c688a0c7a72d6af9d886728cc766afb14bedad5a2239afe2418 |
| tests/fixtures/runtime-route-catalog/errors.json | d9859fb840afd3fccf5950e63d612242736a59f69ee18bfc7f424c7e20144477 |
| tests/fixtures/runtime-route-catalog/executor.json | 2c1fda58aff53af1b7bdfa89e69f15f6616501684001d81e7f9e78472f9308f7 |
| tests/fixtures/runtime-route-catalog/extensions.json | 4282c1149a90ad743e8ec7a0d8fb4f6862d6dc0d9292193cb7da6f72daa3103e |
| tests/fixtures/runtime-route-catalog/headless.json | f9011db5da94588d0d1ef66db12617dd9f8dbb07570ae7c130755164305e7b63 |
| tests/fixtures/runtime-route-catalog/policy.json | ddcd4b809c8755e313518f4e71569b59fda639c273184a6503552107f21df7e4 |
| tests/fixtures/runtime-route-catalog/provider.json | f3c774780f07251f931cc7f7d8e30c4e6bd6b85a3dbe38a0efe020ca90c49ed9 |
| tests/fixtures/runtime-route-catalog/public-contract.json | 66fdb337a048dc91c51b418eb7e0b07ecd6ac23640faddbd730fe5e241a1b680 |
| tests/fixtures/runtime-route-catalog/readiness.json | b58131c71423cdfc33400fe81fd33fdfc87d00e077abb0beff9f47b0ec7a5535 |
| tests/fixtures/runtime-route-catalog/refusals.json | 84948d7c791eddb4f30da9e341c8ab0242b3294c0006f0bfe1a335b1c72f5582 |
| tests/fixtures/runtime-route-catalog/renderer.json | a71e0dc6e7de046a36ff2e1f9aa5cdbfe7f4e60a1f860df9e893a06b5af0825f |
| tests/fixtures/runtime-route-catalog/routes.json | d91f0efc35032185fc0b4efc623965b83ab737459c8ea00f08712cb2c1316f6d |
| tests/runtime-route-catalog-capabilities-kit.ts | 7f6da221e44e8598865f1383897f242961c2a0a50394898bcffba1976eba0c58 |
| tests/runtime-route-catalog-capabilities.test.ts | edea89b5349a4d9f85b17d625a67cfa0f82f3748bf63123230c1f2443f2c5066 |
| tests/runtime-route-catalog-completion.test.ts | c2263bbbcc73340bfd590106da5d4f12008752cf7aa5fcdde460daeecd0f75a0 |
| tests/runtime-route-catalog-core-kit.ts | 3e0a78ffcc81b3a9abc9331e573fbc1e4a0df4ba855b81e6cfb2bb051072012d |
| tests/runtime-route-catalog-discovery.test.ts | c48144757dda67e95fc8c5ba2a6a16ad0d1474fe727b638bb51495fca414893a |
| tests/runtime-route-catalog-executor.test.ts | 2dc2d949c7d374d5986bd6d342a7cff2ec49a602c466fb16175e58a7528680eb |
| tests/runtime-route-catalog-guards-kit.ts | 566678025ce1bba1cc05bf5ec6bb078a72288e1b885b245684dc8f7d00e4524b |
| tests/runtime-route-catalog-guards.test.ts | 15ae182fdd6d3fed05afbcf895827ea5ad283a0288a6173c5db013fd8836296c |
| tests/runtime-route-catalog-headless.test.ts | afa88029a2dfa390f96bd21d86d29be2a11c4945d9738f36af67d3688352fa92 |
| tests/runtime-route-catalog-provider.test.ts | 4bf7a2db1946dcef7da50ce837b1a3a6e1cba9a47d7b43beceb388884fe7d7bd |
| tests/runtime-route-catalog-public-contract.test.ts | a81a04450141da6dfaafa28a795d839360616ab9184972b90ad66a367b5f1548 |
| tests/runtime-route-catalog-query.test.ts | 6a8a99d57a3dde233724e46208b0cbf149ba3b717d3655d0b58d3471574b74e6 |
| tests/runtime-route-catalog-renderer.test.ts | 5dcbb3b109ab0b8b53fe2f2929d713f184688a8503a1fce3a83c15aedce8fc22 |
| tests/runtime-route-catalog-routes.test.ts | 92eb7653bacd72e138353a083baa0f3a958fdbc23b4730346a50b09954904c9a |
| tests/runtime-route-catalog-surfaces-kit.ts | 4a029807e8b70e9d00412361101e7cbf2b1668c50cfa823050674424b19d6846 |

scripts/check-retired-runtime-residue.mjs: one ALLOWED entry added (P1-3); implementer may edit this script only for the §4.6 registry-test rename.
