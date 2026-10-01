# Design: Local Job API async submit

Status: **DRAFT — awaiting Owner APPROVED**（第二版；fresh synthesis @ b26c0651）

## Context and source basis

本稿是 Phase 3 第二份提案，不是实施授权或已发布合同。只读基线为
`2c59664f1b80a5f782eb05f82d33f718d9bc7053`；以下仓库 `file:line` 均相对该 SHA；b26c0651 没有产品代码变动。
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

## Revision evidence

裁定依据：`/home/chen/.claude/projects/-home-chen-projects-agent-code-for-me/f1888632-cd03-49a0-a57d-51704695f29d/handoff/reviews/async-submit-draft-synthesis-b26c0651.md` §1–§4（27 findings，3 P1 / 13 P2 / 11 P3）。同目录五份 `async-submit-draft-review-{brief-adherence,contract-c7,code-fit,spec-quality,security}-b26c0651.md` 是证据底稿；实际安全评审文件名为 `security`。
新增基线依据：`process-runner.ts:229-234`、`adapters/codex.ts:77-81`、`daemon.ts:162`（executor env）；`codex/official-runtime-env.ts:3-21`（native homes）；`codex/provider-runtime-binding.ts:12-32`、`claude/env.ts:27-34,417-422`（两路径都剥离 secrets）；`job-recovery.ts:117-172`、`cli-dispatcher.ts:1091-1099`（recovery）；`run-artifacts.ts:529-558,674-675`、`local-job-api.ts:1009-1011,1089-1100`（admission/receipt/staging）；这些短路径均位于 `src/main/lib/` 对应 owner。
`openspec/specs/agent-protocol-interfaces/spec.md:35-69` 是 stdio delta 的现有 owner；`headless-agent-jobs/spec.md:137-174` 是 daemon 的现有 Requirement；`local-job-api/spec.md:462-485` 是 discovery owner。三者使用完整 MODIFIED block，避免 archive 后双重规范。

## Goals / Non-goals

Goals：一个持久提交核心、可立即取得的 job ID、有限时 wait、consumer 隔离幂等、可观察执行者、既有 v1 兼容证据。

Non-goals：durable Interaction/cursor reconnect → `add-durable-agent-interactions`；
Session/continue/resume → `add-durable-session-bindings`（FROZEN 1.1 continuationHandle 是 Phase 5 输入，
见 `openspec/STATUS.md:59`）；HTTP/socket 服务、远程、多租户、优先级队列、SDK 生成；
Runtime 交付 → 独立 managed runtime changes；Windows 文件系统后端 → TICKET-127；
TICKET-128 的全量原子 creation / 可恢复整组发布协议不在本稿冒充完成，见下文边界。
Phase 3 artifact refs 的新增公共寻址/搬运能力留给独立 artifact-ref proposal；本切片只消费既有 ledger refs，不宣称交付该路线项。
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

以下细化采用 fresh synthesis §2–§4；六组选择均为 **统筹预设（推荐，Owner 可改）**，不是 Owner APPROVED。L1–L11 不变；L3 的 public key surface 按本次派单收窄为 submit / retry --request，create 请求保持原样。

## D1. Single submit core and owner map

拟新增 `src/main/lib/headless/run-submission.ts` 为**提交编排唯一 owner**，不拥有 Run 状态机。
内部 seam（拟新增，非 public SDK）：`submitRun(db, normalizedIntent, dependencies)` 返回已提交的
Run admission 或已有 Run 的 replay；`waitForRun(db, jobId, {timeoutMs,...})` 是同 owner 的只读等待操作。
API/job.run 各自只做语法解析及信封翻译；共享 store lifecycle 仍管理 job，ledger 管 facts。

| 当前 owner / 入口 | 实施落点与同 change 删除点 |
| --- | --- |
| shared/local-job-api.ts | 既有 create normalization 不变；submit/retry parser 加 optional key；新增 submit/wait/retry request/envelope 类型，类型不拥有 DB 或 dispatch。 |
| headless/local-job-api.ts | 保留 v1 validation、artifact contract、serializers；createLocalJobApiJob/retryLocalJobApiJob 成为薄 admission adapters，删除它们的重复 job allocation/插入编排，统一调用 submitRun。 |
| headless/job-store.ts | createAgentJob/retryAgentJob 复用一个私有插入 primitive；job+key reservation 原子；同一 compensation 删除 job/key；既有 start/cancel/ledger 端口不复制。 |
| headless/schedules.ts | schedule 事务调用同一 store 插入 primitive 替换 createScheduleJobRecord 的重复 row construction；schedule fire/audit/nextRunAt 唯一 owner 不变，提交后仍走 recordAgentJobCreated。不新增 public schedule idempotency。 |
| headless/daemon.ts | 既有 queue loop/claim owner 增加 api eligibility 与 kind dispatch；把现有 loop 提取成可供 protocol session 和同步 API wrapper 调用的同文件 scoped pump `pumpQueuedRuns`，删除旧 loop 内重复 dispatch；不增加 worker 或 queue 表。 |
| headless/job-runner.ts、completion-runner.ts | 保留 agent/completion 唯一执行 owner，daemon 调用对应 runner；API artifact admission/terminal preparation 从 CLI 移到提交及 executor composition。 |
| headless/cli-dispatcher.ts | 删除 runPreparedLocalJobApiJob 及 API create/retry 的 runner 直调；create/retry 只 submit+scoped pump+wait+serialize（Q2(a)），submit 只 admission，wait 只读。人用 locus run 不在该删除范围。 |
| headless/jobs-stdio.ts | 删除 job.run 的独立 create+runPersistedAgentJob 编排，映射到 submitRun + 同一 scoped pump；保留 session-owned job 集合仅用于 transport cancel/shutdown，不成为 lifecycle 真相。 |
| agent-runtime/run-event-ledger-host.ts / run-event-ledger.ts | 沿 appendSystemEvent、settle、getOrCreate/release 组合；host 是 appendExact 唯一 importer；新增读观察组合，不直接造事件。 |
| agent-runtime/run-artifacts.ts + local-job-api serializers | `reopenAdmittedRunDir(job, committedInitialRefs)` 独占跨进程重开、验证并重建 receipts；校验终态发布完整性；不复制写文件/脱敏/manifest schema。 |
| desktop Workbench | 继续读同一 jobs/events；API queued/cancel/retry 不增加 renderer FSM，无需 desktop-agent-jobs delta。 |

**四项交付**：owner 如表；删除点如表且守卫覆盖；migration gate 见 D7；验证消费者为
Locus-neutral API batch/structured-output、stdio、daemon、Workbench/store readers。
Career Kit 已核实的 adapter 事实见 proposal §5；本切片 Career Kit、Amadeus 的 E2E 回执记录 `unknown`，不成为额外发布 veto。

## D2. Commands, envelopes and wait

```text
locus api runs submit --request <path|-> --json
locus api runs wait <job-id> [--timeout <milliseconds>] --json
locus api runs create --request <path|-> --json
locus api runs retry <job-id> [--request <path|->] [--async] --json
```

**统筹预设（推荐，Owner 可改）Q1**：create request field-for-field 不变；只有 submit 的 agent/completion body 和 retry `--request` 接受 optional `idempotencyKey`。新版 create 若带 key 返回 stdout v1 error / exit 2 / `idempotency_key_not_supported`，不执行；旧 build 的 create 会忽略未知 key，因此消费者绝不能用 keyed create。retry body 只接受 `{apiVersion,consumer:{id},idempotencyKey?}`；无 body 沿原 Run 的 consumer/input。`--async` 返回 admission，其余 retry 同步等待。cancel 外形不变。

fresh submit ack 是 `{apiVersion,job}`，exit 0、无 result，queued 是已完成 admission 的固定快照；另一个进程可以先于 stdout claim，随后 status 必须读到 running。此解释放入指南，不用不可观测的 “SHALL NOT imply” 充当验收。replay 返回当前 job 状态并仅在 keyed replay 加 `idempotentReplay:true`；无 key 的 create/retry/wait 不添加该字段或 execution。

wait 默认 **30,000 ms**，显式 **0–86,400,000 ms** 安全整数，0 单次观察；非法参数 stderr、exit 2。monotonic deadline，每次最多 100 ms 间隔；read → register wakeup → re-read，跨进程定时重读，deadline 最终 read 的 ready 优先。否则 stdout 一个 `{apiVersion,job,wait:{state:"timeout",timeoutMs,reason}}`，**exit 9 仅 wait**，无 result，不改变 outcome。D5 的表唯一决定 reason。

ready 的完整 `{apiVersion,job,result}` 使用既有 serializer 和 `normalizeHeadlessExitCode`。`result.artifacts` 精确来源为 terminal commit 经 preparer 登记的 **prepared tail**：从同一 frozen terminal prefix 的持久 artifactRefs 中扣除已带 `sequence` 的 state refs，保持 prepared refs 原顺序及完整字段，输出不得带 `sequence`，包括 terminal manifest ref；它等于今日 `terminal.artifacts()` 成功发布后的数组，不能拿 `runs result` 默认 manifest-entry 子集代替。无 preparer 的 recovery/无 admission cancel 没有 prepared tail，`result.artifacts=[]`；初始 refs 留在 committed events/result history，不冒充 terminal files。结果里的 job/status/result 来自 committed terminal，不从初始 result.json 推断。

S03/S04 在独立 DB 固定 job ID、createdAt/startedAt/completedAt、workerId、workerPid、appVersion、cwd/artifact paths 和 runtime result，比较完整 stdout（含换行），不删字段、不在比较后归一化。另用真实进程断言 workerId/workerPid 属实际执行者；daemon 认领时 provenance 值变化按 proposal #3 披露。

### Q2 / Red R1 条件化 wrapper 合同

以下三个分支都是待 Owner 选择的条件合同；不得把任一分支写成已批准事实。当前没有后台 daemon launcher，也没有能捞 API queue 的 Desktop worker；`locus daemon run` 是 foreground、opt-in。

| Q2 选项 | 无 daemon / executor 停滞 | publish failure 与非 outcome failure |
| --- | --- | --- |
| **(a) 统筹预设（推荐，Owner 可改）** | wrapper 调用 `pumpQueuedRuns({admittedIds:[ownId]})`，经 startAgentJob 和既有 runner/terminal composition，再 waitForRun；与 stdio 使用同一 symbol。无 daemon 也运行；若 daemon 已 claim，wrapper 只 wait，不第二次执行。活跃 Run 沿既有 runtime timeout/cancel；每个 30 s 观察窗末若没有可证活跃 worker/进展且未 ready，则退出下述 observer error，而非无限空等；确认死亡只由 recovery 结算，unknown 不伪造死亡。 | 本进程 pump 完成但 publish 失败时保留今日 `artifacts:[]` + committed outcome exit 基线（wrapper 的明确 failure parity 分支，不把它标作 wait ready）；新 `runs wait` 仍返回 terminal_artifacts_pending/9。daemon-first 无本地 publish 结果时，terminal commit 后最多 30 s 未 ready 即 error/8。本地非 outcome 故障停止自己的执行树，stderr/8，沿今日失败行为；远端已 claim 时使用带 id 的 error envelope。 |
| (b) 显式 daemon prerequisite | 没有 executor 或无进展的观察窗达 30 s 时 bounded error/8；活跃执行按既有 timeout。构成 **L2 例外 / Red R1**。 | publish 未 ready 达 30 s 为带 id 的 error/8，不能宣称 outcome；须 Owner 明确接受偏离今日 publish-failure baseline。 |
| (c) 新 detached launcher | 新增跨平台后台启动、锁竞争和生命周期 surface（C7 #9）；启动最多 30 s，失败 bounded error/8；启动成功同 (b)。 | 同 (b)，还需独立 launcher/platform 夹具；不是“复用”现成编排，成本最高，不推荐。 |

30 s 观察窗的进展以 committed high-water 或 worker heartbeat 变化为准；正常长任务的心跳变化即进展，首次 wait timeout 后仍等待并沿既有 runtime timeout；30 s 没有 heartbeat/high-water 进展即使 PID alive 也只是 observer error，不判死（stale heartbeat 的 executor state 为 unknown）。terminal 未 publish 的 30 s 上限独立于心跳。初始数据库读取失败立即按错误规则返回。S25 的正常长任务在首次 wait timeout 后继续等，不泄漏 exit 9。任何 (b)/(c) 选择都必须连同 fixtures 在 APPROVED 前确认 L2 例外；(a) 的 daemon-first error 分支同属明确披露的 R1 残余。

非 outcome wait 读失败（如 SQLITE_BUSY）在已有 job 快照后返回 stdout `{apiVersion,job,wait:{state:"error",reason:"observation_failed"}}` / exit 8；无已读 job 时 stderr v1 error `observation_failed` / exit 8。wrapper (b)/(c) 或 (a) daemon-first 必须携带已 admitted job.id；reason 为 `executor_unavailable`、`executor_unknown`、`terminal_artifacts_pending` 或 `observation_failed`。无 result 表示不能按 exit code 推断 Run outcome；consumer 可按 id status/cancel。本地 (a) 不留下仍运行的 owned child；已 admitted 但尚未 start 的 own Run 经既有 queued cancel 收束；不通过重跑 submit 恢复 observer。

### R3 / R4 执行环境与退出

**Red R3（#6/#7/#9），统筹预设（推荐，Owner 可改）接受**：daemon 认领的 Run 使用 daemon process env，native credential/config homes `HOME` / `CODEX_HOME` / `CLAUDE_CONFIG_DIR`、proxy vars、部分 PATH 来自执行者；同样剥离 secrets，不宣称转移 OPENAI_API_KEY 或新增 API-key billing 路径。`runtimes list` 仍检查调用 CLI 的环境，ready 不证明 daemon 同样 ready。不得持久化 env snapshot：living headless-agent-jobs:174 禁止接收 client raw env。另一选择是保持 caller-process execution（Q2(a) 的 wrapper-owned Runs），不能传 env 绕过边界。

**Red R4（#4/#9），统筹预设（推荐，Owner 可改）**：仅在 (b)/(c) 下选 cancel-on-SIGINT/SIGTERM/stdin EOF，wrapper 已知 own admitted ID，走 existing cancel，不取消别人的 Run；signal handler 等待取消确认最多 5 s 后按原 signal 退出，EOF 清理后 exit 8，无伪造 terminal。EOF 指 admission 后收到的生命周期关闭；`--request -` 在 admission 前已消费的请求正文 EOF 不重放为取消。另一项是明确 waiter exit ≠ cancel，要求 consumer 自己保存/恢复 id 再 cancel，未拿到 ID 的 unkeyed caller 无可靠取消入口，成本较高。SIGKILL 无法捕捉；process-group kill 不会杀掉独立 daemon。
(a) 下此二选一不适用：保留今日本地执行树的 abort/EOF 行为；若 daemon 先认领，wrapper 对可捕获 abort 转发自己的 cancel，以尽量保留旧意图。daemon-first + SIGKILL 无法保证今日整树终止，作为 Open questions 的明确残余提交 Owner，不能隐去或另选默认。async `submit` 成功退出不取消其 Run。

## D3. Creation acknowledgement and TICKET-128 boundary

次序：纯校验/规范化 → 新提交 admission gates → job+key 同事务 reservation → host 提交 job_created → **只有 winner 才 mkdir** `artifactBaseDir/<jobId>` → initial preparation/admission → queued ack。loser/SQL rollback/creation compensation 不创建空目录。初始 admission 失败且 creation 已提交，由 host settle failed；保留 attempt/key，不删除已有事实。

最小 barrier 保留两次提交；不把 async ledger Promise 放入 better-sqlite3 transaction，不新增同步 ledger。list/start 共用如下 predicate（别名 j/e，factKey 存储列按现有映射）：

```sql
j.ledger_version = 1 AND j.status = 'queued'
AND EXISTS (SELECT 1 FROM agent_job_events e WHERE e.job_id = j.id
  AND e.type = 'job_created' AND e.fact_key = 'lifecycle:job-created:' || j.id || ':0')
AND (j.artifact_manifest_path IS NULL OR EXISTS (
  SELECT 1 FROM agent_job_events e WHERE e.job_id = j.id
    AND e.type = 'artifact_created'
    AND e.fact_key = 'lifecycle:initial-artifacts:' || j.id || ':0'))
```

`artifactManifestPath IS NOT NULL` 是 needs-initial-admission 的可观察谓词。run-artifacts 将现有 content-hash observation key 改成 internal `lifecycle:initial-artifacts:<jobId>`，该原子 batch 的首条 artifact_created 为 `:0`；所有 initial refs 必须同批 commit，其他 ordinal 依既有格式。只检查 type 或任意 artifact 不合格，SQL list/start 必须同条件。ack 还要求该 admission；非 terminal replay 同样要求。legacy v0 不补造 facts。

job/key 已 commit、creation 未 commit 的 orphan 不 ack、不 claim；返回 stdout `{apiVersion,error:{code:"submission_pending",message:"Submission is not yet admitted; retry the same key.",retryable:true}}` / exit 8，不透露 raw key。仍活跃的 creator 和 orphan 无法可靠区分，不按 TTL 冒删；普通 append failure 的 queued/no-facts compensation 同事务删除 job/key（FK cascade 仅此删除路径）。

creation 已 commit 而 initial admission 未 commit 的崩溃：job 保持 queued，不可认领；status/wait 优先显示 `admission_incomplete`。按已知 ID 执行 `runs cancel` 可经 host settle canceled **不注册 terminal refs**，无需打开未 admitted 目录；该 terminal 从 settlement 起计 30 天 expiry，到期 cleanup 才释放 key。这不是新 queued 子状态或自动恢复。没有收到 ID 的 keyed caller 仍只收到 submission_pending；可继续同 key 重试，或审慎采用新 key，后者可能与仍活跃 creator 重复，不保证 exactly-once。

TICKET-128 继续拥有原子 creation/orphan repair/可恢复 publish；本切片不解决 orphan 永久占 key。schedule fire/audit 保持原事务及随后 host creation，其 orphan 不因 API key cleanup 被认领/删除。

## D4. Idempotency storage and normalization

拟 `agent_job_idempotency` reservation 表（不是 queue/Run 表），unique(normalizedConsumerId,keyHash)，job FK、requestHash、normalizationVersion=1、createdAt、expiresAt。key 1–160 ASCII `[A-Za-z0-9._:-]`、大小写敏感、不 trim；invalid 或既有 shared request validator 的 assertNoSecretText/SECRET_VALUE_PATTERNS 判为 secret-like 均拒绝且不回显。consumer.id 按现有 trim 规范化，**若 redactSecretText 会改变该 normalized ID 则拒绝**；stored apiConsumerId、retry match 和 reservation namespace 都使用同一个 validated normalized ID，不拿 redacted 值与原值比较。

key hash 为 SHA-256(domain + length-prefixed consumer + length-prefixed key)。**raw key never stored**：DB/inputJson/request.json/events/result/stderr/diagnostics 均不保存原文。key 不是 secret，hash 不作机密性承诺；consumer.id 是 attribution，不是认证，同用户进程在信任边界内，不新增 HMAC/credential 入口。

requestHash = canonical JSON SHA-256：canonical cwd/project/artifact-base、alias/default/null、provider 选择意图（omitted 与显式 model-only 区分）、runtime/profile/policy grant、prompt/input 或 completion messages/schema/tuning、consumer runExternalId；object keys 与 capability set 排序，其他数组有序，opaque input/schema 不解释。排除 raw key、wait/sync/async、生成 ID/时间、凭据和 mutable provider secrets。create/submit 内部统一 submit intent，但 public create 不接收 key；retry intent 含 source ID 和原保存输入，submit/retry 或不同 retry source 不能互相重放。

解析后先查 retained reservation；匹配 replay 不重跑 provider admission、不 mkdir、不重复调用 runtime，configuration 变化不改已接受 attempt。新 reservation 才检查当前 gates。唯一约束控制并发 winner，loser 读 committed reservation 返回 replay/conflict/pending，不能 query-then-insert。公共错误见 delta 的 stream/exit/code 表。

**统筹预设（推荐，Owner 可改）Q5**：verified terminal publication 后保留至少 30 天（2,592,000,000 ms）。expiresAt 一次写入：worker/有文件 queued-cancel 的 lifecycle host 在 preparer publish 成功且 digest verification 通过后设；artifact-free、recovery、缺 initial admission 的 queued cancel 在 settle 成功时设（required terminal refs 空集）。preparation 失败且未登记 terminal refs 也在 settle 时设。partial publish 不设；成功 publish 后在设 TTL 前崩溃也保守保留。wait/status/replay 不写 TTL，不续期。

cleanup 唯一 owner 为 job-store `cleanupExpiredAgentJobIdempotency(db,{now,consumerId?})`：每次 submit 在 lookup 前清理同 consumer，到 daemon 每个 loop tick 清理全部到期 reservations；谓词 expiresAt 非 NULL 且 <= now 且 committed terminal，只删 reservation，不删 jobs/events/files。非 terminal、未发布 terminal、creation orphan 不自动过期。不存在“既有获授权 job 删除”入口；只保留 creation compensation 的 FK cascade。过期后同 key 新建且不带 replay；orphan remedy 是同 key 重试或明确承担重复风险的新 key，永久修复在 TICKET-128。

## D5. Executor, terminal projection and publication observation

### Queue 与 claim-time gate

daemon slot 按 **daemon → schedule → api** 获取，保持原 concurrency/lock/nonce；持续前两类可使 API 饥饿，已披露且本切片不加优先级/fairness scheduler。普通 daemon 排除 desktop/default cli/protocol。`pumpQueuedRuns` 是唯一 dispatch 实现，stdio 限本 session IDs，Q2(a) wrapper 限自己的 admitted ID；不创建新 worker/queue/FSM。completion 用既有 completion runner、一次 upstream call、无 child/run-dir。

startAgentJob 的条件 claim 后、任何 provider 调用或 child spawn 前，由 host 经既有 owners 复核 registered project 仍存在、stored canonical cwd 与重新解析的 canonical identity 相同（admission 将 canonical path + dev/ino 保存为 job 内部 inputJson.submissionContext.projectIdentity，serializer/request artifact 必须剔除；不新增表或 public payload 字段）、execution profile/capability/policy grant 仍有效、provider reference 可用。默认 **max queued age = 24 h**（从 createdAt 到 claim；等于上限也拒绝），Owner 可设置 `maxQueuedApiAgeMs`，不新增 public CLI flag；后台 tick 同样对超龄已 admitted API queued 作业走 host failure settlement。失败 reasons 固定 `project_unregistered`、`cwd_identity_changed`、`execution_profile_invalid`、`queued_age_exceeded`；provider 沿既有 binding code。保留已存 runtime/provider 选择，不自动换 Engine；不 claim/spawn 不安全工作，terminal refs 不可安全准备时为空。

### Cross-process reopen / receipts / staging

run-artifacts 独占 `reopenAdmittedRunDir(job, committedInitialRefs)`：以 stored artifactBaseDir/<jobId> 打开 stable-directory handle；重新验证 registered project root、artifacts base 与 run-dir containment（base 沿既有授权关系，不扩大到任意 root）；逐条用 `verifyRunDirArtifactRef` 校验 committed initial artifact_created refs 的 role/path/sha256/size，拒绝 symlink/hardlink/non-regular；只对验证通过的 single-link regular files seed fileReceipts。identity 是既有 stable-directory identity + committed byte refs 的信任依据，不跨进程传 fd，不把单纯相同路径当授权，不公开 dev/ino。验证失败由 host settle failed，reason=`artifact_admission_mismatch`、无新 terminal refs，wait 立即可读失败（outcome exit 1），不能无限等 publish。

terminal staged 名唯一包含 process PID + 高熵 preparation-attempt token（每次 rebase 换 token），exclusive create；losing preparer discard 只删自己的 token 集合，不能删/rename winner 文件。重开已经 terminal 的 Run 不重新登记 preparer、不得再次 publish；同一 terminal winner 由 ledger 条件 commit 决定。S18 需覆盖两个 cancel，以及慢 cancel 对已 claim 后立即失败的 runner；S37 真正 process A submit/退出、process B reopen/execute/publish，不共享 receipts map。Windows 无后端继续 TICKET-127 fail closed。

### 每个 terminal trigger 的唯一组合

| Trigger | host 组合与 registered terminal refs | readiness / retention 起点 |
| --- | --- | --- |
| worker | claim/reopen 后注册既有 preparer，stage → terminal commit → publish | 验证该 commit 的 prepared tail 全部发布才 ready；成功发布并核验后设 expiry |
| queued cancel，initial admission 完整 | cancel host 从 persistent input + reopened handle 组合同一 preparer，再条件 settle | 同 worker；claim/cancel 输家丢弃自己的 staging |
| queued cancel 无 initial admission；artifact-free；preparation/reopen fail closed | 不登记 terminal refs，host settle 对应 outcome/reason | committed completed 即 ready；settle 设 expiry |
| recovery（统筹预设，推荐，Owner 可改） | 保留既有 recovery owner/liveness；settle interrupted，**不登记新 terminal refs** | registered terminal set 为空，立即 ready，初始 refs 仍保留在历史；prepared tail/result.artifacts=[]；settle 设 expiry |

wait/status **observation itself** 不 settle/cancel/改 status；CLI 既有 `recoverStaleAgentJobs` prologue 不变，故启动 read 命令可能先触发既有 recovery writer，不能宣称整个命令绝无写入。daemon 恢复和 wrapper 有界观察窗末调用同一 recovery owner，不复制 liveness 或 interrupted FSM。恢复需要既有 stale heartbeat（120 s）+ confirmed stopped，不因 unknown 判死。

### Executor signal 与 decision table

API-capable daemon 必须给 lockPath；lock v2 是 `{pid,nonce,startedAt,lockFormat:2,apiCapable:true,heartbeatAt}`。每个 loop iteration（包括 active work）按锁 nonce 验证后原子重写 heartbeatAt；不能在等待整个 runner 完成时阻塞 tick。fresh = 0 <= now-heartbeatAt <= **5,000 ms**，future/unparseable 为 unknown；loop 应至多 1 s 更新一次。nonce 在双 read 之间变化，或 writer 发现文件 nonce 不等于自己最后写入的 nonce，称 swapped nonce，reader unknown、旧 writer 不再写/删继任锁。

| 同 profile executor evidence | state / reason |
| --- | --- |
| 无 lock 或 probe 为 ESRCH | unavailable / no_executor |
| alive + v2 apiCapable + fresh heartbeat + 稳定 nonce | available / executor_observed |
| alive 但 stale/legacy、EPERM、无 lockPath、格式/nonce 不确定 | unknown / probe_unavailable |
| running Run 自己的 committed worker identity + heartbeat 在既有 recovery 的 120 s stale 窗内 + confirmed alive | available / executor_observed（不要求 daemon lock，适用于 scoped pump） |

running 观察先查其实际 worker：ESRCH 为 unavailable，stale/EPERM/身份不确定为 unknown；不能用另一个空闲 daemon 的 lock 替代该 worker 存活证据。

`execution` **仅 queued/running API status 必有，terminal status 省略**；其他 envelopes 不加。queued 无 admission 优先 `{state:"unknown",reason:"admission_incomplete",observedAt}`，无 hint；其余按表，unavailable 带 `hint:"locus daemon run"`，unknown/available 不带 hint。无新增 PID 暴露，既有 `job.workerPid`/workerId 保留并真实指向实际 executor；execution 不含 PID/nonce/hostname/lockPath/credential。

| job status | admission / executor | terminal publication | wait reason / result |
| --- | --- | --- | --- |
| queued | 缺 initial admission（优先） | N/A | admission_incomplete / timeout |
| queued | available | N/A | run_pending / timeout |
| queued | unavailable | N/A | executor_unavailable / timeout |
| queued | unknown | N/A | executor_unknown / timeout |
| running | 任意（availability 不抹去已 claim 事实） | N/A | run_pending / timeout |
| terminal | 任意 | registered terminal refs 全部 verified（含空集） | ready，返回 terminal envelope/outcome exit |
| terminal | 任意 | 缺失/不匹配 | terminal_artifacts_pending / timeout |

readRunPublicationReadiness：一致读 seal/completed + prepared tail → safe handle 验全部 required terminal refs 的 bytes/digest/size → 重读 seal/refs 未变 → ready。没有 preparer 的 recovery 不强迫初始文件变成 terminal 文件。不得只读 job.status、manifest 是否存在、内存 publish flag 或 follow 退出。缓存 digest 仅限同一 wait 内相同 seal/ref 及文件 identity/size/mtime/ctime 均未变的 handle；每轮 stat，变化即重验，不每 100 ms 全量重 hash（SYN-25）。late diagnostics 不改 frozen terminal prefix。

TICKET-128 的 partial rename、stage crash residue、publish→expiresAt crash gap 仍存在。消费者删除/修改已发布文件会使后续 wait 重新 non-ready，无法区分从未发布和发布后删除（SYN-18）；durable publish marker 不在本切片。普通 result/events-follow 合同不变，完整文件 barrier 仅 wait；指南必须披露上述残余。

## D6. Public boundary and security

**统筹预设（推荐，Owner 可改）Q1：v1 + async-submit**，只 submit/retry --request 接 key。旧 build 会对 unknown submit command 或 unexpected retry --request 参数 stderr/exit 2，形状 fail-closed。反例是 keyed create：旧 parser 会忽略 key 并真执行无幂等 job，重复执行风险必须披露，不能 silent downgrade。若 Owner 选 keyed create，指南 `docs/local-job-api-v1-consumer-guide.md:210` 的 “v1 has no request field that requires a feature” 必须改为“existing create fields do not; idempotencyKey requires async-submit preflight”，计 **C7 #10**；推荐 surface 下保留此句对既有 create request 的承诺，同时增加新 submit/retry operation 的 preflight 说明，不暗加 create 字段。

**Red R2 / Q3 仍待 Owner**：直接扩 closed discoveryFeature enum 的依据是指南 :209-216 已预声明的 feature preflight/enum refresh，以及 living Discovery :476-478 的“不认为静默丢弃字段已生效”。C7 §9.8 按预声明规则判断；`canonical-run-ledger` 归档先例说明此机制可用，不转移其批准。本次 pinned-old-schema fixture 必须失败，new schema 必须通过，Owner 仍明确选择 direct/version/facade/defer。

Runtime/profile/policy 选择 owner 不变；R3 native-home/env 来源与 R4 abort 是 public Red，不伪装 internal。所有文件仍经 registered roots/stable-directory/redaction；claim 前复核 gates 和 queued age。没有 env 持久化、client token、跨 consumer replay、认证替代或 Windows path-only fallback。

## D7. Migration, rollback and gates

disposable test profiles 仍选 additive reservation migration，具体新 drizzle 编号实施时分配，0024 不改。旧 rows 不回填 key，不改 jobs/artifact retention。activation 需要 storage/claim/admission/readiness 一致、旧 writer 全停、存量 queued API drain/cancel、原子删除旧路径、schema/docs/red→green evidence 后才广告 async-submit。

旧 build fence 不声称一个旧程序不识别的 marker 能生效：使用 **隔离 userData profile** 激活新 storage，停止旧 daemon/CLI，launcher/operator 将旧 binary 固定到旧 profile；同 profile 旧新并跑明确 unsupported。task 4.9 的负例故意用旧 binary 指向新 profile证明其不会理解新 marker，阻止 rollout 宣称自动 fence；正例证明隔离路径和停旧进程。若 Owner 要共享路径强制技术 fence，需先获批能被旧 build 理解的机制，不能靠新 schema marker 虚构。此限制 SYN-26 留在 Q4 bundle。

rollback 停提交/执行并 drain/cancel，旧构建用隔离 profile或经证明的完整 backup restore，保留 consumer jobs/events/files；不混用 writer，不 silent downgrade。此提案不授权 merge/push/PR/release。

## Open questions — Owner decision needed（六组，全部 PENDING）

1. **Q2 / R1：统筹预设（推荐，Owner 可改）(a)** wrapper 在自己 admitted Run 范围跑 canonical pump，保留无 daemon 可用、L2 bytes、L4 有界错误、L8 无新凭据入口及本地执行今日 abort；备选 **(b)** explicit daemon + bounded error/8（简单但 L2 例外）、**(c)** 新 detached launcher（需平台/锁/环境选择，新增 #9，成本最高）。C7 §9.6 禁止第二同步 worker，不禁止同 pump/claim/runner 的本进程调用；stdio 是同核先例。running daemon 可先 claim，此时 wrapper 只 wait，R3 适用。**起草异议/残余**：不能把 (a) 的本地 byte/abort 保证扩大到 daemon-first 的真实 worker identity、publish observer failure 或 SIGKILL；这些需连同 R1/R3/R4 明确接受，不能凭 happy-path golden 宣称全兼容；默认仍为 (a)。
2. **R3：统筹预设（推荐，Owner 可改）接受 daemon env/native credential home 权威**，披露 #6/#7/#9 和 CLI readiness 不等于 daemon readiness；备选是限制 caller-process execution，保持环境但减小 daemon 认领范围、需修订 queue 合同。持久化 env snapshot 因 living headless:174 排除，不是可选项；双方都 strip secrets，不用已被 synthesis 驳回的 API-key/billing 例子。
3. **R4：统筹预设（推荐，Owner 可改）(b)/(c) cancel-on-SIGINT/SIGTERM/stdin EOF**；备选是 waiter exit ≠ cancel、consumer 按 id cancel，便于 detached work 但未获得 id 的 unkeyed caller 无救济；SIGKILL 不可捕获，两者都须披露。(a) 下二选一不适用、保留今日本地行为；daemon-first 的 SIGKILL 限制见第 1 项，保留 Owner 接受点。
4. **Q1：统筹预设（推荐，Owner 可改）保持 locus.local-job.v1 + async-submit，key 仅 submit/retry --request**，以旧 build 形状拒绝消除 silent drop；备选 keyed create 依赖 preflight，需 #10 指南规则变更与 duplicate-execution 披露；另一备选 wire v1.1 可硬门控但增加 parser/serializer、双 fixtures/sunset，且不解决 R1/R3。若要新版本/facade，先填 C7 版本组合/删除条件；也可延期该 public 扩展。
5. **Q3 / R2：统筹预设（推荐，Owner 可改）直接扩封闭 discoveryFeature**，依据指南预声明刷新规则、living Discovery 和 canonical-run-ledger 先例，保留 pinned-old-schema failure；备选新版本（迁移成本）、有 sunset 的薄 discovery facade（双 schema 成本，仅翻译）、延期/拒绝（无 async feature 发布）。此推荐不替代 Owner 的 Red 决定。
6. **Q4/Q5/Q6：统筹预设（推荐，Owner 可改）接受最小 ack/claim/read barrier + recovery 空 terminal refs；verified publish 后 30 天 TTL 和命名 cleanup；wait 默认 30 s、上限 24 h、exit 9 仅 wait；submission_pending 保留 exit 8 + error.code + retryable:true；max queued age 默认 24 h 可改。** 备选 Q4 是把 TICKET-128 完整原子 creation/可恢复 publish 作为独立前置（更可靠但延期），或恢复时经 reopen 完整投影（更复杂）；Q5 可改更长/短 TTL 或人工保留（成本/重复风险），queued age 也可改（过期与长期排队取舍）；Q6 可改 timeout/default/cap 或给 pending 新 exit（额外 consumer 迁移），不能把 timeout 当 Run outcome。接受残余必须逐项包含：creation orphan 永久占 key、pre-admission crash 需 cancel、partial publish/staged residue、publish→TTL crash 保守保留、消费者删除文件导致再次 pending、无 durable publish marker、daemon slot 饥饿、旧 build 仅隔离 profile fence。起草者不擅改六项默认。
