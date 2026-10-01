# Change: Refactor Unified Runtime Route Catalog

Status: **APPROVED 2026-10-02 (coordinator-acted under Owner mandate, bound to a9b74594; Owner may revoke) — awaiting red suite (test-first)**

## Why

Phase 3 的 ledger 和 async-submit 已归档，但“哪个 Runtime/adapter/transport 处理哪类 Run”
仍分散在 headless selector、desktop factory、专用 route delegate、readiness 分支和两处
renderer transport 构造分支（其他 Engine 分支为具名残余）。增加 Runtime 仍需修改多个选择点，discovery 也不能枚举同一份
执行路线。本切片以单一声明式路由目录替换这些选择逻辑，保持已交付运行语义。

产品基线 `6192b13f74603fbcc57c8ba858cb6b0f0d0ac776`（第一版的远端核对记录）；已包含
`add-local-job-api-async-submit` 归档。第二版从指定干净 HEAD
`f7a3f7bd454b95deb7ae6f6596efebe0dd3d9cf3` 改写，依据 fresh synthesis §3 1–14 与本次
OD-1–OD-5 统筹裁定。第三版从 `283f29ca1401f5567df998b850bbc605a064ee5f` 按
`route-catalog-redraft-synthesis-283f29ca.md` §3 T1–T20 / §4 有界修补，保持纯文档 DRAFT。34 处 file:line、输入、输出、重复/分歧见
[design §2](design.md#2-路由点清单事实底稿)。本任务只有文档；统筹代行 APPROVED 已登记，产品实现仍须先冻结独立 RED suite。

## What Changes

- 拟以 `src/main/lib/agent-runtime/runtime-route-catalog.ts` 为 runtime 路由唯一 owner：
  声明条目、校验、确定性查询、factory/transport/capability/readiness 引用和 safe projection。
- 按 runtime/entry/kind/mode/profile/capabilities（executionSurface 仅输出）解析；未知 route、所需能力/扩展不满足 fail closed；声明相交在校验期即 catalog_invalid，错误通过既有 surface envelope，不新增公共 error/exit。
- 原子替换 11 处选择职责，另 7 C / 16 B，删除旧 selector/registry/factory/两处 renderer transport runtime 分支；
  source cancellation、provider policy、native protocol 和 event-type switch 保留其 owner。
- renderer 只读消费 main 盖在 binding read model 的 transportId。**OD-1 缩窄 L2**：目录条目
  + adapter 包 + 自有 main chat router/transport 静态注册，不改 main 中央分派
  （central main dispatch = catalog-owned runtime→adapter-factory/transport/readiness selection，即 R 点）；
  真实第三 Runtime 仍需改 admit gates、assertDesktopRuntime 与 P28 provider ternary（含 Claude default）
  等 main-side runtime-keyed 边界。现有 renderer transport 构造和 event-state 语义不变，
  不承诺第三 Runtime 对所有 renderer switch 零改动，完整残余见 design D6。
- 引用现有 capability、readiness、projection truth；目录不是安装 registry，也不是队列。
- OD-2 允许受约束 experimental discovery 的可选 `runtimes[].routes` 追加；既有 v1/async-submit/jobs-stdio/desktop
  chat IPC 不变。该可选 public scope 已由本提案第 10 节统筹代行批准（Owner 可改）。
- 新增单目录架构守卫、独立作者测试先行的 S01–S53 conformance 规格。

## Impact and four delivery anchors

| 必写项 | 决定（已批准，待实施验证） |
| --- | --- |
| Canonical owner | NEW `src/main/lib/agent-runtime/runtime-route-catalog.ts`；只拥有路线声明/查询/投影/工厂选择。 |
| 旧路径删除点 | design P01/P06–P12/P14/P15/P18：旧 selector、registry facade、desktop factory、runtime-specific selector wrappers、route 固定执行选择、renderer 两处分支、readiness runtime dispatch；P05 assertion 与 P23 pump kind→runner 保留 B，八份耦合 tests/exports/residue allowlist 的原子更新见 D5。 |
| Migration gate | **无迁移**：无 DB/schema/reset/安装迁移；source 原子切换，旧符号/调用清零，守卫与同 SHA 双技术门禁后接受；无双路 flag。 |
| 验证消费者 | neutral Local Job v1 agent/completion/async、stdio、CLI/daemon/schedule、Desktop/Workbench、manifest/discovery/readiness readers；真实 consumer E2E unknown。 |

七份 delta：agent-runtime-core、agent-runtime-capabilities、headless-agent-jobs、desktop-agent-jobs、
local-job-api、architecture-ownership、codex-runtime-parity；含完整 living MODIFIED，删除 registry/selector 旧 owner 术语。runtime-capability-projection、provider-runtime-bindings 为回归约束。
未来实施文件与 owner 映射见 design D2；OWNERSHIP_MAP 新行/旧 owner 修订只列于 tasks。
风险：拟议实现 R2 跨层架构；factory/secret 边界须独立安全审查。本次起草 R0，零产品代码。

## Non-goals

不重做 run-event-ledger/host、run-submission/wait/pumpQueuedRuns、run-artifacts 或 provider
凭据规则。不交付第三 Runtime、版本 manifest/registry/download/activation、Codex Worker、
Claude Worker 或 exec→app-server 迁移。不做 renderer UI 重构、Interaction/Session/Handoff
（Phase 4/5/6）、HTTP/socket RuntimeHost。第三 Runtime 接入先经
`add-harness-runtime-conformance`，delivery 属 `add-managed-codex-runtime-delivery` 等后续案；
Windows artifact 后端、terminal/publication/native evidence 残余仍归 TICKET-127–131。

## Consumer Impact

按 `docs/consumer-impact-template.zh-CN.md` 完整十节填写。设计的 C1–C9 输入与源码出处见
design §1/D4。本稿的“保持”是待验证要求，不是已完成兼容证明。

### 1. Gate 状态

```text
Status: APPROVED 2026-10-02（统筹代行；绑定 a9b74594；Owner 可改/可撤回）
OpenSpec change: refactor-unified-runtime-route-catalog
Author / date: Codex / 2026-10-02
Decision owner: Repository Owner (mandate 2026-10-02) — recorded by coordinator Claude Fable 5.1, not Owner-signed
Implementation blocked until: 独立作者 RED suite 冻结先于产品实现；第 10 节统筹代行 APPROVED 已填，Q1–Q5 默认（OD-1–OD-5）已采纳，Owner 可改。
```

仅登记统筹代行 APPROVED；无 IMPLEMENTATION_VERIFIED、REVIEW_APPROVED 或 ACCEPTED 声明。

### 2. 一句话变化

```text
Current: 相同 runtime 的执行、metadata 和 renderer transport 由多个选择点分别决定。
Proposed: 内部查同一目录；旧请求的运行与错误语义保持；discovery 可选显示可用路线摘要。
Why: main 路由通过目录、adapter 与自有 router/transport 静态注册；renderer 只读投影，完整第三 Runtime/approval 中性化留 Phase 4/conformance。
```

### 3. 受影响公共边界

| Contract / version | Surface | 当前 → proposed | Breaking? / 分类 | 证据 |
| --- | --- | --- | --- | --- |
| `locus.local-job.v1` | runs create/submit/wait/retry/status/events/result/cancel | 相同请求/字段/命令/等待/幂等语义，内部 adapter 查目录 | 拟不变；需完整 golden，不以 parse 成功作证明 | `src/shared/local-job-api.ts:16`; `openspec/specs/local-job-api/spec.md:528`, `:561` |
| same | runtimes list --json / --no-probe | manifest/readiness/features 保持；可选追加 runtimes[].routes | C7 #2/#10 additive **Yellow，非 Red**，Q1 受约束默认；旧 schema 和忽略字段 reader 必须通过 | schema `:1001`, `:1318`; local-job-api.ts `:481`；C7 §9.2 前置：已发布 `docs/local-job-api-v1-consumer-guide.md:1729` unknown-field 规则 |
| same | error/exit/diagnostic | 保留 parser、provider、selector、claim-time、wait 各自映射 | 不变；目录新内部 reason 不直接外泄成 public code | design D4 源码表 |
| same | events/native metadata/artifact refs | 12 types、六字段、dense sequence、cursor、runtime.codex.v1、run-dir refs 原样 | 不变；目录不是 event/artifact producer | local-job-api.ts `:455`, `:755`; shared/local-job-api.ts `:26` |
| `locus-jobs-stdio.v1` | initialize/job.run/job.cancel/shutdown | 原 JSON-RPC 信封和 session-scoped submit/pump，间接查目录 | 不变；不增加 completion/profile 方法能力 | jobs-stdio.ts `:247`, `:268`, `:293`, `:407` |
| Desktop private IPC（C7 internal，另受 L4） | claude.chat/codex.chat、agentJobs、listManifests | chat wire 和 cancel closure 不变；chat/createSubChat 绑定读模型增加 transportId，无 listRoutes | chat request/stream/cancel envelope 无改动，绑定读模型内部追加；Q2 默认 binding read model；chat 请求不接收 descriptor | codex.ts `:779`; claude.ts `:407`; agent-runtime.ts `:5` |
| independently versioned app↔Runtime | native SDK/app-server/exec | 无新增协议/version/binary/activation | 无变化 | C8 `:1071`, `:1112`, `:1160` |

初始化 `catalog_invalid` 是构建缺陷，在通过 S01 production-table CI 的构建中不可达；
若发生，discovery 经既有 main catch exit 1 且无 stdout（design D4），分类为
**Green/build-defect，不是合同变化**。probe failure 仍遵循原 advisory discovery exit 0，不能混同。

上表短源码路径由 design 路由点清单给出完整路径。C7 §9.2 的 **十条** 分类如下：

| # | C7 类别 | 分类与具体差异 / Red 停止条件 |
| --- | --- | --- |
| 1 | 删除/重命名字段、command、event、status、error、capability | **Green — public 无变化**；仅 internal helper/module 原子删除。公开删改即 Red，Owner decision needed。 |
| 2 | type/requiredness/nullable/enum/default/validation | **Yellow — #2 additive optional discovery**；routes experimental，可缺省；四个新描述串开放，routeId 非稳定非身份，不改既有 enum/default/validation。已按 OD-2 预设批准；S22 通过后关闭 Yellow；新 feature、runtime ID、profile enum、required 字段即 **Red，Owner decision needed**。 |
| 3 | identity | **Green — 不变**；Run/jobId、retry lineage、native identities、workerId opaque 语义均不变；routeId 是描述性 key，不是 Run/Binding identity。 |
| 4 | lifecycle | **Green — 不变**；submit ack、create wait、cancel/claim/admission 时点、terminal/replay 保持；目录不写状态。改变 ack/claim 次序即 Red。 |
| 5 | ordering/cursor/idempotency/retry/terminal | **Green — 不变**；所有操作仍经 ledger/host、submission/pump；不修补 TICKET-128/129 的 terminal/publication 语义。 |
| 6 | Runtime/provider/model/policy 默认与 unsupported/degraded | **Green — 不变但高风险回归点**；batch 仍 exec/claude -p，Codex policy-grant 仍 admission-audit，desktop 仍原 adapter；advisory readiness 不阻断 admission。换默认或升级 enforcement 即 **Red，Owner decision needed**。 |
| 7 | auth/secret/filesystem/network/workspace/trust | **Green — 不变**；只读 projection 排除 secret/factory/env/path，provider/env、scope/root 校验仍原 owner；descriptor 不授予执行权。新 credential/probe I/O/动态加载即 Red。 |
| 8 | artifact/ref/path/digest/retention/access | **Green — 不变**；既有 Windows fail-closed、registered refs 和 wait readiness 保留；route 可用不代表 artifact 可用。改变 artifact 后端/访问即 Red。 |
| 9 | transport/Host/discovery/start/platform | **Green — discovery optional 追加**；transport 字符串仅描述，chat/stdio/CLI 实际传输与 startup 不改，平台承诺不提升。新 Host/transport/后台启动或 UI wire 迁移即 Red。 |
| 10 | 必须理解的新 event/enum/extension/unknown 处理 | **Yellow — #10 additive unknown-field vocabulary**；现有 optional runtime.codex.v1 原样；routes 可忽略、开放值旧 reader 安全，消费者不得按 adapterSource/transport 分支；约束已写入 D3/S22，已按 OD-2 预设批准；S22 通过后关闭 Yellow，非 Red。添加 closed feature enum/requiredExtensions 请求字段即 **Red，Owner decision needed**，不能沿用姊妹 change 的 direct 授权。 |

本稿未提议 public breaking；Q1 的 optional 追加已按 OD-2 预设批准，Q2 已选内部绑定读模型
字段，不新增 procedure。实现若发现已有调用的 error/exit/default 不能保持，则登记 **Red** 后返回 Owner，
不能把上述 Green 分类当作结果已经成立，也不能自动沿用 archived Consumer Impact 决定。

### 4. Current 与 proposed 示例

同一 agent 请求，current/proposed 都使用这个输入，不增加 routeId/factory/transport 选择字段：

```json
{"apiVersion":"locus.local-job.v1","consumer":{"id":"fixture-a"},"project":{"cwd":"/workspace/demo"},"runtime":{"id":"codex"},"mode":"plan","prompt":{"text":"Return OK"}}
```

Current 与 proposed 的 create/submit/event/error 外形相同（以下均为节选，完整测试不删字段）：

```json
{"apiVersion":"locus.local-job.v1","job":{"id":"job-A","status":"succeeded"},"result":{"apiVersion":"locus.local-job.v1","jobId":"job-A","status":"succeeded","result":{"finalMessage":"OK"}}}
{"apiVersion":"locus.local-job.v1","job":{"id":"job-A","status":"queued"}}
{"apiVersion":"locus.local-job.v1","jobId":"job-A","sequence":1,"type":"job_created","createdAt":"2026-10-02T00:00:00.000Z","payload":{"source":"api","runtime":"codex","mode":"plan","cwd":"/workspace/demo"}}
{"apiVersion":"locus.local-job.v1","error":{"code":"idempotency_conflict","message":"The idempotency key is already bound to a different request."}}
```

前三行分别是 create 终态、submit ack、events JSONL 单行；不是一次 command 输出四行。
同样，wait timeout 仍 9，幂等冲突仍 2。改变 stderr/stdout 所属通道同样算行为变化。

Discovery current（节选）：

```json
{"apiVersion":"locus.local-job.v1","features":["runtime-readiness","provider-binding","completion","canonical-run-ledger","async-submit"],"runtimes":[{"runtimeId":"codex","readiness":{"state":"unknown"}}]}
```

Discovery proposed（节选，保留全部原字段，展示 agent 与 completion 摘要）：

```json
{"apiVersion":"locus.local-job.v1","features":["runtime-readiness","provider-binding","completion","canonical-run-ledger","async-submit"],"runtimes":[{"runtimeId":"codex","readiness":{"state":"unknown"},"routes":[{"routeId":"codex.api.agent.batch","surface":"api","kind":"agent","executionProfile":"batch","adapterSource":"codex-batch","transport":"process-stdio","extensions":[]},{"routeId":"codex.api.completion","surface":"api","kind":"completion","executionProfile":null,"adapterSource":"locus-completion","transport":"provider-http","extensions":[]}]}]}
```

C7 §9.2 additive 前置来自已发布 `docs/local-job-api-v1-consumer-guide.md:1729`：
“Use the documented v1 fields and ignore unknown JSON fields”。
routes block 为 **experimental**；items 为 additionalProperties:false，固定 schema 副本须刷新
（同 guide :232–238 discoveryFeature caveat）；任何 experimental block key-set 变化须重新做
C7 #2/#10 分类。kind 复用 closed jobKind；agent executionProfile 复用 closed executionProfile，
completion executionProfile=null。routeId/surface/adapterSource/transport 是开放描述串，
routeId 非身份且不保证跨版本稳定。消费者不得按 adapterSource/transport 分支；公开仅
api summary，省略 protocol。batch/completion extensions=[]，仅真实 app-server producer
支持的 policy-grant route 声明 runtime.codex.v1，S13/S22 交叉核对。
没有 public route execution endpoint。`routes` 缺失表示旧构建没有该描述，**不表示现有
async-submit/completion 等 feature 不支持**；consumer 继续按既有 features/request contract
调用。扩展声明不保证每个事件携带该扩展；仍依赖既有执行 provenance 与 native IDs。
摘要只描述，不能覆盖 capability/readiness、授权 native extension 或强迫选择新 adapter。
纯 schema diff 看不出的问题由 S21/S24 的旧请求完整 golden、S05 的 enforcement refusal、
S16 的 claim race 和 S20 的 exact-owner cancel 测试约束。

### 5. 已知 consumer 与所需修改

| Consumer | 使用证据 | 受影响调用 | 必须修改什么 | Consumer-owned test/E2E |
| --- | --- | --- | --- | --- |
| Career Kit | `docs/ideas/locus-product-direction-harness-strategy.zh-CN.md:89` 的 pinned adapter/contract/historical smoke references | v1 create/status/result，structured proposal | 按推荐方案无强制修改，optional routes 可忽略；仍由自身 review/apply gate 写业务数据 | 本切片未运行，unknown；不把历史 smoke 当本 SHA receipt |
| Amadeus | 同文 `:108` 的 Owner 提供事实及 pinned README relationship | 已接 Local Job API，具体部署调用面 unknown | 无强制修改；若选择读取路线摘要由 consumer 自行更新 adapter | unknown；是事实上的 integrating consumer，不据此重排 roadmap |
| Locus Desktop/Workbench | design P11–P17/P22 | private chat/discovery/cancel/logs | 两个 transport 构造点改为 binding.transportId 消费；wire 与 UI lifecycle 保持 | Locus-owned S18–S20/S53 |
| 其他 v1 / jobs-stdio client | 已发布 schema/CLI，实际消费者集合 unknown | runtimes list、run/observe/cancel | 忽略可选摘要即可；不解析 adapter-specific raw events | neutral fixtures 为 producer gate，真实 E2E unknown |

不读取外部 consumer 私有库，不建立 consumer-specific core、依赖矩阵或额外批准 veto。

### 6. 选择方案与成本

| Option | Locus 变化 | Consumer 变化 | 维护成本 / 风险 | 删除条件 |
| --- | --- | --- | --- | --- |
| **推荐：既有公共合同不变 + optional discovery** | 内部原子目录迁移，可选摘要/schema/docs | 无强制更新，开放描述值可忽略 | 一套 core；需要旧 schema/reader 与完整行为回归 | 旧 internal 选择器同 change 删除；无 facade |
| Optional summary without adapterSource/transport | 同步缩小 schema/exact keys | 无强制更新 | 暴露更少实现描述，route 可发现性较弱 | Q1 备选，无第二 core |
| Direct new standard | 若欲改 default/error/feature，需另列准确 public break | 可能同步升级 | 实现简单但违背当前 L4 未授权范围 | 必须重新批准 Consumer Impact；本稿不实施 |
| New public version | 新 serializer/schema 仍调同一 core | 分期升级 | 本次无收益，增加双版本 conformance | 明确旧版 sunset，另案批准 |
| Temporary old-contract facade | 只许薄 envelope 翻译 | 暂不改 | 当前没有需翻译的合同；易滞留 | Owner 另定日期/条件，禁止旧 core/worker |
| Defer optional discovery | 只改内部，只读 internal discovery 仍存在 | 无修改 | 公共最小变更；外部暂不能查路线摘要 | Q1 若选此项，批准前删除 optional public delta |

### 7. Compatibility facade 边界

推荐方案 **N/A — 不新增 compatibility facade**，以下项目逐项明确而非留空：

```text
Canonical owner: NEW runtime-route-catalog.ts (routing only); existing submit/pump/ledger/artifact owners.
Old contract/version: locus.local-job.v1 / locus-jobs-stdio.v1 / existing private chat IPC.
New canonical contract/core: internal route catalog; same public versions and lifecycle owners.
Allowed translation: existing serializers/request encoders; optional safe discovery summaries only.
Explicitly forbidden business logic/state: second runtime table, queue, worker, claim, retry/cancel, ledger, provider policy or artifact lifecycle.
Migration flag or gate: no dual path; source atomic cutover + deletion guard + parity evidence.
Deprecation owner/comment: N/A; no temporary facade. Old internal exports removed, not deprecated aliases.
Deletion date or objective removal condition: same implementing change before acceptance.
Architecture guard / contract tests: S26–S30 plus public/stdio/desktop compatibility S18–S25.
```

### 8. 发布、失败恢复与回滚

```text
Required release order: exact draft APPROVED → independent RED tests → implementation/delete → same-SHA verification + fresh Claude review/security review → authorized acceptance/integration.
Can old consumer call new Locus? Yes under the proposed unchanged contract; optional routes safely ignored, proven by fixtures before delivery.
Can new consumer call old Locus? Existing operations yes; absent routes yields no route-summary UI, never silent execution downgrade.
Unsupported-version error: preserve existing apiVersion validation and stderr/exit 2 (shared/local-job-api.ts parser; async-submit living scenarios).
Downgrade behavior: no automatic runtime/provider/profile/required-extension fallback; delete the test-only preferredAdapterSource option; public fallbackReason stays null and interactive requests retain refusal.
Rollback target: complete catalog implementation group to its recorded pre-implementation base, not one retired selector. This draft base is 6192b13f; implementation must record its actual base.
External data/artifact impact: none; no schema/reset/delete. Stop active execution and restart on complete old build before code rollback.
Security impact: static factory allowlist and redacted metadata only; same credential/root/policy owners. New trust/I/O boundary would be Red.
```

无新旧 public version 组合要拒绝；未知 version 继续按原合同拒绝。本稿不授权 release、merge、push、
PR mutation 或外部通知。现有 TICKET-127–131 残余不能通过代码回滚声明已修复。

### 9. 验证证据

以下为实施验收，全部未执行；[verification](verification.md) 登记 S01–S53，不以起草校验代替：

- [ ] Optional discovery machine-readable schema/types、指南与示例同 change 更新；原 schema snapshot 仍接受追加字段。
- [ ] Common-core、既有请求完整 stdout/stderr/exit、默认 adapter、policy/provider、async lifecycle conformance。
- [ ] Facade tests：N/A（无新 facade）；现有 v1 serializers 的行为保真必须验证。
- [ ] Unknown route、invalid catalog、required extension/capability fail-closed；无自动 fallback。
- [ ] Neutral fixtures 不依赖真实凭据/binaries；独立作者基线 RED/保真项 baseline receipt 绑定 SHA。
- [ ] 目录单 owner、旧符号删除、alias/wrapper/import 正负例守卫。
- [ ] `bun run check:full` 与 fresh-context Claude Code review 绑定同一准确 source SHA。
- [ ] Desktop/CLI/stdio/daemon smoke；macOS/Windows packaged receipts 各自列明，host-blocked 不记通过。
- [ ] Consumer adapter/E2E unknown 的状态和残余逐项记录。

### 10. Owner 决定

```text
Decision: APPROVED 2026-10-02 (coordinator-acted under the Owner's 2026-10-02 self-iteration mandate; Owner may revoke/amend) — unchanged public contracts + constrained experimental optional discovery; C7 #2/#10 additive Yellow; no public Red
Approved exact scope: a9b74594; proposal/design/tasks + 六份主体 delta（agent-runtime-core、agent-runtime-capabilities、headless-agent-jobs、desktop-agent-jobs、local-job-api、architecture-ownership）及 codex-runtime-parity 的 living MODIFIED delta（合计七份）；S01–S53；design Q1–Q5 defaults (OD-1–OD-5) 已采纳，Owner 可改。
Compatibility obligation: existing v1/async-submit/stdio/desktop chat semantics; only optional discovery summary.
Sunset/deletion condition: no public sunset; internal old routing removed in the same implementation change.
Consumer coordination required: no mandatory consumer upgrade under adopted OD-2; any observed break returns to Owner.
Owner: Repository Owner (mandate 2026-10-02) — recorded by coordinator Claude Fable 5.1, not Owner-signed
Date: 2026-10-02
```

统筹登记（非 Owner 签署；统筹记录，Owner 可撤回）：Owner 2026-10-02 自我迭代指示覆盖统筹代行 ACCEPTED（条件见 tasks 8.7）；本行仅声明 OD-5 的已采纳条件，不构成当前 ACCEPTED；APPROVED 见上方 Decision；Owner 可改为亲自验收；push 依 2026-09-04 规矩由统筹派 Codex。

模板的 DIRECT_NEW_STANDARD / NEW_VERSION / TEMPORARY_FACADE / DEFER / REJECT 为可能的
breaking disposition；已选 disposition = 保持现有合同 + optional 追加；无 breaking disposition。
Owner 可撤回或修改预设；改为内部 scope 须同步删除 optional delta 并重新校验批准。本批准不得复用为以后 runtime/feature 的 breaking 授权。
