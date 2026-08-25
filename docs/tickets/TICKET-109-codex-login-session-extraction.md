# TICKET-109 — Codex 登录进程状态机移出路由

- **级别**：🟡 Yellow（架构边界）
- **来源**：`refactor-codex-desktop-service-extraction` W7 Yellow
- **状态**：仅登记；待独立 OpenSpec 与 Owner 批准

## 问题

`src/main/lib/trpc/routers/codex.ts` 的 `startLogin` procedure 仍直接组织登录子进程的
spawn、stdout/stderr 生命周期、退出状态和取消衔接。`src/main/lib/codex/login-session.ts`
已经拥有登录 session 状态，但尚未拥有完整进程状态机，因而 transport 路由仍承载了可复用的
运行时行为。

## 候选方向

让 `login-session.ts`（或经批准的相邻 owner）接收经过校验的请求和注入式进程依赖，统一拥有
spawn、输出收集、退出/取消和清理；路由只做 Zod 校验、调用 owner、映射 renderer-safe 响应。

## 验收草案

- [ ] `startLogin` 路由不再直接 spawn 或维护登录进程生命周期。
- [ ] 同一 session 的启动、取消、成功、失败与异常退出语义逐项锁定，不改变现有错误文本。
- [ ] 登录输出仍经过既有凭证脱敏 owner，renderer 不得到命令环境或原始凭证。
- [ ] 没有新旧两套登录状态机并存；`bun run check:full` 通过。

## 不做范围

- 不改变登录 procedure/input/output、Codex CLI 版本策略或认证方式。
- 不在 1a 中实施；行为差异须作为 Red 交 Owner 决策。
