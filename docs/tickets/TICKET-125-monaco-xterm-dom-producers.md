# TICKET-125 — Monaco 文件查看器 / xterm 终端 DOM producer 覆盖

## Status

待设计 / 未授权实施（follow-up A Approval Question 9 Yellow follow-up；2026-09-07）。

Owner 于 2026-09-07 选择 Q9 折中方案；本票登记显式残留，不授权产品代码实施。
编号已核对 `/home/chen/projects/agent-code-for-me/docs/tickets` 及 main tree：
TICKET-124 已在 main（已归档默认分支修复），TICKET-123 属
`add-linked-worktree-admission` 分支，因此本票使用 TICKET-125。

## 背景 / Context

Monaco 文件查看器处理攻击者可控的仓库文件，xterm 终端处理不可信 PTY 输出。
二者的 dependency-internal DOM writers 不在 Locus 源码 raw-HTML sink 扫描覆盖内；
现有库渲染行为和 app CSP 是当前控制，但缺少经过实际组件路径的本地黑盒对抗 DOM 证据。
这是一项覆盖和依赖升级漂移风险记录，不是已证实的当前漏洞；Shadow DOM 不是脚本/CSP 边界，
CSP 也不能代替 reviewed-producer 行为证明。

Q9 将包含 Locus 自有 Shiki shim / Vite alias 的 `@pierre/diffs` 路径纳入 follow-up A
reviewed-producer 契约，将 Monaco/xterm 留作 Threat Model residual 与 Non-Goals。

## 范围 / Required future design

- 盘点 Monaco 文件查看器和 xterm 终端的实际入口、DOM producer、扩展/插件、链接处理，
  明确依赖版本、现有补偿控制及控制的局限；不能用文件级 allowlist 或库名宣称安全。
- 设计经实际文件查看器/终端组件的黑盒对抗夹具，覆盖恶意文件内容、PTY 控制序列、
  markup/URL 注入，并检查最终 DOM、可执行内容和链接副作用；保留正常显示的正向控制。
- 明确 reviewed-producer 是否及如何扩展、共享 rendered-DOM oracle 的适用边界、
  单元与真实 Electron GUI 证据分工，以及 dependency/upgrade gate 和升级责任人。
- 在独立 approved OpenSpec change 中定义精确 pin 策略、失败处置、验收与残留退出条件。

本票不承接 `@pierre/diffs`、其 Shiki ^3 子树、`hast-util-to-html@9.0.5` 的精确 pin、
shim/alias 夹具或 D10 行；这些已经由 follow-up A 的 Q9 决定和 task 2.10 承接。
本票不修改 terminal capability/consent/audit、不迁移 app sandbox，也不改变产品代码。

## 触发条件 / Triggers

- Monaco/xterm 或其 DOM-producing 扩展升级，或文件查看器/终端渲染、链接路径改变时，
  重新审视本残留并提交覆盖/升级门设计。
- 出现恶意文件或 PTY 输出导致的 DOM/可执行内容异常，或 Owner 要求将二者纳入
  reviewed-producer 契约时，启动独立范围决策；本票登记不等同于实施授权。

## Owner

- 决策与实施授权：项目 Owner。
- 设计/实施责任：后续派单指定的 renderer 文件查看器与 terminal 维护者；尚未指派具名人员。
  设计前按 `docs/OWNERSHIP_MAP.md` 确认 canonical owners，保持单一业务路径。
- 验收：实施者提供 exact-SHA 验证，Claude Code fresh-context 独立复核，Owner 接受。

## 关联变更 / Related change

- [add-renderer-untrusted-content-hardening proposal](../../openspec/changes/archive/2026-09-30-add-renderer-untrusted-content-hardening/proposal.md)
- [design — Approval Question 9、Threat Model、Non-Goals、D10](../../openspec/changes/archive/2026-09-30-add-renderer-untrusted-content-hardening/design.md)
- [tasks 1.3 / 2.10 / 2.11](../../openspec/changes/archive/2026-09-30-add-renderer-untrusted-content-hardening/tasks.md)
- [Approval Question 9 decision 回执](../../openspec/changes/archive/2026-09-30-add-renderer-untrusted-content-hardening/verification.md)
