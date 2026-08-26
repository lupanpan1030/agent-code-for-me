# 审查整改工单（Review Remediation Tickets）

来源：2026-07-03 全面审查（安全 / 架构卫生 / 热点模块 / 检查套件 4 条并行审查线）。
工作流：**Claude 写工单 → Codex 实施 → Claude 按「审查清单」验收**。

每张工单自包含：不看审查对话也能实施。实施时**严格遵守「不做范围（Out of scope）」**，
避免顺手改动扩大审查面。所有工单完成后须保证 `bun run check` 全绿。

## 优先级与顺序

| 工单 | 标题 | 级别 | 建议顺序 |
|------|------|------|---------|
| [TICKET-001](TICKET-001-headless-prompt-arg-injection.md) | headless prompt 参数注入绕过沙箱 | 🔴 High（安全） | 1 |
| [TICKET-002](TICKET-002-chat-normalizer-crash.md) | 损坏消息使聊天 UI 崩溃 | 🔴 High（崩溃） | 2 |
| [TICKET-003](TICKET-003-symlink-path-boundary.md) | 符号链接绕过文件边界 → 任意读 | 🟠 Medium（安全） | 3 |
| [TICKET-004](TICKET-004-db-migration-failure.md) | 迁移失败静默退化 | 🟠 Medium（数据完整性） | 4 |
| [TICKET-005](TICKET-005-electron-defensive-hardening.md) | OAuth 绑定 + openExternal 白名单 | 🟡 Low（防御加固） | 5 |
| [TICKET-006](TICKET-006-dependency-upgrades.md) | 直接依赖漏洞升级 | 🟡 Medium（依赖债） | 6 |
| [TICKET-007](TICKET-007-ci-full-lint-audit.md) | CI 加全量 lint + audit 门禁 | 🟡 Low（流程） | 7 |

**顺序原则**：001–004 是安全/正确性，先做；005–007 是防御与流程，可并行。
每张工单独立提交（一 PR 一工单），便于逐条审查。

**状态**：001–007 已实施并经审查，随 [PR #15](https://github.com/lupanpan1030/agent-code-for-me/pull/15) 合并入 main（merge `3161f118`）。

## 第二批 — tRPC capability boundary Phase 1（输入信任收敛）

来源：openspec `update-trpc-capability-boundary`（设计已就绪，`design.md` 含完整危险 procedure 清单）。
目标：把危险 procedure 的输入从「renderer 原始 `cwd`/`path`」改为「服务端从注册实体解析的可信根」。

| 工单 | 标题 | 级别 | 顺序 |
|------|------|------|------|
| [TICKET-101](TICKET-101-shared-registered-root-resolver.md) | 共享注册根解析器（基础） | 🟠 结构基础 | 1（前置） |
| [TICKET-102](TICKET-102-commands-agents-skills-registered-root.md) | commands/agents/skills 写入走注册根 | 🟠 High 安全 | 2 |
| [TICKET-103](TICKET-103-terminal-listdirectory-boundary.md) | terminal.listDirectory 加边界（小·试水） | 🟠 Medium 安全 | 2 |
| [TICKET-104](TICKET-104-runtime-start-server-resolved-cwd.md) | 运行时启动 cwd 服务端解析 | 🔴 High 安全 | 3（单独 PR） |
| [TICKET-105](TICKET-105-mcp-provider-config-validation.md) | MCP/provider 配置根解析 + 输入校验 | 🟠 High 安全 | 2 |
| [TICKET-106](TICKET-106-arch-guard-dangerous-router-inputs.md) | 架构守卫：危险输入必经解析器 | 🟡 结构防回归 | 4（最后） |

**顺序**：101 前置 → 102/103/105 可并行 → 104 单独一 PR（改动最大、热路径）→ 106 最后（依赖前面收敛完成，否则守卫会因现存违规而红）。

**状态（2026-08-12 核实）**：101–106 **全部已实施并合入**，各自有具名 commit —
`583096cc`(101) / `d941aa23`(102) / `da8f688f`(103) / `c8bc01e1`(104) / `bb4f7d97`(105) / `0c805948`(106)。
本批工单不再是待办，保留仅作记录。Phase 1 的收敛成果（服务端从注册实体解析 cwd、拒绝渲染层伪造）
是 **worktree-per-run + cwd 租约** 工作的现成基础，见 [../ideas/cross-engine-delegation.md](../ideas/cross-engine-delegation.md) P1-2。

Phase 2（渲染层 markdown/webview 隔离）与 Phase 3（capability 中间件/consent/audit）仍未拆工单，
对应 openspec `update-trpc-capability-boundary` 剩余的 8 条任务。

## 第三批 — 并行安全（2026-08-12 路线图梳理产出）

对应产品取景框收敛为「在真实 git 仓库上安全并行地跑 agent」后，识别出的活缺陷。

| 工单 | 标题 | 级别 | 状态 |
|------|------|------|------|
| [TICKET-107](TICKET-107-external-config-write-safety.md) | 外部运行时配置写入安全（备份/校验/回滚/串行） | 🟠 Medium | 待实施 |

**背景**：Locus 对用户全局 `~/.codex/config.toml` 的写入是无锁读-改-写，无备份无回滚。
这是**跨所有并行运行的共享可变状态**，worktree 隔离解决不了它——每个 worktree 独立，
但指向的是同一份用户配置。并行度越高，交错窗口越大。

## 暂不立工单的结构性改进（需先设计，不适合直接实施-审查闭环）

以下项风险高、主观性强、机械审查困难，**暂不交给 Codex 直接实施**，留待单独设计：

- 拆分 `src/renderer/features/agents/main/active-chat.tsx`（7,317 行）
- 拆分 `src/renderer/components/dialogs/settings-tabs/agents-plugins-tab.tsx`（7,050 行）
- sub-chat mode 收敛到单一真相源（SQLite 主导）
- 提取三个 runtime adapter 的共享流式管道基类
- 补 `projects` / `app-agents` / `plugins` router 单元测试（可后续单独立工单）

## 第四批 — Foundation 路由抽取后的 Yellow 后续（2026-08-26）

来源：approved OpenSpec `refactor-codex-desktop-service-extraction` 的 W7 autonomy
envelope。以下事项在 1a 中**仅登记，不授权实施**；每项都需要重新设计、批准和独立变更，不能
借 1a 收尾顺手处理。

| 工单 | 标题 | 级别 | 状态 |
|------|------|------|------|
| [TICKET-109](TICKET-109-codex-login-session-extraction.md) | Codex 登录进程状态机移出路由 | 🟡 Yellow（架构） | 待设计 / 未授权实施 |
| [TICKET-110](TICKET-110-claude-settings-state-extraction.md) | Claude settings 持久状态与反向依赖收敛 | 🟡 Yellow（架构） | 待设计 / 未授权实施 |
| [TICKET-111](TICKET-111-claude-desktop-router-residuals.md) | Claude desktop router 剩余内联职责盘点与抽取 | 🟡 Yellow（架构） | 待设计 / 未授权实施 |
| [TICKET-112](TICKET-112-codex-image-duplicate-signature.md) | Codex 图片提示词重复签名语义统一 | 🟡 Yellow（行为） | 待产品决策 / 未授权实施 |
| [TICKET-113](TICKET-113-router-module-state-guard.md) | Router module-level state 通用架构守卫 | 🟡 Yellow（治理） | 待盘点 / 未授权实施 |
| [TICKET-114](TICKET-114-codex-desktop-extraction-gui-smoke.md) | Codex desktop service extraction GUI 补测 | 🟡 验证跟进 | 待 GUI-capable host 补跑 |

## 第五批 — Chat Session Binding Yellow 后续（2026-08-26）

来源：approved OpenSpec `add-chat-session-binding` 的 W7 autonomy envelope。该事项在
Foundation 1b 中只登记；需要新的设计、Owner 批准和独立变更。

| 工单 | 标题 | 级别 | 状态 |
|------|------|------|------|
| [TICKET-115](TICKET-115-claude-binding-source-resolution.md) | Claude binding source resolution 与 divert UX | 🟡 Yellow（架构/体验） | 待设计 / 未授权实施 |
| [TICKET-116](TICKET-116-provider-profile-codex-reasoning-effort.md) | Provider Profile Codex reasoning effort 与逐协议翻译 | 🟡 Yellow（能力/协议） | 待设计 / 未授权实施 |
| [TICKET-117](TICKET-117-provider-helper-default-protocol-eligibility.md) | Provider helper 默认项的协议能力一致性 | 🟡 Yellow（能力/一致性） | 待设计 / 未授权实施 |
| [TICKET-118](TICKET-118-first-party-chat-model-admission-authority.md) | 一方聊天模型准入与 catalog 权威 | 🟡 Yellow（架构/能力） | 待设计 / 未授权实施 |
