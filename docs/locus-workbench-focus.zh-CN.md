# Locus 工作台定位与范围切割

语言：[English](locus-workbench-focus.md) | 简体中文

> **状态：产品方向已于 2026-08-25 被取代。** Canonical 产品方向见
> [Locus 产品方向与 Harness 战略](ideas/locus-product-direction-harness-strategy.zh-CN.md)。
> 本文仅保留为历史执行切片记录；该状态既不撤销、也不批准任何 OpenSpec change。

## 稳定定位

Locus 是一个用于在真实 Git 仓库上安全并行运行 coding agent 的工作台。

用户可见的产品是一个面向项目 Workspace 的 local-first 桌面工作台。它把 agent 活动、
本地变更、冲突证据、runtime 状态、usage 和审查操作集中在一处，同时让用户保有控制权。

Runtime adapter、provider profile、gateway routing、local job、daemon、schedule 和 protocol
surface 都是支撑层，不应该反过来成为产品定位。

不要把 Locus 的主定位写成 AI OS、通用 workflow orchestrator、local job platform 或
runtime hub。

## 当前底座

当前代码已经有足够底座，不需要继续横向发散：

- engine 集合封闭为两个：Claude Code 和 Codex，并已有 capability manifest 和 run gate
- Codex desktop/chat adapter 只使用 app-server；Locus 自有的 `locus jobs-stdio`
  JSON-RPC job surface 不是 ACP，也不是 Codex desktop adapter
- local job 层已经支持 `locus run`、`locus jobs`、daemon、schedule、API run、status、
  event、cancel、retry 和 heartbeat
- provider profile 和 provider gateway 已能表达第三方或本地模型后端，并避免把 provider
  secret 传给 renderer
- Agent Workbench 已经聚合面向项目的 Workspace，并复用现有 chat、diff/review 和 GitHub
  workflow surface

下一步应让并行 agent 操作更安全、更容易裁决，而不是再增加 engine 或审查界面。

## 当前切片

并行安全的推进顺序是：

```text
现在做跨 Workspace 冲突检测；下一步做 Workspace 隔离
```

把顺序固定为两个有边界的切片：

1. 现在：跨 Workspace 冲突检测
   根据 Workbench 已收集的状态显示同路径警告。只有用户明确操作时才运行更深的 hunk
   和 committed-tree 检查，清楚标注其边界，并把审查路由到现有的过滤 diff surface。
   冲突是标注，不是任务状态。

2. 下一步：Workspace 隔离
   在另一个经过批准的 OpenSpec change 中定义 cwd lease、rollback safety 和
   worktree-per-run。本次冲突检测不会实现或暗示这些保证。

两个切片都不会让 Locus 自动 merge 或解决冲突；裁决权仍在用户手中。

## 范围规则

现在只允许推进直接服务并行安全切片的工作：

- 如实展示跨 Workspace 活动和重叠
- 在保留现有状态分类的同时增加冲突标注
- 按真实置信度和覆盖范围标注 path、hunk 与 committed-tree 证据
- 复用现有 per-Workspace diff/review surface 和 registered-root 边界
- 为安全性和 subprocess 成本声明记录可复现的验证证据

不属于当前切片的工作先停到 backlog：

- 自动 merge、rebase 或解决冲突
- 在当前冲突 change 中加入 cwd lease、rollback 改动或 worktree-per-run
- 重新把 engine 集合扩到 Claude Code 和 Codex 之外
- 与安全并行无关的 runtime 功能扩张
- 通用 workflow engine
- AI OS 定位
- computer-use 或 screen-control 功能
- 继续扩张已经交付的 runtime-scoped plugin marketplace center
- 全模型 benchmark
- 完整 hosted/headless SaaS
- 把 ACP 当作 Codex desktop adapter 或主产品目标
- durable workflow management

## 活跃 Proposal 切割

以 `openspec list` 为准。在当前列表中，`add-cross-workspace-conflicts` 是面向用户的焦点。
`update-trpc-capability-boundary`、`add-local-job-api-runtime-readiness`、
`add-headless-provider-binding`，以及已完成但尚未 archive 的 `add-remote-model-catalog`，
都属于支撑或安全工作，不会重新定义产品主张。

`add-agent-native-projection-writes` 和 `add-policy-grant-scope-enforcement` 继续保持 deferred。
Workspace 隔离必须先形成单独获批的 change，之后才能实现。

## 文档规则

可以使用：

```text
Locus 是一个用于在真实 Git 仓库上安全并行运行 coding agent 的工作台
面向项目的 Workspace
跨 Workspace 冲突标注
诚实标注的 path、hunk 和 committed-tree 证据
现有 per-Workspace diff/review surface
Claude Code 和 Codex 是封闭的 engine 集合
Codex app-server 用于 desktop/chat
Locus 自有的 `locus jobs-stdio` JSON-RPC job surface（不是 ACP）
Workspace 隔离是下一个需单独获批的切片
```

不要作为主定位使用：

```text
AI OS
local job platform
runtime hub
workflow orchestrator
自动冲突解决器
complete ACP server
ACP 是 Codex desktop adapter
universal automation platform
computer-control platform
cloud agent platform
complete filesystem isolation
```
