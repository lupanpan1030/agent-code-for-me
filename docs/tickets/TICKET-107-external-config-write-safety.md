# TICKET-107 — 外部运行时配置写入安全（备份 / 校验 / 回滚 / 串行）

**级别**：🟠 Medium（数据完整性 · 并行安全）
**来源**：2026-08-12 路线图梳理。原始设计出自已删除的 `docs/ideas/runtime-environment-center-plan.md`
（learn-from-`cc-switch` 灵感库）第 6 节 "External Config Write Flow" —— 该文档被删除前摘出此项，
因为它是三份灵感库中**唯一未被吸收**的想法，且在"安全并行"主题下是一个活缺陷而非假想问题。

## 问题

Locus 会写入**用户全局的、不属于 Locus 的**运行时配置文件。当前实现只有原子性，没有可恢复性。

`src/main/lib/runtime-mcp-config/codex.ts:522-529`：

```ts
async function writeCodexConfigToml(source: string): Promise<void> {
  const configPath = getCodexConfigPath()          // ~/.codex/config.toml —— 用户的文件
  await mkdir(dirname(configPath), { recursive: true })
  const tempPath = `${configPath}.tmp`
  await writeFile(tempPath, source)
  await rename(tempPath, configPath)               // 原子替换，但整份覆盖
}
```

调用方是读-改-写：读整份 TOML → 内存里增删 MCP server 块（`removeCodexMcpServerTomlBlock` /
`buildCodexMcpServerTomlBlock`，:421/:439，调用点 :1073-1078）→ 整份写回。

缺什么：

| 缺失 | 后果 |
|---|---|
| **无锁 / 无串行队列** | `grep -n "lock\|mutex"` 在整个 `src/main/lib/runtime-mcp-config/` 无结果。两次并发的读-改-写会互相静默覆盖——后写的赢，先写的改动消失 |
| **无备份** | 写坏了没有退路。这是**用户的** Codex 配置，不是 Locus 的 |
| **无写后校验** | 生成的 TOML 若不合法，Locus 不知道；用户下次跑 Codex 才发现 |
| **无回滚** | 同上，且无自动恢复 |
| **无手动恢复入口** | UI 里没有任何"还原我的 config"的地方 |

**为什么现在重要。** 这是**跨所有并行运行的共享可变状态**。工作区隔离（worktree-per-run）解决不了它——
每个 worktree 各自独立，但它们指向的是**同一个** `~/.codex/config.toml`。并行度越高，交错窗口越大。

## 目标流程

摘自原设计，按当前代码现实裁剪（原设计的 3/4/5 步"预览+批准"对 MCP 注册这种高频写入过重，
建议只对**破坏性/首次接管**场景要求批准，常规写入走"备份+校验+回滚"即可）：

1. 分类目标文件：user-owned / runtime-owned / Locus-managed / unknown
2. **串行化**：同一路径的写入进队列，禁止并发读-改-写
3. **写前带时间戳备份**（保留最近 N 份，有上限）
4. 应用最小写入
5. **写后校验**：重新解析，确认运行时仍能读懂
6. **校验失败自动回滚**到备份
7. UI 暴露**手动恢复**入口

## 范围

**In scope**：`src/main/lib/runtime-mcp-config/codex.ts` 的写路径，以及同目录 `claude.ts` 里
任何等价的外部文件写入。串行化机制应可复用（可考虑复用 `src/main/lib/git/git-factory.ts:70`
的 `withGitLock` 形状，但注意它对 3+ 等待者的行为有已知缺陷，别直接照抄）。

**Out of scope**：
- Locus 自己托管的、每次运行重建的配置（如 `src/main/lib/codex/app-server-plugin-home.ts` 写的
  per-run `config.toml`）——那是 Locus 的文件，重建是设计意图，不需要备份
- 凭证文件（`~/.codex/auth.json`、`anthropic_accounts`）——另有 `secure-storage.ts` 路径
- 原设计中的"导入预览"流程（MCP deep-link import preview 已实现并有规格）

## 验收

- [ ] 同一配置路径的并发写入被串行化，有测试覆盖交错场景
- [ ] 每次写入前产生带时间戳备份，且有数量上限不会无限增长
- [ ] 注入一份不合法的生成结果，能被写后校验捕获并自动回滚，原文件完好
- [ ] UI 有手动恢复入口
- [ ] `bun run check` 全绿
