# Native Resume 与 Amadeus Event Gap Trace

- 日期：2026-09-04
- 状态：Phase 2 压缩版只读研究记录（non-normative）
- 代码基线：`34d9c3dbe7e233da7cd9924fad812ef53e537b02`
- 研究分支：`codex/investigate-native-resume-semantics`

本文记录 Claude Code 与 Codex app-server 的 native resume/attach 实验，以及
Amadeus/Codex app-server 到 Locus v1 事件词汇的缺口。它不是 SessionBinding API、迁移协议或
canonical event ledger 的最终规格；文末“Phase 3 输入”必须由后续 approved change 吸收后才有
产品约束力。

本次只在隔离的 `/tmp` 目录创建 runtime 实验状态、读取本地源码/已安装 runtime，并新增本文。
没有修改产品代码、测试、配置或 OpenSpec；本任务没有切换 main 或修改其 tracked 内容，没有 push
或远端仓库操作。
为精确审计仓库固定的 Codex 版本，实验从官方 GitHub release 读取 0.139.0 资产到 `/tmp`；没有
安装或复制它到仓库。Codex completed-turn 样本使用获授权凭据调用 provider，prompt 仅要求返回
固定 token，sandbox 为 read-only 且禁止工具/网络访问；临时 credential 已删除，未打印其内容。

## 0. 摘要

- **Claude handle validation**：在 2.1.177 上，只有与该请求关联的 `system/init` 加身份关系校验
  能证明 session/slice 被 loader 接受。普通 resume 的 init ID 必须等于 source；fork 必须得到
  不同的新 UUID。exit code、`result.subtype` 或“任意消息里有 session ID”都有实测反例。
- **Codex handle validation**：在 0.139/0.149 app-server 上，消费点是匹配 JSON-RPC request ID 的
  成功 `thread/resume` response，并核验 returned/requested thread ID、独立 session ID、durability
  与 installation/schema provenance。resume 不发 `thread/started`，status notification 又可早到。
- **restart/attach**：Claude 同版三个独立 subprocess 3/3 到达 init；Codex 两版 completed thread
  都能跨 app-server restart 恢复。Codex 同进程 active rejoin 可行；但独立 process B 对 A 的
  active thread 执行成功 resume 时，只得到离线 snapshot，未订阅 A 的后续事件，不能算 live
  attach。OS restart、SIGKILL/掉电和 Claude alpha bridge attach 未测。
- **version**：Codex completed-thread 的 0.139↔0.149 两个方向样本都加载成功；一个 failed-thread
  交叉样本发生历史语义降级。Claude 没有第二个真实版本可测。因此现有 Binding 仍必须固定精确
  RuntimeInstallation，跨版只能由版本/schema/conformance 明确放行，不能因一次 RPC 成功放宽。
- **failure**：两个 runtime 都能区分 malformed/missing/corrupt 的一部分情形，但“过期”均未真正
  复现。Claude 的 `No conversation found` 同时覆盖 missing、wrong cwd 和完全损坏，不能直接命名
  为 `SESSION_EXPIRED`。
- **Amadeus event gap**：Codex 0.139 schema 有 66 notifications / 10 server requests / 16 item
  variants；当前 edge mapper 仅识别 11/66。`tool_started/tool_delta/tool_finished`、权威 assistant
  final 对账和 Interaction resolution ledger 是 Phase 3 首要缺口；retryable error metadata 也会在
  canonical 化时丢失。native resume 返回 snapshot，不是 event replay。

## 1. 证据规则与范围

本文用以下标签避免把观察、源码解释与设计建议混为一谈：

- **实测事实**：本次在列明的 binary、环境和命令下直接观察到；后附复现命令与关键输出。
- **静态事实**：由当前基线源码、随 runtime 生成的 schema 或已安装 SDK 类型直接确认。
- **推断**：从实测/静态事实导出的安全结论或 Phase 3 需求输入，尚不是产品规格。
- **未测**：本轮环境或预算不能可靠覆盖，不以“看起来应该如此”代替结果。

“验证成功”在本文中特指：native runtime 已接受目标 session/thread，以及请求中指定的切片
位置（若有），可以把一次性 handle 从 `issued` 推进到 `consumed`。它不等于 provider 已完成
一次模型调用，也不等于 Locus Run 已成功。

版本与安装指纹：

| 目标 | 精确版本/来源 | SHA-256 | 证据 |
| --- | --- | --- | --- |
| Claude Agent SDK | repo pin `0.3.177` | 见 lockfile | `[ENV-01]`，静态事实 |
| Claude Code | SDK 配套 Linux glibc binary `2.1.177` | `ff41753634b20c869ef6a32a20863521b33d4186ac0d6a49379ab48a48395ee7` | `[ENV-01]`，实测事实 |
| Codex app-server | repo pin / 官方 release `0.139.0` | binary `0729aedf4fe72971d81ef6803c817b850d711254d3c82ecc756a52f3b533c9f8` | `[ENV-02]`，实测事实 |
| Codex comparison runtime | 本机 standalone `0.149.0` | `bbc3341e44c9ead340ed9570c17be936e37870f570751a941699ffd04d672827` | `[ENV-02]`，实测事实 |

环境限制：Claude Code 的隔离配置没有登录凭据；因此可以验证本地 transcript 发现、切片接受、
初始化和 pre-provider 失败，但不能声称完成了 Claude 模型上下文回忆。Codex 实验结果见第 3 节。

## 2. Claude Code native resume / attach

### 2.1 结论矩阵

| 问题 | 结论 | 分类/证据 |
| --- | --- | --- |
| session 如何标识 | 本地 session handle 是 UUID；SDK `options.resume` / CLI `--resume` 使用它。非 UUID 还可能被 CLI 当作 title 搜索，持久绑定不应保存 title | 实测事实 `[CLAUDE-01]`；静态事实 `[CLAUDE-SRC]` |
| slice 如何标识 | 切片 handle 是 transcript 中已有 assistant message 的 `uuid`；SDK `resumeSessionAt` 使用它。CLI 2.1.177 接受隐藏参数 `--resume-session-at`，但 help 不公开该参数 | 实测事实 `[CLAUDE-02]`；静态事实 `[CLAUDE-SRC]` |
| 普通 resume 验证 | 有效 session + 有效 slice 首先发 correlated `system/init`，且 `init.session_id === requested session UUID` | 实测事实 `[CLAUDE-02]` |
| fork resume 验证 | 有效 fork + slice 首先发 `system/init`；`init.session_id` 是不同于 source 的新 UUID，source transcript 不变，并生成 target transcript | 实测事实 `[CLAUDE-03]` |
| CLI 进程重启 | 同一隔离 config/cwd/transcript，三个独立进程 3/3 都先收到相同 source ID 的 init；transcript 行数 `2 → 9 → 18 → 25` | 实测事实 `[CLAUDE-04]` |
| 主机/容器重启 | 未执行 OS/容器重启；只覆盖全新 CLI subprocess | 未测 |
| cwd/project 变化 | transcript 在 cwd-A 创建后，从 cwd-B 用同 UUID resume 得到 `No conversation found`，无 init | 实测事实 `[CLAUDE-05]` |
| session 丢失 | 随机不存在的合法 UUID 得到 `No conversation found with session ID`，无 init | 实测事实 `[CLAUDE-06]` |
| 完全损坏 | 目标 JSONL 完全不可解析时，与不存在 session 相同：`No conversation found`，无 init | 实测事实 `[CLAUDE-06]` |
| 尾部部分损坏 | 有一条有效记录、尾部一条非法 JSON 时，loader 容忍损坏行、发 init，并继续追加同一文件 | 实测事实 `[CLAUDE-06]` |
| 过期 | 把 mtime 和内部 timestamp 调到约 65 天前后，显式 resume 仍发 init；未触发自动清理 | 实测事实 `[CLAUDE-06]` |
| 真正 cleanup 后 expiry | SDK 类型声明 `cleanupPeriodDays` 默认 30 天，但本轮没有运行/等待清理 scheduler 删除 session | 静态事实；未测 |
| runtime 版本变化 | 本机发现的 6 份 Claude binary 都是 2.1.177，没有真实跨版本样本 | 未测 `[CLAUDE-07]` |
| transcript version 字段 | 把合成 transcript 每条记录的 `version` 改成 `0.0.1`，2.1.177 仍发 init | 实测事实 `[CLAUDE-07]` |
| 本地 attach | 当前 Locus 的 `query()` resume 会启动 subprocess 并读取持久化 transcript，不是 attach 到现存本地进程 | 静态事实 `[CLAUDE-SRC]` |
| Bridge attach | SDK 另有 alpha bridge：`cse_*` ID、`attachBridgeSession`、SSE `initialSequenceNum`、`isConnected()`；当前 repo 没有导入它，本轮无 server/JWT | 静态事实 `[CLAUDE-SRC]`；动态行为未测 |

进程重启实验只证明当前版本能重新发现并接受本地 transcript。由于隔离 home 未认证，它**没有**
证明模型真正回忆此前语义。另一个直接观察是：即使 init 后认证失败，Claude 仍可能把 user/error
assistant 条目追加到 transcript；“resume 已验证但 turn 失败”不是无副作用重试。

真实跨版本未测不能由 `version:"0.0.1"` 实验替代。该实验只反证“loader 对每条 transcript 的
version 字段做简单严格相等拒绝”，不能证明两个真实 runtime 的 schema/行为兼容。

`bridge.d.ts` 还明确把 bridge 标为与主 `query()` 分离的 alpha versioning universe，breaking
change 不要求 package major bump。其 `onClose` 声明 401（JWT 过期）、4090（epoch 被替代）、
4091（初始化失败）、4092（未知 close）、403/404（永久 SSE 拒绝）；503/网络抖动则在 transport
内部无限 retry。本轮未连接 bridge，所以这些是静态 contract，不是动态可靠性结论，也不能套用到
Locus 当前的本地 transcript resume。

### 2.2 handle 消耗判据

在 Claude Code 2.1.177 / SDK 0.3.177 上，最可靠的已测 acceptance predicate 是：

```text
收到与当前 resume/fork 尝试关联的 message：
  type == "system"
  subtype == "init"
且：
  普通 resume: init.session_id == requestedSessionId
  fork resume: init.session_id 是合法新 UUID，且 != sourceSessionId
```

如果请求带 `resumeSessionAt`，这个 init 同时证明 loader 接受了 session 和目标 assistant UUID：
不存在或格式损坏的 slice 都在 init 之前失败。它仍只表示 **native resume validated**，不表示
turn 成功。

| 输入 | 首个 native 结果 | 有 init | transcript 追加 |
| --- | --- | ---: | ---: |
| 有效 session + 有效 assistant UUID | `system/init` | 是 | 是 |
| 有效 session + 不存在的 assistant UUID | `result/error_during_execution` | 否 | 否 |
| 有效 session + 格式损坏的 assistant UUID | `result/error_during_execution` | 否 | 否 |
| 不存在的合法 session UUID | `result/error_during_execution` | 否 | 否 |
| 非 UUID、也不是已知 title | `result/error_during_execution` | 否 | 否 |
| 有效 fork + 有效 slice | target 新 UUID 的 `system/init` | 是 | 只写 target session |
| fork + 不存在的 slice | `result/error_during_execution` | 否 | 否 |

不能替代上述 predicate 的反例：

- “消息有 `session_id`”：missing-session error 会带 requested ID；malformed/fork failure 还可能带
  一个随机新 ID。
- `result.subtype === "success"`：有效 resume 通过验证后若认证失败，会得到
  `subtype:"success"` 与 `is_error:true` 的组合，SDK 随后仍抛错。
- CLI exit code：它混合了 loader、认证、turn 等阶段，不能单独证明 slice 接受与否。
- `getSessionInfo()` / `getSessionMessages()` preflight：它能降低明显失败率，但 preflight 与实际
  query 之间存在 TOCTOU；query stream 的 init 仍是最终判据。

建议 Phase 3 的原子顺序（推断）：

1. 持久化 pending resume/fork attempt，不消费 slice。
2. 启动 native query，等待 correlated `system/init`。
3. 校验普通 resume/fork 的 identity relation。
4. 原子记录 target native session ID 与 `resume_validated`，再消费一次性 slice handle。
5. 把随后 auth/model/tool/completion failure 记录为独立 turn failure，不回写成 resume rejection。

当前 `prepareClaudeChatHistoryForDesktopRun()` 在 SDK query 前就清除 fork-resume one-shot flag，
因此与这个判据存在时序缺口；本轮仅记录，不改代码。

## 3. Codex app-server native resume / attach

### 3.1 结论矩阵

| 问题 | 结论 | 分类/证据 |
| --- | --- | --- |
| resume handle | 当前 Locus 使用的 stable `thread/resume.params.threadId` 要求 native `thread.id`。根 thread 样本中 `id === sessionId`，但 schema 明确 `sessionId` 可由一个 session tree 的多个 thread 共享 | 实测事实 `[CODEX-02]`；静态事实 `[CODEX-SCHEMA]` |
| 验证成功 | 收到匹配 JSON-RPC request `id` 的无 error response，且 `result.thread.id === requestedThreadId`；再校验独立 `sessionId` 与 installation/schema provenance | 实测事实 `[CODEX-02]`；推断见 3.2 |
| `thread/started` | `thread/start` 会发；所有成功 resume 样本都没有发 | 实测事实 `[CODEX-02]` |
| `thread/status/changed` | 成功 resume 时可能在 response 之前发，不能作为 handle claim/consume 信号 | 实测事实 `[CODEX-02]` |
| 新 thread durability | `thread/start` 返回 ID、`ephemeral:false` 和 path 时，rollout 文件仍可能不存在；立即停进程后，新进程 resume 报 no rollout | 实测事实 `[CODEX-03]` |
| 同版本进程重启 | 0.139、0.149 各自完成 turn 后，人工 SIGINT，启动新 app-server，再 resume 均成功并恢复 items、completed turn、usage、creator CLI version | 实测事实 `[CODEX-04]` |
| active 同进程 attach/rejoin | 0.139 在 `turn/started` 后对 active thread 调 `thread/resume` 成功，response 为 active/inProgress；紧邻 `turn/start` 的更早请求存在 no-rollout 竞态 | 实测事实 `[CODEX-05]` |
| active 跨进程 attach | A 已 `turn/started` 且仍 active 时，独立 B 的 resume RPC 成功却返回 idle + interrupted snapshot；B 未收到 A 后续 retry/error/completed，A 继续运行并最终 failed | 实测事实 `[CODEX-08]`；不是 live attach |
| missing | 合法 UUID 但没有 rollout：JSON-RPC `-32600 no rollout found` | 实测事实 `[CODEX-06]` |
| malformed | 非法字符串/空字符串：`-32600 invalid session id`，分别指出 character/length | 实测事实 `[CODEX-06]` |
| corrupt | 隔离副本 rollout 截断到 128 bytes：`-32603 failed to read thread ... rollout ... is empty` | 实测事实 `[CODEX-06]` |
| expired | TTL、archived/deleted 与真实清理均未覆盖 | 未测 |
| completed thread 跨版本 | 0.149→0.139 与 0.139→0.149 均 resume 成功，保留 final、turn ID、usage、creator version，且 rollout 摘要未变 | 实测事实 `[CODEX-07]` |
| failed thread 磁盘重建 | 0.139 active turn 原终态是 failed + 401 error；A/B 停止后，第三个 0.139 process resume 却重建为 completed/error null。fresh-context 评审复现进一步确认 rollout 只写入 `event_msg/task_complete`，没有 failed/error 记录 | 实测事实 `[CODEX-08]`；评审复现（2026-09-05）将损失定位到 rollout 写入层 |
| schema 跨版本 | `thread/resume` 顶层参数键相同，但 response `Thread` schema 已变化，例如 0.149 新增 required `projectId` | 静态事实 `[CODEX-SCHEMA]` |
| auth 与 resume | 移除隔离 auth 后 resume 仍成功，之后 websocket prewarm 才报 401 | 实测事实 `[CODEX-02]` |

三份相关 stable schema 的精确摘要：

| Schema | Codex 0.139.0 SHA-256 | Codex 0.149.0 SHA-256 |
| --- | --- | --- |
| `v2/ThreadResumeParams.json` | `116e6214983369a81b7234281366b0e7b5ea2a570a49645274d7b3839fbf2f56` | `7d9ff4b7d83702448715ada355a9713af6f71beaf6fcfcb08c4f03ac52842813` |
| `v2/ThreadResumeResponse.json` | `9454a8c554557f825f60adc725558b04df928b872bdb5091a37de5e2bf4b47e9` | `32fc20f4853f89bcee82dba6065751e0b08c104cf6a5c51f9c1aa658d1ce9154` |
| `v2/ThreadStartResponse.json` | `8238a4a374b57d4ec19a9918b304c4fc613727e572bc66dfe1d85b19377d0f6b` | `32eab3f0db9424a22153150dedb13b9ba489681ba0e88a8862c3ee10d9c38a04` |

这里的“跨进程”是 app-server subprocess 被 Ctrl-C 终止（观察 exit 1）后重启，不是 graceful
shutdown，也不是 SIGKILL、掉电或 OS 重启。completed-turn 的双向样本说明这两个精确版本能读取
彼此的两个特定 rollout；它不构成普遍 forward/backward compatibility 保证。

failed-turn 的 0.139→0.139 control 已复现相同语义丢失；此前 0.139→0.149 样本不能把它归因于
版本差异。rollout 在第三进程 resume 前后摘要不变且可重读，因此本轮没有观察到文件损坏。
2026-09-05 fresh-context 评审复现检查了实际 rollout：磁盘只记录 `event_msg/task_complete`，
没有 failed/error 记录，因而损失已实测定位到 rollout 写入层，而非 loader 或 response
projection。Phase 3 conformance fixture 应直接覆盖 rollout 写入，确认 failed/error 终态在
重启前已持久化。

0.139 experimental `thread/resume` schema 另有 `history` / `path` 变体，可不按 stable
`threadId` 解析。本轮和当前 Locus adapter 都只覆盖 stable `threadId` surface；experimental 两种
模式的 identity、durability 与 failure semantics 均为**未测**，不得从本节外推。

### 3.2 handle 消耗判据

在 Codex 0.139.0 与 0.149.0 的已测 app-server surface 上，native handle acceptance predicate 是：

```text
response.id == pendingResumeRequest.jsonRpcId
response.error 不存在
response.result.thread.id == requestedThreadId
response.result.thread.sessionId 非空且与 Binding 的独立预期一致
```

对 durable Binding 还应校验 `ephemeral === false`、非空 rollout `path`、creator `cliVersion`、
实际 active binary 与 protocol/schema policy。若目标只是刚由 `thread/start` 创建，还必须等 rollout
实际物化，不能把 start response 当成跨进程 resume 已就绪。

关键成功序列实测为：

```text
thread/status/changed(idle)       # 可能先到，不能消费 handle
{id:2,result:{thread:{id:…}}}     # native handle validation point
thread/tokenUsage/updated
thread/goal/cleared
```

以下都不能替代匹配 response：

- app-server process spawn 或 `initialize` 成功；
- `thread/status/changed`，因为可能先于 response；
- `thread/started`，因为成功 resume 样本根本不发；
- `turn/start` response，因为它只表示新 turn 受理，终态仍可失败；
- provider/auth readiness，因为 auth 缺失也不妨碍 loader 返回成功 resume。

active rejoin 和 idle resume 虽然都使用 `thread/resume`，canonical intent 不应因此合并。成功
response 中的 thread/turn status 只能描述该 app-server 返回的 view，不能证明全局 live owner；
Phase 3 应记录调用 intent、观察状态和竞态结果。

更重要的是，匹配的成功 response 只足以验证 **durable thread 可加载**，不证明 live-owner
continuity。`[CODEX-08]` 中 B 在 A 明确 active 时仍得到 idle/interrupted response，并且从未收到
A 的 terminal event。因此若请求 intent 是 attach active Run，当前 native surface 没有找到可靠的
跨进程 attach-success signal；不能消费“live attach”类一次性 claim。它还必须通过 Locus
RuntimeHost/Run owner lease、owner epoch/fencing 或同一 daemon/control endpoint 验证 live owner。

**静态事实**：当前 `app-server-adapter.ts` 会接受 response 中任意非空 thread ID，并在缺少
`thread/started` notification 时合成 session-init，但没有显式比较它与 requested ID；若 response
没有 `sessionId`，还会用 thread ID 回填 session ID。现有 fake resume test 也没有覆盖
missing/corrupt/version/attach race。本轮登记这些缺口，不实施。

## 4. 两个 harness 的失败分类

| 失败类 | Claude 2.1.177 观察 | Codex 观察 | Locus 不应武断解释为 |
| --- | --- | --- | --- |
| malformed handle | 非 UUID session 可能走 title 搜索；非法/未知 slice 在 init 前拒绝 | `-32600 invalid session id` | “临时网络失败” |
| missing | `No conversation found`，无 init | `-32600 no rollout found` | 已证明“过期” |
| wrong scope | 相同 ID、不同 cwd/project key 与 missing 同形 | cwd/history 参数变体未测 | native 数据已删除 |
| corrupt | 全损坏与 missing 同形；尾部损坏可被容忍 | 截断 rollout 为 `-32603 failed to read` | 所有 corruption 都不可恢复，或都安全 |
| expired | 65 天旧 fixture 仍可显式 resume；真正 cleanup 未测 | TTL/清理未测 | 仅凭年龄即可判 expired |
| validation 后 turn 失败 | init 后 auth failure，transcript 仍会追加 | resume 成功后 provider prewarm 可 401 | resume/slice 未验证 |
| concurrent live attach | bridge attach 未测 | B 成功 resume 只得离线 view，未订阅 A | live owner 已转移或已连续接管 |
| runtime 版本变化 | 真实跨版本未测 | completed 样本双向成功；failed 重建的语义损失同版也存在 | 任意 forward/backward compatibility |

Claude 的 `No conversation found with session ID` 至少覆盖“从未存在、wrong cwd、完全损坏”，
也可能覆盖真正 cleanup/expiry。当前 Locus 把这段 stderr 统一归为 `SESSION_EXPIRED` 并清除绑定；
Phase 3 应保留 native diagnostic 和实际 probe context，使用 `native_resume_rejected` 一类中性事实，
不要把上游不可区分的原因升级为已证明的 expiry。

## 5. Amadeus/Codex app-server 对外事件清单

### 5.1 枚举口径与指纹

`[EVENT-01]` 在 repo 固定的官方 Codex 0.139.0 binary 上分别生成 stable 与 experimental
JSON schema/TypeScript protocol surface。stable 与 experimental 在本节关注的三组 union 上相同。
`generate-json-schema` 产生的 `v2.schemas.json` 非确定，因此 schema-stable/schema-experimental
manifest SHA 只是单次观测、不可复现，不列为可验证指纹。下表只保留可复现的 TypeScript
manifest：

| 生成物 | 文件数 | path-independent manifest SHA-256 |
| --- | ---: | --- |
| `ts-stable` | 554 | `1bf3f0d279fada641ebc379147f4034d4dbc1f65a9ca00f41a2793631ce13652` |
| `ts-experimental` | 614 | `30a3e28b4f193d696297952a80bd694b8cc5c2551a32549bbebb59fe7ba516d1` |

三份核心 stable TypeScript 文件的 SHA-256：

- `ServerNotification.ts`：`bcc5cd580b83e15225dd138c768fafb0cae7d2ab26474a49a8569657f0b944a8`
- `ServerRequest.ts`：`6274decabc5c0e9b09f144efb1795ca8fc1fe52d8afa42ee5988de2d890f935e`
- `v2/ThreadItem.ts`：`1aef9163c636246a0d1baec611da798a3e77790b7b8819480162b6e734324038`

**实测事实 `[EVENT-01]`**：0.139.0 schema 枚举出 66 个 `ServerNotification` method、10 个
`ServerRequest` method 和 16 个 `ThreadItem` variant。

### 5.2 66 个 ServerNotification method

以下是 `[EVENT-01]` 的完整、排序后结果：

```text
account/login/completed
account/rateLimits/updated
account/updated
app/list/updated
command/exec/outputDelta
configWarning
deprecationNotice
error
externalAgentConfig/import/completed
fs/changed
fuzzyFileSearch/sessionCompleted
fuzzyFileSearch/sessionUpdated
guardianWarning
hook/completed
hook/started
item/agentMessage/delta
item/autoApprovalReview/completed
item/autoApprovalReview/started
item/commandExecution/outputDelta
item/commandExecution/terminalInteraction
item/completed
item/fileChange/outputDelta
item/fileChange/patchUpdated
item/mcpToolCall/progress
item/plan/delta
item/reasoning/summaryPartAdded
item/reasoning/summaryTextDelta
item/reasoning/textDelta
item/started
mcpServer/oauthLogin/completed
mcpServer/startupStatus/updated
model/rerouted
model/verification
process/exited
process/outputDelta
rawResponseItem/completed
remoteControl/status/changed
serverRequest/resolved
skills/changed
thread/archived
thread/closed
thread/compacted
thread/goal/cleared
thread/goal/updated
thread/name/updated
thread/realtime/closed
thread/realtime/error
thread/realtime/itemAdded
thread/realtime/outputAudio/delta
thread/realtime/sdp
thread/realtime/started
thread/realtime/transcript/delta
thread/realtime/transcript/done
thread/settings/updated
thread/started
thread/status/changed
thread/tokenUsage/updated
thread/unarchived
turn/completed
turn/diff/updated
turn/moderationMetadata
turn/plan/updated
turn/started
warning
windows/worldWritableWarning
windowsSandbox/setupCompleted
```

### 5.3 10 个 ServerRequest method

```text
account/chatgptAuthTokens/refresh
applyPatchApproval
attestation/generate
execCommandApproval
item/commandExecution/requestApproval
item/fileChange/requestApproval
item/permissions/requestApproval
item/tool/call
item/tool/requestUserInput
mcpServer/elicitation/request
```

**静态事实 `[EVENT-02]`**：这 10 个 method 与当前
`src/main/lib/codex/app-server-safety.ts` 的 inbound server-request allowlist 完全一致。其中
`applyPatchApproval` 和 `execCommandApproval` 是 legacy request。

### 5.4 16 个 ThreadItem variant

```text
agentMessage
collabAgentToolCall
commandExecution
contextCompaction
dynamicToolCall
enteredReviewMode
exitedReviewMode
fileChange
hookPrompt
imageGeneration
imageView
mcpToolCall
plan
reasoning
userMessage
webSearch
```

**静态事实 `[EVENT-01]`**：`Thread` 同时包含 `id` 和 `sessionId`；fork tree 可共享
`sessionId`，而每个 thread 仍有独立 `id`，并可带 `forkedFromId`、`parentThreadId`、`status`、
`cwd`、`cliVersion` 和 `source`。`Turn` 有自己的 `id`、authoritative `items/itemsView`、状态、
错误与 timing。`item/started` / `item/completed` 携带完整 `ThreadItem`。

**推断**：Phase 3 ledger 不能把 `threadId` 和 `sessionId` 折叠成一个字段；二者的生命周期和
分叉含义不同。

## 6. 到 Locus v1 事件的映射与缺口

当前 `src/main/lib/codex/app-server-stream-events.ts` 的 union/switch 只识别以下 11/66 个
notification method：

```text
error
item/agentMessage/delta
item/fileChange/outputDelta
item/fileChange/patchUpdated
item/reasoning/summaryTextDelta
item/reasoning/textDelta
thread/started
thread/tokenUsage/updated
turn/completed
turn/diff/updated
turn/started
```

其余 55 个 native notification 走 default 空投影。`[EVENT-03]` 又对若干关键输入执行了
native mapper → canonical mapper 的组合探针，确认 `item/started`、`item/mcpToolCall/progress`、
`item/completed` 均得到 `[]`。

本节按用户指定的 12 种 Locus v1 事件语义盘点。其中 `job_created`、`job_started` 是
Locus 在 job/run admission 与启动时生成的生命周期事件，不是 Runtime-native output；因此它们
不做 Codex native 映射，也不把“无 native 映射”判为事件缺口。下表覆盖其余 10 种语义：

| Locus v1 语义 | Codex 0.139 native 证据 | 当前投影 | 判定与 Phase 3 缺口 |
| --- | --- | --- | --- |
| `assistant_delta` | `item/agentMessage/delta`；`item/completed(agentMessage)` 给出权威终态 | delta 已成为 `assistant_delta`；native thread/turn identity 未进入 durable payload；final item 被丢弃 | **部分覆盖**。ledger 必须用 final snapshot 对账、检测丢 delta，且不能重复拼接文本 |
| `reasoning_delta` | `item/reasoning/textDelta`、`item/reasoning/summaryTextDelta`；`item/completed(reasoning)` 给出权威终态；`item/reasoning/summaryPartAdded` 表示 summary part 边界 | `textDelta` / `summaryTextDelta` 经 `reasoning-delta` chunk 成为 `reasoning_delta`，payload 只保留 `id/delta`，同样丢弃 `threadId/turnId`；`summaryPartAdded` 与 final `item/completed` 均走空投影 | **部分覆盖**。Phase 3 必须为 reasoning 登记 delta+final 对账，保留 native identity/part 边界，检测丢片且避免重复拼接 |
| `tool_started` | `item/started` + tool-like `ThreadItem` variants | 空投影 | **缺失**。需保存 item identity、tool kind/name、输入可用状态与 redaction provenance |
| `tool_delta` | `item/commandExecution/outputDelta`、`item/mcpToolCall/progress` 等 | command/MCP 进度为空；file-change delta/patch 被降为 generic `status` | **缺失/错位**。需保留 tool/item correlation 与分片顺序 |
| `tool_finished` | `item/completed` 携带完整 item、status、result/error/output | 空投影 | **严重缺失**。权威 tool final 不可由“流停了”猜测 |
| `usage_update` | `thread/tokenUsage/updated`，同时给出 `last`、`total`、cache/reasoning/context window | 已映射 | **已覆盖但语义未封口**。须声明 snapshot-vs-delta、去重与 resume 后基线 |
| `artifact_created` | 无统一 native artifact event；`imageGeneration.savedPath`、file/diff 只是候选证据 | Desktop Codex 不发 `artifact_created` | **缺失且不得直译**。只有 canonical artifact owner 校验、登记 run-owned artifact 后才能 mint |
| `status` | thread/turn lifecycle、plan、compaction、reroute/verification、warning、hook、MCP/OAuth、approval review 等 | 仅 start、diff/file-change 等少量路径变成 generic status | **部分覆盖**。需要稳定子类型，避免把关键状态藏进任意文本 |
| `error` | top-level `error` 有 `code`、native IDs、`willRetry`；item/turn 也可失败 | top-level 成为 `error`，但 canonical payload 丢 `code`、IDs、`willRetry`；item failure 被丢；turn error 只余 message | **错误语义缺口**。retryable diagnostic 不能等同 run terminal failure |
| `completed` | `turn/completed` 有 terminal status/error/timing | 经过 finish/cleanup 后生成 terminal `completed` | **大体覆盖**。仍需验证 late usage、重复 terminal、transport exit 与 interruption 顺序 |

`[EVENT-03]` 的直接反例还表明：输入 `error(... willRetry:true, code:"retryable")` 时，中间
chunk 保留 `willRetry:true`，但 canonical `error` payload 只剩
`{errorText:"temporary", chunkType:"error"}`。当前 shared emitter 又把任一 error chunk 视作
run failure，因此 retry diagnostic 与 terminal failure 存在混同风险。

ServerRequest 不应当被硬塞进上表的单向 output event。当前 10 类请求会被在线处理，但
`serverRequest/resolved` 未进入 durable trace，因而没有 request → decision/response → resolved 的
可重放 Interaction 证据链。

另有一项本地 contract 对齐漂移：`src/shared/agent-jobs.ts`、Local Job API v1 schema/consumer guide
均包含 `artifact_created`，但当前 `openspec/specs/agent-runtime-core/spec.md` 的“Normalized Agent
Events”枚举没有列它。本文按用户指定的 Locus v1 词汇和实际 durable type 审计；Phase 3 应在
canonical owner 中消除这处规格遗漏，而不是再创建一套 artifact event。

### 6.1 snapshot 不是 event replay

**静态事实 `[EVENT-01]`**：`thread/resume` / `thread/read` / fork 等响应中的 `Thread.turns` 是
Turn/Item 状态快照；66 个 notification 的 schema 没有全局 `eventId`、cursor 或 sequence。

**推断**：Codex native resume 可以修复/对账当前 thread 状态，却不能证明恢复了断线期间每个
native event。Locus 的 canonical `RunEvent.sequence` 才能成为消费 cursor。用 snapshot 补洞时必须
记录 `repair/source=snapshot` 和可能丢失中间 delta 的事实，不能伪称 native replay。

### 6.2 未测动态行为

下列项目本轮只拿到 schema/源码，没有足够 live trace，因此明确为**未测**：

- 66 个 notification 在真实长回合中的实际出现频率、跨 method 全序与是否可能重复；
- `turn/completed` 前后是否仍可能到达 usage、warning 或其他非 terminal notification；
- realtime、remote-control、process 和 Windows-only method 的动态行为；
- 断连窗口中 app-server 是否在某些配置下提供 schema 未表达的补发行为。

## 7. Phase 3 canonical event ledger 的必要输入

以下均为本 trace 导出的**需求输入/推断**，不是已批准实现：

1. **统一摄取边界**：在一个排序 owner 内接收 JSON-RPC response、notification、server request，
   并记录 server response-send / resolved 边界；不得让 transport 与业务 mapper 各写一条事实链。
2. **双层 identity**：canonical sequence 之外，保存可用的 native
   `{threadId, sessionId, turnId, itemId, requestId/callId}`；绝不混同 thread 与 session。
3. **item 状态机**：`started → delta* → completed`；允许缺失、重复、乱序输入，以 completed
   snapshot 为权威对账，同时避免 assistant/tool 文本重复。
4. **resume 修复标记**：native snapshot repair 不是 event replay；必须标记 loss-possible、来源和
   对账结果。Locus sequence 才是下游 cursor。
5. **错误与 terminal 不变量**：保留 `willRetry`、native code、diagnostic/terminal 分类；每个 Run
   恰好一个 completed，明确 transport exit synthetic terminal 和 late-event policy。
6. **usage 语义**：固定 snapshot/delta 定义、累计值/last 值、去重 key 和 resume 后 baseline。
7. **artifact owner**：native path/diff/image 只能作为候选证据；canonical owner 校验存在性、范围、
   digest、run ownership 和 redaction 后才发 `artifact_created`。
8. **安装与 schema provenance**：每条 run/trace 绑定准确 RuntimeInstallation、binary digest、
   protocol/schema identity；可选的原生扩展进入 redacted namespaced payload（例如
   `runtime.codex.v1`）。未知 method 必须可观测并标 loss，不能静默 `[]`。
9. **Interaction ledger**：持久化 request、授权 responder、deadline、decision/response、resolved
   identity 和 provenance；与 output event 有关联但不是同一状态机。
10. **conformance fixtures**：覆盖 delta+final 对账、各 tool lifecycle、retry error、interrupt、usage、
    unknown method、重复/乱序、transport restart、resume snapshot repair，以及 failed/error 经磁盘
    rehydrate 后仍保持 terminal 语义；后者必须直接针对 rollout 写入层，验证 failed/error
    终态在进程重启前已被记录。reasoning 与 assistant 均要有各自的 delta+final 对账 fixture。
11. **live owner/attach fencing**：native resume-load 成功不得替代 SessionBinding/Run lease。attach
    intent 必须核验 canonical owner、epoch/fencing 和事件订阅连续性；独立 process 返回的离线 view
    只能作为 snapshot repair，不能获得 active Run 写权或消费 live-attach claim。

## 8. 与当前 Locus owner 的关系

本轮没有修改下列代码；这些位置仅用于说明未来 change 应落在哪个 canonical owner：

- Claude query resume options：`src/main/lib/claude/agent-sdk-query-options.ts`
- Claude chat-history/fork flag：`src/main/lib/claude/chat-history.ts`
- Codex `thread/resume` response owner：`src/main/lib/codex/app-server-adapter.ts`
- Codex notification edge mapper：`src/main/lib/codex/app-server-stream-events.ts`
- canonical desktop chunk → RunEvent：`src/main/lib/agent-runtime/stream-event-mapper.ts`
- canonical RunEvent envelope/redaction：`src/main/lib/agent-runtime/runtime-events.ts`、
  `src/main/lib/agent-runtime/redaction.ts`
- durable event vocabulary：`src/shared/agent-jobs.ts`
- Codex app-server headless canonical-event consumer：
  `src/main/lib/headless/adapters/codex-app-server.ts`。其 `appendTraceEvent()` 只消费已映射的 canonical
  `RunEvent`，并丢弃 `completed`（终态由外层 headless request 结算）；它不引入第二条
  native 映射链。

**静态事实**：Claude 当前 fork-resume one-shot flag 在调用 SDK query 之前，由
`prepareClaudeChatHistoryForDesktopRun()` 清除并写库。若 native resume/slice 随后被拒绝，handle
已经被消费。

**推断**：Phase 3 若采纳本文判据，应把 one-shot handle 的持久化状态推进收敛到 resume owner，
并以第 2.2 节的 native acceptance signal 做 compare-and-set；不能继续以“准备发送”作为消费点。

## 9. 复现命令

所有命令从研究 worktree 根目录运行。命令使用新建的 `/tmp` 目录；不要复用真实用户的 runtime
home。以下命令不打印 credential，也不进行远端仓库写入；标明的 completed-turn 命令会调用
provider 并可能产生用量。

### `[ENV-01]` Claude 版本、摘要与隔离 auth 状态

```bash
claude_bin=/home/chen/projects/agent-code-for-me/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude
"$claude_bin" --version
sha256sum "$claude_bin"
probe_dir=$(mktemp -d /tmp/locus-claude-env-XXXXXX)
mkdir -p "$probe_dir/home"
HOME="$probe_dir/home" CLAUDE_CONFIG_DIR="$probe_dir/config" DISABLE_AUTOUPDATER=1 \
  "$claude_bin" auth status --json
```

关键输出：`2.1.177 (Claude Code)`；隔离 home 为 `loggedIn:false`、`authMethod:"none"`。

### `[ENV-02]` Codex 版本与摘要

```bash
codex_139=/tmp/locus-codex-event-audit.W3sGXa/codex-x86_64-unknown-linux-musl
codex_149=/home/chen/.codex/packages/standalone/releases/0.149.0-x86_64-unknown-linux-musl/bin/codex
"$codex_139" --version
sha256sum "$codex_139"
"$codex_149" --version
sha256sum "$codex_149"
```

`/tmp` 路径每次会变化；可用 `[EVENT-01]` 先取得并验证 0.139.0。

### `[CLAUDE-01]` 隔离 fixture 与 missing session

```bash
BIN=/home/chen/projects/agent-code-for-me/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude
T=$(mktemp -d /tmp/locus-claude-repro.XXXXXX)
mkdir -p "$T/config/projects" "$T/home" "$T/cwd"
SID=00000000-0000-4000-8000-000000000101
AID=10000000-0000-4000-8000-000000000102
KEY=$(printf '%s' "$T/cwd" | sed 's/[^a-zA-Z0-9]/-/g')
mkdir -p "$T/config/projects/$KEY"

(
  cd "$T/cwd"
  HOME="$T/home" CLAUDE_CONFIG_DIR="$T/config" DISABLE_AUTOUPDATER=1 \
    "$BIN" --bare -p --output-format stream-json --verbose \
    --permission-mode plan --tools "" --resume "$SID" \
    'Reply with exactly OK; do not use tools.'
)
```

关键输出是 `result/error_during_execution`、
`No conversation found with session ID: ...`，且此前没有 `system/init`。

非 UUID/title miss 对照只需把上面参数替换为：

```bash
--resume not-a-uuid
```

它同样在 init 前失败；error result 可能带一个与输入无关的新 session ID。

下面生成不含 credential 的最小 transcript fixture：

```bash
PROBE_FILE="$T/config/projects/$KEY/$SID.jsonl" \
PROBE_CWD="$T/cwd" PROBE_SESSION="$SID" PROBE_ASSISTANT="$AID" \
bun -e '
const cwd=process.env.PROBE_CWD;
const sid=process.env.PROBE_SESSION;
const aid=process.env.PROBE_ASSISTANT;
const uid="10000000-0000-4000-8000-000000000101";
const common={
  isSidechain:false,userType:"external",cwd,sessionId:sid,
  version:"2.1.177",gitBranch:"",
  timestamp:"2026-09-04T00:00:00.000Z"
};
const rows=[
  {...common,parentUuid:null,type:"user",
   message:{role:"user",content:"fixture"},uuid:uid},
  {...common,parentUuid:uid,type:"assistant",
   message:{id:"msg_test",type:"message",role:"assistant",model:"claude-test",
     content:[{type:"text",text:"fixture"}],stop_reason:"end_turn",
     stop_sequence:null,usage:{input_tokens:1,output_tokens:1}},uuid:aid}
];
await Bun.write(process.env.PROBE_FILE,rows.map(JSON.stringify).join("\n")+"\n");
'
```

### `[CLAUDE-02]` 有效/无效 slice 与 acceptance signal

有效 slice：

```bash
(
  cd "$T/cwd"
  HOME="$T/home" CLAUDE_CONFIG_DIR="$T/config" DISABLE_AUTOUPDATER=1 \
    "$BIN" --bare -p --output-format stream-json --verbose \
    --permission-mode plan --tools "" \
    --resume "$SID" --resume-session-at "$AID" \
    'Reply with exactly OK; do not use tools.'
)
```

关键顺序：`system/init`（source session ID）→ 本环境的 authentication failure →
`result/success` 且 `is_error:true`。无效 slice 对照：

```bash
(
  cd "$T/cwd"
  HOME="$T/home" CLAUDE_CONFIG_DIR="$T/config" DISABLE_AUTOUPDATER=1 \
    "$BIN" --bare -p --output-format stream-json --verbose \
    --permission-mode plan --tools "" \
    --resume "$SID" \
    --resume-session-at 10000000-0000-4000-8000-000000000199 \
    'Reply with exactly OK; do not use tools.'
)
```

关键输出：`No message found with message.uuid of: ...`；没有 init，也不追加 transcript。
格式损坏的 slice 对照把该 UUID 替换成 `not-a-message-uuid`，也在 init 前失败。

### `[CLAUDE-03]` fork identity

重新运行 `[CLAUDE-01]` 的 fixture 创建步骤，再执行：

```bash
before=$(sha256sum "$T/config/projects/$KEY/$SID.jsonl")
(
  cd "$T/cwd"
  HOME="$T/home" CLAUDE_CONFIG_DIR="$T/config" DISABLE_AUTOUPDATER=1 \
    "$BIN" --bare -p --output-format stream-json --verbose \
    --permission-mode plan --tools "" \
    --resume "$SID" --resume-session-at "$AID" --fork-session \
    'Reply with exactly OK; do not use tools.'
)
after=$(sha256sum "$T/config/projects/$KEY/$SID.jsonl")
printf 'source before=%s\nsource after=%s\n' "$before" "$after"
find "$T/config/projects/$KEY" -maxdepth 1 -type f -name '*.jsonl' -print
```

预期 init 含 fresh target UUID，target 文件被创建，而 source 摘要不变。把 slice 换成不存在的 UUID
时没有 init/target transcript。

### `[CLAUDE-04]` 三个独立进程 resume

重新运行 `[CLAUDE-01]` 的 fixture 创建步骤，然后三次执行以下 subshell；每次都是新 CLI process：

```bash
wc -l "$T/config/projects/$KEY/$SID.jsonl"
for attempt in 1 2 3; do
  (
    cd "$T/cwd"
    HOME="$T/home" CLAUDE_CONFIG_DIR="$T/config" DISABLE_AUTOUPDATER=1 \
      "$BIN" --bare -p --output-format stream-json --verbose \
      --permission-mode plan --tools "" --resume "$SID" \
      'Reply with exactly OK; do not use tools.'
  ) >"$T/restart-$attempt.jsonl" 2>"$T/restart-$attempt.stderr" || true
  bun -e '
    const rows=(await Bun.file(process.argv[1]).text()).trim().split("\n").filter(Boolean).map(JSON.parse);
    console.log(rows.find(x=>x.type==="system"&&x.subtype==="init")?.session_id ?? "NO_INIT");
  ' "$T/restart-$attempt.jsonl"
  wc -l "$T/config/projects/$KEY/$SID.jsonl"
done
```

本次观察为 3/3 init，行数 `2 → 9 → 18 → 25`；行数可能随上游诊断消息变化，判据是每个新
process 的 matching init。

### `[CLAUDE-05]` cwd/project scope

```bash
mkdir -p "$T/other-cwd"
(
  cd "$T/other-cwd"
  HOME="$T/home" CLAUDE_CONFIG_DIR="$T/config" DISABLE_AUTOUPDATER=1 \
    "$BIN" --bare -p --output-format stream-json --verbose \
    --permission-mode plan --tools "" --resume "$SID" \
    'Reply with exactly OK; do not use tools.'
)
wc -l "$T/config/projects/$KEY/$SID.jsonl"
```

相同 SID 从不同 cwd 返回 `No conversation found`，source transcript 保持不变。

### `[CLAUDE-06]` corruption 与年龄

完全损坏：

```bash
CORRUPT_SID=00000000-0000-4000-8000-000000000201
PROBE_FILE="$T/config/projects/$KEY/$CORRUPT_SID.jsonl" \
  bun -e 'await Bun.write(process.env.PROBE_FILE,"{not-json\n")'
(
  cd "$T/cwd"
  HOME="$T/home" CLAUDE_CONFIG_DIR="$T/config" DISABLE_AUTOUPDATER=1 \
    "$BIN" --bare -p --output-format stream-json --verbose \
    --permission-mode plan --tools "" --resume "$CORRUPT_SID" test
)
```

预期与 missing 同形且无 init。尾部部分损坏：重新创建有效 fixture，再追加坏行：

```bash
PROBE_FILE="$T/config/projects/$KEY/$SID.jsonl" bun -e '
const path=process.env.PROBE_FILE;
await Bun.write(path,(await Bun.file(path).text())+"{broken-tail\n");
'
# 再执行 [CLAUDE-02] 的有效 slice 命令
```

本次 loader 忽略坏尾、发 init 并继续追加。年龄探针：重新创建有效 fixture 后执行：

```bash
PROBE_FILE="$T/config/projects/$KEY/$SID.jsonl" bun -e '
const path=process.env.PROBE_FILE;
const old="2026-07-01T00:00:00.000Z";
const rows=(await Bun.file(path).text()).trim().split("\n").map(JSON.parse);
for (const row of rows) row.timestamp=old;
await Bun.write(path,rows.map(JSON.stringify).join("\n")+"\n");
'
touch -d '65 days ago' "$T/config/projects/$KEY/$SID.jsonl"
# 再执行 [CLAUDE-02] 的有效 slice 命令
```

本次旧文件仍发 init；该命令不运行 cleanup scheduler，因此不能复现真正 expiry。

### `[CLAUDE-07]` version 字段与真实安装盘点

```bash
find /home/chen -type f -path '*/claude-agent-sdk*/*/claude' -perm -u+x \
  -exec sh -c 'printf "%s: " "$1"; "$1" --version' _ {} \;
PROBE_FILE="$T/config/projects/$KEY/$SID.jsonl" bun -e '
const path=process.env.PROBE_FILE;
const rows=(await Bun.file(path).text()).trim().split("\n").map(JSON.parse);
for (const row of rows) row.version="0.0.1";
await Bun.write(path,rows.map(JSON.stringify).join("\n")+"\n");
'
# 再执行 [CLAUDE-02] 的有效 slice 命令
```

本次发现的六份 binary 都报告 2.1.177；改写 transcript 字段后仍发 init。

### `[CLAUDE-SRC]` SDK resume 与 alpha bridge 静态入口

```bash
rg -n 'resumeSessionAt|forkSession|resume:' \
  src/main/lib/claude/agent-sdk-query-options.ts \
  /home/chen/projects/agent-code-for-me/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts
rg -n 'cleanupPeriodDays' \
  /home/chen/projects/agent-code-for-me/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts
rg -n 'attachBridgeSession|initialSequenceNum|isConnected|cse_|onClose|4090|503|ALPHA' \
  /home/chen/projects/agent-code-for-me/node_modules/@anthropic-ai/claude-agent-sdk/bridge.d.ts
rg -n "agent-sdk/bridge|attachBridgeSession" src package.json
```

最后一条在当前 repo 没有产品 import 命中。

### `[CODEX-SCHEMA]` 两版 stable schema

```bash
CODEX_139=/tmp/locus-codex-event-audit.W3sGXa/codex-x86_64-unknown-linux-musl
CODEX_149=/home/chen/.codex/packages/standalone/releases/0.149.0-x86_64-unknown-linux-musl/bin/codex
for version in 139 149; do
  eval "CODEX_BIN=\$CODEX_$version"
  SCHEMA_ROOT=$(mktemp -d "/tmp/locus-codex-schema-$version.XXXXXX")
  mkdir -p "$SCHEMA_ROOT/stable" "$SCHEMA_ROOT/os-home" "$SCHEMA_ROOT/codex-home"
  env -i PATH=/usr/bin:/bin HOME="$SCHEMA_ROOT/os-home" \
    CODEX_HOME="$SCHEMA_ROOT/codex-home" \
    "$CODEX_BIN" app-server generate-json-schema --out "$SCHEMA_ROOT/stable"
  sha256sum \
    "$SCHEMA_ROOT/stable/v2/ThreadResumeParams.json" \
    "$SCHEMA_ROOT/stable/v2/ThreadResumeResponse.json" \
    "$SCHEMA_ROOT/stable/v2/ThreadStartResponse.json"
done
```

### `[CODEX-01]` 隔离 app-server 与通用请求序列

以下命令启动一个只使用隔离 runtime home/workspace 的 stdio app-server：

```bash
CODEX_BIN=/tmp/locus-codex-event-audit.W3sGXa/codex-x86_64-unknown-linux-musl
PROBE_ROOT=$(mktemp -d /tmp/locus-codex-resume.XXXXXX)
mkdir -p "$PROBE_ROOT/os-home" "$PROBE_ROOT/codex-home" "$PROBE_ROOT/workspace"
env -i PATH=/usr/bin:/bin \
  HOME="$PROBE_ROOT/os-home" \
  CODEX_HOME="$PROBE_ROOT/codex-home" \
  "$CODEX_BIN" app-server --listen stdio://
```

向 stdin 逐行发送 JSON；把 `<WORKSPACE>` 换成上面的绝对路径：

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"locus-resume-probe","version":"1.0.0"},"capabilities":{"experimentalApi":false,"requestAttestation":false}}}
{"method":"initialized"}
{"id":2,"method":"thread/start","params":{"cwd":"<WORKSPACE>","approvalPolicy":"never","sandbox":"read-only","ephemeral":false,"serviceName":"locus-resume-probe","sessionStartSource":"startup","threadSource":"user","developerInstructions":"Never call tools; answer only the requested literal token."}}
```

记录 response 中的 `<THREAD_ID>`、`<SESSION_ID>` 与 `<ROLLOUT_PATH>`。需要 completed turn 的实验还
要发送下列请求；它会调用 provider，必须使用获授权的本地测试账户，并可能产生用量：

```json
{"id":3,"method":"turn/start","params":{"threadId":"<THREAD_ID>","input":[{"type":"text","text":"Reply exactly RESUME_PROBE and nothing else. Do not call tools.","text_elements":[]}],"cwd":"<WORKSPACE>","approvalPolicy":"never","sandboxPolicy":{"type":"readOnly","networkAccess":false}}}
```

若为隔离 home 临时提供认证，只复制到 temp 并在 turn 结束后删除；不要输出文件内容：

```bash
install -m 600 '<AUTHORIZED_SOURCE_CODEX_HOME>/auth.json' \
  "$PROBE_ROOT/codex-home/auth.json"
# 完成 live turn、停止 app-server 后
unlink "$PROBE_ROOT/codex-home/auth.json"
test ! -e "$PROBE_ROOT/codex-home/auth.json"
```

### `[CODEX-02]` resume response 与 auth 分离

完成 `[CODEX-01]` 的 turn、等待 `turn/completed`，Ctrl-C 停止 app-server。删除 temp auth 后，用
同一 `PROBE_ROOT` 重启 `[CODEX-01]` 的 app-server 命令，发送：

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"locus-resume-probe-restart","version":"1.0.0"},"capabilities":{"experimentalApi":false,"requestAttestation":false}}}
{"method":"initialized"}
{"id":2,"method":"thread/resume","params":{"threadId":"<THREAD_ID>","cwd":"<WORKSPACE>","approvalPolicy":"never","sandbox":"read-only"}}
```

在 stdout 中按 `id:2` 关联 response，并断言无 `error`、`result.thread.id` 精确等于请求 ID，再
独立检查 `sessionId`、`ephemeral`、`path`、creator `cliVersion`。本次观察到
`thread/status/changed` 可早于 response、没有 `thread/started`。temp auth 已删除仍可 resume；后续
provider prewarm 才出现 401。

### `[CODEX-03]` start response 尚不保证 durable

只执行 `[CODEX-01]` 到 `thread/start` response，不发 turn：

```bash
test ! -e '<ROLLOUT_PATH>'
# 在 app-server PTY 中按 Ctrl-C；用相同 PROBE_ROOT 重启并 initialize，再发送：
```

```json
{"id":2,"method":"thread/resume","params":{"threadId":"<THREAD_ID>","cwd":"<WORKSPACE>","approvalPolicy":"never","sandbox":"read-only"}}
```

本次得到 `-32600 no rollout found for thread id ...`。

### `[CODEX-04]` 同版跨进程恢复

分别把 `CODEX_BIN` 设为 0.139.0 和 0.149.0，各自完整执行 `[CODEX-01]`，等待
`turn/completed`，Ctrl-C 后用同一 binary、同一隔离 `CODEX_HOME` 执行 `[CODEX-02]`。检查 resume
response 中原 user/assistant items、completed turn、usage 和 creator `cliVersion`。

### `[CODEX-05]` active 同进程 rejoin 竞态

使用 0.139.0 在同一 app-server 执行 `thread/start` 与 `turn/start`。紧邻 `turn/start` 先发一次：

```json
{"id":4,"method":"thread/resume","params":{"threadId":"<THREAD_ID>","cwd":"<WORKSPACE>","approvalPolicy":"never","sandbox":"read-only"}}
```

该请求可能得到 no-rollout。明确等到 `turn/started` notification 后再发：

```json
{"id":5,"method":"thread/resume","params":{"threadId":"<THREAD_ID>","cwd":"<WORKSPACE>","approvalPolicy":"never","sandbox":"read-only"}}
```

本次第二个 response 成功，`thread.status.type` 为 `active`，首个 turn status 为 `inProgress`。

### `[CODEX-06]` missing、malformed 与截断 rollout

隔离 app-server initialize 后分别发送：

```json
{"id":2,"method":"thread/resume","params":{"threadId":"0199a123-4567-7abc-8def-0123456789ab","cwd":"<WORKSPACE>","approvalPolicy":"never","sandbox":"read-only"}}
{"id":3,"method":"thread/resume","params":{"threadId":"not-a-thread","cwd":"<WORKSPACE>","approvalPolicy":"never","sandbox":"read-only"}}
{"id":4,"method":"thread/resume","params":{"threadId":"","cwd":"<WORKSPACE>","approvalPolicy":"never","sandbox":"read-only"}}
```

分别观察 no rollout、invalid character、invalid length 的 `-32600`。损坏实验先把已完成 rollout
复制到全新隔离 home，绝不破坏源文件：

```bash
CORRUPT_ROOT=$(mktemp -d /tmp/locus-codex-corrupt.XXXXXX)
mkdir -p \
  "$CORRUPT_ROOT/codex-home/sessions/2026/09/04" \
  "$CORRUPT_ROOT/os-home" \
  "$CORRUPT_ROOT/workspace"
cp '<VALID_ROLLOUT>' \
  "$CORRUPT_ROOT/codex-home/sessions/2026/09/04/"
truncate -s 128 \
  "$CORRUPT_ROOT/codex-home/sessions/2026/09/04/<ROLLOUT_NAME>"
env -i PATH=/usr/bin:/bin HOME="$CORRUPT_ROOT/os-home" \
  CODEX_HOME="$CORRUPT_ROOT/codex-home" \
  "$CODEX_BIN" app-server --listen stdio://
```

initialize 后对原 thread ID 发 resume。本次得到 `-32603 failed to read thread ... rollout ... is
empty`；app-server 没有因此退出。

### `[CODEX-07]` 0.139 ↔ 0.149 completed-turn 交叉读取

用 source binary 完成 `[CODEX-01]`，停进程并删除 temp auth，记录 rollout 摘要：

```bash
sha256sum '<ROLLOUT_PATH>'
```

保持同一隔离 `HOME` / `CODEX_HOME`，把 `CODEX_BIN` 换成 target binary，按 `[CODEX-02]` resume，
再次执行 `sha256sum` 并核对 response。两个方向本次的 source rollout 摘要分别为：

```text
0.149 source: 4a4d5cccd88a20dec740e30d0147b03fcdfeb2906cee5ae7344fdfd38b476656
0.139 source: b0f156d4e8e664a8d34bf0953b2c3cfd856ccba56d71929e52d51dd539810483
```

前后摘要均不变。failed-turn 交叉样本后来由 `[CODEX-08]` 的 0.139 同版 control 解释为一般
rehydration loss，本 trace 不再把它归因于跨版本。

### `[CODEX-08]` 独立 process 对 active thread 的 resume

使用 0.139.0（binary SHA 见 `[ENV-02]`）。先用一次获授权的 temp auth 按 `[CODEX-01]` 创建并
完成 durable thread；停止 bootstrap process 后删除 auth。再为 A/B/C 创建三个隔离 OS home，
共用同一个不含 auth 的 `CODEX_HOME`：

```bash
CODEX_139=/tmp/locus-codex-event-audit.W3sGXa/codex-x86_64-unknown-linux-musl
mkdir -p \
  "$PROBE_ROOT/os-home-a2" \
  "$PROBE_ROOT/os-home-b2" \
  "$PROBE_ROOT/os-home-c"
env -i PATH=/usr/bin:/bin HOME="$PROBE_ROOT/os-home-a2" \
  CODEX_HOME="$PROBE_ROOT/codex-home" \
  "$CODEX_139" app-server --listen stdio://
# 在另一终端同时启动 B：
env -i PATH=/usr/bin:/bin HOME="$PROBE_ROOT/os-home-b2" \
  CODEX_HOME="$PROBE_ROOT/codex-home" \
  "$CODEX_139" app-server --listen stdio://
```

A、B 分别发送 initialize/initialized。A 先 resume `<THREAD_ID>`，再发：

```json
{"id":3,"method":"turn/start","params":{"threadId":"<THREAD_ID>","input":[{"type":"text","text":"This is a no-auth cross-process attach failure-mode probe. Do not call tools.","text_elements":[]}],"cwd":"<WORKSPACE>","approvalPolicy":"never","approvalsReviewer":"user","sandboxPolicy":{"type":"readOnly","networkAccess":false}}}
```

明确等到 A 输出 active 与 `turn/started`：

```json
{"method":"thread/status/changed","params":{"threadId":"<THREAD_ID>","status":{"type":"active","activeFlags":[]}}}
{"method":"turn/started","params":{"threadId":"<THREAD_ID>","turn":{"id":"<ACTIVE_TURN_ID>","status":"inProgress"}}}
```

这时让已完成握手的 B 发送：

```json
{"id":2,"method":"thread/resume","params":{"threadId":"<THREAD_ID>","cwd":"<WORKSPACE>","approvalPolicy":"never","sandbox":"read-only"}}
```

本次 B 在 A 尚未完成时先发 idle notification，再返回成功 response；其 view 把 active turn 写成
interrupted：

```json
{"method":"thread/status/changed","params":{"threadId":"<THREAD_ID>","status":{"type":"idle"}}}
{"id":2,"result":{"thread":{"id":"<THREAD_ID>","status":{"type":"idle"},"turns":[{"status":"completed"},{"id":"<ACTIVE_TURN_ID>","status":"interrupted","error":null}]}}}
```

A 在 B response 后仍继续输出 401 retry，约 18.4 秒后才给出真实 terminal：

```json
{"method":"thread/status/changed","params":{"threadId":"<THREAD_ID>","status":{"type":"systemError"}}}
{"method":"turn/completed","params":{"threadId":"<THREAD_ID>","turn":{"id":"<ACTIVE_TURN_ID>","status":"failed","error":{"message":"...401 Unauthorized..."},"durationMs":18439}}}
```

在 A 完成后继续读取 B stdout，没有收到 A 的 retry/error/completed。停止 A/B，记录 rollout SHA，
然后用 `os-home-c` 启动第三个 0.139 process 并 resume。C 的 RPC 成功，但同一 turn 被重建为：

```json
{"id":"<ACTIVE_TURN_ID>","status":"completed","error":null,"durationMs":18439}
```

本次 rollout 在 C resume 前后均为 57,111 bytes / 17 lines，SHA-256 都是
`33cff904715e107e28cba1c373ad09d733dbeeba9af5d140a8fe0f9c0116a4c0`，仍可读取。
评审于 2026-09-05 fresh context 复现后进一步检查 rollout 内容：磁盘只记录
`event_msg/task_complete`，没有 failed/error 记录，因而损失发生在 rollout 写入层。

实测事实是 B 的 output 与 A 的后续 output；“B 从 rollout 重建离线 view，而不是 attach A 的
in-memory Run”是最符合证据的推断。没有证据表明 B 导致 A interrupted，也不推断内部锁机制。

### `[EVENT-01]` 生成并枚举 0.139.0 protocol surface

```bash
audit_tmp=$(mktemp -d /tmp/locus-codex-event-audit.XXXXXX)
curl -fL -o "$audit_tmp/codex.tar.gz" \
  https://github.com/openai/codex/releases/download/rust-v0.139.0/codex-x86_64-unknown-linux-musl.tar.gz
sha256sum "$audit_tmp/codex.tar.gz"
tar -xzf "$audit_tmp/codex.tar.gz" -C "$audit_tmp"
codex_bin="$audit_tmp/codex-x86_64-unknown-linux-musl"
"$codex_bin" --version
sha256sum "$codex_bin"
"$codex_bin" app-server generate-ts --out "$audit_tmp/ts-stable"
"$codex_bin" app-server generate-ts --experimental --out "$audit_tmp/ts-experimental"
"$codex_bin" app-server generate-json-schema --out "$audit_tmp/schema-stable"
"$codex_bin" app-server generate-json-schema --experimental --out "$audit_tmp/schema-experimental"
rg -o '"method": "[^"]+"' "$audit_tmp/ts-stable/ServerNotification.ts" | sort -u
rg -o '"method": "[^"]+"' "$audit_tmp/ts-stable/ServerRequest.ts" | sort -u
rg -o '"type": "[^"]+"' "$audit_tmp/ts-stable/v2/ThreadItem.ts" | sort -u
for dir in ts-stable ts-experimental; do
  digest=$(cd "$audit_tmp/$dir" && \
    find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d ' ' -f1)
  count=$(find "$audit_tmp/$dir" -type f | wc -l)
  printf '%s count=%s manifest_sha256=%s\n' "$dir" "$count" "$digest"
done
sha256sum \
  "$audit_tmp/ts-stable/ServerNotification.ts" \
  "$audit_tmp/ts-stable/ServerRequest.ts" \
  "$audit_tmp/ts-stable/v2/ThreadItem.ts"
```

schema 输出仍用于枚举和 per-file 对照，但 `v2.schemas.json` 生成非确定，不应把
schema-stable/schema-experimental 全目录 manifest SHA 当作可复现验收值。

下载的 tar SHA-256 应为
`12ebf70df41dc831061862912ab5e7eacdd112bb17e8ce9b2098cb3d92180081`，大小
90,142,645 bytes；如果摘要不同，应停止并把它当作不同实验输入。

### `[EVENT-02]` 对照当前 adapter 识别面

```bash
rg -n 'case "|method: "' \
  src/main/lib/codex/app-server-stream-events.ts \
  src/main/lib/codex/app-server-safety.ts
```

### `[EVENT-03]` native mapper → canonical mapper 组合探针

```bash
bun -e '
import { createCodexAppServerRuntimeEventMapper as create } from "./src/main/lib/codex/app-server-stream-events.ts";
import { mapDesktopStreamChunkToRunEvents as canonicalize } from "./src/main/lib/agent-runtime/stream-event-mapper.ts";
const mapper = create();
const native = [
  { method: "item/started", params: {} },
  { method: "item/agentMessage/delta", params: { threadId: "th", turnId: "tu", itemId: "msg", delta: "x" } },
  { method: "item/reasoning/textDelta", params: { threadId: "th", turnId: "tu", itemId: "reason", delta: "r" } },
  { method: "item/reasoning/summaryPartAdded", params: {} },
  { method: "turn/diff/updated", params: { threadId: "th", turnId: "tu", diff: "d" } },
  { method: "item/fileChange/patchUpdated", params: { threadId: "th", turnId: "tu", itemId: "patch", changes: [] } },
  { method: "item/mcpToolCall/progress", params: {} },
  { method: "item/completed", params: {} },
  { method: "error", params: { threadId: "th", turnId: "tu", error: { message: "temporary", code: "retryable" }, willRetry: true } },
];
const out = native.map((notification, index) => {
  const chunks = mapper.map(notification as any);
  const events = chunks.flatMap((chunk) => canonicalize({
    runtimeId: "codex", runId: "run", jobId: "job", sequence: index + 1,
    createdAt: "2026-09-04T00:00:00.000Z", chunk,
  }));
  return { method: notification.method, chunks, events };
});
console.log(JSON.stringify(out, null, 2));
'
```

关键输出：`item/started`、`item/reasoning/summaryPartAdded`、`item/mcpToolCall/progress`、
`item/completed` 都是空数组；`item/agentMessage/delta` 成为 `assistant_delta`；
`item/reasoning/textDelta` 经 `reasoning-delta` 成为 `reasoning_delta`，但 canonical payload 丢失
`threadId/turnId`；file/diff 成为 `status`；retryable error 的 canonical payload 丢失
`willRetry`、code 与 native IDs。

## 10. 来源

- 当前产品与 owner 约束：`docs/OWNERSHIP_MAP.md`、
  `docs/ideas/locus-interoperability-contract-v1.zh-CN.md`、
  `openspec/specs/agent-runtime-core/spec.md`
- 当前已有 trace inventory：`docs/run-event-trace-inventory.md`
- Claude SDK 精确版本类型/说明：本地
  `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` 与配套 binary；
  [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
- [Codex app-server 官方说明](https://developers.openai.com/codex/app-server/)
- [Codex app-server protocol 源码](https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol)

## 11. 评审记录

**REVIEW_APPROVED**（fresh-context，2026-09-05）。评审独立复现 13 组实测断言与报告一致，
并要求应用以下修补：

- P2：补齐 Locus v1 盘点中的 `reasoning_delta`，并明示排除 Locus 侧生命周期事件
  `job_created`、`job_started` 的 native 映射理由。
- P3-1：移除不可复现的 schema-stable/schema-experimental manifest SHA，只保留 TypeScript
  manifest 与 per-file 摘要，并标注 `v2.schemas.json` 生成非确定。
- P3-2：补充 headless Codex app-server consumer owner，说明它只消费 canonical `RunEvent`，
  不建立第二条 native 映射链。
- P3-3：将 failed thread 磁盘重建的损失从“层次未测”升级为评审实测，定位到
  rollout 写入层，并登记 Phase 3 conformance fixture。
