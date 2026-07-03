# TICKET-104 — 运行时启动的 cwd 由服务端从 chatId/subChatId 解析（Phase 1.4）

- **级别**：🔴 High（安全 · 伪造 cwd 启动可写运行时）｜**改动最大、回归风险最高，建议单独一 PR、审查从严**
- **来源**：openspec tasks 1.4
- **前置**：TICKET-101（共享解析器）
- **实施**：Codex ｜ **审查**：Claude

## 背景与受影响文件

运行时启动路由把 renderer 传的 `cwd` 当可信值，直接用于启动**可读写文件、执行工具**的 agent 运行时：

- `src/main/lib/trpc/routers/claude.ts:58-78` `chat` —— 输入**已含** `subChatId`（:61）、`chatId`（:62），**但同时收必填 `cwd: z.string()`（:65）** 与可选 `projectPath`（:66），后续 `cwd: input.cwd` 直送 `createClaudeAgentSdkDesktopRunEnvelope`（:98）。
- `src/main/lib/trpc/routers/codex.ts` `chat`（design 记 :439）—— 同类。
- `src/main/lib/trpc/routers/agent-runtime.ts` `chat`（design 记 :497）—— 同类。

## 问题与失败场景

被驱动的 renderer 传合法的 `chatId` 但**伪造 `cwd`** 为任意目录，主进程即在该目录启动一个可写运行时（agent 模式下可改文件、跑工具）——项目根边界形同虚设。由于输入里**本就有可信的 `chatId`/`subChatId`**，`cwd` 属于多余且危险的信任。

## 规定改法

1. 三个 `chat` 路由：**停止信任 renderer 的 `cwd`/`projectPath`**，改为用 TICKET-101 的 `resolveRegisteredChatWorktreeRoot(chatId)`（或据 `subChatId`）从 DB 反查该 chat 注册的 worktree/项目路径，服务端解析出 cwd。
2. 处理方式二选一，取一致：
   - **首选**：从输入 schema 移除 `cwd`（及可用服务端替代的 `projectPath`），全部服务端解析；
   - **或**：保留 `cwd` 但校验其等于服务端解析值，不等则拒绝（`PathBoundaryError`），作为过渡兼容——但必须有测试证明伪造值被拒。
3. 同步更新三处 renderer 调用点（不再发送 cwd，或发送但知其会被校验）。
4. MCP config lookup 用的 `projectPath` 若确需保留，也应能从注册项目服务端推导；不能推导的字段单列说明。

## 验收标准

- [ ] 对抗性测试：合法 `chatId` + 伪造 `cwd`（≠ 注册 worktree）被拒绝或被服务端值覆盖，运行时**不**在伪造目录启动。
- [ ] 三个运行时（claude/codex/agent-runtime）的正常聊天启动全部不回归（既有 desktop-run/envelope 相关测试全过）。
- [ ] renderer 调用点已适配。
- [ ] `bun run check` 全绿。

## 不做范围

- 不改运行时内部执行逻辑、流式管道、preflight。
- 不做 Phase 3 的 consent/audit（另议）。
- scopeContract 等既有安全机制保持不变。

## 审查清单（Claude 验收时核对）

1. 三个路由**都**不再直接信任 renderer `cwd`；伪造值有测试证明被拒/被覆盖。
2. 热路径无回归：重点核对 desktop-run envelope、session 恢复、plan/agent 模式切换。
3. 若采用「校验相等」过渡方案，确认解析值与历史行为一致，不会误伤合法 worktree 路径（大小写/软链/末尾斜杠）。
4. 因风险高，建议此票单独成 PR，不与其他票混合。
