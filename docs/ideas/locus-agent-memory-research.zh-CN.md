# Locus Handoff 回查与 Agent Memory 调研

> **状态：DEFERRED RESEARCH — NOT PLANNED / NOT RATIFIED — 2026-08-25。**
>
> 本文回答 C6 讨论中出现的两个问题：Handoff 省略上下文后，目标 Engine 能否回查来源；
> 这是否意味着 Locus 应建设通用 Agent Memory。C6 的 source-backed query 已另行确认；
> Owner 决定把通用 Agent Memory 的阅读、选择与实施讨论移动到后续。本文只保留研究材料，
> 不进入当前路线、不授权实现，也不把任何外部项目确定为依赖。

产品边界以 [Locus 产品方向与 Harness 战略](locus-product-direction-harness-strategy.zh-CN.md)
为准，已确认的互操作语义以
[Locus Interoperability Contract v1](locus-interoperability-contract-v1.zh-CN.md) 为准。

## 1. 结论

建议把 C6 的候选 A 收紧为 **A+：可审查 HandoffEnvelope + 有来源的按需回查**。

- HandoffEnvelope 仍只携带经过选择、脱敏、可预览编辑的最小上下文；
- 目标 Engine 获得一个有范围、可撤销、有期限和预算的 `HandoffContextGrant`；
- 目标 Engine 发现信息不足时，通过 Locus 查询原始可见消息、Run 事实、artifact/diff 与
  workspace provenance；
- 每个返回项必须携带准确的 `sourceRef`、内容摘要、时间与脱敏/provenance 信息；
- 原始记录不移动，摘要不替代原始记录，检索索引损坏时可以从 canonical records 重建；
- 默认不唤醒来源 Engine，也不继承它的权限、secret、隐藏推理或 native session 文件。

这会使用 memory/RAG 的部分技术，但它还不是通用 Agent Memory。C6 需要的是
**source-backed context retrieval**；跨会话偏好、persona、经验提炼和自动遗忘属于以后独立
决策的 **derived memory**。

## 2. 为什么只传摘要不够

HandoffEnvelope 的目标是低噪声、低 token、可人工确认，因此必然可能省略细节。摘要还可能：

- 把尚未确认的推测写成结论；
- 丢失日期、文件、命令结果或决定的适用条件；
- 在源 Conversation 后续变化后变旧；
- 无法证明一句话究竟来自用户、Engine、tool result 还是派生总结。

解决办法不是把全部 vendor transcript 塞给目标 Engine，而是保留两条同时存在但职责不同的
信息路径：

```text
快速开始路径
HandoffEnvelope
  └── goal / decisions / constraints / open questions / selected refs

证据核对路径
Locus canonical records
  └── scoped Context Resolver
       ├── context.search(handoffId, query)
       ├── context.get(sourceRef)
       └── artifact.read(artifactRef)
```

目标 Engine 平时使用小 envelope；遇到“这个决定为什么做”“原错误输出是什么”“哪一个文件
产生了这个结论”时，再沿引用回到底层证据。

当前 renderer 的 “Continue with Engine” 会把可见历史截成最多 50k 字符的 Markdown、创建新的
`sub_chat` 并用临时 long-text attachment 交给新 Engine。它没有 durable handoff identity、
source/target Binding、授权或引用链，也与已确认的 C1“同一 Conversation + 新 Binding”不同。
未来 approved OpenSpec 必须用唯一 Handoff owner **替换** 这条路径，不能把新 Resolver 叠加成
第二套实现。

## 3. C6 A+ 候选契约

### 3.1 Canonical source plane

Locus 只从自己有权拥有且能稳定解释的记录提供回查：

- 用户和 assistant 的 **可见** Conversation message snapshot/reference；
- 已脱敏、可公共解释的 Run/Event lifecycle 事实；
- 带 digest、来源与生命周期的 `ArtifactRef` / `DiffRef`；
- authoritative `WorkspaceExecutionContext` snapshot；
- Handoff 中由用户确认的 goal、decision、constraint 和 open question snapshot。

不得因为“方便检索”而把以下内容升级成 Locus canonical truth：

- vendor hidden reasoning；
- 未脱敏 raw tool payload / raw event log；
- native session 文件或可伪造 resume 的内部状态；
- API key、OAuth token、密码和旧 permission grant；
- Career Kit、Amadeus 的完整 Goal/Task 业务记录。

### 3.2 HandoffContextGrant

目标 Binding 只能通过一个显式 grant 回查。Grant 至少约束：

| 维度 | 约束 |
| --- | --- |
| subject | 准确的目标 Binding、client principal 与 runtime installation |
| source scope | 允许读取的 Conversation、source Binding、Run、message/artifact kinds |
| operation | search、get、artifact read 分开授权；默认只读 |
| budget | 最大结果数、字符/token、单项大小、查询次数和 timeout |
| lifetime | `issuedAt`、`expiresAt`、revocation 与 Handoff lifecycle |
| safety | allowlist、redaction policy/version、workspace/tenant boundary |
| audit | grant ID、query ID、调用方、命中 source refs 与时间 |

Grant 不等于把源 Engine 的权限搬给目标 Engine。目标 Engine 读到“Codex 曾获准执行命令”并不
表示 Claude 自动获得同一批准；新的动作仍进入 C5 Interaction 与当前 policy。

Envelope 经用户预览、删改和确认后应被封存；修改只能产生新版本。它至少记录
`schemaVersion`、payload digest、source/target Binding、Run、RuntimeInstallation、批准来源和
`asOfEventCursor`。默认回查该 cursor 对应的来源快照，避免来源 Conversation 后来改变时，同一个
Handoff 静默得到另一套事实；“查询最新内容”若有需要，应是另一个显式 scope。

### 3.3 查询结果

每个结果至少需要：

```text
ContextResult
├── sourceRef / sourceKind
├── sourceDigest
├── snippet or bounded content
├── authoredAt / capturedAt
├── authority: canonical | derived
├── redactionApplied + policyVersion
└── relevance explanation / retrieval metadata
```

目标 Engine 的回答可以引用这些 source refs。`derived` 结果只能帮助定位，不能覆盖
`canonical` 记录；如果二者冲突，应展示冲突并回到底层来源。

检索内容必须作为 **不可信引用材料** 进入目标上下文，旧消息、artifact 或仓库文件中的文字不能
被提升为 system/developer instruction。Retrieval audit 记录脱敏 query metadata 与 result refs，
不把完整敏感 query/result 再复制一份写入 ledger。

无 grant、越权、source deleted、digest mismatch 与 stale index 必须是不同的结构化结果，不能
静默扩大查询范围或 fallback。删除优先于回查承诺：派生 index/cache 必须失效；若某份快照要在
源记录删除后继续保留，就必须在 Handoff 时明确 retention、保存经过脱敏的 content-addressed
snapshot，并让用户看见这一含义。

### 3.4 “回查”不等于“问原 Engine”

这是必须保持的边界：

| 动作 | 实际含义 | 默认行为 |
| --- | --- | --- |
| source-backed retrieval | 读取 Locus 已保存的事实或 artifact | C6 A+ 可授权、只读、无需源 Engine 在线 |
| cross-engine delegation | 让来源 Engine 再分析、回答或执行 | 创建新的 Run；显式授权；受 C4 lease、C5 interaction 与费用约束 |

例如 Claude 在 Codex Handoff 后问“测试为什么失败”：

1. Claude 先查询 source Run 的脱敏 test result 和 artifact；这只是回查。
2. 如果用户要求“让 Codex 重新分析这个失败”，Locus 才在 Codex Binding 上创建新 Run。
3. 新 Run 可能花费 token、改变 workspace 或等待 Interaction，不能伪装成一次免费 memory lookup。

## 4. 它与 Agent Memory 的关系

建议把三个概念分开命名：

| 层 | 作用 | 是否属于当前 C6 |
| --- | --- | --- |
| HandoffEnvelope | 某次显式交接的最小、可审查快照 | 是 |
| Context Resolver | 按 grant 回查 canonical source，并返回可引用证据 | 是，A+ 新增部分 |
| Agent Memory | 跨 session 提炼偏好、事实、场景、persona、经验并主动召回 | 否，后续独立能力 |

因此 C6 **涉及记忆问题，但不要求先做 Agent Memory 平台**。推荐的总原则是：

```text
canonical / authoritative（不可由模型摘要覆盖）
Conversation · Run · Event · Artifact · Workspace provenance
                         │
                         ▼
derived / rebuildable（可能过时、冲突、删除或重建）
chunks · embeddings · summaries · atoms · scenarios · personas
```

任何 derived memory 都应能够追踪到 source refs/digests，支持更正、删除、失效和重建。它不能
静默改变 SessionBinding、Runtime version、permission、workspace root 或 consumer Goal/Task。

## 5. 开源项目对比

### 5.1 TencentDB-Agent-Memory

[TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) 当前把短期上下文
分层与长期记忆分层放在同一项目中。其长期路径是 L0 Conversation → L1 Atom → L2 Scenario →
L3 Persona；其短期路径保留 raw refs、步骤摘要和高层 canvas，并允许从高层逐步下钻到底层证据。
当前默认本地后端为 SQLite + sqlite-vec，也提供 BM25 + vector + RRF 的 hybrid retrieval、
检索字符/结果预算和可检查的 Markdown/Mermaid 中间产物。项目采用 MIT License。

Locus 最值得学习：

1. **Progressive disclosure**：先给结构，再按需回到底层；
2. **Evidence drill-down**：摘要保留到原对话/tool result 的引用链；
3. **检索预算**：结果数、总字符、timeout 都有硬边界；
4. **White-box observability**：派生产物能被用户检查，不只返回向量分数；
5. **Host adapter 思路**：memory core 与具体 Agent host 之间有适配边界。

不建议现在直接绑定为 Locus 核心依赖：其自动 conversation capture、persona、context offload 和
OpenClaw/Hermes hook 面向的是 Agent host；Locus 已确认不拥有通用 Agent loop，而且当前项目仍
快速演进。先借鉴契约并做可替换 provider spike，能避免把其生命周期和数据模型变成 Locus
不可逆的公共 contract。

### 5.2 Mem0

[Mem0](https://github.com/mem0ai/mem0) 是通用 memory layer，强调 user/session/agent 等 scope、
add/search/update/delete/history API，以及 semantic、keyword、entity、temporal 等检索信号。
其开源仓库采用 Apache-2.0 License，并同时提供 library、自托管与 managed 形态。

Locus 可学习 namespace/filter、CRUD/history、删除传播和评测框架；不应把自动提取出的个性化
memory 当作 Run/Handoff 的执行真相，也不应让 managed/向量服务成为基础 Handoff 的硬依赖。

### 5.3 Graphiti

[Graphiti](https://github.com/getzep/graphiti) 建模 temporal context graph：事实有 validity window，
新事实可以 supersede 旧事实，但旧历史仍保留；每个 derived fact 能追到 source episode。

Locus 可学习 `validFrom` / `validTo` / `supersedes` 与 episode provenance，用于处理“原决定 A
在当时成立，后来被 B 取代”。但 Graphiti 需要自建 surrounding system 和 graph database，
第一阶段只为 Handoff 回查引入它会明显过重。

### 5.4 LangGraph persistence / LangMem

[LangGraph persistence](https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/persistence.mdx)
区分 thread-scoped checkpoint 与跨 thread long-term store；
[LangMem](https://github.com/langchain-ai/langmem) 又区分对话 hot path 中主动写 memory，与后台提取、
整合 memory。

Locus 可学习“执行连续性”和“长期派生知识”必须分层，以及高价值事实即时写入、低优先级提炼
后台完成的时机设计。但 Locus 不拥有 vendor Agent graph/checkpoint，不能尝试复制 Codex 或
Claude 的隐藏执行状态。

### 5.5 Letta Code

[Letta Code](https://github.com/letta-ai/letta-code) 把 stateful agent、memory、identity 与学习作为
Harness 核心能力，并提供跨 conversation 搜索、可检查/版本化的 memory 文件。Locus 可学习其
“memory 可见、可审计、可版本化”与 cross-agent search 体验；不能采用其 agent 自改 memory、
prompt、skill 甚至 harness 的所有权模型，因为那会直接跨越 Locus 已确认的 Agent-loop 边界。

## 6. 适合 Locus 的分阶段路线

### Phase 0 — C6 source-backed query

先不引入 embedding 或外部 memory provider：

- canonical source refs + content digests；
- allowlist/redaction/ACL/audit；
- exact lookup 与 SQLite FTS/BM25；
- 结果/字符/token/时间预算；
- Handoff UI 展示“已携带内容”和“可回查来源”；
- adapter conformance 验证 Codex/Claude 都能调用同一 Context Resolver。

这一阶段已经能解决“摘要丢细节、第二个 Engine 无法核对”的核心问题，而且离线可用、容易定位
错误、没有 provider lock-in。

Resolver 必须由 RuntimeHost/common core 唯一拥有；renderer、Runtime adapter 和 consumer 都只
调用它，不能读取 Locus SQLite 或各自实现 search/auth。真正暴露给外部 client 的 principal、
auth 与 isolation contract 还要与 C7 的 public API 决策对齐。

### Phase 1 — rebuildable context index

在 Conversation、Run、Interaction 与 Handoff owner 稳定后，再创建派生索引：

- chunk/source mapping、index version、source digest；
- keyword + optional vector hybrid retrieval；
- source 删除/更改后的失效与重建；
- provider port，而不是业务逻辑直接依赖某一项目。

可以用同一组 fixtures 对 TencentDB-Agent-Memory、Mem0 和自带索引做 spike，不先承诺默认实现。

### Phase 2 — optional derived memory

如果真实 dogfood 证明有需求，再考虑：

- L1：有来源的 decision/constraint/preference atoms；
- L2：按项目或场景整理的 summaries；
- temporal supersedes 与人工更正/确认；
- per-user / per-workspace / per-consumer / per-Agent scope 与 retention。

L3 persona 不应成为 Locus 默认能力。它更私密、推断性更强，也可能属于 consumer/Agent persona
owner；需要单独的产品、权限和删除决策。

### Phase 3 — optional providers

只有通过 conformance/evaluation 后，才考虑 TencentDB-Agent-Memory、Mem0、Graphiti 或其他
provider adapter。Provider 故障不能阻断 canonical Conversation/Run，也不能制造第二套 truth。

## 7. 建议评测门槛

在选择 memory provider 前，至少用一组 Locus handoff fixtures 检查：

1. **exact-source recall**：能否找到准确 message/run/artifact，并返回可验证引用；
2. **stale/conflict handling**：旧决定与新决定冲突时是否保留时间和 supersedes；
3. **secret leakage**：raw tool payload、secret、hidden reasoning 是否可能被索引/返回；
4. **scope isolation**：不同 workspace、consumer、user、binding 是否串读；
5. **deletion propagation**：canonical source 删除/重置后派生索引能否失效；
6. **rebuildability**：丢弃索引后能否仅从 canonical records 重建；
7. **offline/cost/latency**：无云服务时是否仍可完成基础回查，token 和等待是否有界；
8. **human inspectability**：用户能否看见来源、纠错和撤销，而不是信任黑盒 score。

## 8. 后续需要单独确认的 Memory 决策

这些不是 C6 当前确认项，避免一次把边界扩大：

- M1：derived memory 是 Locus 内建能力，还是可选 `MemoryProvider`；
- M2：允许哪些 scope（user/workspace/conversation/consumer/persona）；
- M3：哪些 memory 自动提取，哪些必须人工确认后才能进入高层；
- M4：retention、删除、导出、更正和 source 变更后的失效规则；
- M5：是否选择默认开源 provider，以及 conformance/evaluation 门槛。

已确认的 C6 A+ 只包含“最小 envelope + scoped source-backed query；重新询问来源 Engine 仍是
另一次显式 Run”。M1–M5 继续延期，只有 Owner 以后重新开启讨论才进入 decision track。

## 9. 一手资料

- [TencentDB-Agent-Memory README](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/main/README.md)
- [TencentDB-Agent-Memory License](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/main/LICENSE)
- [Mem0 repository](https://github.com/mem0ai/mem0)
- [Mem0 how it works](https://github.com/mem0ai/mem0/blob/main/docs/core-concepts/how-it-works.mdx)
- [Graphiti repository](https://github.com/getzep/graphiti)
- [Zep / Graphiti paper](https://arxiv.org/abs/2501.13956)
- [LangGraph persistence](https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/persistence.mdx)
- [LangMem repository](https://github.com/langchain-ai/langmem)
- [LangMem conceptual guide](https://github.com/langchain-ai/langmem/blob/main/docs/docs/concepts/conceptual_guide.md)
- [Letta Code repository](https://github.com/letta-ai/letta-code)
