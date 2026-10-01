# Tasks: Unified Runtime Route Catalog

Status: **DRAFT v3 — APPROVED candidate; awaiting Owner APPROVED**

本表是批准后的实施清单，全部未执行；本次起草不勾选产品任务。章节是责任划分，
**执行依赖为 1 → 2 → 6/7（独立 RED suite 冻结）→ 3/4/5 → 8**，不是先写产品再补测试。
每项以 spec 的 observable assertion 为准；场景登记、synthetic pass、source tests、GUI 与 packaged
证据分别记录，不能互相替代。fixtures 的唯一目录约定是 §7。

## 1. 治理与基线

- [ ] 1.1 Owner 对准确 draft SHA 标记 APPROVED；填写 proposal Consumer Impact §10，确认 design Q1–Q5 的统筹预设；Q1 若选不发布 optional summary，先删改相应 delta/场景后重新校验批准；Q2 若拒绝 binding read model，必须先选择可行数据路径并同步重写 S18/S19/S53/desktop delta，不留可跳过场景。
- [ ] 1.2 核对实施 base/target SHA、干净 worktree、active overlap；再次读 ownership map、C1–C9、ledger/async-submit 当前 owner，不使用 archived proposal 的旧行号推断最新实现。
- [ ] 1.3 明确 implementer、独立测试作者、fresh-context Claude Code reviewer、安全 reviewer 和 Integrator；测试作者只按批准 spec 写 RED，不以产品实现作 oracle。单文件单 writer。
- [ ] 1.4 记录 runtime/GUI/packaged host 可用性、既有 smoke 缺口与 TICKET-127–131 disposition；未运行的平台不得提前勾通过。
- [ ] 1.5 建立 source SHA / RED suite SHA / final verified SHA / fresh review SHA / local merge SHA 独立栏位；任何后续产品代码变化使验证与 review verdict 同时失效。

## 2. 路由点清单与目录模型

- [ ] 2.1 以 design §2 的 P01–P34（34=11R/7C/16B）为基线逐一核对 file:line、caller、输入/输出、R/C/B 归类；有新必需选择点先登记范围，不笼统删除 provider/source/event switches。
- [ ] 2.2 冻结 D1 的 RouteQuery(entry input/executionSurface output)、ValidatedRuntimeRouteCatalog/RuntimeRouteCatalogFailureState/RuntimeRouteCatalogState union、validateRuntimeRouteCatalog/createRuntimeRouteCatalogForTests/resolveRuntimeRoute/listRuntimeRoutes/projectRuntimeRoutes/probeRuntimeRouteReadiness、host runtimeRouteCatalog?: RuntimeRouteCatalogState（Claude runClaudeAgentSdkDesktopRuntimeWithMcpReadiness options、Codex NEW runCodexDesktopChatRun/CodexDesktopChatRunOptions）、withRuntimeRouteTransportId(binding, catalog?)、createRuntimeRouteTransport 的 loaded/not-loaded/error read-state input 与 ok/failure Result；agent policy 非空，capabilities 是 owner-derived typed union，completion mode/profile/policy 为 null；resolver Result 以 ok:true/false 判别并含诊断候选，validator Result 固定 {ok:true,catalog}|{ok:false,reason:"catalog_invalid",offending:{…}}，overlap 只在验证时报 catalog_invalid，无 route_ambiguous；enforcement 引用 leaf typed evidence，无 preferredAdapterSource。冻结 RuntimeRouteDeclaration 字段与 RuntimeRouteCatalogReferences ports（manifest getter、agent factory/probe/enforcement-evidence ports（含 S24 的 agent-factory reference lookup port）、runtime normalizer），含 offending 字段类型，并在 §6/§7 开始前交付独立作者。
- [ ] 2.3 证明 api/protocol entry surface 与 execution leaf 的单表关系，固定 desktop SDK/app-server、headless exec、Codex policy-grant、completion 对照矩阵；原 parser 范围不扩展。
- [ ] 2.4 冻结 baseline error/exit/stdout/stderr/diagnostic oracle 和 policy precedence（design D4），区分 adapter-local result exit 与最终 normalized exit；不得把所有拒绝统一改成 exit 3。
- [ ] 2.5 固定 main-only factory/probe、shared DTO、renderer mechanical transport factory 依赖图；证明无 catalog→adapter→catalog、catalog→readiness→status→catalog readiness 环，无反向 router import。
- [ ] 2.6 明确无迁移：无 DB/schema、无 routeId 持久化、无 reset、无安装 resolver 变更；catalog 不承担 submit/pump、claim、ledger、artifact 或 provider policy。

## 3. 目录实现与散落点替换

- [ ] 3.1 在独立 RED suite 冻结后实现 `runtime-route-catalog.ts`：静态声明、schema/reference 校验、唯一 descriptor、可枚举确定性查询、module-private deep-frozen validated singleton，missing fail closed/overlap=catalog_invalid；生产表真实 reference CI，非法初始化不返回 partial catalog。constructor/validator export 仅 tests 可调用，host runtimeRouteCatalog option 只允许 tests 赋值与具名 hosts 转发；禁止 arbitrary module load 与 production override。
- [ ] 3.2 引用 shared capability、现有 policy、projection availability；保持支持/降级/不支持与 adapter-specific enforcement 的交集，无重复 capability table。
- [ ] 3.3 原子替换 P01/P02 的选择逻辑；P05 三重 fail-closed assertion 保留；删除 headless adapter-selector.ts 及旧 exports/callers，保留 exec/claude -p/native projection 与原 observer/ledger 流向。
- [ ] 3.4 替换 P06–P10：移除 runtime-registry facade、DesktopRuntimeAdapterFactory、Codex/Claude selection wrappers；纯 capability caller 直调 shared owner，构造与 policy retry 留 native adapter owner。
- [ ] 3.5 P11/P12/P34 的固定执行 delegate 改接目录：Claude 经 agent-sdk-desktop-run-runtime.ts 的 runClaudeAgentSdkDesktopRuntimeWithMcpReadiness options 查询/断言，再把 typed delegate 沿既有 runLifecycle 链注入 agent-sdk-runtime-lifecycle.ts，删除后者 leaf run export 的 value import；Codex 新增 src/main/lib/codex/desktop-chat-run.ts 的最小 runCodexDesktopChatRun(options: CodexDesktopChatRunOptions)，接 admitCodexChatSessionBindingRun 后已构建的 request/ports，内部查询/断言后通过目录 delegate 调 leaf。仅移动 post-admission run body，procedure 保留 admission/envelope/orchestration；既有 preflight/binding/admission/exact-owner checks、MCP、persistence、finalizer 顺序不改；采用每 procedure 固定 runtimeId 与 per-route typed delegate，secret ports 前断言；不做 Claude route 全量服务抽取。
- [ ] 3.6 P18/P19/P22/P30 readiness/list/status wiring 查目录；runtime-readiness 保留 probe/cache/default-profile owner，status 与 readiness 分离避免递归；P30 保留 adapters.selection 与 hints IPC shape；不把 advisory unknown/needs-auth 当 admission 拒绝。
- [ ] 3.7 P23→B，保留 pumpQueuedRuns 自有 kind→runner 与 worker prefix，agent runner 内 claim/provider binding 后才查目录；claimGate 仍在 conditional claim 后、provider 前。source slots/worker identity/env/heartbeat/retention/cancel 原样；P24 的 API/stdio 继续 submit+scoped pump。
- [ ] 3.8 P14/P15 用同一个 `runtime-route-transport.ts` 替换两个 Engine 分支；P16 按 transportId 构造既有 wire adapters，无 runtimeId→transport 表；P17 的 event-state core 无 Engine 分支改动。
- [ ] 3.9 按 34=11R/7C/16B 核对，含 P34 C 注入链；保留全部 16 个 B 职责（含 P05/P23/P25–P29/P31–P33），具名残余不冒充已收敛；用 S20/S25/S31/S32 证明取消、制品、fallback、provider 未越权迁移。

## 4. 守卫与删除

- [ ] 4.1 在 `scripts/check-architecture-guards.mjs` 增加“Runtime Route Catalog Single Owner”节；pin production owner、声明域、合法 factory/probe references；匹配 runtimeId 决定 adapter/transport 的 AST 结构；冻结 D5 的 --runtime-route-catalog-fixtures=<path>、默认 flat path、五键 finding tuple、八个 rule names、ownerSection、summary/mismatch 输出；ledger/async 原 self-test 输出/flags 保持。
- [ ] 4.2 S26/S27 逐项覆盖 design D5 retired module/export/call site，包含 alias、namespace import、一跳 wrapper、runtime-keyed map、两处分支重引入、重复目录；正反例精确 findings 自检；leaf run/create value import 只允许 catalog/tests，固定 runtime 直接 leaf 调用与 P34 lifecycle 直接 value-import leaf run export 也拒绝，不宽放 adapters 目录；S27 仅恢复 retired symbols/两处分支，P11/P12/P18 rewires 用 S03/S11 spy，P23 用 S16/S17。
- [ ] 4.3 S28 验证 import direction/组合循环；保持 ledger/submit/route-growth/import baselines，不放宽旧 ratchet，不引入全目录豁免。
- [ ] 4.4 S29 保留 provider target/purpose、policy mode、job.source cancel、method parser、native decoder、chunk.type 和 transportId 构造合法正例；加入 P05、P25–P29/P32/P33 的逐 symbol 正例与 P34 lifecycle 接收注入 typed delegate 正例；S30 阻止 catalog 内第二 queue/ledger/artifact/credential owner 及 process.env/fs/config reads、production test-port override。
- [ ] 4.5 更新 `docs/OWNERSHIP_MAP.md`：新增 **Runtime Route Catalog Single Owner** owner 行/节、consumers、禁止重复路径、factory/probe 依赖；替换旧 Headless Adapter Selection、Desktop Factory、Codex adapter selection 所有权声明；保持 submit/pump、ledger/host、run-artifacts、capabilities、readiness/provider/projection、renderer event owner。
- [ ] 4.6 删除点清单 P01–P34 逐行回填结果，旧 exports/aliases/callers 清零；无 migration flag/双业务表。`desktop-runner.ts` 的 ledger helper、native adapters、agentJobs source cancel 不误删。原子处理 D5 八份 tests：headless-adapter-selector→S04/S05/S08；agent-runtime-registry 重命名为 tests/agent-runtime-router-surface.test.ts，逐字保留 :72–143 两条源扫描 ratchet（agentRuntime 不得出现 chat: publicProcedure/respondToolApproval/其他 removed members 或原 :101–103 的两类 retired symbols，active-chat 不得出现 retired provider 分支，renderer 经 manifest store 读取）；仅 facade tests :12–70 迁 S06（unknown/retired IDs）/S10（manifest）；desktop-runtime-adapter-factory→S03；codex-desktop-adapter-selection→S03/S31/status；claude-agent-sdk-adapter-runner→typed S03；codex-app-server-adapter-runner→S03/S31；agent-runtime-preflight→shared manifest；run-event-ledger-desktop-request→typed delegate。删除 headless/agent-runtime.ts:6–9 re-export；scripts/check-retired-runtime-residue.mjs:81–83 的旧 registry-test ALLOWED entry 在实施重命名时原子换到 tests/agent-runtime-router-surface.test.ts，保留原 reason；refusals.json 的精确 ALLOWED entry（reason=S06/S46 retired-ID refusal fixtures）必须已随 §6.1 RED-suite commit 加入，不能等到实施；同步 check-architecture-guards.mjs:751 clean import fixture 与 OWNERSHIP_MAP:319–330，分别跑两项 guards，不能只改测试导致 bun run check 失败。

## 5. 公共边界（discovery/文档）

- [ ] 5.1 Q1/Q2 已批准后实现 typed safe projections 与 chat/createSubChat binding read-model transportId（通过 NEW src/main/lib/agent-runtime/runtime-route-read-model.ts 的 withRuntimeRouteTransportId(binding, catalog?)，S53 用真实 composition/临时 DB 验证，不持久化该字段），无 agentRuntime.listRoutes；not-loaded/absent/error 映射到 D1 helper read state，可见失败且零订阅；S18 guard 验两站点 ok:false 不缓存 Chat。chat 请求不带 descriptor，S07 测真实 wrong-procedure admission。
- [ ] 5.2 如按推荐批准，`runtimes[].routes` 只追加 optional public summaries；由同一目录投影，公开 api 合法组合、protocol 省略；不加 feature/required request field/新 runtime enum/error code，既有 readiness/features 全保留；routes experimental，四个描述串开放、routeId 非稳定非身份、消费者不按 adapterSource/transport 分支；new defs additionalProperties:false/exact keys 与 S22 未知值旧 reader 固定。
- [ ] 5.3 更新 `src/shared/local-job-api.ts` 的 optional DTO 和 `docs/local-job-api-v1.schema.json`、中英文 consumer guides/examples；标明描述性路线不是授权、advisory readiness 不是 daemon readiness、absent routes 不否定原 features；注明 guide :1729 的 unknown-field 规则是 C7 §9.2 additive 前置；routes items 是 experimental/additionalProperties:false，固定 schema 副本须刷新（同 guide :232–238 discoveryFeature caveat），任何 experimental block key-set 变化须重新做 C7 #2/#10 分类；这些是实施任务，起草阶段不改这些文件。
- [ ] 5.4 声明 `runtime.<id>.v1` schema/maturity/redaction 引用，Codex 使用现有 public schema definition 与 producer；不重新复制 raw union，不公开 main file paths、factory、env、tokens，不增加 public requiredExtensions；batch/completion extensions=[]，app-server policy-grant 才声明 runtime.codex.v1，S13/S22 对照实际 producer。
- [ ] 5.5 public golden 固定完整 bytes/channels/exits；任何 default/policy/ack/enum/未知字段行为差异重新做 C7 十类，Red 写 Owner decision needed 并停止受影响部分。
- [ ] 5.6 consumer E2E 仅记实际 receipt 或 unknown；保留 TICKET-127–131 已接受但未完成残余，不冒充修复或稳定平台支持。

## 6. Conformance fixtures（测试先行）

- [ ] 6.1 独立作者仅从批准 delta/design 起草 S01–S53 的 bun 测试，产品实现前提交 RED suite；同一 RED-suite commit 在 scripts/check-retired-runtime-residue.mjs ALLOWED 中加入精确路径 tests/fixtures/runtime-route-catalog/refusals.json，reason=S06/S46 retired-ID refusal fixtures（registry-test entry 此时保留，待 §4.6 实施重命名时原子替换）；保真场景可为 baseline pass，但目录新行为/删除守卫必须有可解释的 failure-before，不用无条件 throw 或只检查不存在文件制造 RED。
- [ ] 6.2 目录/匹配 S01–S09：非法表、排列不变、精确 desktop/headless/profile/kind、未知/初始化重叠拒绝、wrong-procedure binding、无 dead preference/downgrade、completion 无 child。
- [ ] 6.3 能力/readiness/extensions S10–S13：canonical reference、adapter evidence、cache/no-probe、bad default、projection availability 与 unknown optional/required 扩展。
- [ ] 6.4 headless/pump S14–S17：完整保留 batch argv/stdin/cancel，rich 不暗选；两 DB 连接竞争、source exclusions、scoped dispatch、replay 不二次执行。
- [ ] 6.5 renderer/actions S18–S20/S53：main chat-query/createSubChat helper stamping（两 runtime 值、失败省略字段、无持久列），两个创建入口、unknown transport、复用 existing-wire-family 的 stub，具名 helper/event-state guard 与 atom transitions、exact owner cancel/retry 拒绝。
- [ ] 6.6 public S21–S25：真实 handler golden、old/new schema/reader、executor-env、errorCode/exit/channel、artifact/refusal 与 partial publish 不绕过。
- [ ] 6.7 guards S26–S30、native/provider S31–S32：正负 mutation findings、所有删除点、import/cycle、相邻 owner 白名单范围、fallback 禁止与 secret-safe projection。
- [ ] 6.8 冻结 suite SHA、fixture hashes、基线运行/RED 原因；实现者不得自行改 oracle 使测试通过，契约疑义由统筹裁定并另记 test-adjudication SHA。
- [ ] 6.9 S33–S52 覆盖完整 MODIFIED living scenarios，入口与 fixtures 同 verification；Capability Honesty 为源码真实标题，不能创建不存在的 Runtime Capability Truth。

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

- [ ] 7.1 独立作者按上表创建 fixtures，核对所有 GIVEN 路径/键实际可加载；CI/测试报告登记缺失和重复 key。
- [ ] 7.2 测试文件固定前缀 `tests/runtime-route-catalog-*.test.ts`；在 verification 逐 Sxx 填具体 test file/name、RED/GREEN SHA、断言及限制，不以一个 omnibus test 掩盖未覆盖子项。
- [ ] 7.3 使用隔离临时 DB/profile、fake clock/claim latches/recording ports，不读真实 secret、不依赖用户 HOME；fixtures 不调用真实计费 Runtime。真实 smoke 另列 §8。
- [ ] 7.4 Stub third Runtime 仅进入 test catalog/dependency ports，production ID/公共 enum 不扩；S18/S19 先用结构 guard 和 reducer/atom observable assertions，不能以 RED-time 或同进程前后 hash 充验收。hash 仅在实现完成后作为 helper/event-state 后续回归锁登记，不能限制本次必要改写。

## 8. 验证、评审与停止门

- [ ] 8.1 同一准确 source SHA 跑 targeted `bun test --isolate tests/runtime-route-catalog-*.test.ts`（shell 展开）、有关既有 headless/desktop/async/ledger/provider tests、`bun run architecture:check`、`bun run check:full`、两种 strict OpenSpec validation 和 `git diff --check`；依赖/host 限制原样记录，不把未执行写 PASS。
- [ ] 8.2 可重复 Desktop smoke：Claude/Codex 各 plan/agent、project/folderless、显式 profile 与 native、普通文本/工具/question/guard/取消/旧 Run 不取消新 Run、重载后读取；确认 descriptor 选择及原 UI 行为。
- [ ] 8.3 CLI/daemon/stdio smoke：两 runtime batch、Codex policy-grant、completion、create/submit/wait/retry/cancel/events、daemon-first 与 own-pump、未知 required capability、no-probe readiness、无凭据拒绝与 child teardown；stdout/stderr/exit 留脱敏回执。
- [ ] 8.4 macOS/Windows packaged 分别记录 app/runtime SHA/digest/OS/arch、同 neutral fixtures；Windows artifact-bearing request 的既有失败单列。Linux/WSL source 通过不替代 Tier-1 stable gate，不宣称 TICKET-130 平台矩阵已完成。
- [ ] 8.5 Codex IMPLEMENTATION_VERIFIED 与 fresh-context Claude Code REVIEW_APPROVED 绑定同一准确 source SHA；另有 fresh security lens 验 factory/secret/descriptor boundary。P0/P1 必须解决，P2 有明确 disposition，后续代码变化使两 verdict 失效。
- [ ] 8.6 **停止门**：无 Owner APPROVED/独立 RED、缺 mandatory evidence、旧 selector 残留、未裁定 Red 或必要前置越界时不宣称实施完成/接受；Green 自主修，Yellow 只登记 follow-up，Red 回 Owner。host-blocked 只能列具体缺口，不能记通过。
- [ ] 8.7 **统筹代行 ACCEPTED 条件声明（OD-5 统筹预设，Owner 可改）**：统筹登记（非 Owner 签署；统筹记录，Owner 可撤回）：Owner 2026-10-02 自我迭代指示覆盖统筹代行 ACCEPTED（条件见 tasks 8.7）；本行不构成当前 APPROVED/ACCEPTED；Owner 可在 APPROVED 时改为亲自验收；push 依 2026-09-04 规矩由统筹派 Codex。统筹代行须同 SHA Codex IMPLEMENTATION_VERIFIED + Claude REVIEW_APPROVED、无开放 Red、全部验收/残余逐项裁定、未测场景如实记载，记录授权依据/统筹身份/日期/SHA。条件未满足不得代行，也不代替批准 spec 的门禁。
- [ ] 8.8 后续本地 merge/archive 仅按届时批准范围和派单处理，merge SHA 重跑门禁；冲突/target 前移/代码变化重新双验。本次起草明确不 merge、不 archive。
- [ ] 8.9 **Push 规矩**：OD-5 确认依 Owner 2026-09-04 规矩由统筹派 Codex；后续 push 派单须固定准确 source SHA/remote target/通过门禁并遵守授权范围，不扩到其他 refs、远程 PR mutation/merge/tag/release。本次派单明确不 push、不 merge，唯一 Git 产物为本地单一文档提交。
