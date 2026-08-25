# TICKET-111 — Claude desktop router 剩余内联职责盘点与抽取

- **级别**：🟡 Yellow（架构边界）
- **来源**：`refactor-codex-desktop-service-extraction` W7 Yellow
- **状态**：仅登记；待盘点、独立 OpenSpec 与 Owner 批准

## 问题

Claude desktop chat 已有 `agent-sdk-desktop-run-*` staged owners，但
`src/main/lib/trpc/routers/claude.ts` 仍保留若干内联职责，例如 image capability 解析、MCP
session materialization 的编排以及 secret/runtime 输入衔接。哪些属于合法 envelope orchestration、
哪些是可复用的 durable runtime behavior，尚未形成逐块清单。

## 候选方向

先像 Codex 1a 的 pre-flight inventory 一样，将每个内联块、状态、错误顺序、source-text 测试和
canonical owner 一一映射；只有经批准的 durable block 才可移动。路由继续保留 tRPC validation、
observable envelope 和 renderer-safe emission。

## 验收草案

- [ ] 批准前形成完整 residual inventory 与行为锚点，不以文件行数代替边界判断。
- [ ] 每个被移动职责只有一个 lib owner；同变更删除旧路径并重指测试。
- [ ] Claude 错误、审批、MCP、图片、secret cleanup 和 finish 顺序保持不变。
- [ ] `bun run check:full` 与 Claude desktop smoke 通过。

## 不做范围

- 不在 Codex 1a 中修改 Claude chat pipeline。
- 不借抽取重写 SDK 行为、持久格式或公共事件词汇。
