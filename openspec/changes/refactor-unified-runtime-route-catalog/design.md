# Design: Unified Runtime Route Catalog

Status: **DRAFT — awaiting Owner APPROVED**

## 1. Context and source basis

本稿是 Phase 3 第三份切片，仅起草，不是实现授权。基线为
`6192b13f74603fbcc57c8ba858cb6b0f0d0ac776`；2026-10-02 已核对主检出 HEAD、
本地 origin/main 与 `git ls-remote origin refs/heads/main` 三者一致。主检出干净；
新 worktree 为 `/home/chen/projects/locus-refactor-unified-runtime-route-catalog-draft`，
分支 `codex/refactor-unified-runtime-route-catalog-draft`。以下当前事实的 `file:line`
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

| Living source | 本次处理 |
| --- | --- |
| `openspec/specs/agent-runtime-core/spec.md:8`, `:101`, `:325`, `:400`, `:421`, `:486`, `:514`, `:877` | 新增可独立测试的目录要求；既有执行、preflight、policy、ledger、submission 要求不覆盖、不删场景。 |
| `openspec/specs/agent-runtime-capabilities/spec.md:6`, `:67`, `:122` | 新增目录引用/投影约束；清单仍为 capability truth，runtime support 不等于每个 adapter support。 |
| `openspec/specs/runtime-capability-projection/spec.md:25`, `:47`, `:63` | 回归约束，无 delta；不把安装状态、投影状态、MCP verified usability 混成路由 readiness。 |
| `openspec/specs/provider-runtime-bindings/spec.md:8`, `:104`, `:134`, `:163` | 回归约束，无 delta；profile/default/native、gateway/cleanup/redaction 保留原 owner。 |
| `openspec/specs/codex-runtime-parity/spec.md:166`, `:182`, `:197`, `:211` | 回归约束，无 delta；目录不更换 native surface，不提升能力等级。 |
| `openspec/specs/desktop-agent-jobs/spec.md:8`, `:48`, `:90`, `:104` | 新增 renderer 只读路由消费与 exact-owner 保持要求。 |
| `openspec/specs/headless-agent-jobs/spec.md:137`, `:363` | 完整 MODIFIED Headless Adapter Selection Boundary；新增 pump 调用目录的边界，不改 queue/claim。 |
| `openspec/specs/architecture-ownership/spec.md:23`, `:75`, `:234`, `:365`, `:408`, `:447` | 新增单目录守卫；既有 ledger/submit/import/route ratchet 全保留。 |
| `openspec/specs/local-job-api/spec.md:33`, `:52`, `:261`, `:292`, `:422`, `:462`, `:528` | 新增目录重构的公共保真及 optional discovery 要求；v1/async-submit 既有要求不改写。 |

## 2. 路由点清单（事实底稿）

统计单位是一个可识别的选择/投影/边界职责，不是每个 `if`。共 **24 处**：
**12 处替换选择逻辑（R）**、**6 处改接目录但保留原职责（C）**、**6 处保留的相邻 owner（B）**。
这里只读识别，并未修改代码。主要重复是 desktop/headless 两套 adapter 集合、两套
desktop factory caller、两处 renderer Engine 分支，以及 discovery/registry 的独立枚举。
不同 native transport 是产品分面，不是需要删除的重复执行内核。

| ID / 类别 | 当前 file:line / symbol | 输入 → 输出 | 重复、分歧及实施处置 |
| --- | --- | --- | --- |
| P01 R | `src/main/lib/headless/adapter-selector.ts:83`, `:106`, `:266`, `:292` | runtime/profile/mode/required caps/permission → adapter + selected/refused + fallback diagnostic | batchAdapters、codexAppServerAdapter 和分派分支转为目录声明；删除整个 selector 及旧导出，校验算法迁入目录但仍调用 capability/policy owner。 |
| P02 C | `src/main/lib/headless/agent-runtime.ts:16`, `:44` | normalized request → selection status + adapter.run result | 改接目录；保留 observer 入口，不能自有 runtime switch。 |
| P03 B | `src/main/lib/headless/adapters/claude-code.ts:180` | 已选择 Claude request → bundled `claude -p` process result | Native invocation/env/credential adapter；保留，不把 SDK 代替 batch。 |
| P04 B | `src/main/lib/headless/adapters/codex.ts:103`, `:121` | 已选择 Codex batch request → `codex exec` process result | 保留 exec、env allowlist、scrub、provenance；不自动 rich fallback。 |
| P05 C | `src/main/lib/headless/adapters/codex-app-server.ts:49`, `:79`, `:186` | Codex policy-grant request → desktop-shaped native adapter request/result | `assertAppServerPolicyGrantRequest` 的 runtime/profile 选择判断由目录接管；本地只保留所选 route token/assertion 和 native request 投影，grant 规则调用原 policy owner；不借本次消除 synthetic desktop shape（C8 后续）。 |
| P06 R | `src/main/lib/agent-runtime/runtime-registry.ts:23`, `:31`, `:38`, `:44`, `:52`, `:59` | scope/runtime/capability → manifest/ID/gate | 当前 scope 被忽略，只遍历 CONTRACT_RUNTIME_IDS；不是安装或 adapter registry。删除门面；路由枚举接目录，纯 capability/alias caller 直达 shared owner。 |
| P07 R | `src/main/lib/agent-runtime/desktop-runner.ts:66`, `:73` | runtime/source + mutable adapter map → desktop adapter | 删除 adapterKey、DesktopRuntimeAdapterFactory、lookup 专用类型；保留 adapter 契约、metadata 匹配断言及 `:45` ledger adapter-started 入口。 |
| P08 R | `src/main/lib/codex/desktop-adapter-selection.ts:11` | env（现已不决定路径）→ sole app-server metadata | 删除 resolveCodexDesktopAdapterSelection 和重复 selection metadata，目录固定 desktop route；native experimental env 开关不属于 runtime 选择。 |
| P09 R | `src/main/lib/codex/app-server-adapter-runner.ts:41`, `:79`, `:89`, `:124` | verified request + selection + secrets/ports → constructed adapter.run | 删除 resolveCodexAppServerDesktopAdapter 和 selection 依赖；目录是唯一 factory 选择方；该文件只构造单一 native adapter，保留插件配置、exact owner checks。 |
| P10 R | `src/main/lib/claude/agent-sdk-adapter-runner.ts:110`, `:119`, `:137` | verified SDK context → factory.get → adapter with policy retry | 删除 resolveClaudeAgentSdkDesktopAdapter 及 factory lookup；policy retry/stream consumer 仍归 Claude，不复制进目录。 |
| P11 R | `src/main/lib/trpc/routers/codex.ts:758`, `:779` | chat envelope/binding/preflight → Codex adapter runner | 固定 runtime 专用执行入口改为调用目录解析结果；保留原 tRPC procedure、envelope、既有有序 orchestration 与 run-stage owners。 |
| P12 R | `src/main/lib/trpc/routers/claude.ts:407` | verified desktop request + SDK ports → Claude lifecycle | 固定 execution delegate 改为目录返回的 factory/delegate；Claude route 暂存业务不是全部抽取范围，不做整路由 service 重构。 |
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
| P23 R | `src/main/lib/headless/daemon.ts:426`, `:459` | claimed-candidate job.kind → completion/agent runner | 仅把 kind→runner 选择表达式改为目录 execution delegate；pump、claim、worker identity、source slots、retention、claim gate 顺序均留在 daemon/既有 runner。 |
| P24 C | `src/main/lib/headless/jobs-stdio.ts:268`, `:278`, `:293`; `src/main/lib/headless/cli-dispatcher.ts:1284`, `:1913` | API/stdio envelope → submit/pump 或 discovery | 协议本身无独立 runtime selector；沿 submit/pump 间接到目录。保留 command/method switch，它们是 envelope parsing。 |

## Decisions — 统筹预设 L1–L10（Owner 可改）

| ID | 原预设及本稿落实 |
| --- | --- |
| L1 | 单一 main owner `src/main/lib/agent-runtime/runtime-route-catalog.ts`，按 `(runtimeId, surface=desktop\|headless-exec\|headless-app-server\|completion\|protocol\|api, kind, mode, capabilities)` 解析 adapter factory、transport、能力引用、就绪探针；所有 runtime 选择改查目录并删旧分派。profile 作为不可省略的补充维度，见 D1。 |
| L2 | 声明式 TypeScript 常量、schema 校验/守卫、可枚举；discovery/renderer 只读。新增 Runtime = 目录条目 + adapter 包（包含 capability manifest/projection/fixtures），无需新 renderer runtime switch/core 状态分支。 |
| L3 | 引用现有 capability manifest 与 readiness probes，不复制；无条目 fail closed，内部结构化失败经既有错误信封投影。advisory readiness 不是启动授权。 |
| L4 | Local Job API v1（含 async-submit）、jobs-stdio、desktop IPC 外形不改；仅 discovery optional 追加；C7 十类逐条分类，Red 交 Owner。 |
| L5 | ledger/host、run-submission/pumpQueuedRuns、run-artifacts 仅是既有目标/端口；目录没有 ID、queue、claim、event、artifact 或 terminal 状态。 |
| L6 | 守卫新增单目录 owner 节，禁止 adapter/surface 自行 runtime 分派、重复目录；P01–P24 给出精确删除/保留边界。 |
| L7 | runtime 特有 metadata 按 `runtime.<id>.v1` 声明 namespace、schema 来源、version、maturity、redaction；现有 `runtime.codex.v1` 只引用。 |
| L8 | 第三 Runtime 接入、Runtime 版本交付、renderer UI 重构、Interaction/Session 均非目标；conformance/delivery 分属 `add-harness-runtime-conformance` / `add-managed-codex-runtime-delivery` 等切片。 |
| L9 | 每个 Scenario 有 bun 测试入口、fixture、observable oracle；独立作者先 RED。fixture 根 `tests/fixtures/runtime-route-catalog/`，**扁平**约定固定于 tasks §7。退出码以代码为依据。 |
| L10 | canonical owner、删除点、migration gate、验证消费者、owner 文件映射齐全；OWNERSHIP_MAP 新行仅列实施任务，本 DRAFT 不改 docs。 |

## D1. 目录模型、匹配与无状态边界

目录是 main/lib 中静态、可冻结的声明数据，不是 plugin loader、可写全局注册中心或按用户
配置任意加载模块的能力。运行时 ID/alias 仍由 shared capability owner 定义；每个 runtime
descriptor 唯一，但可有多个唯一 routeId。重复 runtime descriptor、routeId、相交匹配域、
不存在的 factory/probe/manifest/schema 引用均在初始化校验时报错，不以数组顺序择一。

建议内部 seam（批准后实现，名称供独立测试固定）：

```ts
type RouteQuery = {
  runtimeId: string;
  surface: "desktop" | "headless-exec" | "headless-app-server" |
    "completion" | "protocol" | "api";
  kind: "agent" | "completion";
  mode: "plan" | "agent" | null; // completion: null，不虚构 agent mode
  executionProfile: "batch" | "policy-grant" | "interactive" | null;
  requiredCapabilities: readonly string[];
  requiredExtensions: readonly string[]; // internal only，不加 v1 请求字段
  permissionPolicy: ResolvedPolicySummary | null;
};
validateRuntimeRouteCatalog(declarations, references);
resolveRuntimeRoute(query, catalog); // pure Result；不执行 factory/probe
listRuntimeRoutes(filter, catalog); // readonly safe descriptors
projectRuntimeRoutes(catalog, audience); // public 或 renderer allowlist
probeRuntimeRouteReadiness(resolvedRoute, context); // 仅组合既有 probes
```

Result 成功含稳定 routeId、selected runtimeId、executionSurface、adapterSource、
main-only factory/delegate、transport descriptor、manifest reference、readiness probe reference、
enforcement label、extension schema references。失败含内部 reason、runtime/surface/kind/profile、
现有 capability/policy diagnostic；不得含 request prompt/env/secrets。内部 reasons 为
`route_not_found`、`route_ambiguous`、`catalog_invalid`、`unsupported_required_extension`，
它们不自动成为 public error codes。校验失败的 catalog 不可用于执行。

匹配：已规范化 runtime → surface/kind/profile/mode 精确候选 → 现有 policy 拒绝优先级 →
adapter enforcement evidence → manifest required-capability gate → required-extension gate →
唯一 route。capability 是限制集合，不是“有更多能力就升级到 rich adapter”的排名依据。
set 去重/排序只用于比较，不改请求可见值；没有 first-match、跨 runtime fallback 或
任意 factory 名称输入。主进程最后仍按 DB binding/verified context 重校验 runtime，不能信任
renderer 修改过的 descriptor。selected route token 可内存标识，不能成为 durable Run ID/lease。

surface 同时含入口与执行分面：`api`、`protocol` 是入口维度，返回的 executionSurface
为 `headless-exec` / `headless-app-server` / `completion`；它们引用同一个 leaf route/factory，
不是再注册第二份 runtime 表。声明可列允许的入口集合，初始化展开时仍检查重复/相交。
`source=cli|daemon|schedule|api|protocol|desktop` 保持 job provenance，与 surface 不互相改写。

| runtime / kind | 入口与 profile | selected execution / transport | 必须保持的行为 |
| --- | --- | --- | --- |
| claude-code / agent | desktop，interactive，plan/agent | claude-agent-sdk / Agent SDK，renderer 原 claude.chat IPC | preflight、policy、binding、MCP、stream/finalize 保持。 |
| codex / agent | desktop，interactive，plan/agent | codex-app-server / JSON-RPC stdio，renderer 原 codex.chat IPC | 只有 app-server，无 desktop exec fallback。 |
| claude-code / agent | headless-exec、api、protocol，batch | claude-code-batch / process stdio | `claude -p`；CLI/daemon/schedule 仍为 batch。 |
| codex / agent | headless-exec、api、protocol，batch | codex-batch / process stdio | `codex exec`；不因 app-server 就绪自动更换。 |
| codex / agent | headless-app-server、api，policy-grant | codex-app-server / JSON-RPC stdio | bounded grant 及现有 admission-audit-only 标记；hardToolGuard 仍拒绝。protocol 当前 parser 不接受此 profile，不放宽。 |
| claude-code / agent | api，policy-grant | 拒绝；原 policy_grant_adapter_unavailable | 不能借 manifest 的 desktop supported 声称 headless 可强制 scope。 |
| 两个既有 runtime family / completion | api 或 completion，profile/mode=null | locus-completion delegate / provider HTTP | runtime.id 是 provider family；显式 profile，一次 upstream、零 agent child，provenance 保持 locus-completion。不是第三 Runtime。 |

非法 combinations（desktop completion、headless interactive、exec policy-grant、未知 mode 等）
无 executable route；既有 parser 不接受的请求仍先由原 parser 拒绝。合法输入的原错误优先级
通过基线 oracle 固定，不能因为提早查询目录改变 public stdout/stderr 或创建/claim 时点。

## D2. Factory 组合、依赖方向与文件落点

目录选择的是 adapter/delegate，执行仍由现有 host 完成。纯查询不调用动态 import、probe、
provider read、DB 或 spawn。main-only factory 用 lazy reference/injected dependencies，
不在模块加载时构造 native adapter。surface host 传入已经验证的 context/既有 ports，
不能传入 runtime→factory 的自建映射来覆盖 production 表。

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
| `src/main/lib/headless/daemon.ts`、`job-runner.ts`、`completion-runner.ts` | pump 请求目录的 kind delegate，继续独占 queued dispatch；agent runner 的 adapter 查询仍只查同一目录。claim gate 位置、heartbeat、retention 不迁入目录。 |
| `src/main/lib/trpc/routers/{codex,claude,agent-runtime}.ts` | execution 只调用目录选出的 delegate，discovery 只投影；原 procedure 与 stream envelope 不改。不新增 catalog→tRPC 反向 import。 |
| NEW `src/renderer/features/agents/lib/runtime-route-transport.ts` | 按 main 返回 transportId 找已编译的 transport factory；未知 ID 报错，不默认 Claude。只映射 transportId→构造函数，不维护 runtimeId→transportId，两个旧 transport 仍为 wire adapters。 |
| `src/renderer/features/agents/main/active-chat.tsx` | P14/P15 替换成同一只读 descriptor consumer；不改 UI 布局、Chat lifecycle、binding owner。 |
| `src/renderer/features/agents/lib/runtime-event-state.ts` | 维持 chunk.type 状态处理，测试第三 stub runtime 不需修改此文件。 |
| `scripts/check-architecture-guards.mjs`、`docs/OWNERSHIP_MAP.md` | 实施时新增目录 owner 节；更新 Headless Adapter Selection、Desktop Factory、Codex selection 条目，删除旧 owner 声明，保留其他 owner。 |

L1 的“全部 if/switch”限定为**选择 runtime/adapter/transport 的业务分派**。
command/method envelope switch、native protocol switch、mode policy、provider protocol mapping、
job-source cancellation 以及 chunk.type 状态机保留原 owner。禁止用 broad regex 把这些合法
职责误判为路由重复。adapter 可以断言它收到自己的 route，但不能改选另一 adapter。

## D3. Renderer、capability、readiness 与 extension 投影

renderer 从现有 main discovery 命名空间获得 safe route DTO（拟 additive
`agentRuntime.listRoutes`，只读内部 discovery；已有 listManifests 和 chat procedure 外形不改）。
binding.runtime 仍来自 chat-session-binding；main 为该 binding 解析 descriptor，renderer
构造 transport 时不能从历史 metadata、provider label 或默认 Engine 推断路线。DTO 中的
transportId 是编译期支持的机械传输 key，不是任意路径、endpoint URL 或动态模块地址。
runtime adapter 包可提供 transport encoder/factory registration；以后新增条目使用既有
common transport 或包内新增 encoder，不改 dispatcher switch/event reducer。测试使用隔离
catalog + stub 包，不扩 production CONTRACT_RUNTIME_IDS，也不声称第三 Runtime 已接入。

readiness 是观察，不是 admission：保留 `ready|needs-auth|unavailable|unknown`，保留
default-profile 优先、坏 default 不 native fallback、`--no-probe`、30 秒 Codex cache。
`needs-auth/unknown` discovery 不能拦截一个显式 profile 的合法请求；执行前仍走原 preflight/
provider/claim-time gates。CLI probe 只描述调用进程，不冒充 daemon 的环境（async-submit 已接受的差异）。
catalog 只选 probe，不能把 route 存在、manifest supported 或 projection installed 写成 ready。

扩展声明格式：namespace=`runtime.<runtimeId>.v1`、schemaVersion=1、maturity、schemaRef、
redactionOwner。现有 Codex 引用 `src/shared/local-job-api.ts:27` 的 namespace、`:34` 的类型和
`docs/local-job-api-v1.schema.json:1388` 中的 definition，准确 JSON Pointer 为
`#/$defs/eventPayloadExtensions/properties/runtime.codex.v1`；发事件仍由 ledger/serializer
完成（`src/main/lib/agent-runtime/run-event-ledger.ts:337`, `:1214`）。目录不复制 raw vendor
union，不对每条记录强制添加 extension，不 retroactively 延展 pending provenance。
unknown optional extension 被只读消费者忽略；internal required extension 未注册则查询失败。
**不新增 v1 requiredExtensions 字段**；真实 public negotiation 另行 C7 决策。

可选 public discovery 追加仅为每个 runtime 的 `routes?: RouteSummary[]`，拟公开字段固定为
`{routeId, surface, kind, executionProfile, adapterSource, transport, extensions}`；
extension 元数据固定 `{namespace,schemaVersion,maturity,schemaRef}`，schemaRef 是发布的 schema
`#/$defs/...` 指针（不得把仓库私有绝对路径公开）。transport 仅为说明性字符串，不是启动地址。
仅列 `surface=api|protocol` 的可请求组合；internal desktop 工厂/probe/transportId 不公开。
原 manifest/readiness/features、请求 schema 和 enums 不变，不新增 discovery feature。
旧 schema 的 runtimeManifest 允许 unknown fields（schema `:1001`、`:1318`），指南的
unknown optional field 规则仍须用独立 old-reader fixture 验证，不能只凭 JSON parse 成功。
Q1 若选择不发布该字段，则保留内部 discovery，本 public optional delta 必须在批准稿中删除，
不得用运行时 feature flag 保留第二 production catalog。

## D4. 错误与退出码（代码基线，不从指南推断）

目录内部失败不定义新的公共退出码。已有 malformed input 保持原 parsing/admission
时点和 stdout/stderr；持久化后失败由 runner/ledger settle，目录本身不造 error/completed。
既有合法输入必须与 frozen baseline 的完整 envelope/bytes、errorCode、exit 一致。

| 路径 / 失败 | 当前代码依据 | 本稿约束 |
| --- | --- | --- |
| outcome 0/1/2/3/4/5/6/7/8 | `src/main/lib/headless/job-runner.ts:58`, `:170` | 分别 success/runtimeFailed/invalidArguments/unsupportedRuntimeOrMode/missingCredentials/canceled/localOnlyBlocked/invalidCwd/internalFailure；无重新编号。 |
| required capability refused | `src/main/lib/headless/adapter-selector.ts:154`; `job-runner.ts:176` | adapter result 原始 exitCode=1，最终 normalization 为 unsupported_capability/3；测试不能混淆两层。 |
| policy/profile/interaction refusal | `adapter-selector.ts:215`, `:234`, `:247`, `:314`, `:325`; `job-runner.ts:209` | permission_policy_fail_closed、policy_grant_adapter_unavailable、guarded_scope_requires_pre_execution_hook、interactive_channel_required、unsupported_execution_profile 的现有 runner outcome 均落通用 1；不能为统一目录擅改为 3。 |
| API invalid runtime / profile | `src/shared/local-job-api.ts:537`, `:739`, `:898`; `src/main/lib/headless/cli-dispatcher.ts:1500` | 原 parser 的 Unsupported 消息与 API error projection 保持；不是把所有拒绝都改为一个 catalog public code。 |
| claim-time revalidation | `src/main/lib/headless/local-job-api.ts:1798`; `job-runner.ts:191`, `:198` | project/cwd→7、execution_profile_invalid→3，provider codes 走原 2/4/6；时点仍在 conditional claim 后。 |
| provider profile missing/mismatch/unavailable/local-only | `src/main/lib/headless/provider-binding.ts:33`, `:44`, `:54`, `:60`; `job-runner.ts:182` | 保留相应 provider code 及 2/4/6；无 native fallback。 |
| wait timeout | `src/shared/local-job-api.ts:1046`; `src/main/lib/headless/cli-dispatcher.ts:1266` | 9 仅用于 runs wait timeout；目录不参与 wait FSM。 |
| jobs-stdio error | `src/main/lib/headless/jobs-stdio.ts:83`, `:404`, `:407`, `:428` | 既有 JSON-RPC envelope 和 -32601/-32602/-32700 等解析映射保持；Run failure 沿 job events，不改协议版本。 |
| desktop adapter failure | `src/main/lib/trpc/routers/codex.ts:797`; `src/main/lib/trpc/routers/claude.ts:407` | 沿现有 stream error/finish envelope，不把 CLI exit 放进 IPC。 |
| 无条目 / 目录损坏（新内部 seam） | NEW resolveRuntimeRoute；已有 `job-runner.ts:201` internal_error→8 | 纯查询结构化拒绝，零 factory/probe/submit；启动期 schema invalid 阻止执行。若在已验证请求后因实现缺陷缺 route，走既有 internal_error host failure；不得 fallback。非既有 public 输入的 synthetic test 不伪装旧合同变化。 |

## D5. 删除、守卫与 migration gate

同一实施 change 原子替换 P01/P06–P12/P14/P15/P18/P23 的选择职责；P02/P05/P16/P19/P22/P24
只改 wiring。删除清单以 §2 的 file:line 为审查 oracle，至少守卫以下 retired symbols/modules：
`headless/adapter-selector.ts`、`agent-runtime/runtime-registry.ts`、`DesktopRuntimeAdapterFactory`、
`resolveCodexDesktopAdapterSelection`、`resolveCodexAppServerDesktopAdapter`、
`resolveClaudeAgentSdkDesktopAdapter`、旧 readiness dispatch facade 与两个 renderer Engine 分支。
不保留 forwarding export、旧 alias、第二注册表或 ENV 切换旧路径。

守卫新增“Runtime Route Catalog Single Owner”节：AST/结构化扫描 runtimeId/binding.runtime
分支驱动 factory/transport 选择、runtime-keyed adapter map、旧 helper import/call（含 renamed
import、namespace import 和一跳 wrapper）；目录声明只有一个 production owner。检测范围为
agent-runtime/headless/codex/claude、相关 tRPC、renderer transports/active-chat。保留 §2 B 类
合法边界的正例，不采用放行整个 adapters 目录的宽豁免。守卫不宣称静态证明任意反射/动态 import/
任意深度间接调用；动态加载在本目录禁止，间接执行由 factory-spy 行为测试补充。
fixture self-test 精确比对 findings（file/symbol/owner），漏报和多报都失败。

**无迁移**：无 DB/schema/持久化 routeId、无 reset/reseed，无 Runtime 安装迁移。
migration gate 是 source 原子 cutover：Owner APPROVED → 独立 RED suite → 所有旧选择点替换
且 guard 通过 → 同一 source SHA 全验与 fresh review。没有双路径 flag；试验 catalog 仅能在
测试依赖注入中构造，production 不可选旧 selector。回滚为完整代码/测试/文档切片 revert，
不单独恢复某旧 selector；停执行/重启后用同一兼容数据 owner，不触碰外部 repository/artifact。

## D6. 残余、风险、验证消费者与 scope envelope

| 残余出处（基线 file:line） | 与路由的关系 / 本稿处置 |
| --- | --- |
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

## Open questions（Owner 一句话决策项）

1. **Q1 — discovery**：是否按推荐允许 `runtimes[].routes` 可选描述追加（不加 feature/请求字段），或本次只发布内部只读 discovery？推荐允许，须 §10 Consumer Impact 明确选择。
2. **Q2 — renderer/IPC 范围**：是否确认 L2 包含删除两处 Engine 分支、增加内部只读 `agentRuntime.listRoutes` 与 transportId factory 消费，保留 chat IPC 外形和 event-state owner？推荐确认；若连只读 discovery procedure 也不允许增加，须先调整 L2/L4 的组合要求。
3. **Q3 — 验收代行**：本切片是否适用统筹代行 ACCEPTED 的 Owner 自我迭代授权？仅在明确覆盖本切片、同 SHA 双 verdict、无开放 Red 且残余已逐项裁定时适用；姊妹提案中的授权记录不自动授权本稿验收或 push。

上述问题均在 DRAFT 审批解决；没有对 L1–L10 的隐式改写。当前没有实施、独立技术 verdict、
Owner APPROVED/ACCEPTED、合并或外部写入。
