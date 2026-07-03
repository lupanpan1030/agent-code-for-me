# TICKET-102 — commands/agents/skills 项目级写入改走注册根（Phase 1.3）

- **级别**：🟠 High（安全 · 任意位置写入 .claude 指令文件）
- **来源**：openspec tasks 1.3
- **前置**：TICKET-101（共享解析器）
- **实施**：Codex ｜ **审查**：Claude

## 背景与受影响文件

这三类路由据 renderer 提供的原始 `cwd`/`projectPath` 拼出 `.claude/{agents,skills,commands}` 目录并**写/删指令文件**，无注册校验：

- `src/main/lib/trpc/routers/agents.ts`：`create`（:99）、`update`、`delete`，以及 list 的 `cwd` → `path.join(input.cwd, ".claude", "agents")`（:55）。
- `src/main/lib/trpc/routers/skills.ts`：`create`（:333）、`update`、`delete`，`cwd` → `path.join(input.cwd, ".claude", "skills")`（:155）。
- `src/main/lib/trpc/routers/commands.ts`：`list`（~:1103）、`create`（~:1185）仍用原始 `projectPath` → `getProjectCommandsDir(projectPath)`（:1028）。
  （注：get/update/delete 已在 TICKET-003 改用 `resolveRealPathWithinRoot`；本票补齐 list/create。）

## 问题与失败场景

renderer 被不可信内容驱动（XSS / 被污染的工具输出）时，可用任意 `cwd`/`projectPath` 让主进程把 agent/skill/command 指令文件写到**项目根之外的任意目录**，或读取任意项目的命令列表。指令文件正是后续会被运行时执行的内容，写入即提权。

## 规定改法

1. agents/skills/commands 的项目级 create/update/delete/list：先用 TICKET-101 的 `resolveRegisteredProjectRoot`（或 chat 版）把 `cwd`/`projectPath` 解析为**已注册项目的可信根**，未注册直接拒绝。
2. 再用 `resolveRealPathWithinRoot`（TICKET-003）确保最终写入路径落在 `.claude/{agents,skills,commands}` 之内，无 traversal/symlink 逃逸。
3. 用户级（`~/.claude`）写入路径不在本票范围（见「不做范围」），保持现状。

## 验收标准

- [ ] 对抗性测试（可扩展现有 router 测试或新建）：未注册 `cwd`/`projectPath`、绝对路径、`..` traversal、指向注册根外的 name，均被拒绝。
- [ ] 正常注册项目内的 agent/skill/command 增删改查仍工作（既有测试全过）。
- [ ] `bun run check` 全绿。

## 不做范围

- 用户级 `~/.claude` 全局写入的 consent 收紧（openspec Open Question，另议）。
- 不改这三类路由的返回结构 / UI。
- 不动 get/update/delete 中已由 TICKET-003 处理好的部分。

## 审查清单（Claude 验收时核对）

1. 三个路由的项目级写/删/列**全部**覆盖，无遗漏分支。
2. 未注册项目确被拒；对抗性测试真实覆盖 traversal/symlink/未注册。
3. 复用 TICKET-101 解析器，未各写一套。
