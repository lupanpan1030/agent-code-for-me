# TICKET-002 — 单条损坏消息使整个聊天 UI 崩溃

- **级别**：🔴 High（未捕获异常 / 可用性）
- **类型**：类型守卫缺失导致 TypeError
- **实施**：Codex ｜ **审查**：Claude

## 背景与受影响文件

`src/shared/chat-message-normalizer.ts` 对消息 part 的 `type` / `toolName` 等字段调用字符串方法
（`.startsWith(...)` / `.includes(...)`），只用可选链保护：

- `src/main/`... 无关；核心在 `src/shared/chat-message-normalizer.ts`：
  - `:105` `normalizeToolStateAndOutput`：`if (!part.type?.startsWith("tool-") || !part.state)`
  - `:120-125` `isCodexMcpWrapperPart`：`part.type?.startsWith(...)` / `part.toolName?.startsWith(...)` / `part.input?.toolName?.startsWith(...)`
  - 通读全文件，**所有**对可能非字符串字段调用 `.startsWith` / `.includes` / `.replace` 等的位置一并处理（`isAcpToolPart` 等）。

调用点无 ErrorBoundary 兜底：
- `src/renderer/features/agents/lib/agent-chat-api.ts:51`（`toDesktopAgentSubChat`，每个 sub-chat 水合都跑）
- `src/renderer/features/agents/main/active-chat.tsx:5613`（`inferProviderFromMessages`，render 期 `useMemo`）

## 问题与失败场景（已复现）

可选链只挡 `null`/`undefined`，**不挡非字符串**。若持久化 part 的 `type` 是数字（坏写入、迁移事故、
或 CLAUDE.md 记录的「手工改库调试」流程），`.startsWith` 抛 `TypeError: ... is not a function`，
未捕获。复现：

```ts
normalizePersistedChatMessages(
  JSON.stringify([{ id: "m1", role: "assistant", parts: [{ type: 42, state: "result" }] }])
)
// → throws TypeError
```

因两个调用点都在无 ErrorBoundary 的水合/渲染路径上，**一条损坏消息会让整个聊天 UI 崩溃**，
而非仅跳过该消息。该文件对整数组 JSON 解析失败已有 `parseFailureMessage` 兜底，但对单个 part
的形状错误无等价保护。

## 规定改法

1. 在 `chat-message-normalizer.ts` 内新增小工具并替换所有裸调用：

   ```ts
   const asString = (v: unknown): string => (typeof v === "string" ? v : "")
   // 用法：asString(part.type).startsWith("tool-")
   ```

   或等价地在每个判断前加 `typeof part.type === "string"` 守卫。要求：**遍历全文件**，
   不留任何对 `part.type` / `part.toolName` / `part.input?.toolName` 等的未守卫字符串方法调用。

2. 可选但推荐：给逐个 part 的规范化包一层 try/catch，异常时保留原始 part（或转为安全的
   fallback part），使单个畸形 part 不影响同数组其他 part —— 与既有 `parseFailureMessage`
   的容错哲学一致。

## 验收标准

- [ ] 全文件无未守卫的字符串方法调用（`grep -n 'part\.\(type\|toolName\).*\.\(startsWith\|includes\)'` 结果均已加守卫）。
- [ ] 在 `tests/chat-message-normalizer.test.ts` 新增用例：part 的 `type` 为 `42` / `null` / 对象，`toolName` 为数字等，断言 `normalizePersistedChatMessages` **不抛异常**并返回结构合理的结果。
- [ ] `bun run check` 全绿。

## 不做范围

- 不改消息 schema、不改 `parseFailureMessage` 的既有行为。
- 不在 renderer 侧新增 ErrorBoundary（可另立工单；本工单只在 normalizer 层根治）。

## 审查清单（Claude 验收时核对）

1. 确认畸形输入（数字/对象 type）真的不再抛，用新测试跑通。
2. 守卫覆盖全文件，非只改了报告点名的三行。
3. 正常消息的规范化输出未被改变（回归：既有测试仍全过）。
