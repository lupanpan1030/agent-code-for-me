# Verification

Status: **DRAFT — awaiting Owner APPROVED**

## Draft identity and authority

- Change: add-local-job-api-async-submit；Phase 3 第二份提案。
- Base / unchanged product source SHA: `2c59664f1b80a5f782eb05f82d33f718d9bc7053`。
- Worktree: `/home/chen/projects/locus-add-local-job-api-async-submit-draft`。
- Branch: `codex/add-local-job-api-async-submit-draft`。
- Author / date: Codex / 2026-10-01 (Pacific/Auckland)。
- Revision parent: `b26c06518446292a8875ed59ef62aa30f14c3f70`；fresh synthesis 的 27 findings / 13 rewrite items 为本版裁定输入。
- Draft receipt commit：本文件所在的单一本地 `docs(openspec): rewrite local job api async submit per review synthesis` 提交；用 `git log -1 --format=%H -- openspec/changes/add-local-job-api-async-submit` 解析，避免自引用 SHA。
- Product source edits/tests authored: **none**。本记录不声称实现、conformance 或 packaged smoke 已通过。
- Owner APPROVED / C7 R1–R4,Q1–Q6: **pending**。
- Implementation source SHA / Codex IMPLEMENTATION_VERIFIED: **not applicable to draft / not issued**。
- Fresh Claude Code REVIEW_APPROVED / reviewed source SHA: **not issued for this revision**；b26c0651 的 fresh synthesis 为 CHANGES_REQUESTED，本版等待新的 fresh review。
- Local merge SHA / Owner ACCEPTED: **none / pending**。
- Remote push/PR/merge/release/rules: **not authorized / not performed**；本次也不本地 merge。

## Draft-only checks actually performed

调用指定基线 worktree 的已安装 OpenSpec binary，工作目录始终为本 draft worktree；未安装依赖、未写产品文件。

| Check | Result / scope |
| --- | --- |
| `/home/chen/projects/agent-code-for-me/node_modules/.bin/openspec validate add-local-job-api-async-submit --strict --no-interactive` | Exit 0：`Change 'add-local-job-api-async-submit' is valid`。仅格式/规格校验。 |
| 同 binary `validate --all --strict --no-interactive` | Exit 0：`Totals: 54 passed, 0 failed (54 items)`；53 living specs + 本 draft。 |
| Scenario 登记一致性 | 54 个 Scenario，S01–S54 连续且唯一（S01–S33 保留；S34–S40 新行为；S41–S54 完整 MODIFIED 继承场景，标题保持原样，ID 以注释登记），每个有 GIVEN/WHEN/THEN；登记与下表一一对应。 |
| `git diff --check` / staged diff check | Exit 0：working/staged diff 均无 whitespace 错误，十个允许范围内文档；提交后再核对完整提交 diff。 |
| `bun run check:full` | **Exit 1 / environment prerequisite blocked**：该 worktree 未安装 node_modules，lint 首步找不到 `node_modules/.bin/biome`；后续 architecture/typecheck/tests/spec/build 未执行。没有当作通过，也没有为纯文档草案安装依赖或修改产品文件。 |

完整本地命令日志 `/tmp/async-submit-redraft-validate-all.log`、
`/tmp/async-submit-redraft-check-full.log` 是临时执行记录，不是 durable 产品证据。

## Fresh synthesis §3 rewrite disposition（author self-check；非独立批准）

| §3 item | Status | 文件与具体关闭内容 |
| --- | --- | --- |
| 1 | CLOSED | proposal §3/4/6/10 + design D2/Open questions：R3/R4、Q2 三真实选项、推荐 (a)、S32 scoped pump、S34/S35/S40；daemon-first SIGKILL 异议保留给 Owner。 |
| 2 | CLOSED | local-job-api wrapper Requirement/S03/S05/S25 + D2：条件化 absent/stalled/publish 行为、今日 publish failure baseline、prepared tail 无 sequence。 |
| 3 | CLOSED | runtime-core/D5：worker/cancel/recovery trigger ownership；recovery 空 terminal refs、readiness 空集、prologue 披露；S36。 |
| 4 | CLOSED | D1/D5、tasks 2.5/2.7、headless S28/S37、local S18：安全 reopen/验证/seed receipts、mismatch settlement、process+attempt staging 与两种 cancel race。 |
| 5 | CLOSED | D4、local idempotency/S13/S14、tasks 4.5/4.7、proposal §3/4：逐路径 expiry setter、命名 cleanup/触发、删除虚构 job-delete、orphan remedy、pending/8+retryable。 |
| 6 | CLOSED | D3、runtime-core/S26/S38、local S11：固定 initial admission key 与 SQL、creation→admission crash、cancel/expiry remedy。 |
| 7 | CLOSED | D5/local observation/S17：lock v2、heartbeat 更新/freshness、状态表、nonce swap 定义、required lockPath。 |
| 8 | CLOSED | local wait/status/error 表、S01/S06/S11/S15/S19/S20/S30：明确 reason/presence、exact counts、stream/exit/code、non-outcome 带 id error。 |
| 9 | CLOSED | daemon/discovery 完整 MODIFIED；stdio 移入 agent-protocol-interfaces；schedule/S31 移 architecture；S41–S54 登记继承场景，保留原标题。 |
| 10 | CLOSED | proposal §3/#10/§6 + D6/Q1/Q3：key surface、guide:210 条件变更、预声明 refresh/preflight、ledger 先例、v1 默认与 R2 Owner gate。 |
| 11 | CLOSED | proposal §5：Career Kit@6d6a333 verified v1/calls/timeout/kill/env/cancel/validator，标 evidence-only；Amadeus 原行不变。 |
| 12 | CLOSED | headless MODIFIED/D5/D6/S39：project/cwd/profile/grant 复核、24 h 可改 queued age、host fail closed。 |
| 13 | CLOSED | worker provenance、artifact-ref redirect、mkdir 次序、slot order、daemon seams、consumer ID 形态、raw key never stored、具名 fixtures、S07 seam；SYN-18/25/26 在 Q4/tasks 3.3/4.9 披露。 |

“CLOSED”仅表示本次草案的文字改写落实；不是实现完成、Owner APPROVED 或 fresh reviewer 的 verdict。
不变清单已核对：D1 单核/owner，D3 ack/committed fact/TICKET-128，D4 reservation 同事务/unique/compensation/raw-key 禁落盘，D2 commands 与 wait 30 s/0–86400000/exit9-only，v1，R2 Owner decision，S01–S33 编号，tasks 执行顺序和 8.7/8.8 原文，DRAFT 与未来证据表。

## Future evidence required

实施批准后逐项填写真实环境、精确 SHA、命令、退出码、断言数、日志/fixture 版本与限制：

| Evidence | Required receipt | Current state |
| --- | --- | --- |
| Owner change / C7 | 精确 approved draft SHA；Q1–Q6、Red R1–R4 决定及兼容/版本组合 | pending |
| Independent red author | 作者/独立上下文、测试 source SHA、S01–S54 red 结果，不看实现猜断言 | not authored |
| Implementation | 冻结产品 source SHA，old-path deletion inventory、owner map 行、migration ID | not implemented |
| Admission / idempotency | immediate ack、same/cross consumer、normalize/conflict/race、rollback/补偿/kill、TTL/redaction | not run |
| Wait / publication | before-commit、every rename fault/restart、目录/digest替换、多 waiter、deadline、零 artifact | not run |
| Executor / controls | source eligibility/claim race/concurrency、lock/nonce/liveness、queued cancel、retry、stdio session scope | not run |
| Public contract | baseline v1 byte golden、12 types/六字段/after/follow、agent/completion、旧/新 schema、version/missing-feature | not run |
| Architecture / security | clean + negative guard self-test；单 submit/pump/ledger；key/FS/secret/threat/rollback 独立安全审查 | not run |
| Aggregate gates | 精确 source SHA 的 bun run check:full、targeted suite、strict all、diff check；失败不 waive 成 pass | not run for implementation |
| Manual / packaged | macOS/Windows 的 OS/arch、app/runtime source/version/digest、脱敏 auth mode、命令与退出码、截图/日志；WSL 不替代 | not run |
| Dual technical verdicts | Codex IMPLEMENTATION_VERIFIED + fresh-context Claude REVIEW_APPROVED，**同一 exact source SHA** | not issued |
| Integration / acceptance | 另行获授权的 local merge SHA + post-merge gates；Owner explicit ACCEPTED | pending |
| Remote | 没有明确新授权则持续 not authorized / not performed | not authorized |

手工 smoke：独立 profile 下启动既有 daemon，submit 返回后立即退出 submitter，status/events/wait/result
读到同一 Run；再验 daemon 不在、重启、completion、cancel、retry key、stdio EOF/shutdown、Workbench。
Windows 有/无 artifacts 分开：TICKET-127 未修复时 run-dir 必须 fail closed，不以 WSL 或 source test 冒充成功。
TICKET-128 已披露孤儿与 partial publish 仍在；本切片只证明“不误 ack/claim/ready”，不证明自动恢复。

## Scenario register

每一行的完整入口、输入夹具和可观察断言均在对应 spec delta 的 Scenario。S41–S54 保留 living 标题以满足 MODIFIED 完整替换检查，编号位于标题下的 register 注释与夹具 case key；不改 S01–S33 编号。
实施阶段为每行补：test file/name、fixture revision、red SHA/receipt、green SHA/receipt、platform/limitations。
当前全为 **not authored / not run**，不是通过标记。

| ID | Delta | Scenario | Test / red / green receipt |
| --- | --- | --- | --- |
| S01 | [local-job-api](specs/local-job-api/spec.md) | Submit returns before execution is released | pending / not run |
| S02 | [local-job-api](specs/local-job-api/spec.md) | Existing admission gates run before provider work | pending / not run |
| S03 | [local-job-api](specs/local-job-api/spec.md) | Old create matches submit plus wait byte for byte | pending / not run |
| S04 | [local-job-api](specs/local-job-api/spec.md) | Default retry retains synchronous response and lineage | pending / not run |
| S05 | [local-job-api](specs/local-job-api/spec.md) | Wait observes both commit and publication | pending / not run |
| S06 | [local-job-api](specs/local-job-api/spec.md) | Wait has explicit bounded timeout semantics | pending / not run |
| S07 | [local-job-api](specs/local-job-api/spec.md) | Multiple waiters and late facts cannot change the result | pending / not run |
| S08 | [local-job-api](specs/local-job-api/spec.md) | Normalized replay stays on supported key surfaces | pending / not run |
| S09 | [local-job-api](specs/local-job-api/spec.md) | Changed request conflicts without exposing the key | pending / not run |
| S10 | [local-job-api](specs/local-job-api/spec.md) | Same key cannot replay across consumers | pending / not run |
| S11 | [local-job-api](specs/local-job-api/spec.md) | Concurrent requests reserve one attempt | pending / not run |
| S12 | [local-job-api](specs/local-job-api/spec.md) | Rollback and creation compensation release the key | pending / not run |
| S13 | [local-job-api](specs/local-job-api/spec.md) | Crashed creation never becomes a successful replay | pending / not run |
| S14 | [local-job-api](specs/local-job-api/spec.md) | Retention has a declared endpoint | pending / not run |
| S15 | [local-job-api](specs/local-job-api/spec.md) | Idempotency key stays out of durable and diagnostic output | pending / not run |
| S16 | [local-job-api](specs/local-job-api/spec.md) | Submission without an executor is observable | pending / not run |
| S17 | [local-job-api](specs/local-job-api/spec.md) | Lock observations do not invent liveness | pending / not run |
| S18 | [local-job-api](specs/local-job-api/spec.md) | Queued cancel wins claim without a second terminal | pending / not run |
| S19 | [local-job-api](specs/local-job-api/spec.md) | Retry key replays the child and preserves the parent | pending / not run |
| S20 | [local-job-api](specs/local-job-api/spec.md) | API reads and control stay source-scoped | pending / not run |
| S21 | [local-job-api](specs/local-job-api/spec.md) | V1 event and artifact regression is unchanged | pending / not run |
| S22 | [local-job-api](specs/local-job-api/spec.md) | Discovery advertises the extension with explicit schema evolution | pending / not run |
| S23 | [local-job-api](specs/local-job-api/spec.md) | Unsupported version and absent feature fail closed | pending / not run |
| S24 | [local-job-api](specs/local-job-api/spec.md) | Completion uses the same queued admission | pending / not run |
| S25 | [local-job-api](specs/local-job-api/spec.md) | Internal wait timeout does not become a create result | pending / not run |
| S26 | [agent-runtime-core](specs/agent-runtime-core/spec.md) | Queue listing and claim require the same committed facts | pending / not run |
| S27 | [agent-runtime-core](specs/agent-runtime-core/spec.md) | Publication faults cannot be mistaken for completion | pending / not run |
| S28 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Daemon executes API work once and preserves source exclusions | pending / not run |
| S29 | [agent-protocol-interfaces](specs/agent-protocol-interfaces/spec.md) | Job run acknowledges the shared creation core | pending / not run |
| S30 | [agent-protocol-interfaces](specs/agent-protocol-interfaces/spec.md) | Protocol cancel and shutdown remain session-owned | pending / not run |
| S31 | [architecture-ownership](specs/architecture-ownership/spec.md) | Schedule creation retains one fire without bypassing creation facts | pending / not run |
| S32 | [architecture-ownership](specs/architecture-ownership/spec.md) | Guard rejects an inline API execution fallback | pending / not run |
| S33 | [architecture-ownership](specs/architecture-ownership/spec.md) | Guard rejects duplicate creation and ledger writers | pending / not run |
| S34 | [local-job-api](specs/local-job-api/spec.md) | Create and retry run without an external executor | pending / not run |
| S35 | [local-job-api](specs/local-job-api/spec.md) | Aborting a wrapper applies the chosen cancel policy | pending / not run |
| S36 | [agent-runtime-core](specs/agent-runtime-core/spec.md) | Daemon death recovers to a readable interrupted result | pending / not run |
| S37 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Submit in one process and publish in another | pending / not run |
| S38 | [agent-runtime-core](specs/agent-runtime-core/spec.md) | Crash at creation to initial admission boundary | pending / not run |
| S39 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Claim revalidates project identity profile and age | pending / not run |
| S40 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Runtime environment belongs to the actual claimant | pending / not run |
| S41 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Daemon starts without a renderer window | pending / not run |
| S42 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Daemon claims queued daemon jobs | pending / not run |
| S43 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Daemon follows cancellation requests | pending / not run |
| S44 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | User follows daemon logs | pending / not run |
| S45 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Daemon restarts after crash | pending / not run |
| S46 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Daemon coordination stays local | pending / not run |
| S47 | [agent-protocol-interfaces](specs/agent-protocol-interfaces/spec.md) | User starts jobs-stdio mode | pending / not run |
| S48 | [agent-protocol-interfaces](specs/agent-protocol-interfaces/spec.md) | Protocol client sends prompt turn | pending / not run |
| S49 | [agent-protocol-interfaces](specs/agent-protocol-interfaces/spec.md) | Protocol client initializes capabilities | pending / not run |
| S50 | [agent-protocol-interfaces](specs/agent-protocol-interfaces/spec.md) | Protocol exits cleanly | pending / not run |
| S51 | [agent-protocol-interfaces](specs/agent-protocol-interfaces/spec.md) | Historical job rows keep the retired protocol string | pending / not run |
| S52 | [local-job-api](specs/local-job-api/spec.md) | Consumer detects readiness support | pending / not run |
| S53 | [local-job-api](specs/local-job-api/spec.md) | Older build lacks the feature | pending / not run |
| S54 | [local-job-api](specs/local-job-api/spec.md) | Consumer detects canonical ledger support | pending / not run |

## Consumer evidence ownership

| Owner | Evidence | State |
| --- | --- | --- |
| Locus | Neutral async/stream/control、batch/structured-output、stdio、schema、compatibility fixtures | planned only |
| Career Kit | v1 adapter@6d6a333 事实及自己的业务 E2E | 已核实调用/timeout/kill/env/validator，当前切片 receipt unknown |
| Amadeus | Windows 接入方，具体命令/版本/adapter/E2E 自有 | unknown；不作协商或优先级安排 |
| Other | 消费者与 receipt | unknown |

## Stop gates and known limitations

- 文档 strict pass 不等于 Owner APPROVED、产品 VERIFIED、独立 REVIEW_APPROVED 或 ACCEPTED。
- L2 的正常终态 bytes 目标明确；Q2(a) own-Run pump 为统筹预设；daemon-first/异常分支仍属 R1 待决，R3 env/R4 abort 与 SIGKILL 残余在 Open questions 明列，未将推荐当批准。
- feature enum 扩展是 Red R2，旧 pinned schema 失败是要披露的合同影响，不能删除失败 fixture。
- full check 本次因缺少 worktree 依赖未完成；实施 gate 必须在完整依赖环境重跑。
- Q4 需要 Owner 选择接受最小 read/ack barrier 残差或将 TICKET-128 完整修复前置。
- 未获 Owner ACCEPTED 停止收尾/归档；push 未获授权。任何后续代码变化都使实现验证和独立评审失效。
