# Locus Interoperability Contract v1

> **状态：RATIFIED — C1–C9 OWNER CONFIRMED — 2026-08-25。**
>
> 本文记录跨 OpenSpec change 稳定的互操作对象、身份、状态机和边界。已标记
> `RATIFIED` 的决定作为后续 proposal 的方向约束；C1–C9 已全部确认，因此全文 ratify。
> Ratification 不是产品代码实现授权，也不改变当前 public API；每个实现 slice 仍需要独立、
> 获批的 OpenSpec change。

产品方向以 [Locus 产品方向与 Harness 战略](locus-product-direction-harness-strategy.zh-CN.md)
为准，实施流程以 [Locus AI 协作开发工作流](locus-ai-collaboration-workflow.zh-CN.md) 为准，
当前代码 owner 以 [Ownership Map](../OWNERSHIP_MAP.md) 为准。

## 1. 目的与适用范围

本文只定义 Locus 为 Desktop、CLI、Career Kit、Amadeus 等调用方提供的稳定语义：

- 一个用户对话在 Locus 中是什么；
- 一次执行、Runtime 原生 session 和用户交互如何关联；
- Handoff、恢复、失败和版本更新时哪些身份保持不变；
- public contract 与 Runtime-native extension 如何演进；
- Locus producer 与 consumer 各自负责什么。

本文不拥有 Career Kit 或 Amadeus 的 Goal/Task 业务模型，不规定具体 React component、tRPC
router、SQLite 表名或迁移 SQL，也不授权保留旧/新两套实现。

## 2. 决策台账

| ID | 主题 | 状态 | Owner 决定 |
| --- | --- | --- | --- |
| C1 | Chat / Conversation identity | **RATIFIED 2026-08-25** | A：同一个 durable identity |
| C2 | Job / Run | **RATIFIED 2026-08-25** | A：Run 是 canonical attempt；Job 是 v1 投影 |
| C3 | Session API host | **RATIFIED 2026-08-25** | A→B：显式 Host 到 opt-in 常驻服务 |
| C4 | SessionBinding lifecycle/version pin | **RATIFIED 2026-08-25** | C4.1=A；C4.2=A+ |
| C5 | Interaction state machine | **RATIFIED 2026-08-25** | A：durable、single accepted resolution、fail closed |
| C6 | Handoff payload/provenance | **RATIFIED 2026-08-25** | A+：最小可审查 envelope + scoped source-backed query |
| C7 | Public/internal API evolution | **RATIFIED 2026-08-25** | A：internal 原子替换；public 逐 change 提交 Consumer Impact，由 Owner 选择兼容 |
| C8 | Runtime update policy | **RATIFIED 2026-08-25** | A+：共同的受认证交付；Codex=A；Claude=A；`codex exec` 收敛设计延期细化 |
| C9 | Consumer/platform acceptance | **RATIFIED 2026-08-25** | C9.1=A：producer-owned neutral acceptance；C9.2=A：macOS/Windows Tier-1，Linux Desktop experimental |

## 3. C1 — Chat 与 Conversation

> **Owner 决定（2026-08-25）：A。** UI 中的 **Chat** 与 core/public API 中的
> **Conversation** 是同一个 Locus durable entity。两者共享一个 canonical identity，
> 当前实现映射到 `sub_chats.id`；当前 `chats.id` 的产品语义是 `workspaceId`。不得新增平行
> Conversation identity、镜像表或第二套 lifecycle。Runtime-native thread/session identity
> 必须属于 Conversation 下的 SessionBinding，而不是替代 Conversation identity。

### 3.1 规范定义

- **Conversation**：Locus core 与未来 public API 中的唯一用户对话实体。
- **Chat**：同一 Conversation 在用户界面中的产品名称，不是第二个领域对象。
- **conversationId**：Conversation 的 canonical ID；进程重启、Engine 切换、恢复失败和显式
  Handoff 不得因为 Runtime-native session 变化而改变它。
- **durable**：身份与 Locus 持久状态绑定，不随 renderer、main process 或 Runtime 进程重启而
  消失；它不推翻当前 `PRE-PRODUCTION / DISPOSABLE TEST DATA` 的数据阶段决定。
- **native identity**：Codex thread/session、Claude session 或其他 Runtime 自有 ID；只能作为
  binding provenance 保存，不能成为 `conversationId`。

规范关系是：

```text
Workspace
  └── Conversation / UI Chat                 # 一个 canonical ID
       ├── messages / visible events
       └── SessionBinding[]                   # D4 已确认一对多；细节待 C4
            └── Runtime-native identity
```

不是：

```text
Workspace
  └── UI Chat chat_1                          # 禁止新增的镜像身份
       └── Conversation conv_9
            └── SessionBinding
```

### 3.2 当前实现映射

当前 schema 的历史命名与产品词汇不同：

| 当前实现 | C1 产品/core 语义 |
| --- | --- |
| `chats.id` | `workspaceId` |
| `sub_chats.id` | `conversationId`；UI 显示为 Chat |
| `sub_chats.sessionId` | 旧的单值 Claude-oriented native session 字段；不是 Conversation identity |
| message metadata 中的 Codex/Claude IDs | provenance/历史兼容信息；不能作为 canonical binding owner |

因此 C1 的含义是承认现有真实 Chat 的稳定 core 名称，而不是立即复制数据：

```text
UI Chat ID == core/API conversationId == 当前 sub_chats.id
```

具体表/类型重命名必须在后续 approved OpenSpec 中原子完成：更新全部内部调用者并删除旧解释，
不得让 `sub_chats` 与新 `conversations` 镜像表长期并存。现有 public Local Job API 字段是否
直接更名、发布新版本或采用薄兼容 facade，留给 C7 的 Consumer Impact 决定。

### 3.3 行为例子

用户先用 Codex，再显式 Handoff 给 Claude：

```text
Conversation conv_001
├── Codex binding  → native thread codex_777  → handed_off
└── Claude binding → native session claude_8  → active
```

整个过程中 UI 路由、Career Kit/Amadeus 保存的引用和 Locus conversation identity 都仍是
`conv_001`。Handoff 新建目标 native session/binding，不创建镜像 Conversation。

只有真正需要独立用户生命周期时才创建新 Conversation，例如新 Chat 或用户显式 fork：

```text
Conversation conv_001
  └── explicit fork → Conversation conv_002
```

fork 的来源关系和可传递内容留给 C6；C1 只确认它们是两个独立 identity。

### 3.4 Ownership 与边界

后续实施必须建立 main-process-owned 的 Conversation canonical owner，并让 renderer、tRPC、
Codex adapter 与 Claude adapter 通过它解释 identity/lifecycle。Conversation owner 不拥有：

- Runtime-native resume/start protocol；
- SessionBinding 的详细 lifecycle/version pin（C4）；
- 单次执行的 Run 语义（C2）；
- Interaction 状态机（C5）；
- Handoff payload（C6）；
- Career Kit/Amadeus Goal、Task 或完成判断。

当前 `OWNERSHIP_MAP.md` 尚无 Conversation identity/lifecycle owner；新增 owner 与删除旧分散解释
必须属于同一个 approved architecture change，不能只新增 helper 后保留 renderer、route 与
Runtime adapter 各自推断 identity。

### 3.5 C1 验收不变量

未来相关 change 的 architecture guard/contract tests 至少证明：

1. UI Chat 与 core Conversation 不会生成两个 ID；
2. `workspaceId` 不会被当作 `conversationId`；
3. 一个 Conversation 可以关联多个不同 Runtime 的 native binding；
4. native session/thread 变化不会静默改变 `conversationId`；
5. consumer 不需要解析消息 metadata 才能取得 canonical Conversation identity；
6. rename/archive 等 Conversation lifecycle 规则只有一个 canonical owner；
7. 不存在旧/新并行的 Conversation identity 或 lifecycle 路径。

## 4. C2 — Job 与 Run

> **Owner 决定（2026-08-25）：A。** **Run** 是 Locus 唯一 canonical execution
> attempt。每次实际执行与每次 retry 都创建新的 `runId`，不得覆盖旧 attempt 的状态、事件、
> 日志、结果、artifact 或 provenance；retry 必须记录来源关系。`JobSpec` 是提交给 Run 的输入
> 快照，不是第二个 durable lifecycle entity。Local Job API v1 的 Job/jobId 是同一 Run 的
> 兼容投影，不得为兼容保留旧 Job core 与新 Run core 两套实现。Career Kit、Amadeus 等
> consumer 继续拥有其 Goal/Task 业务身份和最终完成判断。

### 4.1 规范定义

- **Run**：一次实际 execution attempt；排队后即拥有稳定 `runId`，并独立拥有 status、timing、
  Runtime/installation provenance、events、result、error 和 artifacts。
- **JobSpec**：某个 Run 接受的输入快照；retry 可以复用或基于显式输入产生新快照，但不会把
  JobSpec 提升为拥有状态机的 Job entity。
- **retry**：从一个 terminal Run 创建新的 Run。新 Run 使用新 `runId`，记录直接来源，并能
  追踪到 retry chain 的 root；原 Run 保持可审计。
- **Job（Local Job API v1）**：同一 canonical Run 的兼容 envelope/字段词汇，不是第二条
  persistence 或 lifecycle 路径。

规范关系是：

```text
Consumer Goal/Task or Locus Schedule
  └── Run run_001                    # attempt 1, failed
       └── retry → Run run_002       # attempt 2, succeeded
```

不是：

```text
Consumer Task
  └── Locus Job                      # 禁止无独立职责的重复业务聚合
       └── Run[]
```

将来只有出现独立、经 Owner 批准的公共需求——例如 Locus 必须拥有一个可跨 attempts 编辑、取消、
归档并聚合状态的提交资源——才可以重新提出 durable Job aggregate；它必须作为新的 public
contract 决策，而不能从 v1 的 `Job` 名称推断出来。

### 4.2 Retry 例子

```text
Run run_001
├── attempt: 1
├── status: failed
└── retryOfRunId: null

Run run_002
├── attempt: 2
├── status: succeeded
├── retryOfRunId: run_001
└── rootRunId: run_001
```

`attempt` 必须在同一 retry chain 中可确定，不能因重复点击或重试旧节点而静默产生含义冲突的
编号。是否允许分叉/并发 retry 及其分配规则由实现 OpenSpec 明确，但任何方案都必须保留直接
来源和完整 chain provenance。

### 4.3 Local Job API v1 投影

在 C7 决定 public evolution 前，现有 consumer 可以继续看到：

```text
canonical Run                  Local Job API v1
run.id           ───────────→  job.id / jobId
retryOfRunId     ───────────→  retryOfJobId
run attempt      ───────────→  attempt
run status       ───────────→  status
```

该 facade 只能做 envelope/字段转换，必须调用同一个 Run owner。它不能继续维护另一份 Job
状态、事件或 retry 实现。是否保留 `locus.local-job.v1`、发布 v2 或直接采用新标准留给 C7 的
Consumer Impact 决定。

### 4.4 当前实现映射与收敛要求

| 当前实现 | C2 canonical 语义 |
| --- | --- |
| `agent_jobs.id` | 一次 durable attempt 的 `runId` |
| `agent_jobs.retryOfJobId` | 直接来源 `retryOfRunId` |
| `agent_job_events.jobId` | 对应 canonical `runId` 的旧字段名 |
| renderer 生成的 ephemeral `runId` | 当前 stream/cancel identity；必须与 durable run identity 收敛 |
| generic bridge 的 `runId = jobId` | 当前投影事实；不得成为另一套特殊 lifecycle |

后续 implementation 必须让 Desktop、headless、CLI/API、schedule 和 Runtime event 使用同一个
canonical Run owner/identity。不能保留“renderer runId + durable jobId”两个互相映射但可独立
变化的 execution identity。当前 `agent_jobs` 是否原子更名/重建属于 implementation design；
当前数据阶段允许重置测试数据，但 public v1 变化仍须经过 C7。

### 4.5 Ownership 与验收不变量

Run owner 只拥有 Locus execution attempt，不拥有 consumer Goal/Task 或业务完成判断。未来相关
change 的 architecture guard/contract tests 至少证明：

1. 一次 execution attempt 只有一个 canonical `runId`；
2. retry 总是创建新 Run，terminal Run 的历史不会被覆盖；
3. events、result、artifacts、cancel 和 provenance 都指向准确 Run；
4. retry 的直接来源与 root chain 可追踪；
5. Desktop、headless、API 与 schedule 不各自实现 Run lifecycle；
6. Local Job API v1 只是同一 Run owner 的薄投影；
7. consumer 不必把其 Task/Goal lifecycle 复制成 Locus Job；
8. 不存在旧 Job core 与新 Run core 并行运行。

## 5. C3 — Session API Host

> **Owner 决定（2026-08-25）：A→B。** Locus 从第一阶段开始建立唯一、per-userData-profile
> 的 canonical **RuntimeHost**。Desktop、CLI、Career Kit 与 Amadeus 都是 client，不直接
> 拥有 Runtime lifecycle、数据库或 secret。阶段 A 由 Desktop 或用户命令显式启动 Host，
> 不静默注册系统服务；关闭 Desktop 窗口时按用户策略保留、排空或停止 Host，默认不得静默
> 终止 active Run。阶段 B 在本地认证、恢复、升级、平台打包和安全门禁完成后，提供用户
> 明确启用的 per-user 常驻/登录启动能力。两个阶段必须复用同一 Host core、存储和协议，只
> 改变 activation/supervision 方式。

### 5.1 Canonical topology

```text
Desktop renderer
  → preload / Electron IPC
  → GUI main proxy/client ─┐
                           │
CLI ───────────────────────┼→ one RuntimeHost per userData profile
Career Kit ────────────────┤    ├── Conversation / SessionBinding
Amadeus ───────────────────┘    ├── Run / RunEvent / Interaction
                                ├── DB / secret / workspace lease
                                └── Runtime adapters / installations
```

Renderer 不得直接取得 Host endpoint credential、provider secret 或 raw local transport；现有
context-isolation 边界继续成立。具体采用 Unix-domain socket、named pipe 或其他 authenticated
local transport 留给 R3 OpenSpec，但默认不开放未经认证的 TCP/HTTP/WS。

同一 `userData` profile 最多一个可写 RuntimeHost。prod、dev 和显式 QA profile 可以各自拥有
独立 Host；它们的数据库、secret、socket/pipe、lock 和 runtime state 不得混用。

### 5.2 阶段 A — 显式启动与平滑关闭

允许的启动来源：

```text
用户打开 Desktop → Desktop 发现或显式启动 Host
用户执行 Host 命令 → 显式启动 foreground/background Host
```

外部 app 在 Host 不存在时必须收到结构化 `HOST_UNAVAILABLE`，不得偷偷嵌入/启动自己的
Runtime，也不得读取 Locus secret。是否允许 consumer 请求一个需要用户确认的 Host 启动动作，
由后续 public API/UX proposal 决定。

Desktop 的“关闭窗口”“退出 UI”和“停止 Host”是不同动作。关闭策略至少表达：

| 策略 | 行为 |
| --- | --- |
| Keep running | 关闭窗口，Host 与 active work 继续；托盘/菜单栏可见 |
| Stop when idle | 拒绝新 work，当前 Run/Interaction 处理完后停止 |
| Stop now | 明确中断 active work，写入 terminal/provenance 后停止 |
| Ask | 本次展示影响和上述选项 |

默认体验：有 active Run、pending Interaction 或外部 client lease 时保持 Host；完全空闲时允许在
可配置 idle period 后停止。首次选择可以记住，但任何会中断 active work 的动作都必须再次明确
展示影响，不能因关闭窗口而静默 abort。

Desktop 重新打开时连接现有 Host，从 durable event cursor 恢复 UI，不创建第二个 Host、Run
或 SessionBinding。后台运行状态、active Run 数、连接 app 和“完成后停止/立即停止”控制必须
在 UI 或托盘/菜单栏可见。

### 5.3 阶段 B — Opt-in per-user service

当 Locus 成为其他应用依赖的基础服务后，可以让用户明确启用登录启动/OS supervision：

```text
macOS     → per-user LaunchAgent（候选）
Windows   → per-user background mechanism（候选）
Linux     → systemd user service（候选）
```

平台机制仍需各自 proposal/security review，本文不把候选名称当作已选实现。阶段 B 的“可持续
可用”不要求进程永远高耗能运行；可以 idle、按需唤醒或由 OS supervisor 重启，但 active work
的 persistence/recovery 语义必须明确。

从 A 升级 B 前至少需要：authenticated local transport、Host discovery/singleton、client/host
版本协商、crash recovery、durable event/interaction、signed update/provenance、安装/禁用/卸载、
macOS + Windows packaged smoke 和独立安全审查。启用必须有用户明确选择，不得由普通更新
静默改变开机启动或后台驻留政策。

### 5.4 单一实现与当前收敛

当前 GUI main、one-shot CLI main、daemon/ACP main 可以并行直连 DB/Runtime；它们不是目标
架构。后续 change 必须把调用者原子收敛到同一个 RuntimeHost application/core service：

```text
阶段 A supervisor ─┐
                    ├→ same RuntimeHost core
阶段 B supervisor ─┘
```

不得保留 Desktop Host、CLI direct runner、daemon Host 和 OS service 各自一套业务 lifecycle。
旧入口可以成为同一 Host contract 的薄 client/launcher；如果临时迁移路径不可避免，必须满足
W4.2 对 canonical owner、gate、删除日期和 architecture guard 的全部要求。

### 5.5 C3 验收不变量

未来相关 change 的验证至少证明：

1. 同一 profile 不会出现两个可写 RuntimeHost；
2. Desktop、CLI 与外部 app 观察同一 Conversation、Run、Interaction 和 event ledger；
3. renderer 与 consumer 无法取得 raw provider secret/Host credential；
4. Desktop 窗口关闭不会静默终止 active work；
5. stop/drain/crash 都产生明确 lifecycle/provenance；
6. Host 不可用、版本不兼容和认证失败有不同错误；
7. 阶段 B 只改变 activation/supervision，不复制 RuntimeHost core；
8. 未经用户明确选择不会安装、注册或启用常驻服务。

## 6. C4 — SessionBinding lifecycle 与 Runtime installation

### 6.1 C4.1 — 同一 Binding 的执行并发

> **Owner 决定（2026-08-25）：A。** 每个 SessionBinding 同时最多存在一个 non-terminal
> Run/执行 lease。pending Interaction 仍属于 active Run。新的 continue/run 请求不得静默
> abort、替换或并发复用当前 native session；它必须等待、返回带准确 `bindingId` 与
> `activeRunId` 的 `SESSION_BINDING_BUSY`，或经过调用者明确授权取消/切换。

该不变量由 C3 的 canonical RuntimeHost 以 durable/transactional binding lease 强制，不能只
依赖 renderer 或某个 Runtime route 的进程内 Map。两个 client 竞态申请同一 binding 时只能有
一个取得 lease；loser 得到结构化 conflict。Run 进入 terminal 后才释放 lease，stop/crash 的
lease recovery 必须留下 provenance。

不同 SessionBinding 各自持有一个 Run 并不自动获得并发写同一 workspace 的权限；它们仍受
用户明确授权、WorkspaceExecutionContext/lease、worktree isolation 和冲突策略约束。

### 6.2 C4.2 — Runtime installation 选择

> **Owner 决定（2026-08-25）：A+，滚动默认、Binding 固定。** 新 SessionBinding 默认
> 选择当前用户 channel/policy 下最新的 Locus-certified active RuntimeInstallation；已有
> Binding 固定其实际 installation，continue 与同 binding retry 使用该版本。升级通过显式
> 创建带来源关系的 successor Binding 完成，并按已验证能力选择 native migration 或 Handoff。
> 未经认证的 upstream latest 不得自动使用，任何 Runtime 版本变化都不得静默发生。

三种版本概念必须分开：

| 概念 | 含义 | C4.2 行为 |
| --- | --- | --- |
| upstream latest | vendor 刚发布、可能未经 Locus 验证 | 不自动选择 |
| certified latest | 已通过来源、摘要、协议、安全和 conformance 的候选 | 可以被 channel/policy 激活 |
| active installation | 用户 Stable/Canary/Manual policy 当前选择 | 新 Binding 的默认值 |

具体动作语义：

| 动作 | RuntimeInstallation 选择 |
| --- | --- |
| 新 Conversation 创建首个 Binding | 当前 active certified installation |
| 已有 Conversation 新增 Engine/Binding | 当前 active certified installation |
| `continue(existingBinding)` | existing Binding pinned installation |
| 同 Binding retry | existing Binding pinned installation |
| 无 SessionBinding 的新 batch Run | admission 时按 requested execution profile snapshot 当前 active certified installation |
| 无 SessionBinding 的 retry | 新 Run 默认继承 source Run 的 installation pin，并记录 retry provenance |
| 显式 migrate/handoff | 新 successor Binding；默认 active，也可由用户选已认证版本 |
| global activate/rollback | 只改变后续新 Binding/standalone Run admission 默认值，不原地改旧事实 |

无 SessionBinding 的 batch 不等于可以每次从 PATH/latest 重新选版本。它的
`runtimeInstallationId` 必须在 Run admission 时成为 immutable execution snapshot；C2 retry 虽然
创建新 Run，但默认继承 source Run pin。调用方若确实要改用当前 active，应提交语义明确的新 Run
或未来显式 rebase/migration 动作，而不是让 retry 随全局指针漂移。

`RuntimeInstallation` 是不可变、经验证的实际安装身份，不只是版本字符串。它至少能够追溯
`runtimeId`、binary/SDK bundle version、source、digest、platform/arch、verified path、
adapter/protocol/schema identity 和 conformance evidence。Claude 的认证单元必须包含匹配的
Agent SDK client、executable 与 adapter protocol；Codex 至少包含 executable 与 app-server
protocol/schema identity。Run 也要记录实际 `runtimeInstallationId`。

若用户升级已有 native session，不修改原 Binding：

```text
binding_old @ installation_A
  └── explicit migration/handoff
       → binding_new @ installation_B
          supersedesBindingId = binding_old
```

若 Runtime 能力与 conformance 证明 native cross-version resume 安全，successor Binding 可以
记录 native migration；否则必须向新 native session Handoff。原 Binding 保留为历史事实。
若 pinned installation 缺失或被安全撤销，Binding 进入明确 blocked/unavailable 状态，由用户
选择恢复准确安装、显式迁移或关闭；不得静默 fallback 到 latest。

Locus 不拥有 consumer 的“新任务”语义。Consumer 调用 `continue` 表示保持 Binding/pin；真正
需要最新版时必须创建新 Binding 或显式 migrate/handoff，不能由 Locus 猜测。

### 6.3 C4 验收不变量

未来相关 change 的验证至少证明：

1. 同一 Binding 不能同时持有两个 non-terminal Run lease；
2. 新请求不会仅发出 abort 就覆盖旧 controller/lease；
3. 新 Binding 使用准确的 active certified installation，而不是 raw upstream latest；
4. continue/retry 不会因全局 active pointer 变化而静默换 Runtime；
5. migration/handoff 创建 successor Binding 并保存来源与实际 installation；
6. manifest/version/digest 来自成品实际验证，不来自可能漂移的源码常量；
7. missing/revoked installation fail closed，并提供明确恢复选项；
8. `sub_chats.sessionId`、message-metadata 推断和进程内 active Map 不再充当第二套 binding owner。

## 7. C5 — Interaction state machine

> **Owner 决定（2026-08-25）：A。** `InteractionRequest` 是 RuntimeHost 拥有的 durable
> finite-state entity，绑定准确 Run 与 SessionBinding，带明确 deadline、授权 responder 和
> 脱敏 payload。传输允许重试，但只有一个 terminal resolution 能通过原子状态转换被接受；
> 相同回答重试幂等，不同、迟到或未授权回答明确拒绝。Run terminal、取消或超时必须关闭
> pending Interaction。若 bounded policy 不能解决且没有授权 interaction channel，则 fail
> closed，不自动批准或伪造答案。所有 resolution 保存 responder/policy provenance，secret
> 不进入 ledger、renderer 或公共响应。

### 7.1 对象与状态机

Interaction 至少能够表达 permission、question、confirmation、auth-required 与 MCP elicitation。
它的 canonical identity、request、deadline 和状态属于 RuntimeHost；Runtime adapter 只负责
native request/response 的 loss-aware projection。

```text
pending
  ├── resolved: allow / deny / answer / auth-completed
  ├── expired
  ├── canceled
  └── failed
```

只有 `pending` 可以原子进入一个 terminal 状态。`waiting_for_interaction` 期间 Run 仍是
non-terminal，并继续持有 C4.1 binding lease。Run cancel/terminal、binding loss 或 Host recovery
确认 waiter 不再有效时，pending Interaction 必须进入明确 terminal 状态，不能遗留可迟到响应的
内存 callback。

### 7.2 Single accepted resolution 与幂等

“Exactly once”在本 contract 中准确指 **single accepted terminal resolution**，不宣称网络只
投递一次。Client 可以携带稳定 response identity 重试：

```text
同 interaction + 同 response identity + 同内容
  → 返回已接受结果，不再次送入 Runtime

同 interaction + 不同/冲突响应
  → INTERACTION_ALREADY_RESOLVED
```

过期返回 `INTERACTION_EXPIRED`，Run/cancel 收尾后返回 `INTERACTION_CANCELED`，无权限返回
`INTERACTION_RESPONDER_NOT_AUTHORIZED`。这些结果不得重新打开 Interaction。

### 7.3 Channel、policy 与 provenance

创建 Run 时必须能确定 authorized interaction channel/responder，或提供有边界、可审计的 policy
grant。多个 UI 可以观察同一 pending Interaction，但只有授权 responder/明确 takeover 流程可以
回答；不能采用“谁先点击谁拥有权限”。Resolution 至少记录 responder type、client/policy
identity、policy version/scope、response identity 与 resolved time。

```text
bounded policy covers request
  → policy resolution + provenance

authorized channel exists
  → durable pending + replay/notification

neither exists
  → INTERACTION_CHANNEL_UNAVAILABLE / fail closed
```

普通 question 不得由 Locus 猜答案；permission 超时不得默认 allow；auth-required 不得通过 generic
Interaction 传递 API key、OAuth token 或密码。认证只记录“需要认证/认证已在 main-side 安全流程
完成”等脱敏事实。

### 7.4 关闭窗口与 reconnect

Desktop 窗口关闭不删除 Interaction。C3 Host 继续运行时，托盘/菜单栏或已授权 consumer 可以收到
通知；Desktop 重开或 client reconnect 后按 durable event cursor 恢复同一个 Interaction。deadline
到期仍由 Host 推进，不能依赖某个 renderer timer。

### 7.5 单一 owner 与验收不变量

后续 change 必须用 Interaction owner 替代 Claude/Codex pending Map 与 renderer atom 的业务状态；
这些结构最多作为 waiter/UI projection，不能继续独立决定生命周期。验证至少证明：

1. Host/renderer reconnect 不会丢失 pending Interaction 事实；
2. 两个 client 竞态只能接受一个授权 resolution；
3. 同一回答重试幂等，冲突/迟到回答不能到达 native Runtime；
4. deadline、Run terminal 与 cancel 可以可靠关闭 pending Interaction；
5. policy 自动处理保存准确授权范围与 provenance；
6. 无 channel/无 grant 时 fail closed；
7. public event/ledger 已脱敏，raw secret 不离开 main-side owner；
8. Claude、Codex、headless 和外部 Session API 不各自维护 Interaction 状态机。

## 8. C6 — Handoff payload 与 provenance

> **Owner 决定（2026-08-25）：A+。** 跨 Engine Handoff 使用经过用户预览、删改、确认并
> 封存的最小 `HandoffEnvelope`；它只携带 positive allowlist 中的 goal/decision/constraint/
> open-question snapshot、选中可见消息、`ArtifactRef` / `DiffRef` 与 authoritative workspace
> provenance。目标 Engine 在信息不足时，可凭有范围、只读、有期限、可撤销和可审计的
> `HandoffContextGrant`，按需回查 Locus 保存的来源事实。每个结果必须返回 source reference、
> digest、时间与 authority/redaction provenance。回查不启动来源 Engine；要求来源 Engine
> 重新分析或执行必须创建显式的新 Run。Hidden reasoning、完整 raw logs/tool payload、secret、
> native session state 与旧 permission/auth grant 都不得交接。

### 8.1 Handoff identity 与封存语义

Handoff 是同一 Conversation 内从 source SessionBinding 到 target SessionBinding 的显式交接。
目标始终创建新的 Runtime-native session；不能拿一个 Runtime 的 native identity 去伪造另一个
Runtime 的 resume。Handoff 不创建新 Conversation，也不等于 same-Runtime fork。

```text
Conversation conv_001
├── source Binding: Codex binding_1
│    └── Run run_42
├── Handoff handoff_7
│    ├── sealed Envelope v1
│    └── scoped ContextGrant
└── target Binding: Claude binding_2
     └── new native session
```

Handoff 至少有独立 `handoffId`，并能表达：

```text
draft → confirmed → consumed
  └───────────────→ canceled
```

- `draft` 可以由用户预览、删改；
- `confirmed` 后 payload 封存并计算 digest；
- 已封存内容不得原地改写，修改必须产生新 envelope version；
- `consumed` 记录准确 target Binding/native session；
- `canceled` 不得再授权新的 materialization 或 query。

Envelope 至少记录 `schemaVersion`、version、payload digest、source/target Conversation 与 Binding、
相关 Run、实际 RuntimeInstallation、`asOfEventCursor`、创建者/生成方式、确认者与时间。AI 生成的
摘要必须标明 derived；用户编辑和确认不能被记录成“Runtime 原始事实”。

### 8.2 Payload positive allowlist

默认只允许以下内容进入 envelope：

- 带来源标签的 goal、decision、constraint 与 open question snapshot；
- 用户明确选择的可见 user/assistant message reference + 脱敏 snapshot/digest；
- 经 Host 校验的 content-addressed `ArtifactRef` / `DiffRef`；
- authoritative `WorkspaceExecutionContext` snapshot，包括逻辑 repository/workspace identity、
  registered root/worktree、branch/base/head、captured time 与必要 isolation provenance；
- envelope schema 所定义的安全、有限扩展。

这些 goal/decision 只是交接时点的来源快照，不使 Locus 拥有 Career Kit、Amadeus 或其他 consumer
的 Goal/Task lifecycle。Artifact/Diff 的公共引用使用 opaque identity；目标 Runtime 不直接得到
任意本机绝对路径，materialize 前必须校验 root、ACL、digest、类型、大小与 token budget。

默认禁止：

- hidden reasoning、Thinking 或 chain-of-thought；
- 完整 Runtime-native transcript/session file 与可伪造 resume 的内部状态；
- 未经提升和脱敏的 raw tool input/output、provider metadata、完整 event/result/log；
- API key、OAuth token、password、auth header、secret-bearing env；
- 来源 Binding 的 permission、approval、auth 或 policy grant；
- consumer 私有业务记录的无边界复制。

必须从 allowlist 组装 payload，不能先复制 broad message/event JSON 再依赖黑名单删除。

### 8.3 Scoped source-backed query

目标 Binding 只能通过显式 `HandoffContextGrant` 查询来源。Grant 至少限定：

| 维度 | 最低要求 |
| --- | --- |
| subject | target Binding、client principal、runtime installation |
| source scope | Conversation、source Binding/Run、允许的 message/event/artifact kinds |
| operation | `search`、`get`、artifact read 分开授权；默认只读 |
| budget | result count、bytes/chars/tokens、单项大小、query count、timeout |
| lifetime | issued/expiry、revocation 与 Handoff lifecycle |
| safety | allowlist、redaction policy/version、user/workspace/consumer isolation |
| audit | grant/query identity、调用方、命中 source refs 与时间 |

来源 Engine 不必在线。Resolver 查询的是 RuntimeHost/common core 已保存并有权解释的 canonical
records，不是向来源 Engine 提问，也不读取 vendor 私有数据库/session 文件。默认查询
`asOfEventCursor` 对应的封存视图，避免来源 Conversation 后续变化让同一 Handoff 静默得到不同
事实；若以后允许查询“最新内容”，必须是单独、显式的 scope。

每个 query result 至少包含：

```text
sourceRef / sourceKind
sourceDigest
bounded content or snippet
authoredAt / capturedAt / validity when applicable
authority: canonical | derived
redactionApplied + policyVersion
retrieval metadata
```

检索排名或 derived summary 只能帮助定位，不能覆盖 canonical source。冲突时必须保留并展示
来源与时间，而不是静默挑一个答案。无 grant、越权、source deleted、digest mismatch、stale
index 与 budget exceeded 必须返回可区分的结构化结果，不得扩大 scope 或偷偷 fallback。

查询到的旧消息、artifact 和 repository text 都是 **不可信引用材料**，不得提升为 system/
developer instruction。Audit 保存脱敏 query metadata 与 result refs，不复制完整敏感 query/result
形成第二份 ledger。Source 删除必须使 derived index/cache 失效；如需在 source 删除后保留某个
sanitized snapshot，必须在 Handoff 时明确 retention 和用户可见含义。

### 8.4 回查与重新询问来源 Engine

| 动作 | 语义 | Run / lease 行为 |
| --- | --- | --- |
| source-backed query | 读取已经存在的 Locus source fact/artifact | 不创建来源 Run，不占来源 Binding lease |
| cross-engine delegation | 让来源 Engine 再分析、回答或执行 | 创建新 Run；遵守 C4 lease、C5 Interaction、费用与用户授权 |

例如 Claude 接到“migration 测试失败”的摘要后，可以回查 source Run 的脱敏错误、选中 artifact 和
用户决定；这不启动 Codex。如果用户要求“让 Codex 重新分析”，才在 Codex Binding 上创建新的
Run。两个动作不得共用一个含糊 API，也不得把付费/可变更 workspace 的执行伪装成 memory lookup。

### 8.5 与通用 Agent Memory 的边界

C6 只批准 Handoff-bound source retrieval，不批准通用 Agent Memory、persona、跨项目偏好提炼、
自动 experience consolidation 或 memory provider。将来如做 derived index/memory，它只能从
canonical records 派生、保留 source refs/digests、可删除和重建，不能成为第二套 execution truth。

相关开源项目研究已记录但按 Owner 决定延期讨论；它不是当前 C6 的实现前置或排期承诺。

### 8.6 Canonical owner、当前路径与验收不变量

Handoff 与 Context Resolver 必须由 RuntimeHost/common core 的唯一 owner 管理；renderer、Runtime
adapter 与 consumer 只能调用它，不能直接读取 Locus SQLite 或各自实现授权、封存、检索和状态机。

当前 renderer 的 “Continue with Engine” 会截取最多 50k 字符历史、创建新 `sub_chat` 并使用
临时 long-text attachment。它不是 durable Handoff，且与 C1 的同一 Conversation 语义冲突。
未来 approved OpenSpec 落地 C6 时必须替换并删除该路径及旧 call sites，不能保留旧/新双实现。

未来相关 change 的验证至少证明：

1. Handoff 保持同一 `conversationId`，并创建准确 target Binding/native session；
2. confirmed envelope 封存、versioned、content-addressed，不能原地漂移；
3. payload 由 allowlist 组装，hidden/raw/secret/native state 不会泄漏；
4. target RuntimeInstallation、source/target/run 与 workspace provenance 可追踪；
5. ContextGrant 正确执行 subject、scope、operation、expiry、revocation 和 budget；
6. query result 带准确 source ref/digest/time/authority/redaction，derived 不覆盖 canonical；
7. Handoff 不继承 permission/auth grant，引用内容不能提升为可信指令；
8. source Engine 离线仍可回查；回查不会隐式创建 Run 或取得 lease；
9. 重新询问来源 Engine 创建显式新 Run，并遵守 C4/C5；
10. source 删除、digest mismatch、stale index 和越权都 fail closed；
11. Desktop、headless、Session API 与 consumer 不各自实现 Handoff/Resolver；
12. 当前 renderer history-attachment Engine 切换路径已被替换，不存在双实现。

## 9. C7 — Public/internal API evolution

> **Owner 决定（2026-08-25）：A。** Internal API 以新的 canonical standard 原子替换：同一个
> change 更新全部内部调用并删除旧定义、旧 helper 和旧入口，不保留 compatibility layer。
> Local Job API、未来 Session API、公开 CLI/SDK/schema/event/error，以及独立版本的
> app↔Runtime protocol 属于 public/versioned boundary；每个可能影响 consumer 的 change 必须在
> 实现前提交完整 `Consumer Impact`。由 Owner **逐 change** 选择直接采用新标准、发布新版本，
> 或保留有删除条件的薄 compatibility facade。没有默认永久兼容承诺，也不能由 AI 自行决定
> breaking。任何 facade 只能做 old contract ↔ new contract 的协议翻译并调用同一 canonical
> core，不得保留旧 core、旧数据库、旧 worker 或第二套状态机。公共层采用 small common core +
> namespaced/versioned Runtime extensions。

### 9.1 三类边界必须先分类

#### Internal boundary

以下默认属于 Locus internal implementation，不对 consumer 承诺兼容：

- internal TypeScript types/functions/classes 与 module paths；
- main↔renderer 私有 tRPC/IPC procedure 和 renderer state projection；
- SQLite/Drizzle 表、列、索引与 test-profile derived state；
- internal service/repository/adapter interface；
- 同一 packaged Locus release 内未声明独立版本的进程间实现细节；
- Runtime-native adapter 内部 projection 和 vendor protocol handling。

Internal rename/extraction 必须原子完成。例如把内部 `agent_jobs` 语义收敛为 Run、或将当前
`sub_chats` owner 收敛为 Conversation 时，应同 change 更新全部内部 caller 并删除旧解释；不能为
“可能有人 import 源码”保留 alias。Consumer 本来就不应 import Locus 源码或读取 SQLite。

#### Public / independently versioned boundary

以下属于 C7 Gate：

- `locus api` 的 Local Job API request/response/event/result 与 machine-readable schema；
- 未来 Session API、HTTP/JSON-RPC/local socket、public SDK 与 generated client types；
- 对 consumer 承诺的 CLI command、exit code、stdout/JSONL 与 error code；
- consumer-visible artifact/reference、capability discovery 与 conformance fixture；
- 已声明为 public 的 webhook/event/extension schema；
- Runtime 独立安装/更新后形成的 app↔Runtime versioned protocol；
- 文档明确承诺供 Career Kit、Amadeus 或其他外部程序调用的 contract。

公开并不取决于是否已经有真实付费用户；只要 Locus 发布了可供外部程序依赖的 contract，就不能
因为当前数据可丢弃而静默改变它。

#### Runtime-native information

Codex/Claude/其他 Harness 的 native protocol 仍归 Runtime。Adapter 可以消费它们，但 Locus 不把
完整 raw union 直接升级为 public contract。需要公开的额外信息进入 namespaced/versioned
extension；其余保持 adapter internal。

### 9.2 什么算 public breaking change

不仅 schema rename 才算 breaking。以下任一变化都必须进入 Consumer Impact：

1. 删除/重命名字段、command、event、status、error 或 capability；
2. 改变 type、requiredness、nullable、enum、默认值或验证范围；
3. 改变 identity 语义，例如 `jobId` 实际对应什么、retry 是否产生新 identity；
4. 改变 lifecycle，例如 create 从等待 terminal 变成立即返回、cancel 的接受时点变化；
5. 改变 event ordering、cursor/replay、幂等、retry 或 terminal result 语义；
6. 改变 Runtime/provider/model/policy 默认选择或 unsupported/degraded 行为；
7. 改变 auth、permission、secret、filesystem/network、workspace 或 trust boundary；
8. 改变 artifact path/ref、digest、retention 或 consumer 可访问范围；
9. 改变 transport、Host discovery、启动/关闭方式或支持的平台组合；
10. 增加 consumer 必须理解的新 event/enum/extension，或改变“不认识时”的行为。

增加 optional 字段只有在现有 contract 明确允许 unknown optional fields、旧 consumer 可以安全忽略，
且没有改变默认行为时才是 non-breaking。仅仅“JSON 还能 parse”不代表语义兼容。

### 9.3 Consumer Impact 必填内容

Change author 使用 [Public Consumer Impact 模板](../consumer-impact-template.zh-CN.md)，至少列出：

- 受影响 contract/version、command/endpoint/SDK method；
- current 与 proposed request/response/event/error 示例；
- 字段、identity、状态机、ordering、默认值、安全边界等行为差异；
- 有证据的已知 consumer，以及 Career Kit/Amadeus/其他调用方所需修改；
- direct break、new version、temporary facade 的成本、风险与维护期限；
- 发布顺序、明确拒绝的版本组合、失败恢复和 rollback 目标；
- schema/contract/conformance/consumer verification 证据；
- 如选择 facade，其 canonical owner、migration gate、deprecation owner、删除日期/条件与
  architecture guard。

Locus 不需要替 Career Kit 或 Amadeus 维护通用业务 contract matrix。Locus 只负责提供清楚的公共
接入文档、schema、变更影响和 consumer-neutral fixtures；各 consumer 自己维护 adapter、业务
逻辑与 E2E。Change author 必须列出现有证据，未知写 `unknown`，不能把“没有矩阵”等同于“没有
consumer”。

Consumer Impact 是实现前的 Red Gate。Owner 尚未选择时，只阻塞触及该 public boundary 的部分；
它不是要求 Owner 审查每次 internal rename。

### 9.4 Owner 每次可以选择什么

| 选择 | 含义 | 适用情况 |
| --- | --- | --- |
| Direct new standard | 同步更新已知 consumer，不保留旧 public contract | consumer 少、可协调、旧版价值低 |
| New public version | 新旧 contract adapter 暂时并存，但都调用同一 core | consumer 需要分期迁移或协议语义明显变化 |
| Temporary facade | 保留旧 envelope/command 的薄翻译，带明确删除条件 | 变化可无损映射且短期兼容成本可接受 |
| Defer / reject | 不实施这次 breaking change | 收益不足、影响未知或无法安全兼容 |

这是逐 change 授权。一次选择兼容不代表以后所有 Local Job/Session API 变化都必须兼容；一次选择
direct break 也不授权其他 contract 静默 breaking。

Owner 选择发布新版本或 facade 时，必须满足仓库的临时双路径条件：明确 canonical owner、显式
migration flag/gate、deprecation owner/comment、删除日期或客观 removal condition、contract tests
与 architecture guard。若无法写出删除条件，就不能称为“临时”。

### 9.5 Compatibility facade 允许与禁止的职责

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

```text
allowed
old public contract ──translate──► canonical core ◄──translate── new public contract

forbidden
old contract ──► old core/DB/worker
new contract ──► new core/DB/worker
```

### 9.6 Local Job API v1 与新 Session API

`locus.local-job.v1` 当前是正式 public contract：`locus api` CLI、JSON/JSONL envelope、schema、
consumer guide 与 tests 都对它作出承诺。C2 已确认其中的 `Job/jobId` 是 canonical Run 的 v1
projection，不是第二个 Job domain。

C7 的具体含义是：

- 当前 v1 在另一个 approved Consumer Impact 决定前仍是有效 public contract，不能顺手 breaking；
- 这不是“永久保持 v1”的保证；未来每次实际 breaking 由 Owner 选择 direct、new version 或 facade；
- Job API 可以继续作为 batch/convenience surface，内部调用同一 async Run core；
- 当前同步 `runs create` 应成为同一 async submit + wait 的薄 wrapper，不能保留同步 worker/core；
- 新 Session API 从 `locus.session.v1` 的 clean canonical vocabulary 开始，不需要复制 `jobId` 等
  legacy naming；
- Job API 与 Session API 可以因 batch/interactive 职责不同同时存在，但必须共享 Run、Event、
  Interaction、SessionBinding、policy、artifact 和 Runtime dispatch owner。

例一：内部重命名不影响 consumer：

```text
internal agent_jobs.id → canonical Run storage
public locus.local-job.v1 still returns jobId
```

这不需要两套 Run；`jobId` 只是 v1 serializer 对同一个 `runId` 的字段投影。

例二：希望 public 也改名：

```json
// current v1
{ "apiVersion": "locus.local-job.v1", "jobId": "run_123" }

// proposed clean contract
{ "apiVersion": "locus.session.v1", "runId": "run_123" }
```

这会影响 consumer，必须提交 Consumer Impact。Owner 可以要求 Amadeus/Career Kit 同步升级并直接
采用新标准，也可以暂留 `jobId ↔ runId` 薄翻译；AI 不能从“底层 ID 相同”推断为 non-breaking。

例三：create 从同步变为异步：

```text
public v1 create: submit canonical Run → wait terminal → return
public Session v1: submit canonical Run → immediate runId → stream/watch
```

二者是同一 Run owner 的两种 public operation，不是两个 execution engine。若要改变 v1 的等待
语义，仍属于 breaking change。

### 9.7 Small common core + versioned Runtime extensions

所有 public client 至少可以只依赖 common core：

- Conversation / SessionBinding / Run / event cursor identity；
- start/submit/status/cancel/terminal lifecycle；
- started/delta/completed 与 durable replay；
- Interaction requested/resolved/expired；
- artifact/diff/structured result/error；
- capability 与 contract version negotiation。

Runtime-native extra 必须：

- 使用稳定 namespace + schema version；
- 声明 stable/experimental/deprecated maturity；
- 在进入 public event/renderer/ledger 前脱敏；
- 不改变 common lifecycle 的同名语义；
- consumer 不认识 optional extension 时仍可安全依赖 common core；
- consumer 声明 required extension 而 Host 不支持时 fail closed；
- 不把 unknown extension 当 supported，也不自动 downgrade。

示意结构，不在 C7 固定最终字段名：

```json
{
  "runId": "run_123",
  "type": "tool_started",
  "extensions": {
    "runtime.codex.v1": {
      "nativeItemType": "..."
    }
  }
}
```

完整 raw Codex/Claude event union 不能因为放进 `payload: unknown` 就获得稳定 public contract 身份。

### 9.8 Version negotiation 与错误

- Request 必须声明准确 contract version；Host 必须能 discovery 自己支持的 versions/features/
  extensions；
- unsupported contract、unsupported required extension 与 unsupported capability 使用可区分错误；
- 不允许把未知版本猜成“最接近版本”，也不允许 silent downgrade；
- public schema、文档、examples、generated types、error semantics 与 conformance fixtures 必须同 change
  更新；
- 一个版本内的 additive change 是否安全，由该版本预先声明的 unknown-field/event 规则决定，不能
  事后假设所有 consumer 都会忽略。

### 9.9 决策文档不替代真实 public contract 文档

本文 C7 与 Consumer Impact 模板只规定“如何决定和发布变化”，它们本身不是未来 Session API 或
其他公共 API 的 normative contract，也不能作为“API 已交付”的证据。

每个真正发布的 public contract/version 必须像现有 `locus.local-job.v1` 一样，另行提供并保持
一致的成品材料：

- 稳定 contract ID/version 与 machine-readable schema；
- 面向 consumer 的接入手册和 command/endpoint/SDK reference；
- request/response/event/error、lifecycle、ordering、retry/cancel/idempotency 语义；
- current、edge case、failure 与 upgrade 示例；
- generated types/SDK（若该版本承诺提供）；
- contract tests、consumer-neutral conformance fixtures 与 packaged/transport evidence；
- changelog、supported version/extension discovery 与明确的 compatibility/sunset 状态。

未来 `locus.session.v1` 必须形成自己独立的上述文档/schema/test 集合；不能要求 Career Kit、Amadeus
从本规划文档或 Locus 源码推断真实调用合同。规划、proposal 或尚未实现的 schema 也不得被写成
“已发布 public API”。

### 9.10 C7 验收不变量

未来相关 change 至少证明：

1. internal old definition/call sites 已原子删除，没有 compatibility alias 或双业务路径；
2. public impact 已准确分类，没有把语义 breaking 伪装成 internal refactor/additive JSON；
3. Consumer Impact 在实现前得到 Owner 对准确 scope 的决定；
4. 已知 consumer 修改、未知项、发布顺序和版本组合写明；
5. compatibility facade 只翻译协议并调用同一 canonical core；
6. facade 有 migration gate、owner、deprecation、删除条件、tests 和 architecture guard；
7. Job/Session/Desktop/headless 不建立独立 Run/Event/Interaction/Binding owner；
8. `locus.local-job.v1` 的 Job 仍只是 Run projection；
9. new Session API 使用 clean canonical vocabulary，不复制 legacy domain；
10. Runtime extension namespaced/versioned/redacted，unknown/required 行为明确；
11. unsupported version/extension/capability fail closed，不 silent downgrade；
12. schema、docs、examples、errors、contract tests 和 conformance evidence 一致。
13. 每个已发布 public version 有独立 normative contract 文档/schema/tests，决策文档没有冒充成品。

## 10. C8 — Runtime 更新与受认证交付

> **Owner 决定（2026-08-25）：A+。** Locus 建设一套共同的、side-by-side、可认证、可回退、
> 由用户策略控制的 Runtime 交付机制，并保留安装包内 immutable bundled known-good。Codex
> 子方案为 **A**：受认证的官方 Codex executable 直接由 Locus Host 内唯一 **app-server
> protocol adapter** 通过 stdio 驱动，不增加 Locus Codex Worker；当前 normative
> `codex exec` batch surface 在独立迁移获批前仍显式存在。Claude 子方案为 **A**：把 thin Worker、
> 准确的官方 Agent SDK release 及该 SDK 官方配对的平台 Claude Code executable 作为一个原子
> RuntimeInstallation。任何 upstream latest、PATH binary、未认证 candidate 或运行中静默换版
> 都不允许。

C8 解决的是“Runtime 能否不随 Desktop 一起发布”，不是承诺 Locus 兼容每个上游版本。若候选
Runtime 改变了 Locus adapter 所需的协议，候选必须保持 quarantined，等相应 Locus Host/adapter
change 发布并重新认证；不得靠忽略未知行为或强行激活来假装解耦。

### 10.1 共同交付流水线

```text
vendor release
  → trusted certification pipeline
  → signed Locus catalog / exact source + digest + evidence
  → side-by-side candidate download
  → actual version + platform/arch + payload verification
  → schema/protocol/security/lifecycle conformance
      ├── pass → certified installation
      │            └── user/update-policy activation for an execution profile
      │                  └── only future new Binding / standalone Run admission uses it
      └── fail → quarantine with evidence

existing Binding / admitted Run ── remains pinned to its exact installation
bundled known-good ── registered through the same resolver and retained for recovery
```

Digest 只证明“拿到的 bytes 与 catalog 一致”，不能单独证明 catalog 可信。Catalog/evidence 必须
由 Locus release trust root 签名，并定义 key ID、rotation、revocation 与 anti-rollback/version
规则；能使用 vendor artifact signature/checksum 时还要验证 vendor provenance。若上游没有可验证
签名，受控 Locus certification pipeline 从官方来源获取成品、计算 digest、完成认证，再签署
catalog；客户端不能同时从同一个未认证渠道下载 payload 和自报 digest 后就信任它。

发现候选、下载候选与激活候选是三个不同动作：

- 候选检查可以由用户选择手动或后台执行；
- 下载与激活必须由一次明确操作，或由用户事先明确选择的 channel/update policy 授权；
- UI 必须显示 source、actual version、认证结果、active/previous/bundled 状态和回退影响；
- 即使用户选择自动策略，也只能激活 Locus-certified candidate，不能把 upstream latest 或 PATH
  当作隐含授权；
- 激活指针至少按 `runtimeId + resolution purpose/execution profile + channel/platform` 解析；
  execution profile 指针只改变以后新建 Binding 或 standalone Run admission 的默认 installation；
  C4.2 已有 Binding、admitted Run、continue、retry 不原地换版。

### 10.2 RuntimeInstallation 与唯一 resolver

`RuntimeInstallation` 是 immutable、内容可验证的实际成品身份。规范记录至少包括：

- `runtimeInstallationId`、`runtimeId`、release source 与 payload manifest；
- actual version、cryptographic digest、platform、architecture 与 verified path；
- payload composition；
- 与之认证的 Host adapter/protocol/schema identity；
- 按 execution profile/capability 记录的 conformance eligibility matrix，而不是一个笼统
  `certified=true`；
- conformance suite/evidence identity、签名 key、certified time 与 certification result；
- security revoke/quarantine provenance。

安装状态与选择角色不能混为一个布尔值：

| 维度 | 示例 | 含义 |
| --- | --- | --- |
| candidate/certification state | discovered、downloaded、verified、partially-certified、certified、quarantined、revoked | 该 immutable installation 及各 execution surface 经历了什么 |
| selection role | active、previous、bundled known-good | 当前 resolution purpose/execution profile 对新 Binding/Run、管理操作和恢复使用的指针/角色 |
| usage relation | pinned by Binding/Run | 哪些 durable execution facts 正在引用它 |

每个 per-userData profile 只有一个 canonical `RuntimeInstallationRegistry/Resolver`。Bundled
Runtime 也必须注册进同一 registry，由同一 resolver 解析；Desktop、headless、auth/login、
status/readiness、MCP/plugin/command helper 与未来 Session API 都不得各自寻找 binary 或读取一套
版本常量。

P1 只落地**尚未接入 production selector**的共同 registry/resolver implementation、storage 与
trust/certification model；测试 harness 可以使用，production 仍只有当时的旧 canonical resolver。
到 P2/P3 为某个 Runtime cutover 时，同一个 change 必须把该 Runtime 的全部 production resolution
call sites 原子切换到共同 resolver，并删除其旧 bundled/PATH helper。这样允许分期，又不会出现
“新 registry 与旧 helper 同时参与 production selection”的双路径。

每次 resolve 都必须带明确 context，禁止只凭 `runtimeId` 猜“当前 binary”：

| Resolution context | 选择规则 |
| --- | --- |
| Binding/Run-scoped operation | 使用 durable fact 已记录的准确 installation pin |
| 新 execution admission | 使用明确 execution profile 的 active certified installation |
| profile-scoped management（auth/login、MCP/plugin/command 等） | 调用方明确给 profile 或 installation；设置页可使用显式 `management` purpose，不能借用不明 active |
| runtime-wide status/readiness | 聚合列出各 profile/purpose 的 installation、eligibility 与健康状态，不执行一次含糊的单 binary probe |

若一个 helper 同时影响多个 profile，它必须逐一解析/报告目标并在版本不一致时显示 split state；
不得任意选择其中一个 installation 后把结果冒充整个 Runtime 状态。

完整平台级 schema/protocol/live conformance 在受控 Locus release CI/认证基础设施执行，使用隔离的
测试凭据并发布签名 evidence。客户端激活时只做签名链、digest、actual version、platform/arch、
anti-rollback 和 bounded offline/local startup 检查；不得为了后台更新而隐式使用用户 provider
credentials、创建计费 turn 或访问其真实 workspace。需要 live diagnostics 时必须由用户显式发起，
并与 release certification evidence 区分。

回退只是把相应 execution profile 的 active pointer 指向上一份仍 certified 且与**当前 Host**
兼容的 installation，并只影响未来 Binding/Run admission。
被 Binding/Run pin 的 installation 不得被普通 GC 删除。若 installation 因安全事件被 revoke，
相关 Binding 必须明确 blocked/fail closed，由用户选择恢复、迁移或关闭；不得静默换成 latest。

每次 Locus Host/Desktop release 也必须反向验证它声称支持的 bundled、active、previous 和仍在支持
窗口内的 pinned installation，包括 Codex Host adapter↔executable schema，以及 Claude Host↔Worker
protocol。若新 Host 不再兼容某个已知 pin，release/upgrade 必须明确缩小 support matrix并要求
successor migration，或保持一个**共同业务 core 内**的协议兼容 projection；不能继续显示该版本
“可回退”却在使用时才崩溃。Runtime rollback 若还需要 Host rollback，也必须准确标成整套 Locus
recovery，而不能伪装成一次独立 Runtime pointer rollback。

### 10.3 C8-Codex — 官方 executable + Host 内唯一 app-server adapter

> **Owner 决定（2026-08-25）：A。** Codex 的 atomic Runtime payload 是准确的官方 Codex
> executable；Locus Codex adapter 仍由 Host 代码拥有，并通过该 verified executable 的
> `app-server` stdio 接口运行。Codex executable 已经提供官方 subprocess boundary，因此当前
> 不再增加一层 Locus Codex Worker。

```text
RuntimeHost
  └── one Locus Codex app-server adapter / Run mapping / approval mapping
        └── verified Codex executable
              └── codex app-server --listen stdio://
                    └── native Thread / Turn / Item
```

官方将 app-server 定位为 rich client 的深度产品接入面，覆盖 authentication、conversation
history、approvals 与 streamed events；stdio 是默认的 JSONL transport。CLI 还能为**正在运行的
准确 Codex 版本**生成 TypeScript/JSON Schema。因此每个 Codex candidate 至少必须：

1. 验证来源、digest、platform/arch 与真实 `codex --version`；
2. 从准确 candidate 生成/核对 app-server schema，并保存稳定 schema identity/digest；
3. 检查 Locus 所需 method、request、notification、approval 与 error projection；
4. 使用准确 candidate executable 跑真实 startup、thread/turn、event、approval/deny、cancel、
   resume、MCP readiness 与 failure conformance；
5. 在 `codex exec` batch surface 尚未迁移期间，另跑 argv/stdin、JSONL、sandbox/approval preset、
   provider binding、cancel/signal、exit code、resume 与 Local Job v1 projection conformance；
6. 按 `app-server-rich`、`app-server-policy-grant`、`exec-batch` 等 execution profile 分别记录
   eligibility；某一 profile 失败不能被另一个 profile 的通过结果掩盖，也不能移动该 profile 的
   active pointer；
7. schema-compatible 但行为 conformance 失败时同样 quarantine/degrade 对应 profile；
8. 把实际 `runtimeInstallationId`、execution profile 与 schema/conformance identity 写入
   Binding/Run provenance。

Codex adapter 属于 Host，而不是 candidate payload。若新 Codex 需要修改 adapter，用户仍需等待
Locus Host 更新；这属于诚实的 compatibility boundary，不是交付机制失败。Desktop rich-chat
不得新增 Codex SDK、`codex exec` 或 PATH fallback；未来若确实要把 adapter 移进 Worker，必须
通过单独 Owner 决策和原子迁移完成，同时删除 Host 内旧 adapter，不能让两套 approval/event/
resume 语义并存。

参考：[Codex app-server 官方文档](https://developers.openai.com/codex/app-server/)。

### 10.4 `codex exec` 的临时边界与已确认目标

> **Owner 方向确认（2026-08-25）：** 当前 headless 普通 batch 使用 `codex exec` 是已知临时
> 路径；目标是让 Desktop 与 headless 最终收敛到同一个 **Codex app-server Run core**。
> 本次只确认目标，不在 C8 中提前拍定迁移步骤、batch projection 或删除时点；这些内容稍后
> 作为独立子决策/OpenSpec 讨论。

**仓库核查后的重要校正：** 在本次 Owner 表态之前，仓库中并不存在一份已经批准的
`codex exec → app-server` 删除/迁移计划。当前 normative specs 反而明确保留 `codex exec` 作为
headless batch/fallback，并要求 rich adapter 不得被静默选中。因此，上述文字是
**2026-08-25 新记录的长期产品方向**，不是对既有计划的复述，也没有立即覆盖当前 specs 或授权代码迁移。
当前规范继续生效，直至后续 proposal 明确提交 spec delta、Consumer Impact、parity evidence 和
旧路径删除方案并得到 Owner 批准。

当前与目标应明确区分：

```text
CURRENT
  Desktop rich run ───────────────→ app-server adapter
  Headless policy-grant run ──────→ app-server adapter projection
  Headless ordinary batch run ────→ codex exec                 # temporary

TARGET
  Desktop / Headless / Session API entrypoints
                  └───────────────→ one Codex app-server Run core
                                      ├── rich interactive projection
                                      └── batch/non-interactive projection
```

在后续迁移决定前：

- 当前 `codex exec` batch selection 与 app-server rich/policy-grant selection 继续遵守现行 specs；
  两者共享 canonical Run/Event/Policy/RuntimeHost owner，但暂时仍是不同 vendor adapter surface；
- `codex exec` 不得扩展成第二套 durable Run/Event/Interaction/Binding owner，也不得成为 Desktop
  app-server 失败时的静默 fallback；
- C8 的 installation resolver 必须覆盖它，使临时路径也运行 request/Run（以及适用时 Binding）
  指定的准确 verified executable；这不表示认可它成为长期第二内核；
- 长期 target 中 shared app-server Run core 直接服务 Desktop 与 headless，entrypoint 只做
  transport/profile projection，不能把 synthetic Desktop request 继续当永久架构；
- 后续子决策必须逐项处理 batch 的 stdin/stdout/JSONL、resume、sandbox/approval、cancel、event
  completeness、错误/exit code、性能与 Local Job v1 conformance；
- 迁移 change 必须给出 parity gate、唯一 canonical owner、旧 `codex exec` call-site 删除条件、
  architecture guard 与 rollback；未确认这些内容前，不能把目标写成“已经完成”。

官方仍将 `codex exec` 定义为 scripts/CI 的 non-interactive mode；Locus 的收敛决定不是否定该
上游工具，而是为了在 Locus 内避免 Desktop/headless 长期拥有两套 Run 语义。参考：
[Codex non-interactive mode 官方文档](https://developers.openai.com/codex/noninteractive/)。

### 10.5 C8-Claude — thin Worker + 官方 SDK release 原子安装

> **Owner 决定（2026-08-25）：A。** Claude 的独立交付单元不是一个任意 Claude Code binary，
> 而是 `thin Locus Claude Runtime Worker + exact official Agent SDK release + 该 SDK 官方配对的
> platform Claude Code executable`。三者按同一个 RuntimeInstallation 被来源校验、认证、安装、
> 激活和回退。

```text
RuntimeHost
  └── stable, versioned Locus runtime-adapter protocol
        └── thin Claude Runtime Worker
              └── exact official Agent SDK release
                    └── SDK-declared platform Claude Code executable
```

官方 Agent SDK release 是 pairing 的 atomic version source；Locus 必须读取并验证该 release 的
官方 package metadata/成品内容，不能从版本字符串后缀猜 SDK 与 CLI 是否匹配，也不能用旧 SDK
加载任意 latest CLI。Worker 与 SDK 代码运行在 Electron Host 之外；不得把下载的 SDK JavaScript
动态加载进 Electron main process。

迁移必须经过三道 gate，不能一边抽取一边升级：

1. 用当前已知 SDK/executable pair 构成 Worker bundle，并从一开始作为 **inactive candidate**
   注册到 P1 共同 registry；只有 conformance harness 可以解析它，production selector 不可见；
2. 对现有 Desktop SDK 与 headless `claude -p` 所承诺的 session/batch、stream、interaction、
   cancel、error、provider 与 recovery 语义完成 parity 后，原子切换所有 Claude production
   call sites 到 Worker，并在同一 change 删除旧 in-process SDK/CLI adapter 业务路径；该 change
   必须提交现行 batch surface 的 spec delta 与适用的 Consumer Impact；
3. 只有唯一 Worker production path 稳定后，才开放后续版本的 side-by-side candidate
   download/certification/update。

Host 继续拥有 durable Conversation/Binding/Run/Interaction、policy、authorization、ledger 与
workspace boundary；Worker 只拥有 vendor protocol translation、native session 调用与 Runtime
进程生命周期。Worker 进程隔离本身不是 sandbox，也不能自行批准 tool/permission。若稳定 adapter
protocol 需要 breaking change，必须按 C7 独立 version、提供 schema/docs/fixtures/conformance，
并由 Consumer Impact 决定迁移；本文不是该未来 protocol 的成品合同。

### 10.6 分期实施顺序

C8 ratification 不授权立即改产品代码。后续 OpenSpec 应按依赖拆分：

1. **P0 — version truth：** single-source release manifest、实际成品 `--version`、Windows/macOS
   package drift gate；
2. **P1 — inactive common delivery core：** 建立尚未参与 production selection 的 registry/
   resolver、catalog/trust、side-by-side storage、certification evidence、activation/rollback 与
   pin/GC model；
3. **P2 — Codex delivery：** 直接 app-server candidate schema + live conformance；在 exec 仍存在
   时同时认证其 batch surface eligibility；同一 change 原子切换 Codex app-server、现行 exec、
   login/logout、status/readiness 与相关 MCP/plugin/command helper 的 production resolution，并
   删除全部 Codex 旧 helper；不新增 Worker；
4. **P3 — Claude process extraction：** 同版本 Worker bundle 先作为共同 registry 的 inactive
   candidate 完成 parity，再原子切换 Claude Desktop/headless/auth/status 相关 production caller
   并删除旧 SDK/CLI resolution/adapter path；随后才开放独立版本更新；
5. **P4 — operations：** channel policy、quarantine/revoke、recovery、audit、disk retention 与
   packaged macOS/Windows evidence。

`codex exec → shared app-server Run core` 的精确迁移 proposal 在独立讨论确认后插入以上依赖图；
它不能借 C8 delivery change 顺手实施。

### 10.7 C8 分期验收与完成不变量

每个后续 change 只需证明其 phase **适用** 的 gate，但不得宣称尚未完成的后续 phase 已通过：

| Phase | 当期最低证据 |
| --- | --- |
| P0 | actual packaged version/digest、single-source manifest、macOS/Windows drift check |
| P1 | signed trust chain、唯一 resolver implementation（尚未 production activation）、surface-scoped eligibility/activation、pin/rollback/GC 与 Host compatibility model |
| P2 | Codex app-server schema + live conformance；现行 exec batch 的独立 eligibility；所有 Codex caller 使用同一 resolver |
| P3 | inactive same-version Claude Worker parity、现行 spec delta、原子 cutover/delete、Host↔Worker version conformance |
| P4 | channel/revoke/recovery/audit/retention 与声明支持平台的 packaged evidence |

C8 delivery program 称为完成时，以下共同不变量必须全部成立：

1. packaged 成品的实际 Runtime version/digest 与 manifest/status 一致；
2. bundled、downloaded、Desktop、headless、auth/status/helper 共同使用唯一 installation resolver；
3. 不存在 PATH/latest、旧 bundled resolver 或同一 execution surface 内的重复 production
   selection；现行 `codex exec` batch 与 app-server rich/policy-grant surface 例外必须保持显式、
   能力诚实并等待独立迁移决定；
4. catalog/artifact/evidence trust chain、key rotation/revocation 与 anti-rollback 可验证；完整 live
   certification 在受控基础设施完成，客户端更新不隐式使用用户凭据；
5. 只有对应 execution profile 的来源、digest、schema/protocol/live conformance 通过，candidate
   才能获得该 profile eligibility/active role；
6. 激活只影响未来新 Binding/standalone Run admission；continue 与 retry 使用准确 pin；
7. previous/bundled recovery 可见、可审计且与当前 Host 真实兼容，普通 GC 不删除被引用 installation；
8. Codex app-server surface 直接使用 verified executable 的 stdio，不额外增加 Worker；
9. incompatible Codex candidate/profile 保持 quarantine/degraded，等待 Host adapter change；
10. Claude Worker、official SDK release 与其官方配对 executable 原子认证和回退；
11. Claude 先以 inactive 同版本 candidate 完成 parity，再原子 cutover/delete，最后允许独立更新；
12. Worker、Runtime 或 transport 不夺取 Host 的 policy、authorization 和 durable state ownership；
13. Host release 对仍声明支持/可回退的 installation 做反向 compatibility gate；
14. candidate failure、missing/revoked/incompatible pin 与恢复失败均 fail closed，并保存准确 evidence。

`codex exec → shared app-server Run core` 不属于 C8 delivery program 的完成条件。它的未来独立
migration gate 已在 10.4 定义：在 proposal 获批前不得改变当前 selection；获批实施时则必须
原子删除旧 call sites并用 architecture guard 证明只剩一个 Codex app-server Run core。

## 11. C9 — Consumer/platform acceptance

C9 已按两个不同问题分别确认：

- **C9.1 Consumer acceptance ownership：** Locus 的 release 是否默认等待 Career Kit/Amadeus；
- **C9.2 Platform support tier：** 哪些 OS 的 packaged acceptance 是 blocking gate。

### 11.1 当前证据基线

- `locus.local-job.v1` 已有稳定 ID、TypeScript types/validator、JSON Schema、中英文 consumer
  guide 和较强 source-level contract tests；但还没有外部 consumer/安装包可一条命令运行的独立
  golden conformance kit，schema 也尚未覆盖 guide 中全部 command/error envelope；
- public Session/Interaction contract 尚未发布：没有 `locus.session.v1` schema/guide、Interaction
  response API 或 batch/session/interaction/reconnect fixtures；当前 Local Job v1 仍是 batch/
  policy-grant surface；
- Ubuntu CI 目前证明 source lint/test/typecheck/build，不是 packaged Linux acceptance；Windows
  workflow 只 build/package/upload，未证明安装、启动、packaged CLI/API、签名、更新与卸载。
  已知 Runtime pin 直接漂移已经对齐，但版本仍分散且没有 single-source manifest 或打包后
  `--version` gate；macOS 没有完整 blocking workflow，现有 helper 包含
  allow-failure/manual steps；Linux 只有 package target；
- 当前没有 Career Kit 或 Amadeus 专属 release gate。Career Kit 只有可跳过的相邻仓库 smoke，
  Amadeus 只作为已知 consumer 记录。

所以“有 package target”“source tests 通过”或“某个 consumer 当前能跑”都不能代替公共合同与
真实 packaged artifact 的 acceptance evidence。

### 11.2 C9.1 — Consumer acceptance ownership

> **Owner 决定（2026-08-25）：A。** Locus 拥有 consumer-neutral public contract acceptance 与
> packaged conformance evidence；Career Kit、Amadeus 各自拥有 adapter、领域映射、业务 E2E 与
> 升级验收，默认不拥有 Locus release veto。只有双方另行把某 consumer 升级为 first-party
> supported integration 并明确版本/SLA/gate ownership，才增加其专属阻断门禁。

**A（已选择）：producer-owned、consumer-neutral。** Locus 为每个 public contract/version 发布
machine-runnable neutral conformance kit，并用真实 packaged artifact 跑同一套 fixtures。Career
Kit、Amadeus 在各自仓库拥有 adapter、领域映射、E2E 与升级验收；它们可以成为 non-blocking
canary，但默认没有永久 release veto。若 Locus 违反已发布 contract，Locus gate 失败；若 neutral
contract 全绿而某 consumer 的私有业务映射失败，由该 consumer 修复。某次 breaking change 仍
按 C7 Consumer Impact 由 Owner 决定同步升级顺序。

**B（未选择）：consumer-coupled first-party gate。** Locus CI/release 拉取 Career Kit、Amadeus 的真实
adapter/领域 E2E；任一失败或 consumer Owner 未批准，Locus 即使 neutral contract 全绿也不能
发布。只有双方明确把某 consumer 升级为 first-party supported integration，并约定版本、SLA、
secret/CI 与 gate ownership 时，才适合对该 consumer 选择 B。

### 11.3 C9.1 验收不变量

未来 public contract/release 相关 change 至少证明：

1. 每个已发布 public version 都有 consumer-neutral、machine-runnable conformance kit，不要求
   checkout Career Kit、Amadeus 或理解其 Goal/Task domain；
2. source-level contract tests 与声明支持平台的 packaged artifact 运行同一 public fixtures，
   evidence 绑定 contract version、git SHA、app/artifact/runtime digest、OS/arch 与日志；
3. `consumer.id` 只提供 attribution/provenance，不改变公共业务语义或选择 consumer-specific core；
4. 某 consumer failure 只有在证明 Locus 违反已发布 contract，或存在另行批准的 first-party
   integration contract 时，才成为 Locus blocking failure；否则记录为该 consumer 的 adapter/E2E；
5. public breaking change 仍按 C7 Consumer Impact 列出已知 consumer 影响、发布顺序与版本组合，
   但不建立由 Locus 永久维护的 consumer 内部依赖矩阵；
6. non-blocking consumer canary 不接触未授权 secret，也不能因外部仓库不可用把 neutral gate
   伪装成失败。

### 11.4 C9.2 — Platform support tier

> **Owner 决定（2026-08-25）：A。** macOS 与 Windows Desktop/Runtime Distribution 先作为
> Tier-1 blocking platforms；Linux Electron Desktop 保持 experimental/non-blocking。未来
> RuntimeHost/headless service 可以基于同一 core 和独立 packaged evidence 单独把 Linux Host
> surface 晋升 Tier-1，不要求同时承诺 Linux Desktop，也不得为平台另建业务实现路径。

`Tier-1 blocking` 是 **stable release candidate** 的机器门禁，不是每次 commit/merge 都要求 Owner
人工验收。日常开发、internal build 和 preview 可以继续；但一个 surface/platform 没有以下
evidence 时，不得把对应 artifact/channel 宣传成 stable supported：

- 从真实 release artifact 在 clean machine/VM 安装并启动，不是 source checkout；
- 验证 artifact trust/signature、app/runtime actual version、digest、platform/arch 与 release
  manifest；
- 从 packaged CLI/Host 跑同一套 consumer-neutral batch 与 interactive/session fixtures；
- 验证 Host restart/reconnect、Interaction resolution、pin/update/rollback、failure recovery；
- 验证 platform-native update/uninstall 与无用户数据/secret 泄漏；
- evidence 绑定准确 git SHA、artifact/runtime digest、OS image/arch、suite version 与日志。

在 pre-production 可以使用明确标记的 unsigned/internal artifact；进入 public stable channel 时，
macOS 还需要 Developer ID/notarization/staple，Windows 需要 Authenticode，Linux 需要该发行方式的
可验证 artifact/checksum/signature。签名失败不能以 allow-failure 通过 stable gate。

**A（已选择）：macOS + Windows 先做 Tier-1，Linux Desktop 为 experimental/non-blocking。**
整体 Runtime Distribution 只有 macOS 与 Windows packaged gates 都通过后才称 stable/complete；
Linux package/source CI 可以继续存在，但必须标成 experimental，失败不阻塞 macOS/Windows
stable。未来常驻 RuntimeHost/headless service 可以单独把 Linux Host surface 晋升 Tier-1，
不要求同时承诺 Linux Electron Desktop；晋升只增加同一 core 的 platform evidence，不新增业务
实现路径。

**B（未选择）：macOS + Windows + Linux 现在都做 Tier-1 blocking。** 任一平台的 packaged
fixture、签名/artifact trust、update 或 recovery 失败，整体 stable release 都不能完成。Linux 还必须先明确
有限支持矩阵，例如 Ubuntu LTS x64 + AppImage/deb；“Linux Tier-1”不能被解释成所有发行版、
桌面环境与架构。

选择 A 后仍不允许把 package target、source CI、Actions artifact 或手工 smoke 写成稳定平台
支持承诺。只有 macOS/Windows 对应 stable gate 的完整 packaged evidence 通过后，才能称
Runtime Distribution stable/complete；Linux Desktop artifact、文档、status 与错误信息必须一致
标注 experimental。若将来晋升 Linux Host/Desktop 或新增其他 Tier-1 平台，必须另行提交平台
support matrix、packaged fixtures、release/rollback evidence 和 Owner 决策。

### 11.5 C9 与全文 Ratification 结果

```text
Locus release acceptance
  ├── public contract gate
  │     └── Locus-owned consumer-neutral conformance
  │           ├── Career Kit adapter/E2E     # consumer-owned, default non-blocking
  │           └── Amadeus adapter/E2E        # consumer-owned, default non-blocking
  └── packaged platform gate
        ├── macOS Tier-1                     # stable blocking
        ├── Windows Tier-1                   # stable blocking
        └── Linux Desktop experimental       # non-blocking; no stable claim
```

C9.1=A 与 C9.2=A 完成后，C1–C9 全部 Owner confirmed，本文整体 `RATIFIED 2026-08-25`。
下一步不是直接修改产品代码，而是按 workflow 修正文档/协作入口、完成 active OpenSpec hygiene，
再为第一个架构 slice 创建并审批独立 OpenSpec proposal。

## 12. 当前事实依据

- 当前 schema：`src/main/lib/db/schema/index.ts`
- 当前 UI/core 命名决定：`docs/ideas/canonical-vocabulary.md`
- 当前 owner 边界：`docs/OWNERSHIP_MAP.md`
- 当前 Runtime preflight：`src/main/lib/agent-runtime/preflight.ts`
- 当前 Claude session persistence：`src/main/lib/claude/agent-sdk-message-persistence.ts`
- 当前 Codex event/session metadata：`src/main/lib/codex/app-server-stream-events.ts`
- 当前 Job/Run schema：`src/main/lib/db/schema/index.ts`
- 当前 retry owner：`src/main/lib/headless/job-store.ts`
- 当前 Desktop run identity：`src/main/lib/agent-runtime/desktop-run-request.ts`
- 当前 Local Job API v1：`docs/local-job-api-v1-consumer-guide.zh-CN.md`
- 当前 GUI/headless composition：`src/main/index.ts`
- 当前 renderer IPC client：`src/renderer/contexts/TRPCProvider.tsx`
- 当前 daemon worker：`src/main/lib/headless/daemon.ts`
- 当前 Runtime pins：`package.json`、`.github/workflows/package-windows.yml`
- 当前 Codex runtime resolution：`src/main/lib/codex/cli-path.ts`
- 当前 Codex desktop/batch surface boundary：`docs/OWNERSHIP_MAP.md`、
  `openspec/specs/architecture-ownership/spec.md`、`openspec/specs/codex-runtime-parity/spec.md`
- 当前 headless batch selection contract：`openspec/specs/headless-agent-jobs/spec.md`
- 当前 Claude SDK/runtime resolution：`src/main/lib/claude/agent-sdk-query-options.ts`
- 当前 Claude pending approval owner：`src/main/lib/claude/agent-sdk-permission-handler.ts`
- 当前 Codex approval projection：`src/main/lib/codex/app-server-approval.ts`
- 当前 renderer interaction projection：`src/renderer/features/agents/lib/runtime-event-state.ts`
- 当前 non-Desktop permission policy：`src/main/lib/headless/permission-policy.ts`
- 当前跨 Engine history attachment：`src/renderer/features/agents/main/active-chat.tsx`、
  `src/renderer/features/agents/lib/export-chat.ts`、`src/main/lib/long-text-attachments.ts`
- 当前 broad message schema：`src/shared/chat-message.ts`
- 延期的 Agent Memory 调研：`docs/ideas/locus-agent-memory-research.zh-CN.md`
- 当前 Local Job API contract/types：`src/shared/local-job-api.ts`
- 当前 Local Job API implementation：`src/main/lib/headless/local-job-api.ts`
- 当前 machine-readable schema：`docs/local-job-api-v1.schema.json`
- 当前 consumer guides：`docs/local-job-api-v1-consumer-guide.md`、
  `docs/local-job-api-v1-consumer-guide.zh-CN.md`
- 当前 contract tests：`tests/local-job-api.test.ts`、`tests/local-job-api-schema.test.ts`、
  `tests/headless-cli-dispatcher.test.ts`
- Consumer Impact 模板：`docs/consumer-impact-template.zh-CN.md`
