# Implementation tasks

Status: **DRAFT — awaiting Owner APPROVED**

本清单全部是未来实施任务；本次纯文档起草不勾选。虽然 conformance 列在第 7 节，
**执行顺序必须是 1 → 7 的独立 red fixtures → 2–6 → 7 green → 8**。
未获 Owner APPROVED 不写 src/tests/docs/schema/migration；R1–R4 和 Q1–Q6 不得由实施者自行裁定。

## 1. 治理与基线

- [ ] 1.1 核对 proposal/design/deltas 的精确 SHA，收齐 Owner APPROVED、十节 Consumer Impact 第 10 节的 R1–R4 选择和 Q1–Q6 答案；无论是否接受全部默认，均执行 1.6 prune，记录其 closure re-check 后的 SHA 为 approved exact scope，再开始 red tests。
- [ ] 1.2 记录独立 implementation worktree/base SHA、当前 product data lifecycle stage、active overlap 和各 owner；重新核对刚归档 ledger 与 TICKET-128 状态，不把本 draft 作为实现批准。
- [ ] 1.3 明确本切片只补 ack/claim/publication-read 安全，或按 Q4 等待 TICKET-128 独立前置修复；禁止未评审地把全量创建/发布状态机塞入本 change。
- [ ] 1.4 基线采集旧 v1 create/retry 的完整 stdout/exit golden（agent、completion、所有终态与 0–8 特殊错误），固定 ID/时钟/worker identity/路径；记录 stderr-only 错误与现有结构错误的真实区别；增加本地 non-outcome failure goldens：create 的 localJobApiCreateErrorCode 默认 2、message 匹配 /unsupported/i 时 3，retry 3，保留原 stderr text、stop execution tree、不伪造 terminal、admitted-not-started queued-cancel cleanup。另采集 POSIX SIGINT/SIGTERM/SIGKILL、Windows console Ctrl/parent child.kill()/TerminateProcess、open-pipe EOF/ignored stdin 的 abort receipts（child alive/dead、row status、recovery outcome），包含 Career Kit 500 ms kill grace 截短 ack wait。
- [ ] 1.5 为独立测试作者提供下列纯合同 seams：submitRun、waitForRun、readRunPublicationReadiness、clock/ID/真实 worker identity、reopenAdmittedRunDir/receipt verification、cleanupExpiredAgentJobIdempotency、claim latch、SQL commit/compensation fault、creation→initial-admission crash、read/wakeup-registration latch（S07）、artifact write/rename fault、executor liveness/lock v2 ports、multi-process spawn/kill ports；仅接口和 fixtures，不先写生产实现。

- [ ] 1.6 Owner 决定 R1–R4、Q1–Q6 后，将 deltas 改为仅保留选定分支的无条件 SHALL；备选移到 design.md Open questions（history）。删除 specs 内全部“统筹预设/pending/conditional”决策措辞（尤其 headless 的 R3、local-job-api 的 Q2/R4/Discovery R2），S34/S35 裁剪到选定分支；即使全部接受默认也必须执行。重跑 strict validate，取得一次简短 closure re-check，在 1.1 记录 resulting SHA 为 approved exact scope；不得将待决或互斥分支带入 red tests、实施或 living archive。

## 2. Submit 核心与 wrapper

- [ ] 2.1 在 headless/run-submission.ts 实现唯一 submit 编排，API agent/completion、retry intent、stdio 进入相同 owner；共享类型只解析/normalize，不拥有 DB/dispatch。
- [ ] 2.2 local-job-api create/retry 变薄 adapter；job-store create/retry 统一 row insertion，schedule 的重复 createScheduleJobRecord 改用该 primitive 且保留 schedule fire/audit 原事务；无旧内部 alias/双业务路径。
- [ ] 2.3 creation fact 和必要初始 artifact admission 完成后才 fresh/replay ack；快 worker 下的 queued admission snapshot 不伪装成最新状态；所有资源 handle 在提交进程关闭。
- [ ] 2.4 删除 cli-dispatcher 的 runPreparedLocalJobApiJob 及 API create/retry runner 直调；迁移其 agent/completion dispatch、terminal artifact composition 到既有 executor，保留序列化字节/换行和 exit mapping；Q2(a) wrapper 与 stdio 同调 pumpQueuedRuns({admittedIds})，不直接 runner；按 1.6 收敛后的 R4 实现平台 catchable abort/armed EOF own cancel（仅 admission 时 open pipe 随后关闭，不重放正文 EOF），signal cleanup re-raise 原 signal，披露 POSIX SIGKILL/Windows TerminateProcess 残余。
- [ ] 2.5 既有 daemon queue 增加 api source 和 completion kind；claim/并发/lock nonce 复用原 owner，普通 daemon 仍不认领 desktop/default cli/protocol；API executor 调 run-artifacts.reopenAdmittedRunDir 校验 committed refs、single-link receipts、root/base containment；加入 RunLocalAgentDaemonOptions 的 providerBindingDependencies / completionFetch / appVersion / env / clock / ID / maxQueuedApiAgeMs 注入 seams；age 是 internal daemon/pump option、常量 MAX_QUEUED_API_AGE_MS 默认 86400000 ms，不是 runtime 用户配置；API claim 前复核 project/cwd/profile/grant/age（24 h 默认），失败经 host settle，completed.payload.reasons / job.errorCode / failed / outcome exit 按 headless projection table（7/7/binding 4,2,6 else 3/1/1）测试。 completion-runner 在 daemon 认领下按既有 heartbeat 节奏写 heartbeatAt（闭合检查残余 (1)）。
- [ ] 2.6 jobs-stdio job.run 删除独立 create+runner 编排，使用同 submit 与既有 pump 的 session-scoped mode；initialize/job/event/job.cancel/shutdown/EOF 外形、取消范围及 drain 行为不变；不需要外部 daemon。
- [ ] 2.7 queued API cancel 从持久输入组合同一 terminal projection 后交既有 cancelAgentJob/host settle；不能依赖 worker 先注册 preparer；missing-admission cancel 与 recovery 不登记 terminal refs、ready 空集；recovery 保留原 prologue；process+attempt 唯一 staging，cancel/cancel 与 slow-cancel/failing-claim 输家只丢自己的 staging，不造第二 completed。
- [ ] 2.8 OWNERSHIP_MAP 新增提交/wait owner 行及 queue/publisher-read 消费方映射；增加 S32/S33 结构守卫与 self-test，证明旧路径删除且唯一 appendExact importer 不变。

## 3. Wait 与超时

- [ ] 3.1 实现 `runs wait`，默认 30000 ms、0–86400000 整数、monotonic deadline、deadline 最终读优先；wait 只读，不取消或更新 TTL。
- [ ] 3.2 host 组合同一 run-artifacts publication-read port：read seal+prepared tail → safe handle 验该 terminal commit refs → recheck same seal；序列化 prepared tail 无 sequence、与 terminal.artifacts() 等价；no-artifact/recovery/无 admission cancel 空集 ready，初始 refs 不冒充终态。
- [ ] 3.3 read/subscribe/re-read 加跨进程有界重读，防丢唤醒；SYN-25：每轮 stat，仅相同 seal/ref/identity/size/mtime/ctime 缓存 hash，变化重验；禁止用 job.status、follow 退出、一个文件存在或内存 flag 推断就绪。
- [ ] 3.4 实现新 wait timeout JSON、五种 reason（含 admission_incomplete）及 status presence/precedence 表、专用 exit 9；缺文件但 job 已 terminal 时保留真实 status。旧命令 0–8 不重新编号或套用 timeout9。
- [ ] 3.5 按 Owner Q2 决定实现同步 wrapper 的等待/无执行者/发布失败策略；正常无-key终态必须完整 byte equality，不能通过去掉可见字段让测试过；Q2(a) 本地 publish 失败保留 artifacts:[]+outcome exit，daemon-first/(b)/(c) bounded error/8 携带 id；区别非 outcome 故障；own-pump pending dispatch promise 豁免 no-progress 窗口，远端 claimant 用 D5 worker evidence；S25/S34 覆盖 45 s completion，terminal-not-published 30 s bound 保留。
- [ ] 3.6 fault/restart 证明 TICKET-128 残差返回 pending/timeout、不伪造已发布结果；如要主动恢复须先批准 scope，不在 waiter 写第二 publication lifecycle。

## 4. 幂等键存储与事务

- [ ] 4.1 仅 submit / retry --request parser 加 optional key，create 不新增字段且显式拒绝 key（Q1 #2 validation tightening）；shared normalization 使用 validated normalized consumer ID，redactor 会改变的 ID 拒绝；retry 新 JSON request shape 明确 apiVersion/consumer/key，旧无 body 调用保留；consumer mismatch 在 lookup 前拒绝。
- [ ] 4.2 store additive migration（新 drizzle 编号，不能改 0024）：unique consumer/keyHash、job FK、requestHash/normalizationVersion/createdAt/expiresAt；这不是 queue table。
- [ ] 4.3 定义 canonical JSON、alias/default、capability set、provider intent、opaque arrays/schema、internal create-submit 共 intent（public create 无 key）、retry source identity；避免给 key 原文做可持久化 normalization。
- [ ] 4.4 job+reservation 同 SQLite 事务；并发唯一冲突读回 replay/conflict/pending；不得 query-then-insert 竞态；host creation 写入仍独占 appendExact。
- [ ] 4.5 普通 creation append failure 在既有 queued/no-facts 条件事务同时释放 job/key；补偿失败/崩溃 orphan 只 pending、不可执行、不按超时冒认 dead creator；list/start 改用 D3 同 SQL fact-key+type predicate；pending 保留 exit8/error.code/retryable:true，指南说明 live/orphan 不可区分与新 key 重复风险。
- [ ] 4.6 run-artifacts admission observation key 改为 lifecycle:initial-artifacts:<id>；artifactManifestPath 非 NULL 时 required；只有 reservation winner 且 creation committed 后才 mkdir，loser/rollback 无空目录；初始 artifact admission 尚未完成时不重放 success；失败已有 creation fact 时保留 attempt/key，经 ledger 失败结算，不删除已有事实。
- [ ] 4.7 host 经 job-store 一次设 expiresAt：worker/有文件 cancel 在 publish+verification 成功后；artifact-free/recovery/无 initial admission cancel/无 terminal refs 失败在 settle 时；均 +30 天。job-store.cleanupExpiredAgentJobIdempotency 由 submit 同 consumer lookup 前及 daemon tick 全域触发；只删到期 reservation。NULL expiry 保守保留，不虚构 job-delete 路径；compensation FK cascade 保留。
- [ ] 4.8 key 原文从 inputJson/request.json/events/result/diagnostics/log 排除，只存 hash；使用现有 redaction/security owner，secret check 先于 charset/length、Bearer abcdef 同时失败时 secret_in_request 优先，新增错误沿现有 apiVersion+error 形状且不回显敏感输入。
- [ ] 4.9 迁移/回滚 fixture（tests/fixtures/local-job-api-async/discovery.json#S22）：旧记录不回填 key，停旧 writer 后启用新 feature；SYN-26：停旧 daemon/CLI，以独立 userData path 激活新 schema，旧 binary 固定旧 profile；负例证明旧 build 不理解新 marker，不能声称其自动 fence；正例验证路径/进程隔离。rollback 停写/drain 用隔离 profile，不混写/清空 consumer 数据；共享路径强制 fence 需单独证明并经 Owner 决策。

## 5. 执行者可观测

- [ ] 5.1 status top-level execution 在 queued/running 必有、terminal 省略，按 D5 表提供 state/reason/observedAt 与条件 hint；不改 runtime auth readiness、create bytes或 Run 状态。
- [ ] 5.2 同 profile 的 lock/nonce 只读观察、alive/dead/unknown 与 api-capability marker；lock v2={pid,nonce,startedAt,lockFormat:2,apiCapable:true,heartbeatAt} 每轮更新且 <=1 s，fresh <=5 s；lockPath 必须存在于 API-capable daemon 配置；旧/stale/EPERM/nonce 变化未知，无锁/ESRCH unavailable，不能将 stale 心跳视为死亡。
- [ ] 5.3 复用既有 recovery liveness 与 claim 事实；不新增 executor registry/worker/lease 表；hint 指向 locus daemon run，execution 不增加 PID/hostname/nonce/lock-path/secrets；既有 job.workerPid 保留实际 executor 身份，S03 独立真实进程断言。
- [ ] 5.4 证实 submit 可在无 executor 时 ack，status/wait 可解释 queued 停滞；queue 操作不自动启动服务；stdio session 的既有 executor 生命周期单独保持。

## 6. 公共边界（schema / 指南 / discovery，按 C7）

- [ ] 6.1 根据 Owner Q1 固定 wire version；推荐保持 locus.local-job.v1，未批准前不得接受 v1.1 或 silent downgrade；更新 unsupported-version 精确测试。
- [ ] 6.2 根据 Owner R2 同改 shared features 和 schema discoveryFeature；保留 pinned-old-schema rejection fixture，不把 unknown-field 忽略等同于 enum 容忍。
- [ ] 6.3 实施时才修改 docs/local-job-api-v1.schema.json 与英文/中文 consumer guide：命令、requests/envelopes、wait-timeout9、幂等作用域/规范化/TTL、executor 前提、R3 native-home/env 与 caller readiness 边界、R4 平台 abort/EOF/SIGKILL/TerminateProcess 与 500 ms kill、fail-closed code/exit 映射、worker identity、recovery 空 terminal refs、publish baseline/异常、pending/new-key 风险、文件删除后再 pending、升级/失败示例、未知字段规则。
- [ ] 6.4 consumer preflight 缺 async-submit 时不 dispatch；默认新 key command shapes 在旧 parser exit2，保留 keyed create silent-drop 反例；无论推荐 submit/retry-only 还是备选 keyed create 均收窄 guide:210 并披露 #10；另披露推荐 create reject 的 #2 / idempotency_key_not_supported；引用指南 :209-216 预声明 refresh 与 canonical-run-ledger 先例；no-key v1 流程不增必填字段。
- [ ] 6.5 保留 12 types、六字段、dense sequences、after/follow、result/artifact names/refs/digests/retention、profile/provider/completion defaults；新增操作不开放 native union 或 Interaction。
- [ ] 6.6 核对 `docs/tickets/TICKET-127-run-dir-artifacts-windows-stable-directory.md`；说明 Windows artifacts 现有 fail-closed，禁止 path-only workaround；如本切片需它已修复则记录前置，不顺手改 backend。
- [ ] 6.7 记录 Career Kit batch/structured-output、Amadeus Windows 接入事实；Career Kit@6d6a333 的 v1/调用/timeout/kill/env/validator 事实按 proposal §5 保留，当前切片 E2E unknown 如实记录，不做专属协商或 roadmap reordering。

## 7. Conformance fixtures（测试先行）

下列每组都必须由独立作者依据 delta Scenario/合同先写 bun red tests，再由实施者使其 green；
作者不用实现源码推断断言。每个测试命名带 Sxx，verification 一一挂接 test file/name/receipt。

- [ ] 7.1 S01/S02/S24：submit 在 runtime latch 未释放前完整返回、账本 creation 已提交、agent/completion admission gate 与一次 upstream call。
- [ ] 7.2 S03/S04/S25：旧 create/default retry = 同核 submit+wait 的完整 byte golden、所有终态/0–8、内部 wait 超时不泄漏为 create 响应；只按 1.6 prune + closure re-check 后的 approved exact SHA 编写 S34/S35 选定分支、publish 故障和 R4 平台 abort/EOF/kill oracle，不为未选分支生成实施验收；own-pump/daemon-first 45 s completion、D5 存活证据及基线非 outcome stderr/exits 均覆盖。
- [ ] 7.3 S05/S06/S07：commit 前、publish 中、完成时、deadline/0/default/非法 timeout、多个 waiter/失去通知、late diagnostics。
- [ ] 7.4 S08/S09/S10/S11：规范化 replay、语义 conflict、consumer 隔离、跨进程唯一 reservation 和零重复执行。
- [ ] 7.5 S12/S13/S14/S15：事务 rollback 与补偿释放、kill/补偿失败/pending creator、保留期与清理、raw-key 禁落盘/泄漏。
- [ ] 7.6 S16/S17：无 executor structured status、stale/dead/legacy/EPERM/nonce-swap、auth readiness 不被混淆，Workbench 读同一 queued job。
- [ ] 7.7 S18/S19/S20：queued cancel、claim race、running cancel、retry 幂等/new identity、parent 不变、non-API 与不可 retry 状态拒绝。
- [ ] 7.8 S21/S22/S23：既有 v1 请求字段保留、显式 keyed-create 拒绝披露、12-type/六字段/after/follow/artifacts、闭 enum 前后 schema、missing feature/version fail closed。
- [ ] 7.9 S26/S27/S31：统一 creation predicate、初始 artifact gate；S36 recovery 空 refs、S37 真跨进程重开发布、S38 admission 边界崩溃取消；每个 staged/commit/rename 边界故障重开、目录替换、schedule 不多 fire。
- [ ] 7.10 S28/S29/S30：daemon source eligibility/claim/concurrency/lock、stdio 同核 response/event、session cancel/shutdown/EOF、无外部 daemon；S39 claim revalidation/age、S40 env provenance。
- [ ] 7.11 S32/S33：clean/负例结构守卫与 self-test，旧内联 runner、重复 owner/row insert、host 外 appendExact 必须被拒绝。
- [ ] 7.12 S41–S54 保留每条 living assertion；S42/S46/S48/S51 是 modified-inherited，增加与 MODIFIED requirement 一致的 assertions（S48 将 shared runner core 表述细化为同核 submit/pump）；S53 恢复原 consumer rule 并增加 helper documentation example 行；标题不变。

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
- [ ] 8.2 在冻结的精确 source SHA 跑 `bun run check:full`、本 change 与全量 strict OpenSpec、`git diff --check`；记录命令/exit/count/log，不能把环境失败算 pass。
- [ ] 8.3 disposable-profile 手工及 packaged smoke：submit 后 submitter 退出仍可被 daemon 执行；agent/completion wait/result；queued cancel/cancel；retry key；daemon death→recovery→wait；真实 cross-process publish；env sentinel；stdio session shutdown；Workbench 可见。macOS/Windows 分别记录，WSL 不代替 packaged 证据。
- [ ] 8.4 Windows 有/无 artifacts 分开验收；TICKET-127 未修复时 artifact fixture 预期 fail closed，不宣称已交付 Windows artifact refs。TICKET-128 部分发布预期 non-ready，不算恢复成功。
- [ ] 8.5 Codex `IMPLEMENTATION_VERIFIED` 与 fresh-context Claude Code `REVIEW_APPROVED` 必须绑定同一精确 source SHA；代码再改则两者失效；独立 security review 覆盖 key scope、reopen/receipts/staging、claim revalidation、R3 env/R4 abort、lock 观察与回滚。
- [ ] 8.6 汇总 consumer-neutral fixtures 与已知 consumer receipts/unknown，记录未覆盖平台、TICKET-128 residual、R1–R4 升级影响，提交 Owner 产品验收。
- [ ] 8.7 **Owner ACCEPTED 停止门**：未有明确 ACCEPTED 不宣称产品接受，不归档；本次派单不授权 merge。将来的本地集成须另获授权并验证 merge SHA。
- [ ] 8.8 **Push 未授权**：push、远程 PR 创建/修改、remote merge、release、规则更改一律 not authorized / not performed；本地提交不隐含远程权限。
