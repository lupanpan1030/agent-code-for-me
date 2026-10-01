# Change: Add Local Job API Async Submit

Status: **APPROVED 2026-10-02 (Owner, bound to 0f998436) — IMPLEMENTATION CANDIDATE frozen 2026-10-02 (see verification.md)**

## Why

Phase 3 需要立即可引用的 Run identity 和重试安全的提交入口。当前 `runs create/retry`
在调用 CLI 进程里运行到终态才返回；异步消费者无法先获得 ID 再观察/取消，同一请求重发也会重复执行。
本提案将 public batch surface 收敛到同一 async submit core，保留同步 create 为 submit+wait wrapper。
基线 `2c59664f1b80a5f782eb05f82d33f718d9bc7053`；逐项 `file:line` 输入依据见 [design](design.md#context-and-source-basis)。

## What Changes

- 新增 `runs submit`、有限时 `runs wait`，retry 增加 opt-in async，agent/completion 同核。
- create/submit/retry 及 jobs-stdio 的 job.run 共用提交 owner，daemon/既有 session executor 经原 claim 执行；删除 API CLI 内联 runner 路径。
- 仅 submit / retry --request 接受 consumer-scoped optional idempotencyKey，规范化请求重放/冲突，job+key 原子占用与补偿释放。
- creation fact 提交才 ack；wait 同时验证 completed commit 与完整文件 publish；不创造 Run/queue/terminal 状态机。
- 状态查询增加 optional executor 可观测信息，保持 existing runtime readiness 的认证含义。
- **Red R1 — 已决，Owner 2026-10-02 选择 Q2(a)**：同步 wrapper 调用与 stdio 相同的 own-Run scoped pump，保留无 daemon 可用及本地 L2；daemon-first / stalled executor / publish failure 的条件行为见 design D2，不能只靠正常 golden 宣称全兼容。
- **BREAKING — Red R2，Owner 2026-10-02 已选 direct**：`async-submit` 扩展 discovery 的封闭 feature enum，固定旧 schema 的校验器需要更新。
- **Red R3 / R4 — 已决，Owner 2026-10-02 分别选 accept / relay**：接受 daemon 环境/native credential home 来源；可捕获 abort 取消 own Run，≤5 s 等确认，SIGKILL 不可 relay，cancel-by-id 为跨平台保证；不持久化 env。
- wire `apiVersion` Owner 2026-10-02 已确认继续 `locus.local-job.v1` + `async-submit`；v1.1 请求门控为已否决的备选，不实现。

## Non-goals

Interaction/cursor reconnect → `add-durable-agent-interactions`；Session/continue/resume →
`add-durable-session-bindings`，FROZEN 1.1 continuationHandle 留给 Phase 5；HTTP/socket 服务、远程、
多租户、优先级队列、SDK 生成、Runtime 交付均排除。TICKET-128 全量创建原子化与可恢复发布、
TICKET-127 Windows run-dir 后端不借本提案实施；本切片的最小 ack/claim/read barrier 与未修复残差
在 design D3/D5 和 Q4 明列。Phase 3 的新增公共 artifact-ref 寻址/搬运能力留给独立 artifact-ref proposal，本切片只消费既有 refs。
不改变 Desktop chat、人用 one-shot CLI 或显式 provider/profile 选择；R3 的执行环境来源变化单列。

## Impact and four delivery anchors

- **Canonical owner**：拟 `headless/run-submission.ts` 编排 submit/wait；现有 job-store、ledger/host、daemon、runners、run-artifacts 分别保留存储、事实、认领、执行、文件 ownership。
- **旧路径删除**：`cli-dispatcher.ts#runPreparedLocalJobApiJob` 与 API create/retry runner 直调、stdio 独立 create/run 编排、重复 job row construction 同 change 替换；无兼容旧 worker。
- **Migration gate**：additive idempotency reservation migration + 旧 writer 停止 + claim/admission 一致 + 单一路径守卫 + schema/conformance 同步，完成后才广告 feature。
- **验证消费者**：Locus-owned neutral batch/structured-output、CLI/daemon/stdio、store/Workbench；真实消费者 receipt 分列 unknown。

Affected deltas：local-job-api、headless-agent-jobs、agent-protocol-interfaces、agent-runtime-core、architecture-ownership。
Desktop living spec 作为回归约束，无行为变更因此无 delta。实施影响 owner map、shared types、
CLI parser/dispatcher、store/schema/migration、daemon/stdio、artifact read composition、schema/中英文指南及
tests/architecture guards；**本次起草只写本 change 文档与 STATUS 一行，不改这些实施文件**。

## Consumer Impact

按 `docs/consumer-impact-template.zh-CN.md` 十节完整填写，六项推荐默认已获 Owner APPROVED 2026-10-02 @ 0f998436；独立 red suite 和实施证据仍待完成。

### 1. Gate 状态

```text
Status: APPROVED 2026-10-02 (Owner, bound to 0f998436) / IMPLEMENTATION CANDIDATE (T2 re-freeze; awaiting same-SHA dual verdicts, see verification.md)
OpenSpec change: add-local-job-api-async-submit
Author / date: Codex / 2026-10-01
Decision owner: Repository Owner
Owner approval: 2026-10-02 @ 0f998436；第 10 节六项决定全部按推荐默认
Implementation blocked until: 1.6 prune closure re-check + 独立作者 red suite（先于实现）——历史门槛：独立 red suite `20e7bfcf` 已先于实现；1.6 receipt 仍开放，由统筹记录或豁免（tasks 1.6）
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
| locus.local-job.v1 | submit/wait、retry --async/--request | 新 opt-in command/shape，wait timeout envelope + exit 9 | additive，旧 0–8 编号不变；Q6 | design D2 |
| same | create/default retry | inline → submit + scoped canonical pump + wait（Owner 2026-10-02 已选 Q2(a)） | **Red R1 — 已决，Owner 2026-10-02 选 (a)**：接受 own-pump 及 daemon-first/stalled/publish failure/observer error 披露；own-pump agent/completion（含 45 s upstream）以 pending dispatch promise 豁免 no-progress 窗；远端 claimant 用 D5 worker 证据，本地正常 bytes 保持 | cli-dispatcher.ts:451-528；design D2 |
| same | execution context | caller env → 实际 claimant env/native home；CLI readiness 仍只检查 caller | **Red R3 #6/#7/#9 — 已决，Owner 2026-10-02 accept daemon 环境** | process-runner.ts:229-234；daemon.ts:162；design D2 |
| same | waiter abort | 今日 process-tree kill 终止本地工作；远端 claimant 不会随 waiter 消失 | **Red R4 #4/#9 — 已决，Owner 2026-10-02 relay**；daemon-first catchable abort/armed EOF cancel own ID，≤5 s 等确认；POSIX SIGKILL、Windows child.kill()/TerminateProcess 不可 relay；跨平台可靠取消须按 ID | guide:787,817；design D2 |
| same | job.workerId / workerPid | 字段不变；daemon-first 值指向 shared executor，不再是 caller | #3 provenance 披露（P3），不要 signal workerPid；调用 runs cancel | schema:1063-1064；cli-output.ts:124-125 |
| same | idempotency/replay/conflict | 仅 submit/retry body 可选 key，同 consumer/request 重放；conflict exit 2 | submit/retry opt-in additive #5；create 不新增字段且显式拒绝 idempotencyKey，属 #2 tightening / #10 新 code；Q1/Q5 | design D4 |
| same | fail-closed settlements | 新 project_unregistered、cwd_identity_changed、execution_profile_invalid、queued_age_exceeded、artifact_admission_mismatch | #5/#10：status=failed；job.errorCode 为同名或 profile owner binding code；exit 为 7/7/(binding 4/2/6，否则 3)/1/1；Q6，不新增 exit，不改 0–8 含义 | design D5；headless delta projection table；guide:995,1130 |
| same | submission_pending | 原无此 code；live creator / permanent orphan 均 exit 8 + retryable:true | #5 新语义，Owner 2026-10-02 已接受 Q4/Q6；retryable 不承诺最终解除 | synthesis SYN-09；design D3 |
| same | wait/status observation | status queued/running 必有 execution；terminal 省略；wait 根据表给 reason | additive fields，read 本身只观察，既有 recovery prologue 不变 | design D5 |
| same | discoveryFeature | closed enum 加 async-submit | **Red R2 / Q3 — 已决，Owner 2026-10-02 direct**；保留 pinned-old-schema 失败，按预声明 refresh 规则刷新 | guide:209-216；living Discovery:476-478 |
| same | terminal result/artifacts | normal prepared tail 与今日 terminal.artifacts() 相等；recovery 无 terminal refs、ready 返回 artifacts:[] | #5/#8 明示异常行为；旧 publish failure 本来就返回 artifacts:[] + outcome exit，Q2(a) 本地保持，daemon-first 可能 error/8 | run-event-ledger.ts:1498-1500,1582-1595；design D2/D5 |
| same | key request gating / guide | 已选 submit/retry-only key SHALL 收窄 guide:210；idempotencyKey 要求 async-submit preflight；keyed create 为已否决的备选，不实现 | #10 已选规则披露；旧 create silent drop 可重复执行；新 create 拒绝 idempotency_key_not_supported/2，#2 tightening | shared/local-job-api.ts:828,875；C7 §9.8 |
| locus-jobs-stdio.v1 | initialize/job.run/job.cancel/shutdown | envelopes 不变，调用同 submission/pump owner，无外部 daemon 前提 | internal 原子替换，MODIFIED 正确 capability | agent-protocol-interfaces:35-69 |
| wire decision | apiVersion | Owner 2026-10-02 保持 locus.local-job.v1；v1.1 是已否决的备选，不实现 | Q1 已决，无新版本路径 | shared/local-job-api.ts:813 |

短路径见 design source basis。**C7 §9.2 十条**逐项分类：

| # | C7 类别 | 分类、变化及 Owner 接受点 |
| --- | --- | --- |
| 1 | 删除/重命名 | 无 public 删除；internal inline runner/helper 原子删除，scoped pump 同核。 |
| 2 | type/enum/default/validation | 新操作/timeout/key opt-in；`runs create` 带 `idempotencyKey` 从今日静默接受并执行改为 stdout v1 error `idempotency_key_not_supported`/2、不执行，是 Q1 已确认的明确 validation tightening（ignore 已否决，不实现）；**R2** 扩 enum；claim-time revalidation/max queued age=24 h 新增可拒绝执行的边界需披露；version 备选已否决，不实现。 |
| 3 | identity | Run/job identity 与 retry lineage 不变；workerId/workerPid 真实指向 executor，daemon-first 来源改变，S03 不掩盖。 |
| 4 | lifecycle | **R1** wrapper 执行/异常分支；**R4** waiter death ≠ 自动远端 cancel；signal/EOF 策略 Owner 2026-10-02 已选 relay；正常 queued/running cancel 原语义不变。 |
| 5 | ordering/idempotency/retry/terminal | key/replay/conflict/TTL opt-in；submission_pending/8+retryable 可永久占 key，需指南救济；wait committed+published，recovery 空 refs；publication/observer error 为 R1 披露；五个 fail-closed settlement 新 code/exit 映射见上表（reasons 非 v1-stable，job.errorCode/exit 是承诺），不改 12 events/order/after/follow。 |
| 6 | Runtime/provider/model/policy | 显式选择与 selector 不变；**Red R3** claimant env/native config home 会改变原生凭据来源与可用性；CLI readiness 不等于 daemon readiness。claim 前复核 project/cwd/profile/grant，失败关闭，不自动换 provider。 |
| 7 | auth/trust/secret/FS/network | **Red R3** 各 adapter 按平台 allowlist 的 native-home variables（POSIX HOME/CODEX_HOME/CLAUDE_CONFIG_DIR；Windows USERPROFILE/APPDATA/LOCALAPPDATA）与 PATH-family 来源迁移，proxy 仅在 adapter 转发时；daemon-claimed Run 绕过 consumer 自己的 env minimisation；双方都 strip secrets；不得持久化 env。raw key never stored，consumer 是 attribution 非 auth；不扩 root/network 权限。 |
| 8 | artifacts/retention | 正常路径/roles/digest/retention 不变；key TTL 非文件 TTL；异常 publish 的 wrapper baseline 与 Q2 例外、recovery 空 terminal refs 必须披露。跨进程验证/receipts 不暴露 dev/ino。 |
| 9 | transport/Host/start/platform | **R1** 已选 own-Run scoped pump；**R3** environment 来源；**R4** shutdown/cancel：POSIX SIGINT/SIGTERM/SIGHUP/armed EOF 可捕获、SIGKILL 不可；Windows Ctrl+C（SIGINT）/Ctrl+Break（SIGBREAK）/console 关闭（SIGHUP）/armed EOF 可捕获、parent child.kill()/TerminateProcess 不可；只有 cancel-by-id 跨平台可靠，piped consumer 可用 EOF relay；Career Kit 500 ms kill 会截短 5 s ack wait；(c) detached launcher 新启动 surface 已否决，不实现。无 HTTP/socket/新平台承诺。 |
| 10 | unknown/new enum/extension | **R2** pinned enum 更新；Q1 已选 submit/retry-only key SHALL 收窄 guide:210 并要求 async-submit preflight，不能认为旧 build 尊重 silently dropped key。已确认 create 拒绝的新 idempotency_key_not_supported，以及上表五个 fail-closed code/exit 映射均披露。无新 event/native extension。 |

C7 §9.1：reservation、pump、seams 属 internal；CLI/stdio/schema/errors/feature 属 public 或独立版本；Runtime-native raw union 不公开。R1–R4 均已由 Owner 2026-10-02 决定（(a)/direct/accept/relay）；仍披露实际合同影响，不将 JSON 可解析当作兼容结论。

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
{"apiVersion":"locus.local-job.v1","error":{"code":"idempotency_conflict","message":"The idempotency key is already bound to a different request."}}
{"apiVersion":"locus.local-job.v1","job":{"id":"job-A","status":"queued"},"wait":{"state":"timeout","timeoutMs":30000,"reason":"executor_unavailable"}}
{"apiVersion":"locus.local-job.v1","job":{"id":"job-A","status":"queued"},"execution":{"state":"unavailable","reason":"no_executor","observedAt":"2026-10-01T00:00:00.000Z","hint":"locus daemon run"}}
```

wait ready 和旧请求 create 保留 Current 的**完整**正常终态 envelope；只有 keyed submit/retry replay 增加标志，create 不接 key。
以下事件在 current/proposed 完全相同，不新增 async event：

```json
{"apiVersion":"locus.local-job.v1","jobId":"job-A","sequence":1,"type":"job_created","createdAt":"2026-10-01T00:00:00.000Z","payload":{"source":"api","runtime":"codex","mode":"plan","cwd":"/workspace/demo"}}
```

新增 pending / observer error 示例（error stdout，exit 8；后者携带 job id，不能当作 Run 终态）：

```json
{"apiVersion":"locus.local-job.v1","error":{"code":"submission_pending","message":"Submission is not yet admitted; retry the same key.","retryable":true}}
{"apiVersion":"locus.local-job.v1","job":{"id":"job-A","status":"running"},"wait":{"state":"error","reason":"observation_failed"}}
```

Q1 验证收紧示例：同一 create body 若带 `"idempotencyKey":"req-001"`，今日忽略该字段并执行；Owner 已确认新版 SHALL 不执行，stdout 一行如下，exit 2。选 stdout 沿既有 create project/provider error envelopes（cli-dispatcher.ts:514-520），不改变其他 generic validation 的 stderr。继续 ignore 是已否决的备选，不实现；旧 build 的 keyed create 仍可能重复执行。

```json
{"apiVersion":"locus.local-job.v1","error":{"code":"idempotency_key_not_supported","message":"idempotencyKey is not accepted by runs create; use runs submit."}}
```

Claim-time fail-closed 的五种投影均为 `status:"failed"`：`completed.payload.reasons` 分别含 `project_unregistered`、`cwd_identity_changed`、`execution_profile_invalid`、`queued_age_exceeded`、`artifact_admission_mismatch`；`job.errorCode` 同名，惟 profile owner 提供 binding code 时保留该 code。create/default retry/wait outcome exit 分别为 7、7、binding unavailable→4 / invalid-request→2 / local-only→6（无 binding code 时 3）、1、1。另有 gate 意外异常的内部兜底 `claim_gate_failed` / `internal_error` / 8（沿用既有 exit 8，合计六个已记录的 fail-closed 结果；T1 实施时由 design D5 与 headless delta 记录）。示例：项目撤销后的 job.errorCode=project_unregistered、reasons 含同名条目、wait exit 7；reasons 按 guide:1130 仍非 v1-stable，消费者可依赖 errorCode/exit，不需迁移到新的 exit 编号。

submission_pending 可能是仍在提交也可能是永久 orphan；重试同 key 不生成第二 attempt。未解决时可改新 key，但活跃原 creator 仍可能完成，必须明确承担重复风险；orphan 不自动过期，修复归 TICKET-128。

环境例：submitter 用 CODEX_HOME=A，daemon 用 CODEX_HOME=B；daemon claim 的 child 用 B，即使 CLI runtimes list 在 A 显示 ready。两条路径都剥离 secret env，不传 env 快照。abort 例：今日杀 create 进程树停止 child；daemon-first 杀 waiter 不会杀 daemon，Owner 已确认可捕获 abort/armed EOF SHALL 转发 own cancel；POSIX SIGKILL 和 Windows parent child.kill()/TerminateProcess 做不到，Ctrl+C/Ctrl+Break/console 关闭/armed EOF 是 Windows 可捕获入口。今日 publish 抛错时 create 仍返回 artifacts:[] 和 outcome exit；Q2(a) 本地保留，独立 wait 则 pending/9，daemon-first 的 bounded error 为已接受且需披露的 R1 残余；(b)/(c) 备选不实现。

纯 schema diff 无法表达：ack 已持久化但未必执行；queued snapshot 可随即变 running；Run terminal 不等于
文件已 publish；wait timeout 不是 Run failure；executor 前提改变旧 create 的启动体验；相同 key 的
replay 不触发新 provider 工作。Q2(a) 的 daemon-first/异常 wrapper 披露仍是 L2 完整兼容性缺口，Owner 已接受，不能以正常路径测试掩盖。

### 5. 已知 consumer 与所需修改

| Consumer | 使用证据 | 受影响调用 | 所需修改 | Consumer-owned test/E2E |
| --- | --- | --- | --- | --- |
| Career Kit | **仅证据**：career-application-kit@6d6a333，locus-adapter.cjs:26 固定 locus.local-job.v1；strategy:93；adapter :42 的 5 min timeout，:4137-4150 sanitized env allowlist，:4179-4215 POSIX detached spawn/process-group kill，win32 不 detach（:4179）；`LOCUS_KILL_GRACE_MS = 500`（:44,:4221-4223）即 SIGTERM 后 500 ms SIGKILL，截短 proposed 5 s ack wait，正常可捕获 relay 先持久化 cancel request，但 hard kill 不保证送达；:5730-5752 仅恢复到 ID 才 cancel，:5360-5376 validateLocusCreateEnvelope 要求 succeeded + consumer/createdAt 在 create 时间窗匹配 | create；runtimes list（:3890,:3965，检查 runtime-readiness）；projects status (:4748)、runs status (:4804)、cancel (:4839)、result (:5769)；batch/structured-output | 采用 async/key 需 feature preflight、保存 ID、处理 pending/observer error；旧 attempt replay 会被当前 createdAt window validator 拒绝，需 consumer 自行调整；daemon-claimed Run 绕过 consumer 自己的 sanitized env allowlist，须评估 R3；R4 在 Windows parent kill 不 relay，portable piped EOF 与 cancel-by-id 需 consumer 自行评估；刷新 pinned schema；领域 review/apply 不变 | 本切片 receipt unknown；上述版本/行为是核实事实，不是协商、路线重排或本次验收 |
| Amadeus | strategy:108 的已接入事实；本次 Owner 派单明确 Windows 接入方 | 当前具体 v1 命令/版本及 key 需求 unknown | 按其实际使用评估新操作、R1/R2；Windows artifacts 现有限制见 TICKET-127 | unknown；只列事实，不协商、不重排路线、不代其写 adapter |
| Other | unknown | unknown | 发布 consumer-neutral guide/schema/fixtures | unknown |

Locus 自己负责 neutral contract conformance；不建立跨应用业务矩阵，不把消费者内部 E2E 当默认 release gate。

### 6. 选择方案与成本

| Option | Locus 变化 | Consumer 变化 | 维护成本 | 风险 | 删除条件 |
| --- | --- | --- | --- | --- | --- |
| Direct new standard（Owner 2026-10-02 已选 R2 direct / R1 Q2(a)） | 同 v1 扩 feature enum；Q2(a) 同 scoped pump；明确接受 R1/R3/R4 条件 | 更新 pinned schema；接受 daemon env 来源；按 R4 relay/cancel-by-id 取消 | 低，单 core | 老调用启动/固定 schema 受影响 | 无旧 core；无临时 facade |
| New public version（已否决的备选，不实现） | 新 version parser/serializer → 同一 core | 显式版本选择，旧版保留范围另定 | 中，多版本 fixtures | 版本号本身不能恢复旧自执行行为 | Owner 定旧版 sunset 后删翻译 |
| Temporary facade（已否决的备选，不实现） | 旧 envelope 翻译 → 同一 submit+wait | 暂留旧字段；旧启动体验可由同 canonical scoped pump 实现；不得暗增 detached launcher | 中 | facade 不能伪造完成/另建 worker；无法单靠翻译消除 R1 | Owner 定具体 sunset/移除条件 |
| Defer / reject（已否决的备选，不实现） | 暂不实施受影响 public change | 无 | 延期 | async 与去重需求未交付 | 新决定后重提 |

Owner 已确认（2026-10-02）：Q2(a) scoped pump；R3 accept actual executor env/native home；R4 daemon-first catchable abort/armed EOF own cancel，≤5 s 等确认；Q1 v1 + submit/retry-only key + reject on create（#2 tightening）；R2 direct；Q4/Q5/Q6 accept all，详见 §10。
Q2(b)/(c)/(a′)、R3 caller-only claim、R4 no-relay、Q1 keyed create/ignore/v1.1、R2 version/facade/defer 与 Q4 前置全量 TICKET-128/新 exit code 均为**已否决的备选，不实现**；其成本与后果统一保留在 [design Owner decisions](design.md#owner-decisions-2026-10-02)。R2 direct 引用指南 :209-216/living Discovery 预声明刷新规则，以及 canonical-run-ledger archived proposal row 10 的 Non-breaking refresh disclosure 先例；本次 direct 由 Owner 对 0f998436 明确批准。guide:210 SHALL 收窄为 submit/retry key 需要 async-submit preflight，create reject 的 #2 / #10 新 code 另列；旧 build 忽略 create key 的重复执行风险不消失。
正常 create 的长期 convenience wrapper 是 C7 §9.6 的同核操作，不是保留旧实现。
不把 old core/DB/queue/worker/state machine 列为任何选项。

### 7. Compatibility facade 边界

Owner 已确认不新建临时 facade；TEMPORARY_FACADE 是已否决的备选，不实现，以下职责清单仅保留为 C7 边界记录：

C7 §9.5 原文职责清单：

允许：

- parse/validate 旧 request；
- rename/default/shape translation；
- 调用同一个 canonical application/core service；
- 把 canonical result/event/error loss-aware 地序列化成旧 contract；
- 明确返回 unsupported/degraded，或在无法无损表达时 fail closed。

禁止：

- 独立 persistence/table/cache 作为业务真相；
- 独立 Run/Interaction/Handoff/SessionBinding 状态机；
- 独立 queue/worker/Runtime dispatch；
- 独立 retry/cancel/event ordering/permission/auth 规则；
- 为旧版继续开发 canonical core 不具备的新功能；
- 静默降级到语义更弱或更危险的版本。

本 change 的具体 owner/删除 gate 及附加禁止项：

```text
Canonical owner: run-submission.ts + existing ledger/store/executor/artifact owners
Old contract/version: locus.local-job.v1 的 create/retry 外形
New canonical contract/core: 同一 submitRun + waitForRun
Allowed translation: parse/validate、旧字段/default 映射、同核调用、serialize
Explicitly forbidden: 独立状态/DB/queue/worker/retry/cancel/policy/artifact；把未发布终态伪装成功
Migration gate: Owner 2026-10-02 已确认 v1/direct + schema/conformance + single-owner guard
Deprecation owner/comment: N/A（未选临时 facade，无第二路径）
Deletion date or condition: N/A（无临时 facade）；旧内部路径同 change 删除
Architecture guard / contract tests: S32/S33 及旧请求 byte fixtures；不存在 inline execution fallback
```

### 8. 发布、失败恢复与回滚

```text
Release order: Owner C7 + APPROVED 2026-10-02 @ 0f998436 → prune closure re-check + 独立 red tests → additive migration/原子删除旧路径 →
  schema/双语指南/examples/feature 一致 → 同 SHA 验证与 fresh review → 统筹代行 ACCEPTED（同 SHA 双技术标记、无开放 Red；红灯回 Owner）。
Old consumer → new Locus: Q2(a) own-pump agent/completion（含 45 s upstream，无心跳）正常终态 bytes 保留；远端 claimant 在 D5 committed worker identity/120 s/confirmed-alive 证据可用时不误报 30 s error；R1 异常、R3 环境、R4 abort 已披露，R2 pinned schema 需刷新，不能宣称全兼容。
New consumer → old Locus: 缺 feature 不 dispatch；submit / retry --request 由旧 parser 按形状 exit 2；不得 keyed create 后假设 key 被执行。
Unsupported version: 当前 exact-version 校验错误 apiVersion must be locus.local-job.v1，exit 2；
  没有现成独立 unsupported-version JSON code，不能虚构；Q1 已确认保持 v1。
Downgrade: 不静默降到无幂等 create；只可由 consumer 显式选用原有无-key 语义。
Rollback: 停 writer/drain 后旧构建用隔离 profile，或另行验证的 backup restore；不混用 old/new writer。
External data/artifact: 不动消费者数据库、不删项目或 run files；TICKET-128 残差诚实报告。
Security: R3 明示 executor native-home/env 来源；无 env 快照或新增 secret 入口；raw key never stored；execution 无新增 PID，job.workerPid 仍是真实执行者。
```

普通 append 失败原子补偿 key/job；崩溃 orphan 不 ack、不执行、保留 reservation 并报 submission_pending；
partial publish 的 wait 超时不改变 ledger outcome，修复仍由 TICKET-128 统一 owner 完成。

### 9. 验证证据（待实施，不勾选）

- [ ] machine-readable schema、shared public types、feature、指南/示例/error semantics 一致。
- [ ] core、v1 既有事件/正常终态保留与已披露 keyed-create validation tightening、create byte equality、new submit/wait/idempotency conformance。
- [ ] unsupported version/missing-feature preflight、closed-enum 旧 schema 失败证据与升级样例。
- [ ] reservation 竞争/回滚/补偿、publisher fault/restart、queue cancel/start 与 stale lock 负例。
- [ ] single-core 静态守卫及 negative fixture，无旧 inline runner/重复创建。
- [ ] stdio transport、daemon/API agent+completion、Workbench 回归及 macOS/Windows packaged smoke。
- [ ] consumer adapter/E2E receipt 或 unknown；独立 fresh review 绑定同一 source SHA。

登记表及未来证据项见 [verification.md](verification.md)；本次文档 strict 校验不构成产品测试通过。

### 10. Owner 决定

**Owner APPROVED 2026-10-02 @ 0f998436 — 六项决策按推荐默认。**

1. **Q2/R1 = (a)**：同步 wrapper SHALL 在自己 admitted 的 Run 范围内跑 canonical pump；daemon 先认领则 SHALL 只等待。接受已披露 daemon-first/异常分支，保留本地 L2。
2. **R3 = accept**：daemon 认领的 Run SHALL 在 daemon 环境/原生凭据家目录下执行，按 Red #6/#7/#9 披露，SHALL 不持久化 env。
3. **R4 = relay**：可捕获中止时 wrapper SHALL 转发取消自己的 Run（≤5 s 等确认）；own-pump 保留今日本地执行树行为。SIGKILL 不可转发，Windows child.kill()/TerminateProcess 同理；cancel-by-id 为跨平台保证。
4. **Q1 = v1 + submit/retry-only key + reject on create**：保持 `locus.local-job.v1` + `async-submit`；`idempotencyKey` 仅 `runs submit` 与 `runs retry --request`；`runs create` 带 key SHALL 返回 stdout `idempotency_key_not_supported`/exit 2、不执行，明确披露 C7 #2 tightening / #10 及 guide:210 preflight 收窄。
5. **Q3/R2 = direct**：SHALL 直接扩展封闭 discoveryFeature 枚举 `async-submit`，引用指南刷新规则与 canonical-run-ledger 先例，SHALL 保留 pinned-old-schema 失败夹具。
6. **Q4/Q5/Q6 = accept all**：最小 ack/claim/read barrier + TICKET-128 残余披露；recovery SHALL 不登记终态 refs；verified publication 后至少 30 天保留（空 refs 按 settle），命名清理 `cleanupExpiredAgentJobIdempotency` 在 submit 同 consumer lookup 前、daemon 每 tick 全域触发；wait 30 s 默认 / 24 h 上限 / exit 9；submission_pending 保留 exit 8 + error.code + retryable:true；最大排队 24 h；五个 fail-closed 代码按既有 exit 映射 7/7/(binding 4,2,6 else 3)/1/1。

```text
Decision: Owner APPROVED 2026-10-02 @ 0f998436
Approved exact scope: 0f9984367a9fbc8c5030f9aecc85ac9628a71cde；六项推荐默认全选，本次只记录与 prune
Compatibility obligation: 本地 v1 正常终态 bytes；明示 R1–R4、keyed-create 收紧、pending 与 publish/recovery 异常语义
Sunset/deletion condition: N/A（无新 version/临时 facade）；旧内部路径同 change 删除
Consumer coordination required: 发布中立材料；Amadeus 只列事实，无专属协商/排序
Owner: Repository Owner
Date: 2026-10-02
Next gate: prune closure re-check + 独立作者 red suite（test-first，先于实现）
```

备选及后果见 [design Owner decisions](design.md#owner-decisions-2026-10-02)；已否决备选不实现。
Owner 同日启用「自我迭代」：后续 ACCEPTED 由统筹代行，条件为 Codex IMPLEMENTATION_VERIFIED + fresh-context Claude REVIEW_APPROVED 同 source SHA、无开放 Red；只有红灯项回到 Owner。本次不构成技术验证或 ACCEPTED；不合并、不 push。
