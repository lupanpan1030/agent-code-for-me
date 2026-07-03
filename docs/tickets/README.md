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

## 暂不立工单的结构性改进（需先设计，不适合直接实施-审查闭环）

以下项风险高、主观性强、机械审查困难，**暂不交给 Codex 直接实施**，留待单独设计：

- 拆分 `src/renderer/features/agents/main/active-chat.tsx`（7,317 行）
- 拆分 `src/renderer/components/dialogs/settings-tabs/agents-plugins-tab.tsx`（7,050 行）
- sub-chat mode 收敛到单一真相源（SQLite 主导）
- 提取三个 runtime adapter 的共享流式管道基类
- 补 `projects` / `app-agents` / `plugins` router 单元测试（可后续单独立工单）
