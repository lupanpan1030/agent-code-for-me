# TICKET-114 — Desktop runtime GUI 补测（1a + 1b + capability CSP）

- **级别**：🟡 验证跟进（已接受残余风险）
- **来源**：`refactor-codex-desktop-service-extraction` task 8.2 与
  `add-chat-session-binding` task 7.4 / fresh-context review，以及
  `update-trpc-capability-boundary` 历史 4.4/4.5、Owner D3 与归档 task 5.6
- **状态**：待 GUI-capable host 补跑；不阻断 1a / 1b / capability rebaseline 本地归档
- **绑定产品源码**：
  - Foundation 1a：`6bf928bf00051ab1e9513b67162280677134d972`
  - Foundation 1b：`1d019f8d4fab38829ad0e3108e9569b260ab9302`
  - Capability rebaseline 实现基线：`d77a4b48e8d60cdaf20b8ae02d5df9482239e24a`
  - Capability rebaseline accepted docs source：`38ef174cd8423c05874aebdfbd9f921fad1c5a7a`
    （纯文档，不是新的产品实现）

## 问题

1a 与 1b 的自动验证、模块级生命周期/并发测试和双路独立评审均已通过，但当前 Linux 主机
缺少 Electron 所需的 NSPR/NSS/audio 动态库，`bun run dev` 在应用启动前失败。因此，真实
Electron 进程中的 app-shell quit/abort 接线，以及 DB-backed Chat Session Binding 的完整桌面
交互与重启恢复场景尚未执行。Owner 分别在 2026-08-26（1a）和 2026-08-27（1b）的产品验收门
显式接受该残余风险；这不等同于任何 GUI smoke 已通过。

Capability rebaseline 的历史 tasks 4.4/4.5 也只有旧勾选、没有留存 receipt；执行
rebaseline 的 WSL2 主机没有可用 GUI。Owner 接受这一披露并允许归档，但不等于 packaged
production CSP 或 development CSP/HMR smoke 已经通过。

## 补测范围

在可正常启动本项目 Electron 开发版本及 packaged app 的 GUI 机器上，从干净 worktree 对
相应绑定源码执行并保存证据。各轨道必须分别记录，不得用一个成功场景概括另一条失败轨道。

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

### tRPC capability rebaseline — renderer CSP

- [ ] **Packaged production CSP smoke**：记录 OS、实际测试 SHA、package 命令、产物与启动方式，
      从真实 packaged app 保存主特权文档的 CSP header、console 与截图/录屏索引；确认
      `script-src` 只包含 `'self'` 和已披露的 `'wasm-unsafe-eval'` 例外，不含
      `'unsafe-inline'`、普通 `'unsafe-eval'` 或远端脚本源，`connect-src` 为 `'self'`，外置 boot
      scripts 与基础 UI 正常。
- [ ] **Development CSP/HMR smoke**：运行 `bun run dev`，记录实际测试 SHA、主文档 CSP header、
      HMR websocket/热更新与 console 证据；确认仅开发环境具有 `'unsafe-inline'` 及 localhost
      WebSocket/HTTP connect allowances，不含普通 `'unsafe-eval'` 或远端脚本源；做一次无害
      renderer 改动验证 HMR 后还原，并保持 worktree clean。

这两条结果只证明实际测试 SHA，不得回填成历史 tasks 4.4/4.5 的 exact-SHA receipt。

若使用 1a 合入证据 SHA `13e3777a0a39724f171eb2e563dae4774d0b0926` 或 1b 合入证据 SHA
`1d4e004b30e573ebf95235fd7baa725780d659e8`，必须同时证明它相对对应绑定产品源码只增加证据
文档。若改用更晚的 `main`，结果只能证明实际测试的当前版本，不得回填为旧 source SHA 的
exact-SHA 证据。

## 验收与处置

- [ ] 记录操作系统、Electron/Node/Bun 版本和实际测试 SHA。
- [ ] 1a 六个场景与 1b 七个场景均逐项记录结果、日志或截图/录屏索引，且不包含 provider
      secret、gateway token 或 OAuth 凭据。
- [ ] Capability rebaseline 的 packaged-production 与 development-CSP/HMR 两条轨道分别记录
      结果和脱敏证据，不得用其中一条的成功代表另一条。
- [ ] 若相应轨道全部通过，在本工单及对应的 1a / 1b archived `verification.md` 中追加补测
      回执；不得把一条轨道的通过外推给另一条。
- [ ] 若两条 CSP 轨道通过，只在本工单与 archived capability-rebaseline `verification.md`
      追加实际 SHA 的补测回执；不得外推到 1a / 1b 或改写历史 verdict。
- [ ] 若发现产品缺陷，不在本工单内顺手改代码；创建独立 bugfix/OpenSpec，绑定复现证据并走
      正常双 AI 验证流程。

## 不做范围

- 不为让 smoke 通过而改变 1a 或 1b 已冻结的产品源码。
- 不为让 smoke 通过而改写 capability rebaseline 的 frozen docs source 或历史 smoke 声明。
- 不把缺失系统库安装记录冒充产品行为验证。
- 不因补测晚于归档而重写原始 `IMPLEMENTATION_VERIFIED` / `REVIEW_APPROVED` / `ACCEPTED`
  verdict。
