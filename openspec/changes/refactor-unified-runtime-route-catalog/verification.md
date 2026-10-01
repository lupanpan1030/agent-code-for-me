# Verification: Unified Runtime Route Catalog

Status: **DRAFT v3 — APPROVED candidate; awaiting Owner APPROVED**

本文件是实施验证骨架与起草校验回执。没有产品实现、RED suite、技术 verdict 或验收；
S01–S53 全部 **NOT RUN**。文档可解析不证明目录或 Runtime 行为已实现。

## 1. Source 与治理绑定

| 栏位 | 当前值 / 实施时回填 |
| --- | --- |
| Draft base | `6192b13f74603fbcc57c8ba858cb6b0f0d0ac776` |
| Base 核对 | 第一版核对记录：6192b13f 含已归档 ledger 与 async-submit；第二/三版未重新联网核对 main |
| Redraft input HEAD（第二版历史） | `f7a3f7bd454b95deb7ae6f6596efebe0dd3d9cf3` |
| Touch-up input HEAD / parent | `283f29ca1401f5567df998b850bbc605a064ee5f`，第三版开工 branch/HEAD/clean tree 已核对 |
| Touch-up authority | `route-catalog-redraft-synthesis-283f29ca.md` §3 T1–T20 / §4；OD-1–OD-5 / Must-stay 不变 |
| Worktree | `/home/chen/projects/locus-refactor-unified-runtime-route-catalog-draft` |
| Branch | `codex/refactor-unified-runtime-route-catalog-draft` |
| Draft receipt SHA | 含本回执的单一本地文档提交；由交付报告给出准确 SHA，不自引用提交内容 |
| Owner APPROVED / Consumer Impact §10 | PENDING；本派单仅授权起草 |
| Q1–Q5 / OD-1–OD-5 | 统筹预设（推荐默认，Owner 可改）已登记；无异议。缩窄 L2 / 受约束 optional routes / binding read model / P23→B / 验收代行为统筹记录（非 Owner 签署，Owner 可撤回），见 design Open questions |
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
最终提交后再次核对这些结果。**Touch-up SHA** 为包含本 §2 的唯一有界修补提交，
以 `git log -1 --format=%H -- openspec/changes/refactor-unified-runtime-route-catalog/verification.md`
解析（parent=`283f29ca1401f5567df998b850bbc605a064ee5f`，subject=`docs(openspec): bounded touch-up of unified runtime route catalog per second review`）；
准确 40 位 SHA 同时写入最终交付回报。为满足单一提交，不在 commit 内容内伪造其自身 hash
或追加第二个“回填 SHA”提交。产品 source 仍与 6192b13f 相同，非实施 verdict。

| Command / check | 起草结果 |
| --- | --- |
| `openspec validate refactor-unified-runtime-route-catalog --strict --no-interactive` | PASS，exit 0；`Change 'refactor-unified-runtime-route-catalog' is valid` |
| `openspec validate --all --strict --no-interactive` | PASS，exit 0；`Totals: 54 passed, 0 failed (54 items)` |
| `git diff --check`（含 `git diff --cached --check` 新文件检查） | PASS，exit 0，无输出；提交后再检查准确提交差异 |
| 文档一致性 | P01–P34 = 11 R + 7 C + 16 B；L1–L10、Consumer Impact 十节齐全；53 条 Scenario 各有 flat fixture/GIVEN/入口/断言，S33–S52 均单 WHEN，治理条款已标注不计测试；注册表和 tasks §7 同步；10 个改动文件均在授权范围 |
| 补充静态核对 | PASS；53 个唯一 GIVEN keys = tasks §7 = 本文 §3，每条一个 WHEN；六个 MODIFIED requirements 的 living scenario 标题全保留；proposal JSON 示例可解析；按原 retired-runtime regex 扫描 12 份草案/STATUS 文件为 0 hits（非完整 guard 替代） |
| `bun run check:full` | ATTEMPTED / ENVIRONMENT-BLOCKED，exit 1；lint PASS（无受支持的改动文件），architecture PASS（ledger/async 各17/17）；retired-runtime guard 在 spawnSync /bin/sh EPERM 停止，后续 type/tests/spec/build 未执行 |

第三版 check:full 实际关键输出（与第二版同一环境阻塞）：

```text
No changed files supported by Biome.
Run event ledger guard self-test: 17/17 fixture cases matched; repository ownership enforced.
Local job API async submission guard self-test: 17/17 fixture cases matched; repository ownership enforced.
Architecture guard passed.
Error: spawnSync /bin/sh EPERM
  at scripts/check-retired-runtime-residue.mjs:182:17
error: script "retired-runtime:check" exited with code 1
error: script "check" exited with code 1
error: script "check:full" exited with code 1
```

第一版的 Biome 缺失记录是历史结果，不能当第三版失败原因；本次未安装/链接依赖，未改
src/tests/docs 或 guard。strict/diff 独立运行，不把 check:full 的环境失败改报为 PASS。
源代码、GUI、真实 Runtime、packaged 与 consumer E2E 未在起草阶段验证；产品阶段仍需全门禁。

### 一审 §3 闭环登记（第三版自查更新，不是独立复核或实现完成）

二审在 parent 283f29ca 将 6/7/9/10 判为 PARTIAL；本表反映 T1–T20 修补后起草者自查，
闭合复核与 APPROVED 仍须绑定本次新 SHA，不沿用 parent verdict。

| 项 | 状态 | 落点 / 闭环证据 |
| --- | --- | --- |
| 1 | CLOSED | design L2/D3/D6/Q4；desktop SHALL NOT 与 S19 缩窄，移除虚构 common transport，hash 后置。 |
| 2 | CLOSED | design P25–P33 补八处与两个 runner seam，P05/P23→B；T1 增 P34，现 34=11R/7C/16B，S29 注入正例。 |
| 3 | CLOSED | P23/D2/tasks3.7/headless delta 保留 kind→runner；S27 排除 rewires，S03/S11/S16/S17 spies。 |
| 4 | CLOSED | D1 诊断候选/拒绝优先级；D4 分 surface/内部 reason mapping/真实代码出处；S05/S21/S24 payload exact keys。 |
| 5 | CLOSED | entry/leaf 分离、typed union/non-null policy、validated catalog、overlap=catalog_invalid、leaf enforcement 常量；S01/S06/S08。 |
| 6 | CLOSED | singleton/test-only constructor + RuntimeRouteCatalogState union，两个具名 desktop host options；S01 生产 reference CI/具名 failure-state 注入与 host oracle，S14/S21/S24 禁 fake runner，S30 env/fs/config guard。 |
| 7 | CLOSED | OD-3 binding read model；S18 read-state input/ok failure 与两站点不缓存 guard，S53 main stamping/无 DB 列/失败省略字段；Q2 拒绝分支同步审批门。 |
| 8 | CLOSED | P11/P12/P27 typed fixed-runtime admission/secret 顺序；S07 wrong claude.chat/Codex binding，descriptor 不跨 IPC。 |
| 9 | CLOSED | D5/tasks4.1/4.2/S26 冻结 flag/fixture/finding/rules/summary；fixed-runtime 与 P34 lifecycle leaf import negative/注入 positive。 |
| 10 | CLOSED | D5/tests 八文件逐项处置，保留重命名 registry 两条源扫描；RED 期 fixture allowance 与实施期 test allowance 分时，re-export/clean fixture/OWNERSHIP_MAP 原子更新；tasks4.6/6.1。 |
| 11 | CLOSED | D3/proposal/S22 experimental/open/non-stable vocabulary、禁止 consumer branching、producer reality、api-only/exact keys；C7 #2/#10 additive Yellow 非 Red。 |
| 12 | CLOSED | core 的 Agent Runtime Contract、Capability Honesty（合成别称 Runtime Capability Truth 的真实 owner）、Runtime-Neutral Agent Runner；architecture Runtime Execution Boundary Ownership 与 parity Dependency 均 whole-copy MODIFIED；core :433 保留理由已登记。 |
| 13 | CLOSED | S01/S04/S10/S12/S13 具名函数/字段；D5 adapterSource replay IDs 冻结；D3/S11 missing route/probe→unknown。 |
| 14 | CLOSED | 本 §2 strict 两项/diff 校验；唯一 docs(openspec) 有界修补提交，SHA 解析绑定与交付报告；不 push。 |


### 二审 T1–T20 / R-01–R-20 有界修补登记

下列 CLOSED 指文档清单已落实，不是产品 GREEN 或独立 REVIEW_APPROVED。五项 P2 与十五项 P3
均折入本次单一提交；无清单项留 PARTIAL。S01–S53 产品测试仍 NOT RUN。

| 清单 | Finding | 级别 | 状态 | 落点 / 闭环证据 |
| --- | --- | --- | --- | --- |
| T1 | R-01 | P2 | CLOSED | P34 C / 34=11R+7C+16B；D2/tasks3.5 两文件注入链；S26 直接导入负例与 S29 typed delegate 正例。 |
| T2 | R-02 | P2 | CLOSED | D1/D2/P11/P12/tasks3.5 与 S03/S31/S49 冻结 Claude options host、Codex runCodexDesktopChatRun/CodexDesktopChatRunOptions；无 router setter。 |
| T3 | R-03 | P2 | CLOSED | D1/D3/tasks2.2/D5/S18 read-state Result、ok:false 不缓存 guard；新增 S53 main helper stamping、无 DB 列与 failure-state oracle。 |
| T4 | R-04 | P2 | CLOSED | RuntimeRouteCatalogState union / constructor invalid→failure 无 throw；S01 具名 hosts 注入，CLI bun reject/stdout 与生产 main catch 分离，D4 脱敏 bytes。 |
| T5 | R-05 | P2 | CLOSED | D5/tasks4.6 重命名 agent-runtime-router-surface.test.ts，:72–143 两条 source scans 逐字保留；仅 :12–70 facade 迁 S06/S10，同 reason allowance 随重命名。 |
| T6 | R-06 | P3 | CLOSED | D1 resolver/validator ok 判别；tasks2.2 在 RED 前冻结 RuntimeRouteDeclaration 字段、RuntimeRouteCatalogReferences ports 与 offending 类型。 |
| T7 | R-07 | P3 | CLOSED | D5/tasks4.6/6.1 明确 refusals.json 精确 ALLOWED entry 随 RED-suite commit，registry-test allowance 随实施重命名原子换路径。 |
| T8 | R-08 | P3 | CLOSED | design §2 清除 P24/P25 间空行，P01–P34 为连续表。 |
| T9 | R-09 | P3 | CLOSED | D6 增 P21/P26/P28 与 Claude default；proposal/desktop delta 定义 central main dispatch，列 retained main runtime-keyed edits。 |
| T10 | R-10 | P3 | CLOSED | local-job-api delta 仅 currently accepted API-entry combinations (surface=api)，protocol 省略。 |
| T11 | R-11 | P3 | CLOSED | OD-5 移出未签署 §10 block；proposal/design Q3/tasks8.7 同一统筹登记措辞（非 Owner 签署，Owner 可撤回）。 |
| T12 | R-12 | P3 | CLOSED | Consumer Impact §3 将 init catalog_invalid/no stdout/exit1 分类 Green/build-defect，区分 probe failure exit0。 |
| T13 | R-13 | P3 | CLOSED | D3/local-job-api 复用 closed jobKind/executionProfile；completion profile=null，proposal 示例与 S22 对齐。 |
| T14 | R-14 | P3 | CLOSED | L4 明确 chat request/stream/cancel 不变与 OD-3 internal read-model transportId。 |
| T15 | R-15 | P3 | CLOSED | proposal/D3/tasks5.3/local-job-api 引 guide :1729 前置、:232–238 pinned-schema caveat；experimental key-set 每次重做 C7 #2/#10。 |
| T16 | R-16 | P3 | CLOSED | S33–S52 20 条各一 WHEN；observable oracles 或 governance-only 标记；S46 public parser unsupported-runtime 与 internal route_not_found 分开。 |
| T17 | R-17 | P3 | CLOSED | D4/S24 固定 Runtime route catalog is unavailable.；validated catalog 的 recording agent-factory reference port 在校验时返回合法 delegate、post-binding lookup 返回 null（不改 frozen table、不执行 leaf，不伪造有效的缺 factory 声明）。 |
| T18 | R-18 | P3 | CLOSED | S05 unsupported-profile 显式 out-of-union cast；createCodexAppServerHeadlessTaskRunner({createDesktopAdapter:recording}) 直测 leaf，零 factory/provider/spawn。 |
| T19 | R-19 | P3 | CLOSED | proposal 删除过期歧义措辞；unknown/capability/extension fail closed，声明相交校验期 catalog_invalid。 |
| T20 | R-20 | P3 | CLOSED | design §1 解释 living local-job-api :268/:290/:558 batch selector path 为 batch leaf 行为用语，owner 改 catalog。 |

## 3. Scenario 登记表

第二版已有 52 条（原登记 32 + whole-copy MODIFIED 20）；第三版依 T3 新增
S53 main-side binding stamping，合计 **53 条**。T16 将 S33–S52 每条两个 WHEN 合为一个，
未拆出新 Scenario，全部 living scenario 标题保留。

fixture 根固定为 `tests/fixtures/runtime-route-catalog/`，**扁平布局**；`#Sxx` 表示 JSON
顶层键，和 spec GIVEN、tasks §7 一致。下列 fixture/test 路径均为待实施声明，当前未创建。
测试入口前缀为 `tests/runtime-route-catalog-`，表内 `query.test.ts` 等表示该前缀下的拟文件名；
独立作者实施时填写准确 test name、RED/GREEN SHA、命令、完整子断言与 receipt，不只填总数。
S14/S15 与 S33–S52 保留 living scenario 原标题，通过 delta 注释登记 ID；共 53 条
（32 原登记 + 20 whole-copy MODIFIED 场景 + S53），未把 preserved living 场景漏出测试登记。

| ID | Spec delta | Fixture / key | 拟 bun test 入口 | Observable oracle / 当前结果 |
| --- | --- | --- | --- | --- |
| S01 | agent-runtime-core | catalog.json#S01 | query.test.ts | 生产表/真实 refs、重复/相交/缺引用/非法 namespace/enforcement/probe validation，初始化故障 host 映射；NOT RUN |
| S02 | agent-runtime-core | catalog.json#S02 | query.test.ts | 查询/枚举排列不变、readonly、不调用 factory/probe/DB；NOT RUN |
| S03 | agent-runtime-core | routes.json#S03 | routes.test.ts | 两个具名 desktop hosts 的 typed delegate/目录 spy、procedure guard 与 preflight 拒绝顺序；NOT RUN |
| S04 | agent-runtime-core | routes.json#S04 | routes.test.ts | entry input / executionSurface output，各入口同 batch leaf、原 source/provenance；NOT RUN |
| S05 | agent-runtime-core | policy.json#S05 | routes.test.ts | Codex grant 原 enforcement、Claude/invalid/hard guard 拒绝；NOT RUN |
| S06 | agent-runtime-core | refusals.json#S06 | query.test.ts | unknown/retired/missing/非法组合 route_not_found；overlap 仅 validation catalog_invalid；NOT RUN |
| S07 | agent-runtime-core | renderer.json#S07 | renderer.test.ts | 真实 claude.chat 对 Codex binding，rejectStaleRunPayload 原 message/hint、零 secret/factory；NOT RUN |
| S08 | agent-runtime-core | policy.json#S08 | routes.test.ts | 删除 preferredAdapterSource；fallbackReason:null 与 internal interactive 原拒绝；NOT RUN |
| S09 | agent-runtime-core | completion.json#S09 | completion.test.ts | 显式 profile、一次 upstream、零 agent child；NOT RUN |
| S10 | agent-runtime-capabilities | capabilities.json#S10 | capabilities.test.ts | 引用 canonical manifest，adapter evidence 不虚报；NOT RUN |
| S11 | agent-runtime-capabilities | readiness.json#S11 | capabilities.test.ts | default/native/cache/no-probe/missing route-probe→unknown 原行为，advisory 不阻断合法 admission；NOT RUN |
| S12 | agent-runtime-capabilities | capabilities.json#S12 | capabilities.test.ts | projection owner 决定可用性，无 adapter kind 不造 stub；NOT RUN |
| S13 | agent-runtime-capabilities | extensions.json#S13 | capabilities.test.ts | 既有 schema、unknown optional 忽略、internal required 拒绝；NOT RUN |
| S14 | headless-agent-jobs | headless.json#S14 | headless.test.ts | CLI/daemon/schedule/protocol/API batch 原 argv/stdin/cancel；NOT RUN |
| S15 | headless-agent-jobs | headless.json#S15 | headless.test.ts | rich factory 可用也不暗选、unsupported 零 provider work；NOT RUN |
| S16 | headless-agent-jobs | executor.json#S16 | executor.test.ts | 两连接 kind dispatch 保留，test catalog 只转发/claim 后查，原 slots/exclusions；NOT RUN |
| S17 | headless-agent-jobs | executor.json#S17 | executor.test.ts | replay/scoped wrapper/stdio 仍使用原 submission/pump；NOT RUN |
| S18 | desktop-agent-jobs | renderer.json#S18 | renderer.test.ts | helper read-state 单测+两站点映射/不缓存 guard；unknown/unavailable/error 零订阅；NOT RUN |
| S19 | desktop-agent-jobs | renderer.json#S19 | renderer.test.ts | existing-wire fixture；具名 helper/event-state guards、question/guard/finish atom transitions；NOT RUN |
| S20 | desktop-agent-jobs | desktop-actions.json#S20 | renderer.test.ts | exact-owner cancel、source retry 拒绝不变；NOT RUN |
| S21 | local-job-api | public-contract.json#S21 | public-contract.test.ts | create/submit/wait/retry/status/events/result/cancel 全 bytes/channels/exits；NOT RUN |
| S22 | local-job-api | discovery.json#S22 | discovery.test.ts | 旧/新 schema/reader、unknown open values、exact keys、防 leaks、producer extensions；NOT RUN |
| S23 | local-job-api | readiness.json#S23 | discovery.test.ts | submitter 与 daemon env 如实分离，no-probe 无 native work；NOT RUN |
| S24 | local-job-api | errors.json#S24 | public-contract.test.ts | 原 surface error/exit/JSON-RPC/IPC，无新 public code；NOT RUN |
| S25 | local-job-api | artifacts.json#S25 | public-contract.test.ts | Windows admission 与 incomplete publish 不被 route availability 绕过；NOT RUN |
| S26 | architecture-ownership | architecture-fixtures.json#S26 | guards.test.ts | runtime 分支/map/alias/namespace/wrapper/lifecycle leaf value-import exact findings；NOT RUN |
| S27 | architecture-ownership | architecture-fixtures.json#S27 | guards.test.ts | retired modules/exports/两分支 exact mutation；合法 rewires 由 S03/S11/S16 spies；NOT RUN |
| S28 | architecture-ownership | architecture-fixtures.json#S28 | guards.test.ts | import direction、readiness cycle 拒绝；旧 ratchet 不放宽；NOT RUN |
| S29 | architecture-ownership | architecture-fixtures.json#S29 | guards.test.ts | 合法相邻 owner/P34 typed delegate 注入正例通过，配对重复选择 mutation 失败；NOT RUN |
| S30 | architecture-ownership | architecture-fixtures.json#S30 | guards.test.ts | catalog 不新增状态 owner、无 env/fs/config，production test-port override 被拒绝；NOT RUN |
| S31 | agent-runtime-core | routes.json#S31 | routes.test.ts | Codex desktop 失败不 exec fallback/重复 terminal；NOT RUN |
| S32 | agent-runtime-core | provider.json#S32 | provider.test.ts | explicit/model/default/native precedence、cleanup、secret-safe projection；NOT RUN |
| S33 | agent-runtime-core | catalog.json#S33 | query.test.ts | 真实声明初始化、唯一 runtime、重复拒绝；NOT RUN |
| S34 | agent-runtime-core | capabilities.json#S34 | capabilities.test.ts | 基本 route 不要求可选 unsupported native 能力；NOT RUN |
| S35 | agent-runtime-core | capabilities.json#S35 | capabilities.test.ts | 只读 metadata/manifest 明确能力状态与理由；NOT RUN |
| S36 | agent-runtime-core | capabilities.json#S36 | capabilities.test.ts | 声明 supported 的实际 adapter capability port 执行；NOT RUN |
| S37 | agent-runtime-core | capabilities.json#S37 | capabilities.test.ts | pre-execution 工具 allow/deny/rewrite 与诊断；NOT RUN |
| S38 | agent-runtime-core | capabilities.json#S38 | capabilities.test.ts | 缺 pre-hook 不宣称 hard enforcement；NOT RUN |
| S39 | agent-runtime-core | capabilities.json#S39 | capabilities.test.ts | Codex missing capability 从目录可测；NOT RUN |
| S40 | agent-runtime-core | policy.json#S40 | routes.test.ts | grant enforcement evidence/原 scope-binding 或 refusal；NOT RUN |
| S41 | agent-runtime-core | routes.json#S41 | routes.test.ts | Claude alias normalization/shared runner 原 events/result；NOT RUN |
| S42 | agent-runtime-core | routes.json#S42 | routes.test.ts | Codex shared runner 原 events/result；NOT RUN |
| S43 | agent-runtime-core | routes.json#S43 | routes.test.ts | headless/API default batch 与 source diagnostic；NOT RUN |
| S44 | agent-runtime-core | policy.json#S44 | routes.test.ts | 无交互通道的 internal query 原拒绝；NOT RUN |
| S45 | agent-runtime-core | policy.json#S45 | routes.test.ts | 保留 living fallback 标题；无隐式 downgrade，fallbackReason:null；NOT RUN |
| S46 | agent-runtime-core | refusals.json#S46 | query.test.ts | public parser 原 unsupported runtime；internal route_not_found；NOT RUN |
| S47 | agent-runtime-core | capabilities.json#S47 | capabilities.test.ts | required capability union gate/原诊断；NOT RUN |
| S48 | architecture-ownership | architecture-fixtures.json#S48 | guards.test.ts | 目录唯一 owner、route-local dispatch exact finding；NOT RUN |
| S49 | architecture-ownership | routes.json#S49 | routes.test.ts | 真实 ledger/redaction 经 host 投影，不造第二 event owner；NOT RUN |
| S50 | architecture-ownership | architecture-fixtures.json#S50 | guards.test.ts | 无 selector dual path/production test flag；NOT RUN |
| S51 | codex-runtime-parity | capabilities.json#S51 | capabilities.test.ts | Codex manifest shared truth 从目录到 caller gate；NOT RUN |
| S52 | codex-runtime-parity | capabilities.json#S52 | capabilities.test.ts | supported claim 必须真实 enforcing port 测试；NOT RUN |
| S53 | desktop-agent-jobs | renderer.json#S53 | renderer.test.ts | 真实 chat-query/createSubChat 经 withRuntimeRouteTransportId；两 runtime 值等于 renderer projection，DB 无该列，failure-state 无字段，main literal mapping guard；NOT RUN |

S22 的支持文件为同根 `discovery-schema-before.json`（冻结基线真实 schema 与 hash）及
`discovery-reader-before.ts`（注明规则来源的 neutral old reader）。它不是真实 consumer E2E。
Q1 若改为 internal-only，批准前同步删除 public delta/S22 及关联任务；不能留下“可不测”的场景。
Q2 若拒绝 binding read model 且没有可行替代，则 S18/S19/S53 与 desktop delta 必须先重写、重校验
和重新审批；不得用 renderer lookup/async lifecycle 隐式扩大边界。

## 4. 实施与手工 smoke 回执骨架

每条最终回执填写：`exact source SHA / fixture SHA / command / environment / result / log path / limitations`。

| 验证层 | 当前状态 | 待回填证据 |
| --- | --- | --- |
| 独立 RED baseline / frozen oracles | NOT RUN | 作者、批准 spec SHA、suite SHA、每场景 failure-before 或保真 baseline PASS |
| S01–S53 targeted bun tests | NOT RUN | 所有子断言及 suite adjudications，不能以 omnibus PASS 代替 |
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
- OD-5 为统筹登记（非 Owner 签署；统筹记录，Owner 可撤回），Owner 可在 APPROVED 时改为亲自验收；Owner 2026-10-02 自我迭代指示覆盖统筹代行，统筹仅在同 SHA Codex IMPLEMENTATION_VERIFIED + Claude REVIEW_APPROVED、无开放 Red、全部残余逐项裁定后代行 ACCEPTED，填写授权出处/身份/日期/SHA；当前没有实施/验收 verdict。
- 本次派单不 merge/archive/push；以后 merge 派单需在 merge SHA 再验证。push 依 Owner 2026-09-04 规矩由统筹派 Codex，固定准确 SHA/target/门禁，不扩展到其他远程动作。
- 不把起草校验、姊妹切片验收或某个平台的通过，充当本切片实施/平台/外部动作授权。
