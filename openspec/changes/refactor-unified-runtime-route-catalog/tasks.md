# Tasks: Unified Runtime Route Catalog

Status: **IMPLEMENTATION CANDIDATE — frozen (source a52d6a93; candidate SHA in the Phase III handoff) — APPROVED 2026-10-02 (coordinator-acted under Owner mandate, bound to a9b74594; Owner may revoke); awaiting Codex IMPLEMENTATION_VERIFIED + fresh Claude REVIEW_APPROVED on the same SHA**

本表是批准后的实施清单。Phase III（实施候选冻结，2026-10-02）按实际完成情况勾选并附证据（提交 SHA / 测试）；
未完成项保持未勾并写明缺口：1.4（host 可用性/真实 smoke）与 8.1–8.9（同 SHA 双验、smoke、验收、merge、push 门禁）。章节是责任划分，
**执行依赖为 1 → 2 → 6/7（独立 RED suite 冻结）→ 3/4/5 → 8**，不是先写产品再补测试。
每项以 spec 的 observable assertion 为准；场景登记、synthetic pass、source tests、GUI 与 packaged
证据分别记录，不能互相替代。fixtures 的唯一目录约定是 §7。

## 1. 治理与基线

- [x] 1.1 统筹代行 APPROVED（Owner 2026-10-02 授权）绑定 a9b74594；§10 已填；Q1–Q5 预设采纳（Owner 可改）。
- [x] 1.2（base `6192b13f` = 2026-10-02 再核对的 main HEAD；Phase I 自干净 `76921ae8` 起步，Phase I/II/T1/III 各自核对 branch/HEAD/clean；`openspec/STATUS.md` 仅本 change active，无 overlap；ledger/async-submit owner 以当前源码为准）核对实施 base/target SHA、干净 worktree、active overlap；再次读 ownership map、C1–C9、ledger/async-submit 当前 owner，不使用 archived proposal 的旧行号推断最新实现。
- [x] 1.3（实施：Claude Opus 5.5（Phase I/II/T1/III）；独立 RED 作者：4×Opus + Fable 审计（`c297872d`）；fresh-context Claude 评审：Phase I 两镜头 @`9f06b6f7`、Phase II 两镜头 @`258e4081`、T1 @`a52d6a93`；安全镜头 = tests-security 评审；统筹/Integrator：Claude Fable 5.1；immutable set 仅统筹裁定修改（`24801faa`）；最终 Codex IMPLEMENTATION_VERIFIED 与同 SHA REVIEW_APPROVED 待派（8.5））明确 implementer、独立测试作者、fresh-context Claude Code reviewer、安全 reviewer 和 Integrator；测试作者只按批准 spec 写 RED，不以产品实现作 oracle。单文件单 writer。
- [ ] 1.4（**未完成**：本 WSL2 主机 Electron 缺 `libnspr4.so`/`libnss3.so`/`libnssutil3.so`/`libsmime3.so`/`libasound.so.2`（exit 127），`resources/bin/` 无 bundled runtimes，`DISPLAY` 未设，无 macOS/Windows 主机；Desktop/packaged/真实 Runtime smoke 全部 host-blocked，复跑命令与 TICKET-127–131 disposition 见 verification §7）记录 runtime/GUI/packaged host 可用性、既有 smoke 缺口与 TICKET-127–131 disposition；未运行的平台不得提前勾通过。
- [x] 1.5（verification §1 分列 source `a52d6a93` / RED suite `c297872d` / test-adjudication `24801faa` / 冻结候选（Phase III handoff）/ Codex verdict / fresh review / ACCEPTED / local merge 栏位；Phase III 只改文档，不使 source 失效）建立 source SHA / RED suite SHA / final verified SHA / fresh review SHA / local merge SHA 独立栏位；任何后续产品代码变化使验证与 review verdict 同时失效。

## 2. 路由点清单与目录模型

- [x] 2.1（Phase II 报告逐行核对，P01–P34 结果表见 3.9；34 = 11 R / 7 C / 16 B，Phase II design 评审逐项核对一致；无新增必需选择点）以 design §2 的 P01–P34（34=11R/7C/16B）为基线逐一核对 file:line、caller、输入/输出、R/C/B 归类；有新必需选择点先登记范围，不笼统删除 provider/source/event switches。
- [x] 2.2（red-receipt §8.1 与 §9 P1-1 core shape 于 `c297872d` 前冻结；实现 `1bceedf7`、`f5e64523`；S01/S02/S06/S24 green；reference lookup 与 factory invocation 分计（S03 oracle 经 `24801faa` 裁定只计绑定后查找）；决定见 verification §4）冻结 D1 的 RouteQuery(entry input/executionSurface output)、ValidatedRuntimeRouteCatalog/RuntimeRouteCatalogFailureState/RuntimeRouteCatalogState union、validateRuntimeRouteCatalog/createRuntimeRouteCatalogForTests/resolveRuntimeRoute/listRuntimeRoutes/projectRuntimeRoutes/probeRuntimeRouteReadiness、host runtimeRouteCatalog?: RuntimeRouteCatalogState（Claude runClaudeAgentSdkDesktopRuntimeWithMcpReadiness options、Codex NEW runCodexDesktopChatRun/CodexDesktopChatRunOptions）、withRuntimeRouteTransportId(binding, catalog?)、createRuntimeRouteTransport 的 loaded/not-loaded/error read-state input 与 ok/failure Result；agent policy 非空，capabilities 是 owner-derived typed union，completion mode/profile/policy 为 null；resolver Result 以 ok:true/false 判别并含诊断候选，validator Result 固定 {ok:true,catalog}|{ok:false,reason:"catalog_invalid",offending:{…}}，overlap 只在验证时报 catalog_invalid，无 route_ambiguous；enforcement 引用 leaf typed evidence，无 preferredAdapterSource。冻结 RuntimeRouteDeclaration 字段与 RuntimeRouteCatalogReferences ports（manifest getter、agent factory/probe/enforcement-evidence ports（含 S24 的 agent-factory reference lookup port）、runtime normalizer），含 offending 字段类型，并在 §6/§7 开始前交付独立作者。reference-port lookup（记录型 port 的引用查找）与 factory invocation（工厂调用）分开计数；S01/S02 的「不调用 factory/probe/provider/spawn」指 factory invocation 为 0，S24 的记录型 agent-factory reference port 在校验与绑定后查找时被调用不违反该约束。
- [x] 2.3（`runtime-route-catalog.ts` PRODUCTION_DECLARATIONS：desktop SDK/app-server、headless exec（headless/api/protocol）、Codex policy-grant（仅 api）、completion（api/completion）；S03/S04/S05/S09/S40–S43 green；policy-grant api-only 收窄已披露（verification §5））证明 api/protocol entry surface 与 execution leaf 的单表关系，固定 desktop SDK/app-server、headless exec、Codex policy-grant、completion 对照矩阵；原 parser 范围不扩展。
- [x] 2.4（design D4 + 冻结 golden S21/S24/S25 全 bytes/channels/exits green，无 re-render（red-receipt §9 P2-2 规则未触发）；adapter-local exit 1 与 normalized exit 3 区分保留）冻结 baseline error/exit/stdout/stderr/diagnostic oracle 和 policy precedence（design D4），区分 adapter-local result exit 与最终 normalized exit；不得把所有拒绝统一改成 exit 3。
- [x] 2.5（S28 green；`runtime-readiness.ts` 不 import catalog；guard `route-catalog-forbidden-dependency` 规则；无反向 router import；factory 为 lazy reference）固定 main-only factory/probe、shared DTO、renderer mechanical transport factory 依赖图；证明无 catalog→adapter→catalog、catalog→readiness→status→catalog readiness 环，无反向 router import。
- [x] 2.6（`git diff 6192b13f a52d6a93 -- drizzle src/main/lib/db` 为空；S53 `PRAGMA table_info(sub_chat_bindings)` 无 transportId 列；无 routeId 持久化、无 reset/安装 resolver 变更）明确无迁移：无 DB/schema、无 routeId 持久化、无 reset、无安装 resolver 变更；catalog 不承担 submit/pump、claim、ledger、artifact 或 provider policy。

## 3. 目录实现与散落点替换

- [x] 3.1（`1bceedf7`、`f5e64523`；validated deep-frozen singleton + module-private WeakMap brand；missing fail closed、overlap=catalog_invalid；S01/S02/S06/S33 green；production test-port override 由 S30/`route-catalog-test-port-in-production` 拒绝）在独立 RED suite 冻结后实现 `runtime-route-catalog.ts`：静态声明、schema/reference 校验、唯一 descriptor、可枚举确定性查询、module-private deep-frozen validated singleton，missing fail closed/overlap=catalog_invalid；生产表真实 reference CI，非法初始化不返回 partial catalog。constructor/validator export 仅 tests 可调用，host runtimeRouteCatalog option 只允许 tests 赋值与具名 hosts 转发；禁止 arbitrary module load 与 production override。
- [x] 3.2（`4b6218a2`、`fc5e9762`（单一诊断模板）、`06a63b9c`（leaf 导出 enforcement evidence）；S10/S12/S34–S39/S47/S51/S52 green）引用 shared capability、现有 policy、projection availability；保持支持/降级/不支持与 adapter-specific enforcement 的交集，无重复 capability table。
- [x] 3.3（`4edfe4f7` 删除 `headless/adapter-selector.ts` 与 re-export，`c6d73891` 测试走生产 query；P05 三重断言保留；S04/S05/S08/S14/S15 green）原子替换 P01/P02 的选择逻辑；P05 三重 fail-closed assertion 保留；删除 headless adapter-selector.ts 及旧 exports/callers，保留 exec/claude -p/native projection 与原 observer/ledger 流向。
- [x] 3.4（`959433b9`（desktop factory/selection wrappers）、`2c15a1a0`（runtime-registry facade）；retired-symbol 扫描 0 命中；S27 green）替换 P06–P10：移除 runtime-registry facade、DesktopRuntimeAdapterFactory、Codex/Claude selection wrappers；纯 capability caller 直调 shared owner，构造与 policy retry 留 native adapter owner。
- [x] 3.5（`d1276de7`（Claude host + typed delegate 注入）、`0066e018`（NEW `runCodexDesktopChatRun`）、`0fe80991`（T1：lifecycle 必须注入 delegate，缺失 fail closed）；S01 #4、S03×4、S31、S49 green；`tests/runtime-route-desktop-host-assertions.test.ts` 钉住 runtimeId/executionSurface 断言）P11/P12/P34 的固定执行 delegate 改接目录：Claude 经 agent-sdk-desktop-run-runtime.ts 的 runClaudeAgentSdkDesktopRuntimeWithMcpReadiness options 查询/断言，再把 typed delegate 沿既有 runLifecycle 链注入 agent-sdk-runtime-lifecycle.ts，删除后者 leaf run export 的 value import；Codex 新增 src/main/lib/codex/desktop-chat-run.ts 的最小 runCodexDesktopChatRun(options: CodexDesktopChatRunOptions)，接 admitCodexChatSessionBindingRun 后已构建的 request/ports，内部查询/断言后通过目录 delegate 调 leaf。仅移动 post-admission run body，procedure 保留 admission/envelope/orchestration；既有 preflight/binding/admission/exact-owner checks、MCP、persistence、finalizer 顺序不改；采用每 procedure 固定 runtimeId 与 per-route typed delegate，secret ports 前断言；不做 Claude route 全量服务抽取。
- [x] 3.6（`832dab68`（discovery）、`22fa8dae`（P18 facade 删除，per-runtime leaf probes）、`959433b9`（P30 status projection）；S11/S23 green；advisory unknown/needs-auth 不阻断 admission）P18/P19/P22/P30 readiness/list/status wiring 查目录；runtime-readiness 保留 probe/cache/default-profile owner，status 与 readiness 分离避免递归；P30 保留 adapters.selection 与 hints IPC shape；不把 advisory unknown/needs-auth 当 admission 拒绝。
- [x] 3.7（`ff3556a7`；P23 pump `job.kind`→runner 与 worker prefix 保留，目录只在 runAgentTask 内 claim/claim gate/provider binding 后查询；S16/S17 green）P23→B，保留 pumpQueuedRuns 自有 kind→runner 与 worker prefix，agent runner 内 claim/provider binding 后才查目录；claimGate 仍在 conditional claim 后、provider 前。source slots/worker identity/env/heartbeat/retention/cancel 原样；P24 的 API/stdio 继续 submit+scoped pump。
- [x] 3.8（`543f9e93`；active-chat 恰两处 `createRuntimeRouteTransport(`、无直接 `new *ChatTransport(`；`runtime-event-state.ts` 无 diff；S18/S19 green；`tests/runtime-route-transport-keys.test.ts` 钉 `Object.hasOwn`）P14/P15 用同一个 `runtime-route-transport.ts` 替换两个 Engine 分支；P16 按 transportId 构造既有 wire adapters，无 runtimeId→transport 表；P17 的 event-state core 无 Engine 分支改动。
- [x] 3.9（Phase II 报告 + Phase II design 评审核对；表如下）按 34=11R/7C/16B 核对，含 P34 C 注入链；保留全部 16 个 B 职责（含 P05/P23/P25–P29/P31–P33），具名残余不冒充已收敛；用 S20/S25/S31/S32 证明取消、制品、fallback、provider 未越权迁移。
  P01–P34 结果表（Phase II 报告，file:line @ `258e4081`；T1 未改这些行的归类）：

  | ID | 类 | 结果 | 现位置 |
  | --- | --- | --- | --- |
  | P01 | R | adapter-selector.ts 删除；选择在目录表与 matcher | `agent-runtime/runtime-route-catalog.ts:406` PRODUCTION_DECLARATIONS、`:1516` resolveRuntimeRoute |
  | P02 | C | runAgentTask 用导出的生产 query 查目录，observer 入口保留 | `headless/agent-runtime.ts:36`、`:66`、`:72` |
  | P03 | B | `claude -p` leaf 保留，另导出 evidence | `headless/adapters/claude-code.ts:184`、`:28` |
  | P04 | B | `codex exec` leaf 保留 | `headless/adapters/codex.ts:104`、`:187` |
  | P05 | B | 三重 fail-closed 断言保留 | `headless/adapters/codex-app-server.ts:55`、`:192` |
  | P06 | R | runtime-registry.ts 删除；listManifests 经目录，status 用 shared owner | `trpc/routers/agent-runtime.ts:8`、`trpc/routers/claude-code.ts:170`、`codex/runtime-status.ts:215` |
  | P07 | R | DesktopRuntimeAdapterFactory/adapterKey/Lookup 删除；合同、匹配断言、ledger helper 保留 | `agent-runtime/desktop-runner.ts:23`、`:39` |
  | P08 | R | codex/desktop-adapter-selection.ts 删除，selection 由目录投影 | `codex/runtime-status.ts:57` |
  | P09 | R | resolveCodexAppServerDesktopAdapter 删除；leaf 构造单个 adapter 并断言自身 route | `codex/app-server-adapter-runner.ts:52`、`:110` |
  | P10 | R | resolveClaudeAgentSdkDesktopAdapter 删除；自身 route 断言；policy retry 保留 | `claude/agent-sdk-adapter-runner.ts:109`、`:126`、`:217` |
  | P11 | R | codex.chat admission 后调用 NEW host（query→assert→delegate） | `trpc/routers/codex.ts:544`→`:779`；`codex/desktop-chat-run.ts:33`、`:37` |
  | P12 | R | claude.chat 调具名 host，secret 输入前断言 route | `trpc/routers/claude.ts:184`→`:407`；`claude/agent-sdk-desktop-run-runtime.ts:63`、`:70`；`claude/agent-sdk-desktop-route.ts` |
  | P13 | B | job.source cancel 与 retry 拒绝保留 | `trpc/routers/agent-jobs.ts:90`、`:120` |
  | P14 | R | Engine 分支 → createRuntimeRouteTransport + read-state mapper | `renderer/features/agents/main/active-chat.tsx:6090`、`:383` |
  | P15 | R | 第二个 Engine 分支 → 同一 helper | `active-chat.tsx:6369` |
  | P16 | C | transportId→constructor 静态表，wire 不变 | `renderer/features/agents/lib/runtime-route-transport.ts:38`、`:51`；`ipc-chat-transport.ts:314`；`codex-app-server-chat-transport.ts:195` |
  | P17 | B | chunk.type event-state core 无 diff | `renderer/features/agents/lib/runtime-event-state.ts:158` |
  | P18 | R | dispatch facade resolveLocalJobApiRuntimeReadiness 删除；per-runtime leaf probes 由目录引用；probe/cache/default-profile owner 保留 | `headless/runtime-readiness.ts:316`、`:341`、`:353`；catalog `:566` |
  | P19 | C | discovery 经目录枚举，admission gate 用 shared owner | `headless/local-job-api.ts:510`、`:512`、`:519`、`:831` |
  | P20 | B | shared capability owner 保留（单一诊断模板） | `shared/agent-runtime-capabilities.ts:1`、`:207`、`:759` |
  | P21 | B | provider target/purpose 表保留 | `headless/provider-binding.ts:150` |
  | P22 | C | routes/status 读目录或 shared owner | `trpc/routers/agent-runtime.ts:8`、`trpc/routers/claude-code.ts:170`、`codex/runtime-status.ts:57` |
  | P23 | B | pump job.kind→runner 与 worker prefix 保留 | `headless/daemon.ts:444`、`:468` |
  | P24 | C | API/stdio 经 submit + pump，command/method switch 保留 | `headless/jobs-stdio.ts:281`、`:296`；`cli-dispatcher.ts:1068`、`:1192`、`:1299` |
  | P25 | B | approval 分派保留（OD-1 残余） | `active-chat.tsx:2702` |
  | P26 | B | 新绑定默认、token 统计、MCP config 分支保留 | `active-chat.tsx:340`、`:2537`、`:5898` |
  | P27 | B | admit gates 与 rejectStaleRunPayload 保留 | `chat-session-binding.ts:201`、`:225`、`:272` |
  | P28 | B | provider target 三元保留 | `chat-session-binding.ts:147` |
  | P29 | B | assertDesktopRuntime allowlist 保留 | `desktop-agent-jobs.ts:99` |
  | P30 | C | adapters.selection 与 hint bytes 由目录 route 投影，无 native probe | `codex/runtime-status.ts:57`、`:72` |
  | P31 | B | Codex-only runtime.codex.v1 producer 保留 | `agent-runtime/run-event-ledger.ts:337`、`:1213` |
  | P32 | B | renderer alias 表保留 | `renderer/features/agents/lib/runtime-manifest-store.ts:20` |
  | P33 | B | runner 注入、LOCUS_HEADLESS_FAKE_RUNNER seam、API-only profile gate 保留 | `headless/job-runner.ts:149`、`:357`、`:384` |
  | P34 | C | lifecycle 只接收注入 typed delegate，无 leaf value import；T1 起为必需参数 | `claude/agent-sdk-runtime-lifecycle.ts:113`、`:140`、`:251` |

  合计 11 R / 7 C / 16 B；16 个 B 职责全部保留（Phase II design 评审逐处抽查 present）；S20/S25/S31/S32 green 证明取消、制品、fallback、provider 未迁入目录。

## 4. 守卫与删除

- [x] 4.1（`347209b5`、`a24124d1`，T1 `16c2add0`/`06dc3e2c`/`2042da86`/`58f2bf76`；canonical `Runtime route catalog guard self-test: 77/77 fixture cases matched; repository ownership enforced.`；mutated fixture exit 1、63/77、14 行；ledger/async 17/17 输出与 flags 不变）在 `scripts/check-architecture-guards.mjs` 增加“Runtime Route Catalog Single Owner”节；pin production owner、声明域、合法 factory/probe references；匹配 runtimeId 决定 adapter/transport 的 AST 结构；冻结 D5 的 --runtime-route-catalog-fixtures=<path>、默认 flat path、五键 finding tuple、八个 rule names、ownerSection、summary/mismatch 输出；ledger/async 原 self-test 输出/flags 保持。
- [x] 4.2（S26/S27 green；T1 production probes（`tests/runtime-route-guard-production-probes.test.ts`：m4/m5/m7b/m7c/m10/m14b/m16 等）；T1 评审记录的两个残余绕过形式（同文件 one-hop value wrapper、具名 host import alias）为开放 P3，见 verification §5）S26/S27 逐项覆盖 design D5 retired module/export/call site，包含 alias、namespace import、一跳 wrapper、runtime-keyed map、两处分支重引入、重复目录；正反例精确 findings 自检；leaf run/create value import 只允许 catalog/tests，固定 runtime 直接 leaf 调用与 P34 lifecycle 直接 value-import leaf run export 也拒绝，不宽放 adapters 目录；S27 仅恢复 retired symbols/两处分支，P11/P12/P18 rewires 用 S03/S11 spy，P23 用 S16/S17。
- [x] 4.3（S28 green；`scripts/architecture-baselines.json` 对 6192b13f 0 diff（含 reachThroughWrappers）；`lint-baseline.json` 只减；无全目录豁免）S28 验证 import direction/组合循环；保持 ledger/submit/route-growth/import baselines，不放宽旧 ratchet，不引入全目录豁免。
- [x] 4.4（S29/S30 green；P05、P25–P29/P32/P33 逐 symbol 正例与 P34 注入正例在冻结 fixture 内）S29 保留 provider target/purpose、policy mode、job.source cancel、method parser、native decoder、chunk.type 和 transportId 构造合法正例；加入 P05、P25–P29/P32/P33 的逐 symbol 正例与 P34 lifecycle 接收注入 typed delegate 正例，以及 withRuntimeRouteTransportId 通过 catalog projection 查找 transportId、无字面 map、不被 route-dispatch-outside-owner 标记的正例；S30 阻止 catalog 内第二 queue/ledger/artifact/credential owner 及 process.env/fs/config reads、production test-port override。
- [x] 4.5（`8227e73a` 新增 Runtime Route Catalog Single Owner 节并删除 Headless Runtime Adapter Selection 节、改写 desktop factory/Codex selection 声明；Phase III `95aeaddd` 补列相邻 owner（submit/pump、ledger/host、run-artifacts、capabilities、readiness/provider/projection、renderer event state））更新 `docs/OWNERSHIP_MAP.md`：新增 **Runtime Route Catalog Single Owner** owner 行/节、consumers、禁止重复路径、factory/probe 依赖；替换旧 Headless Adapter Selection、Desktop Factory、Codex adapter selection 所有权声明；保持 submit/pump、ledger/host、run-artifacts、capabilities、readiness/provider/projection、renderer event owner。
- [x] 4.6（P01–P34 见 3.9；retired exports/aliases/callers 在 src 清零；无 migration flag/第二表；D5 八份 tests 处置见 verification §4（`2c15a1a0` 重命名 `tests/agent-runtime-router-surface.test.ts` 并原子改 residue ALLOWED，原 reason 保留；:72–143 两条 ratchet token-identical，biome 改两处换行已披露）；`headless/agent-runtime.ts` re-export 与 guards:751 clean fixture 于 Phase I `4edfe4f7` 同步；两项 guards 分别通过）删除点清单 P01–P34 逐行回填结果，旧 exports/aliases/callers 清零；无 migration flag/双业务表。`desktop-runner.ts` 的 ledger helper、native adapters、agentJobs source cancel 不误删。原子处理 D5 八份 tests：headless-adapter-selector→S04/S05/S08；agent-runtime-registry 重命名为 tests/agent-runtime-router-surface.test.ts，逐字保留 :72–143 两条源扫描 ratchet（agentRuntime 不得出现 chat: publicProcedure/respondToolApproval/其他 removed members 或原 :101–103 的两类 retired symbols，active-chat 不得出现 retired provider 分支，renderer 经 manifest store 读取）；仅 facade tests :12–70 迁 S06（unknown/retired IDs）/S10（manifest）；desktop-runtime-adapter-factory→S03；codex-desktop-adapter-selection→S03/S31/status；claude-agent-sdk-adapter-runner→typed S03；codex-app-server-adapter-runner→S03/S31；agent-runtime-preflight→shared manifest；run-event-ledger-desktop-request→typed delegate。删除 headless/agent-runtime.ts:6–9 re-export；scripts/check-retired-runtime-residue.mjs:81–83 的旧 registry-test ALLOWED entry 在实施重命名时原子换到 tests/agent-runtime-router-surface.test.ts，保留原 reason；refusals.json 的精确 ALLOWED entry（reason=S06/S46 retired-ID refusal fixtures）必须已随 §6.1 RED-suite commit 加入，不能等到实施；同步 check-architecture-guards.mjs:751 clean import fixture 与 OWNERSHIP_MAP:319–330，分别跑两项 guards，不能只改测试导致 bun run check 失败。

## 5. 公共边界（discovery/文档）

- [x] 5.1（`d6a6c23f`、`543f9e93`；stamping 于 getSubChat、createSubChat、chats.get（red-receipt §9 P2-3 第三处）及 updateSubChatBinding receipt（第四处，Phase II 评审认可）；S18/S53 green；无 agentRuntime.listRoutes）Q1/Q2 已批准后实现 typed safe projections 与 chat/createSubChat binding read-model transportId（通过 NEW src/main/lib/agent-runtime/runtime-route-read-model.ts 的 withRuntimeRouteTransportId(binding, catalog?)，S53 用真实 composition/临时 DB 验证，不持久化该字段），无 agentRuntime.listRoutes；not-loaded/absent/error 映射到 D1 helper read state，可见失败且零订阅；S18 guard 验两站点 ok:false 不缓存 Chat。chat 请求不带 descriptor，S07 测真实 wrong-procedure admission。
- [x] 5.2（`832dab68`；仅 surface=api 合法组合、protocol 省略、exact keys；S22 green）如按推荐批准，`runtimes[].routes` 只追加 optional public summaries；由同一目录投影，公开 api 合法组合、protocol 省略；不加 feature/required request field/新 runtime enum/error code，既有 readiness/features 全保留；routes experimental，四个描述串开放、routeId 非稳定非身份、消费者不按 adapterSource/transport 分支；new defs additionalProperties:false/exact keys 与 S22 未知值旧 reader 固定。
- [x] 5.3（DTO `4b6218a2`、schema `832dab68`（Phase III 对照实际发射 bytes 核对，无需改动）；中英文指南 `0a86fd0a`（Route summaries 小节、Stability Contract、升级清单、Troubleshooting））更新 `src/shared/local-job-api.ts` 的 optional DTO 和 `docs/local-job-api-v1.schema.json`、中英文 consumer guides/examples；标明描述性路线不是授权、advisory readiness 不是 daemon readiness、absent routes 不否定原 features；注明 guide :1729 的 unknown-field 规则是 C7 §9.2 additive 前置；routes items 是 experimental/additionalProperties:false，固定 schema 副本须刷新（同 guide :232–238 discoveryFeature caveat），任何 experimental block key-set 变化须重新做 C7 #2/#10 分类；这些是实施任务，起草阶段不改这些文件。
- [x] 5.4（`RUNTIME_CODEX_V1_EXTENSION` 只声明于 `codex.api.policy-grant`，schemaRef 指向既有 definition；batch/completion `extensions: []`；S13/S22 green）声明 `runtime.<id>.v1` schema/maturity/redaction 引用，Codex 使用现有 public schema definition 与 producer；不重新复制 raw union，不公开 main file paths、factory、env、tokens，不增加 public requiredExtensions；batch/completion extensions=[]，app-server policy-grant 才声明 runtime.codex.v1，S13/S22 对照实际 producer。
- [x] 5.5（S21/S24/S25 冻结 golden green，无 mismatch，无 C7 重分类，无 Red）public golden 固定完整 bytes/channels/exits；任何 default/policy/ack/enum/未知字段行为差异重新做 C7 十类，Red 写 Owner decision needed 并停止受影响部分。
- [x] 5.6（verification §7/§8：Career Kit/Amadeus E2E unknown（未运行）；TICKET-127–131 残余照旧列出）consumer E2E 仅记实际 receipt 或 unknown；保留 TICKET-127–131 已接受但未完成残余，不冒充修复或稳定平台支持。

## 6. Conformance fixtures（测试先行）

- [x] 6.1（RED suite c297872d，4 独立 Opus 作者 + Fable 审计；refusals.json ALLOWED entry 已随同一提交加入）独立作者仅从批准 delta/design 起草 S01–S53 的 bun 测试，产品实现前提交 RED suite；同一 RED-suite commit 在 scripts/check-retired-runtime-residue.mjs ALLOWED 中加入精确路径 tests/fixtures/runtime-route-catalog/refusals.json，reason=S06/S46 retired-ID refusal fixtures（registry-test entry 此时保留，待 §4.6 实施重命名时原子替换）；保真场景可为 baseline pass，但目录新行为/删除守卫必须有可解释的 failure-before，不用无条件 throw 或只检查不存在文件制造 RED。
- [x] 6.2（green @ a52d6a93：query 8/8、routes 17/17、completion 1/1、renderer S07 2/2）目录/匹配 S01–S09：非法表、排列不变、精确 desktop/headless/profile/kind、未知/初始化重叠拒绝、wrong-procedure binding、无 dead preference/downgrade、completion 无 child。
- [x] 6.3（green @ a52d6a93：capabilities S10–S13）能力/readiness/extensions S10–S13：canonical reference、adapter evidence、cache/no-probe、bad default、projection availability 与 unknown optional/required 扩展。
- [x] 6.4（green @ a52d6a93：headless 4/4、executor 4/4）headless/pump S14–S17：完整保留 batch argv/stdin/cancel，rich 不暗选；两 DB 连接竞争、source exclusions、scoped dispatch、replay 不二次执行。
- [x] 6.5（green @ a52d6a93：renderer 12/12（S18/S19/S20/S53，含 S07））renderer/actions S18–S20/S53：main chat-query/createSubChat helper stamping（两 runtime 值、失败省略字段、无持久列），两个创建入口、unknown transport、复用 existing-wire-family 的 stub，具名 helper/event-state guard 与 atom transitions、exact owner cancel/retry 拒绝。
- [x] 6.6（green @ a52d6a93：public-contract 6/6、discovery 2/2）public S21–S25：真实 handler golden、old/new schema/reader、executor-env、errorCode/exit/channel、artifact/refusal 与 partial publish 不绕过。
- [x] 6.7（green @ a52d6a93：guards 8/8、routes S31、provider 2/2）guards S26–S30、native/provider S31–S32：正负 mutation findings、所有删除点、import/cycle、相邻 owner 白名单范围、fallback 禁止与 secret-safe projection。
- [x] 6.8（suite SHA c297872d；fixture sha256 见 red-receipt §10；基线 77 = 69 RED / 8 GREEN；裁定见 red-receipt §9）冻结 suite SHA、fixture hashes、基线运行/RED 原因；实现者不得自行改 oracle 使测试通过，契约疑义由统筹裁定并另记 test-adjudication SHA。
- [x] 6.9（green @ a52d6a93：S33–S52 共 20 条，见 verification §3b）S33–S52 覆盖完整 MODIFIED living scenarios，入口与 fixtures 同 verification；Capability Honesty 为源码真实标题，不能创建不存在的 Runtime Capability Truth。

## 7. Fixture 目录约定与场景绑定

**明确选扁平布局**：所有本切片 fixture 文件直接置于
`tests/fixtures/runtime-route-catalog/`，不使用分域子目录。每个 JSON 的顶层以 Sxx 为 key，
spec GIVEN 的 `file.json#Sxx` 是准确键，不是随意 prose anchor。当前只写这些路径的规格，
不创建 tests 文件。独立作者需同步 spec、此表和 verification 注册表才能变更布局。

| 文件（根下） | Scenario keys | 最低内容 / oracle |
| --- | --- | --- |
| catalog.json | S01, S02, S33 | 声明/引用/重复/相交/enforcement mismatch/agent 必需 probe 与 completion null-probe 变体、稳定枚举与无副作用 ports |
| routes.json | S03, S04, S31, S41, S42, S43, S49 | desktop/headless/API/protocol accepted matrix、verified context、app-server failure 不 exec fallback |
| policy.json | S05, S08, S40, S44, S45 | grant/scope/enforcement/拒绝候选与 fallbackReason:null 原结果和诊断 |
| refusals.json | S06, S46 | unknown/retired/missing/invalid-combination，overlap=catalog_invalid、zero-call oracle |
| renderer.json | S07, S18, S19, S53 | wrong procedure、binding read model 两入口/缺失/错误/失败态目录、main stamping 与无 DB 列、compiled transports、existing-wire stub 与 atom 状态 |
| completion.json | S09 | 两 family 显式 profile、single upstream、agent-only fields 拒绝 |
| capabilities.json | S10, S12, S34–S39, S47, S51, S52 | 既有 manifests、projection owner responses、无 adapter kind |
| readiness.json | S11, S23 | default/native、fake clock/cache、no-probe/failure、caller/executor 非秘密 env sentinels |
| extensions.json | S13 | 已有 Codex schemaRef、unknown optional/required、错误 namespace/schema |
| headless.json | S14, S15 | 旧 source/profile 请求、argv/stdin/cancel/rich factory spies |
| executor.json | S16, S17 | 两连接 claim latches、source slots、scoped pump、replay/wait |
| desktop-actions.json | S20 | exact old/new owner、job-source cancel/retry envelopes |
| public-contract.json | S21 | 基线完整 stdout/stderr/exit/events/result（预先固定 IDs/time/worker 等，不在比较后归一化） |
| discovery.json | S22 | optional routes、缺字段 old response、同 queries 预期摘要；引用两个 frozen 支持文件 |
| errors.json | S24 | 各层原失败语义、JSON-RPC/desktop、zero-provider oracle |
| artifacts.json | S25 | stable-directory win32 拒绝、committed terminal incomplete publication |
| architecture-fixtures.json | S26, S27, S28, S29, S30, S48, S50 | source 文本内联到 JSON、exact expected findings 与 clean variants；不得随实施改为“只要失败就算过” |
| provider.json | S32 | explicit/model-only/default/native references、gateway cleanup 与 secret-safe outputs |
| discovery-schema-before.json | S22 supporting | 从 `6192b13f:docs/local-job-api-v1.schema.json` 冻结、记录 SHA-256，不手写宽松旧 schema |
| discovery-reader-before.ts | S22 supporting | 从 6192b13f 版已发布指南的 unknown-field/common-core 规则冻结 neutral old reader，记录来源/版本/SHA-256；不是冒充真实 Career Kit/Amadeus adapter |

- [x] 7.1（19 个扁平 fixture 文件，53 个 GIVEN 键全部可加载；审计未发现缺失/重复 key）独立作者按上表创建 fixtures，核对所有 GIVEN 路径/键实际可加载；CI/测试报告登记缺失和重复 key。
- [x] 7.2（11 个 tests/runtime-route-catalog-*.test.ts；逐 Sxx 登记见 verification §3/§3b）测试文件固定前缀 `tests/runtime-route-catalog-*.test.ts`；在 verification 逐 Sxx 填具体 test file/name、RED/GREEN SHA、断言及限制，不以一个 omnibus test 掩盖未覆盖子项。
- [x] 7.3（suite 使用 `createMigratedLedgerDb` 临时 DB/profile、fake clock、claim latches、recording ports、`env: {}`；评审确认无真实 secret、HOME 或计费 Runtime）使用隔离临时 DB/profile、fake clock/claim latches/recording ports，不读真实 secret、不依赖用户 HOME；fixtures 不调用真实计费 Runtime。真实 smoke 另列 §8。
- [x] 7.4（S19 stub 仅在 test catalog；`CONTRACT_RUNTIME_IDS` 无 diff；实施后回归锁 sha256 登记于 verification §4（`runtime-route-transport.ts`、`runtime-event-state.ts`））Stub third Runtime 仅进入 test catalog/dependency ports，production ID/公共 enum 不扩；S18/S19 先用结构 guard 和 reducer/atom observable assertions，不能以 RED-time 或同进程前后 hash 充验收。hash 仅在实现完成后作为 helper/event-state 后续回归锁登记，不能限制本次必要改写。

## 8. 验证、评审与停止门

- [ ] 8.1（**未完成**：候选门禁已在 Phase III 冻结提交上运行（verification §2）；正式同 SHA 验证由 Codex IMPLEMENTATION_VERIFIED 执行，待派）同一准确 source SHA 跑 targeted `bun test --isolate tests/runtime-route-catalog-*.test.ts`（shell 展开）、有关既有 headless/desktop/async/ledger/provider tests、`bun run architecture:check`、`bun run check:full`、两种 strict OpenSpec validation 和 `git diff --check`；依赖/host 限制原样记录，不把未执行写 PASS。
- [ ] 8.2（**未完成**：host-blocked：Electron 运行库缺失、无 DISPLAY、无 bundled runtimes/凭据；复跑命令见 verification §7）可重复 Desktop smoke：Claude/Codex 各 plan/agent、project/folderless、显式 profile 与 native、普通文本/工具/question/guard/取消/旧 Run 不取消新 Run、重载后读取；确认 descriptor 选择及原 UI 行为。
- [ ] 8.3（**未完成**：host-blocked：打包 CLI 需 Electron；进程内 CLI/API fake runner 运行只算 TEST 证据；复跑命令见 verification §7）CLI/daemon/stdio smoke：两 runtime batch、Codex policy-grant、completion、create/submit/wait/retry/cancel/events、daemon-first 与 own-pump、未知 required capability、no-probe readiness、无凭据拒绝与 child teardown；stdout/stderr/exit 留脱敏回执。
- [ ] 8.4（**未完成**：not claimed：无 macOS/Windows 主机；TICKET-130 平台矩阵未完成）macOS/Windows packaged 分别记录 app/runtime SHA/digest/OS/arch、同 neutral fixtures；Windows artifact-bearing request 的既有失败单列。Linux/WSL source 通过不替代 Tier-1 stable gate，不宣称 TICKET-130 平台矩阵已完成。
- [ ] 8.5（**未完成**：Codex IMPLEMENTATION_VERIFIED 与 fresh-context Claude REVIEW_APPROVED 均未对冻结候选签发；T1 评审 REVIEW_APPROVED @a52d6a93 仅为 touch-up 镜头；开放 P3 见 verification §5）Codex IMPLEMENTATION_VERIFIED 与 fresh-context Claude Code REVIEW_APPROVED 绑定同一准确 source SHA；另有 fresh security lens 验 factory/secret/descriptor boundary。P0/P1 必须解决，P2 有明确 disposition，后续代码变化使两 verdict 失效。
- [ ] 8.6（**未完成**：停止门持续生效；当前无开放 Red、无旧 selector 残留；host-blocked 项未记通过）**停止门**：无有效 APPROVED（含本次统筹代行）/独立 RED、缺 mandatory evidence、旧 selector 残留、未裁定 Red 或必要前置越界时不宣称实施完成/接受；Green 自主修，Yellow 只登记 follow-up，Red 回 Owner。host-blocked 只能列具体缺口，不能记通过。
- [ ] 8.7（**未完成**：统筹代行 ACCEPTED 须待 8.5 两 verdict 绑定同一 SHA 且无开放 Red）**统筹代行 ACCEPTED 条件声明（OD-5 统筹预设，Owner 可改）**：统筹登记（非 Owner 签署；统筹记录，Owner 可撤回）：Owner 2026-10-02 自我迭代指示覆盖统筹代行 ACCEPTED（条件见本条）；本行不构成当前 APPROVED/ACCEPTED；Owner 可在 APPROVED 时改为亲自验收；push 依 2026-09-04 规矩由统筹派 Codex。统筹代行须同 SHA Codex IMPLEMENTATION_VERIFIED + Claude REVIEW_APPROVED、无开放 Red、全部验收/残余逐项裁定、未测场景如实记载，记录授权依据/统筹身份/日期/SHA。条件未满足不得代行，也不代替批准 spec 的门禁。
- [ ] 8.8（**未完成**：本派单不 merge、不 archive）后续本地 merge/archive 仅按届时批准范围和派单处理，merge SHA 重跑门禁；冲突/target 前移/代码变化重新双验。本次起草明确不 merge、不 archive。
- [ ] 8.9（**未完成**：本派单不 push；push 仅由统筹按 2026-09-04 规矩另行派单）**Push 规矩**：OD-5 确认依 Owner 2026-09-04 规矩由统筹派 Codex；后续 push 派单须固定准确 source SHA/remote target/通过门禁并遵守授权范围，不扩到其他 refs、远程 PR mutation/merge/tag/release。本次派单明确不 push、不 merge，唯一 Git 产物为本地 A、B 两个文档提交，APPROVED 绑定 A。
