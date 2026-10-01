# Tasks: Unified Runtime Route Catalog

Status: **DRAFT — awaiting Owner APPROVED**

本表是批准后的实施清单，全部未执行；本次起草不勾选产品任务。章节是责任划分，
**执行依赖为 1 → 2 → 6/7（独立 RED suite 冻结）→ 3/4/5 → 8**，不是先写产品再补测试。
每项以 spec 的 observable assertion 为准；场景登记、synthetic pass、source tests、GUI 与 packaged
证据分别记录，不能互相替代。fixtures 的唯一目录约定是 §7。

## 1. 治理与基线

- [ ] 1.1 Owner 对准确 draft SHA 标记 APPROVED；填写 proposal Consumer Impact §10，裁定 design Q1/Q2；Q1 若选不发布 optional summary，先删改相应 delta/场景后重新校验批准。
- [ ] 1.2 核对实施 base/target SHA、干净 worktree、active overlap；再次读 ownership map、C1–C9、ledger/async-submit 当前 owner，不使用 archived proposal 的旧行号推断最新实现。
- [ ] 1.3 明确 implementer、独立测试作者、fresh-context Claude Code reviewer、安全 reviewer 和 Integrator；测试作者只按批准 spec 写 RED，不以产品实现作 oracle。单文件单 writer。
- [ ] 1.4 记录 runtime/GUI/packaged host 可用性、既有 smoke 缺口与 TICKET-127–131 disposition；未运行的平台不得提前勾通过。
- [ ] 1.5 建立 source SHA / RED suite SHA / final verified SHA / fresh review SHA / local merge SHA 独立栏位；任何后续产品代码变化使验证与 review verdict 同时失效。

## 2. 路由点清单与目录模型

- [ ] 2.1 以 design §2 的 P01–P24 为基线逐一核对 file:line、caller、输入/输出、R/C/B 归类；有新必需选择点先登记范围，不笼统删除 provider/source/event switches。
- [ ] 2.2 冻结 RouteQuery、route descriptor/schema、精确匹配/歧义拒绝、factory/probe 引用和 readonly projection 的内部 test seams；executionProfile 独立于 mode，completion 的 mode/profile 为 null。
- [ ] 2.3 证明 api/protocol entry surface 与 execution leaf 的单表关系，固定 desktop SDK/app-server、headless exec、Codex policy-grant、completion 对照矩阵；原 parser 范围不扩展。
- [ ] 2.4 冻结 baseline error/exit/stdout/stderr/diagnostic oracle 和 policy precedence（design D4），区分 adapter-local result exit 与最终 normalized exit；不得把所有拒绝统一改成 exit 3。
- [ ] 2.5 固定 main-only factory/probe、shared DTO、renderer mechanical transport factory 依赖图；证明无 catalog→adapter→catalog、catalog→readiness→status→catalog readiness 环，无反向 router import。
- [ ] 2.6 明确无迁移：无 DB/schema、无 routeId 持久化、无 reset、无安装 resolver 变更；catalog 不承担 submit/pump、claim、ledger、artifact 或 provider policy。

## 3. 目录实现与散落点替换

- [ ] 3.1 在独立 RED suite 冻结后实现 `runtime-route-catalog.ts`：静态声明、schema/reference 校验、唯一 descriptor、可枚举确定性查询、missing/ambiguous fail closed；禁止 arbitrary module load 和运行时 override production table。
- [ ] 3.2 引用 shared capability、现有 policy、projection availability；保持支持/降级/不支持与 adapter-specific enforcement 的交集，无重复 capability table。
- [ ] 3.3 原子替换 P01/P02/P05 的选择逻辑；删除 headless adapter-selector.ts 及旧 exports/callers，保留 exec/claude -p/native projection 与原 observer/ledger 流向。
- [ ] 3.4 替换 P06–P10：移除 runtime-registry facade、DesktopRuntimeAdapterFactory、Codex/Claude selection wrappers；纯 capability caller 直调 shared owner，构造与 policy retry 留 native adapter owner。
- [ ] 3.5 P11/P12 的固定执行 delegate 改接目录；既有 preflight/binding/admission/exact-owner checks、MCP、persistence、finalizer 顺序不改；不做 Claude route 全量服务抽取。
- [ ] 3.6 P18/P19/P22 readiness/list wiring 查目录；runtime-readiness 保留 probe/cache/default-profile owner，status 与 readiness 分离避免递归；不把 advisory unknown/needs-auth 当 admission 拒绝。
- [ ] 3.7 P23 的 kind→runner 选择接目录，pumpQueuedRuns 仍唯一 queued dispatch；claimGate 仍在 conditional claim 后、provider 前。source slots/worker identity/env/heartbeat/retention/cancel 原样；P24 的 API/stdio 继续 submit+scoped pump。
- [ ] 3.8 P14/P15 用同一个 `runtime-route-transport.ts` 替换两个 Engine 分支；P16 按 transportId 构造既有 wire adapters，无 runtimeId→transport 表；P17 的 event-state core 无 Engine 分支改动。
- [ ] 3.9 保留 P03/P04/P13/P17/P20/P21 六个相邻 owner；用 S20/S25/S31/S32 证明取消、制品、fallback、provider 未越权迁移。

## 4. 守卫与删除

- [ ] 4.1 在 `scripts/check-architecture-guards.mjs` 增加“Runtime Route Catalog Single Owner”节；pin production owner、声明域、合法 factory/probe references；匹配 runtimeId 决定 adapter/transport 的 AST 结构。
- [ ] 4.2 S26/S27 逐项覆盖 design D5 retired module/export/call site，包含 alias、namespace import、一跳 wrapper、runtime-keyed map、两处分支重引入、重复目录；正反例精确 findings 自检。
- [ ] 4.3 S28 验证 import direction/组合循环；保持 ledger/submit/route-growth/import baselines，不放宽旧 ratchet，不引入全目录豁免。
- [ ] 4.4 S29 保留 provider target/purpose、policy mode、job.source cancel、method parser、native decoder、chunk.type 和 transportId 构造合法正例；S30 阻止 catalog 内第二 queue/ledger/artifact/credential owner。
- [ ] 4.5 更新 `docs/OWNERSHIP_MAP.md`：新增 **Runtime Route Catalog** owner 行/节、consumers、禁止重复路径、factory/probe 依赖；替换旧 Headless Adapter Selection、Desktop Factory、Codex adapter selection 所有权声明；保持 submit/pump、ledger/host、run-artifacts、capabilities、readiness/provider/projection、renderer event owner。
- [ ] 4.6 删除点清单 P01–P24 逐行回填结果，旧 exports/aliases/callers 清零；无 migration flag/双业务表。`desktop-runner.ts` 的 ledger helper、native adapters、agentJobs source cancel 不误删。

## 5. 公共边界（discovery/文档）

- [ ] 5.1 Q1/Q2 已批准后实现 shared safe descriptor + 内部 `agentRuntime.listRoutes` discovery；既有 listManifests 和 chat IPC 外形保留，renderer 篡改 descriptor 不越过 main binding 验证。
- [ ] 5.2 如按推荐批准，`runtimes[].routes` 只追加 optional public summaries；由同一目录投影，公开 api/protocol 合法组合；不加 feature/required request field/新 runtime enum/error code，既有 readiness/features 全保留。
- [ ] 5.3 更新 `src/shared/local-job-api.ts` 的 optional DTO 和 `docs/local-job-api-v1.schema.json`、中英文 consumer guides/examples；标明描述性路线不是授权、advisory readiness 不是 daemon readiness、absent routes 不否定原 features；这些是实施任务，起草阶段不改这些文件。
- [ ] 5.4 声明 `runtime.<id>.v1` schema/maturity/redaction 引用，Codex 使用现有 public schema definition 与 producer；不重新复制 raw union，不公开 main file paths、factory、env、tokens，不增加 public requiredExtensions。
- [ ] 5.5 public golden 固定完整 bytes/channels/exits；任何 default/policy/ack/enum/未知字段行为差异重新做 C7 十类，Red 写 Owner decision needed 并停止受影响部分。
- [ ] 5.6 consumer E2E 仅记实际 receipt 或 unknown；保留 TICKET-127–131 已接受但未完成残余，不冒充修复或稳定平台支持。

## 6. Conformance fixtures（测试先行）

- [ ] 6.1 独立作者仅从批准 delta/design 起草 S01–S32 的 bun 测试，产品实现前提交 RED suite；保真场景可为 baseline pass，但目录新行为/删除守卫必须有可解释的 failure-before，不用无条件 throw 或只检查不存在文件制造 RED。
- [ ] 6.2 目录/匹配 S01–S09：非法表、排列不变、精确 desktop/headless/profile/kind、未知/歧义、tampered descriptor、既有 preference fallback、completion 无 child。
- [ ] 6.3 能力/readiness/extensions S10–S13：canonical reference、adapter evidence、cache/no-probe、bad default、projection availability 与 unknown optional/required 扩展。
- [ ] 6.4 headless/pump S14–S17：完整保留 batch argv/stdin/cancel，rich 不暗选；两 DB 连接竞争、source exclusions、scoped dispatch、replay 不二次执行。
- [ ] 6.5 renderer/actions S18–S20：两个创建入口、unknown transport、stub third Runtime 不改 dispatcher/event-state、exact owner cancel/retry 拒绝。
- [ ] 6.6 public S21–S25：真实 handler golden、old/new schema/reader、executor-env、errorCode/exit/channel、artifact/refusal 与 partial publish 不绕过。
- [ ] 6.7 guards S26–S30、native/provider S31–S32：正负 mutation findings、所有删除点、import/cycle、相邻 owner 白名单范围、fallback 禁止与 secret-safe projection。
- [ ] 6.8 冻结 suite SHA、fixture hashes、基线运行/RED 原因；实现者不得自行改 oracle 使测试通过，契约疑义由统筹裁定并另记 test-adjudication SHA。

## 7. Fixture 目录约定与场景绑定

**明确选扁平布局**：所有本切片 fixture 文件直接置于
`tests/fixtures/runtime-route-catalog/`，不使用分域子目录。每个 JSON 的顶层以 Sxx 为 key，
spec GIVEN 的 `file.json#Sxx` 是准确键，不是随意 prose anchor。当前只写这些路径的规格，
不创建 tests 文件。独立作者需同步 spec、此表和 verification 注册表才能变更布局。

| 文件（根下） | Scenario keys | 最低内容 / oracle |
| --- | --- | --- |
| catalog.json | S01, S02 | 声明/引用/重复或相交变体、稳定枚举与无副作用 ports |
| routes.json | S03, S04, S31 | desktop/headless/API/protocol accepted matrix、verified context、app-server failure 不 exec fallback |
| policy.json | S05, S08 | grant/scope/enforcement/preferred-source 原结果和诊断 |
| refusals.json | S06 | unknown/missing/ambiguous/invalid-combination、zero-call oracle |
| renderer.json | S07, S18, S19 | tampered descriptor、两个 entry points、compiled transports、stub manifest/package 和 source hash |
| completion.json | S09 | 两 family 显式 profile、single upstream、agent-only fields 拒绝 |
| capabilities.json | S10, S12 | 既有 manifests、projection owner responses、无 adapter kind |
| readiness.json | S11, S23 | default/native、fake clock/cache、no-probe/failure、caller/executor 非秘密 env sentinels |
| extensions.json | S13 | 已有 Codex schemaRef、unknown optional/required、错误 namespace/schema |
| headless.json | S14, S15 | 旧 source/profile 请求、argv/stdin/cancel/rich factory spies |
| executor.json | S16, S17 | 两连接 claim latches、source slots、scoped pump、replay/wait |
| desktop-actions.json | S20 | exact old/new owner、job-source cancel/retry envelopes |
| public-contract.json | S21 | 基线完整 stdout/stderr/exit/events/result（预先固定 IDs/time/worker 等，不在比较后归一化） |
| discovery.json | S22 | optional routes、缺字段 old response、同 queries 预期摘要；引用两个 frozen 支持文件 |
| errors.json | S24 | 各层原失败语义、JSON-RPC/desktop、zero-provider oracle |
| artifacts.json | S25 | stable-directory win32 拒绝、committed terminal incomplete publication |
| architecture-fixtures.json | S26, S27, S28, S29, S30 | source 文本内联到 JSON、exact expected findings 与 clean variants；不得随实施改为“只要失败就算过” |
| provider.json | S32 | explicit/model-only/default/native references、gateway cleanup 与 secret-safe outputs |
| discovery-schema-before.json | S22 supporting | 从 `6192b13f:docs/local-job-api-v1.schema.json` 冻结、记录 SHA-256，不手写宽松旧 schema |
| discovery-reader-before.ts | S22 supporting | 从已发布 unknown-field/common-core 规则写的 neutral old reader，记录来源/版本；不是冒充真实 Career Kit/Amadeus adapter |

- [ ] 7.1 独立作者按上表创建 fixtures，核对所有 GIVEN 路径/键实际可加载；CI/测试报告登记缺失和重复 key。
- [ ] 7.2 测试文件固定前缀 `tests/runtime-route-catalog-*.test.ts`；在 verification 逐 Sxx 填具体 test file/name、RED/GREEN SHA、断言及限制，不以一个 omnibus test 掩盖未覆盖子项。
- [ ] 7.3 使用隔离临时 DB/profile、fake clock/claim latches/recording ports，不读真实 secret、不依赖用户 HOME；fixtures 不调用真实计费 Runtime。真实 smoke 另列 §8。
- [ ] 7.4 Stub third Runtime 仅进入 test catalog/dependency ports，production ID/公共 enum 不扩；resolver/renderer dispatcher/event-state 的代码哈希与行为证据同时记录。

## 8. 验证、评审与停止门

- [ ] 8.1 同一准确 source SHA 跑 targeted `bun test --isolate tests/runtime-route-catalog-*.test.ts`（shell 展开）、有关既有 headless/desktop/async/ledger/provider tests、`bun run architecture:check`、`bun run check:full`、两种 strict OpenSpec validation 和 `git diff --check`；依赖/host 限制原样记录，不把未执行写 PASS。
- [ ] 8.2 可重复 Desktop smoke：Claude/Codex 各 plan/agent、project/folderless、显式 profile 与 native、普通文本/工具/question/guard/取消/旧 Run 不取消新 Run、重载后读取；确认 descriptor 选择及原 UI 行为。
- [ ] 8.3 CLI/daemon/stdio smoke：两 runtime batch、Codex policy-grant、completion、create/submit/wait/retry/cancel/events、daemon-first 与 own-pump、未知 required capability、no-probe readiness、无凭据拒绝与 child teardown；stdout/stderr/exit 留脱敏回执。
- [ ] 8.4 macOS/Windows packaged 分别记录 app/runtime SHA/digest/OS/arch、同 neutral fixtures；Windows artifact-bearing request 的既有失败单列。Linux/WSL source 通过不替代 Tier-1 stable gate，不宣称 TICKET-130 平台矩阵已完成。
- [ ] 8.5 Codex IMPLEMENTATION_VERIFIED 与 fresh-context Claude Code REVIEW_APPROVED 绑定同一准确 source SHA；另有 fresh security lens 验 factory/secret/descriptor boundary。P0/P1 必须解决，P2 有明确 disposition，后续代码变化使两 verdict 失效。
- [ ] 8.6 **停止门**：无 Owner APPROVED/独立 RED、缺 mandatory evidence、旧 selector 残留、未裁定 Red 或必要前置越界时不宣称实施完成/接受；Green 自主修，Yellow 只登记 follow-up，Red 回 Owner。host-blocked 只能列具体缺口，不能记通过。
- [ ] 8.7 **统筹代行 ACCEPTED 条件声明**：仅 Owner 的明确自我迭代 mandate 已覆盖本切片（Q3）时可代行；须同 SHA 两技术 verdict、无开放 Red、全部验收/残余逐项裁定、未测场景如实记载，记录授权依据/统筹身份/日期/SHA。否则等待 Owner ACCEPTED；派单本身、测试通过、姊妹 acceptance 不构成授权。
- [ ] 8.8 后续本地 merge/archive 仅按届时批准范围和派单处理，merge SHA 重跑门禁；冲突/target 前移/代码变化重新双验。本次起草明确不 merge、不 archive。
- [ ] 8.9 **Push 规矩**：没有针对本切片准确 SHA 与 remote target 的 Owner 明确授权不 push、不远程 PR mutation/merge/tag/release。统筹代行 ACCEPTED 或历史 push policy 不等同本次外部动作授权；若以后明确派单，先固定 source/target 和门禁，再执行该动作，不能扩到其他 refs。本次唯一 Git 产物为本地单一文档提交。
