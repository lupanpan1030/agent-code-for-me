# Implementation tasks

Status: **DRAFT — awaiting Owner APPROVED**

本清单全部是未来实施任务；本次纯文档起草不勾选。虽然 conformance 列在第 7 节，
**执行顺序必须是 1 → 7 的独立 red fixtures → 2–6 → 7 green → 8**。
未获 Owner APPROVED 不写 src/tests/docs/schema/migration；R1/R2 和 Q1–Q6 不得由实施者自行裁定。

## 1. 治理与基线

- [ ] 1.1 核对 proposal/design/deltas 的精确 SHA，收齐 Owner APPROVED、十节 Consumer Impact 第 10 节的 R1/R2 选择和 Q1–Q6 答案；若答案改变合同先同步草案再 red tests。
- [ ] 1.2 记录独立 implementation worktree/base SHA、当前 product data lifecycle stage、active overlap 和各 owner；重新核对刚归档 ledger 与 TICKET-128 状态，不把本 draft 作为实现批准。
- [ ] 1.3 明确本切片只补 ack/claim/publication-read 安全，或按 Q4 等待 TICKET-128 独立前置修复；禁止未评审地把全量创建/发布状态机塞入本 change。
- [ ] 1.4 基线采集旧 v1 create/retry 的完整 stdout/exit golden（agent、completion、所有终态与 0–8 特殊错误），固定 ID/时钟/worker identity/路径；记录 stderr-only 错误与现有结构错误的真实区别。
- [ ] 1.5 为独立测试作者提供下列纯合同 seams：submitRun、waitForRun、readRunPublicationReadiness、clock/ID、claim latch、SQL commit/compensation fault、artifact write/rename fault、executor liveness ports；仅接口和 fixtures，不先写生产实现。

## 2. Submit 核心与 wrapper

- [ ] 2.1 在 headless/run-submission.ts 实现唯一 submit 编排，API agent/completion、retry intent、stdio 进入相同 owner；共享类型只解析/normalize，不拥有 DB/dispatch。
- [ ] 2.2 local-job-api create/retry 变薄 adapter；job-store create/retry 统一 row insertion，schedule 的重复 createScheduleJobRecord 改用该 primitive 且保留 schedule fire/audit 原事务；无旧内部 alias/双业务路径。
- [ ] 2.3 creation fact 和必要初始 artifact admission 完成后才 fresh/replay ack；快 worker 下的 queued admission snapshot 不伪装成最新状态；所有资源 handle 在提交进程关闭。
- [ ] 2.4 删除 cli-dispatcher 的 runPreparedLocalJobApiJob 及 API create/retry runner 直调；迁移其 agent/completion dispatch、terminal artifact composition 到既有 executor，保留序列化字节/换行和 exit mapping。
- [ ] 2.5 既有 daemon queue 增加 api source 和 completion kind；claim/并发/lock nonce 复用原 owner，普通 daemon 仍不认领 desktop/default cli/protocol；API executor 安全 reopen admitted run-dir。
- [ ] 2.6 jobs-stdio job.run 删除独立 create+runner 编排，使用同 submit 与既有 pump 的 session-scoped mode；initialize/job/event/job.cancel/shutdown/EOF 外形、取消范围及 drain 行为不变；不需要外部 daemon。
- [ ] 2.7 queued API cancel 从持久输入组合同一 terminal projection 后交既有 cancelAgentJob/host settle；不能依赖 worker 先注册 preparer；start/cancel race 不 spawn 输家、不造第二 completed。
- [ ] 2.8 OWNERSHIP_MAP 新增提交/wait owner 行及 queue/publisher-read 消费方映射；增加 S32/S33 结构守卫与 self-test，证明旧路径删除且唯一 appendExact importer 不变。

## 3. Wait 与超时

- [ ] 3.1 实现 `runs wait`，默认 30000 ms、0–86400000 整数、monotonic deadline、deadline 最终读优先；wait 只读，不取消或更新 TTL。
- [ ] 3.2 host 组合同一 run-artifacts publication-read port：read seal+refs → safe handle 验全部 terminal 文件/digest/size → recheck same seal；no-artifact/completion 的发布条件为空真。
- [ ] 3.3 read/subscribe/re-read 加跨进程有界重读，防丢唤醒；禁止用 job.status、follow 退出、一个文件存在或内存 flag 推断就绪。
- [ ] 3.4 实现新 wait timeout JSON、四种 reason、专用 exit 9；缺文件但 job 已 terminal 时保留真实 status。旧命令 0–8 不重新编号或套用 timeout9。
- [ ] 3.5 按 Owner Q2 决定实现同步 wrapper 的等待/无执行者/发布失败策略；正常无-key终态必须完整 byte equality，不能通过去掉可见字段让测试过。
- [ ] 3.6 fault/restart 证明 TICKET-128 残差返回 pending/timeout、不伪造已发布结果；如要主动恢复须先批准 scope，不在 waiter 写第二 publication lifecycle。

## 4. 幂等键存储与事务

- [ ] 4.1 shared normalization 加 optional key；retry 新 JSON request shape 明确 apiVersion/consumer/key，旧无 body 调用保留；consumer mismatch 在 lookup 前拒绝。
- [ ] 4.2 store additive migration（新 drizzle 编号，不能改 0024）：unique consumer/keyHash、job FK、requestHash/normalizationVersion/createdAt/expiresAt；这不是 queue table。
- [ ] 4.3 定义 canonical JSON、alias/default、capability set、provider intent、opaque arrays/schema、create-submit 共 intent、retry source identity；避免给 key 原文做可持久化 normalization。
- [ ] 4.4 job+reservation 同 SQLite 事务；并发唯一冲突读回 replay/conflict/pending；不得 query-then-insert 竞态；host creation 写入仍独占 appendExact。
- [ ] 4.5 普通 creation append failure 在既有 queued/no-facts 条件事务同时释放 job/key；补偿失败/崩溃 orphan 只 pending、不可执行、不按超时冒认 dead creator；list/start 改用同 fact-key+type predicate。
- [ ] 4.6 初始 artifact admission 尚未完成时不重放 success；失败已有 creation fact 时保留 attempt/key，经 ledger 失败结算，不删除已有事实。
- [ ] 4.7 publication owner 一次设定 expiresAt（建议 publication+30 天），terminal-ready 才可清理 reservation；未终态/unpublished/orphan 不自动过期；replay 不续期，不删 artifacts/job history。
- [ ] 4.8 key 原文从 inputJson/request.json/events/result/diagnostics/log 排除，只存 hash；使用现有 redaction/security owner，新增错误沿现有 apiVersion+error 形状且不回显敏感输入。
- [ ] 4.9 迁移/回滚 fixture：旧记录不回填 key，停旧 writer 后启用新 feature；rollback 停写/drain 并用隔离 profile，不混用两个版本，不清空 consumer 数据。

## 5. 执行者可观测

- [ ] 5.1 status top-level optional execution 提供 available/unavailable/unknown、reason/observedAt/hint；不改 runtime auth readiness、create bytes或 Run 状态。
- [ ] 5.2 同 profile 的 lock/nonce 只读观察、alive/dead/unknown 与 api-capability marker；旧 lock/EPERM/identity 不确定为 unknown，不能将 stale 心跳视为已死亡。
- [ ] 5.3 复用既有 recovery liveness 与 claim 事实；不新增 executor registry/worker/lease 表；hint 指向 locus daemon run，不输出 PID/hostname/nonce/lock-path/secrets。
- [ ] 5.4 证实 submit 可在无 executor 时 ack，status/wait 可解释 queued 停滞；queue 操作不自动启动服务；stdio session 的既有 executor 生命周期单独保持。

## 6. 公共边界（schema / 指南 / discovery，按 C7）

- [ ] 6.1 根据 Owner Q1 固定 wire version；推荐保持 locus.local-job.v1，未批准前不得接受 v1.1 或 silent downgrade；更新 unsupported-version 精确测试。
- [ ] 6.2 根据 Owner R2 同改 shared features 和 schema discoveryFeature；保留 pinned-old-schema rejection fixture，不把 unknown-field 忽略等同于 enum 容忍。
- [ ] 6.3 实施时才修改 docs/local-job-api-v1.schema.json 与英文/中文 consumer guide：命令、requests/envelopes、wait-timeout9、幂等作用域/规范化/TTL、executor 前提、升级/失败示例、未知字段规则。
- [ ] 6.4 consumer preflight 缺 async-submit 时不 dispatch；说明旧 build 可能忽略未识别请求字段，必须先发现能力；no-key v1 流程不增必填字段。
- [ ] 6.5 保留 12 types、六字段、dense sequences、after/follow、result/artifact names/refs/digests/retention、profile/provider/completion defaults；新增操作不开放 native union 或 Interaction。
- [ ] 6.6 核对 `docs/tickets/TICKET-127-run-dir-artifacts-windows-stable-directory.md`；说明 Windows artifacts 现有 fail-closed，禁止 path-only workaround；如本切片需它已修复则记录前置，不顺手改 backend。
- [ ] 6.7 记录 Career Kit batch/structured-output、Amadeus Windows 接入事实；其 adapter/version/E2E unknown 如实记录，不做专属协商或 roadmap reordering。

## 7. Conformance fixtures（测试先行）

下列每组都必须由独立作者依据 delta Scenario/合同先写 bun red tests，再由实施者使其 green；
作者不用实现源码推断断言。每个测试命名带 Sxx，verification 一一挂接 test file/name/receipt。

- [ ] 7.1 S01/S02/S24：submit 在 runtime latch 未释放前完整返回、账本 creation 已提交、agent/completion admission gate 与一次 upstream call。
- [ ] 7.2 S03/S04/S25：旧 create/default retry = 同核 submit+wait 的完整 byte golden、所有终态/0–8、内部 wait 超时不泄漏为 create 响应；Q2 异常策略决策后再补对应 fixtures。
- [ ] 7.3 S05/S06/S07：commit 前、publish 中、完成时、deadline/0/default/非法 timeout、多个 waiter/失去通知、late diagnostics。
- [ ] 7.4 S08/S09/S10/S11：规范化 replay、语义 conflict、consumer 隔离、跨进程唯一 reservation 和零重复执行。
- [ ] 7.5 S12/S13/S14/S15：事务 rollback 与补偿释放、kill/补偿失败/pending creator、保留期与清理、hash-only/raw-key 泄漏。
- [ ] 7.6 S16/S17：无 executor structured status、stale/dead/legacy/EPERM/nonce-swap、auth readiness 不被混淆，Workbench 读同一 queued job。
- [ ] 7.7 S18/S19/S20：queued cancel、claim race、running cancel、retry 幂等/new identity、parent 不变、non-API 与不可 retry 状态拒绝。
- [ ] 7.8 S21/S22/S23：v1 请求零变化、12-type/六字段/after/follow/artifacts、闭 enum 前后 schema、missing feature/version fail closed。
- [ ] 7.9 S26/S27/S31：统一 creation predicate、初始 artifact gate、每个 staged/commit/rename 边界故障重开、目录替换、schedule 不多 fire。
- [ ] 7.10 S28/S29/S30：daemon source eligibility/claim/concurrency/lock、stdio 同核 response/event、session cancel/shutdown/EOF、无外部 daemon。
- [ ] 7.11 S32/S33：clean/负例结构守卫与 self-test，旧内联 runner、重复 owner/row insert、host 外 appendExact 必须被拒绝。

## 8. 验证 / 评审 / 停止门

- [ ] 8.1 所有 S01–S33 登记、red→green evidence 齐全；targeted bun、architecture guard、migration/rollback、secret/fault suites 实际执行。
- [ ] 8.2 在冻结的精确 source SHA 跑 `bun run check:full`、本 change 与全量 strict OpenSpec、`git diff --check`；记录命令/exit/count/log，不能把环境失败算 pass。
- [ ] 8.3 disposable-profile 手工及 packaged smoke：submit 后 submitter 退出仍可被 daemon 执行；agent/completion wait/result；queued cancel；retry key；daemon 停/起；stdio session shutdown；Workbench 可见。macOS/Windows 分别记录，WSL 不代替 packaged 证据。
- [ ] 8.4 Windows 有/无 artifacts 分开验收；TICKET-127 未修复时 artifact fixture 预期 fail closed，不宣称已交付 Windows artifact refs。TICKET-128 部分发布预期 non-ready，不算恢复成功。
- [ ] 8.5 Codex `IMPLEMENTATION_VERIFIED` 与 fresh-context Claude Code `REVIEW_APPROVED` 必须绑定同一精确 source SHA；代码再改则两者失效；独立 security review 覆盖 key scope、reopen、lock 观察与回滚。
- [ ] 8.6 汇总 consumer-neutral fixtures 与已知 consumer receipts/unknown，记录未覆盖平台、TICKET-128 residual、R1/R2 升级影响，提交 Owner 产品验收。
- [ ] 8.7 **Owner ACCEPTED 停止门**：未有明确 ACCEPTED 不宣称产品接受，不归档；本次派单不授权 merge。将来的本地集成须另获授权并验证 merge SHA。
- [ ] 8.8 **Push 未授权**：push、远程 PR 创建/修改、remote merge、release、规则更改一律 not authorized / not performed；本地提交不隐含远程权限。
