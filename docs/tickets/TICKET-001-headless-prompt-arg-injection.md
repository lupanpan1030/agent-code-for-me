# TICKET-001 — headless prompt 参数注入可绕过沙箱/权限模式

- **级别**：🔴 High（安全）
- **类型**：命令行参数注入 / 信任边界击穿
- **实施**：Codex ｜ **审查**：Claude

## 背景与受影响文件

headless 运行时把用户/消费方提供的 `request.prompt` 作为**最后一个 argv 元素**拼进
bundled `claude` / `codex` 二进制，且 **prompt 前没有 `--` end-of-options 分隔符**：

- `src/main/lib/headless/adapters/codex.ts:11-23`（`buildCodexArgs`，prompt 在第 21 行）
- `src/main/lib/headless/adapters/claude-code.ts:9-19`（`buildClaudeArgs`，prompt 在第 17 行）
- 实际 spawn 在 `src/main/lib/headless/process-runner.ts:124`（`spawn(executable, args, ...)`）

prompt 来源均为可控自由文本，仅做长度校验：
- Local Job API：`src/shared/local-job-api.ts:399-404`（只 trim + `MAX_PROMPT_LENGTH`）
- CLI：`src/main/lib/headless/cli-args.ts:388`（`locus run --prompt`）、`:656`（`locus schedules create --prompt`）
- 定时任务同一管道：`src/main/lib/headless/schedules.ts:387`

## 问题与失败场景（已复现）

调用方请求 `mode: "plan"`，但把 prompt 设为 `--dangerously-bypass-approvals-and-sandbox`
（Codex）或 `--dangerously-skip-permissions`（Claude Code）。CLI 的 clap/参数解析器把它当
flag 消费，**覆盖掉 Locus 为 plan 模式显式设置的 `--sandbox read-only` / `--permission-mode plan`
限制** —— 击穿 plan/agent 安全边界。当前 stdio 为 `"ignore"` 时直接后果是进程挂起（DoS），
但注入原语已成立，其他单 token 危险 flag 可有直接效果。

## 规定改法

**主修复（对两个 adapter 都做）**：在 prompt 参数**之前插入 `--` end-of-options 标记**，
使其后所有内容都被当作位置参数而非 flag：

```ts
// buildCodexArgs：... "--skip-git-repo-check", "--", request.prompt ]
// buildClaudeArgs：... "--permission-mode", mode, "--", request.prompt ]
```

**必须验证 `--` 被 bundled 二进制识别**（这是验收前置条件，不能想当然）：
- 用 `resources/bin/<platform-arch>/` 下的实际二进制或已下载的 CLI，跑
  `<codex> exec --sandbox read-only --skip-git-repo-check -- "--dangerously-bypass-approvals-and-sandbox"`
  以及 Claude 对应形式，确认危险 token **被当作 prompt 文本**而非 flag（进程不再以绕过沙箱的方式启动）。
- **若某个 CLI 不支持 `--`**：改为**通过 stdin 传 prompt**（`process-runner.ts` 已支持 `input.stdin`
  路径，`hasStdin` 时 stdio 为 `"pipe"`），不要保留 argv 传递。二选一，以实际支持情况为准，并在 PR 描述里写明验证结果。

**不要**用「拒绝以 `-` 开头的 prompt」作为主修复 —— 合法 prompt 可能以 `-` 开头（如 markdown 列表），会误伤。

**统一处理**：同一模式也存在于其他 runtime adapter（Ollama / Qwen / Kun，若有 headless 适配）。
本工单范围内**检查 `src/main/lib/headless/adapters/` 下所有 adapter**，凡是把 `request.prompt`
拼进 argv 的，一律加同样的 `--` 分隔（或 stdin）。

## 验收标准

- [ ] `buildCodexArgs` / `buildClaudeArgs` 及 `adapters/` 下所有同类 adapter 的 prompt 前有 `--`（或改走 stdin）。
- [ ] 新增/更新单元测试：断言当 `request.prompt` 以 `--dangerously-...` 开头时，生成的 argv 中该值出现在 `--` 之后（或不出现在 argv 而在 stdin）。放在对应 adapter 测试或 `tests/headless-*.test.ts`。
- [ ] PR 描述记录对 bundled 二进制的 `--` 支持验证结果（命令 + 观察到的行为）。
- [ ] `bun run check` 全绿。

## 不做范围

- 不改 prompt 长度上限、不改 Local Job API 请求 schema 结构。
- 不重构 `process-runner` 的 spawn 逻辑（仅在需要 stdin 回退时使用其既有 stdin 路径）。
- 不触碰非 headless 的桌面运行时路径。

## 审查清单（Claude 验收时核对）

1. 两个 adapter + 其余 headless adapter 全部覆盖，无遗漏。
2. `--` 验证证据真实可信；若声称走 stdin，确认 argv 里确实无 prompt。
3. 测试确实覆盖 `--`-前缀 prompt 的负向断言，而非仅快照。
4. plan 模式的 `--sandbox read-only` / `--permission-mode plan` 仍在 `--` 之前、未被削弱。
