# Design: Local Job API async submit

Status: **DRAFT — awaiting Owner APPROVED**

## Context and source basis

本稿是 Phase 3 第二份提案，不是实施授权或已发布合同。只读基线为
`2c59664f1b80a5f782eb05f82d33f718d9bc7053`；以下 `file:line` 均相对该 SHA 的仓库根目录。
`openspec/STATUS.md:9` 在起草前没有 active change；姊妹账本切片已经归档。

| 输入 / 证据 | 本稿采用的约束或事实 |
| --- | --- |
| `docs/ideas/locus-product-direction-harness-strategy.zh-CN.md:508`, `:521`, `:758` | Phase 3 的 async submit、immediate id、idempotency、artifact refs；create 必须是同一 async submit + wait；批次 3 分拆及四项交付要求。 |
| `docs/ideas/locus-interoperability-contract-v1.zh-CN.md:150`, `:190`, `:209` | C2：Run 是 attempt，Job 是 v1 投影；retry 新 identity，旧 attempt 不改写。 |
| 同文件 `:690`, `:702`, `:740`, `:758`, `:780`, `:796`, `:824`, `:873`, `:910`, `:921` | C7 全部：internal/public/native 分类，十条 breaking，Consumer Impact，Owner 选项，facade 禁区，同一 async core，small core/versioned extensions，准确版本与实际合同材料。 |
| `docs/ideas/locus-ai-collaboration-workflow.zh-CN.md:121`, `:150`, `:164`, `:173`；`docs/consumer-impact-template.zh-CN.md:17` | APPROVED、同 SHA 技术验证与 fresh review、Owner ACCEPTED 分开；proposal 填满十节 Consumer Impact。 |
| `docs/OWNERSHIP_MAP.md:319`, `:350`, `:386`, `:403` | adapter-selector 拥有 profile gate；ledger/host 拥有事件及 lifecycle；run-artifacts 写文件，local-job-api 定义 v1 文件和序列化；禁止第二事件写入器。 |
| `openspec/changes/archive/2026-10-01-refactor-canonical-run-event-ledger/proposal.md:24`, `:51` | 已落地单一账本；async/idempotency 留给本稿；不能复活已删除的 gate/bridge。 |
| 同目录 `design.md:235`, `:267`, `:420`, `:546` | exact append、queued cancel/start 条件竞争、terminal stage→commit→publish 与 owner 映射。该 design 的意图不等于全部实现保证。 |
| 同目录 `verification.md:250`, `:261`, `:1009`；`docs/tickets/TICKET-128-run-ledger-creation-atomicity-and-terminal-publish.md:11`, `:32` | **现状**仍是 job 行 / creation fact 分事务；普通失败补偿，崩溃留孤儿；publish 逐文件 rename，可能混合快照。不能声称已原子创建/发布。 |
| `openspec/specs/local-job-api/spec.md:10`, `:52`, `:99`, `:261`, `:292`, `:462` | 全部 17 个 Requirement 已审阅；保留 machine API、12 events/六字段、result/artifact、profile、completion 和 discovery 约束。 |
| `openspec/specs/headless-agent-jobs/spec.md:8`, `:137`, `:176`, `:207`；`openspec/specs/desktop-agent-jobs/spec.md:8`, `:48`, `:104` | durable queue、daemon/schedule、取消和事件复用；Desktop 作业可见性保留，不新增 Desktop chat executor。 |
| `openspec/specs/agent-runtime-core/spec.md:514`；`openspec/specs/architecture-ownership/spec.md:23`, `:365` | 账本提交先于 ack；host 是 appendExactRunEventBatch 唯一 importer；内部提取须同时删除旧业务路径。 |
| `src/main/lib/headless/cli-dispatcher.ts:451`, `:499`, `:768`, `:813`, `:844`, `:865` | create/retry 当前在 CLI 内调用 runner、准备 artifacts、输出 `{apiVersion,job,result}`、返回运行退出码；events --follow 按终态退出；cancel 已走 store。 |
| `src/main/lib/headless/local-job-api.ts:405`, `:655`, `:685`, `:734`, `:830`, `:1130`, `:1219` | public serializers、registered-ref 过滤、agent/completion 创建及 retry、初始 admission、终态 preparer；现有 result reader 不能证明整组文件已发布。 |
| `src/main/lib/headless/job-store.ts:248`, `:323`, `:364`, `:427`, `:464`, `:594` | create/retry 先 insert 后 host append；补偿只删无事件 queued 行；list 用事件 type、start 用 fact key，需统一；start 是 claim。 |
| `src/main/lib/headless/daemon.ts:88`, `:142`, `:154`, `:169`；`src/main/lib/headless/schedules.ts:313`, `:350`, `:408` | daemon 有 lock/nonce、并发和队列循环，但只捞 daemon/schedule 且只调用 agent runner；schedule 在自己的事务后记 creation fact。API/completion 接入是待实施工作。 |
| `src/main/lib/headless/jobs-stdio.ts:41`, `:54`, `:247`, `:268`, `:322`, `:348`, `:381` | `locus-jobs-stdio.v1`，initialize/job.run/job.cancel/shutdown；protocol session 当前自己启动 runner，拥有本 session 取消/关闭范围。 |
| `src/main/lib/agent-runtime/run-event-ledger-host.ts:45`, `:56`, `:173`, `:231` | 当前 host 只为已有 job 组合 ledger，不 mint ID；lifecycle 调 appendSystemEvent/settle，经 host→appendExact。 |
| `src/shared/local-job-api.ts:16`, `:18`, `:175`, `:204`, `:287`, `:333`, `:475`, `:800` | v1 硬门控、features、agent/completion union、consumer normalization、信封。**当前无独立 retry/cancel JSON request type**：二者是 CLI job-id 命令，不能虚构现成类型。 |
| `docs/local-job-api-v1.schema.json:106`, `:1285`, `:1297`, `:1478`；`docs/local-job-api-v1-consumer-guide.md:91`, `:209`, `:530`, `:953`, `:982`, `:1107` | 同步 create/retry、输出、0–8 退出码与 unknown-field 规则；discoveryFeature 是封闭 enum，增加值会使固定旧 schema 校验失败。 |
| `docs/tickets/TICKET-127-run-dir-artifacts-windows-stable-directory.md:11` | Windows run-dir 后端问题属于另一切片；本稿不以路径写入 fallback 绕过。Windows 消费者事实不构成该能力已可用的证明。 |

## Goals / Non-goals

Goals：一个持久提交核心、可立即取得的 job ID、有限时 wait、consumer 隔离幂等、可观察执行者、既有 v1 兼容证据。

Non-goals：durable Interaction/cursor reconnect → `add-durable-agent-interactions`；
Session/continue/resume → `add-durable-session-bindings`（FROZEN 1.1 continuationHandle 是 Phase 5 输入，
见 `openspec/STATUS.md:59`）；HTTP/socket 服务、远程、多租户、优先级队列、SDK 生成；
Runtime 交付 → 独立 managed runtime changes；Windows 文件系统后端 → TICKET-127；
TICKET-128 的全量原子 creation / 可恢复整组发布协议不在本稿冒充完成，见下文边界。
不改变 `locus run` one-shot、desktop chat 的执行形态或 runtime/provider/profile 默认选择。

## Decisions — 统筹预设 L1–L11（Owner 可改）

| ID | 预设裁定 |
| --- | --- |
| L1 | create/submit/retry 共用“校验→持久化 Run（host 提交 job_created）→立即返回 ID”的核心；daemon/既有应用内执行者通过 claim 执行；同步 create 是 submit+wait；jobs-stdio job.run 同核，删除内联执行；不新建 worker、queue 表、状态机。 |
| L2 | `runs submit` 返回 `{apiVersion,job}` queued admission；`runs wait <id> [--timeout]` 在 completed 提交且终态文件 publish 后返回 create 的 `{apiVersion,job,result}`；超时结构化返回并有专用退出码；现有 create 的终态信封和退出码逐字节保留。 |
| L3 | 可选 idempotencyKey，以 consumer.id+key 作用域；同规范化请求重放、不同请求冲突；key 与 job 同 SQLite 事务占用，creation 补偿删除同时释放；规定清理期，原 key 不进入日志/事件。 |
| L4 | ack 只保证持久化并可认领，不保证已开始；无执行者须结构化可查；wait 有明确默认超时和显式 timeout。 |
| L5 | 保持 locus.local-job.v1；新操作/字段 additive 并广告 async-submit；保留 12 events、六字段、create 响应、既有退出码、after/follow；v1.1 请求门控交 Owner；完整十节 C7，所有 Red 显式待决。 |
| L6 | queued cancel 沿既有 pre-start ledger settle canceled；retry 新 job 并支持 key；同步 wrapper 退出码语义保留。 |
| L7 | creation fact 提交后才 ack；wait 的观察点是 completed commit 且 publish 完成；只经 host 的 appendExactRunEventBatch 单一路径。 |
| L8 | key 不跨 consumer 重放；不扩大文件系统范围；执行者信息沿现有脱敏规则；无新凭据路径。 |
| L9 | Interaction、Session、reconnect、HTTP/socket、远程、多租户、优先级、SDK、Runtime 交付均不在本切片。 |
| L10 | 独立作者先按 spec 写 red bun tests；每个 Scenario 有入口、夹具、断言；覆盖派单列出的全部 conformance 场景。 |
| L11 | 明确 canonical owner、旧路径删除点、additive 存储迁移 gate、验证消费者；OWNERSHIP_MAP 新增项只列实施任务。 |

以下 D1–D7 是起草者的**建议**，不是新增统筹裁定；Owner 可改。Q1–Q6 尚未获得决定。

## D1. Single submit core and owner map

拟新增 `src/main/lib/headless/run-submission.ts` 为**提交编排唯一 owner**，不拥有 Run 状态机。
内部 seam（拟新增，非 public SDK）：`submitRun(db, normalizedIntent, dependencies)` 返回已提交的
Run admission 或已有 Run 的 replay；`waitForRun(db, jobId, {timeoutMs,...})` 是同 owner 的只读等待操作。
API/job.run 各自只做语法解析及信封翻译；共享 store lifecycle 仍管理 job，ledger 管 facts。

| 当前 owner / 入口 | 实施落点与同 change 删除点 |
| --- | --- |
| shared/local-job-api.ts | 既有 normalization 加 optional key；新增 submit/wait/retry request/envelope 类型，类型不拥有 DB 或 dispatch。 |
| headless/local-job-api.ts | 保留 v1 validation、artifact contract、serializers；createLocalJobApiJob/retryLocalJobApiJob 成为薄 admission adapters，删除它们的重复 job allocation/插入编排，统一调用 submitRun。 |
| headless/job-store.ts | createAgentJob/retryAgentJob 复用一个私有插入 primitive；job+key reservation 原子；同一 compensation 删除 job/key；既有 start/cancel/ledger 端口不复制。 |
| headless/schedules.ts | schedule 事务调用同一 store 插入 primitive 替换 createScheduleJobRecord 的重复 row construction；schedule fire/audit/nextRunAt 唯一 owner 不变，提交后仍走 recordAgentJobCreated。不新增 public schedule idempotency。 |
| headless/daemon.ts | 既有 queue loop/claim owner 增加 api eligibility 与 kind dispatch；把现有 loop 提取成可供 protocol session 调用的同文件 scoped pump，删除旧 loop 内重复 dispatch；不增加 worker 或 queue 表。 |
| headless/job-runner.ts、completion-runner.ts | 保留 agent/completion 唯一执行 owner，daemon 调用对应 runner；API artifact admission/terminal preparation 从 CLI 移到提交及 executor composition。 |
| headless/cli-dispatcher.ts | 删除 runPreparedLocalJobApiJob 及 API create/retry 的 runner 直调；create/retry 只 submit+wait+serialize，submit 只 admission，wait 只读。人用 locus run 不在该删除范围。 |
| headless/jobs-stdio.ts | 删除 job.run 的独立 create+runPersistedAgentJob 编排，映射到 submitRun + 同一 scoped pump；保留 session-owned job 集合仅用于 transport cancel/shutdown，不成为 lifecycle 真相。 |
| agent-runtime/run-event-ledger-host.ts / run-event-ledger.ts | 沿 appendSystemEvent、settle、getOrCreate/release 组合；host 是 appendExact 唯一 importer；新增读观察组合，不直接造事件。 |
| agent-runtime/run-artifacts.ts + local-job-api serializers | reopen 安全 run-dir，校验终态发布完整性；不复制写文件/脱敏/manifest schema。 |
| desktop Workbench | 继续读同一 jobs/events；API queued/cancel/retry 不增加 renderer FSM，无需 desktop-agent-jobs delta。 |

**四项交付**：owner 如表；删除点如表且守卫覆盖；migration gate 见 D7；验证消费者为
Locus-neutral API batch/structured-output、stdio、daemon、Workbench/store readers。
Career Kit、Amadeus 的 adapter/E2E 回执记录 `unknown`，不成为额外发布 veto。

## D2. Commands, envelopes and wait

拟定操作（需通过 proposal C7 Gate）：

```text
locus api runs submit --request <path|-> --json
locus api runs wait <job-id> [--timeout <milliseconds>] --json
locus api runs create --request <path|-> --json
locus api runs retry <job-id> [--request <path|->] [--async] --json
```

submit/create 使用现有 agent/completion request，加 optional `idempotencyKey`。
retry 的新增 request 仅允许 `{apiVersion,consumer:{id},idempotencyKey?}`；consumer.id 必须与原 Run
的规范化 apiConsumerId 相等；未提供 request 时沿原 Run 的 consumer 和输入，不要求旧调用者加字段。
`--async` 返回 admission；原 retry 仍 submit+wait。取消命令和请求外形不改。

fresh submit ack 输出 `apiVersion`、`job`，exit 0；不带 result。`job.status=queued` 是提交边界的
不可变 admission snapshot，不是 stdout 发出瞬间的活性承诺：其他进程可能已 claim；`runs status`
读取最新事实。replay 返回已有 job 的**当前**状态，可能已 terminal，不伪造 queued。
只对提供 key 的 replay 响应加 top-level `idempotentReplay:true`；无 key 的旧输出不加该成员。
create/retry 的 keyed replay 可以带该 optional 成员；L2 的旧请求 byte oracle 不受影响。

wait 默认 **30,000 ms**；显式值为 0–86,400,000 的安全整数，0 表示一次观察，负数/NaN/Infinity 拒绝，
exit 2。截止时间用单调时钟；每次最多 100 ms read interval，订阅只用于唤醒，不作为事实。
先读，注册唤醒后再读；跨进程定时重读同一持久 predicate，避免错过完成通知。
到 deadline 再观察一次：ready 优先，否则只输出一次如下响应，exit **9**（只属于新 wait 命令）：

```json
{"apiVersion":"locus.local-job.v1","job":{"id":"job-A","status":"queued"},"wait":{"state":"timeout","timeoutMs":30000,"reason":"executor_unavailable"}}
```

示例 job 为节选；实际使用完整既有 job serializer。reason 为 `executor_unavailable`、
`executor_unknown`、`run_pending`、`terminal_artifacts_pending`。timeout 不 cancel、不 retry、不写
Run error/completed。最后一种情况下 job.status 可以已 terminal，wait.state 仍表示“完成物尚未就绪”，
不能为满足“非终态响应”而改写 canonical Run status。无 artifact run（包括 completion）以 completed
已提交为 ready，publish 条件为空真。找不到或非 API job 按既有只读命令拒绝方式 exit 3。

ready 返回现有 create 完整 `{apiVersion,job,result}` serializer，使用 frozen terminal prefix 的
完整 registered artifact refs（含基线 create 返回的 manifest ref），显式传给既有 serializer，
不能把默认 runs result 的 manifest-entry 子集误当作 create 输出；退出码经 `normalizeHeadlessExitCode`，0–8 含义不变。wait 本身不添加 replay 标志。
旧请求 create 与独立 submit+wait 的 byte equivalence 使用相同固定 ID/时钟/worker identity、结果、
路径、app version 夹具的独立 DB 比较完整 stdout（含换行），不得删除字段再比较。
真实两次新运行的 ID/时间当然不同；该断言不是要求不同 Run 输出字面相同。

**Q2 / Red R1，未解决的可行性问题**：基线 create/retry 不需要预先运行 daemon。
L1 删除 inline runner 后，单靠 serializer 不能证明 L2 的启动体验不变。本稿**保留 L2**：
同步 wrapper 内部可重复调用有界 wait，但不把 wait 的 timeout9 当成 Run 退出码或提前返回结果；
无需等待的新 submit 仍允许 executor 不在，状态可查。如何为旧 create 保证执行者由 Q2 决定，
不得在实施时自行加“先启动 daemon”前提。推荐研究复用既有 daemon 的启动编排，仍由同一 queue/claim
执行，不能恢复 inline runner。若 Owner 改选“消费者显式启动 daemon、wrapper 在无 executor 或发布异常
时 bounded exit8”，这是 **Red R1 的 L2 例外**，须先修订本文/spec/fixtures；本稿不将该例外写成默认行为。
旧 create 在缺失执行者/partial publish 时的可完成性尚未证明，必须在 APPROVED 前解决，不能用正常
终态 golden 掩盖该缺口。CLI submitter 退出不隐含取消已提交 Run；消费者使用既有 cancel 操作。

## D3. Creation acknowledgement and TICKET-128 boundary

提交次序：纯校验/规范化及 existing admission gates → 生成 ID → job+key 同事务 reservation →
`recordAgentJobCreated` → host ledger commit creation fact → 初始 artifact preparation/admission（如需要）
→ 返回 queued admission。不等待 provider、runner、runtime child、terminal。

最小改动保留现有“两次提交”，**不把 async Promise 塞入 better-sqlite3 同步事务**，也不引入第二
同步 ledger。ack/replay success 都必须查到 observationKey=`lifecycle:job-created:<id>` 的 committed `job_created`
（实际 factKey 为 `<observationKey>:<ordinal>`，creation 单事实为 `:0`；见 `src/main/lib/headless/job-store.ts:1117`）；
有 run-dir 且尚未 terminal 的 replay 还需确认初始 artifact admission，未完成则 submission_pending。
list/start 共用该准确 fact-key+type predicate；不能只测事件 type。有 run-dir 的 API Run 还须有初始
artifact admission 才 runnable，以防 job_created 后 executor 抢跑初始文件写入；该 eligibility 从
既有 committed facts 推导，不新增 queued 子状态。无 run-dir 不需要 artifact fact。
初始失败已有 creation fact 时，由同 host settle failed，保留 key 到该失败 attempt；不得删除有事实的 job。

普通 creation append 失败：现有“queued 且无任何已提交事件”补偿 transaction 同时删除 job/key。
提交前崩溃：SQLite 回滚二者。job/key 提交而 creation 未提交时崩溃：无成功 ack；key 仍占用，
queue/start 都拒绝。重复请求遇到这种记录返回既有结构错误形状，code `submission_pending`、exit 8，
不返回 replay success、不按 TTL 偷删并重跑。补偿失败同样如此；修复前没有永久 exactly-once 承诺。
**不凭“当前没事件”判断另一个仍在创建的进程已死。** orphan 的原子 creation/recovery 属于 TICKET-128，
若 Owner 要本切片全量解决，先修订 Q4 scope/deltas/red tests；本稿只解决 ack 与消费安全。

schedule 仍保有 schedule/job/audit 事务及随后 host creation；其孤儿也不被 claim，但不能借 API key
清理改写 schedule fire 真相。现有 legacy v0 rows 不补造 job_created、不开放执行。

## D4. Idempotency storage and normalization

新增的是 reservation 索引，**不是 queue/Run 表**：拟 `agent_job_idempotency`，
unique(normalizedConsumerId,keyHash)，jobId 外键，requestHash、normalizationVersion=1、createdAt。
原始 key 只在入参内存中出现，1–160 ASCII `[A-Za-z0-9._:-]`，大小写敏感，无隐式 trim。
consumer.id 沿现有 trim/大小写规则。SHA-256 输入使用带域名及长度前缀的 consumer/key，避免拼接歧义。
DB 不存原 key；inputJson、request.json、events、result、stderr、diagnostics 亦不存/回显原 key。
key 不是授权令牌；consumer.id 是本地 attribution namespace，不声称已具备多租户认证。

fingerprint = canonical JSON 的 SHA-256：normalize 现有 alias/default/null、canonical cwd/project identity、
artifact base、provider **选择意图**（omitted/default 与显式 model-only 区分）、runtime/profile/policy grant、
prompt/input 或 completion messages/response schema/tuning、consumer runExternalId；object keys 排序，
requiredCapabilities 去重排序，其他数组保持次序，opaque input/schema 不赋领域语义。
不含 raw key、wait timeout、sync/async 选择、生成 job ID/时间、实际凭据或 mutable provider secrets。
create/submit 统一 operation=submit；retry operation=retry 并含 source job ID、其保存输入快照。
因此 create→submit 同 key 可重放；同 key 在 submit/retry、不同 source retry 或任何语义输入变化都冲突。
纯解析后先查保留的 reservation；匹配 replay 不重跑 provider preflight、文件写入或 runtime；只有新
reservation 做当前 admission 检查。返回已持久化 attempt，不因 provider 后续变动重执行。

并发依靠 SQLite 唯一约束，不能先 query 再无条件 insert；输家重读 committed reservation 后按
相同/冲突/pending 返回。冲突使用 `{apiVersion,error:{code:"idempotency_conflict",message:"..."}}`、exit 2，
不回显请求、key 或另一个 consumer 的 job ID。不存在原有通用 typed error envelope 的假设；复用现有
project/provider 错误的 apiVersion+error outer shape，为新错误补 schema/types，不改变旧 stderr-only 错误。

建议保留到 terminal **且 publish 就绪后的至少 30 天**；queued/running、unpublished terminal 和 orphan
不自动过期。清理只删已到期 reservation，不删 job/events/artifacts；job 经既有获授权删除时 FK cascade
释放 key。回放不延长 TTL；过期后的同 key 是新提交且不带 replay 标志，文档明确此期限而非永久一次执行。
实施需由 executor/publisher 记录确定的 expiresAt（在已验证 publication 时设置一次），
wait/readers 不写 TTL；进程崩溃未设置时保守保留，不能由晚到 usage 改写。
失败 creation 的补偿删除则立即释放；normalization/hash schema 升级不得静默重解释未到期 reservation。

## D5. Executor and publication observation

daemon 原 source=daemon/schedule 顺序、并发和 lock/nonce release 规则保持，增加 `source=api`。
所有 claim 仍由 startAgentJob 经 ledger 条件提交；source=desktop/default cli/protocol 不被普通 daemon 捞取。
protocol 的 scoped pump 只处理本 session 已 admitted ID，既有 in-process executor 的生命周期保留，
shutdown/EOF cancel 并 drain 本 session；不接管 API job，不把 job.run 改成需要外部 daemon。
queued API cancel 的 lifecycle host 必须从持久输入组合同一个 API terminal preparer 后再 settle，
即使 worker 从未启动；API/Workbench cancel caller 不另造终态或文件。
API completion 必须进入 completion runner，一次 upstream call、无 runtime child、无 artifact/run-dir。
agent executor 重新打开/核对 admitted run-dir 身份，使用已存 request/profile，不能带着 submit 进程的 fd
跨进程，也不能扩大 cwd/root、静默降级到 path-only IO。

建议只在 `runs status` 顶层加 optional `execution`（避免改变 create 的 bytes）：

```json
{"state":"unavailable","reason":"no_executor","observedAt":"2026-10-01T00:00:00.000Z","hint":"locus daemon run"}
```

state=`available|unavailable|unknown`；reason=`executor_observed|no_executor|probe_unavailable`。
对实际 claim 中的运行可用 store claim/heartbeat 与现有 recovery liveness 判断；queued 的 daemon
可用性结合同 profile lock/nonce 的只读一致快照、进程活性和 executor 能力标记（新增 additive lock
metadata，旧 lock 不能证明支持 api）。无锁/证实进程不存在为 unavailable；权限不足、旧版 lock、
无法核实身份或格式异常为 unknown；不能把 lock 存在当已开始，也不能把 stale heartbeat 当死亡。
这些是 advisory，可能马上过时；不新增 lease/registry/worker table，不改 runtime.readiness 的 auth 含义。
不暴露 PID、nonce、hostname、锁路径或凭据；hint 只指向本地启动命令。

wait 每轮统一读 predicate：一致读取 ledger seal/completed 和 terminal refs → run-artifacts 通过
已验证 run-dir handle 检查**全部必需终态文件**存在、大小/digest 与该 commit 相等 → 重读 seal/refs
未变 → ready。不能只看 job.status、一个 manifest 是否存在、内存 publish() 返回值或 events --follow
退出。文件不完整就 pending；deadline 到时 terminal_artifacts_pending，不能 mint 第二 completed 或把
已提交 succeeded 改成 failed。completion/no-artifacts 在 seal 后就绪。
read helper 拟 `readRunPublicationReadiness`（run-artifacts 所有，host 组合）是派生只读结果，无持久 FSM。

TICKET-128 的部分 rename 崩溃在本切片仍可导致 wait 超时，正确行为是暴露未就绪，不承诺自动重建。
修复方向沿同一 terminal preparer/host，未来统一可恢复 publish/cleanup；本稿不得加第二 artifact owner。
普通 `runs result` 和 `events --follow` 的既有读取/终止合同不被改成 wait 的 barrier；consumer 需要
完整最终文件时显式 wait。因 late diagnostics 不改 terminal files，校验使用 frozen terminal prefix。

## D6. Public boundary and security

推荐保持准确 `locus.local-job.v1`，以 `async-submit` feature 发现新增操作；Phase 3“v1.1”是路线标签，
不是当前已接受的 wire version。当前传 `locus.local-job.v1.1` 会收到
`apiVersion must be locus.local-job.v1`，不能默默接受或 downgrade。Q1 留 Owner 选择请求门控。

必须明确 **Red R2**：既有 discoveryFeature closed enum 的新值对 pinned-old-schema consumers 是 breaking，
unknown optional fields 规则救不了 enum；建议 Owner 选择同 ID 直接扩展该枚举、更新 schema/guide/fixtures。
不能把姊妹切片的 C7 批准用于本次广告。其余 optional status/replay 字段、opt-in key、新 submit/wait/retry
--async 是 additive，仅在 feature 已确认时依赖；旧 build 可能忽略 unknown agent request 字段，消费者
不得盲发 key 再假定去重。无需、也不添加原生 event/extension；既有 runtime.codex.v1 不改变。

consumer.id+hash 唯一查找，不跨 consumer 返回 job；retry body mismatch 在查找 key 前拒绝。
所有文件读写走既有注册根、run-dir identity 和 redaction owner，无凭据新入口；执行前重新检查实际
provider/policy 可用性并按已有语义失败，submit ack 不保证未来 credentials 一直有效。
Windows artifacts 继续如实 fail closed；不从 Amadeus 在 Windows 接入这一事实推导 run-dir 支持。

## D7. Migration, rollback and gates

当前数据阶段仍为 disposable test profiles，本稿选 **additive migration** 而非 reset；reservation 的
新表/唯一索引/FK 在 `drizzle/` 新 migration 中登记，具体编号实施时分配，现有 `0024` 不改写。
既有 job/events 不回填 key、不改 ID、不改 artifact retention，不清空 consumer 数据。

activation gate=`async-submit storage/claim readiness`：迁移完成、旧提交/执行 writer 停止、存量 queued
API jobs 已核对并 drain/cancel（不把旧 schema jobs 意外纳入新 eligibility）、新 core 所有 caller 原子切换、
schema/指南/fixtures 与独立 red→green 证据齐全后才广告 async-submit。无 runtime old/new 双跑 flag，
无 ledger transition gate 复活。实现前要证明旧版本不能与新 reservation writer 共用 profile：
旧进程绕过 key/eligibility，不能仅凭 SQLite 兼容性称安全。

回滚先停止新提交/执行者并 drain/cancel，保留 evidence；旧构建只用隔离 profile，或经单独证明的完整
backup restore，不删除 consumer artifacts/job history，不让旧 writer 写新 profile。feature 消失需明确拒绝
依赖该能力的新 consumer，不静默 downgrade。不做 merge/push/PR/release；Owner APPROVED 与 ACCEPTED 都尚无。

## Open questions — Owner decision needed（最多六项）

1. Q1：是否采用推荐的 `locus.local-job.v1` + `async-submit` discovery，还是另发并硬门控 `locus.local-job.v1.1`（后者需修订合同/版本兼容范围）？
2. Q2 / Red R1：是否要求推荐的复用既有 daemon 启动编排以守住 L2，还是明确批准“显式 daemon 前提及异常 bounded exit8”的 L2 例外并先修订规格？
3. Q3 / Red R2：是否批准同一 v1 discoveryFeature 封闭枚举新增 `async-submit` 并要求固定旧 schema 的消费者更新，还是改用新版本/延期？
4. Q4：是否批准本切片只补 TICKET-128 的 ack/claim/只读 publication barrier，保留已披露孤儿/恢复缺口，还是把其完整修复设为前置独立变更？
5. Q5：是否采用 terminal publication 就绪后至少 30 天的幂等保留期、未终态/孤儿不自动释放及仅 hash 存储？
6. Q6：是否采用新 wait 默认 30 秒、0–24 小时显式毫秒参数及仅 wait 使用的超时退出码 9？
