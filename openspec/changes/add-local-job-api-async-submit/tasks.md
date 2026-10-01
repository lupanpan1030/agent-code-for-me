# Implementation tasks

Status: **IMPLEMENTATION CANDIDATE — frozen 2026-10-02 (Phase III); awaiting same-SHA Codex IMPLEMENTATION_VERIFIED + Claude REVIEW_APPROVED**

执行顺序为 1 → 7 的独立 red fixtures（`20e7bfcf`，seam 批准 `8974c9ed`）→ 2–6（Phase I `89b68393`..`0ae41f47`，红套件裁定 `d59b1142`/`770c78ad`，Phase II `2385df4e`..`84c622ce`，T1 `74e30df9`..`e0a9a967`）→ 7 green（四个红文件 79/79）→ 8。
Phase III（文档、登记、smoke、冻结候选）只改 docs/openspec，无 src/tests 变更；T2（Phase III 检查 `887df155` 的修复）再改 src/tests/docs，产生新的冻结候选。每项勾选后附提交证据；未勾选项写明缺什么，不以环境失败或部分覆盖冒充完成。证据中仍有开放子项的条目不勾选，标 PARTIAL 并列出开放子项（8.1 以这些子项为准）。

## 1. 治理与基线

- [x] 1.1 Record Owner APPROVED：核对 proposal/design/deltas 的批准基线 `0f9984367a9fbc8c5030f9aecc85ac9628a71cde`；已收齐 Owner 2026-10-02 APPROVED、十节 Consumer Impact 第 10 节的 R1–R4 选择和 Q1–Q6 答案，六项全部按推荐默认。1.6 prune + closure re-check 与独立 red suite 仍是后续门槛。
- [x] 1.2 记录独立 implementation worktree/base SHA、当前 product data lifecycle stage、active overlap 和各 owner；重新核对刚归档 ledger 与 TICKET-128 状态，不把本 draft 作为实现批准。
  证据（Phase III 记录）：实现 worktree `/home/chen/projects/locus-add-local-job-api-async-submit-draft`，分支 `codex/add-local-job-api-async-submit-draft`；产品基线 `2c59664f`，实施起点 `8974c9ed`（红套件 `20e7bfcf` + seam 批准）；data lifecycle stage = PRE-PRODUCTION / DISPOSABLE TEST DATA；STATUS 仅本 change 活跃，无重叠；ledger 切片已归档（`87eb6b01`），TICKET-127/128 仍 Open。详见 verification「Candidate」。
- [x] 1.3 按 Owner 已选 Q4 仅补 ack/claim/publication-read 安全并披露 TICKET-128 残余；禁止未评审地把全量创建/发布状态机塞入本 change。
  证据：`0bbaa549`（job+key 同事务、D3 共享谓词、补偿）、`72e0f55e`（ack 在 creation fact + 初始 admission 之后）；TICKET-128 残余在指南「Known limits」（`d37fa4e5`）与 verification 披露。
- [ ] 1.4 基线采集旧 v1 create/retry 的完整 stdout/exit golden（agent、completion、所有终态与 0–8 特殊错误），固定 ID/时钟/worker identity/路径；记录 stderr-only 错误与现有结构错误的真实区别；增加本地 non-outcome failure goldens：create 的 localJobApiCreateErrorCode 默认 2、message 匹配 /unsupported/i 时 3，retry 3，保留原 stderr text、stop execution tree、不伪造 terminal、admitted-not-started queued-cancel cleanup。另采集 POSIX SIGINT/SIGTERM/SIGKILL、Windows console Ctrl/parent child.kill()/TerminateProcess、open-pipe EOF/ignored stdin 的 abort receipts（child alive/dead、row status、recovery outcome），包含 Career Kit 500 ms kill grace 截短 ack wait。
  未完成：POSIX 基线已由 S03/S04 golden（2c59664f）、S35 own-pump receipts、`tests/local-job-api-retry-error-baseline.test.ts` 覆盖；Windows console Ctrl / parent `child.kill()` / `TerminateProcess` abort receipts 无 Windows 主机，未采集。
- [x] 1.5 为独立测试作者提供下列纯合同 seams：submitRun、waitForRun、readRunPublicationReadiness、clock/ID/真实 worker identity、reopenAdmittedRunDir/receipt verification、cleanupExpiredAgentJobIdempotency、claim latch、SQL commit/compensation fault、creation→initial-admission crash、read/wakeup-registration latch（S07）、artifact write/rename fault、executor liveness/lock v2 ports、multi-process spawn/kill ports；仅接口和 fixtures，不先写生产实现。
  统筹裁定（2026-10-02，红套件审计 F3）：红套件冻结两处测试接缝名，实施必须采用——`RunHeadlessCliCommandOptions.monotonicClock`（注入的单调时钟，wait 超时与 30 s 停滞窗口只读它）与 `beforeOwnPumpClaim`（wrapper 自身 pump 认领前的测试闩，用于 daemon-first / paused 变体）；夹具目录按域分子目录 `tests/fixtures/local-job-api-async/{submit-wait,idempotency,executor,guards-protocol}/`。
  证据：独立红套件 `20e7bfcf`（S01–S54 夹具与 seam），seam 名批准 `8974c9ed`；实施暴露 `submitRun`/`waitForRun`/`readRunPublicationReadiness`/`cleanupExpiredAgentJobIdempotency`/`reopenAdmittedRunDir`/`monotonicClock`/`beforeOwnPumpClaim`（`0bbaa549`、`72e0f55e`、`4f0541bc`）。
- [ ] 1.6 Owner 决定 R1–R4、Q1–Q6 后，将 deltas 改为仅保留选定分支的无条件 SHALL；备选仅保留在 design.md Owner decisions（history，已否决，不实现）。删除 specs 内全部“统筹预设/pending/conditional”决策措辞（尤其 headless 的 R3、local-job-api 的 Q2/R4/Discovery R2），S34/S35 裁剪到选定分支；即使全部接受默认也必须执行。重跑 strict validate，取得一次简短 closure re-check，记录选定分支裁剪与 closure re-check 后的 resulting SHA，并保留 Owner 原批准绑定 0f998436；不得将待决或互斥分支带入 red tests、实施或 living archive。本次已完成文字 prune；独立 closure re-check/精确 SHA receipt 尚待完成，故本项保持未勾。
  未完成：选定分支文字 prune 已在 `0447d02d` 落地，红套件审计（red-receipt）在其上进行；但 tasks 要求的独立 closure re-check 记录与 resulting SHA receipt 未找到，仍待取得。
  T2 核对：统筹的 closure check `25575cc3`（NOT_READY）与其 addendum `abec16a5`（READY_FOR_OWNER）发生在 Owner 决定与 `0447d02d` prune 之前，审的是含预设/条件措辞的草案，因此不能充当本项要求的 prune 后 closure re-check。实质上，Phase III 检查（`887df155`）对 `specs/*/spec.md` 的 grep 未发现残留 pending/conditional/preset/否决分支/v1.1 措辞（唯一命中为 unknown-version 负例）。本项保持开放：由统筹决定以该 grep 作为 closure re-check 记录 SHA receipt，或记录豁免。

## 2. Submit 核心与 wrapper

- [x] 2.1 在 headless/run-submission.ts 实现唯一 submit 编排，API agent/completion、retry intent、stdio 进入相同 owner；共享类型只解析/normalize，不拥有 DB/dispatch。
  证据：`72e0f55e`（`run-submission.ts#submitRun`，API agent/completion/retry intent），`ad16cb0c`（jobs-stdio `protocol-run` intent）；守卫 S32/S33（`a44e87fd`）。
- [x] 2.2 local-job-api create/retry 变薄 adapter；job-store create/retry 统一 row insertion，schedule 的重复 createScheduleJobRecord 改用该 primitive 且保留 schedule fire/audit 原事务；无旧内部 alias/双业务路径。
  证据：`0bbaa549`/`72e0f55e`（create/retry 变为 submitRun 调用的 admission adapter，`insertAgentJobRow` 唯一插入），`2385df4e`（schedule 改用 `insertQueuedAgentJobRecord`，fire/audit 事务不变）；S31 绿。
- [x] 2.3 creation fact 和必要初始 artifact admission 完成后才 fresh/replay ack；快 worker 下的 queued admission snapshot 不伪装成最新状态；所有资源 handle 在提交进程关闭。
  证据：`72e0f55e`（creation commit → winner-only mkdir → 初始 admission → ack，`finally` 关闭 run-dir handle）；S01/S11/S12/S38 绿。
- [x] 2.4 删除 cli-dispatcher 的 runPreparedLocalJobApiJob 及 API create/retry runner 直调；迁移其 agent/completion dispatch、terminal artifact composition 到既有 executor，保留序列化字节/换行和 exit mapping；Q2(a) wrapper 与 stdio 同调 pumpQueuedRuns({admittedIds})，不直接 runner；按 1.6 收敛后的 R4 实现平台 catchable abort/armed EOF own cancel（仅 admission 时 open pipe 随后关闭，不重放正文 EOF），signal cleanup re-raise 原 signal，披露 POSIX SIGKILL/Windows TerminateProcess 残余。
  证据：`4f0541bc`（删除 `runPreparedLocalJobApiJob`；create/retry 为 submit + `pumpQueuedRuns({admittedIds})` + wait；R4 relay），`ac1e2f74`（retry 基线错误流/exit/gate 顺序），`84c622ce`（relay 先停自身 wait），`0e70e7d7`（T2：relay 另监听 POSIX `SIGHUP` 与 win32 `SIGBREAK`/`SIGHUP`，Windows 无法 re-raise 时 exit 8），`674ab421`（T2：own pump 运行时的 store 读失败停止自身执行树并保留基线 stderr/exit）；S03/S04/S25/S34/S35 绿；Windows 控制台信号行为未在 Windows 主机验证（verification smoke 矩阵）。
- [x] 2.5 既有 daemon queue 增加 api source 和 completion kind；claim/并发/lock nonce 复用原 owner，普通 daemon 仍不认领 desktop/default cli/protocol；API executor 调 run-artifacts.reopenAdmittedRunDir 校验 committed refs、single-link receipts、root/base containment；加入 RunLocalAgentDaemonOptions 的 providerBindingDependencies / completionFetch / appVersion / env / clock / ID / maxQueuedApiAgeMs 注入 seams；age 是 internal daemon/pump option、常量 MAX_QUEUED_API_AGE_MS 默认 86400000 ms，不是 runtime 用户配置；API claim 前复核 project/cwd/profile/grant/age（24 h 默认），失败经 host settle，completed.payload.reasons / job.errorCode / failed / outcome exit 按 headless projection table（7/7/binding 4,2,6 else 3/1/1）测试。 completion-runner 在 daemon 认领下于长时间上游调用期间按既有节奏续写 heartbeatAt，避免 120 s stale 误判（闭合检查残余 (1)）。
  证据：`72e0f55e`（daemon api 槽位、completion kind、注入 seams、completion 15 s 心跳），`765b8ea6`（认领后 claim gate 与 reopen、`MAX_QUEUED_API_AGE_MS`），`74e30df9`（缺 identity fail closed），`27cbcdad`（gate handle 关闭），`dcad0c0e`（daemon tick 结算超龄），`ad6225cb`/`22d4336b`（`claim_gate_failed` 记录与测试），`0d6b03da`（T2：超龄 tick 仅对竞争静默，其余错误写净化 `[Daemon]` 诊断并在后续 tick 排除）；S28/S37/S39/S42 绿。
- [x] 2.6 jobs-stdio job.run 删除独立 create+runner 编排，使用同 submit 与既有 pump 的 session-scoped mode；initialize/job/event/job.cancel/shutdown/EOF 外形、取消范围及 drain 行为不变；不需要外部 daemon。
  证据：`ad16cb0c`（job.run → submitRun + session 作用域 pump；cancel/shutdown/EOF 不变）；S29/S30/S48–S51 绿。
- [x] 2.7 queued API cancel 从持久输入组合同一 terminal projection 后交既有 cancelAgentJob/host settle；不能依赖 worker 先注册 preparer；missing-admission cancel 与 recovery 不登记 terminal refs、ready 空集；recovery 保留原 prologue；process+attempt 唯一 staging，cancel/cancel 与 slow-cancel/failing-claim 输家只丢自己的 staging，不造第二 completed。
  证据：`765b8ea6`（process+attempt 唯一 staging），`5615e1f2`（已 admitted queued cancel 组合同一 preparer 并发布终态 refs；未 admitted/无 artifact/重开失败为空集）；S18、`tests/local-job-api-queued-cancel-terminal.test.ts` 5/5 绿。
- [x] 2.8 OWNERSHIP_MAP 新增提交/wait owner 行及 queue/publisher-read 消费方映射；增加 S32/S33 结构守卫与 self-test，证明旧路径删除且唯一 appendExact importer 不变。
  证据：`a44e87fd`（守卫段 + 17/17 自测 + 五个 OWNERSHIP_MAP pin），`0537da25`（pump 作用域措辞），`4748aa73`（Phase III 补齐 reservation/谓词/readiness/claim gate/queued-cancel/executor 观察 owner 行）；S32/S33 绿。

## 3. Wait 与超时

- [x] 3.1 实现 `runs wait`，默认 30000 ms、0–86400000 整数、monotonic deadline、deadline 最终读优先；wait 只读，不取消或更新 TTL。
  证据：`4f0541bc`/`72e0f55e`（`runs wait`，默认 30000、0–86400000、`monotonicClock` deadline、只读）；S06/S07 绿。
- [x] 3.2 host 组合同一 run-artifacts publication-read port：read seal+prepared tail → safe handle 验该 terminal commit refs → recheck same seal；序列化 prepared tail 无 sequence、与 terminal.artifacts() 等价；no-artifact/recovery/无 admission cancel 空集 ready，初始 refs 不冒充终态。
  证据：`0bbaa549`（`readRunPublicationReadiness`：seal + prepared tail → 校验 → 重读同一 seal）；S05/S27/S36 绿。
- [ ] 3.3 read/subscribe/re-read 加跨进程有界重读，防丢唤醒；SYN-25：每轮 stat，仅相同 seal/ref/identity/size/mtime/ctime 缓存 hash，变化重验；禁止用 job.status、follow 退出、一个文件存在或内存 flag 推断就绪。
  未完成：跨进程有界重读已实现（S07 绿）；SYN-25 的 stat/identity hash 缓存未实现，`readRunPublicationReadiness` 每次轮询重算 digest（Phase I 设计评审 P3-3，verification 披露）。
- [x] 3.4 实现新 wait timeout JSON、五种 reason（含 admission_incomplete）及 status presence/precedence 表、专用 exit 9；缺文件但 job 已 terminal 时保留真实 status。旧命令 0–8 不重新编号或套用 timeout9。
  证据：`4f0541bc`/`72e0f55e`（timeout envelope、六种 reason 与 status 表、exit 9 仅 wait）；S06/S16/S17/S38 绿。
- [x] 3.5 按 Owner 已选 Q2(a) 实现同步 wrapper 的等待/无执行者/发布失败策略；正常无-key终态必须完整 byte equality，不能通过去掉可见字段让测试过；Q2(a) 本地 publish 失败保留 artifacts:[]+outcome exit，daemon-first bounded error/8 携带 id；区别非 outcome 故障；own-pump pending dispatch promise 豁免 no-progress 窗口，远端 claimant 用 D5 worker evidence；S25/S34 覆盖 45 s completion，terminal-not-published 30 s bound 保留。
  证据：`4f0541bc`（own-pump 豁免、daemon-first D5 证据、本地 publish 失败 `artifacts:[]`+outcome、非 outcome 基线），`84c622ce`；S05/S25/S34 绿。
- [x] 3.6 fault/restart 证明 TICKET-128 残差返回 pending/timeout、不伪造已发布结果；如要主动恢复须先批准 scope，不在 waiter 写第二 publication lifecycle。
  证据：S05（final rename 抛错 → `terminal_artifacts_pending`/9）、S27（每个 staged/rename 故障点非 ready）、S14（publish 故障保留 NULL expiry）绿；无 waiter 写第二 publication。

## 4. 幂等键存储与事务

- [x] 4.1 仅 submit / retry --request parser 加 optional key，create 不新增字段且显式拒绝 key（Q1 #2 validation tightening）；shared normalization 使用 validated normalized consumer ID，redactor 会改变的 ID 拒绝；retry 新 JSON request shape 明确 apiVersion/consumer/key，旧无 body 调用保留；consumer mismatch 在 lookup 前拒绝。
  证据：`72e0f55e`（submit/retry --request 解析 key、create 拒绝、retry body 形状、consumer_mismatch 先于 lookup）；S08/S15/S19 绿。
- [x] 4.2 store additive migration（新 drizzle 编号，不能改 0024）：unique consumer/keyHash、job FK、requestHash/normalizationVersion/createdAt/expiresAt；这不是 queue table。
  证据：`89b68393`（`drizzle/0025_agent_job_idempotency.sql`，additive，0024 未改）。
- [x] 4.3 定义 canonical JSON、alias/default、capability set、provider intent、opaque arrays/schema、internal create-submit 共 intent（public create 无 key）、retry source identity；避免给 key 原文做可持久化 normalization。
  证据：`72e0f55e`（canonical JSON fingerprint、submit/retry 不同 intent、key 不入持久 normalization）；S08/S09 绿。
- [x] 4.4 job+reservation 同 SQLite 事务；并发唯一冲突读回 replay/conflict/pending；不得 query-then-insert 竞态；host creation 写入仍独占 appendExact。
  证据：`0bbaa549`（同一 SQLite 事务，唯一约束输家读回 replay/conflict/pending）；S11 绿。
- [x] 4.5 普通 creation append failure 在既有 queued/no-facts 条件事务同时释放 job/key；补偿失败/崩溃 orphan 只 pending、不可执行、不按超时冒认 dead creator；list/start 改用 D3 同 SQL fact-key+type predicate；pending 保留 exit8/error.code/retryable:true，指南说明 live/orphan 不可区分与新 key 重复风险。
  证据：`0bbaa549`/`72e0f55e`（补偿同事务删除 job+key，orphan 仅 pending，D3 谓词）；S12/S13/S26 绿；指南「Idempotency」披露 live/orphan 不可区分与新 key 重复风险（`d37fa4e5`）。
- [x] 4.6 run-artifacts admission observation key 改为 lifecycle:initial-artifacts:<id>；artifactManifestPath 非 NULL 时 required；只有 reservation winner 且 creation committed 后才 mkdir，loser/rollback 无空目录；初始 artifact admission 尚未完成时不重放 success；失败已有 creation fact 时保留 attempt/key，经 ledger 失败结算，不删除已有事实。
  证据：`0bbaa549`（`lifecycle:initial-artifacts:<id>`，winner-only mkdir，admission 失败经 host settle `artifact_admission_failed`）；S11/S12/S26/S38 绿。
- [x] 4.7 host 经 job-store 一次设 expiresAt：worker/有文件 cancel 在 publish+verification 成功后；artifact-free/recovery/无 initial admission cancel/无 terminal refs 失败在 settle 时；均 +30 天。job-store.cleanupExpiredAgentJobIdempotency 由 submit 同 consumer lookup 前及 daemon tick 全域触发；只删到期 reservation。NULL expiry 保守保留，不虚构 job-delete 路径；compensation FK cascade 保留。
  证据：`0bbaa549`/`72e0f55e`（`recordVerifiedRunRetention` 一次性 +30 天、`cleanupExpiredAgentJobIdempotency` 于 submit 前与 daemon tick），`5615e1f2`（admitted cancel 在 publish 校验后设）；S14/S36/S38 绿。
- [x] 4.8 key 原文从 inputJson/request.json/events/result/diagnostics/log 排除，只存 hash；使用现有 redaction/security owner，secret check 先于 charset/length、Bearer abcdef 同时失败时 secret_in_request 优先，新增错误沿现有 apiVersion+error 形状且不回显敏感输入。
  证据：`72e0f55e`（只存 domain-separated hash，secret 检查先于字符集，错误不回显）；S15 绿。残余：畸形 JSON 正文的解析器消息可能回显片段（Phase I 安全评审 P3-2，verification 披露）。
- [ ] 4.9 迁移/回滚 fixture（tests/fixtures/local-job-api-async/submit-wait/discovery.json#S22）：旧记录不回填 key，停旧 writer 后启用新 feature；SYN-26：停旧 daemon/CLI，以独立 userData path 激活新 schema，旧 binary 固定旧 profile；负例证明旧 build 不理解新 marker，不能声称其自动 fence；正例验证路径/进程隔离。rollback 停写/drain 用隔离 profile，不混写/清空 consumer 数据；共享路径强制 fence 需单独证明并经 Owner 决策。
  未完成：迁移失败/隔离 userData profile/旧 binary 指向新 marker 的负例与回滚夹具未编写（red-receipt §6 S22 子项）；指南「Known limits」已写明同 profile 混跑不受支持。

## 5. 执行者可观测

- [x] 5.1 status top-level execution 在 queued/running 必有、terminal 省略，按 D5 表提供 state/reason/observedAt 与条件 hint；不改 runtime auth readiness、create bytes或 Run 状态。
  证据：`72e0f55e`（`observeRunExecution`，queued/running 必有、终态省略、仅 unavailable 带 hint）；S16/S17 绿。
- [x] 5.2 同 profile 的 lock/nonce 只读观察、alive/dead/unknown 与 api-capability marker；lock v2={pid,nonce,startedAt,lockFormat:2,apiCapable:true,heartbeatAt} 每轮更新且 <=1 s，fresh <=5 s；lockPath 必须存在于 API-capable daemon 配置；旧/stale/EPERM/nonce 变化未知，无锁/ESRCH unavailable，不能将 stale 心跳视为死亡。
  证据：`72e0f55e`（lock v2、≤1000 ms 刷新、nonce 检查、5000 ms fresh），`765b8ea6`（仅持锁 daemon 认领 api）；S17/S28 绿。残余 P3（verification 披露）：心跳临时文件非独占、nonce 检查与 rename 非原子。
- [x] 5.3 复用既有 recovery liveness 与 claim 事实；不新增 executor registry/worker/lease 表；hint 指向 locus daemon run，execution 不增加 PID/hostname/nonce/lock-path/secrets；既有 job.workerPid 保留实际 executor 身份，S03 独立真实进程断言。
  证据：无新 registry/lease 表；`observeRunWorker` 复用 recovery 120 s 窗；S03 真实进程 workerId/workerPid 断言绿。
- [x] 5.4 证实 submit 可在无 executor 时 ack，status/wait 可解释 queued 停滞；queue 操作不自动启动服务；stdio session 的既有 executor 生命周期单独保持。
  证据：S16（无 executor 时 ack、status/wait 可解释）、S29/S30（stdio session executor 生命周期）绿。

## 6. 公共边界（schema / 指南 / discovery，按 C7）

- [x] 6.1 根据 Owner 已选 Q1 固定 locus.local-job.v1 + async-submit；v1.1 已否决，不实现，不 silent downgrade；更新 unsupported-version 精确测试。
  证据：`72e0f55e`（保持 `locus.local-job.v1` + `async-submit`）；S23 绿。
- [x] 6.2 根据 Owner 已选 R2 direct 同改 shared features 和 schema discoveryFeature；保留 pinned-old-schema rejection fixture，不把 unknown-field 忽略等同于 enum 容忍。
  证据：`72e0f55e`（shared features 与 schema `discoveryFeature` 同改）；S22（新 schema 通过、`schema-before.json` 在 enum 处失败）绿。
- [x] 6.3 实施时才修改 docs/local-job-api-v1.schema.json 与英文/中文 consumer guide：命令、requests/envelopes、wait-timeout9、幂等作用域/规范化/TTL、executor 前提、R3 native-home/env 与 caller readiness 边界、R4 平台 abort/EOF/SIGKILL/TerminateProcess 与 500 ms kill、fail-closed code/exit 映射、worker identity、recovery 空 terminal refs、publish baseline/异常、pending/new-key 风险、文件删除后再 pending、升级/失败示例、未知字段规则。
  证据：`d37fa4e5`（中英文指南全部条目），`d813b060`（schema：`submitRequest`、createRequest 拒绝 key；`72e0f55e` 已有 wait/execution/error/retry 定义经实际输出校验），`9f73d96e`（T2：`completionSubmitRequest` 经 `completionRequestMembers` 派生，提交 Ajv 2020 输出/请求一致性测试 `tests/local-job-api-async-schema-envelopes.test.ts`），`39e3446d`/`674ab421`/`43354f87`（T2：R4 信号集合、own-pump 读失败、tick/claim 优先级的指南文字）。
- [x] 6.4 consumer preflight 缺 async-submit 时不 dispatch；默认新 key command shapes 在旧 parser exit2，保留 keyed create silent-drop 反例；按已选 submit/retry-only 收窄 guide:210 并披露 #10；另披露已确认 create reject 的 #2 / idempotency_key_not_supported；引用指南 :209-216 预声明 refresh 与 canonical-run-ledger 先例；no-key v1 流程不增必填字段。
  证据：`d37fa4e5`（guide:210 规则收窄为 submit/retry key 需 `async-submit` preflight，#10；keyed create 旧 build silent-drop 反例；create 拒绝 #2 / `idempotency_key_not_supported`；enum 刷新规则）；S23/S53 绿。
- [x] 6.5 保留 12 types、六字段、dense sequences、after/follow、result/artifact names/refs/digests/retention、profile/provider/completion defaults；新增操作不开放 native union 或 Interaction。
  证据：S21（12 types、六字段、dense、after/follow、result/artifact/digest 逐字节）与 S24 绿。
- [x] 6.6 核对 `docs/tickets/TICKET-127-run-dir-artifacts-windows-stable-directory.md`；说明 Windows artifacts 现有 fail-closed，禁止 path-only workaround；如本切片需它已修复则记录前置，不顺手改 backend。
  证据：TICKET-127 仍 Open；指南「Known limits」说明 Windows 带 `artifacts.baseDir` 的 run fail closed 并留下 `artifact_admission_failed` job（`d37fa4e5`）；本切片不依赖其修复，不改 backend。
- [x] 6.7 记录 Career Kit batch/structured-output、Amadeus Windows 接入事实；Career Kit@6d6a333 的 v1/调用/timeout/kill/env/validator 事实按 proposal §5 保留，当前切片 E2E unknown 如实记录，不做专属协商或 roadmap reordering。
  证据：verification「Consumer evidence ownership」逐项记录 Career Kit@6d6a333 事实与 Amadeus Windows 接入事实，本切片 E2E receipt = unknown。

## 7. Conformance fixtures（测试先行）

下列每组都必须由独立作者依据 delta Scenario/合同先写 bun red tests，再由实施者使其 green；
作者不用实现源码推断断言。每个测试命名带 Sxx，verification 一一挂接 test file/name/receipt。

- [x] 7.1 S01/S02/S24：submit 在 runtime latch 未释放前完整返回、账本 creation 已提交、agent/completion admission gate 与一次 upstream call。
  证据：S01/S02/S24 绿（verification 登记表）。
- [ ] 7.2 S03/S04/S25：旧 create/default retry = 同核 submit+wait 的完整 byte golden、所有终态/0–8、内部 wait 超时不泄漏为 create 响应；只按 1.6 prune + closure re-check 后的 approved exact SHA 编写 S34/S35 选定分支、publish 故障和 R4 平台 abort/EOF/kill oracle，不为未选分支生成实施验收；own-pump/daemon-first 45 s completion、D5 存活证据及基线非 outcome stderr/exits 均覆盖。
  PARTIAL（T2 起按 tasks:6 规则取消勾选）：S03（含真实进程）/S04/S25/S34/S35 绿；T2 增加 POSIX `SIGHUP` 中继（进程内 + 真实进程）、win32 `SIGBREAK`/`SIGHUP` 平台门控测试（`tests/local-job-api-wrapper-relay-signals.test.ts`）与 own-pump 读失败基线（`tests/local-job-api-wrapper-observation-fault.test.ts`）。开放子项：S35 Windows abort 矩阵（Ctrl+C/Ctrl+Break/console 关闭/`child.kill()`/`TerminateProcess` 真实回执，无 Windows 主机，win32 测试在本机跳过）；S35 POSIX 带真实孙进程的进程组 kill。
- [ ] 7.3 S05/S06/S07：commit 前、publish 中、完成时、deadline/0/default/非法 timeout、多个 waiter/失去通知、late diagnostics。
  PARTIAL：S05/S06/S07 绿。开放子项：S07 waiter 初次读与 wakeup 注册之间提交落地的 read/wakeup-registration latch（无该 latch seam）。
- [ ] 7.4 S08/S09/S10/S11：规范化 replay、语义 conflict、consumer 隔离、跨进程唯一 reservation 和零重复执行。
  PARTIAL：S08–S11 绿。开放子项：S11「creation committed、initial admission pending」的真实并发交错（该状态本身由 S14/S38 覆盖）。
- [x] 7.5 S12/S13/S14/S15：事务 rollback 与补偿释放、kill/补偿失败/pending creator、保留期与清理、raw-key 禁落盘/泄漏。
  证据：S12–S15 绿。
- [ ] 7.6 S16/S17：无 executor structured status、stale/dead/legacy/EPERM/nonce-swap、auth readiness 不被混淆，Workbench 读同一 queued job。
  PARTIAL：S16/S17 绿。开放子项：S17 reader 侧两次读之间 nonce A→B（writer 侧 successor 已覆盖）。
- [ ] 7.7 S18/S19/S20：queued cancel、claim race、running cancel、retry 幂等/new identity、parent 不变、non-API 与不可 retry 状态拒绝。
  PARTIAL：S18/S19/S20 绿，另 `tests/local-job-api-queued-cancel-terminal.test.ts` 覆盖 cancel/cancel 竞争。开放子项：S18 slow-cancel 准备与立即失败的 claimant 竞争。
- [x] 7.8 S21/S22/S23：既有 v1 请求字段保留、显式 keyed-create 拒绝披露、12-type/六字段/after/follow/artifacts、闭 enum 前后 schema、missing feature/version fail closed。
  证据：S21/S22/S23 绿；S22 的迁移失败/隔离 profile/旧 binary 负例子项属 4.9，未完成。
- [ ] 7.9 S26/S27/S31：统一 creation predicate、初始 artifact gate；S36 recovery 空 refs、S37 真跨进程重开发布、S38 admission 边界崩溃取消；每个 staged/commit/rename 边界故障重开、目录替换、schedule 不多 fire。
  PARTIAL：S26/S27/S31/S36/S37/S38 绿。开放子项：S27 每个 staged 写入之后（不止最后一个）的故障点；S37 create/default-retry wrapper 在 admission 后暂停（`beforeOwnPumpClaim`）的变体。
- [ ] 7.10 S28/S29/S30：daemon source eligibility/claim/concurrency/lock、stdio 同核 response/event、session cancel/shutdown/EOF、无外部 daemon；S39 claim revalidation/age、S40 env provenance。
  PARTIAL：S28/S29/S30/S39/S40 绿；T2 增加超龄 tick 非竞争错误诊断与排除（`tests/local-job-api-over-age-tick-diagnostics.test.ts`）。开放子项：S39 wrapper-paused 变体；S40 跨进程 probing readiness 与 win32 allowlist（无 Windows 主机）。
- [x] 7.11 S32/S33：clean/负例结构守卫与 self-test，旧内联 runner、重复 owner/row insert、host 外 appendExact 必须被拒绝。
  证据：S32/S33 绿（守卫自测 17/17，变异夹具按 case id 失败）。
- [x] 7.12 S41–S54 保留每条 living assertion；S42/S46/S48/S51 是 modified-inherited，增加与 MODIFIED requirement 一致的 assertions（S48 将 shared runner core 表述细化为同核 submit/pump）；S53 恢复原 consumer rule 并增加 helper documentation example 行；标题不变。
  证据：S41–S54 登记（S43/S45/S47/S52/S54 为 registered-existing，S52/S53/S54 映射 projection 测试旧编号 S53/S54/S55）全部 pass。

### Named fixture contract（未来 red author 创建，本次不写 tests/）

所有数据文件都在 `tests/fixtures/local-job-api-async/`，以 Sxx 为顶层 case key；每个 case 包含 input、clock/IDs、持久 rows/events/files、fault/latch 序列、expected stdout/stderr/exit/DB/FS/provider-count。Baseline oracle 与 pinned schema/parser 从产品源码 `2c59664f`（不是 docs-only b26c0651）采集并记录摘要，implementation base SHA 另记 1.2；不能由新实现自动生成再自证。以下 neutral helper 也只在未来测试目录创建：`consumer-preflight.ts`（仅作 documentation example：消费 features 并返回 unsupported / 调 dispatch，其 spy 不能证明 Locus parser 行为）、`process-harness.ts`（真实进程、latch、signal/EOF），不成为 SDK。

| 文件 | Scenario IDs |
| --- | --- |
| `public-submission.json` | S01, S02, S24 |
| `terminal-bytes.json` | S03, S04, S25, S34 |
| `publication.json` | S05, S07, S27, S36, S37 |
| `wait-observation.json` | S06, S16, S17 |
| `idempotency.json` | S08, S09, S10, S11, S12, S13, S14, S15, S38 |
| `controls.json` | S18, S19, S20, S35 |
| `public-v1.json` | S21 |
| `discovery.json` | S22, S23, S52, S53, S54 |
| `admission.json` | S26, S39 |
| `queue.json` | S28, S41, S42, S43, S44, S45, S46 |
| `stdio.json` | S29, S30, S47, S48, S49, S50, S51 |
| `schedule.json` | S31 |
| `architecture-fixtures.json` | S32, S33 |
| `environment.json` | S40 |

`terminal-bytes.json` 固定的 workerId/workerPid 仅用于可重现 byte oracle，另有不注入的真实 claimant 断言；`discovery.json` 记录两版 schema 摘要和 baseline CLI parser 版本，基线 schema/data 副本也落同一 fixture 目录（`schema-before.json` / `schema-after.json`）；用 `git show 2c59664f:src/main/lib/headless/cli-args.ts` 固定 `cli-args-before.ts` 并由测试 harness 直接调用以证明 old-parser shape rejection，不能以 helper spy 代替；preflight fixture 仅为可执行 documentation example。`publication.json` 记录 registered initial refs、prepared-tail refs、每次 stage/rename 故障点及真实进程边界；`environment.json` 只使用人工非 secret sentinel，不使用真实凭据。S41–S54 保留每条 living assertion 并补入口夹具；S42/S46/S48/S51 明列 modified-inherited 的一致性补充，S53 原 consumer obligation 逐字保留并附 helper documentation example。

## 8. 验证 / 评审 / 停止门

- [ ] 8.1 所有 S01–S54 登记、red→green evidence 齐全；targeted bun、architecture guard、migration/rollback、secret/fault suites 实际执行。
  未完成：S01–S54 登记与 red→green 证据已齐（verification），但 4.9 迁移/回滚夹具与 red-receipt §6 未覆盖子项仍开放。
- [x] 8.2 在冻结的精确 source SHA 跑 `bun run check:full`、本 change 与全量 strict OpenSpec、`git diff --check`；记录命令/exit/count/log，不能把环境失败算 pass。
  证据：`bun run check:full` 在候选父提交 `bbcc0995` 的树上 exit 0（2864/2864、strict 54/54、build、diff:check）；候选提交上复跑 strict 54/54、`git diff --check`、PR-base lint 与四个红文件 79/79（verification「Gates」，handoff 报告记录候选 SHA）。
- [ ] 8.3 disposable-profile 手工及 packaged smoke：submit 后 submitter 退出仍可被 daemon 执行；agent/completion wait/result；queued cancel/cancel；retry key；daemon death→recovery→wait；真实 cross-process publish；env sentinel；stdio session shutdown；Workbench 可见。macOS/Windows 分别记录，WSL 不代替 packaged 证据。
  未完成：本 WSL 主机 Electron 缺共享库（exit 127）、无 bundled runtimes/凭据、无 macOS/Windows 主机；见 verification smoke 矩阵与重跑命令。
- [ ] 8.4 Windows 有/无 artifacts 分开验收；TICKET-127 未修复时 artifact fixture 预期 fail closed，不宣称已交付 Windows artifact refs。TICKET-128 部分发布预期 non-ready，不算恢复成功。
  未完成：无 Windows 主机。
- [ ] 8.5 Codex `IMPLEMENTATION_VERIFIED` 与 fresh-context Claude Code `REVIEW_APPROVED` 必须绑定同一精确 source SHA；代码再改则两者失效；独立 security review 覆盖 key scope、reopen/receipts/staging、claim revalidation、R3 env/R4 abort、lock 观察与回滚。
  未完成：Codex IMPLEMENTATION_VERIFIED 与 fresh-context Claude REVIEW_APPROVED 需绑定同一冻结候选 SHA；当前均未签发。
- [ ] 8.6 汇总 consumer-neutral fixtures 与已知 consumer receipts/unknown，记录未覆盖平台、TICKET-128 residual、R1–R4 升级影响，提交统筹代行产品验收；开放 Red 回 Owner。
  未完成：verification 已汇总 consumer-neutral 证据、unknown receipts、未覆盖平台与 TICKET-128 残余；提交统筹代行验收待 8.5。
- [ ] 8.7 **ACCEPTED 停止门（Owner 2026-10-02 授权自我迭代）**：Codex IMPLEMENTATION_VERIFIED + fresh-context Claude REVIEW_APPROVED 同 source SHA、无开放 Red 时，由统筹代行 ACCEPTED；只有红灯项回 Owner。未记录 ACCEPTED 不宣称产品接受，不归档；本次派单不授权 merge。将来的本地集成须另获授权并验证 merge SHA。
  未完成：待 8.5 双标记绑定同一 SHA 且无开放 Red 后由统筹按 Owner 2026-10-02 自我迭代授权代行 ACCEPTED。
- [ ] 8.8 **Push 未授权**：push、远程 PR 创建/修改、remote merge、release、规则更改一律 not authorized / not performed；本地提交不隐含远程权限。
  保持：本次派单未授权也未执行任何 push/PR/merge/release/规则变更。
