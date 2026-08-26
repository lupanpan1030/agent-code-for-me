# TICKET-114 — Foundation desktop runtime GUI 补测（1a + 1b）

- **级别**：🟡 验证跟进（已接受残余风险）
- **来源**：`refactor-codex-desktop-service-extraction` task 8.2 与
  `add-chat-session-binding` task 7.4 / fresh-context review
- **状态**：待 GUI-capable host 补跑；不阻断 1a / 1b 本地归档
- **绑定产品源码**：
  - Foundation 1a：`6bf928bf00051ab1e9513b67162280677134d972`
  - Foundation 1b：`1d019f8d4fab38829ad0e3108e9569b260ab9302`

## 问题

1a 与 1b 的自动验证、模块级生命周期/并发测试和双路独立评审均已通过，但当前 Linux 主机
缺少 Electron 所需的 NSPR/NSS/audio 动态库，`bun run dev` 在应用启动前失败。因此，真实
Electron 进程中的 app-shell quit/abort 接线，以及 DB-backed Chat Session Binding 的完整桌面
交互与重启恢复场景尚未执行。Owner 分别在 2026-08-26（1a）和 2026-08-27（1b）的产品验收门
显式接受该残余风险；这不等同于任何 GUI smoke 已通过。

## 补测范围

在可正常启动本项目 Electron 开发版本的机器上，从干净 worktree 对相应绑定源码执行并保存
证据。各轨道必须分别记录，不得用一个成功场景概括另一条失败轨道。

### Foundation 1a — Codex desktop service extraction

- 在已有 sub-chat 上完成一次 Codex 对话，确认运行后历史完整。
- 回答一次 tool approval。
- 中途取消一次 run，并在同一 sub-chat 重新运行。
- 使用 provider profile 运行，确认 gateway token 签发和撤销。
- Codex stream 活跃时关闭应用，确认出现 confirm-and-abort 流程。
- 触发错误路径，确认 `error` 与 `finish` 各只发出一次。

### Foundation 1b — DB-backed Chat Session Binding

- 分别新建 Claude 与 Codex Chat，并各完成一次真实发送和继续对话。
- 修改非 Profile Codex Chat 的模型与 thinking level，确认下一次 Run 使用新绑定。
- 绑定 Provider Profile，确认 `thinkingLevel` 持久化为 `NULL` 且 UI 不显示/启用 effort。
- 退出应用、清除 renderer localStorage、重新启动，确认两个 Chat 均从数据库恢复正确的
  runtime/model/source/Profile/thinking binding 并可继续发送。
- 在空 Chat 上切换 Engine，确认非空 Chat 的 runtime 切换被拒绝。
- 修改 new-chat defaults，确认既有 Chat 不被重新绑定，新建 Chat 才使用新默认值。
- 在 Run 活跃或 draining 时触发 rollback，确认展示结构化 BUSY 且不会破坏工作树或历史；Run
  完成后再执行一次有效 rollback。

若使用 1a 合入证据 SHA `13e3777a0a39724f171eb2e563dae4774d0b0926` 或 1b 合入证据 SHA
`1d4e004b30e573ebf95235fd7baa725780d659e8`，必须同时证明它相对对应绑定产品源码只增加证据
文档。若改用更晚的 `main`，结果只能证明实际测试的当前版本，不得回填为旧 source SHA 的
exact-SHA 证据。

## 验收与处置

- [ ] 记录操作系统、Electron/Node/Bun 版本和实际测试 SHA。
- [ ] 1a 六个场景与 1b 七个场景均逐项记录结果、日志或截图/录屏索引，且不包含 provider
      secret、gateway token 或 OAuth 凭据。
- [ ] 若相应轨道全部通过，在本工单及对应的 1a / 1b archived `verification.md` 中追加补测
      回执；不得把一条轨道的通过外推给另一条。
- [ ] 若发现产品缺陷，不在本工单内顺手改代码；创建独立 bugfix/OpenSpec，绑定复现证据并走
      正常双 AI 验证流程。

## 不做范围

- 不为让 smoke 通过而改变 1a 或 1b 已冻结的产品源码。
- 不把缺失系统库安装记录冒充产品行为验证。
- 不因补测晚于归档而重写原始 `IMPLEMENTATION_VERIFIED` / `REVIEW_APPROVED` / `ACCEPTED`
  verdict。
