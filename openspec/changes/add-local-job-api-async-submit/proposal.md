# Change: Add Local Job API Async Submit

Status: **DRAFT — awaiting Owner APPROVED**

## Why

Phase 3 需要立即可引用的 Run identity 和重试安全的提交入口。当前 `runs create/retry`
在调用 CLI 进程里运行到终态才返回；异步消费者无法先获得 ID 再观察/取消，同一请求重发也会重复执行。
本提案将 public batch surface 收敛到同一 async submit core，保留同步 create 为 submit+wait wrapper。
基线 `2c59664f1b80a5f782eb05f82d33f718d9bc7053`；逐项 `file:line` 输入依据见 [design](design.md#context-and-source-basis)。

## What Changes

- 新增 `runs submit`、有限时 `runs wait`，retry 增加 opt-in async，agent/completion 同核。
- create/submit/retry 及 jobs-stdio 的 job.run 共用提交 owner，daemon/既有 session executor 经原 claim 执行；删除 API CLI 内联 runner 路径。
- consumer-scoped optional idempotencyKey，规范化请求重放/冲突，job+key 原子占用与补偿释放。
- creation fact 提交才 ack；wait 同时验证 completed commit 与完整文件 publish；不创造 Run/queue/terminal 状态机。
- 状态查询增加 optional executor 可观测信息，保持 existing runtime readiness 的认证含义。
- **Potential BREAKING — Red R1, Owner decision needed**：旧 create/retry 自带执行；移交队列后的执行者启动/异常完成策略尚未证明兼容。保留 L2，不自行引入 daemon 前提或 timeout 退出；若 Owner 选择改变，须批准并修订规格。
- **BREAKING — proposed Red R2, Owner decision needed**：`async-submit` 扩展 discovery 的封闭 feature enum，固定旧 schema 的校验器需要更新。
- wire `apiVersion` 推荐继续 `locus.local-job.v1`；是否采用 `locus.local-job.v1.1` 请求门控仍由 Owner 选择。

## Non-goals

Interaction/cursor reconnect → `add-durable-agent-interactions`；Session/continue/resume →
`add-durable-session-bindings`，FROZEN 1.1 continuationHandle 留给 Phase 5；HTTP/socket 服务、远程、
多租户、优先级队列、SDK 生成、Runtime 交付均排除。TICKET-128 全量创建原子化与可恢复发布、
TICKET-127 Windows run-dir 后端不借本提案实施；本切片的最小 ack/claim/read barrier 与未修复残差
在 design D3/D5 和 Q4 明列。不改变 Desktop chat、人用 one-shot CLI 或 provider/profile 默认。

## Impact and four delivery anchors

- **Canonical owner**：拟 `headless/run-submission.ts` 编排 submit/wait；现有 job-store、ledger/host、daemon、runners、run-artifacts 分别保留存储、事实、认领、执行、文件 ownership。
- **旧路径删除**：`cli-dispatcher.ts#runPreparedLocalJobApiJob` 与 API create/retry runner 直调、stdio 独立 create/run 编排、重复 job row construction 同 change 替换；无兼容旧 worker。
- **Migration gate**：additive idempotency reservation migration + 旧 writer 停止 + claim/admission 一致 + 单一路径守卫 + schema/conformance 同步，完成后才广告 feature。
- **验证消费者**：Locus-owned neutral batch/structured-output、CLI/daemon/stdio、store/Workbench；真实消费者 receipt 分列 unknown。

Affected deltas：local-job-api、headless-agent-jobs、agent-runtime-core、architecture-ownership。
Desktop living spec 作为回归约束，无行为变更因此无 delta。实施影响 owner map、shared types、
CLI parser/dispatcher、store/schema/migration、daemon/stdio、artifact read composition、schema/中英文指南及
tests/architecture guards；**本次起草只写本 change 文档与 STATUS 一行，不改这些实施文件**。

## Consumer Impact

按 `docs/consumer-impact-template.zh-CN.md` 十节完整填写，以下选择均未获 Owner 批准。

### 1. Gate 状态

```text
Status: DRAFT / OWNER_DECISION_REQUIRED
OpenSpec change: add-local-job-api-async-submit
Author / date: Codex / 2026-10-01
Decision owner: Repository Owner
Implementation blocked until: Owner APPROVED 精确提案版本 + 第 10 节 C7 决定 + 独立 red fixtures
```

### 2. 一句话变化

```text
Current: create/retry 在 CLI 内执行到终态后返回，无幂等提交入口。
Proposed: submit 持久化后立即给 ID；wait 单独有界等待；create/retry 折叠同一 core；新 key 可安全重放。
Why: 公共 batch 与异步消费共用可观察、可取消、可去重的同一 Run attempt。
```

### 3. 受影响公共边界

| Contract / version | Surface | 当前 → proposed | Breaking? / 分类 | 证据 |
| --- | --- | --- | --- | --- |
| locus.local-job.v1 | submit/wait、retry --async | 无 → 新操作、新 timeout envelope/exit 9 | 新操作 additive；旧 0–8 数值含义不变，需 Q6 | design D2；consumer-guide:91,982 |
| same | create/retry | inline terminal → submit+wait terminal；executor absent 分支尚待决策 | **Red R1 decision needed**，正常终态 bytes 不足以证明启动语义兼容 | cli-dispatcher:451,499,865；guide:113 |
| same | optional idempotencyKey/replay、冲突错误 | 无 key：原行为；有 key：同 consumer 重放或 idempotency_conflict/exit 2 | opt-in additive，规范化/保留期是新增合同，Q5 | shared/local-job-api:175,204；design D4 |
| same | status optional execution | 只有 job → job + advisory executor observation | additive unknown optional field，非 auth readiness 替代 | guide:1134；design D5 |
| same | runtimes list features/schema | closed enum 增加 async-submit | **Red R2** 对 pinned old schema | schema:106,1307；guide:209 |
| same | events/after/follow、result/artifacts | 六字段、12 types、原顺序/路径/digest/retention 保持；新 wait 检查 publish | non-breaking；不改变旧 follow 为文件 barrier | living local-job-api:52,99；design D5 |
| locus-jobs-stdio.v1 | initialize/job.run/job.cancel/shutdown | 协议不变，提交与执行编排迁至同 core/pump | 内部原子替换；protocol 不依赖外部 daemon | jobs-stdio:247,268,322,381 |
| wire version alternative | apiVersion | 目前只接受 locus.local-job.v1；若采用 v1.1 必须显式门控 | **Owner decision needed Q1**，本稿不自行接受/升级版本 | shared/local-job-api:813 |

上表简写文件的完整路径与准确行见 design source basis。以下按 **C7 §9.2 十条逐条**分类，覆盖以上每处变化：

| # | C7 类别 | 本稿分类与影响 |
| --- | --- | --- |
| 1 | 删除/重命名 | non-breaking：无 public 删除/更名；删除的是 internal inline worker/创建 helper。 |
| 2 | type/requiredness/nullable/enum/default/validation | 旧请求零变化；新 optional key、retry body/async、timeout 只 opt-in。**Red R2** 涉及 feature enum 扩展；Q1 若改 apiVersion literal 另为 Red，不暗改。 |
| 3 | identity | non-breaking：job.id 就是同一 Run，retry 新 ID/原链不改；key replay 返回既有 attempt 是新 opt-in 行为，不把 retry 变成 resume。 |
| 4 | lifecycle | **Red R1 decision needed**：CLI 自执行移交队列；create/retry 保留等待终态，无执行者/异常 publish 的可完成性需 Q2，不能默认改变旧行为。submit immediate 与独立 wait 是新增操作；cancel 原语义保留。 |
| 5 | ordering/cursor/idempotency/retry/terminal | 新 key/replay/conflict/30 天规则 additive；不改无 key retry、12-type dense order、after/follow 或 terminal truth。wait 新增 commit+publish predicate，超时不改 outcome；wrapper 若改变异常分支归 **R1**，本稿未选择此例外。 |
| 6 | Runtime/provider/model/policy | non-breaking：默认 batch、provider/reference、capability/profile gate 与 completion 选择不变；queue consumer 不自行换 adapter。 |
| 7 | auth/trust/secret/FS/network | non-breaking：本地 attribution 隔离、hash-only key，无新 secret/FS/network 授权；不声称 consumer.id 是强认证。 |
| 8 | artifact path/ref/digest/retention | non-breaking：现有路径/角色/retention 保留，native refs 仍由账本登记；wait 检查已有文件。key 的 TTL 不是 artifact TTL。TICKET-128 未来公开可见修复另过 C7。 |
| 9 | transport/Host discovery/start/platform | **Red R1** 若新增显式 executor 前提或改变启动方式；optional execution 字段 additive；stdio session/关闭范围不变，不增加 HTTP/socket 或新平台承诺。 |
| 10 | 必须理解的新 event/enum/extension | 无新 event/native extension；旧消费者可忽略新 optional fields，但 closed feature enum 的 **Red R2** 不能忽略。新消费者先查 feature，不支持不 dispatch。 |

C7 §9.1：reservation table、私有 pump、submit/wait seams 属 internal；CLI/stdio/schema/退出码/feature
属 public 或独立版本；Runtime-native 信息不变、不公开 raw union。没有把任一 Red 隐藏在“JSON 可解析”下。

### 4. Current 与 proposed 示例

同一旧 create 输入（fixture cwd 是已注册的临时目录，示例用 `/workspace/demo`）：

```json
{"apiVersion":"locus.local-job.v1","consumer":{"id":"fixture-a"},"project":{"cwd":"/workspace/demo"},"runtime":{"id":"codex"},"mode":"plan","prompt":{"text":"Return OK"}}
```

Current create 的外形（job/result 节选；完整字段 oracle 取基线 serializer，不能用节选代替测试）：

```json
{"apiVersion":"locus.local-job.v1","job":{"id":"job-A","status":"succeeded"},"result":{"apiVersion":"locus.local-job.v1","jobId":"job-A","status":"succeeded","result":{"finalMessage":"OK"}}}
```

Proposed：同一输入改调用 submit；可选加 `"idempotencyKey":"req-001"`。

```json
{"apiVersion":"locus.local-job.v1","job":{"id":"job-A","status":"queued"}}
```

匹配 replay（已有 job 可能是 running/terminal，不保证 queued）：

```json
{"apiVersion":"locus.local-job.v1","job":{"id":"job-A","status":"running"},"idempotentReplay":true}
```

冲突/超时与新增 status 字段（同样省略既有 job 成员）：

```json
{"apiVersion":"locus.local-job.v1","error":{"code":"idempotency_conflict","message":"Idempotency key is already bound to a different request."}}
{"apiVersion":"locus.local-job.v1","job":{"id":"job-A","status":"queued"},"wait":{"state":"timeout","timeoutMs":30000,"reason":"executor_unavailable"}}
{"apiVersion":"locus.local-job.v1","job":{"id":"job-A","status":"queued"},"execution":{"state":"unavailable","reason":"no_executor","observedAt":"2026-10-01T00:00:00.000Z","hint":"locus daemon run"}}
```

wait ready 和旧请求 create 保留 Current 的**完整**终态 envelope；keyed create replay 只 opt-in 增加标志。
以下事件在 current/proposed 完全相同，不新增 async event：

```json
{"apiVersion":"locus.local-job.v1","jobId":"job-A","sequence":1,"type":"job_created","createdAt":"2026-10-01T00:00:00.000Z","payload":{"source":"api","runtime":"codex","mode":"plan","cwd":"/workspace/demo"}}
```

纯 schema diff 无法表达：ack 已持久化但未必执行；queued snapshot 可随即变 running；Run terminal 不等于
文件已 publish；wait timeout 不是 Run failure；executor 前提改变旧 create 的启动体验；相同 key 的
replay 不触发新 provider 工作。Q2 对异常 wrapper 的决定是 L2 完整兼容性缺口，不能以正常路径测试掩盖。

### 5. 已知 consumer 与所需修改

| Consumer | 使用证据 | 受影响调用 | 所需修改 | Consumer-owned test/E2E |
| --- | --- | --- | --- | --- |
| Career Kit | strategy:89 的 batch/structured-output、consumer.id=career-kit；其历史 adapter/contract 链接见 strategy:99 | create/result/provider/structured output；当前具体版本 unknown | 采用 async/key 时先 feature detect；若 Q2 明确批准显式 daemon 例外需准备 executor；固定 schema 需刷新。领域 review/apply 不变。 | 本切片 unknown；历史 smoke 不能冒充本次验收 |
| Amadeus | strategy:108 的已接入事实；本次 Owner 派单明确 Windows 接入方 | 当前具体 v1 命令/版本及 key 需求 unknown | 按其实际使用评估新操作、R1/R2；Windows artifacts 现有限制见 TICKET-127 | unknown；只列事实，不协商、不重排路线、不代其写 adapter |
| Other | unknown | unknown | 发布 consumer-neutral guide/schema/fixtures | unknown |

Locus 自己负责 neutral contract conformance；不建立跨应用业务矩阵，不把消费者内部 E2E 当默认 release gate。

### 6. 选择方案与成本

| Option | Locus 变化 | Consumer 变化 | 维护成本 | 风险 | 删除条件 |
| --- | --- | --- | --- | --- | --- |
| Direct new standard（推荐 R2；R1 仅备选，待 Owner） | 同 v1 扩 feature enum；若选 R1 则明改 daemon 前提 | 更新 pinned schema；若选 R1 则准备 executor；新操作 opt-in | 低，单 core | 老调用启动/固定 schema 受影响 | 无旧 core；无临时 facade |
| New public version | 新 version parser/serializer → 同一 core | 显式版本选择，旧版保留范围另定 | 中，多版本 fixtures | 版本号本身不能恢复旧自执行行为 | Owner 定旧版 sunset 后删翻译 |
| Temporary facade | 旧 envelope 翻译 → 同一 submit+wait | 暂留旧字段；若要旧启动体验需批准同 daemon 的启动编排 | 中 | facade 不能伪造完成/另建 worker；无法单靠翻译消除 R1 | Owner 定具体 sunset/移除条件 |
| Defer / reject | 暂不实施受影响 public change | 无 | 延期 | async 与去重需求未交付 | 新决定后重提 |

R1 优先保留 L2、复用既有 daemon 的启动编排；其可行性须 Q2 前置决定，不能以新增 worker 兼容。
正常 create 的长期 convenience wrapper 是 C7 §9.6 的同核操作，不是保留旧实现。
不把 old core/DB/queue/worker/state machine 列为任何选项。

### 7. Compatibility facade 边界

Owner 尚未选择 TEMPORARY_FACADE；当前推荐不新建临时 facade，以下为选择它时的限制：

```text
Canonical owner: run-submission.ts + existing ledger/store/executor/artifact owners
Old contract/version: locus.local-job.v1 的 create/retry 外形
New canonical contract/core: 同一 submitRun + waitForRun
Allowed translation: parse/validate、旧字段/default 映射、同核调用、serialize
Explicitly forbidden: 独立状态/DB/queue/worker/retry/cancel/policy/artifact；把未发布终态伪装成功
Migration gate: Owner 精确版本组合决定 + schema/conformance + single-owner guard
Deprecation owner/comment: Change implementer 在 facade 注释引用本 change 和 Owner sunset 决定
Deletion date or condition: 当前 N/A（无临时 facade）；若选择必须先填客观 sunset，未填不可实施
Architecture guard / contract tests: S32/S33 及旧请求 byte fixtures；不存在 inline execution fallback
```

### 8. 发布、失败恢复与回滚

```text
Release order: Owner C7 + APPROVED → 独立 red tests → additive migration/原子删除旧路径 →
  schema/双语指南/examples/feature 一致 → 同 SHA 验证与 fresh review → Owner ACCEPTED。
Old consumer → new Locus: 正常终态 bytes 保留；R1 的启动兼容尚未证明，R2 pinned schema 需更新，不能宣称全兼容。
New consumer → old Locus: async-submit feature 缺失即拒绝依赖能力；不得发送 key 后假设被执行。
Unsupported version: 当前 exact-version 校验错误 apiVersion must be locus.local-job.v1，exit 2；
  没有现成独立 unsupported-version JSON code，不能虚构；若 Q1 变更须同改合同。
Downgrade: 不静默降到无幂等 create；只可由 consumer 显式选用原有无-key 语义。
Rollback: 停 writer/drain 后旧构建用隔离 profile，或另行验证的 backup restore；不混用 old/new writer。
External data/artifact: 不动消费者数据库、不删项目或 run files；TICKET-128 残差诚实报告。
Security: 无新 credential/FS/network scope；key hash-only；status 不暴露宿主身份秘密。
```

普通 append 失败原子补偿 key/job；崩溃 orphan 不 ack、不执行、保留 reservation 并报 submission_pending；
partial publish 的 wait 超时不改变 ledger outcome，修复仍由 TICKET-128 统一 owner 完成。

### 9. 验证证据（待实施，不勾选）

- [ ] machine-readable schema、shared public types、feature、指南/示例/error semantics 一致。
- [ ] core、v1 零变化、create byte equality、new submit/wait/idempotency conformance。
- [ ] unsupported version/missing-feature preflight、closed-enum 旧 schema 失败证据与升级样例。
- [ ] reservation 竞争/回滚/补偿、publisher fault/restart、queue cancel/start 与 stale lock 负例。
- [ ] single-core 静态守卫及 negative fixture，无旧 inline runner/重复创建。
- [ ] stdio transport、daemon/API agent+completion、Workbench 回归及 macOS/Windows packaged smoke。
- [ ] consumer adapter/E2E receipt 或 unknown；独立 fresh review 绑定同一 source SHA。

登记表及未来证据项见 [verification.md](verification.md)；本次文档 strict 校验不构成产品测试通过。

### 10. Owner 决定

```text
Decision: PENDING — Owner decision needed（非 APPROVED）
Approved exact scope: none；待 Q1–Q6 与 R1/R2 的精确决定
Compatibility obligation: 待决定；推荐正常 v1 终态 bytes + 明示 R1/R2 升级影响
Sunset/deletion condition: N/A 推荐无临时 facade；若选择版本/facade 则需填写
Consumer coordination required: 发布中立材料；Amadeus 只列事实，无专属协商/排序
Owner: Repository Owner — signature pending
Date: pending
```

Open questions 的唯一文本在 [design.md 的 Open questions](design.md)。
本稿保持 DRAFT；不合并、不 push，不将方向 ratification 或姊妹批准当作本切片 APPROVED。
