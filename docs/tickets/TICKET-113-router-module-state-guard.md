# TICKET-113 — Router module-level state 通用架构守卫

- **级别**：🟡 Yellow（架构治理）
- **来源**：`refactor-codex-desktop-service-extraction` W7 Yellow
- **状态**：仅登记；待全量盘点、独立 OpenSpec 与 Owner 批准

## 问题

Codex 1a 通过定向回归测试禁止被删除的 router-side Maps 回流，但仓库尚无通用规则判断 tRPC
router 中哪些 module-level state 属于不允许的 durable business state。直接加入泛化字符串守卫
可能误伤合法常量、缓存引用或 transport-only 状态，也可能在现有违规尚未迁移时制造无法落实的
allowlist。

## 候选方向

先盘点所有 `src/main/lib/trpc/routers/` 的 module-level 可变状态并分类 canonical owner，再设计
能表达边界而非单纯匹配语法的 architecture guard。任何临时例外都必须具名 owner、删除计划和
覆盖边界的测试。

## 验收草案

- [ ] 形成全 router 的 mutable-state inventory，并区分 transport 状态与 durable business state。
- [ ] 守卫能阻止新的无 owner durable state，且现有例外逐项有理由和退出条件。
- [ ] 不修改既有 procedure 或运行时行为；architecture checks 与 `bun run check:full` 通过。

## 不做范围

- 不在 Codex 1a 中修改 `scripts/check-architecture-guards.mjs` 或 allowlist。
- 不用“一律禁止 module scope”替代 ownership 判断。
