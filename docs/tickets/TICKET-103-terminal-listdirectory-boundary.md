# TICKET-103 — terminal.listDirectory 加注册根边界（Phase 1.5）

- **级别**：🟠 Medium（安全 · 任意目录读取）
- **来源**：openspec tasks 1.5
- **前置**：TICKET-101（共享解析器）
- **实施**：Codex ｜ **审查**：Claude ｜ **备注**：范围小、边界清晰，适合作为本批「试水」第一票

## 背景与受影响文件

`src/main/lib/trpc/routers/terminal.ts:151-184` `listDirectory`：

```ts
listDirectory: publicProcedure
  .input(z.object({ dirPath: z.string() }))
  .query(async ({ input }) => {
    const entries = await fs.readdir(input.dirPath, { withFileTypes: true })
    // ... 返回 dirPath 下的条目、父目录等
  })
```

**零边界检查** —— renderer 传任意 `dirPath` 即读取任意目录名列表。

## 问题与失败场景

被驱动的 renderer 传 `dirPath: "/Users/<user>/.ssh"` 或任意系统路径，主进程 `fs.readdir` 返回其目录清单，泄漏文件系统结构/文件名。

## 规定改法

1. 参照 `terminal.createOrAttach` 的紧急加固（cwd 从注册 chat/workspace 服务端解析）：给 `listDirectory` 输入加上注册身份（如 `chatId` 或 workspace 标识），用 TICKET-101 解析器解析出可信根。
2. `dirPath` 若保留，则必须经 `resolveRealPathWithinRoot`（TICKET-003）确认在可信根之内；根外拒绝。目录浏览不得越出注册工作区。
3. 检查 renderer 调用点（终端目录浏览 UI）随输入 schema 变化同步更新。

## 验收标准

- [ ] 对抗性测试：根外 `dirPath`（绝对系统路径、traversal、symlink 逃逸）被拒绝；注册工作区内的目录浏览正常返回。
- [ ] renderer 调用点已适配新输入，终端目录浏览功能不回归。
- [ ] `bun run check` 全绿。

## 不做范围

- 不改 `createOrAttach`/`write`/`signal`/`kill`（`write` 属 Phase 3 consent，另票）。
- 不改终端 UI 布局，只改数据边界与必要的输入透传。

## 审查清单（Claude 验收时核对）

1. `dirPath` 确实被约束在注册根内，根外真的被拒（有测试）。
2. renderer 调用点已同步，无「schema 改了但前端没改」的断裂。
3. 复用 101/003 的既有机制，未新造边界逻辑。
