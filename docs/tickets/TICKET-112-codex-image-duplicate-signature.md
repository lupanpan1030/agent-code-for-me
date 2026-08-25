# TICKET-112 — Codex 图片提示词重复签名语义统一

- **级别**：🟡 Yellow（用户可见行为）
- **来源**：Codex 1a persistence 抽取时确认的基线不对称
- **状态**：仅登记；待产品语义决策、独立 OpenSpec 与 Owner 批准

## 问题

Codex 重试去重同时比较 prompt、long-text 和 image signature。现有
`codexImageAttachmentSignatureFromParts` 与 `codexImageAttachmentSignatureFromInput`
对同一 staged image 生成的 JSON 签名形状不一致，因此“相同文字 + 相同图片”的重试当前仍被
判断为非重复并追加一条 user message。1a 是行为保持型重构，已用测试锁定并保留该基线，没有
顺手修复。

## 待 Owner 确认的产品语义

需要先决定相同图片重试究竟应复用上一条 user message，还是每次都形成新的消息。若选择去重，
还需定义身份依据（稳定 attachment id、content hash、local ref 或其组合）以及旧消息缺字段时的
降级规则。

## 验收草案

- [ ] 先批准“相同图片重试”的明确可见语义和身份规则。
- [ ] input/parts 两侧使用一个 canonical signature owner，不保留双算法。
- [ ] 测试覆盖相同图片、不同 local ref、相同内容不同 attachment id、缺字段旧消息和多图顺序。
- [ ] 明确现有测试数据是否需要迁移；`bun run check:full` 通过。

## 不做范围

- 不在 1a 中改变去重结果或 `subChats.messages` 格式。
- 不把图片二进制、base64 或本地绝对路径写入新的公共合同。
