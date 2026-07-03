# TICKET-003 — 符号链接绕过文件边界检查导致任意文件读取

- **级别**：🟠 Medium（安全）
- **类型**：路径边界仅词法校验，未解引用符号链接
- **实施**：Codex ｜ **审查**：Claude

## 背景与受影响文件

`src/main/lib/fs/path-boundary.ts` 的 `resolvePathWithinRoot`（第 34-64 行）只做**词法**校验
（`resolve` / `relative` / `isAbsolute`），从不 `realpath` / `lstat`。文件读取 procedure 走这条边界：

- `src/main/lib/trpc/routers/files.ts`：
  - `resolveFilePathWithinRegisteredRoot`（:156-165）→ `resolvePathWithinRoot`
  - `readFile`（:431-444）、`readTextFile`（:450-492）、`readBinaryFile`（:497+）
  - `scanDirectory`（:182+）不特判符号链接
- `src/main/lib/trpc/routers/commands.ts:1041-1063`（`resolveCommandDisplayPathWithinRoot`，同类词法校验）

## 问题与失败场景（已核实）

项目根内放一个符号链接 `project/link.txt -> /etc/passwd`（或 `~/.ssh/id_rsa`）。因为**链接路径本身**
在词法上位于根内，边界检查通过；而 `fs.readFile` 在实际 I/O 时**解引用符号链接**，返回根目录外内容。
`scanDirectory` 不特判符号链接，故它在文件树/预览 UI 里显示为普通文件。攻击链：agent 本就有项目内
bash 写权限，可能因 scope 不当的 `ln -s` 或来自不可信仓库文件的 prompt 注入而创建该链接，用户预览即泄漏。

> 注：`renameFile` / `deleteFile` 风险较低（`fs.rename` / `shell.trashItem` 通常作用于链接本身而非解引用），
> 本工单**聚焦读取路径**；写/删路径可顺带评估但非必须。

## 参照实现（仓库内已有正确范式）

`src/main/lib/agent-guard/contract.ts:477-478` 已用 `realpath` 对比做符号链接安全校验：

```ts
const worktreeReal = await realpath(worktreePath)
const targetReal = await realpath(resolve(worktreePath, relativePath))
// 然后校验 targetReal 位于 worktreeReal 之内
```

`src/shared/local-job-api.ts` 的 artifact 路径处理也已有符号链接检查 —— 与其保持一致的严格度。

## 规定改法

1. 在 `path-boundary.ts` 新增**异步**版本（保留现有同步版给不涉及 I/O 的调用方）：

   ```ts
   export async function resolveRealPathWithinRoot(input: {
     targetPath: string; rootPath: string
   }): Promise<string> {
     // 先做现有词法校验（复用 resolvePathWithinRoot 的前置检查）
     // 再 realpath(root) 与 realpath(target) 对比；
     // target 不存在时（未来写/创建路径）对其父目录做 realpath 校验
     // 落在 realpath(root) 之外 → 抛 PathBoundaryError
   }
   ```

   用 `isPathInsideOrEqual(realRoot, realTarget)` 复用既有包含判断。注意处理 `ENOENT`
   （读取路径目标应存在；若复用于创建路径，退化为父目录 realpath 校验）。

2. 让 `readFile` / `readTextFile` / `readBinaryFile` 改用 `resolveRealPathWithinRoot`。

3. `scanDirectory`：对每个目录项 `lstat`，**跳过或明确标记**符号链接项（不将其解引用后纳入结果）。
   若产品需要展示符号链接，则必须校验其 `realpath` 仍在根内，否则排除。

4. `commands.ts:1041-1063` 的 `resolveCommandDisplayPathWithinRoot` 同步升级为 realpath 校验。

## 验收标准

- [ ] 新增 `tests/`（可扩展 `trpc-path-boundaries.test.ts`）：在临时根内创建指向根外目标的符号链接，断言 `readFile`/`readTextFile`/`readBinaryFile` 拒绝（抛 `PathBoundaryError` 或返回错误结果），而非返回根外内容。
- [ ] 断言 `scanDirectory` 不把指向根外的符号链接当普通文件返回。
- [ ] 正常（非符号链接）文件读取与目录扫描行为不变（既有测试全过）。
- [ ] `bun run check` 全绿。

## 不做范围

- 不改 `files.ts` 的返回结构 / MIME 逻辑 / 大小上限。
- 写/删路径（rename/delete）本工单可不改（风险低）；如改，需单独测试。
- 不引入新依赖，用 `node:fs/promises` 的 `realpath` / `lstat`。

## 审查清单（Claude 验收时核对）

1. 符号链接指向根外时读取被拒；指向根内时仍可读（不误伤合法用法）。
2. `realpath` 的 `ENOENT` 分支处理正确，不会让创建/写入路径全部报错。
3. `scanDirectory` 与 `commands.ts` 同步覆盖，未只改 `files.ts` 读取三函数。
4. 与 `agent-guard/contract.ts` 的既有范式一致，未各写一套。
