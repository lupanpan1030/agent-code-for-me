# Verification: Unified Runtime Route Catalog

Status: **IMPLEMENTATION CANDIDATE — frozen (source a52d6a93; candidate = the Phase III freeze commit, SHA in the Phase III handoff) — APPROVED 2026-10-02 (coordinator-acted under Owner mandate, bound to a9b74594; Owner may revoke); awaiting same-SHA Codex IMPLEMENTATION_VERIFIED + fresh Claude REVIEW_APPROVED**

本文件登记实施候选的验证证据。RED suite `c297872d` 的 77 个测试在源码 `a52d6a93` 全部通过（§2/§3）；
Phase III 只改文档并冻结候选。尚无 Codex IMPLEMENTATION_VERIFIED、绑定冻结候选的 REVIEW_APPROVED 或 ACCEPTED；
Desktop/packaged/真实 Runtime smoke 在本主机 host-blocked（§7），不记通过。

## 1. Source 与治理绑定

| 栏位 | 当前值 / 实施时回填 |
| --- | --- |
| Draft base | `6192b13f74603fbcc57c8ba858cb6b0f0d0ac776` |
| Base 核对 | 第一版核对记录：6192b13f 含已归档 ledger 与 async-submit；第二/三版未重新联网核对 main；Phase III（2026-10-02）再核对本地 `main` = `6192b13f`，未前移 |
| Redraft input HEAD（第二版历史） | `f7a3f7bd454b95deb7ae6f6596efebe0dd3d9cf3` |
| Touch-up input HEAD / parent | `283f29ca1401f5567df998b850bbc605a064ee5f`，第三版开工 branch/HEAD/clean tree 已核对 |
| Touch-up authority | `route-catalog-redraft-synthesis-283f29ca.md` §3 T1–T20 / §4；OD-1–OD-5 / Must-stay 不变 |
| Worktree | `/home/chen/projects/locus-refactor-unified-runtime-route-catalog-draft` |
| Branch | `codex/refactor-unified-runtime-route-catalog-draft` |
| Draft receipt SHA | 精度修补提交 A = `a9b74594`；审批登记提交 B 由交付报告给出，不自引用其内容 |
| 闭合检查输入历史 | 第三份草案 v3 **bf48bd4f** 经二审（route-catalog-redraft-synthesis-283f29ca.md：0 P0/P1、无 C7 Red）与 T1–T20 修补 + 独立闭合检查（route-catalog-closure-check-bf48bd4f.md：READY_FOR_APPROVAL）。 |
| APPROVED / Consumer Impact §10（统筹代行，非 Owner 签署） | APPROVED 2026-10-02（统筹代行；Owner 2026-10-02 自我迭代授权；绑定 a9b74594） |
| Q1–Q5 / OD-1–OD-5 | 已采纳（统筹代行，Owner 可改）；缩窄 L2 / 受约束 optional routes / binding read model / P23→B / 验收代行，见 design Decisions adopted 2026-10-02；非 Owner 签署，Owner 可撤回 |
| Approved spec SHA | `a9b74594`（完整 SHA `a9b745949b02e2b7c1bbd883c224c14b324d3dbc`） |
| Independent RED author / suite SHA / adjudication SHA | 4 independent Opus authors (catalog-core / capabilities / surfaces / public-guards) + Fable audit (Workflow wf_32724556) / `c297872d` / `c297872d`（P1-1..P1-3 修正与 P2-1..P2-4 裁定随同一提交，见 red-receipt §9–§10） |
| Implementation source SHA / test fixture hashes | `a52d6a93f8a2c809fb5dc16e16c98b7b9cedc6ce`（Phase I `9f06b6f7` → Phase II `258e4081` → test adjudication `24801faa` → T1 `a52d6a93`）/ red-receipt §10 的 35 个 sha256 在候选上 `sha256sum -c` 全 OK |
| Frozen implementation candidate | Phase III 冻结提交（subject `docs(openspec): freeze the unified runtime route catalog implementation candidate`，即包含本记录的提交）；提交无法引用自身 SHA，准确 SHA 见 Phase III handoff（`handoff/dispatch-logs/impl-route-catalog-phase3.report.md`） |
| Codex IMPLEMENTATION_VERIFIED SHA / verdict / receipt | 须绑定冻结候选 / NOT ISSUED / — |
| Fresh-context Claude Code REVIEW_APPROVED SHA / receipt | 冻结候选：NOT ISSUED。历史（不替代最终 verdict）：Phase I 两镜头 REVIEW_APPROVED @`9f06b6f7`（Phase I 范围）；Phase II 两镜头 CHANGES_REQUESTED @`258e4081`；T1 REVIEW_APPROVED @`a52d6a93`（touch-up 范围，4 P3）。回执在 `handoff/reviews/route-catalog-{phase1,phase2,t1}-review-*.md` |
| Security review SHA / findings disposition | tests-security 镜头：@`9f06b6f7` REVIEW_APPROVED（4 P3）、@`258e4081` CHANGES_REQUESTED（仅 S03 oracle，已裁定）；最终 fresh security lens 待派 / 全部处置见 §5 |
| Owner or authorized coordinator ACCEPTED / authority / SHA | NOT ISSUED / Owner 2026-10-02 自我迭代授权（OD-5，条件见 §8）/ — |
| Local merge SHA / post-merge verification | — / — |
| External action authorization / target / SHA | NONE；Phase III 派单不 push、不远程 PR mutation、不 merge、不 archive |

两技术 verdict 必须绑定同一准确 source SHA；后续代码变化使两者同时失效。
测试作者、实施者、fresh reviewer 的责任不能由起草自查替代。

### 实施提交历史

| 阶段 | 提交 | 独立评审 |
| --- | --- | --- |
| RED suite | `c297872d`（suite + 统筹 P1-1..P1-3 / P2-1..P2-4 裁定）、`76921ae8`（登记） | red-receipt §9–§10 |
| Phase I | `4b6218a2`、`1bceedf7`、`4edfe4f7`、`ff3556a7`、`832dab68`、`9f06b6f7` | `route-catalog-phase1-review-design-probes-9f06b6f7….md`：REVIEW_APPROVED（Phase I 范围；1 P2、3 P3）；`…-tests-security-9f06b6f7….md`：REVIEW_APPROVED（4 P3） |
| Phase II | `d1276de7`、`0066e018`、`959433b9`、`2c15a1a0`、`d6a6c23f`、`f5e64523`、`543f9e93`、`646c7e5a`、`8227e73a`、`347209b5`、`fc5e9762`、`06a63b9c`、`c6d73891`、`22fa8dae`、`a24124d1`、`258e4081` | `route-catalog-phase2-review-design-probes-258e4081….md`：CHANGES_REQUESTED（P1-1 S03 oracle、P2-1、3 P3）；`…-tests-security-258e4081….md`：CHANGES_REQUESTED（P1 S03 oracle、2 P3） |
| Test adjudication | `24801faa`（S03 只计绑定后 factory 查找；red-receipt §9 P1-4，§10 routes.test.ts 重新 hash） | 统筹裁定（tasks 6.8） |
| T1 touch-up | `16c2add0`、`06dc3e2c`、`2042da86`、`0fe80991`、`58f2bf76`、`a52d6a93` | `route-catalog-t1-review-a52d6a93….md`：REVIEW_APPROVED（0 P0/P1/P2，4 P3） |
| Phase III（本次，纯文档） | `0a86fd0a`（指南）、`95aeaddd`（OWNERSHIP_MAP 相邻 owner）、`09e95e2d`（tasks/proposal 指针）、冻结提交（本记录；SHA 见 Phase III handoff） | 待派：Codex IMPLEMENTATION_VERIFIED + fresh Claude REVIEW_APPROVED（同一冻结 SHA） |

每个 P0–P2 已在 `a52d6a93` 关闭：Phase I design P2-1（OWNERSHIP_MAP，`8227e73a`）；Phase II 两镜头的
S03 oracle P1（统筹裁定 `24801faa`，测试缺陷，非实现缺陷）；Phase II design P2-1（renderer/transportId
守卫负例，`06dc3e2c`）。T1 评审以 remove-the-fix 探针确认这些关闭。Phase III 未发现需要改代码的 P0–P2。

### 统筹代行授权与登记事实（本次派单提供，非 Owner 签署）

- Owner 2026-10-02 对本仓库启用「自我迭代」指示：只有红灯项（C7 Red 需 Owner 选项、P0/P1 无法在设计范围内关闭、路线图变化、超出 push 规矩的外部动作、用户可见产品取舍、安全事件、Codex↔Claude 不收敛）才回到 Owner；其余（含下一份路线图变更的起草/评审/APPROVED，预设须写明 Owner 可改）由统筹（Claude Fable 5.1）代行。
- 统筹据此登记：**APPROVED 2026-10-02 — coordinator-acted under the Owner's 2026-10-02 self-iteration mandate; bound to a9b74594; Owner may revoke or amend any preset**。
- 五项预设（OD-1–OD-5）全部按推荐默认采纳，Owner 可改：
  1. OD-1 缩窄 L2：本切片只保证 main 侧「目录条目 + adapter 包 + 自有 chat router/transport 静态注册」与 renderer 只读投影；Phase 7「新 Runtime 不改 renderer switch」不由本切片验收；approval 分派（含 Claude 默认）、admit gates、P28 provider 三元、alias 表留具名残余给 Phase 4 / harness-conformance。
  2. OD-2 允许受约束的可选 `runtimes[].routes`（experimental、开放描述串、routeId 非身份、消费者不得按 adapterSource/transport 分支）：C7 #2/#10 additive Yellow，S22 旧 reader 通过后关闭。
  3. OD-3 renderer 数据路径 = main 在 chat/createSubChat 绑定读模型盖 transportId（C7 internal），不加 listRoutes。
  4. OD-4 P23→B：pump 保留 job.kind→runner，目录只在 agent runner claim 后查询；不放宽 async guard。
  5. OD-5 统筹代行 ACCEPTED（条件：同 SHA Codex IMPLEMENTATION_VERIFIED + Claude REVIEW_APPROVED、无开放 Red、残余逐项裁定）；push 仍按 2026-09-04 规矩由统筹派 Codex；Owner 可改为亲自验收。
- 已向 Owner 发出通报（非阻塞）；Owner 未回复即视为维持预设。

## 2. Candidate gates（冻结候选）

源码 SHA `a52d6a93f8a2c809fb5dc16e16c98b7b9cedc6ce` 之后只有 Phase III 文档提交（`docs/` 两份指南与
OWNERSHIP_MAP、本 change 的 tasks/proposal/verification、`openspec/STATUS.md`）；`git diff --stat a52d6a93 <候选> --
src tests scripts package.json lint-baseline.json` 为空。下列门禁在冻结提交的最终工作树上运行（2026-10-02，本 WSL2 主机；冻结提交的内容已全部在工作树中、尚未提交），
并在冻结提交提交后于该准确 SHA 复跑，复跑结果记于 Phase III handoff。

| Gate | Command | Result |
| --- | --- | --- |
| 十一份 red 文件 | `bun test --isolate` 显式列出 11 个 `tests/runtime-route-catalog-{query,routes,provider,completion,capabilities,headless,executor,renderer,public-contract,discovery,guards}.test.ts` | 77 pass / 0 fail / 0 skip，414 `expect()`，11 files（在 `a52d6a93` 与冻结工作树各跑一次，结果相同） |
| red-file glob（含实施者单元） | `bun test --isolate tests/runtime-route-catalog-*.test.ts` | 78 pass / 0 fail，420 `expect()`，12 files（第 12 个为 Phase I 的 `runtime-route-catalog-null-factory.test.ts`） |
| Aggregate | `bun run check:full` | exit 0（5 min 36 s）：lint:changed “No changed files supported by Biome.”；三个 guard self-test（ledger 17/17、async 17/17、route catalog 77/77）与 `Architecture guard passed.`；retired-runtime residue passed（1871 files，11 allowlisted）；`tsc --noEmit` clean；3014 pass / 2 skip / 0 fail，15069 `expect()`，3016 tests in 382 files（2 skip 为 `local-job-api-wrapper-relay-signals.test.ts` 的 win32-only 用例）；strict `Totals: 54 passed, 0 failed (54 items)`；build `✓ built`；diff:check clean。源码 `a52d6a93` 上的同一命令结果相同（exit 0，5 min 45 s，3014 / 2 / 0） |
| PR-base lint | `BIOME_CHANGED_SINCE=6192b13f node scripts/run-biome-changed.mjs` | exit 0（“Biome reported diagnostics only outside changed lines; ignoring legacy file diagnostics.”） |
| Architecture guard（canonical） | `node scripts/check-architecture-guards.mjs` | exit 0：`Run event ledger guard self-test: 17/17 …`、`Local job API async submission guard self-test: 17/17 …`、`Runtime route catalog guard self-test: 77/77 fixture cases matched; repository ownership enforced.`、`Architecture guard passed.` |
| Architecture guard（mutated fixture self-check） | `runtime-route-catalog-guards.test.ts` 内 `--runtime-route-catalog-fixtures=<mutated>` | exit 1，`63/77`，14 行 case mismatch，均以 `See Runtime Route Catalog Single Owner.` 结尾（guards 8/8 green；Phase II design 评审另以独立 Python 变异复现） |
| Retired-runtime residue | `node scripts/check-retired-runtime-residue.mjs` | exit 0，`Retired-runtime residue check passed (1871 files scanned, 11 allowlisted).` |
| Strict OpenSpec | `bun run spec:validate`；`openspec validate refactor-unified-runtime-route-catalog --strict --no-interactive` | `Totals: 54 passed, 0 failed (54 items)`；`Change 'refactor-unified-runtime-route-catalog' is valid`（每个 Phase III 提交前均运行） |
| Lint ratchet | `git diff 6192b13f <候选> -- lint-baseline.json` | 只删/降：`agent-runtime/run-contract.ts`、`claude/agent-sdk-desktop-run-runtime.ts`、`headless/adapter-selector.ts`、`headless/agent-runtime.ts`、`tests/agent-runtime-preflight.test.ts`、`tests/agent-runtime-registry.test.ts`、`tests/headless-adapter-selector.test.ts` 删除，`tests/desktop-runtime-adapter-factory.test.ts` 3→2；对 `24801faa` 0 diff |
| Architecture baselines | `git diff 6192b13f <候选> -- scripts/architecture-baselines.json` | 0 diff（含 `#reachThroughWrappers`） |
| Immutable set | `git diff --stat 24801faa <候选> -- <11 red tests> <4 kits> tests/fixtures/runtime-route-catalog openspec/changes/refactor-unified-runtime-route-catalog/red-receipt.md` | 空；red-receipt §10 35 个 sha256 `sha256sum -c` 全 OK |
| No migration | `git diff --stat 6192b13f <候选> -- drizzle src/main/lib/db` | 空 |
| Whitespace | `git diff --check 6192b13f <候选>`；每个 Phase III 提交前 `git diff --check` | clean |

**Schema 核对（task 5.3，未改 schema）**：经真实 `runHeadlessCliCommand` 发射的 `api runtimes list --json --no-probe` 与
`api runtimes list --json`（stub readiness）两份输出：两个 runtime 的键均为 `runtimeId, label, description, capabilities,
readiness, routes`；claude-code 2 条（`claude-code.completion`、`claude-code.headless.batch`），codex 3 条
（`codex.api.policy-grant`、`codex.completion`、`codex.headless.batch`）；route 键恰为
`routeId, surface, kind, executionProfile, adapterSource, transport, extensions`，extension 键恰为
`namespace, schemaVersion, maturity, schemaRef`；transport 取值 `process-stdio`/`json-rpc-stdio`/`provider-http`；
completion 项 `executionProfile: null`。Ajv 2020（`#/$defs/runtimeManifestEnvelope`）：新 schema 两份输出均通过，给 route
或 extension 加未列字段均被拒绝（`additionalProperties: false`）；冻结的旧 schema（`discovery-schema-before.json`）
两份输出与加字段变体均接受。schema 的 `runtimeRouteSummary` / `runtimeRouteExtension` 与代码（`src/shared/local-job-api.ts`
DTO、`runtime-route-catalog.ts#publicSummary`）一致：`kind` 引用 `jobKind`、`executionProfile` 为 `executionProfile`|null、
`maturity` 为开放字符串（代码只发 `experimental`）、`schemaRef` 模式 `^#/`；`routes` 非 required。没有矛盾，未改 schema。

## 3. Scenario 登记表

第二版已有 52 条（原登记 32 + whole-copy MODIFIED 20）；第三版依 T3 新增
S53 main-side binding stamping，合计 **53 条**。T16 将 S33–S52 每条两个 WHEN 合为一个，
未拆出新 Scenario，全部 living scenario 标题保留。

fixture 根固定为 `tests/fixtures/runtime-route-catalog/`，**扁平布局**；`#Sxx` 表示 JSON
顶层键，和 spec GIVEN、tasks §7 一致。fixture 与测试已随 RED suite `c297872d` 创建（S03 oracle 经 `24801faa` 裁定）；下表末列为 GREEN @ `a52d6a93` 证据。
测试入口前缀为 `tests/runtime-route-catalog-`，“bun test 入口”列的 `query.test.ts` 等是该前缀下的实际文件；
每个测试的完整标题与结果见 §3b，RED 时状态见 §3c；命令与门禁见 §2。
S14/S15 与 S33–S52 保留 living scenario 原标题，通过 delta 注释登记 ID；共 53 条
（32 原登记 + 20 whole-copy MODIFIED 场景 + S53），未把 preserved living 场景漏出测试登记。

| ID | Spec delta | Fixture / key | bun test 入口 | Observable oracle / 结果 |
| --- | --- | --- | --- | --- |
| S01 | agent-runtime-core | catalog.json#S01 | query.test.ts | 生产表/真实 refs、重复/相交/缺引用/非法 namespace/enforcement/probe validation，初始化故障 host 映射；**GREEN @ a52d6a93**：`runtime-route-catalog-query.test.ts`「S01 Invalid declarations cannot become executable」4/4 pass（RED suite @ c297872d：4 RED / 0 GREEN by design）|
| S02 | agent-runtime-core | catalog.json#S02 | query.test.ts | 查询/枚举排列不变、readonly、不调用 factory/probe/DB；**GREEN @ a52d6a93**：`runtime-route-catalog-query.test.ts`「S02 Query and enumeration are deterministic and side-effect free」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S03 | agent-runtime-core | routes.json#S03 | routes.test.ts | 两个具名 desktop hosts 的 typed delegate/目录 spy、procedure guard 与 preflight 拒绝顺序；**GREEN @ a52d6a93**：`runtime-route-catalog-routes.test.ts`「S03 Desktop routes select the existing native adapters」4/4 pass（RED suite @ c297872d：3 RED / 1 GREEN by design）|
| S04 | agent-runtime-core | routes.json#S04 | routes.test.ts | entry input / executionSurface output，各入口同 batch leaf、原 source/provenance；**GREEN @ a52d6a93**：`runtime-route-catalog-routes.test.ts`「S04 Entry surfaces resolve to the same batch leaf」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S05 | agent-runtime-core | policy.json#S05 | routes.test.ts | Codex grant 原 enforcement、Claude/invalid/hard guard 拒绝；**GREEN @ a52d6a93**：`runtime-route-catalog-routes.test.ts`「S05 Policy grant does not upgrade adapter enforcement」2/2 pass（RED suite @ c297872d：1 RED / 1 GREEN by design）|
| S06 | agent-runtime-core | refusals.json#S06 | query.test.ts | unknown/retired/missing/非法组合 route_not_found；overlap 仅 validation catalog_invalid；**GREEN @ a52d6a93**：`runtime-route-catalog-query.test.ts`「S06 Missing routes and invalid catalogs have distinct oracles」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S07 | agent-runtime-core | renderer.json#S07 | renderer.test.ts | 真实 claude.chat 对 Codex binding，rejectStaleRunPayload 原 message/hint、零 secret/factory；**GREEN @ a52d6a93**：`runtime-route-catalog-renderer.test.ts`「S07 A wrong desktop procedure cannot override the binding」2/2 pass（RED suite @ c297872d：0 RED / 2 GREEN by design）|
| S08 | agent-runtime-core | policy.json#S08 | routes.test.ts | 删除 preferredAdapterSource；fallbackReason:null 与 internal interactive 原拒绝；**GREEN @ a52d6a93**：`runtime-route-catalog-routes.test.ts`「S08 No dead preference option or implicit downgrade remains」2/2 pass（RED suite @ c297872d：2 RED / 0 GREEN by design）|
| S09 | agent-runtime-core | completion.json#S09 | completion.test.ts | 显式 profile、一次 upstream、零 agent child；**GREEN @ a52d6a93**：`runtime-route-catalog-completion.test.ts`「S09 Completion routes are provider-only execution」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S10 | agent-runtime-capabilities | capabilities.json#S10 | capabilities.test.ts | 引用 canonical manifest，adapter evidence 不虚报；**GREEN @ a52d6a93**：`runtime-route-catalog-capabilities.test.ts`「S10 Capability truth is referenced rather than copied」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S11 | agent-runtime-capabilities | readiness.json#S11 | capabilities.test.ts | default/native/cache/no-probe/missing route-probe→unknown 原行为，advisory 不阻断合法 admission；**GREEN @ a52d6a93**：`runtime-route-catalog-capabilities.test.ts`「S11 Readiness selects the existing probe without becoming admission」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S12 | agent-runtime-capabilities | capabilities.json#S12 | capabilities.test.ts | projection owner 决定可用性，无 adapter kind 不造 stub；**GREEN @ a52d6a93**：`runtime-route-catalog-capabilities.test.ts`「S12 Concrete projection availability is not guessed from the route」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S13 | agent-runtime-capabilities | extensions.json#S13 | capabilities.test.ts | 既有 schema、unknown optional 忽略、internal required 拒绝；**GREEN @ a52d6a93**：`runtime-route-catalog-capabilities.test.ts`「S13 Optional and required extensions are distinguished」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S14 | headless-agent-jobs | headless.json#S14 | headless.test.ts | CLI/daemon/schedule/protocol/API batch 原 argv/stdin/cancel；**GREEN @ a52d6a93**：`runtime-route-catalog-headless.test.ts`「S14 Existing batch behavior is preserved」2/2 pass（RED suite @ c297872d：1 RED / 1 GREEN by design）|
| S15 | headless-agent-jobs | headless.json#S15 | headless.test.ts | rich factory 可用也不暗选、unsupported 零 provider work；**GREEN @ a52d6a93**：`runtime-route-catalog-headless.test.ts`「S15 Rich adapter is not silently selected」2/2 pass（RED suite @ c297872d：1 RED / 1 GREEN by design）|
| S16 | headless-agent-jobs | executor.json#S16 | executor.test.ts | 两连接 kind dispatch 保留，test catalog 只转发/claim 后查，原 slots/exclusions；**GREEN @ a52d6a93**：`runtime-route-catalog-executor.test.ts`「S16 Concurrent pumps still execute an admitted Run once」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S17 | headless-agent-jobs | executor.json#S17 | executor.test.ts | replay/scoped wrapper/stdio 仍使用原 submission/pump；**GREEN @ a52d6a93**：`runtime-route-catalog-executor.test.ts`「S17 Submission replay and scoped protocol execution reuse existing owners」3/3 pass（RED suite @ c297872d：3 RED / 0 GREEN by design）|
| S18 | desktop-agent-jobs | renderer.json#S18 | renderer.test.ts | helper read-state 单测+两站点映射/不缓存 guard；unknown/unavailable/error 零订阅；**GREEN @ a52d6a93**：`runtime-route-catalog-renderer.test.ts`「S18 Both renderer entry points consume the binding descriptor」2/2 pass（RED suite @ c297872d：2 RED / 0 GREEN by design）|
| S19 | desktop-agent-jobs | renderer.json#S19 | renderer.test.ts | existing-wire fixture；具名 helper/event-state guards、question/guard/finish atom transitions；**GREEN @ a52d6a93**：`runtime-route-catalog-renderer.test.ts`「S19 A fixture Runtime reuses an existing wire family without core edits」3/3 pass（RED suite @ c297872d：2 RED / 1 GREEN by design）|
| S20 | desktop-agent-jobs | desktop-actions.json#S20 | renderer.test.ts | exact-owner cancel、source retry 拒绝不变；**GREEN @ a52d6a93**：`runtime-route-catalog-renderer.test.ts`「S20 Job actions preserve exact desktop ownership」1/1 pass（RED suite @ c297872d：0 RED / 1 GREEN by design）|
| S21 | local-job-api | public-contract.json#S21 | public-contract.test.ts | create/submit/wait/retry/status/events/result/cancel 全 bytes/channels/exits；**GREEN @ a52d6a93**：`runtime-route-catalog-public-contract.test.ts`「S21 Existing operations match frozen complete contract oracles」3/3 pass（RED suite @ c297872d：3 RED / 0 GREEN by design）|
| S22 | local-job-api | discovery.json#S22 | discovery.test.ts | 旧/新 schema/reader、unknown open values、exact keys、防 leaks、producer extensions；**GREEN @ a52d6a93**：`runtime-route-catalog-discovery.test.ts`「S22 Old discovery readers safely ignore optional summaries」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S23 | local-job-api | readiness.json#S23 | discovery.test.ts | submitter 与 daemon env 如实分离，no-probe 无 native work；**GREEN @ a52d6a93**：`runtime-route-catalog-discovery.test.ts`「S23 Readiness does not claim a different executor environment」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S24 | local-job-api | errors.json#S24 | public-contract.test.ts | 原 surface error/exit/JSON-RPC/IPC，无新 public code；**GREEN @ a52d6a93**：`runtime-route-catalog-public-contract.test.ts`「S24 Refusals retain surface-specific errors and exit codes」2/2 pass（RED suite @ c297872d：2 RED / 0 GREEN by design）|
| S25 | local-job-api | artifacts.json#S25 | public-contract.test.ts | Windows admission 与 incomplete publish 不被 route availability 绕过；**GREEN @ a52d6a93**：`runtime-route-catalog-public-contract.test.ts`「S25 Artifact and ledger residuals are not bypassed by route availability」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S26 | architecture-ownership | architecture-fixtures.json#S26 | guards.test.ts | runtime 分支/map/alias/namespace/wrapper/lifecycle leaf value-import exact findings；**GREEN @ a52d6a93**：`runtime-route-catalog-guards.test.ts`「S26 Duplicate routing is detected through direct and aliased forms」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S27 | architecture-ownership | architecture-fixtures.json#S27 | guards.test.ts | retired modules/exports/两分支 exact mutation；合法 rewires 由 S03/S11/S16 spies；**GREEN @ a52d6a93**：`runtime-route-catalog-guards.test.ts`「S27 All retired selector symbols and transport branches are absent」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S28 | architecture-ownership | architecture-fixtures.json#S28 | guards.test.ts | import direction、readiness cycle 拒绝；旧 ratchet 不放宽；**GREEN @ a52d6a93**：`runtime-route-catalog-guards.test.ts`「S28 Catalog imports preserve runtime core direction」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S29 | architecture-ownership | architecture-fixtures.json#S29 | guards.test.ts | 合法相邻 owner/P34 typed delegate 注入正例通过，配对重复选择 mutation 失败；**GREEN @ a52d6a93**：`runtime-route-catalog-guards.test.ts`「S29 Adjacent legitimate owners are not banned as routing duplicates」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S30 | architecture-ownership | architecture-fixtures.json#S30 | guards.test.ts | catalog 不新增状态 owner、无 env/fs/config，production test-port override 被拒绝；**GREEN @ a52d6a93**：`runtime-route-catalog-guards.test.ts`「S30 Catalog composition cannot create another business core」2/2 pass（RED suite @ c297872d：2 RED / 0 GREEN by design）|
| S31 | agent-runtime-core | routes.json#S31 | routes.test.ts | Codex desktop 失败不 exec fallback/重复 terminal；**GREEN @ a52d6a93**：`runtime-route-catalog-routes.test.ts`「S31 Codex desktop failure does not activate a batch fallback」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S32 | agent-runtime-core | provider.json#S32 | provider.test.ts | explicit/model/default/native precedence、cleanup、secret-safe projection；**GREEN @ a52d6a93**：`runtime-route-catalog-provider.test.ts`「S32 Provider precedence and secret handling stay with binding owners」2/2 pass（RED suite @ c297872d：2 RED / 0 GREEN by design）|
| S33 | agent-runtime-core | catalog.json#S33 | query.test.ts | 真实声明初始化、唯一 runtime、重复拒绝；**GREEN @ a52d6a93**：`runtime-route-catalog-query.test.ts`「S33 Runtime is registered」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S34 | agent-runtime-core | capabilities.json#S34 | capabilities.test.ts | 基本 route 不要求可选 unsupported native 能力；**GREEN @ a52d6a93**：`runtime-route-catalog-capabilities.test.ts`「S34 Runtime-specific behavior is not forced into the contract」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S35 | agent-runtime-core | capabilities.json#S35 | capabilities.test.ts | 只读 metadata/manifest 明确能力状态与理由；**GREEN @ a52d6a93**：`runtime-route-catalog-capabilities.test.ts`「S35 Caller requests runtime capabilities」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S36 | agent-runtime-core | capabilities.json#S36 | capabilities.test.ts | 声明 supported 的实际 adapter capability port 执行；**GREEN @ a52d6a93**：`runtime-route-catalog-capabilities.test.ts`「S36 Runtime declares support」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S37 | agent-runtime-core | capabilities.json#S37 | capabilities.test.ts | pre-execution 工具 allow/deny/rewrite 与诊断；**GREEN @ a52d6a93**：`runtime-route-catalog-capabilities.test.ts`「S37 Runtime supports hard tool guard」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S38 | agent-runtime-core | capabilities.json#S38 | capabilities.test.ts | 缺 pre-hook 不宣称 hard enforcement；**GREEN @ a52d6a93**：`runtime-route-catalog-capabilities.test.ts`「S38 Runtime lacks pre-tool interception」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S39 | agent-runtime-core | capabilities.json#S39 | capabilities.test.ts | Codex missing capability 从目录可测；**GREEN @ a52d6a93**：`runtime-route-catalog-capabilities.test.ts`「S39 Codex capability is missing」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S40 | agent-runtime-core | policy.json#S40 | routes.test.ts | grant enforcement evidence/原 scope-binding 或 refusal；**GREEN @ a52d6a93**：`runtime-route-catalog-routes.test.ts`「S40 Policy grant requires adapter enforcement」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S41 | agent-runtime-core | routes.json#S41 | routes.test.ts | Claude alias normalization/shared runner 原 events/result；**GREEN @ a52d6a93**：`runtime-route-catalog-routes.test.ts`「S41 Run Claude through shared runner」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S42 | agent-runtime-core | routes.json#S42 | routes.test.ts | Codex shared runner 原 events/result；**GREEN @ a52d6a93**：`runtime-route-catalog-routes.test.ts`「S42 Run Codex through shared runner」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S43 | agent-runtime-core | routes.json#S43 | routes.test.ts | headless/API default batch 与 source diagnostic；**GREEN @ a52d6a93**：`runtime-route-catalog-routes.test.ts`「S43 Default headless batch runtime is selected」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S44 | agent-runtime-core | policy.json#S44 | routes.test.ts | 无交互通道的 internal query 原拒绝；**GREEN @ a52d6a93**：`runtime-route-catalog-routes.test.ts`「S44 Interactive runtime is requested without interaction」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S45 | agent-runtime-core | policy.json#S45 | routes.test.ts | 保留 living fallback 标题；无隐式 downgrade，fallbackReason:null；**GREEN @ a52d6a93**：`runtime-route-catalog-routes.test.ts`「S45 Adapter selection falls back」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S46 | agent-runtime-core | refusals.json#S46 | query.test.ts | public parser 原 unsupported runtime；internal route_not_found；**GREEN @ a52d6a93**：`runtime-route-catalog-query.test.ts`「S46 Unsupported runtime requested」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S47 | agent-runtime-core | capabilities.json#S47 | capabilities.test.ts | required capability union gate/原诊断；**GREEN @ a52d6a93**：`runtime-route-catalog-capabilities.test.ts`「S47 Unsupported capability requested」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S48 | architecture-ownership | architecture-fixtures.json#S48 | guards.test.ts | 目录唯一 owner、route-local dispatch exact finding；**GREEN @ a52d6a93**：`runtime-route-catalog-guards.test.ts`「S48 Adapter selection changes」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S49 | architecture-ownership | routes.json#S49 | routes.test.ts | 真实 ledger/redaction 经 host 投影，不造第二 event owner；**GREEN @ a52d6a93**：`runtime-route-catalog-routes.test.ts`「S49 Runtime events cross surfaces」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S50 | architecture-ownership | architecture-fixtures.json#S50 | guards.test.ts | 无 selector dual path/production test flag；**GREEN @ a52d6a93**：`runtime-route-catalog-guards.test.ts`「S50 Temporary dual execution path is required」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S51 | codex-runtime-parity | capabilities.json#S51 | capabilities.test.ts | Codex manifest shared truth 从目录到 caller gate；**GREEN @ a52d6a93**：`runtime-route-catalog-capabilities.test.ts`「S51 Headless jobs depend on capability truth」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S52 | codex-runtime-parity | capabilities.json#S52 | capabilities.test.ts | supported claim 必须真实 enforcing port 测试；**GREEN @ a52d6a93**：`runtime-route-catalog-capabilities.test.ts`「S52 Parity claim is attempted without implementation」1/1 pass（RED suite @ c297872d：1 RED / 0 GREEN by design）|
| S53 | desktop-agent-jobs | renderer.json#S53 | renderer.test.ts | 真实 chat-query/createSubChat 经 withRuntimeRouteTransportId；两 runtime 值等于 renderer projection，DB 无该列，failure-state 无字段，main literal mapping guard；**GREEN @ a52d6a93**：`runtime-route-catalog-renderer.test.ts`「S53 Main stamps transport IDs only on the binding read model」4/4 pass（RED suite @ c297872d：4 RED / 0 GREEN by design）|

S22 的支持文件为同根 `discovery-schema-before.json`（冻结基线真实 schema 与 hash）及
`discovery-reader-before.ts`（注明规则来源的 neutral old reader）。它不是真实 consumer E2E。
Q1 若改为 internal-only，批准前同步删除 public delta/S22 及关联任务；不能留下“可不测”的场景。
Q2 若拒绝 binding read model 且没有可行替代，则 S18/S19/S53 与 desktop delta 必须先重写、重校验
和重新审批；不得用 renderer lookup/async lifecycle 隐式扩大边界。

### 3b. 逐测试结果（GREEN @ a52d6a93；十一份 red 文件，junit reporter 导出的完整标题）

命令：`bun test --isolate --reporter=junit` 显式列出十一份 red 文件；77 pass / 0 fail / 0 skip，414 `expect()`。

| Scenario | Test file | Test title | @ a52d6a93 |
| --- | --- | --- | --- |
| S01 | `runtime-route-catalog-query.test.ts` | S01 Invalid declarations cannot become executable — validator accepts production/valid/completion-null-probe tables, rejects every invalid variant with catalog_invalid, and the test constructor returns that same non-executable failure state without factory/probe calls | PASS |
| S01 | `runtime-route-catalog-query.test.ts` | S01 Invalid declarations cannot become executable — an injected failure state makes resolve return catalog_invalid, list/projection reject without partial output, and both discovery CLI forms reject with exactly the sanitized message and empty stdout | PASS |
| S01 | `runtime-route-catalog-query.test.ts` | S01 Invalid declarations cannot become executable — a run command meeting the injected failure state settles runtime_error with exit 1 and the sanitized message instead of rejecting | PASS |
| S01 | `runtime-route-catalog-query.test.ts` | S01 Invalid declarations cannot become executable — both named desktop hosts given the failure state surface only the sanitized message through their existing error channel and call no delegate or native SDK | PASS |
| S02 | `runtime-route-catalog-query.test.ts` | S02 Query and enumeration are deterministic and side-effect free — permuted declarations and duplicate capability requests resolve the same route, enumeration keeps a stable routeId order, caller mutation cannot change a later query, and recording ports stay uncalled | PASS |
| S03 | `runtime-route-catalog-routes.test.ts` | S03 Desktop routes select the existing native adapters — after the real Claude admission, runClaudeAgentSdkDesktopRuntimeWithMcpReadiness queries its fixed runtime and invokes only the catalog SDK delegate once with the unchanged verified request, before any native SDK work | PASS |
| S03 | `runtime-route-catalog-routes.test.ts` | S03 Desktop routes select the existing native adapters — after the real Codex admission, NEW runCodexDesktopChatRun queries its fixed runtime and invokes only the catalog app-server delegate once with the unchanged verified request and secret-bearing ports | PASS |
| S03 | `runtime-route-catalog-routes.test.ts` | S03 Desktop routes select the existing native adapters — source guards bind claude.chat and codex.chat to their named hosts after admission, with no direct leaf value import in the routers or the Claude lifecycle | PASS |
| S03 | `runtime-route-catalog-routes.test.ts` | S03 Desktop routes select the existing native adapters — codex.getRuntimeStatus keeps its baseline adapters.selection projection and adapter-source hint bytes (green-by-design characterization) | PASS |
| S04 | `runtime-route-catalog-routes.test.ts` | S04 Entry surfaces resolve to the same batch leaf — headless/api/protocol queries for both runtimes yield the runtime's batch adapterSource, executionSurface headless-exec and the identical leaf delegate, with ready rich probes untouched and the query unchanged | PASS |
| S05 | `runtime-route-catalog-routes.test.ts` | S05 Policy grant does not upgrade adapter enforcement — direct Codex app-server leaf calls with wrong runtime, wrong profile or empty grantedScopes keep unsupported_runtime / unsupported_execution_profile / permission_policy_fail_closed with zero createDesktopAdapter calls (green-by-design characterization of the retained P05 assertion) | PASS |
| S05 | `runtime-route-catalog-routes.test.ts` | S05 Policy grant does not upgrade adapter enforcement — only a valid Codex grant selects headless-app-server with admission-audit-only binding; Claude grant, fail-closed, interactive, invalid grant, hard guard, out-of-union profile and capability variants refuse in the baseline order with baseline codes and messages | PASS |
| S06 | `runtime-route-catalog-query.test.ts` | S06 Missing routes and invalid catalogs have distinct oracles — an overlapping table fails only at validation, while unknown, retired, missing-entry and illegal kind/mode queries return route_not_found with no delegate, no ambiguity result and no calls | PASS |
| S07 | `runtime-route-catalog-renderer.test.ts` | S07 A wrong desktop procedure cannot override the binding — the real claude.chat procedure on a durable Codex subChat emits the original rejectStaleRunPayload message/hint with zero desktop-host, secret, provider and credential calls and leaves the durable binding unchanged | PASS |
| S07 | `runtime-route-catalog-renderer.test.ts` | S07 A wrong desktop procedure cannot override the binding — routeId/transportId never cross chat request IPC: both strict chat inputs refuse a descriptor-carrying request and neither renderer transport sends a descriptor field | PASS |
| S08 | `runtime-route-catalog-routes.test.ts` | S08 No dead preference option or implicit downgrade remains — accepted batch queries keep diagnostic and public runtime_selected fallbackReason:null, the internal interactive query keeps interactive_channel_required, and the retired selector module with its preference option is gone | PASS |
| S08 | `runtime-route-catalog-routes.test.ts` | S08 No dead preference option or implicit downgrade remains — the retired-route-selector guard rejects a source fixture importing the retired preferredAdapterSource option instead of passing it as clean | PASS |
| S09 | `runtime-route-catalog-completion.test.ts` | S09 Completion routes are provider-only execution — both runtime-family completions run through the existing completion runner with exactly one upstream call and no agent delegate, child or run directory, keep locus-completion provenance, and the catalog separately describes them as provider-only completion routes | PASS |
| S10 | `runtime-route-catalog-capabilities.test.ts` | S10 Capability truth is referenced rather than copied — resolver and discovery envelope read one injected manifest port, mutation never changes truth, and desktop support never lifts a headless enforcement limit | PASS |
| S11 | `runtime-route-catalog-capabilities.test.ts` | S11 Readiness selects the existing probe without becoming admission — default/native order, 30000 ms shared cache, no-probe/exception/missing-route/null-probe unknown, advisory never gates resolution | PASS |
| S12 | `runtime-route-catalog-capabilities.test.ts` | S12 Concrete projection availability is not guessed from the route — the registered projection owner reports unavailable, an unregistered kind stays registered=false/records=[], and route outputs carry no install/usability label | PASS |
| S13 | `runtime-route-catalog-capabilities.test.ts` | S13 Optional and required extensions are distinguished — runtime.codex.v1 keeps schemaVersion 1/experimental, malformed declarations are catalog_invalid, an unknown required internal extension fails before any factory call, and declared extensions equal the actual ledger producer | PASS |
| S14 | `runtime-route-catalog-headless.test.ts` | S14 Existing batch behavior is preserved — CLI, daemon, schedule, protocol and API hosts start codex exec / claude -p with the baseline argv, stdin, source and cancellation port and the baseline runtime_selected payload | PASS |
| S14 | `runtime-route-catalog-headless.test.ts` | S14 Existing batch behavior is preserved — every real host forwards its runtimeRouteCatalog option to runAgentTask, which runs the catalog batch leaf (one post-binding factory lookup, one delegate call) with unchanged argv, source and cancellation port and never a rich factory | PASS |
| S15 | `runtime-route-catalog-headless.test.ts` | S15 Rich adapter is not silently selected — baseline runAgentTask runs only the batch leaf for batch requests and refuses interactive-only / guarded-scope requests with the original diagnostic before any leaf start | PASS |
| S15 | `runtime-route-catalog-headless.test.ts` | S15 Rich adapter is not silently selected — runAgentTask with a runtimeRouteCatalog holding batch and rich factories invokes only the batch delegate for batch requests and no delegate, no rich lookup and no native leaf start for interactive-only / guarded-scope requests | PASS |
| S16 | `runtime-route-catalog-executor.test.ts` | S16 Concurrent pumps still execute an admitted Run once — two pumpQueuedRuns instances on independent connections each forward their own runtimeRouteCatalog unchanged; the winner alone looks up and invokes the batch leaf after claim and provider binding, the loser and the completion runner never touch the catalog, daemon→schedule→api order and source exclusions hold and no catalog row/event is written | PASS |
| S17 | `runtime-route-catalog-executor.test.ts` | S17 Submission replay and scoped protocol execution reuse existing owners — a matching keyed submit replays its one job before and after execution, and the catalog factory is looked up and invoked exactly once for that job | PASS |
| S17 | `runtime-route-catalog-executor.test.ts` | S17 Submission replay and scoped protocol execution reuse existing owners — the own-ID synchronous create wrapper forwards runtimeRouteCatalog through the existing pump and dispatches only its admitted ID, leaving a foreign queued API Run and a daemon Run untouched | PASS |
| S17 | `runtime-route-catalog-executor.test.ts` | S17 Submission replay and scoped protocol execution reuse existing owners — a jobs-stdio session forwards runtimeRouteCatalog to its session-scoped pump, acks before execution, dispatches only its admitted ID, and a competing claimant on another connection loses without any catalog lookup | PASS |
| S18 | `runtime-route-catalog-renderer.test.ts` | S18 Both renderer entry points consume the binding descriptor — createRuntimeRouteTransport returns {ok:true,transport} from the compiled constructor for loaded known IDs with the baseline config, and route_descriptor_unavailable / route_descriptor_error / unknown_transport with zero constructor or subscription calls and no Claude fallback, after which a loaded retry succeeds | PASS |
| S18 | `runtime-route-catalog-renderer.test.ts` | S18 Both renderer entry points consume the binding descriptor — renderer-route-projection-bypass passes the repository and the clean two-site fixture, and reports Chat caching on ok:false, a binding.runtime comparison and an unmapped read error as unexpected findings | PASS |
| S19 | `runtime-route-catalog-renderer.test.ts` | S19 A fixture Runtime reuses an existing wire family without core edits — an isolated validated catalog resolves the fixture Runtime's fixed-runtime delegate, its read-only renderer projection carries only {routeId,runtimeId,transportId} for an existing wire transportId that createRuntimeRouteTransport constructs, and the production projection stays the two existing runtimes | PASS |
| S19 | `runtime-route-catalog-renderer.test.ts` | S19 A fixture Runtime reuses an existing wire family without core edits — the shared event-state owner applies the fixture Runtime's normalized question/guard/finish chunks with the baseline atom transitions and no runtime input (green-by-design characterization) | PASS |
| S19 | `runtime-route-catalog-renderer.test.ts` | S19 A fixture Runtime reuses an existing wire family without core edits — renderer-route-projection-bypass passes the repository (runtime-route-transport.ts and runtime-event-state.ts) and the clean transportId-keyed helper fixture, and reports a helper runtime-ID branch as an unexpected finding | PASS |
| S20 | `runtime-route-catalog-renderer.test.ts` | S20 Job actions preserve exact desktop ownership — Workbench cancel of the old desktop job reaches only its own stream owner, desktop retry stays linked-chat-only, API retry stays CLI-API-only, headless cancel/retry use the store owner with baseline envelopes, and neither owner consults the catalog (green-by-design characterization) | PASS |
| S21 | `runtime-route-catalog-public-contract.test.ts` | S21 Existing operations match frozen complete contract oracles — agent create, keyed submit/replay/conflict, wait timeout(9)/ready, status, events --after/--follow, result, retry sync/--async, cancel and the named claude-policy-grant, fail-closed and codex grant cases reproduce the 6192b13f bytes, channels, exits and leaf calls through the runtimeRouteCatalog host option | PASS |
| S21 | `runtime-route-catalog-public-contract.test.ts` | S21 Existing operations match frozen complete contract oracles — completion create, keyed submit/replay/conflict, wait timeout(9)/ready, status, events --after/--follow, result, retry sync/--async of a failed Run and cancel reproduce the 6192b13f bytes with one upstream call per executed Run and zero agent leaf calls through the runtimeRouteCatalog host option | PASS |
| S21 | `runtime-route-catalog-public-contract.test.ts` | S21 Existing operations match frozen complete contract oracles — runAgentTask with the third-argument runtimeRouteCatalog emits the internal interactive-refusal oracle and runtime_selected / runtime_selection_refused payloads with exactly the 6192b13f key sets (policyGrantScopeBinding only for the codex grant case) and no routeId/transportId/internal reason | PASS |
| S22 | `runtime-route-catalog-discovery.test.ts` | S22 Old discovery readers safely ignore optional summaries — actual runtimes list carries experimental runtimes[].routes that both schemas accept, keep the old reader's common-core decisions (also under unknown open values), match the catalog's surface=api accepted combinations with exact keys, and the new schema rejects leaked internal fields and out-of-vocabulary kind/profile | PASS |
| S23 | `runtime-route-catalog-discovery.test.ts` | S23 Readiness does not claim a different executor environment — no-probe discovery performs no native probe and keeps the baseline readiness bytes beside routes that carry no environment, while a daemon-claimed API Run and a no-daemon wrapper Run each execute under their own command without persisting any submitter/daemon/wrapper environment value | PASS |
| S24 | `runtime-route-catalog-public-contract.test.ts` | S24 Refusals retain surface-specific errors and exit codes — admission unsupported_capability (3), parser (3), provider profile (2), claude grant / fail-closed runtime refusals (1), wait-only timeout (9), claim-gate failure, run/schedule regex mappings (3/7), jobs-stdio -32700/-32601/verbatim -32602 and the adapter-local exit 1 vs normalized 3 reproduce the 6192b13f oracles through the catalog with no catalog reason in any channel | PASS |
| S24 | `runtime-route-catalog-public-contract.test.ts` | S24 Refusals retain surface-specific errors and exit codes — an injected RuntimeRouteCatalogFailureState settles API create as the runner-level runtime_error/1 envelope with exactly "Runtime route catalog is unavailable." and zero leaf work, and runtimes list rejects with that message and no stdout | PASS |
| S25 | `runtime-route-catalog-public-contract.test.ts` | S25 Artifact and ledger residuals are not bypassed by route availability — with an available route a win32 stable-directory refusal keeps the baseline failed/artifact_admission_failed bytes and an incomplete registered-file publication stays non-ready (9) with no event, file or settlement added by wait | PASS |
| S26 | `runtime-route-catalog-guards.test.ts` | S26 Duplicate routing is detected through direct and aliased forms — every if/switch, runtime-keyed map, aliased/namespace retired-selector, one-hop wrapper and fixed-runtime direct leaf import (including the Claude lifecycle) case yields exactly its expected tuples, mismatches fail by case id, and the existing ledger/async self-test summaries stay unchanged | PASS |
| S27 | `runtime-route-catalog-guards.test.ts` | S27 All retired selector symbols and transport branches are absent — each restored module/export/forwarding alias/active-chat branch fixture yields its exact retired-route-selector or renderer-route-projection-bypass tuple, while the production tree has no retired module, symbol or Engine transport branch and keeps the ledger helpers, adapter-local assertion and pump kind dispatch | PASS |
| S28 | `runtime-route-catalog-guards.test.ts` | S28 Catalog imports preserve runtime core direction — clean lazy factory/probe references pass while Electron, tRPC, renderer, preload, router, router-through-wrapper and readiness-to-catalog imports each yield their exact route-catalog-forbidden-dependency tuple, and no architecture baseline gains a catalog entry | PASS |
| S29 | `runtime-route-catalog-guards.test.ts` | S29 Adjacent legitimate owners are not banned as routing duplicates — provider target/purpose, policy mode, source cancel, command/method parsing, native decoding, selected-route assertions, transportId-only construction, chunk.type, binding admit/provider target, desktop allowlist, active-chat adjacent branches, manifest aliases, job-runner seams, pump kind dispatch, the injected Claude lifecycle delegate and the projection-based read model pass, while each paired runtimeId-chooses-a-second-adapter mutation fails with its exact tuples | PASS |
| S30 | `runtime-route-catalog-guards.test.ts` | S30 Catalog composition cannot create another business core — job/event insertion, claim, sequence allocation, terminal settlement, artifact preparation, provider-storage reads, process.env/fs/config reads, a production second catalog or test constructor and a non-forwarded production runtimeRouteCatalog option each yield their exact tuple against the canonical owner while the selection-only catalog passes; the production catalog itself reads no env/fs/config | PASS |
| S30 | `runtime-route-catalog-guards.test.ts` | S30 Catalog composition cannot create another business core — real API create and a jobs-stdio job.run reach submitRun and pumpQueuedRuns through the injected catalog with exactly one recording leaf call per Run and no second dispatch loop | PASS |
| S31 | `runtime-route-catalog-routes.test.ts` | S31 Codex desktop failure does not activate a batch fallback — runCodexDesktopChatRun invokes only the selected failing app-server delegate, returns its failure unchanged for the existing finalizer and never invokes the exec delegate or touches the Run ledger | PASS |
| S32 | `runtime-route-catalog-provider.test.ts` | S32 Provider precedence and secret handling stay with binding owners — explicit/model-only/default/native precedence and baseline errors are unchanged, the catalog-selected delegate receives the owner's binding only after provider binding, bad selections never reach native work, and gateway cleanup runs through the owner | PASS |
| S32 | `runtime-route-catalog-provider.test.ts` | S32 Provider precedence and secret handling stay with binding owners — catalog descriptors, projections and resolutions carry no sentinel credentials, headers, env values or factory functions, and catalog queries never read or decrypt provider storage | PASS |
| S33 | `runtime-route-catalog-query.test.ts` | S33 Runtime is registered — the real production declarations validate, each supported runtime declares id, display metadata, shared-owner manifest, run entry point, cancellation and session reference, a duplicate runtime is rejected, and the renderer projection is non-secret | PASS |
| S34 | `runtime-route-catalog-capabilities.test.ts` | S34 Runtime-specific behavior is not forced into the contract — a basic Codex route resolves with manifestRef and delegate while rollback/commands/workflows/plugins requests keep the existing capability refusal and the basic request carries no optional fields | PASS |
| S35 | `runtime-route-catalog-capabilities.test.ts` | S35 Caller requests runtime capabilities — renderer/public route projections stay sanitized while desktop, CLI and main callers all read the shared explicit supported/degraded/unsupported states with reasons | PASS |
| S36 | `runtime-route-catalog-capabilities.test.ts` | S36 Runtime declares support — each catalog-selected desktop adapter's supported hardToolGuard/planMode/quickChatAssistant claim is observed through its actual enforcing port, and a mismatched declared result fails conformance | PASS |
| S37 | `runtime-route-catalog-capabilities.test.ts` | S37 Runtime supports hard tool guard — the catalog selects pre-execution desktop adapters whose tool-decision ports allow, deny and rewrite before execution and emit guard events | PASS |
| S38 | `runtime-route-catalog-capabilities.test.ts` | S38 Runtime lacks pre-tool interception — headless leaves expose only sandbox-level/admission-audit evidence and the baseline guarded-scope refusal, and prompt-only/post-run-audit manifest variants surface only their degraded/unsupported state in discovery and the capability gate | PASS |
| S39 | `runtime-route-catalog-capabilities.test.ts` | S39 Codex capability is missing — canonical Codex rollback stays unsupported in the renderer DTO, CLI discovery and shared gate while every catalog surface refuses a rollback-requiring query with capability_refused and no delegate | PASS |
| S40 | `runtime-route-catalog-routes.test.ts` | S40 Policy grant requires adapter enforcement — a bounded Codex grant is limited to the admission/audit gate with a sanitized admission-audit-only diagnostic, while Claude grant and guarded-scope grant fail closed before provider work | PASS |
| S41 | `runtime-route-catalog-routes.test.ts` | S41 Run Claude through shared runner — a claude alias normalized by the shared owner resolves and runs the Claude batch adapter selected by the catalog, emitting normalized events and returning the normalized result | PASS |
| S42 | `runtime-route-catalog-routes.test.ts` | S42 Run Codex through shared runner — runAgentTask runs the Codex batch adapter selected by the catalog, emitting normalized events and returning the normalized result | PASS |
| S43 | `runtime-route-catalog-routes.test.ts` | S43 Default headless batch runtime is selected — headless and API default requests for Codex and Claude resolve and run the process-backed batch adapter despite ready rich references, and the selection diagnostic names the adapter source without exposing secrets | PASS |
| S44 | `runtime-route-catalog-routes.test.ts` | S44 Interactive runtime is requested without interaction — internal interactive callbacks with no approved channel or grant are refused by the catalog's existing refusal chain before provider work with the sanitized fail-closed diagnostic | PASS |
| S45 | `runtime-route-catalog-routes.test.ts` | S45 Adapter selection falls back — batch selection keeps fallbackReason:null with exact runtime_selected keys, an internal interactive request keeps its original refusal keys, a smuggled preference cannot change the selection, and batch metadata never claims pre-execution enforcement | PASS |
| S46 | `runtime-route-catalog-query.test.ts` | S46 Unsupported runtime requested — the existing public parsers keep their normalized unsupported-runtime errors while the internal query returns route_not_found, both with zero provider and delegate calls | PASS |
| S47 | `runtime-route-catalog-capabilities.test.ts` | S47 Unsupported capability requested — the owner-derived implicit/explicit capability union is refused with the baseline unsupported_capability diagnostic before any provider work, independent of union order | PASS |
| S48 | `runtime-route-catalog-guards.test.ts` | S48 Adapter selection changes — catalog declarations for batch, SDK, app-server and a future source yield zero findings while route, CLI, protocol and Local Job API files that select from a second adapter table yield their exact route-dispatch-outside-owner tuples; OWNERSHIP_MAP names the single owner and drops the superseded selection section | PASS |
| S49 | `runtime-route-catalog-routes.test.ts` | S49 Runtime events cross surfaces — a run executed by the named hosts reaches the canonical ledger and redaction owners: committed records and the CLI-projected envelopes equal the baseline (redaction and order) and neither the catalog nor the desktop host creates an event | PASS |
| S50 | `runtime-route-catalog-guards.test.ts` | S50 Temporary dual execution path is required — the restored-selector and dual-path-flag mutations are rejected with their exact retired-route-selector / route-catalog-test-port-in-production tuples and the production source has neither an old selector nor a runtime-route path-selection flag | PASS |
| S51 | `runtime-route-catalog-capabilities.test.ts` | S51 Headless jobs depend on capability truth — every canonical Codex state is identical in catalog headless resolution, CLI discovery and the shared caller gate, and refused capabilities hand out no delegate | PASS |
| S52 | `runtime-route-catalog-capabilities.test.ts` | S52 Parity claim is attempted without implementation — supported Codex claims pass only through the catalog-selected app-server enforcing port; prompt-only, UI-label, indexed-documentation and post-run-audit variants never call it and fail conformance | PASS |
| S53 | `runtime-route-catalog-renderer.test.ts` | S53 Main stamps transport IDs only on the binding read model — the real getSubChat and createSubChat procedures return binding.transportId equal to the production renderer projection for claude-code and codex while the persisted binding rows and schema carry no transport column | PASS |
| S53 | `runtime-route-catalog-renderer.test.ts` | S53 Main stamps transport IDs only on the binding read model — the chat query (chats.get) that feeds the getOrCreateChat construction site returns each sub-chat binding stamped with its renderer transportId | PASS |
| S53 | `runtime-route-catalog-renderer.test.ts` | S53 Main stamps transport IDs only on the binding read model — withRuntimeRouteTransportId stamps a copy from a validated test catalog's renderer projection, omits transportId for the createRuntimeRouteCatalogForTests failure state (mapped to {state:"not-loaded"} → route_descriptor_unavailable) and never writes the durable binding | PASS |
| S53 | `runtime-route-catalog-renderer.test.ts` | S53 Main stamps transport IDs only on the binding read model — renderer-route-projection-bypass passes the repository and a main composition calling withRuntimeRouteTransportId, and reports a main runtimeId→transportId literal mapping as an unexpected finding | PASS |

合计 77 条：77 PASS；覆盖 53 个 scenario；未映射 0。RED 时状态见 §3c（历史）。

### 3c. 历史：RED suite 逐测试登记（suite SHA c297872d；实现前状态）

| Scenario | Test file | Test title | State @ suite SHA |
| --- | --- | --- | --- |
| S01 | `runtime-route-catalog-query.test.ts` | S01 Invalid declarations cannot become executable | RED |
| S01 | `runtime-route-catalog-query.test.ts` | S01 Invalid declarations cannot become executable | RED |
| S01 | `runtime-route-catalog-query.test.ts` | S01 Invalid declarations cannot become executable | RED |
| S01 | `runtime-route-catalog-query.test.ts` | S01 Invalid declarations cannot become executable | RED |
| S02 | `runtime-route-catalog-query.test.ts` | S02 Query and enumeration are deterministic and side-effect free | RED |
| S03 | `runtime-route-catalog-routes.test.ts` | S03 Desktop routes select the existing native adapters | RED |
| S03 | `runtime-route-catalog-routes.test.ts` | S03 Desktop routes select the existing native adapters | RED |
| S03 | `runtime-route-catalog-routes.test.ts` | S03 Desktop routes select the existing native adapters | RED |
| S03 | `runtime-route-catalog-routes.test.ts` | S03 Desktop routes select the existing native adapters | GREEN by design |
| S04 | `runtime-route-catalog-routes.test.ts` | S04 Entry surfaces resolve to the same batch leaf | RED |
| S05 | `runtime-route-catalog-routes.test.ts` | S05 Policy grant does not upgrade adapter enforcement | GREEN by design |
| S05 | `runtime-route-catalog-routes.test.ts` | S05 Policy grant does not upgrade adapter enforcement | RED |
| S06 | `runtime-route-catalog-query.test.ts` | S06 Missing routes and invalid catalogs have distinct oracles | RED |
| S07 | `runtime-route-catalog-renderer.test.ts` | S07 A wrong desktop procedure cannot override the binding | GREEN by design |
| S07 | `runtime-route-catalog-renderer.test.ts` | S07 A wrong desktop procedure cannot override the binding | GREEN by design |
| S08 | `runtime-route-catalog-routes.test.ts` | S08 No dead preference option or implicit downgrade remains | RED |
| S08 | `runtime-route-catalog-routes.test.ts` | S08 No dead preference option or implicit downgrade remains | RED |
| S09 | `runtime-route-catalog-completion.test.ts` | S09 Completion routes are provider-only execution | RED |
| S10 | `runtime-route-catalog-capabilities.test.ts` | S10 Capability truth is referenced rather than copied | RED |
| S11 | `runtime-route-catalog-capabilities.test.ts` | S11 Readiness selects the existing probe without becoming admission | RED |
| S12 | `runtime-route-catalog-capabilities.test.ts` | S12 Concrete projection availability is not guessed from the route | RED |
| S13 | `runtime-route-catalog-capabilities.test.ts` | S13 Optional and required extensions are distinguished | RED |
| S14 | `runtime-route-catalog-headless.test.ts` | S14 Existing batch behavior is preserved | GREEN by design |
| S14 | `runtime-route-catalog-headless.test.ts` | S14 Existing batch behavior is preserved | RED |
| S15 | `runtime-route-catalog-headless.test.ts` | S15 Rich adapter is not silently selected | GREEN by design |
| S15 | `runtime-route-catalog-headless.test.ts` | S15 Rich adapter is not silently selected | RED |
| S16 | `runtime-route-catalog-executor.test.ts` | S16 Concurrent pumps still execute an admitted Run once | RED |
| S17 | `runtime-route-catalog-executor.test.ts` | S17 Submission replay and scoped protocol execution reuse existing owners | RED |
| S17 | `runtime-route-catalog-executor.test.ts` | S17 Submission replay and scoped protocol execution reuse existing owners | RED |
| S17 | `runtime-route-catalog-executor.test.ts` | S17 Submission replay and scoped protocol execution reuse existing owners | RED |
| S18 | `runtime-route-catalog-renderer.test.ts` | S18 Both renderer entry points consume the binding descriptor | RED |
| S18 | `runtime-route-catalog-renderer.test.ts` | S18 Both renderer entry points consume the binding descriptor | RED |
| S19 | `runtime-route-catalog-renderer.test.ts` | S19 A fixture Runtime reuses an existing wire family without core edits | RED |
| S19 | `runtime-route-catalog-renderer.test.ts` | S19 A fixture Runtime reuses an existing wire family without core edits | GREEN by design |
| S19 | `runtime-route-catalog-renderer.test.ts` | S19 A fixture Runtime reuses an existing wire family without core edits | RED |
| S20 | `runtime-route-catalog-renderer.test.ts` | S20 Job actions preserve exact desktop ownership | GREEN by design |
| S21 | `runtime-route-catalog-public-contract.test.ts` | S21 Existing operations match frozen complete contract oracles | RED |
| S21 | `runtime-route-catalog-public-contract.test.ts` | S21 Existing operations match frozen complete contract oracles | RED |
| S21 | `runtime-route-catalog-public-contract.test.ts` | S21 Existing operations match frozen complete contract oracles | RED |
| S22 | `runtime-route-catalog-discovery.test.ts` | S22 Old discovery readers safely ignore optional summaries | RED |
| S23 | `runtime-route-catalog-discovery.test.ts` | S23 Readiness does not claim a different executor environment | RED |
| S24 | `runtime-route-catalog-public-contract.test.ts` | S24 Refusals retain surface-specific errors and exit codes | RED |
| S24 | `runtime-route-catalog-public-contract.test.ts` | S24 Refusals retain surface-specific errors and exit codes | RED |
| S25 | `runtime-route-catalog-public-contract.test.ts` | S25 Artifact and ledger residuals are not bypassed by route availability | RED |
| S26 | `runtime-route-catalog-guards.test.ts` | S26 Duplicate routing is detected through direct and aliased forms | RED |
| S27 | `runtime-route-catalog-guards.test.ts` | S27 All retired selector symbols and transport branches are absent | RED |
| S28 | `runtime-route-catalog-guards.test.ts` | S28 Catalog imports preserve runtime core direction | RED |
| S29 | `runtime-route-catalog-guards.test.ts` | S29 Adjacent legitimate owners are not banned as routing duplicates | RED |
| S30 | `runtime-route-catalog-guards.test.ts` | S30 Catalog composition cannot create another business core | RED |
| S30 | `runtime-route-catalog-guards.test.ts` | S30 Catalog composition cannot create another business core | RED |
| S31 | `runtime-route-catalog-routes.test.ts` | S31 Codex desktop failure does not activate a batch fallback | RED |
| S32 | `runtime-route-catalog-provider.test.ts` | S32 Provider precedence and secret handling stay with binding owners | RED |
| S32 | `runtime-route-catalog-provider.test.ts` | S32 Provider precedence and secret handling stay with binding owners | RED |
| S33 | `runtime-route-catalog-query.test.ts` | S33 Runtime is registered | RED |
| S34 | `runtime-route-catalog-capabilities.test.ts` | S34 Runtime-specific behavior is not forced into the contract | RED |
| S35 | `runtime-route-catalog-capabilities.test.ts` | S35 Caller requests runtime capabilities | RED |
| S36 | `runtime-route-catalog-capabilities.test.ts` | S36 Runtime declares support | RED |
| S37 | `runtime-route-catalog-capabilities.test.ts` | S37 Runtime supports hard tool guard | RED |
| S38 | `runtime-route-catalog-capabilities.test.ts` | S38 Runtime lacks pre-tool interception | RED |
| S39 | `runtime-route-catalog-capabilities.test.ts` | S39 Codex capability is missing | RED |
| S40 | `runtime-route-catalog-routes.test.ts` | S40 Policy grant requires adapter enforcement | RED |
| S41 | `runtime-route-catalog-routes.test.ts` | S41 Run Claude through shared runner | RED |
| S42 | `runtime-route-catalog-routes.test.ts` | S42 Run Codex through shared runner | RED |
| S43 | `runtime-route-catalog-routes.test.ts` | S43 Default headless batch runtime is selected | RED |
| S44 | `runtime-route-catalog-routes.test.ts` | S44 Interactive runtime is requested without interaction | RED |
| S45 | `runtime-route-catalog-routes.test.ts` | S45 Adapter selection falls back | RED |
| S46 | `runtime-route-catalog-query.test.ts` | S46 Unsupported runtime requested | RED |
| S47 | `runtime-route-catalog-capabilities.test.ts` | S47 Unsupported capability requested | RED |
| S48 | `runtime-route-catalog-guards.test.ts` | S48 Adapter selection changes | RED |
| S49 | `runtime-route-catalog-routes.test.ts` | S49 Runtime events cross surfaces | RED |
| S50 | `runtime-route-catalog-guards.test.ts` | S50 Temporary dual execution path is required | RED |
| S51 | `runtime-route-catalog-capabilities.test.ts` | S51 Headless jobs depend on capability truth | RED |
| S52 | `runtime-route-catalog-capabilities.test.ts` | S52 Parity claim is attempted without implementation | RED |
| S53 | `runtime-route-catalog-renderer.test.ts` | S53 Main stamps transport IDs only on the binding read model | RED |
| S53 | `runtime-route-catalog-renderer.test.ts` | S53 Main stamps transport IDs only on the binding read model | RED |
| S53 | `runtime-route-catalog-renderer.test.ts` | S53 Main stamps transport IDs only on the binding read model | RED |
| S53 | `runtime-route-catalog-renderer.test.ts` | S53 Main stamps transport IDs only on the binding read model | RED |

合计 77 条：69 RED / 8 GREEN by design；覆盖 53 个 scenario；未映射 0。

## 4. 设计未规定处的实施决定（三份实施报告合并）

以下是 design/red-receipt 未冻结、由实施者确定并已被对应评审复核的形状；均为内部形状，
不改变任何公共合同（C7 分类见 §6）。来源：Phase I 报告 items 1–11、Phase II 报告 items 1–12、
T1 报告 deviations 1–5。

| # | 决定 | 来源 / 提交 | 复核 |
| --- | --- | --- | --- |
| 1 | Validated catalog = deep-frozen 不透明 handle `{kind:"runtime-route-catalog", routeIds}`，经 module-private WeakMap 认证；validator `{ok:true,catalog}`；失败态 `{ok:false, reason:"catalog_invalid", offending:{runtimeId, routeId, conflictingRouteId, field, problem}}`（deep-frozen，overlap 指出两条 route，畸形输入不 throw）；伪造 handle → catalog_invalid | Phase I 1；`1bceedf7` | Phase I 两镜头 |
| 2 | 生产 reference keys：`manifestRef` = canonical runtime alias，经 `resolveAgentRuntimeCapabilityManifest` 解析；factory/evidence refs `headless:<adapterSource>` / `desktop:<adapterSource>`；probe refs `readiness:<runtimeId>`；factory 为 lazy dynamic-import wrapper，查询或 import 时不构造 adapter | Phase I 2；`1bceedf7` | Phase I design 镜头 1 |
| 3 | Leaf enforcement evidence 为 typed 常量：headless 三个 leaf 导出其常量，目录 evidence 表经 `typeof import(leaf).X` 类型绑定，值留在无副作用 evidence 模块（目录 import 时不加载 leaf）；desktop evidence 在 desktop adapter metadata 旁 | Phase I 3；Phase II（tests-security P3）`06a63b9c` | Phase II tests-security |
| 4 | Resolve ok 结果追加 `kind`；`manifestRef` = `{ref, runtimeId, label}`（不含 capability 主体）；`runtime_selected.label` = `manifestRef.label`；extensions 内部保留 `redactionOwner`，public summary 省略 | Phase I 4 | Phase I 两镜头（public payload bytes 不变） |
| 5 | **Selected 诊断措辞**：内部 selection message 为 `Selected X for ${entry} ${profile} execution.`，用 query entry（api/protocol/headless/desktop）代替基线的 Run source（RouteQuery 无 source，D1）。daemon/schedule/cli/desktop 来源的文字由“for daemon batch”变为“for headless batch”；`runtime_selected` payload 从不携带 `message`，API/protocol 文字逐字相同，公共面无变化 | Phase I 5；Phase I design P3-3 | 接受（§5） |
| 6 | `route_not_found` / `catalog_invalid` 结果携带 `{errorCode:"runtime_error", errorMessage:"Runtime route catalog is unavailable."}`；`unsupported_required_extension` 有自身 code；runAgentTask 只对 policy/capability 拒绝发 `runtime_selection_refused`，其他失败抛出脱敏 message（经 job runner 结算 runtime_error/1） | Phase I 6 | Phase I tests-security（无新 public code/exit） |
| 7 | 绑定后 `lookupAgentFactory` 返回 null → catalog_invalid（S24 子句；`tests/runtime-route-catalog-null-factory.test.ts`）；Phase II `f5e64523` 起目录只要求解析出的 factory reference 非 null（不再要求是 function，以便 S19 绑定不透明 fixture delegate），调用点（两个 host、runAgentTask）各自 `typeof === "function"` 断言 | Phase I 7；Phase II 5 | Phase II tests-security note（无安全影响） |
| 8 | 校验规则补充：`interactive` profile ⇔ entries 恰为 `[desktop]`；desktop route 需 transportId，其他为 null；completion route 只在 api/completion、modes/profile/factory 为 null、evidence `none`；agent route 不上 completion entry；extension maturity ∈ {experimental, stable}；schemaRef 须等于共享 `LOCAL_JOB_API_RUNTIME_EXTENSION_SCHEMA_REFS` 中该 namespace 的发布指针（目录不读文件）；manifest port 返回的 runtimeId 须等于声明 | Phase I 8 | Phase I design 镜头 1 |
| 9 | 精确 interactive（desktop）route 仍要求 `permissionPolicy.interaction === "visible-user"`，否则 interactive_channel_required；resolver 不按 policy `kind` 收窄（red-receipt §9 P2-4） | Phase I 9 | Phase I design 探针（80 组合） |
| 10 | 第七个导出 `listRuntimeRouteManifests(catalog?)`（经 manifest port 返回 deep-frozen 副本），使 discovery 的 manifests 服从注入目录（S10/S38）；`listRuntimeRoutes(filter)` 接受可选 `{runtimeId, entry, kind}`；`agentRuntime.listManifests` 返回 `[...listRuntimeRouteManifests()]`（bytes 与旧 listManifests 相同） | Phase I 10；Phase II 11 | Phase II tests-security 探针 |
| 11 | Discovery 每个 runtime 的 readiness = 该 runtime API batch agent route 的 probe；`routes` 追加在 `readiness` 之后，去掉 routes 后 envelope bytes 与基线相同；completion 的 public executionProfile 为 null；interactive route 从不公开；带/不带 `--no-probe` 都输出 routes | Phase I 11 | Phase I design 镜头 4；Phase III 发射核对（§2） |
| 12 | **P18 readiness 决定**：Phase I 暂留 `resolveLocalJobApiRuntimeReadiness` facade（Phase I design P3-2）；Phase II `22fa8dae` 按 design D2/:402 删除 facade，换为 `resolveClaudeCodeRuntimeReadiness` / `resolveCodexRuntimeReadiness`（共享私有组合，runtimeId 为数据），目录直接引用 leaf probes；probe、30 s cache、default-profile 归属留在 runtime-readiness；25 处 registered-existing 测试调用改为该测试已命名 runtime 的 leaf probe，oracle 不变；S28 合成 clean case 中出现 facade 名只是 fixture 文本；T1 `58f2bf76` 把该名加入 src 级 retired 扫描 | Phase I P18 note；Phase II `22fa8dae`；T1-4 | Phase II design 镜头 5（符合 design）；T1 评审 |
| 13 | **policy-grant api-only 收窄**：生产表只在 `api` entry 声明 `codex.api.policy-grant`。基线 selector 对任何来源的 Codex policy-grant 请求都选 app-server。Phase I design 评审在 8,400 组合中复现 748 处差异，全部生产不可达（`job-runner.ts:384` 只对 source api 推导 executionProfile/policyGrant；`createAgentRuntimeRunRequest` 唯一调用者不设 visible channel），1,400 个可达组合 0 差异；符合 design D1（protocol parser 不接受此 profile） | Phase I design P3-1（实施者在 Phase I 报告中未单列，由评审披露） | 接受为已披露收窄（§5）：以后若要开放 protocol/其他入口的 policy-grant，须先在目录声明该 entry |
| 14 | Desktop query（`agent-runtime/desktop-route-query.ts`）：固定 runtime literal、`entry:"desktop"`、`kind:"agent"`、`executionProfile:"interactive"`、请求 mode、`requiredCapabilities` = desktop request owner 的 requestedCapabilities；policy summary `{kind:"desktop", interaction:"visible-user", enforcement, diagnostics}` | Phase II 1 | Phase II design 镜头 1 |
| 15 | Claude host：query/assert 在 `claude/agent-sdk-desktop-route.ts#resolveClaudeAgentSdkDesktopRouteDelegate`，host 把 catalog delegate 作为 `runDesktopAdapter` 经 WithRunState 注入 lifecycle；T1 `0fe80991` 起该参数必需，缺失时在任何 prompt/query/secret 准备前抛出 “Runtime route catalog is unavailable.”（删除默认 `runCatalogClaudeAgentSdkDesktopAdapter`） | Phase II 2；T1-3 | T1 评审 |
| 16 | Codex host 解构 `runtimeRouteCatalog` 后把其余 options 原样交给 delegate；`request` 身份、ports、secrets 不变；leaf `enabled: true` 保持基线（退役 selection 的 `useAppServer` 字面量即 true） | Phase II 3 | Phase II design 镜头 1 |
| 17 | Desktop catalog-fault 通道：两个 host 都以恰好 “Runtime route catalog is unavailable.” reject，不发 chunk、不调 emitError；Codex router catch 经 `extractCodexError` 发 `{type:"error", errorText}`，Claude 经既有 `emitError` 携带同一 message（red-receipt §8.1 允许） | Phase II 4 | Phase II design 镜头 1 |
| 18 | **chats.get 第三处组合**：`withRuntimeRouteTransportId` 应用于 getSubChat、createSubChat、chats.get（`attachBindingsToSubChats`，red-receipt §9 P2-3 统筹裁定 KEEP：spec/design 只点名两处，第三处是 renderer 路径生效所必需的 C7 §9.1 内部组合细节，登记为 S53 的已裁定扩展）以及 `updateSubChatBinding` receipt（第四处：否则绑定变更会用未盖章 binding 重建 Chat，且既有 `getSubChat().binding toEqual updateSubChatBinding()` oracle 需要它）。`chats.create` 与 `forkSubChat` 的 binding 不盖章，因为其 renderer 路径在构建 Chat 前会重读 chats.get | Phase II 6；red-receipt §9 P2-3 | Phase II design 镜头 3（第四处合理；未盖章 binding 不会被消费） |
| 19 | Renderer read state：chats.get `isError` → `error`（`useAgentChat` 现返回 `isError`）；无 transportId 的 binding → `not-loaded`；createSubChat 结果视为成功读取；`ok:false` 时 `console.error` 失败 code、不构建 Chat，无新 UI 文案/i18n key | Phase II 7–8 | 残余（§8） |
| 20 | `CodexAppServerChatTransportConfig` 删除未使用的必需 `provider: "codex"` 字段，helper 原样传 config | Phase II 9 | Phase II design 镜头 3 |
| 21 | 守卫语义：runtime literals `claude-code`/`codex`/`claude`；runtime 条件 = 与其比较或调用持有它的同文件谓词（T1 起含 `.runtime`/`.runtimeId` 操作数、`includes`、条件位置的同文件谓词）；targets = 导入的 leaf run/create、`*-chat-transport` 模块的 `*ChatTransport`、active-chat 内的 `createRuntimeRouteTransport`，T1 起加 D1 具名 hosts（`runAgentTask`、`runCodexDesktopChatRun`、`runClaudeAgentSdkDesktopRuntimeWithMcpReadiness`，按名匹配）；transport-id literal `/(^[a-z0-9-]+-ipc$|transport)/`；one-hop wrapper 检查只在 routers；生产扫描范围 agent-runtime、headless、codex、claude、trpc、renderer agents lib、active-chat、chat-session-binding、desktop-agent-jobs；retired symbols 与 path flag 在全部 src 正则扫描（T1 起追加 7 个 registry/readiness facade 名，fixture AST 规则保持冻结 S27 集合） | Phase II 10；T1-1/T1-2/T1-4 | T1 评审 |
| 22 | T1-1(c) 规则归属：main 中 runtime 条件式产出 transportId literal 报 `route-dispatch-outside-owner`（派单指定，design :431）；对象 map 形式保持冻结 S29 tuple `renderer-route-projection-bypass`。P15 生产名为 `handleCreateNewSubChat`（fixture 名 `createNewSubChat`），两者都在构造路径集合内 | T1 deviations 1–2 | T1 评审 P3-3（开放，§5） |
| 23 | T1 enabling：`scripts/check-architecture-guards.mjs` 只在作为入口脚本时运行 CLI（比较 `process.argv[1]` 与 `import.meta.url` 的 realpath），并导出 `collectRuntimeRouteCatalogFindings`、`RUNTIME_ROUTE_RULE`、`RUNTIME_ROUTE_CATALOG_SECTION` 供单元探针；CLI 输出与退出码不变 | T1 deviation 3；`16c2add0` | T1 评审（四种调用方式均完整输出） |
| 24 | `buildCodexAdapterRuntimeStatusMetadata(input)` 保留被忽略的 `env` 参数（由目录选择） | Phase II 12 | Phase II tests-security |

### D5 八份 baseline tests 处置（red-receipt §8.3）

| Baseline 文件 | 测试数 前→后 | 处置 |
| --- | --- | --- |
| tests/headless-adapter-selector.test.ts | 10 → 10 | Phase I 改写到 catalog query/refusal（S04/S05/S08），删 preferredAdapterSource 死 seam 测试、保留 fallbackReason:null；Phase II `c6d73891` 改用导出的生产 `agentTaskRouteQuery` |
| tests/agent-runtime-registry.test.ts → tests/agent-runtime-router-surface.test.ts | 5 → 5 | `2c15a1a0` 重命名（git R）；facade tests :12–70 迁到 shared capability owner；:72–143 两条源扫描 ratchet 保留全部断言（biome 改两处单参数 expect 的换行，token-identical，§5）；residue ALLOWED 同提交改指新路径、原 reason 保留 |
| tests/desktop-runtime-adapter-factory.test.ts | 7 → 7 | mutable factory 测试换成两个 desktop route 的 typed catalog delegate + 无 mutable registry 检查；源扫描改指 host 与自身 route 断言 |
| tests/codex-desktop-adapter-selection.test.ts | 2 → 2 | 改为 status projection：adapters.selection bytes 来自目录，env 被忽略 |
| tests/claude-agent-sdk-adapter-runner.test.ts | 8 → 8 | factory 解析测试换成“catalog delegate 是 function、leaf 在任何 query 前拒绝错配 route”；policy retry 测试保留 |
| tests/codex-app-server-adapter-runner.test.ts | 4 → 4 | factory 测试换成自身 route 断言；删 `resolveAdapterSelection` 依赖；取消/失败测试保留 |
| tests/agent-runtime-preflight.test.ts | 9 → 9 | Codex 顺序改指：admission → `runCodexDesktopChatRun({` → 构造 → 自身 route 断言 → `adapter.run` |
| tests/run-event-ledger-desktop-request.test.ts | 2 → 2 | recording adapter 经 validated test catalog 的 `resolveClaudeAgentSdkDesktopRouteDelegate` 到达；ledger request 与 terminal oracle 不变 |

D5 列表外、由已批准删除/移动强制的 baseline 测试改动（Phase II tests-security 逐文件复核，无断言削弱，
仅钉住已删除 seam 的断言被替换）：`tests/runtime-readiness.test.ts`、`tests/claude-runtime-readiness-config-dir.test.ts`
（P18：25 处 facade 调用改为 leaf probe，oracle 不变）；`tests/chat-session-binding-renderer-owner.test.ts`
（P14/P15：断言恰两处 `createRuntimeRouteTransport(`）；`tests/codex-api-key-validation`、`codex-desktop-service-boundary`、
`agent-runtime-permission-policy`、`provider-credential-storage`（P11：钉住字符串改为 `runCodexDesktopChatRun`）；
`tests/agent-guard-runtime-pipeline.test.ts`（P06：改用 `getAgentRuntimeCapabilityManifest`）；
`tests/claude-agent-sdk-runtime-lifecycle.test.ts`（T1-3：显式注入 typed delegate）。
实施者单元测试：`tests/runtime-route-catalog-null-factory.test.ts`（1）、`tests/runtime-route-guard-production-probes.test.ts`（15）、
`tests/runtime-route-transport-keys.test.ts`（9）、`tests/runtime-route-desktop-host-assertions.test.ts`（4）；
后三者不带 `runtime-route-catalog-` 前缀，不进入 red-file glob。

### Helper / event-state 回归锁（tasks 7.4，实施完成后登记）

| 文件 | sha256 @ a52d6a93 | 说明 |
| --- | --- | --- |
| `src/renderer/features/agents/lib/runtime-route-transport.ts` | `980ca69a00cdc2584f1012f47ba727e4cee77a4b8b4db690dccd4b5952cf1e7c` | 新 helper；以后改动应伴随 S18/S19 与 transport-keys 测试复核 |
| `src/renderer/features/agents/lib/runtime-event-state.ts` | `434beda99b226f550298dc2a71e4f5391b5b57b6a092bf215a783620184141d1` | 对 6192b13f 无 diff（P17 B） |

该 hash 仅作后续回归参考，不是验收 oracle，也不限制以后经批准的改写。

## 5. Disclosures（评审记录的全部发现及处置）

处置用语：**CLOSED** = 已有提交并经后续评审探针确认；**ACCEPTED** = 已披露、无公共影响，按设计接受（统筹可改判）；
**OPEN** = 未修复，需统筹在验收前裁定“先修”或“登记 follow-up”。Phase III 是纯文档派单，不改 src/tests/scripts；
下表无开放 P0–P2。

| 评审 @ SHA | Finding | 级别 | 处置 | 证据 |
| --- | --- | --- | --- | --- |
| Phase I design @9f06b6f7 | P2-1 OWNERSHIP_MAP 仍指向已删除 selector | P2 | CLOSED | `8227e73a`；Phase II tests-security 复核；Phase III `95aeaddd` 补相邻 owner |
| Phase I design @9f06b6f7 | P3-1 Codex policy-grant 与 visible-channel 输入在生产不可达路径上行为变化（api-only） | P3 | ACCEPTED（已披露收窄） | §4 决定 13；0/1,400 可达组合差异 |
| Phase I design @9f06b6f7 | P3-2 P18 readiness facade 保留 | P3 | CLOSED | `22fa8dae`；Phase II design 镜头 5 |
| Phase I design @9f06b6f7 | P3-3 内部 selection message 用 entry 代替 job source | P3 | ACCEPTED | §4 决定 5；payload 不含 message |
| Phase I tests-security @9f06b6f7 | P3 OWNERSHIP_MAP 指向已删除文件 | P3 | CLOSED | `8227e73a` |
| Phase I tests-security @9f06b6f7 | P3 `checkAgentRuntimeManifestCapability` 复制诊断模板 | P3 | CLOSED | `fc5e9762`（单一私有模板，bytes 相同） |
| Phase I tests-security @9f06b6f7 | P3 leaf enforcement evidence 名义化 | P3 | CLOSED | `06a63b9c` |
| Phase I tests-security @9f06b6f7 | P3 测试本地 `selectRoute` 副本 | P3 | CLOSED | `c6d73891` |
| Phase I tests-security @9f06b6f7 | Note：生产不得使用 test-only `runtimeRouteCatalog`，当时仅靠约定 | note | CLOSED | `347209b5` 规则 `route-catalog-test-port-in-production`；S30 green |
| Phase II design @258e4081 | P1-1 S03 `lookedUpOtherRuntime:false` oracle 与 eager validation 矛盾 | P1（测试缺陷） | CLOSED（统筹裁定） | `24801faa`；red-receipt §9 P1-4、§10；实现未改 |
| Phase II design @258e4081 | P2-1 生产守卫漏报 m7b/m7c/m14b/m16 | P2 | CLOSED | T1 `06dc3e2c`；T1 评审 remove-the-fix 探针 |
| Phase II design @258e4081 | P3-1 选择具名 hosts 的 runtime 分支不被守卫 | P3 | CLOSED | `2042da86`（m4/m5） |
| Phase II design @258e4081 | P3-2 lifecycle 默认 delegate 使注入可选 | P3 | CLOSED | `0fe80991` |
| Phase II design @258e4081 | P3-3 retired registry 导出名不在 retired 集合 | P3 | CLOSED | `58f2bf76`（m10 + 7 个名字） |
| Phase II design @258e4081 | Gap：报告未提 S28 合成 clean case 含 facade 名 | note | ACCEPTED | §4 决定 12；只是 fixture 文本 |
| Phase II tests-security @258e4081 | P1 S03 两测试因校验期查找而红 | P1（测试缺陷） | CLOSED（同上裁定） | `24801faa` |
| Phase II tests-security @258e4081 | P3 重命名的 :72–143 ratchet 非逐字（biome 改两处换行与 trailing comma） | P3 | ACCEPTED（建议；统筹可改判） | 忽略空白与 trailing comma 后与 `9f06b6f7:tests/agent-runtime-registry.test.ts:72-143` token-identical；`2c15a1a0` 已披露；断言集合不变 |
| Phase II tests-security @258e4081 | P3 `Object.hasOwn` 与 host runtimeId/surface 断言无“移除即失败”测试 | P3 | CLOSED | `a52d6a93`（transport-keys 9、host-assertions 4） |
| Phase II tests-security @258e4081 | Note：`f5e64523` 把校验/绑定后查找从 `typeof === "function"` 放宽到 `!= null` | note | ACCEPTED | §4 决定 7；调用点各自断言 function；生产 factory 表受 `satisfies` 约束 |
| T1 @a52d6a93 | P3-1 active-chat 同文件 one-hop value wrapper（m7f/m7g）仍可恢复 renderer runtime→transport 选择 | P3 | OPEN | 守卫 yield 规则只对 `src/main/` 生效（`check-architecture-guards.mjs:6157`）；评审在 scratch 验证一词修复（`\|\| isRendererSite`）保持 77/77 且仓库干净；需改 scripts/，不在 Phase III 范围 |
| T1 @a52d6a93 | P3-2 具名 host 的 import alias 绕过 named-host target | P3 | OPEN | `:5568` 只按名匹配；修复为 import 循环加入 `imported.local`；需改 scripts/ |
| T1 @a52d6a93 | P3-3 同一 main runtimeId→transportId 映射按语法分报两条规则 | P3 | OPEN（实施者 deviation 1） | 对象 map = 冻结 `renderer-route-projection-bypass`，条件式 = `route-dispatch-outside-owner`；统筹二选一：改 `:6195` 一词并更新 m16/main-forms 期望，或登记为已裁定 |
| T1 @a52d6a93 | P3-4 守卫头注释过期且换行错误（未列 `.runtime` 操作数、includes、按名 host 匹配；未披露 value wrapper / host alias / const 间接三类限制） | P3 | OPEN | `:4987–4999`；纯注释，需改 scripts/ |
| red-receipt §7 | P3-1…P3-11（RED suite 审计） | P3 | 按 red-receipt §9 “Recorded as written” | §6 implementer-unit 项已由 null-factory 等单元测试承担 |

Phase II 实施者自报残余：renderer 路由失败只 `console.error`，无 toast/i18n 文案（§4 决定 19，若 Owner 要文案属
用户可见产品取舍，另案）；`chats.create` / `forkSubChat` 未盖章 binding 依赖重读 chats.get（§4 决定 18，
Phase II design 评审确认不会被消费）。T1 enabling 提交改变了守卫脚本 CLI 尾部结构（§4 决定 23，行为不变）。

## 6. C7 scope check

proposal Consumer Impact §3 的每一行 ↔ 候选上的实际变化 ↔ 指南文本（英文节名；中文指南同节同内容）：

| Consumer Impact 行（proposal §3） | 实际变化 @ 候选 | 指南 | 证据 |
| --- | --- | --- | --- |
| `locus.local-job.v1` runs create/submit/wait/retry/status/events/result/cancel — 不变 | 无公共变化；内部经目录选 adapter | 无改动（不需要） | S21 3/3、S17 green；冻结 golden 全 bytes |
| runtimes list --json / --no-probe — optional `runtimes[].routes`（C7 #2/#10 additive Yellow） | 追加于 `readiness` 后，带/不带 `--no-probe` 都输出；仅 surface=api；exact keys；schema defs `runtimeRouteSummary`/`runtimeRouteExtension`（additionalProperties:false）；无新 feature/enum/required 字段 | Runtime Capabilities → Route summaries（含升级清单）；Stability Contract（Not stable 条目）；Troubleshooting 新行 | S22 green；§2 发射 bytes 核对 |
| error/exit/diagnostic — 不变 | 无公共变化；内部 selection message 措辞变化不进入任何公共 payload（§4 决定 5） | 无改动 | S24 2/2 green |
| events/native metadata/artifact refs — 不变 | 无变化；目录不是 event/artifact producer | 无改动 | S21、S25、S49 green |
| `locus-jobs-stdio.v1` — 不变 | 无变化；protocol routes 不在 discovery 中公开 | 无改动（stdio 不在本指南） | S17、S24 green |
| Desktop private IPC（C7 internal）— chat/createSubChat 绑定读模型 transportId | 内部追加，另含 chats.get 与 updateSubChatBinding receipt（§4 决定 18，均为 C7 §9.1 内部组合）；chat request/stream/cancel envelope 不变；不持久化 | 不属于 Local Job API 指南 | S07、S18、S20、S53 green |
| independently versioned app↔Runtime — 无变化 | 无 | 无 | — |
| 初始化 catalog_invalid = Green/build-defect | 生产表通过 S01 production-table CI；故障态 discovery reject、stdout 空 | 无（构建缺陷，不是合同） | S01 4/4 green |

C7 §9.2 十类复核：#1 Green（仅 internal 模块/导出删除）；#2 Yellow additive，见下；#3 Green（routeId 非身份，指南明示）；
#4/#5 Green（ack/claim/terminal 次序不变，S16/S17/S21）；#6 Green（batch 仍 exec/`claude -p`，Codex policy-grant
仍 admission-audit；api-only 收窄生产不可达，§4 决定 13）；#7 Green（projection 无 secret/factory/env/path，S22 leak 断言、
S30 env/fs/config 守卫）；#8 Green（S25）；#9 Green（transport 只是描述串，未改实际传输/startup/平台）；#10 Yellow additive，见下。

- 指南只写 proposal §3 已列的消费者可见变化（optional routes 与其规则）；没有写入 proposal 未列的变化。
- 没有出现 Red：无公共删除/重命名、无新 feature/enum/required 字段/error code/exit、无默认或 enforcement 变化、
  无新 credential/probe I/O/动态加载、无新 Host/transport/后台启动。
- **OD-2 Yellow（C7 #2/#10）由 S22 关闭**：`tests/runtime-route-catalog-discovery.test.ts` 中
  “S22 Old discovery readers safely ignore optional summaries — actual runtimes list carries experimental
  runtimes[].routes that both schemas accept, keep the old reader's common-core decisions (also under unknown open
  values), match the catalog's surface=api accepted combinations with exact keys, and the new schema rejects leaked
  internal fields and out-of-vocabulary kind/profile” 在 `a52d6a93` 通过（并于冻结候选复跑通过）。
- C7 §9.2 additive 前置：已发布指南的 unknown-field 规则 “Use the documented v1 fields and ignore unknown JSON fields”
  在 6192b13f 位于 `docs/local-job-api-v1-consumer-guide.md:1729`（proposal/design 引用的行号），候选上因插入新小节
  移至该文件 Stability Contract 末行（:1866）；新小节显式指向它。discoveryFeature caveat 仍在 :232–238，内容未改。

## 7. Smoke matrix（tasks 8.2–8.4）

本主机探测（2026-10-02，WSL2 内核 `6.18.33.2-microsoft-standard-WSL2`）：
`node_modules/electron/dist/electron --version` 失败 `error while loading shared libraries: libnspr4.so`；
`ldd` 另列缺 `libnss3.so`、`libnssutil3.so`、`libsmime3.so`、`libasound.so.2`。`resources/bin/`（bundled runtimes）
不存在，`DISPLAY` 未设（`/mnt/wslg` 存在），无 macOS / Windows 主机。PATH 上有 `codex` CLI，但打包 CLI 入口
（`--locus-headless-cli`）需要 Electron main，且真实 Runtime 运行会消耗用户凭据/计费，本派单未授权，故未运行。

Phase III 实际运行的只有进程内证据：经 `tests/local-job-api-async-submit-wait-kit.ts#cli` 调用真实
`runHeadlessCliCommand`（临时迁移 DB、`env: {}`）发射 `api runtimes list --json --no-probe` 与带 stub readiness 的
`api runtimes list --json`，并用 Ajv 2020 对新旧 schema 校验（§2）。这与十一份 red 文件一样是 **TEST 证据，不是 runtime smoke**。

| Smoke 项 | 结果 | 原因 |
| --- | --- | --- |
| 8.2 Desktop Claude/Codex：plan/agent、project/folderless、显式 profile 与 native、文本/工具/question/guard、取消、旧 Run 不取消新 Run、重载后读取、descriptor 选择 | host-blocked | Electron 运行库缺失；`DISPLAY` 未设；无 bundled runtimes / 凭据。进程内覆盖：S03/S07/S18–S20/S31/S49/S53 |
| 8.3 打包 CLI：两 runtime batch、Codex policy-grant、completion、create/submit/wait/retry/cancel/events | host-blocked | Electron；真实 Runtime 需下载与凭据；completion 需已存 provider profile。进程内覆盖：S14/S21/S24/S09 |
| 8.3 daemon-first 与 own-pump、jobs-stdio session、未知 required capability、no-probe readiness、无凭据拒绝、child teardown | host-blocked | Electron。进程内覆盖：S11/S16/S17/S23/S47 |
| 8.4 macOS packaged | not claimed | 无 macOS 主机 |
| 8.4 Windows packaged（含 artifact-bearing request 既有失败单列） | not claimed | 无 Windows 主机；TICKET-127 open；S25 的 win32 注入只是 source fixture |
| Linux/WSL source 结果 | 不替代 Tier-1 stable gate | 不宣称 TICKET-130 平台矩阵完成 |

TICKET-127–131 残余照旧（本切片不修复、不关闭任何 ticket）：TICKET-127 Windows run-dir 制品 stable-directory 后端
（artifact-bearing 请求仍 fail closed）；TICKET-128 Run 创建原子性与终态制品发布/崩溃恢复；TICKET-129 native 成功证据
与制品读取加固；TICKET-130 async-submit 转发与 Windows / Electron packaged 信号验证；TICKET-131 async-submit
follow-ups（迁移/回滚夹具、并发 PARTIAL、缓存与守卫检测增强）。route 可用不代表 artifact 可用（S25）。

在具备 Electron 运行库的主机上、于准确冻结 SHA 复跑（先 `sudo apt-get install -y libnspr4 libnss3 libasound2t64 libxss1`）：

```bash
bun run build
export LOCUS_USER_DATA_DIR="$(mktemp -d)"
L="node_modules/electron/dist/electron out/main/index.js --locus-headless-cli"
PROJ="$(mktemp -d)" && git -C "$PROJ" init -q
# 1. discovery: routes present with and without --no-probe; readiness unchanged
$L api runtimes list --json --no-probe
$L api runtimes list --json
# 2. real runtimes (after `bun run codex:download` / `bun run claude:download` and login; billable)
$L api projects register --cwd "$PROJ" --json
for RT in codex claude-code; do
  printf '%s\n' "{\"apiVersion\":\"locus.local-job.v1\",\"consumer\":{\"id\":\"smoke\"},\"project\":{\"cwd\":\"$PROJ\"},\"runtime\":{\"id\":\"$RT\"},\"mode\":\"plan\",\"prompt\":{\"text\":\"Return OK\"}}" > "$PROJ/$RT.json"
  $L api runs create --request "$PROJ/$RT.json" --json; echo "exit=$?"     # runtime_selected adapterSource = <rt>-batch
done
# 3. Codex policy-grant (admission-audit) and Claude policy-grant refusal (exit 1, policy_grant_adapter_unavailable)
# 4. completion with a stored provider profile; submit + `daemon run --once` + wait; retry; cancel; events --after
# 5. jobs-stdio: `$L jobs-stdio` initialize / job.run / job.cancel / shutdown
# 6. Desktop: DISPLAY=:0 bun run dev — Claude and Codex chats (plan/agent, new sub-chat, binding switch, cancel, reload)
```

macOS / Windows packaged：`bun run package:mac` / `bun run package:win` 后在各自主机记录 app/runtime SHA/digest、OS/arch，
跑同一 neutral fixtures 与上面的 discovery/transport smoke；Windows artifact-bearing request 的既有失败单列。

## 8. Consumer evidence、残余与停止门

| Consumer | 状态 |
| --- | --- |
| Career Kit | unknown — 本切片未运行其 E2E；optional routes 可忽略，无强制修改 |
| Amadeus | unknown — 本切片未运行其 E2E；若读取路线摘要由 consumer 自行更新 adapter |
| Locus Desktop/Workbench | Locus-owned 进程内：S18–S20/S53 green；GUI smoke host-blocked（§7） |
| 其他 v1 / jobs-stdio client | neutral fixtures 为 producer gate（S21/S22/S24）；真实 E2E unknown |

不因 unknown 声称没有 consumer。残余：§5 OPEN 的四个 T1 P3、§4 决定 19 的无 UI 文案、TICKET-127–131、全部 host-blocked smoke。

停止门（tasks 8.5–8.9）：

- **8.5 待定**：Codex IMPLEMENTATION_VERIFIED 与 fresh-context Claude REVIEW_APPROVED 都必须绑定本冻结候选（同一准确 SHA）；
  另有 fresh security lens 验 factory/secret/descriptor boundary。T1 评审 REVIEW_APPROVED @`a52d6a93` 只覆盖 T1 touch-up。
  任何后续 src/tests/scripts 变化使两 verdict 同时失效；Phase III 只改文档，不使 source 结论失效。
- **8.6**：当前无开放 Red、无旧 selector 残留、无未裁定 C7 变化；host-blocked 只列缺口、未记通过。
- **8.7 ACCEPTED**：统筹（Claude Fable 5.1）可依 Owner 2026-10-02 自我迭代授权代行，前提是 8.5 两 verdict 绑定同一 SHA、
  无开放 Red、§5 OPEN 项逐项裁定、§7 未测场景如实记载；条件未满足不得代行。Owner 可改为亲自验收。
- **8.8 / 8.9**：本派单不 merge、不 archive、不 push；push 依 Owner 2026-09-04 规矩由统筹另行派单，固定准确 SHA 与 target。

## 9. 历史：起草校验（不计实施验收）

工具固定使用主检出的
`/home/chen/projects/agent-code-for-me/node_modules/.bin/openspec`，cwd 为本 worktree。
以下为第三版有界修补的历史校验记录；Touch-up parent 为
`283f29ca1401f5567df998b850bbc605a064ee5f`，subject 为
`docs(openspec): bounded touch-up of unified runtime route catalog per second review`，
闭合检查输入 SHA 见 §1 历史行。本次 A/B 的审批绑定与校验另记如下，不使用最新文件提交推断历史 SHA。
产品 source 仍与 6192b13f 相同，非实施 verdict。

| Command / check | 起草结果 |
| --- | --- |
| `openspec validate refactor-unified-runtime-route-catalog --strict --no-interactive` | PASS，exit 0；`Change 'refactor-unified-runtime-route-catalog' is valid` |
| `openspec validate --all --strict --no-interactive` | PASS，exit 0；`Totals: 54 passed, 0 failed (54 items)` |
| `git diff --check`（含 `git diff --cached --check` 新文件检查） | PASS，exit 0，无输出；提交后再检查准确提交差异 |
| 文档一致性 | P01–P34 = 11 R + 7 C + 16 B；L1–L10、Consumer Impact 十节齐全；53 条 Scenario 各有 flat fixture/GIVEN/入口/断言，S33–S52 均单 WHEN，治理条款已标注不计测试；注册表和 tasks §7 同步；10 个改动文件均在授权范围 |
| 补充静态核对 | PASS；53 个唯一 GIVEN keys = tasks §7 = 本文 §3，每条一个 WHEN；六个 MODIFIED requirements 的 living scenario 标题全保留；proposal JSON 示例可解析；按原 retired-runtime regex 扫描 12 份草案/STATUS 文件为 0 hits（非完整 guard 替代） |
| `bun run check:full` | ATTEMPTED / ENVIRONMENT-BLOCKED，exit 1；lint PASS（无受支持的改动文件），architecture PASS（ledger/async 各17/17）；retired-runtime guard 在 spawnSync /bin/sh EPERM 停止，后续 type/tests/spec/build 未执行 |

### 本次精度修补与审批登记校验（2026-10-02）

| Evidence / check | 本次记录 |
| --- | --- |
| Owner-mandate / coordinator APPROVED | Owner 2026-10-02 自我迭代指示；Claude Fable 5.1 统筹代行记录，非 Owner 签署；APPROVED 绑定 A=`a9b74594`；Owner 可撤回/修改任一预设；闭合检查输入历史见 §1 |
| N-01–N-05 precision-only commit A | `a9b74594`；S53 真实 procedure/直接 helper 分腿、reference lookup 与 factory invocation 分计、S29 正例、living AND 可见、8.7 自引用与 S01 discovery/run 失败区分；未改设计决定 |
| `openspec validate refactor-unified-runtime-route-catalog --strict --no-interactive` | PASS，exit 0；`Change 'refactor-unified-runtime-route-catalog' is valid` |
| `openspec validate --all --strict --no-interactive` | PASS，exit 0；`Totals: 54 passed, 0 failed (54 items)` |
| Scenario structure | PASS；S01–S53 恰 53 条，各一个扁平 `tests/fixtures/runtime-route-catalog/<file>.json#Sxx` GIVEN、一个 WHEN；本 §3 全部保持 NOT RUN |
| `git diff --check` / staged diff check | PASS，exit 0，无输出 |
| 批准归属 grep（按派单原命令） | 仅 design D5 的通用批准→RED migration gate；本次 APPROVED 均明确为统筹代行，不是 Owner 亲签 |
| `bun run check:full`（本次文档检查） | ATTEMPTED / ENVIRONMENT-BLOCKED，exit 1；lint PASS、architecture PASS（ledger/async 各17/17）；retired-runtime guard 的 spawnSync /bin/sh EPERM 停止，后续 type/tests/spec/build 未执行；非实施 verdict |
| Git scope | 仅 worktree 内 OpenSpec 文档；本地 A/B 两提交，均附 Claude Fable 5.1 Co-Authored-By；不改 src/tests/docs，不 merge、不 push |

第三版 check:full 实际关键输出（与第二版同一环境阻塞）：

```text
No changed files supported by Biome.
Run event ledger guard self-test: 17/17 fixture cases matched; repository ownership enforced.
Local job API async submission guard self-test: 17/17 fixture cases matched; repository ownership enforced.
Architecture guard passed.
Error: spawnSync /bin/sh EPERM
  at scripts/check-retired-runtime-residue.mjs:182:17
error: script "retired-runtime:check" exited with code 1
error: script "check" exited with code 1
error: script "check:full" exited with code 1
```

第一版的 Biome 缺失记录是历史结果，不能当第三版失败原因；本次未安装/链接依赖，未改
src/tests/docs 或 guard。strict/diff 独立运行，不把 check:full 的环境失败改报为 PASS。
源代码、GUI、真实 Runtime、packaged 与 consumer E2E 未在起草阶段验证；产品阶段仍需全门禁。

### 一审 §3 闭环登记（第三版自查更新，不是独立复核或实现完成）

二审在 parent 283f29ca 将 6/7/9/10 判为 PARTIAL；本表反映 T1–T20 修补后起草者自查，
闭合检查输入历史见 §1；本次 APPROVED 已绑定精度修补提交 A，不沿用 parent verdict 作为产品实施 verdict。

| 项 | 状态 | 落点 / 闭环证据 |
| --- | --- | --- |
| 1 | CLOSED | design L2/D3/D6/Q4；desktop SHALL NOT 与 S19 缩窄，移除虚构 common transport，hash 后置。 |
| 2 | CLOSED | design P25–P33 补八处与两个 runner seam，P05/P23→B；T1 增 P34，现 34=11R/7C/16B，S29 注入正例。 |
| 3 | CLOSED | P23/D2/tasks3.7/headless delta 保留 kind→runner；S27 排除 rewires，S03/S11/S16/S17 spies。 |
| 4 | CLOSED | D1 诊断候选/拒绝优先级；D4 分 surface/内部 reason mapping/真实代码出处；S05/S21/S24 payload exact keys。 |
| 5 | CLOSED | entry/leaf 分离、typed union/non-null policy、validated catalog、overlap=catalog_invalid、leaf enforcement 常量；S01/S06/S08。 |
| 6 | CLOSED | singleton/test-only constructor + RuntimeRouteCatalogState union，两个具名 desktop host options；S01 生产 reference CI/具名 failure-state 注入与 host oracle，S14/S21/S24 禁 fake runner，S30 env/fs/config guard。 |
| 7 | CLOSED | OD-3 binding read model；S18 read-state input/ok failure 与两站点不缓存 guard，S53 main stamping/无 DB 列/失败省略字段；Q2 拒绝分支同步审批门。 |
| 8 | CLOSED | P11/P12/P27 typed fixed-runtime admission/secret 顺序；S07 wrong claude.chat/Codex binding，descriptor 不跨 IPC。 |
| 9 | CLOSED | D5/tasks4.1/4.2/S26 冻结 flag/fixture/finding/rules/summary；fixed-runtime 与 P34 lifecycle leaf import negative/注入 positive。 |
| 10 | CLOSED | D5/tests 八文件逐项处置，保留重命名 registry 两条源扫描；RED 期 fixture allowance 与实施期 test allowance 分时，re-export/clean fixture/OWNERSHIP_MAP 原子更新；tasks4.6/6.1。 |
| 11 | CLOSED | D3/proposal/S22 experimental/open/non-stable vocabulary、禁止 consumer branching、producer reality、api-only/exact keys；C7 #2/#10 additive Yellow 非 Red。 |
| 12 | CLOSED | core 的 Agent Runtime Contract、Capability Honesty（合成别称 Runtime Capability Truth 的真实 owner）、Runtime-Neutral Agent Runner；architecture Runtime Execution Boundary Ownership 与 parity Dependency 均 whole-copy MODIFIED；core :433 保留理由已登记。 |
| 13 | CLOSED | S01/S04/S10/S12/S13 具名函数/字段；D5 adapterSource replay IDs 冻结；D3/S11 missing route/probe→unknown。 |
| 14 | CLOSED | 本 §2 strict 两项/diff 校验；唯一 docs(openspec) 有界修补提交，SHA 解析绑定与交付报告；不 push。 |


### 二审 T1–T20 / R-01–R-20 有界修补登记

下列 CLOSED 指文档清单已落实，不是产品 GREEN 或独立 REVIEW_APPROVED。五项 P2 与十五项 P3
均折入本次单一提交；无清单项留 PARTIAL。S01–S53 产品测试仍 NOT RUN。

| 清单 | Finding | 级别 | 状态 | 落点 / 闭环证据 |
| --- | --- | --- | --- | --- |
| T1 | R-01 | P2 | CLOSED | P34 C / 34=11R+7C+16B；D2/tasks3.5 两文件注入链；S26 直接导入负例与 S29 typed delegate 正例。 |
| T2 | R-02 | P2 | CLOSED | D1/D2/P11/P12/tasks3.5 与 S03/S31/S49 冻结 Claude options host、Codex runCodexDesktopChatRun/CodexDesktopChatRunOptions；无 router setter。 |
| T3 | R-03 | P2 | CLOSED | D1/D3/tasks2.2/D5/S18 read-state Result、ok:false 不缓存 guard；新增 S53 main helper stamping、无 DB 列与 failure-state oracle。 |
| T4 | R-04 | P2 | CLOSED | RuntimeRouteCatalogState union / constructor invalid→failure 无 throw；S01 具名 hosts 注入，CLI bun reject/stdout 与生产 main catch 分离，D4 脱敏 bytes。 |
| T5 | R-05 | P2 | CLOSED | D5/tasks4.6 重命名 agent-runtime-router-surface.test.ts，:72–143 两条 source scans 逐字保留；仅 :12–70 facade 迁 S06/S10，同 reason allowance 随重命名。 |
| T6 | R-06 | P3 | CLOSED | D1 resolver/validator ok 判别；tasks2.2 在 RED 前冻结 RuntimeRouteDeclaration 字段、RuntimeRouteCatalogReferences ports 与 offending 类型。 |
| T7 | R-07 | P3 | CLOSED | D5/tasks4.6/6.1 明确 refusals.json 精确 ALLOWED entry 随 RED-suite commit，registry-test allowance 随实施重命名原子换路径。 |
| T8 | R-08 | P3 | CLOSED | design §2 清除 P24/P25 间空行，P01–P34 为连续表。 |
| T9 | R-09 | P3 | CLOSED | D6 增 P21/P26/P28 与 Claude default；proposal/desktop delta 定义 central main dispatch，列 retained main runtime-keyed edits。 |
| T10 | R-10 | P3 | CLOSED | local-job-api delta 仅 currently accepted API-entry combinations (surface=api)，protocol 省略。 |
| T11 | R-11 | P3 | CLOSED | OD-5 移出未签署 §10 block；proposal/design Q3/tasks8.7 同一统筹登记措辞（非 Owner 签署，Owner 可撤回）。 |
| T12 | R-12 | P3 | CLOSED | Consumer Impact §3 将 init catalog_invalid/no stdout/exit1 分类 Green/build-defect，区分 probe failure exit0。 |
| T13 | R-13 | P3 | CLOSED | D3/local-job-api 复用 closed jobKind/executionProfile；completion profile=null，proposal 示例与 S22 对齐。 |
| T14 | R-14 | P3 | CLOSED | L4 明确 chat request/stream/cancel 不变与 OD-3 internal read-model transportId。 |
| T15 | R-15 | P3 | CLOSED | proposal/D3/tasks5.3/local-job-api 引 guide :1729 前置、:232–238 pinned-schema caveat；experimental key-set 每次重做 C7 #2/#10。 |
| T16 | R-16 | P3 | CLOSED | S33–S52 20 条各一 WHEN；observable oracles 或 governance-only 标记；S46 public parser unsupported-runtime 与 internal route_not_found 分开。 |
| T17 | R-17 | P3 | CLOSED | D4/S24 固定 Runtime route catalog is unavailable.；validated catalog 的 recording agent-factory reference port 在校验时返回合法 delegate、post-binding lookup 返回 null（不改 frozen table、不执行 leaf，不伪造有效的缺 factory 声明）。 |
| T18 | R-18 | P3 | CLOSED | S05 unsupported-profile 显式 out-of-union cast；createCodexAppServerHeadlessTaskRunner({createDesktopAdapter:recording}) 直测 leaf，零 factory/provider/spawn。 |
| T19 | R-19 | P3 | CLOSED | proposal 删除过期歧义措辞；unknown/capability/extension fail closed，声明相交校验期 catalog_invalid。 |
| T20 | R-20 | P3 | CLOSED | design §1 解释 living local-job-api :268/:290/:558 batch selector path 为 batch leaf 行为用语，owner 改 catalog。 |
