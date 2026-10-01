# Verification: Unified Runtime Route Catalog

Status: **DRAFT — awaiting Owner APPROVED**

本文件是实施验证骨架与起草校验回执。没有产品实现、RED suite、技术 verdict 或验收；
S01–S32 全部 **NOT RUN**。文档可解析不证明目录或 Runtime 行为已实现。

## 1. Source 与治理绑定

| 栏位 | 当前值 / 实施时回填 |
| --- | --- |
| Draft base | `6192b13f74603fbcc57c8ba858cb6b0f0d0ac776` |
| Base 核对 | 2026-10-02 主检出 HEAD = origin/main = remote main；含已归档 ledger 与 async-submit |
| Worktree | `/home/chen/projects/locus-refactor-unified-runtime-route-catalog-draft` |
| Branch | `codex/refactor-unified-runtime-route-catalog-draft` |
| Draft receipt SHA | 含本回执的单一本地文档提交；由交付报告给出准确 SHA，不自引用提交内容 |
| Owner APPROVED / Consumer Impact §10 | PENDING；本派单仅授权起草 |
| Q1 / Q2 / Q3 | PENDING，见 design Open questions |
| Approved spec SHA | — |
| Independent RED author / suite SHA / adjudication SHA | — / — / — |
| Implementation source SHA / test fixture hashes | — / — |
| Codex IMPLEMENTATION_VERIFIED SHA / verdict / receipt | — / NOT ISSUED / — |
| Fresh-context Claude Code REVIEW_APPROVED SHA / receipt | — / NOT ISSUED / — |
| Security review SHA / findings disposition | — / — |
| Owner or authorized coordinator ACCEPTED / authority / SHA | — / — / — |
| Local merge SHA / post-merge verification | — / — |
| External action authorization / target / SHA | NONE；本次不 push、不远程 PR mutation、不 merge |

两技术 verdict 必须绑定同一准确 source SHA；后续代码变化使两者同时失效。
测试作者、实施者、fresh reviewer 的责任不能由起草自查替代。

## 2. 起草校验（不计实施验收）

工具固定使用主检出的
`/home/chen/projects/agent-code-for-me/node_modules/.bin/openspec`，cwd 为本 worktree。
最终提交后需再次核对这些结果，准确提交 SHA 记录在交付报告中。

| Command / check | 起草结果 |
| --- | --- |
| `openspec validate refactor-unified-runtime-route-catalog --strict --no-interactive` | PASS，exit 0；`Change 'refactor-unified-runtime-route-catalog' is valid` |
| `openspec validate --all --strict --no-interactive` | PASS，exit 0；`Totals: 54 passed, 0 failed (54 items)` |
| `git diff --check`（含 `git diff --cached --check` 新文件检查） | PASS，exit 0，无输出；提交后再检查准确提交差异 |
| 文档一致性 | PASS；P01–P24 = 12 R + 6 C + 6 B，L1–L10、Consumer Impact 十节齐全，S01–S32 各登记一次且 GIVEN/registry/tasks §7 的扁平 fixture 路径一致；全路径 file:line 存在且未越界，11 个变更文件均在授权范围 |
| `bun run check:full` | ATTEMPTED / ENVIRONMENT-BLOCKED，exit 1；新 worktree 无本地 `node_modules/.bin/biome`，lint:changed 即停止，后续 architecture/type/test/build 未执行 |

`check:full` 的实际输出关键行：

```text
Biome executable not found at /home/chen/projects/locus-refactor-unified-runtime-route-catalog-draft/node_modules/.bin/biome. Run `bun install` before linting.
error: script "lint:changed" exited with code 1
error: script "check:full" exited with code 1
```

本次没有为绕过该限制安装依赖或创建 worktree 外的依赖链接，也没有产品文件变化。
此记录不是 `check:full` PASS、不是复用 main/姊妹 change 的技术 verdict，实施时须在依赖齐备
环境完成全门禁。源代码、GUI、真实 Runtime、packaged 与 consumer E2E 均未在起草阶段验证。

## 3. Scenario 登记表

fixture 根固定为 `tests/fixtures/runtime-route-catalog/`，**扁平布局**；`#Sxx` 表示 JSON
顶层键，和 spec GIVEN、tasks §7 一致。下列 fixture/test 路径均为待实施声明，当前未创建。
测试入口前缀为 `tests/runtime-route-catalog-`，表内 `query.test.ts` 等表示该前缀下的拟文件名；
独立作者实施时填写准确 test name、RED/GREEN SHA、命令、完整子断言与 receipt，不只填总数。
S14/S15 保留 living scenario 原标题，通过 delta 注释登记 ID。

| ID | Spec delta | Fixture / key | 拟 bun test 入口 | Observable oracle / 当前结果 |
| --- | --- | --- | --- | --- |
| S01 | agent-runtime-core | catalog.json#S01 | query.test.ts | 重复/相交/缺引用/非法 namespace 表不能执行，零副作用；NOT RUN |
| S02 | agent-runtime-core | catalog.json#S02 | query.test.ts | 查询/枚举排列不变、readonly、不调用 factory/probe/DB；NOT RUN |
| S03 | agent-runtime-core | routes.json#S03 | routes.test.ts | desktop 两原生 factory 及 preflight 拒绝顺序；NOT RUN |
| S04 | agent-runtime-core | routes.json#S04 | routes.test.ts | 各入口同 batch leaf、原 source/provenance；NOT RUN |
| S05 | agent-runtime-core | policy.json#S05 | routes.test.ts | Codex grant 原 enforcement、Claude/invalid/hard guard 拒绝；NOT RUN |
| S06 | agent-runtime-core | refusals.json#S06 | query.test.ts | missing/ambiguous/非法组合结构化 fail closed，零执行；NOT RUN |
| S07 | agent-runtime-core | renderer.json#S07 | renderer.test.ts | 篡改 descriptor 不覆盖 DB binding/verified context；NOT RUN |
| S08 | agent-runtime-core | policy.json#S08 | routes.test.ts | 原 preference fallback diagnostic 与 explicit interactive 拒绝；NOT RUN |
| S09 | agent-runtime-core | completion.json#S09 | completion.test.ts | 显式 profile、一次 upstream、零 agent child；NOT RUN |
| S10 | agent-runtime-capabilities | capabilities.json#S10 | capabilities.test.ts | 引用 canonical manifest，adapter evidence 不虚报；NOT RUN |
| S11 | agent-runtime-capabilities | readiness.json#S11 | capabilities.test.ts | default/native/cache/no-probe 原行为，advisory 不阻断合法 admission；NOT RUN |
| S12 | agent-runtime-capabilities | capabilities.json#S12 | capabilities.test.ts | projection owner 决定可用性，无 adapter kind 不造 stub；NOT RUN |
| S13 | agent-runtime-capabilities | extensions.json#S13 | capabilities.test.ts | 既有 schema、unknown optional 忽略、internal required 拒绝；NOT RUN |
| S14 | headless-agent-jobs | headless.json#S14 | headless.test.ts | CLI/daemon/schedule/protocol/API batch 原 argv/stdin/cancel；NOT RUN |
| S15 | headless-agent-jobs | headless.json#S15 | headless.test.ts | rich factory 可用也不暗选、unsupported 零 provider work；NOT RUN |
| S16 | headless-agent-jobs | executor.json#S16 | executor.test.ts | 两连接 pump 竞争一次执行，原 source slots/exclusions/claim；NOT RUN |
| S17 | headless-agent-jobs | executor.json#S17 | executor.test.ts | replay/scoped wrapper/stdio 仍使用原 submission/pump；NOT RUN |
| S18 | desktop-agent-jobs | renderer.json#S18 | renderer.test.ts | 两入口同 descriptor helper，未知 transport 不默认 Claude；NOT RUN |
| S19 | desktop-agent-jobs | renderer.json#S19 | renderer.test.ts | fixture-only 第三 Runtime；dispatcher/event-state hash 与状态断言；NOT RUN |
| S20 | desktop-agent-jobs | desktop-actions.json#S20 | renderer.test.ts | exact-owner cancel、source retry 拒绝不变；NOT RUN |
| S21 | local-job-api | public-contract.json#S21 | public-contract.test.ts | create/submit/wait/retry/status/events/result/cancel 全 bytes/channels/exits；NOT RUN |
| S22 | local-job-api | discovery.json#S22 | discovery.test.ts | 旧/新 schema 与 reader 双向读取、原 features、schemaRef 可解析；NOT RUN |
| S23 | local-job-api | readiness.json#S23 | discovery.test.ts | submitter 与 daemon env 如实分离，no-probe 无 native work；NOT RUN |
| S24 | local-job-api | errors.json#S24 | public-contract.test.ts | 原 surface error/exit/JSON-RPC/IPC，无新 public code；NOT RUN |
| S25 | local-job-api | artifacts.json#S25 | public-contract.test.ts | Windows admission 与 incomplete publish 不被 route availability 绕过；NOT RUN |
| S26 | architecture-ownership | architecture-fixtures.json#S26 | guards.test.ts | runtime 分支/map/alias/namespace/wrapper exact findings；NOT RUN |
| S27 | architecture-ownership | architecture-fixtures.json#S27 | guards.test.ts | 旧文件/符号/caller 删除；逐项恢复 mutation 被检出；NOT RUN |
| S28 | architecture-ownership | architecture-fixtures.json#S28 | guards.test.ts | import direction、readiness cycle 拒绝；旧 ratchet 不放宽；NOT RUN |
| S29 | architecture-ownership | architecture-fixtures.json#S29 | guards.test.ts | 合法相邻 owner 正例通过，配对重复选择 mutation 失败；NOT RUN |
| S30 | architecture-ownership | architecture-fixtures.json#S30 | guards.test.ts | catalog 不新增 queue/ledger/artifact/credential 状态 owner；NOT RUN |
| S31 | agent-runtime-core | routes.json#S31 | routes.test.ts | Codex desktop 失败不 exec fallback/重复 terminal；NOT RUN |
| S32 | agent-runtime-core | provider.json#S32 | provider.test.ts | explicit/model/default/native precedence、cleanup、secret-safe projection；NOT RUN |

S22 的支持文件为同根 `discovery-schema-before.json`（冻结基线真实 schema 与 hash）及
`discovery-reader-before.ts`（注明规则来源的 neutral old reader）。它不是真实 consumer E2E。
Q1 若改为 internal-only，批准前同步删除 public delta/S22 及关联任务；不能留下“可不测”的场景。

## 4. 实施与手工 smoke 回执骨架

每条最终回执填写：`exact source SHA / fixture SHA / command / environment / result / log path / limitations`。

| 验证层 | 当前状态 | 待回填证据 |
| --- | --- | --- |
| 独立 RED baseline / frozen oracles | NOT RUN | 作者、批准 spec SHA、suite SHA、每场景 failure-before 或保真 baseline PASS |
| S01–S32 targeted bun tests | NOT RUN | 所有子断言及 suite adjudications，不能以 omnibus PASS 代替 |
| 原 headless/desktop/provider/async/ledger 回归 | NOT RUN | 命令与精确 source SHA；原 claim/publication/fallback 语义 |
| Architecture / retired-runtime guards | NOT RUN | 新守卫正反例 exact findings 与旧 ratchet 无放宽 |
| `bun run check:full` implementation | NOT RUN | 依赖齐备后的准确 SHA、全部 stages、pass/skip/fail |
| Desktop Claude/Codex | NOT RUN | plan/agent、project/folderless、native/profile、文本/工具/question/guard、exact-owner cancel、reload |
| CLI/daemon/jobs-stdio/API | NOT RUN | 两 runtime batch、policy-grant、completion、同步/异步与 own-pump/daemon-first、child teardown |
| macOS packaged | NOT RUN | app/runtime digest、OS/arch、neutral conformance 与 transport smoke |
| Windows packaged | NOT RUN | 同上，artifact fail-closed 残余独列；不拿 Linux 代替 |
| Career Kit / Amadeus adapter/E2E | unknown | 仅填真实 consumer receipt；不因 unknown 声称没有 consumer |
| Fresh Claude/security reviews | NOT RUN | 各自 fresh context、准确 SHA、P0/P1 清零、P2 disposition |

当前 TICKET-127–131 仍沿基线残余；本草稿不关闭任何 ticket。source fixture 的 win32 注入测试
不等于 Windows packaged 实测，既有 terminal/partial publication、relay/env 与 guard 缺口不能
随本目录验收自动消失。缺 host/credentials 时写明具体未运行项与 Owner disposition。

## 5. 停止与验收门

- 无 Owner APPROVED、独立 RED 或公共决策不完整，产品实施不开始；新增必要 Red 回 Owner。
- IMPLEMENTATION_VERIFIED 与 fresh Claude REVIEW_APPROVED 同 SHA 且所需验证完整后，方可交 Owner 验收。
- 统筹只有在 Owner 明确 mandate 覆盖本切片（Q3）、同 SHA 双 verdict、无开放 Red、全部残余逐项裁定时可代行 ACCEPTED；填写授权出处/统筹/日期/SHA，否则等待 Owner。
- 本稿未授权 merge/archive/push；以后如有本地 merge 派单，merge SHA 再验证。远程 push/PR mutation/merge/release 必须另有准确 SHA 与 target 的明确 Owner 授权。
- 不把起草校验、姊妹切片验收、历史 push policy 或某个平台的通过，充当本切片实施/平台/外部动作授权。
