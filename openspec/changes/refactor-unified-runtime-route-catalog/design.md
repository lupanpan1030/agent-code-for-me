# Design: Unified Runtime Route Catalog

Status: **DRAFT v2 — awaiting Owner APPROVED**

## 1. Context and source basis

本稿是 Phase 3 第三份切片，仅起草，不是实现授权。基线为
`6192b13f74603fbcc57c8ba858cb6b0f0d0ac776`；2026-10-02 已核对主检出 HEAD、
本地 origin/main 与 `git ls-remote origin refs/heads/main` 三者一致。主检出干净；
新 worktree 为 `/home/chen/projects/locus-refactor-unified-runtime-route-catalog-draft`，
分支 `codex/refactor-unified-runtime-route-catalog-draft`。以上为第一版基线核对记录，不声称第二版重新联网核对。第二版在干净 HEAD
`f7a3f7bd454b95deb7ae6f6596efebe0dd3d9cf3` 上按 fresh synthesis 改写；
权威：`route-catalog-draft-synthesis-f7a3f7bd.md` §3 1–14 / Must-stay，
以及 2026-10-02 本次统筹派单 OD-1–OD-5。以下当前事实的 `file:line`
均绑定该基线，NEW 标记的是拟新增落点，不声称已存在。起草前 active changes 为空。

| 输入 | 约束 / 本切片处理 |
| --- | --- |
| `docs/ideas/locus-product-direction-harness-strategy.zh-CN.md:515`, `:519`, `:758`, `:770` | Phase 3 公共执行核心；Phase 7 新 Runtime 不改 renderer switch/core state machine；批次 3 独立路由目录；四项交付锚点。本文按已落地 ledger → async-submit → catalog 的实际顺序，不将 §12 列表误读成已实施次序。 |
| `docs/ideas/locus-interoperability-contract-v1.zh-CN.md:41`（C1） | 不新增 Conversation identity，不从消息 metadata 推断当前 runtime。 |
| 同文件 `:150`（C2） | Run 是 attempt；目录不分配 runId、不创建 job 镜像、不拥有 retry。 |
| 同文件 `:254`, `:334`（C3） | 面向未来单一 RuntimeHost 的可复用 main/lib 模块；本切片不启动 Host、不新增 socket/service，也不把当前多进程 topology 宣称为 C3 完成。 |
| 同文件 `:362`, `:379`（C4） | 使用既有 DB chat binding 和 execution provenance；不新增 lease、installation pin、successor binding 或安装选择器。 |
| 同文件 `:449`, `:522`（C5） | 目录可描述 interaction 要求，不能回答问题、授予权限或成为 Interaction 状态机。 |
| 同文件 `:536`, `:666`（C6） | 无 Handoff、历史搬运、ContextGrant；用户选择 runtime 不由目录静默替换。 |
| 同文件 `:690`, `:702`, `:740`, `:758`, `:796`, `:824`, `:873`, `:910`, `:921`（C7） | Internal 原子替换；完整十节 Consumer Impact；十类行为逐项分类；small common core + `runtime.<id>.v1`；无 public 新请求字段或强制 extension negotiation。 |
| 同文件 `:959`, `:1009`, `:1071`, `:1112`, `:1160`（C8） | route catalog 不是 RuntimeInstallationRegistry/Resolver；保持 Codex desktop app-server、headless exec/policy-grant 分面；无 Codex Worker、Claude Worker、下载/激活或 PATH/latest fallback。 |
| 同文件 `:1282`, `:1301`, `:1317`（C9） | Locus 拥有 neutral conformance，consumer E2E unknown 不等于无 consumer；macOS/Windows stable packaged gate 与 Linux experimental 区分。 |
| `docs/ideas/locus-ai-collaboration-workflow.zh-CN.md:121`, `:164`, `:173`, `:484`, `:550` | APPROVED、同 SHA 双技术 verdict、ACCEPTED 分开；旧路径同 change 删除；外部写入须准确 SHA/target 授权。 |
| `docs/OWNERSHIP_MAP.md:8`, `:24`, `:60`, `:83`, `:297`, `:319`, `:332`, `:350`, `:471`, `:497`, `:540` | capability、projection、renderer event、binding、preflight、selection、desktop、ledger、Claude/Codex、submission/pump 的当前 owner。目录只接收路由选择职责。 |
| `openspec/changes/archive/2026-10-01-refactor-canonical-run-event-ledger/proposal.md:45`, `:60`; 同目录 `design.md:168`, `:235`, `:420`, `:546` | ledger/host、provenance、artifact 已归档；当时明确不改 runtime selection。本稿不重做其业务 owner。 |
| `openspec/changes/archive/2026-10-02-add-local-job-api-async-submit/proposal.md:39`, `:260`; 同目录 `design.md:72`, `:79`, `:142`, `:174` | async-submit 已归档到本基线；submitRun/waitForRun、pumpQueuedRuns、claim gate、publication readiness、idempotency 等原入口保留。目录不能取代队列 dispatch owner。 |
| `docs/consumer-impact-template.zh-CN.md:17` | proposal 十节逐项填写；第 10 节保持未批准。 |

Living specs 的约束审阅及 delta 选择：

`agent-runtime-core:433` Runtime Adapter Source Metadata 保留：它规定可公开的安全 metadata
与“若发生 fallback 必须诊断”的通用条件，不强迫保留 dead preferredAdapterSource option；
本切片该条件不产生新 fallback，S08/S45 固定 null。Agent Runtime Contract 的 registry 术语
也完整 MODIFIED 为目录；所有 living 场景完整保留，原 preferred fallback 场景明确改成无隐式
降级，新增 fixture/入口登记 S33–S52，不留下指向 retired registry/selector 的要求。

| Living source | 本次处理 |
| --- | --- |
| `openspec/specs/agent-runtime-core/spec.md:8`, `:101`, `:325`, `:400`, `:421`, `:486`, `:514`, `:877` | 新增目录要求，并完整 MODIFIED Agent Runtime Contract、Capability Honesty、Runtime-Neutral Agent Runner；其余 preflight/policy/ledger/submission 不改。合成称“Runtime Capability Truth”的 :85 实际位于 Capability Honesty，按真实标题修改，不能造同名新 requirement。 |
| `openspec/specs/agent-runtime-capabilities/spec.md:6`, `:67`, `:122` | 新增目录引用/投影约束；清单仍为 capability truth，runtime support 不等于每个 adapter support。 |
| `openspec/specs/runtime-capability-projection/spec.md:25`, `:47`, `:63` | 回归约束，无 delta；不把安装状态、投影状态、MCP verified usability 混成路由 readiness。 |
| `openspec/specs/provider-runtime-bindings/spec.md:8`, `:104`, `:134`, `:163` | 回归约束，无 delta；profile/default/native、gateway/cleanup/redaction 保留原 owner。 |
| `openspec/specs/codex-runtime-parity/spec.md:166`, `:182`, `:197`, `:211` | 完整 MODIFIED Codex Runtime Parity Dependency（:8–21），把 shared runtime registry 改为目录；其余为回归约束，不更换 native surface/能力等级。 |
| `openspec/specs/desktop-agent-jobs/spec.md:8`, `:48`, `:90`, `:104` | 新增 renderer 只读路由消费与 exact-owner 保持要求。 |
| `openspec/specs/headless-agent-jobs/spec.md:137`, `:363` | 完整 MODIFIED Headless Adapter Selection Boundary；新增 pump 与目录相邻边界，不改 kind→runner/queue/claim。 |
| `openspec/specs/architecture-ownership/spec.md:23`, `:75`, `:234`, `:365`, `:408`, `:447` | 完整 MODIFIED Runtime Execution Boundary Ownership，并新增单目录守卫；既有 ledger/submit/import/route ratchet 全保留。 |
| `openspec/specs/local-job-api/spec.md:33`, `:52`, `:261`, `:292`, `:422`, `:462`, `:528` | 新增目录重构的公共保真及 optional discovery 要求；v1/async-submit 既有要求不改写。 |

## 2. 路由点清单（事实底稿）

统计单位是一个可识别的选择/投影/边界职责，不是每个 `if`。共 **33 处**（P33 合列两个 job-runner seam）：
**11 处替换选择逻辑（R）**、**6 处改接目录但保留原职责（C）**、**16 处保留的相邻 owner（B）**。
这里只读识别，并未修改代码。主要重复是 desktop/headless 两套 adapter 集合、两套
desktop factory caller、两处 renderer transport 构造分支，以及 discovery/registry 的独立枚举。
不同 native transport 是产品分面，不是需要删除的重复执行内核。

| ID / 类别 | 当前 file:line / symbol | 输入 → 输出 | 重复、分歧及实施处置 |
| --- | --- | --- | --- |
| P01 R | `src/main/lib/headless/adapter-selector.ts:83`, `:106`, `:266`, `:292` | runtime/profile/mode/required caps/permission → adapter + selected/refused + fallback diagnostic | batchAdapters、codexAppServerAdapter 和分派分支转为目录声明；删除整个 selector 及旧导出，校验算法迁入目录但仍调用 capability/policy owner。 |
| P02 C | `src/main/lib/headless/agent-runtime.ts:16`, `:44` | normalized request → selection status + adapter.run result | 改接目录；保留 observer 入口，不能自有 runtime switch。 |
| P03 B | `src/main/lib/headless/adapters/claude-code.ts:180` | 已选择 Claude request → bundled `claude -p` process result | Native invocation/env/credential adapter；保留，不把 SDK 代替 batch。 |
| P04 B | `src/main/lib/headless/adapters/codex.ts:103`, `:121` | 已选择 Codex batch request → `codex exec` process result | 保留 exec、env allowlist、scrub、provenance；不自动 rich fallback。 |
| P05 B | `src/main/lib/headless/adapters/codex-app-server.ts:49`, `:79`, `:186` | Codex policy-grant request → desktop-shaped native adapter request/result | 保留 `assertAppServerPolicyGrantRequest` 的三重 fail-closed 检查：Codex runtime、policy-grant profile、非空 bounded grantedScopes；目录与 leaf 均校验。S05 直接 leaf 负例 / S29 正例保护；native synthetic desktop shape 留 C8。 |
| P06 R | `src/main/lib/agent-runtime/runtime-registry.ts:23`, `:31`, `:38`, `:44`, `:52`, `:59` | scope/runtime/capability → manifest/ID/gate | 当前 scope 被忽略，只遍历 CONTRACT_RUNTIME_IDS；不是安装或 adapter registry。删除门面；路由枚举接目录，纯 capability/alias caller 直达 shared owner。 |
| P07 R | `src/main/lib/agent-runtime/desktop-runner.ts:66`, `:73` | runtime/source + mutable adapter map → desktop adapter | 删除 adapterKey、DesktopRuntimeAdapterFactory、lookup 专用类型；保留 adapter 契约、metadata 匹配断言及 `:45` ledger adapter-started 入口。 |
| P08 R | `src/main/lib/codex/desktop-adapter-selection.ts:11` | env（现已不决定路径）→ sole app-server metadata | 删除 resolveCodexDesktopAdapterSelection 和重复 selection metadata，目录固定 desktop route；native experimental env 开关不属于 runtime 选择。 |
| P09 R | `src/main/lib/codex/app-server-adapter-runner.ts:41`, `:79`, `:89`, `:124` | verified request + selection + secrets/ports → constructed adapter.run | 删除 resolveCodexAppServerDesktopAdapter 和 selection 依赖；目录是唯一 factory 选择方；该文件只构造单一 native adapter，保留插件配置、exact owner checks。 |
| P10 R | `src/main/lib/claude/agent-sdk-adapter-runner.ts:110`, `:119`, `:137` | verified SDK context → factory.get → adapter with policy retry | 删除 resolveClaudeAgentSdkDesktopAdapter 及 factory lookup；policy retry/stream consumer 仍归 Claude，不复制进目录。 |
| P11 R | `src/main/lib/trpc/routers/codex.ts:758`, `:779` | chat envelope/binding/preflight → Codex adapter runner | admitCodexChatSessionBindingRun 后以固定 codex 查询，断言 typed route 后才传 secret-bearing ports；保留原 tRPC procedure、envelope、既有有序 orchestration 与 run-stage owners。 |
| P12 R | `src/main/lib/trpc/routers/claude.ts:407` | verified desktop request + SDK ports → Claude lifecycle | admitClaudeChatSessionBindingRun 后以固定 claude-code 查询，断言 typed route 后才传 SDK ports；Claude route 暂存业务不是全部抽取范围，不做整路由 service 重构。 |
| P13 B | `src/main/lib/trpc/routers/agent-jobs.ts:89`, `:113`, `:118` | persisted job.source/status → desktop cancellation / store cancel / retry rejection | 无 runtimeId adapter 分派。source 的 cancel/retry ownership 保留，禁止把它误删为重复选择器；不改现有 API/desktop retry 提示。 |
| P14 R | `src/renderer/features/agents/main/active-chat.tsx:6065` | canonical binding.runtime → Codex transport 或 IPC fallback | 删除 runtime if/else（未知 Engine 不能默认 Claude）；只消费 main 投影的 transport descriptor。 |
| P15 R | `src/renderer/features/agents/main/active-chat.tsx:6355` | newly created binding.runtime → 同样两个 transport | 第二个重复分支同 change 删除，与 P14 使用同一 descriptor consumer。 |
| P16 C | `src/renderer/features/agents/lib/ipc-chat-transport.ts:314`; `src/renderer/features/agents/lib/codex-app-server-chat-transport.ts:196` | per-adapter payload → claude.chat/codex.chat subscription | 保留现有 wire、request encoder、cancel closure；transport factory 按 transportId 机械构造，不再按 runtimeId 推断选择。不是第二份 runtime catalog。 |
| P17 B | `src/renderer/features/agents/lib/runtime-event-state.ts:149`, `:157` | chunk.type → shared question/guard atom update | 这是 event-type switch，**不是 runtime switch**；保持单一状态 owner，不删除、不新增 Engine case。 |
| P18 R | `src/main/lib/headless/runtime-readiness.ts:310`, `:319` | runtime/default provider/probe → advisory readiness | 删除 public orchestration 的 Claude/else-Codex dispatch；目录引用该文件的 native probe 与 default-provider composition，probe/cache/credential 规则仍仅此处拥有。 |
| P19 C | `src/main/lib/headless/local-job-api.ts:481`, `:786` | registry list + runtime readiness / required capabilities → v1 discovery / admission gate | 接目录只读枚举/route resolution；保留 serializer、admission 时点与错误映射，不能新增 submit/pump。 |
| P20 B | `src/shared/agent-runtime-capabilities.ts:1`, `:14`, `:207`, `:252` | runtime alias/ID → capability manifest/gate | 清单和 alias 唯一真相保留；目录只引用，不复制能力常量/表。新增真实 runtime 仍需这个 owner 的 manifest（随 adapter 包提交）。 |
| P21 B | `src/main/lib/headless/provider-binding.ts:150`, `:172`, `:507`, `:550` | runtime + explicit/default profile/model → provider binding/gateway/cleanup | runtime→provider target/purpose/protocol 是 provider policy，非 runtime→adapter 路由；保留表及优先级，不让目录改选 provider。 |
| P22 C | `src/main/lib/trpc/routers/agent-runtime.ts:5`; `src/main/lib/trpc/routers/claude-code.ts:4`; `src/main/lib/codex/runtime-status.ts:46` | manifest/status request → safe metadata | route discovery 改接目录；纯 manifest caller 直达 shared。status 用目录只读 metadata，不能从 catalog 再调用 runtime-status 形成递归 readiness。 |
| P23 B | `src/main/lib/headless/daemon.ts:426`, `:459` | queued candidate job.kind → completion/agent runner | 保留 pump 自有 kind→runner 分派（claim 在 runner 内），包括 worker prefix 的 kind 分支 :432–438；目录只在 agent runner claim 后查询，不能 pre-claim 选 delegate。S16/S17 验证，async guard clean fixture 不放宽。 |
| P24 C | `src/main/lib/headless/jobs-stdio.ts:268`, `:278`, `:293`; `src/main/lib/headless/cli-dispatcher.ts:1284`, `:1913` | API/stdio envelope → submit/pump 或 discovery | 协议本身无独立 runtime selector；沿 submit/pump 间接到目录。保留 command/method switch，它们是 envelope parsing。 |


| P25 B | `src/renderer/features/agents/main/active-chat.tsx:2678` | approval provider → codex/claude.respondToolApproval | 保留本切片外的 Interaction dispatch（含 Claude default）；不是 transport 构造。OD-1 具名残余 → Phase 4 Interactive Runs / add-harness-runtime-conformance，S19 不覆盖 approval。 |
| P26 B | `src/renderer/features/agents/main/active-chat.tsx:346`, `:2513`, `:5866` | new-binding defaults / token accounting / MCP config runtime → 对应 UI 行为 | 三处均保留原 owner，S29 逐一正例；不将全部 active-chat runtime 字面量判作重复路由。 |
| P27 B | `src/main/lib/chat-session-binding.ts:231`, `:279` | durable binding + procedure-specific payload → admit/rejectStaleRunPayload | 保留两个 admit gate 与顺序；S07 从真实 claude.chat/Codex binding 错配验证，descriptor 不跨 IPC。 |
| P28 B | `src/main/lib/chat-session-binding.ts:147` | binding.runtime → provider target | P21 同族 provider policy，保留 codex/claude target mapping，不迁入目录。 |
| P29 B | `src/main/lib/desktop-agent-jobs.ts:99` | runtime → assertDesktopRuntime closed allowlist | 保留 admission 边界；第三真实 Runtime 必须改此 allowlist，列 OD-1 残余，不声称全链零改动。 |
| P30 C | `src/main/lib/codex/runtime-status.ts:46`, `:90`, `:183` | selection metadata + native status → codex.getRuntimeStatus | P08 删除同时从目录取 adapters.selection 与原 hint 文本，保留私有 IPC 字段/值；probe 与 metadata composition 分开。P22 仍负责 discovery caller，避免重复计数。 |
| P31 B | `src/main/lib/agent-runtime/run-event-ledger.ts:1205` | runtimeId === codex + native metadata → runtime.codex.v1 | producer 目前 Codex-only，L7 声明不自动实现新 Runtime producer；batch routes extensions=[]，rich 声明与实际 producer 交叉测试。 |
| P32 B | `src/renderer/features/agents/lib/runtime-manifest-store.ts:17` | legacy alias → canonical runtime ID | 现有 alias 表重复 shared aliases，留为具名残余；不是新 transport 映射，S29 保留，真实第三 Runtime conformance 再处理。 |
| P33 B | `src/main/lib/headless/job-runner.ts:140`, `:351`, `:369` | options.runner / LOCUS_HEADLESS_FAKE_RUNNER → runner；job.source → API-only profile options | resolveRunner 注入优先、ENV fake 次之、runAgentTask 最后，生产构建也支持既有 ENV；保留为目录外测试端口，不是旧 selector migration flag。source→profile gate 保留。S14/S21/S24 禁用 fake runner，使用 recording catalog ports，S29 逐一正例。 |

## Decisions — 统筹预设 L1–L10（Owner 可改）

| ID | 原预设及本稿落实 |
| --- | --- |
| L1 | 单一 main owner `src/main/lib/agent-runtime/runtime-route-catalog.ts`，按 `(runtimeId, entry=desktop\|headless\|completion\|protocol\|api, kind, mode, executionProfile, capabilities)` 解析 adapter factory、transport、能力引用、就绪探针；所有 runtime 选择改查目录并删旧分派。executionSurface 是输出，不能由 caller 预选 leaf；L1 限定见 D2。 |
| L2 | 声明式 TypeScript 常量、schema 校验/守卫、可枚举；discovery/renderer 只读。**OD-1 缩窄 L2：统筹预设（推荐默认，Owner 可改）**：本切片支持目录条目 + adapter 包 + 自有 main chat router/transport 通过静态编译映射注册；不修改 main 中央分派。renderer 只读投影，现有 transport 构造及事件状态机语义保持；新 wire family 仍需加 renderer transport 和修改 transportId→constructor 静态映射，不承诺所有 renderer switch 零改动。Phase 7 全验收留具名残余。 |
| L3 | 引用现有 capability manifest 与 readiness probes，不复制；无条目 fail closed，内部结构化失败经既有错误信封投影。advisory readiness 不是启动授权。 |
| L4 | Local Job API v1（含 async-submit）、jobs-stdio、desktop IPC 外形不改；仅 discovery optional 追加；C7 十类逐条分类，Red 交 Owner。 |
| L5 | ledger/host、run-submission/pumpQueuedRuns、run-artifacts 仅是既有目标/端口；目录没有 ID、queue、claim、event、artifact 或 terminal 状态。 |
| L6 | 守卫新增单目录 owner 节，禁止 adapter/surface 自行 runtime 分派、重复目录；P01–P33 给出精确删除/保留边界。 |
| L7 | runtime 特有 metadata 按 `runtime.<id>.v1` 声明 namespace、schema 来源、version、maturity、redaction；现有 `runtime.codex.v1` 只引用。 |
| L8 | 第三 Runtime 接入、Runtime 版本交付、renderer UI 重构、Interaction/Session 均非目标；conformance/delivery 分属 `add-harness-runtime-conformance` / `add-managed-codex-runtime-delivery` 等切片。 |
| L9 | 每个 Scenario 有 bun 测试入口、fixture、observable oracle；独立作者先 RED。fixture 根 `tests/fixtures/runtime-route-catalog/`，**扁平**约定固定于 tasks §7。退出码以代码为依据。 |
| L10 | canonical owner、删除点、migration gate、验证消费者、owner 文件映射齐全；OWNERSHIP_MAP 新行仅列实施任务，本 DRAFT 不改 docs。 |

## D1. 目录模型、匹配与无状态边界

目录是 main/lib 中静态声明的 TypeScript 表，不是 plugin loader、可写注册中心或动态模块加载器。
生产声明为 module-private、初始化校验后 deep-frozen 的唯一 singleton；没有配置/ENV/fs 读入，
没有 production setter。运行时 alias/ID 仍归 shared capability owner。重复 descriptor、routeId、
相交匹配域、缺 agent factory 或 manifest/schema 引用均为初始化 `catalog_invalid`，禁止部分表执行。
需要 readiness 的 agent routes 必须有 probe 引用；completion 可 `readinessProbe: null`（不代表 ready），
agent 缺 probe 非法。enforcement evidence 来自 leaf 导出的 typed constant，目录不能自写更强标签；
不一致 = `catalog_invalid`。headless 基线固定为 claude-code-batch/codex-batch: sandbox-level，
codex-app-server: admission-audit；生产表及真实 reference ports 也必须在 S01 CI 校验。

内部冻结 seam（NEW，供独立 RED 作者）：

```ts
type RouteQuery = {
  runtimeId: string;
  entry: "desktop" | "headless" | "api" | "protocol" | "completion";
  requiredCapabilities: readonly AgentRuntimeCapabilityId[];
  requiredExtensions: readonly string[]; // internal only
} & ({
  kind: "agent";
  mode: "plan" | "agent";
  executionProfile: "batch" | "policy-grant" | "interactive";
  permissionPolicy: AgentRuntimePermissionPolicySummary; // non-null, owner resolved
} | {
  kind: "completion";
  mode: null;
  executionProfile: null;
  permissionPolicy: null;
});
validateRuntimeRouteCatalog(declarations?, references?); // test-only export; omitted inputs validate real production table/ports
createRuntimeRouteCatalogForTests(declarations, references); // same validator, no second algorithm
resolveRuntimeRoute(query, catalog?: ValidatedRuntimeRouteCatalog); // default singleton, pure Result
listRuntimeRoutes(filter, catalog?: ValidatedRuntimeRouteCatalog); // readonly stable routeId order
projectRuntimeRoutes(audience, catalog?: ValidatedRuntimeRouteCatalog); // typed public | renderer overloads, exact allowlists
probeRuntimeRouteReadiness(resolvedRoute, context); // existing probe composition only
```

resolver 只接收成功验证的 branded catalog，不接受 raw declarations。所有可选 catalog 参数与构造/validator export
仅供 tests，guard 禁止 production caller 构造表/显式覆盖；同模块初始化可调用内部 validator。
生产初始化失败保留不可执行的 failure state：所有 resolve 返回 `catalog_invalid`，list/projection
不返回 partial catalog；host 用 D4 既有错误通道。Electron main 不在 module import 时 crash；
桌面失败可见，daemon 仍按既有 claim/settle 处理，不能 pre-claim lookup 留 queued 行循环。

host-level 注入口统一命名 `runtimeRouteCatalog?: ValidatedRuntimeRouteCatalog`：desktop execution
hosts、`runAgentTask` 第三 options 参数、`pumpQueuedRuns` 及其转发的 persisted runner options；CLI/stdio/discovery 测试经
RunHeadlessCliCommandOptions、RunJobsStdioServerOptions、LocalJobApiRuntimeManifestEnvelopeOptions
的同名字段转发，生产调用不赋值。
pump 仅原样转发到 runner，绝不解析它。类型与显式 forwarding 边界由 guard allowlist 锁定；
只有 tests 可赋非 undefined，不能来自 tRPC/CLI request、ENV、文件或生产 config。
S03/S14/S15/S16/S21/S24/S31 由该 seam 注入 recording leaf ports，不能用 `options.runner`
或 `LOCUS_HEADLESS_FAKE_RUNNER=1` 绕过目录；P33 的原端口仍作为邻接 owner 保留。
6192b13f 的 baseline 尚无 catalog seam：独立作者只在 leaf 的 process/native/fetch I/O 端
使用 recording stub，仍实际经过旧 selector/runAgentTask，并记录 selected/refused payload；
不能用 runner fake 生成 baseline。实施后同一输入/oracle 改经具名 catalog ports，禁止重录 oracle。

成功 Result 固定含 routeId（进程内描述 key，非稳定 public identity）、runtimeId、entry、
executionSurface（desktop-sdk/desktop-app-server/headless-exec/headless-app-server/completion）、
adapterSource、adapterLabel、typed main-only delegate（agent 必需；completion 为 null，只描述既有 runner，不注册 runner factory）、transport、manifestRef、readinessProbe、
enforcementEvidence、extensions 与 diagnostic（fallbackReason 恒 null）。失败含内部 reason、
query 的 runtime/entry/kind/profile、candidateAdapterSource/candidateAdapterLabel（无候选时 null）、
既有 diagnostic/result（errorCode/errorMessage/adapter-local exitCode）。不得含 prompt/env/secrets。
内部 reason 为 `policy_refused`、`capability_refused`、`route_not_found`、`catalog_invalid`、
`unsupported_required_extension`；没有 `route_ambiguous`，相交总在 validator 返回 catalog_invalid。
内部 reason 与公共 diagnostic.reason 分开，不能覆盖原 message/errorCode。

匹配次序：规范化 runtime → entry/kind/mode/profile 域 → 诊断候选 → 原 refusal chain →
required extension → 唯一 executable leaf。每个 runtime 的 headless entry 域声明 batch 诊断候选；
Codex policy-grant 有其 app-server 候选，Claude API policy-grant 即使没有 executable leaf，
仍以 claude-code-batch 候选评估并返回原拒绝（非非法组合）。候选不可当 executable route。
拒绝优先级严格复制 `adapter-selector.ts:299–343`：fail-closed policy → grant enforcement →
pre-execution requirement → interactive profile → unsupported profile → capabilities。
只有没有候选或通过这些 gate 仍无 executable leaf 才是 route_not_found；不能让缺 route
吞掉可达的 Claude grant / fail-closed / interactive diagnostic。能力集合由
`getAgentRunRequiredCapabilityIds` 与显式 requested 的 owner-derived union 构成
（`agent-runtime-contract.ts:192`），不是 caller 任意字符串或 rich adapter 排名。
删除只有旧测试调用的 preferredAdapterSource option；保持公共 fallbackReason:null，不留 alias。

entry 是请求入口，executionSurface 仅为输出：CLI/daemon/schedule 使用 headless，API 使用 api，
stdio 使用 protocol。entry 映射不预选 exec/app-server，source 保持原 job provenance；P33 的
API-only profile gate 不扩大到其他 source。API/protocol 引用同一个 leaf，不建第二份运行时表。
桌面每个 procedure 在 admit gate 之后以自己的固定 runtimeId 查询，并在 secret-bearing
inputs 之前断言 typed route；descriptor 不在请求里，不赋予身份、lease 或执行授权。

| runtime / kind | 入口与 profile | selected execution / transport | 必须保持的行为 |
| --- | --- | --- | --- |
| claude-code / agent | desktop，interactive，plan/agent | claude-agent-sdk / Agent SDK，renderer 原 claude.chat IPC | preflight、policy、binding、MCP、stream/finalize 保持。 |
| codex / agent | desktop，interactive，plan/agent | codex-app-server / JSON-RPC stdio，renderer 原 codex.chat IPC | 只有 app-server，无 desktop exec fallback。 |
| claude-code / agent | headless、api、protocol，batch | claude-code-batch / process stdio | `claude -p`；CLI/daemon/schedule 仍为 batch。 |
| codex / agent | headless、api、protocol，batch | codex-batch / process stdio | `codex exec`；不因 app-server 就绪自动更换。 |
| codex / agent | api，policy-grant | codex-app-server / JSON-RPC stdio | bounded grant 及现有 admission-audit-only 标记；hardToolGuard 仍拒绝。protocol 当前 parser 不接受此 profile，不放宽。 |
| claude-code / agent | api，policy-grant | 拒绝；原 policy_grant_adapter_unavailable | 不能借 manifest 的 desktop supported 声称 headless 可强制 scope。 |
| 两个既有 runtime family / completion | api 或 completion，profile/mode=null | locus-completion provider-only leaf / provider HTTP | runtime.id 是 provider family；显式 profile，一次 upstream、零 agent child，provenance 保持 locus-completion。不是第三 Runtime。 |

非法 combinations（desktop completion、未知 mode 等）无 executable route；headless interactive
和 Claude API policy-grant 是有诊断候选的拒绝，不能当普通 route_not_found；既有 parser 不接受的请求仍先由原 parser 拒绝。合法输入的原错误优先级
通过基线 oracle 固定，不能因为提早查询目录改变 public stdout/stderr 或创建/claim 时点。

## D2. Factory 组合、依赖方向与文件落点

目录选择的是 adapter/delegate，执行仍由现有 host 完成。纯查询不调用动态 import、probe、
provider read、DB 或 spawn。main-only factory 用 lazy reference/injected dependencies，
不在模块加载时构造 native adapter。surface host 传入已经验证的 context/既有 ports，
不能传入 runtime→factory 的自建映射来覆盖 production 表；D1 具名 host 测试 seam 是唯一受 guard 约束的例外。

| Owner / NEW 落点 | 实施职责 / 禁止事项 |
| --- | --- |
| NEW `src/main/lib/agent-runtime/runtime-route-catalog.ts` | 唯一 production 声明、校验、route 匹配、目录投影、factory/probe 引用编排；不拥有 queue、binding、provider、event FSM。 |
| NEW `src/shared/runtime-route-descriptor.ts` | 只承载可序列化 DTO/schema；无 runtime→adapter 表、无 main import。现有 `agent-runtime-capabilities.ts` 保持清单 owner。 |
| `src/main/lib/agent-runtime/desktop-runner.ts` | 仅 adapter types、匹配断言及 ledger status helper；删除 mutable factory。 |
| `src/main/lib/codex/app-server-adapter-runner.ts`、`src/main/lib/claude/agent-sdk-adapter-runner.ts` | 提供单 Runtime 构造/调用 ports 给目录；不再反向选择目录、不再引用旧 registry/factory，避免 catalog→factory→catalog 环。 |
| `src/main/lib/headless/runtime-readiness.ts` | 现有 readiness default-provider/native 函数、缓存与错误降级；导出 leaf probes 供目录引用，删除 runtime dispatch facade；不反向 import catalog。 |
| `src/main/lib/codex/runtime-status.ts` | 区分 low-level native status probe 与 route metadata composition；native probe 不调用目录 readiness，metadata 查询不会触发 native probe，防止循环。 |
| `src/main/lib/headless/provider-binding.ts`、desktop provider owners | 保留 request/default/native precedence、target/purpose/gateway mapping、tokens 和 cleanup；目录仅引用 safe provider metadata/已验证 ports。 |
| `src/main/lib/runtime-capability-projection/` | 唯一 concrete-capability availability；目录引用已有结果，不从目录条目推导安装/可用状态。 |
| `src/main/lib/headless/daemon.ts`、`job-runner.ts`、`completion-runner.ts` | pump 保留自己的 kind→runner，目录不得 import job/completion runner。agent runner 在 claim/gate/provider binding 后查目录；completion runner 保留既有 provider-only 执行（目录只描述其 metadata，不反向调用 runner）。heartbeat/retention 不迁入目录。 |
| `src/main/lib/trpc/routers/{codex,claude,agent-runtime}.ts` | chat admission 后固定 runtime 查询，使用 per-route typed delegates（Claude SDK ports 与 Codex app-server ports 不混用，不能以 adapterSource switch 分支收窄秘密输入）；discovery 只投影；原 procedure 与 stream envelope 不改。不新增 catalog→tRPC 反向 import。 |
| NEW `src/renderer/features/agents/lib/runtime-route-transport.ts` | 按 main 返回 transportId 找已编译的 transport factory；未知 ID 返回具名 UI failure，不默认 Claude。只映射 transportId→构造函数，不维护 runtimeId→transportId，两个旧 transport 仍为 wire adapters。 |
| `src/renderer/features/agents/main/active-chat.tsx` | P14/P15 替换成同一只读 descriptor consumer；不改 UI 布局、Chat lifecycle、binding owner。 |
| `src/renderer/features/agents/lib/runtime-event-state.ts` | 维持 chunk.type 状态处理，测试第三 stub runtime 不需修改此文件。 |
| `scripts/check-architecture-guards.mjs`、`docs/OWNERSHIP_MAP.md` | 实施时新增目录 owner 节；更新 Headless Adapter Selection、Desktop Factory、Codex selection 条目，删除旧 owner 声明，保留其他 owner。 |

L1 的“全部 if/switch”限定为**选择 runtime/adapter/transport 的业务分派**。
command/method envelope switch、native protocol switch、mode policy、provider protocol mapping、
job-source cancellation 以及 chunk.type 状态机保留原 owner。禁止用 broad regex 把这些合法
职责误判为路由重复。adapter 可以断言它收到自己的 route，但不能改选另一 adapter。

## D3. Renderer、capability、readiness 与 extension 投影

**OD-3：统筹预设（推荐默认，Owner 可改）采用 binding read model。** main 在 chat 查询与
createSubChat 已返回的绑定读模型上盖 `transportId`（内部 additive read-model 字段，不持久化）。
read model composition 可调用目录，durable binding owner 不接管选路；不新增 agentRuntime.listRoutes。
renderer 同步 getOrCreateChat 消费已载入 binding.transportId；无字段/尚未载入时显示
`route_descriptor_unavailable`，读取失败显示 `route_descriptor_error`，未知 transportId 显示
`unknown_transport`（均为内部 UI failure 状态，无新公共错误码），不订阅、不缓存失败 Chat，
刷新成功后正常重试；不添加异步 Chat lifecycle 或 renderer runtimeId→descriptor lookup。
transportId 是机械 key，不是文件路径/endpoint/module。两个创建点统一调用 NEW
`createRuntimeRouteTransport`，由静态编译 transportId→constructor 映射构造原 wire adapters：
`claude-chat-ipc` → IPCChatTransport，`codex-chat-ipc` → CodexAppServerChatTransport
（字符串是内部机械 key，不是 runtime identity）。helper 返回成功 transport 或具名 UI failure
的 Result；entry site 负责显示失败、不缓存失败 Chat。

OD-1 的缩窄 L2 只保证新增 route 不修改 main 中央分派、renderer 只读投影；新 Runtime 的
自有 main chat router/transport 要在编译映射中注册，新 wire family 仍要新增 renderer transport
并编辑 `runtime-route-transport.ts`。本切片保持现有 transport 构造和 event-state 语义；不承诺
第三 Runtime 对所有 renderer switch 零改动。S19 的 fixture 复用现有 wire family，仅证明
helper 与 `runtime-event-state.ts` 的中性消费边界，不证明真实第三 Runtime chat/approval 贯通。
隔离 catalog/stub 包不扩 production CONTRACT_RUNTIME_IDS，也不声称第三 Runtime 已接入。
余项见 D6；Phase 7 行 7 不是本切片的全链验收。

readiness 是观察，不是 admission：保留 `ready|needs-auth|unavailable|unknown`，保留
default-profile 优先、坏 default 不 native fallback、`--no-probe`、30 秒 Codex cache。
`needs-auth/unknown` discovery 不能拦截一个显式 profile 的合法请求；执行前仍走原 preflight/
provider/claim-time gates。CLI probe 只描述调用进程，不冒充 daemon 的环境（async-submit 已接受的差异）。
catalog 只选 probe，不能把 route 存在、manifest supported 或 projection installed 写成 ready。
缺 route/缺 probe/异常观察结果均为 readiness unknown，绝不 ready；缺必需 probe 的表本身先校验失败。

扩展声明格式：namespace=`runtime.<runtimeId>.v1`、schemaVersion=1、maturity、schemaRef、
redactionOwner。现有 Codex 引用 `src/shared/local-job-api.ts:27` 的 namespace、`:34` 的类型和
`docs/local-job-api-v1.schema.json:1388` 中的 definition，准确 JSON Pointer 为
`#/$defs/eventPayloadExtensions/properties/runtime.codex.v1`；发事件仍由 ledger/serializer
完成（`src/main/lib/agent-runtime/run-event-ledger.ts:337`, `:1214`）。目录不复制 raw vendor
union，不对每条记录强制添加 extension，不 retroactively 延展 pending provenance。
unknown optional extension 被只读消费者忽略；internal required extension 未注册则查询失败。
**不新增 v1 requiredExtensions 字段**；真实 public negotiation 另行 C7 决策。

**OD-2：统筹预设（推荐默认，Owner 可改）允许受约束 optional `runtimes[].routes`。**
routes block maturity 为 experimental；每项 exact keys 为
`{routeId,surface,kind,executionProfile,adapterSource,transport,extensions}`，新 schema definition
设 additionalProperties:false；投影必须逐字段构建而不是 spread 内部 descriptor。
`routeId/surface/adapterSource/transport` 是开放描述串，不是 closed enums；文档 known values
列示 api、claude-code-batch/codex-batch/codex-app-server/locus-completion、process-stdio/
json-rpc-stdio/provider-http，不穷举未来值。routeId 非身份、不承诺跨版本稳定，不可持久化作为
请求选择 key；**消费者不得按 adapterSource/transport 分支选择行为**，按既有 features/capabilities
与 request contract 调用。内部已持久化 adapterSource 值的冻结责任仍见 D5，与 public reader
容忍未来开放值不矛盾。

本次仅公开 surface=api 的已接受组合；protocol 路线从 Local Job discovery 省略，jobs-stdio
能力仍由 initialize 拥有。public 不公开 transportId、factory/probe/本地路径，renderer overload
只输出 `{routeId,runtimeId,transportId}`；binding 读模型只取 transportId。
extension 项 exact keys `{namespace,schemaVersion,maturity,schemaRef}`，schemaRef 仅发布的
JSON Pointer。per-route extensions 等于 producer 现实：batch=[]，Codex app-server policy-grant
含 runtime.codex.v1，completion=[]；声明不保证每条 event 都含 extension，不使新 Runtime 自动
获得 producer。S13/S22 同时查询目录与对照实际 ledger producer，不复制 raw vendor union。

既有 manifest/readiness/features/request enums 不变，不新增 discovery feature 或 requiredExtensions。
旧 runtimeManifest schema 接受 optional 字段（schema :1001/:1318），S22 还必须证明 old-reader
面对未知开放值继续保持 common-core 决策；仅 JSON parse 成功不够。Q1 若改 internal-only，
批准前删除 optional public delta/S22 并重校验；若去掉 adapterSource/transport，同步改 exact keys。
Q2 若拒绝 binding read-model 且未选可行替代，S18/S19 与 desktop delta 回审批，不能先实施或
留下“可跳过”的场景；不通过 feature flag 保留第二 catalog。

## D4. 错误与退出码（代码基线，不从指南推断）

目录不定义公共 error/exit。内部 reason 只供 main/tests；既有 diagnostic.message、errorMessage
与字段集合/输出 bytes 固定。尤其不能把 catalog reason 或新描述串送入 regex mapper 或 stdio。
选择在 `job-runner.ts:766–777` 的 provider binding / recordResolvedProvider **之后**发生；原
API admission/claim capability gate 保留原位置和限定能力，不提前执行完整 policy route selection。
“before provider work”指 native provider 调用/adapter startup，不得反向搬动已有 binding 读取
与记录事件。S05 纯 selection/leaf 负例零 provider；S21/S24 host oracle 保留原 binding 顺序。

| Surface / 允许查询位置与失败 | 代码出处 | 原 envelope / message / error / exit oracle |
| --- | --- | --- |
| headless agent runner：claim/gate/provider binding 与 recordResolvedProvider 后，runAgentTask 内 | `src/main/lib/headless/agent-runtime.ts:16–44`; `job-runner.ts:58`, `:170–210`, `:766–777`, `:820–836` | Result 携原 selector code/message，adapter-local exit=1；unsupported_capability normalize→3，其余 policy/profile/interactive 通用→1。try 内抛错为 runtime_error/1，**不是 internal_error/8**；返回正常失败仍由 ledger settle。 |
| API create/submit/retry admission：仅原 validateLocalJobApiRequiredCapabilities 的位置 | `src/main/lib/headless/local-job-api.ts:786–797`, `:939`, `:1060`; `cli-dispatcher.ts:500–552`, `:1500–1516` | gate.diagnostic.message 原样；generic 错误 stderr，/unsupported/i→3，其他→2；project/provider 专属 envelope 与 7/2/4/6 保持。幂等冲突→2，submission_pending→8 不属于选路。不得提前评估执行期 policy refusal。 |
| schedule：原 schedule parsing/admission 位置，执行期通过 agent runner | `src/main/lib/headless/cli-dispatcher.ts:1682–1688` | message 原样；/cwd\|project path\|registered project/i→7，大小写敏感 /Unsupported/→3，否则2；不向 mapper 传新内部 reason。 |
| API claim gate：conditional claim 后、provider 前，仅原 stored-request/capability revalidation | `src/main/lib/headless/local-job-api.ts:1798–1822`; `job-runner.ts:91–99`, `:191–201` | 原 project/cwd→7；stored request/capability invalid 为 execution_profile_invalid→3；claimGateFailure 的意外 throw 才是 internal_error→8，不用此 seam 捕获 route execution 故障。 |
| jobs-stdio：原 request parser/handler；执行经 scoped pump，目录在 runner 内 | `src/main/lib/headless/jobs-stdio.ts:404–411`, `:428` | unknown method -32601，parse -32700；catch 将**原 thrown message 原样**作为 -32602，同时 stderr Request failed；Run 故障沿原 job events。禁止目录新 message 进入这个 request catch。 |
| desktop：admit gate/preflight 后查固定 runtime、secret ports 前断言 typed route | `src/main/lib/chat-session-binding.ts:201–209`, `:231`, `:279`; `trpc/routers/codex.ts:797`; `trpc/routers/claude.ts:407` | 错配保持 rejectStaleRunPayload 原 message/hint；adapter fault 使用原 stream error/finish，不引入 CLI exit。internal catalog fault 用原通道的脱敏 generic failure，不发送内部 reason。 |
| discovery：初始化 / list / projection，不执行部分表 | `src/main/lib/headless/cli-dispatcher.ts:1284–1301`; `src/main/index.ts:421–445`; `src/main/lib/trpc/routers/agent-runtime.ts:5`; `runtime-readiness.ts:323–326` | 初始化无效返回内部 catalog_invalid；manifest list handler reject，不输出 partial/ready 数据。CLI 沿现有 main catch `[Headless] Failed:` stderr、exit1、无 stdout success；私有 tRPC query 走既有 error envelope。host 对 synthetic fault 仅用脱敏 `Runtime route catalog is unavailable.`，不造 public code；readiness 单项缺 route/probe 为 unknown。 |
| provider / wait 邻接映射（无选路） | `src/main/lib/headless/provider-binding.ts:33`, `:44`, `:54`, `:60`; `job-runner.ts:182`; `src/shared/local-job-api.ts:1046`; `cli-dispatcher.ts:1266` | provider profile missing/mismatch/unavailable/local-only 沿原 code 及 2/4/6；wait timeout 独占9。既有 HEADLESS_EXIT_CODES 0–8 原样，无重新编号。 |

内部 reason 与公共结果的映射（不是新增 public codes）：

| Internal reason / 条件 | Public oracle / 原出处 |
| --- | --- |
| policy_refused / fail-closed | permission_policy_fail_closed；reason=原 failClosedReasons[0]，message=原 diagnostics[0]；`adapter-selector.ts:209–232`。 |
| policy_refused / grant gate、pre-execution、interactive、profile | 分别 policy_grant_adapter_unavailable / guarded_scope_requires_pre_execution_hook / interactive_channel_required / unsupported_execution_profile，候选 label/source 与原模板消息；`adapter-selector.ts:234–263`, `:314–333`。 |
| capability_refused | unsupported_capability 与 gate.diagnostic.message；`adapter-selector.ts:154–188`。API admission 只消费同一 capability diagnostic，不能搬入新 route-policy 拒绝。 |
| route_not_found / parser 已接受的请求 | 先用诊断候选完成上述原拒绝链；不得把 Claude grant 变为 missing route。通过全部 gate 后因实现缺陷缺 leaf 才由运行中的 host 抛脱敏 fault→runtime_error/1，绝不 internal_error/8；正常生产表 S01 必须覆盖全部既有 accepted matrix。 |
| catalog_invalid | 初始化 failure state 不执行；各 host 以上述既有通道处理。synthetic init fault 的脱敏 message 仅进入 host fault channel，不能借道 API/schedule regex 或 stdio request catch。 |
| unsupported_required_extension | 仅 internal query Result；v1 无 requiredExtensions 请求字段，不可从合法 public input 达到，零执行；将来 public negotiation 另案 C7。 |

`runtime_selected` payload exact keys（`agent-runtime.ts:33–42`）：
`status,runtime,label,source,adapterSource,executionProfile,fallbackReason`，仅既有 grant case 追加
`policyGrantScopeBinding`；fallbackReason 恒 null。`runtime_selection_refused` exact keys
（`:17–28`）：`status,runtime,source,adapterSource,executionProfile,reason,message,errorCode`。
S21/S24 在 claude-policy-grant、fail-closed、interactive 内部拒绝夹具中固定完整字段和值，
不得加 routeId、transportId 或内部 reason；runtime 是原 canonical ID，候选 source 不可丢失。

## D5. 删除、守卫与 migration gate

同一实施 change 原子替换 P01/P06–P12/P14/P15/P18 的选择职责；P02/P16/P19/P22/P24/P30
改 wiring。P05/P23 保留 B，不能删除其 assertion/kind dispatch。retired 清单：
`headless/adapter-selector.ts`（含 getAgentRuntimeAdapter/selectAgentRuntimeAdapter/SelectAgentRuntimeAdapterOptions/preferredAdapterSource）、
`agent-runtime/runtime-registry.ts`、`DesktopRuntimeAdapterFactory`、`resolveCodexDesktopAdapterSelection`、
`resolveCodexAppServerDesktopAdapter`、`resolveClaudeAgentSdkDesktopAdapter`；P14/P15 原 Engine
分支删除；P18 只删 runtime dispatch facade，保留 native probes。没有 forwarding exports/旧 aliases。

删除 collateral 必须原子处理，否则 `bun run check` 的 stale allowance 检查会失败：

| 文件 / 基线引用 | 实施处置与验证 |
| --- | --- |
| `tests/headless-adapter-selector.test.ts` | 重写到 catalog query/refusal S04/S05/S08；删除 preferredAdapterSource 死 seam 测试，保留 fallbackReason:null oracle。 |
| `tests/agent-runtime-registry.test.ts` | 删除 registry 耦合测试；retired-runtime negative assertions 迁至 S06，合法 manifest assertions 迁 S10。 |
| `tests/desktop-runtime-adapter-factory.test.ts` | 改为 typed catalog factory S03，不保留 mutable factory 测试。 |
| `tests/codex-desktop-adapter-selection.test.ts` | 改 S03/S31/P30 status projection，保留 adapters.selection/hint bytes。 |
| `tests/claude-agent-sdk-adapter-runner.test.ts` | 改用 S03 typed delegate/test catalog ports；保留 native policy retry。 |
| `tests/codex-app-server-adapter-runner.test.ts` | 改用 S03/S31 typed delegate/test ports；保留 native cancellation/failure。 |
| `tests/agent-runtime-preflight.test.ts` | 删除 registry import，manifest 用 shared owner，保留 preflight ordering，S03 交叉验证。 |
| `tests/run-event-ledger-desktop-request.test.ts` | 用 catalog typed delegate 替 factory 构造，ledger request/terminal oracle 原样。 |
| `src/main/lib/headless/agent-runtime.ts:6–9` | 删除 getAgentRuntimeAdapter re-export；adapter 类型按新 canonical contract 同时更新全部 imports，不留 alias。 |
| `scripts/check-retired-runtime-residue.mjs:81–83`, `:209–235` | 与旧 registry test 删除一起移除 stale allowlist；若 S06 承载 retired ID literals，仅为该测试/fixture 加准确路径+原因，不能宽放整个 fixture 目录。 |
| `scripts/check-architecture-guards.mjs:751` | Runtime Core Import Boundary clean fixture 的 ./adapter-selector 改为 ./runtime-route-catalog；其余 ledger/async fixtures 与 ratchet 不放宽。 |
| `docs/OWNERSHIP_MAP.md:319–330` | 完整替换 Headless Runtime Adapter Selection 节为 Runtime Route Catalog Single Owner；同时修 Desktop factory/Codex selection 引用，保留邻接 owners。 |

守卫冻结契约：CLI flag `--runtime-route-catalog-fixtures=<path>`，默认
`tests/fixtures/runtime-route-catalog/architecture-fixtures.json`；JSON 顶层 S26–S30/S48/S50，各值为
`{cases:[{caseId,files:[{file,source}],expectedFindings:[{rule,file,symbol,owner,ownerSection}]}]}`。
文件路径 repo-relative `/`，finding tuple 五键完整且按 code-point 排序精确集合比较。
route 规则 owner=`src/main/lib/agent-runtime/runtime-route-catalog.ts`，
ownerSection=`Runtime Route Catalog Single Owner`。相邻 owner 违规的 owner 指向真正既有 owner，
仍使用该 ownerSection 作为本节守卫入口。规则名冻结：

| rule | 结构与观察 |
| --- | --- |
| route-dispatch-outside-owner | runtimeId/binding.runtime 条件驱动 adapter/transport 选择或 runtime-keyed map（含 alias/namespace/一跳 wrapper）。 |
| duplicate-route-catalog | production 第二份声明表或 constructor/validator import。 |
| retired-route-selector | retired module/export/import/call（包括 forwarding alias）；S27 明列符号。 |
| leaf-adapter-import-outside-catalog | 对 headless/adapters/* 与 app-server-adapter-runner / agent-sdk-adapter-runner 的 run/create exports 的 value import/call 只允许 catalog 与 tests；fixed-runtime 直接 call 也报。leaf 内部 native helper 不是这些跨边界 exports，type-only contract imports 可保留；需要组合的 leaf wrapper 通过目录注入 typed dependency，不为整个目录开白名单。 |
| route-catalog-test-port-in-production | production 显式赋值 runtimeRouteCatalog、传 query/list/projection 的可选 catalog 参数或配置 test constructor；D1 具名 host 仅可原样 forwarding，非覆盖。 |
| route-catalog-forbidden-dependency | main catalog→Electron/tRPC/renderer/preload、router wrapper 或 readiness→catalog 循环。 |
| route-catalog-owner-bypass | catalog 写 queue/claim/events/sequence/terminal/artifacts/secret storage，或读取 process.env/fs/config。 |
| renderer-route-projection-bypass | P14/P15 不调用 createRuntimeRouteTransport(binding.transportId) 或在该构造路径比较 binding.runtime；helper 出现 runtime-ID literal/branch；不误报 P25/P26/P32。 |

成功 summary 精确为 `Runtime route catalog guard self-test: <matched>/<cases> fixture cases matched; repository ownership enforced.`
不匹配为 `Runtime route catalog guard self-test case <caseId> missed <keys-or-nothing> and produced unexpected <keys-or-nothing>. See Runtime Route Catalog Single Owner.` 并 exit1；空 cases/非法 fixture exit1。
保留 `Run event ledger guard self-test: ...`（原 :4551）与
`Local job API async submission guard self-test: ...` 两个原 summary/fixture flag/计数规则，不改其输出。
扫描范围为 agent-runtime/headless/codex/claude、相关 tRPC、renderer transports/active-chat；
B 正例 symbol-specific，无全 adapters 豁免；不声称证明任意反射/无限深调用，factory-spy 补行为。
S27 只恢复可检出的旧 module/symbol/P14/P15 分支；P11/P12 用 S03 typed factory spy，P18 用 S11
probe spy，P23 用 S16/S17，不能把合法 pump ternary 当 mutation failure。

adapterSource IDs 是已持久化 public/replay identifiers（agent-runtime.ts:22/:37、desktop-runner.ts:55）；
改名为 Red，不能用“无迁移”理由忽略。runtime-status 旧 shape 与 hints 一起冻结。

**无迁移**：无 DB/schema/持久化 routeId、无 reset/reseed，无 Runtime 安装迁移。
migration gate 是 source 原子 cutover：Owner APPROVED → 独立 RED suite → 所有旧选择点替换
且 guard 通过 → 同一 source SHA 全验与 fresh review。没有双路径 flag；试验 catalog 仅能在
测试依赖注入中构造，production 不可选旧 selector。回滚为完整代码/测试/文档切片 revert，
不单独恢复某旧 selector；停执行/重启后用同一兼容数据 owner，不触碰外部 repository/artifact。

## D6. 残余、风险、验证消费者与 scope envelope

| 残余出处（基线 file:line） | 与路由的关系 / 本稿处置 |
| --- | --- |
| OD-1 / Phase 7 row 7 残余：P25/P27/P29/P32、P11/P12/P16，`active-chat.tsx`、`chat-input-area.tsx`、`agent-model-selector.tsx` | approval-dispatch（含 Claude default）与 runtime-neutral chat/approval IPC → Phase 4 Interactive Runs / add-harness-runtime-conformance；真实第三 Runtime 自有 chat routers/transports、main allowlists、alias 表与 UI selectors 仍需改动。后两 UI 文件是非目标残余，不计 §2 路由点。S19 不代表这些已解决。 |
| P31 / extension producer | Codex-only runtime.codex.v1 producer 保留；新增 Runtime producer/conformance 属 add-harness-runtime-conformance，L7 声明本身不交付。 |
| `docs/tickets/TICKET-127-run-dir-artifacts-windows-stable-directory.md:11`, `:27` | Windows artifact-bearing admission fail closed；路由不能绕过 stable-directory 或把“有 route”报告成 artifacts available。保留负例；平台修复另案。 |
| `docs/tickets/TICKET-128-run-ledger-creation-atomicity-and-terminal-publish.md:11`, `:32` | 两阶段创建、partial publish/crash repair 属 ledger/store/artifact；不迁入目录。async 已对齐 admission predicate 的部分以当前代码为准，不照抄旧 ticket 行号为现状。 |
| `docs/tickets/TICKET-129-native-run-success-evidence-and-artifact-read-hardening.md:11` | terminal evidence、wire request ordering、history reconciliation、bounded reads 均保留原 owner；不借选路修改 native success 判断。 |
| `docs/tickets/TICKET-130-async-submit-relay-and-windows-verification.md:14` | relay/Windows exit 与 packaged receipts 未齐；保持 source/worker/env、cancel-by-ID，目录不增加取消 FSM。 |
| `docs/tickets/TICKET-131-async-submit-followups.md:14` | race/claim/publish/env/guard 残余不能因本目录测试通过而勾完成；新路由守卫覆盖自己的 alias/wrapper fixture，不宣称修完原 submission guards。 |

验证消费者：Locus neutral API agent/completion（同步与异步）、jobs-stdio、daemon/schedule/
human one-shot、Desktop Claude/Codex、Workbench 只读事件、capability/discovery readers。
Career Kit / Amadeus 为有证据的外部消费者；本任务未运行其 adapter/E2E，状态 unknown，
不是本提案 release veto，也不作为 roadmap driver。source/bun tests、GUI smoke 与真实 packaged
macOS/Windows receipts 分栏；Linux/WSL 不能证明 Tier-1 stable 支持。

风险主要是把 native construction 与选择循环引用、将 advisory readiness 变成 admission gate、
把 provider mapping 误并入目录、或 descriptor 变成 renderer 执行授权。用纯查询 spy、依赖 guard、
原错误 golden、篡改 descriptor 与 exact-owner race fixtures 约束。既有凭据和 root trust boundary
不变；新增 factory 路由面须 fresh security review 检查静态 allowlist 与 secret-safe 投影。

Green：在上表指定文件职责内调整类型/组合，原子删除旧分派；保持所有 public oracle 与 owner。
Yellow：相邻 native/renderer/provider 热区清理、tickets 修复、性能 cache，记录后续不实施。
Red：新 public 字段超出 optional discovery、feature/enum/error/默认值变化、exec→app-server、
新 transport/Host、认证或文件边界、DB/lease/Runtime installation、把状态 owner 搬进目录。
Red 只停受影响部分；若它是完成 L1/L2 的必要前置，则本切片回到 Owner 决策，不能私自缩小验收。

## Open questions（统筹预设（推荐默认，Owner 可改））

本次 2026-10-02 派单已给出五项默认；以下保留备选与后果，不重复索要授权。
对五项裁定无异议；APPROVED 仍需绑定准确草案 SHA，Consumer Impact §10 不代签。

1. **Q1 / OD-2 — discovery**：默认受约束 experimental optional routes（D3）；备选去掉 adapterSource/transport 则同步缩小 schema/fixtures，或 internal-only 则批准前删除 public delta/S22；无约束 closed/stable vocabulary 会使后续 runtime/adapter 演进触发 C7 #2/#10，不选。
2. **Q2 / OD-3 — renderer 数据**：默认 main 在既有 chat/createSubChat binding read model 盖 transportId，不新增 listRoutes；备选 listRoutes 需要 renderer lookup 或 async Chat lifecycle（均扩大当前边界），拒绝读模型且无替代则必须重写 S18/S19/desktop delta 并重新审批，不能留下不可实现承诺。
3. **Q3 / OD-5 — 验收代行**：Owner 2026-10-02 自我迭代指示已覆盖统筹代行 ACCEPTED，条件是同 SHA Codex IMPLEMENTATION_VERIFIED + Claude REVIEW_APPROVED、无开放 Red、残余逐项裁定；Owner 可改为亲自验收。push 依 2026-09-04 规矩由统筹派 Codex，需准确 SHA/target/门禁，本次派单明确不 push，不推导其他远程授权。
4. **Q4 / OD-1 — L2/L4**：默认缩窄 L2 到 D3 的静态 main 注册 + renderer 只读投影，Phase 4/conformance 承接 neutral chat/approval IPC；备选本次批准 runtime-neutral agentRuntime.chat/respondToolApproval（C7 internal，但偏离 L4、进入 C5 并重开 Claude 全路由抽取边界）；两项都不选则原 Phase 7 SHALL NOT 无法兑现，阻断实施。
5. **Q5 / OD-4 — pump**：默认 P23→B，保留 job.kind→runner，目录在 agent runner claim 后查询；备选 catalog dispatch 必须重新裁定 L5、循环依赖、pre-claim failure 与 async guard ratchet 放宽，不能当 Green 实施。

无产品实现、独立技术 verdict、Owner APPROVED/ACCEPTED、合并或外部写入。
