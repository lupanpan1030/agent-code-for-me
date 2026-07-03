# TICKET-101 — 共享「注册根解析器」模块（tRPC 边界 Phase 1.1 基础）

- **级别**：🟠 结构基础（是 102–104 的前置）
- **来源**：openspec `update-trpc-capability-boundary` tasks 1.1
- **实施**：Codex ｜ **审查**：Claude

## 背景与现状

Phase 1 的目标：**主进程校验特权效果**，把危险 procedure 的输入从「renderer 提供的原始 `cwd`/`projectPath`」改为「服务端从注册实体（project/chat）解析出的可信根」。

现状是两套互不相通的边界机制，且都不可复用：
- `src/main/lib/trpc/routers/files.ts:130` `resolveRegisteredFileRoot(rootPath)` —— **模块私有、未导出**，校验 rootPath 是否是 DB 里已注册、未移除的 project/chat worktree。
- `src/main/lib/git/security.ts` 的 `assertRegisteredWorktree` + `secureFs` —— git 路由专用。
- `commands`/`agents`/`skills`/`terminal` 等路由则**各自直接吃 renderer 的 `cwd`/`projectPath`**，无注册校验（见 TICKET-102/103/104）。

## 目标

新建一个共享解析器模块（如 `src/main/lib/fs/registered-roots.ts`），把「注册实体 → 可信根」的解析收敛到一处，供后续消费票复用。**不强行统一 git 的机制**（它已工作良好，统一是更大的重构，本票不做）。

## 规定改法

1. 新建 `src/main/lib/fs/registered-roots.ts`，导出（名字可调整，保持语义）：
   - `resolveRegisteredProjectRoot(projectPath: string): string` —— 校验 `projectPath` 是 DB `projects` 表里已注册、未标记移除的项目；否则抛 `PathBoundaryError`（或专用错误）。返回规范化后的根。
   - `resolveRegisteredChatWorktreeRoot(chatId: string): string` —— 据 `chats` 表反查该 chat 的 worktreePath / projectId，校验存在，返回可信根。
2. 将 `files.ts` 现有的 `resolveRegisteredFileRoot` 逻辑**迁移/泛化**到该模块，让 `files.ts` 改为消费它 —— **files 的对外行为不变**（这是回归底线）。
3. 与 `path-boundary.ts` 的 `resolveRealPathWithinRoot`（TICKET-003）组合使用：解析器给「可信根」，path-boundary 给「目标在根内 + 无 symlink 逃逸」。二者职责分明，不重叠。

## 验收标准

- [ ] 新模块存在并导出上述解析器；有单元测试覆盖「已注册 / 未注册 / 已移除 / 空值」四类输入。
- [ ] `files.ts` 改为消费共享模块后，既有 `tests/trpc-path-boundaries.test.ts` 等**全部照过**（行为零变化）。
- [ ] `bun run check` 全绿。

## 不做范围

- 不统一 git 的 `assertRegisteredWorktree`/`secureFs`（保持现状）。
- 不改任何消费方路由（那是 102–104 的事）；本票只交付基础设施 + files 无损迁移。
- 不改 tRPC schema、不改 preload。

## 审查清单（Claude 验收时核对）

1. files 迁移确为无损（对比迁移前后 files 相关测试与关键路径）。
2. 未注册/已移除项目确实被拒（有测试）。
3. 与 path-boundary 的职责边界清晰，无逻辑重叠或双重解析。
