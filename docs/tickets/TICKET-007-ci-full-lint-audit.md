# TICKET-007 — CI 增加全量 lint 与依赖 audit（遏制债务）

- **级别**：🟡 Low（流程 / 防回归）
- **类型**：CI 配置
- **实施**：Codex ｜ **审查**：Claude

## 背景与受影响文件

`.github/workflows/ci.yml`

现状：CI 只跑 `lint`（= `lint:changed`，仅改动文件）。全量 lint 从不在 CI 跑，导致存量债滚到
**2925 条诊断 / 1095 个文件**（1558 error），其中 `noExplicitAny` 666、格式不一致 573、
`organizeImports` 353。CI 也不跑 `bun audit`，依赖漏洞无门禁。

## 问题

- 全量债务无人把关，只增不减。
- 依赖漏洞（见 TICKET-006）无 CI 可见性。

## 规定改法

在 `ci.yml` 增加**非阻塞的报告型 job**（不改变现有 `lint:changed` 作为 PR 阻塞门禁）：

1. 新增一个 job（如 `debt-report`），跑：
   - `bun run lint:all`（全量 biome）—— 以 `continue-on-error: true` 或仅采集计数，**不 fail 构建**，
     目的是让全量诊断数在 CI 可见、可追踪趋势。
   - `bun audit`（同样非阻塞，输出摘要）。
2. **不要**把全量 lint 设为阻塞（当前 2925 条会立刻红），除非团队先清零；本工单只做「可见 + 遏制增长」。
3. 可选增强：加一个「基线守卫」——记录当前诊断总数为基线，PR 使总数**上升**时告警（若实现复杂则跳过，
   仅保留非阻塞报告即可，避免过度工程）。

> 若团队更希望走「新代码零 `noExplicitAny`」的渐进策略，可在 PR 描述提出，作为后续单独工单。

## 验收标准

- [ ] `ci.yml` 新增 job，PR 与 push 均触发，包含全量 `lint:all` 与 `bun audit` 步骤。
- [ ] 新 job **不**阻塞合并（现有 test/typecheck/lint:changed 仍为门禁）。
- [ ] YAML 合法（`actions` 版本、bun setup 与现有 job 一致：`oven-sh/setup-bun@v2`，`bun-version: 1.3.14`）。
- [ ] 现有三步（lint:changed / test / typecheck）行为不变。

## 不做范围

- 不批量修 2925 条存量诊断（另行渐进清理）。
- 不改 `biome.json` 规则集、不改 `lint:changed` 脚本。
- 不引入新的 lint 工具。

## 审查清单（Claude 验收时核对）

1. 新 job 非阻塞，未误将全量 lint 设为必过（否则 CI 立即红）。
2. bun/actions 版本与既有 job 对齐，无重复安装步骤的低级错误。
3. 现有门禁语义完全保留。
