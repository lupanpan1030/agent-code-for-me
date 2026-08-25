# TICKET-110 — Claude settings 持久状态与反向依赖收敛

- **级别**：🟡 Yellow（架构边界）
- **来源**：`refactor-codex-desktop-service-extraction` W7 Yellow
- **状态**：仅登记；待独立 OpenSpec 与 Owner 批准

## 问题

`src/main/lib/trpc/routers/claude-settings.ts` 仍是持久设置和插件读取的事实 owner，导致四条
main-process lib → router 的反向依赖：

- `src/main/lib/runtime-mcp-config/claude.ts`
- `src/main/lib/agent-builder/claude-native-agents.ts`
- `src/main/lib/mcp-auth.ts`
- `src/main/lib/claude/agent-sdk-config-dir.ts` 的动态 import

这与“router 只负责 transport/input mapping，lib 拥有持久行为”的依赖方向不一致。

## 候选方向

先盘点 `claude-settings.ts` 的设置、插件、缓存和持久化原子，再建立唯一 lib owner；四个 lib
消费者与路由在同一变更内改用该 owner，并删除 router 侧原实现，禁止临时双路径。

## 验收草案

- [ ] 上述四个 lib 不再解析到 `trpc/routers/claude-settings`。
- [ ] 设置和插件持久化只有一个 canonical owner，读写、缓存失效和错误语义保持不变。
- [ ] app-shell/router 只通过 owner 消费，架构测试锁定无反向 import。
- [ ] `bun run check:full` 通过。

## 不做范围

- 不与 Claude desktop chat pipeline 抽取混做。
- 不改变设置格式、插件启用语义、renderer procedure 或持久数据。
