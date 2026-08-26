# TICKET-114 — Codex desktop service extraction GUI 补测

- **级别**：🟡 验证跟进（已接受残余风险）
- **来源**：`refactor-codex-desktop-service-extraction` task 8.2 / fresh-context review
- **状态**：待 GUI-capable host 补跑；不阻断 1a 本地归档
- **绑定产品源码**：`6bf928bf00051ab1e9513b67162280677134d972`

## 问题

1a 的自动验证、持久化 parity、模块级生命周期测试和双路独立评审均已通过，但当前 Linux
主机缺少 Electron 所需的 NSPR/NSS/audio 动态库，`bun run dev` 在应用启动前失败。因此，真实
Electron 进程中的 app-shell quit/abort 接线以及完整桌面交互场景尚未执行。Owner 已在
2026-08-26 的产品验收门显式接受该残余风险；这不等同于 GUI smoke 已通过。

## 补测范围

在可正常启动本项目 Electron 开发版本的机器上，从干净 worktree 对绑定源码执行并保存证据：

- 在已有 sub-chat 上完成一次 Codex 对话，确认运行后历史完整。
- 回答一次 tool approval。
- 中途取消一次 run，并在同一 sub-chat 重新运行。
- 使用 provider profile 运行，确认 gateway token 签发和撤销。
- Codex stream 活跃时关闭应用，确认出现 confirm-and-abort 流程。
- 触发错误路径，确认 `error` 与 `finish` 各只发出一次。

若使用合入证据 SHA `13e3777a0a39724f171eb2e563dae4774d0b0926`，必须同时证明它相对绑定
产品源码只增加 1a 的文档证据。若改用更晚的 `main`，该结果只能证明当前版本，不得回填为绑定
源码的 exact-SHA 证据。

## 验收与处置

- [ ] 记录操作系统、Electron/Node/Bun 版本和实际测试 SHA。
- [ ] 六个场景均有结果、日志或截图/录屏索引，且不包含 provider secret。
- [ ] 若全部通过，在本工单和 1a archived verification 中追加补测回执。
- [ ] 若发现产品缺陷，不在本工单内顺手改代码；创建独立 bugfix/OpenSpec，绑定复现证据并走
      正常双 AI 验证流程。

## 不做范围

- 不为让 smoke 通过而改变 1a 已冻结的产品源码。
- 不把缺失系统库安装记录冒充产品行为验证。
- 不因补测晚于归档而重写原始 `IMPLEMENTATION_VERIFIED` / `REVIEW_APPROVED` verdict。
