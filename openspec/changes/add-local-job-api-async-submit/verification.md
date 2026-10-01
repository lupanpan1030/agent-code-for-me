# Verification

Status: **APPROVED 2026-10-02 (Owner, bound to 0f998436) — awaiting red suite (test-first)**

## Draft identity and authority

- Change: add-local-job-api-async-submit；Phase 3 第二份提案。
- Base / unchanged product source SHA: `2c59664f1b80a5f782eb05f82d33f718d9bc7053`。
- Worktree: `/home/chen/projects/locus-add-local-job-api-async-submit-draft`。
- Branch: `codex/add-local-job-api-async-submit-draft`。
- Author / date: Codex / 2026-10-01 (Pacific/Auckland)。
- Revision parent: `79c4e7b0767b2e6c5ed4706abd41bc573924e349`；第三版输入为二审 `async-submit-redraft-synthesis-79c4e7b0.md` §3 的 12 项有界编辑、§2 的 0 P1 / 8 P2 / 13 P3；§4 六项 Owner 决策原文搬入 design Open questions，推荐默认不变。
- Historical v3 draft receipt commit：`0f9984367a9fbc8c5030f9aecc85ac9628a71cde`，单一本地 `docs(openspec): bounded text touch-up of local job api async submit per second review` 提交。当前批准记录提交只登记决策与 prune；由 git history 解析其 SHA，避免自引用。
- Product source edits/tests authored: **none**。本记录不声称实现、conformance 或 packaged smoke 已通过。
- Owner APPROVED / C7 R1–R4,Q1–Q6: **APPROVED 2026-10-02，bound to `0f9984367a9fbc8c5030f9aecc85ac9628a71cde`，六项推荐默认全选**；完整决定见 proposal §10 / design Owner decisions。
- Implementation source SHA / Codex IMPLEMENTATION_VERIFIED: **not applicable to draft / not issued**。
- Fresh Claude Code REVIEW_APPROVED / reviewed source SHA: **not issued for this revision**；79c4e7b0 的二审 synthesis 为 CHANGES_REQUESTED，本版等待对本提交 exact SHA 的单次 closure check（不是新三视角轮次）。
- Local merge SHA / ACCEPTED: **none / pending**；Owner 2026-10-02 授权统筹代行，条件是 Codex IMPLEMENTATION_VERIFIED + fresh-context Claude REVIEW_APPROVED 同 source SHA、无开放 Red，只有红灯项回 Owner。
- Remote push/PR/merge/release/rules: **not authorized / not performed**；本次也不本地 merge。

## Approval record checks (2026-10-02，纯文档)

Owner 批准仍绑定 `0f9984367a9fbc8c5030f9aecc85ac9628a71cde`；本次只有决策记录与选定分支 prune，不新增设计或产品实现。只勾选 tasks 1.1；1.6 文字 prune 已完成但独立 closure re-check 未取得，测试先行与全部实施任务仍未勾选。

| Check | Result / scope |
| --- | --- |
| 指定 binary `openspec validate add-local-job-api-async-submit --strict --no-interactive` | Exit 0：`Change 'add-local-job-api-async-submit' is valid`。 |
| 指定 binary `openspec validate --all --strict --no-interactive` | Exit 0：`Totals: 54 passed, 0 failed (54 items)`。 |
| `git diff --check` / staged diff check | Exit 0；七个 OpenSpec 文档，无 src/tests/docs 改动。 |
| Scenario 登记一致性 | S01–S54 登记表与批准基线逐字相同，全部 pending / not run；S34/S35 合同仅裁剪未选分支，ID/标题保留。 |
| `bun run check:full` | Exit 1 / environment blocked：lint 无受支持文件需检查；architecture guard 通过、ledger self-test 17/17；retired-runtime 阶段 Node `spawnSync /bin/sh EPERM`，后续 typecheck/tests/spec/build 未执行，不计 full gate 通过。 |

Prune：Q2 仅 (a)，(a′)/(b)/(c) 已否决；R3 daemon env/native home accepted，caller-only claim 已否决；R4 daemon-first relay，no-relay 与 (b)/(c) 行为已否决；Q1 v1 + submit/retry-only key + create reject，keyed create/ignore/v1.1 已否决；R2 direct，version/facade/defer 已否决；Q4/Q5/Q6 全部接受，TICKET-128 全量前置及新增 exit code 已否决。备选后果保留在 design Owner decisions；deltas 不含互斥合同。

## Historical v3 draft-only checks actually performed（0f998436）

调用指定基线 worktree 的已安装 OpenSpec binary，工作目录始终为本 draft worktree；未安装依赖、未写产品文件。

| Check | Result / scope |
| --- | --- |
| `/home/chen/projects/agent-code-for-me/node_modules/.bin/openspec validate add-local-job-api-async-submit --strict --no-interactive` | Exit 0：`Change 'add-local-job-api-async-submit' is valid`。仅格式/规格校验。 |
| 同 binary `validate --all --strict --no-interactive` | Exit 0：`Totals: 54 passed, 0 failed (54 items)`；53 living specs + 本 draft。 |
| Scenario 登记一致性 | 54 个 Scenario，S01–S54 连续且唯一、S01–S40 IDs 不变，每个有 GIVEN/WHEN/THEN；S41–S54 保留每条 living assertion 与标题，S42/S46/S48/S51 明列 modified-inherited 的一致性补充（S48 为同核表述细化），S53 恢复原 consumer rule 并附 helper documentation example；登记与下表一一对应。 |
| `git diff --check` / staged diff check | Exit 0：working/staged diff 均无 whitespace 错误，八个允许范围内文档；提交后再核对完整提交 diff。 |
| `bun run check:full` | **Exit 1 / environment prerequisite blocked**：该 worktree 未安装 node_modules，lint 首步找不到 `node_modules/.bin/biome`；后续 architecture/typecheck/tests/spec/build 未执行。没有当作通过，也没有为纯文档草案安装依赖或修改产品文件。 |

完整本地命令日志 `/tmp/async-submit-v3-validate-all.log`、
`/tmp/async-submit-v3-check-full.log` 是临时执行记录，不是 durable 产品证据。

## Historical second-round synthesis §3 touch-up disposition（v3 author self-check；非独立批准）

| §3 item | Status | 文件与具体关闭内容 |
| --- | --- | --- |
| 1 / F-A | CLOSED | local-job-api wrapper/S25/S34、design D2、proposal §3/8：own-pump pending dispatch promise 豁免 30 s no-progress；remote claimant 用 D5 committed worker identity/120 s/confirmed alive；45 s completion 两分支 oracle；publication bound/recovery owner 保留。 |
| 2 / F-B | CLOSED | proposal §3 #2/#10、§4，design D2/Open Q4，local request/error/S08：create 无新字段且显式 reject key；今日 silent acceptance→新 stdout v1 idempotency_key_not_supported/2 属 Q1 tightening；reject/ignore 和旧 build duplicate 风险披露。 |
| 3 / F-C | CLOSED | local wrapper、design D2、tasks 1.4：baseline stderr text；create 2 或 unsupported message→3、retry 3；stop owned execution tree、queued cleanup、无 false terminal 保留。 |
| 4 / F-D/F-T | CLOSED | local S53 THEN 逐字恢复 living consumer rule，helper/spy 另列 documentation example；tasks 7.12/fixture contract 和本登记准确披露 S42/S46/S48/S51 modified-inherited 与 S53 example。 |
| 5 / F-E | CLOSED | headless projection table/S37/S39、design D5、proposal §3 #5/#10 与 §4：五 reason 的 completed.payload.reasons、job.errorCode、failed、exit（7/7/binding 4,2,6 else 3/1/1）；reasons 非 v1-stable，0–8 含义不变。 |
| 6 / F-F | CLOSED | tasks 1.1/新增 1.6/7.2：Owner 决策后、red tests 前强制 prune 为仅选定分支的可归档 SHALL，删除 specs 的 pending/conditional/预设决策措辞，备选归 design history，裁剪 S34/S35，strict validate + 单次 closure re-check + approved exact SHA；默认全选也执行。 |
| 7 / F-G | CLOSED | local stderr table/S06/S20、design D2：plain text + newline，unknown ID 与 status 同形 Unknown job: <id>/3，invalid-timeout argument diagnostic/2，pre-snapshot observation diagnostic/8；stdout envelopes 保留。 |
| 8 / F-H/F-O | CLOSED | design R4、local R4/S35、proposal §3/§5、tasks 1.4：POSIX/Windows matrix、cancel-by-id/EOF 边界、Career Kit no win32 detach/500 ms grace、signal re-raise、hard-kill negative assertion、ignored stdin 不 armed。 |
| 9 / F-I/F-J | CLOSED | design R4/Open questions、local R4：daemon-first relay 标为推荐默认，no-relay 备选；Q2(a′) held Run daemon-ineligible/dead-holder cancel/recovery、holder-liveness/scenario 成本与不推荐原因；(a) 默认不变。 |
| 10 / F-K/F-L/F-M/F-N | CLOSED | proposal §3/§5/§6/§7、design R3/D6、headless R3/S40：两种 key surface 均列 guide:210 #10、ledger enum Non-breaking refresh disclosure 先例、平台 adapter allowlist/proxy 条件与 consumer env minimisation bypass、完整 C7 §9.5 清单。 |
| 11 / F-P/F-Q/F-R/F-S | CLOSED | headless/D5/tasks 的 internal maxQueuedApiAgeMs constant/test seam；2c59664f 产品基线、S23/tasks 明确 git-show vendored old parser 直接执行；helper 仅 example；local S15 secret-first/Bearer fixture；runtime-core S36 keyed fixture。 |
| 12 | CLOSED | 本 change strict / all strict 54/54、diff check；Revision parent 与自查更新，STATUS 仅对应行改 DRAFT v3；单一本地指定提交，无 push。 |

| §2 P2 | Status | 对应 §3 编辑 |
| --- | --- | --- |
| F-A | CLOSED | 1 |
| F-B | CLOSED | 2 |
| F-C | CLOSED | 3 |
| F-D | CLOSED | 4 |
| F-E | CLOSED | 5 |
| F-F | CLOSED | 6 |
| F-G | CLOSED | 7 |
| F-H | CLOSED | 8 |

“CLOSED”只表示二审有界文字修补落实，不是实现、Owner APPROVED 或独立 reviewer verdict。F-F 按权威 §3.6 关闭为决策后强制 prune gate；当时 DRAFT 未擅替 Owner 选分支；现 Owner 已批准默认，本次按 1.6 prune，待独立 closure re-check，仍未获归档授权。无未按清单落实的编辑；F-U 是 REC、原位保留，无新动作。
不变项自查：D1 单核/owner、D3 ack/committed fact/TICKET-128、D4 reservation 同事务/unique/compensation/raw key never stored、D2 command shapes 与 wait 30 s/0–86400000/exit9-only、v1、R2 Owner decision、S01–S40 IDs、六项推荐默认；L1–L11、tasks 顺序和 8.7/8.8、DRAFT 状态、未来证据表均保留。Owner §4 六项当时按原文搬入并逐字比对。以上“不变项”描述为 v3 历史记录，当前状态/决策以本次 APPROVED 记录为准。

## Future evidence required

实施批准后逐项填写真实环境、精确 SHA、命令、退出码、断言数、日志/fixture 版本与限制：

| Evidence | Required receipt | Current state |
| --- | --- | --- |
| Owner APPROVED / C7 | `0f9984367a9fbc8c5030f9aecc85ac9628a71cde`；proposal §10 / design Owner decisions 的六项默认、R1–R4 已决 | APPROVED 2026-10-02 (Owner, bound to 0f998436) |
| Decision prune closure | tasks 1.6；选定分支 SHALL / S34/S35 prune 已记录，独立 closure re-check 绑定本次记录提交 SHA | text prune complete / independent closure re-check pending |
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
| Integration / acceptance | 另行获授权的 local merge SHA + post-merge gates；统筹代行 ACCEPTED（同 SHA 双技术标记、无开放 Red；红灯回 Owner） | pending |
| Remote | 没有明确新授权则持续 not authorized / not performed | not authorized |

手工 smoke：独立 profile 下启动既有 daemon，submit 返回后立即退出 submitter，status/events/wait/result
读到同一 Run；再验 daemon 不在、重启、completion、cancel、retry key、stdio EOF/shutdown、Workbench。
Windows 有/无 artifacts 分开：TICKET-127 未修复时 run-dir 必须 fail closed，不以 WSL 或 source test 冒充成功。
TICKET-128 已披露孤儿与 partial publish 仍在；本切片只证明“不误 ack/claim/ready”，不证明自动恢复。

## Scenario register

每一行的完整入口、输入夹具和可观察断言均在对应 spec delta 的 Scenario。S41–S54 保留 living 标题以满足 MODIFIED 完整替换检查，编号位于标题下的 register 注释与夹具 case key；不改 S01–S40 编号。S41–S54 保留每条 living assertion；S42/S46/S48/S51 为 modified-inherited 一致性补充（S48 细化同核表述），S53 增加 documentation helper example，原 consumer obligation 逐字保留。
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
- Owner 已选 Q2(a) own-Run pump 并接受 R1 daemon-first/异常分支；R3 accept env、R4 relay 与 SIGKILL/TerminateProcess、500 ms kill 残余仍在 Owner decisions / D2 明列。批准不等于实际验证。
- Owner 已选 R2 direct 扩 feature enum；旧 pinned schema 失败仍须披露并保留失败 fixture。
- 本次 full check 在 retired-runtime 阶段因 Node spawnSync EPERM 未完成；v3 历史另有缺依赖记录。实施 gate 必须在完整可执行环境重跑。
- Owner Q4 已接受最小 ack/claim/read barrier + TICKET-128 残余；不得把全量修复塞入本切片。
- 未记录 ACCEPTED 停止收尾/归档；统筹代行需同 SHA 双技术标记、无开放 Red，红灯回 Owner；push 未获授权。任何后续代码变化都使实现验证和独立评审失效。
