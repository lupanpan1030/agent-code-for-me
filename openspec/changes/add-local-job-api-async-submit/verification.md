# Verification

Status: **DRAFT — awaiting Owner APPROVED**

## Draft identity and authority

- Change: add-local-job-api-async-submit；Phase 3 第二份提案。
- Base / unchanged product source SHA: `2c59664f1b80a5f782eb05f82d33f718d9bc7053`。
- Worktree: `/home/chen/projects/locus-add-local-job-api-async-submit-draft`。
- Branch: `codex/add-local-job-api-async-submit-draft`。
- Author / date: Codex / 2026-10-01 (Pacific/Auckland)。
- Draft receipt commit：本文件所在的单一本地 `docs(openspec): draft local job api async submit` 提交；用 `git log -1 --format=%H -- openspec/changes/add-local-job-api-async-submit` 解析，避免自引用 SHA。
- Product source edits/tests authored: **none**。本记录不声称实现、conformance 或 packaged smoke 已通过。
- Owner APPROVED / C7 R1,R2,Q1–Q6: **pending**。
- Implementation source SHA / Codex IMPLEMENTATION_VERIFIED: **not applicable to draft / not issued**。
- Fresh Claude Code REVIEW_APPROVED / reviewed source SHA: **not performed / not issued**。
- Local merge SHA / Owner ACCEPTED: **none / pending**。
- Remote push/PR/merge/release/rules: **not authorized / not performed**；本次也不本地 merge。

## Draft-only checks actually performed

调用指定基线 worktree 的已安装 OpenSpec binary，工作目录始终为本 draft worktree；未安装依赖、未写产品文件。

| Check | Result / scope |
| --- | --- |
| `/home/chen/projects/agent-code-for-me/node_modules/.bin/openspec validate add-local-job-api-async-submit --strict --no-interactive` | Exit 0：`Change 'add-local-job-api-async-submit' is valid`。仅格式/规格校验。 |
| 同 binary `validate --all --strict --no-interactive` | Exit 0：`Totals: 54 passed, 0 failed (54 items)`；53 living specs + 本 draft。 |
| Scenario 登记一致性 | 33 个 Scenario，S01–S33 连续且唯一，每个有 GIVEN/WHEN/THEN；登记与下表一一对应。 |
| `git diff --check` / staged diff check | Exit 0：working/staged diff 均无 whitespace 错误，九个允许范围内文档；提交后再核对完整提交 diff。 |
| `bun run check:full` | **Exit 1 / environment prerequisite blocked**：该新 worktree 未安装 node_modules，lint 首步找不到 `node_modules/.bin/biome`；后续 architecture/typecheck/tests/spec/build 未执行。没有当作通过，也没有为纯文档草案安装依赖或修改产品文件。 |

完整本地命令日志 `/tmp/async-submit-draft-validate-all.log`、
`/tmp/async-submit-draft-check-full.log` 是临时执行记录，不是 durable 产品证据。

## Future evidence required

实施批准后逐项填写真实环境、精确 SHA、命令、退出码、断言数、日志/fixture 版本与限制：

| Evidence | Required receipt | Current state |
| --- | --- | --- |
| Owner change / C7 | 精确 approved draft SHA；Q1–Q6、Red R1/R2 决定及兼容/版本组合 | pending |
| Independent red author | 作者/独立上下文、测试 source SHA、S01–S33 red 结果，不看实现猜断言 | not authored |
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

每一行的完整入口、输入夹具和可观察断言均在对应 spec delta 的同名 Scenario。
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
| S08 | [local-job-api](specs/local-job-api/spec.md) | Normalized replay spans create and submit | pending / not run |
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
| S29 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Job run acknowledges the shared creation core | pending / not run |
| S30 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Protocol cancel and shutdown remain session-owned | pending / not run |
| S31 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Schedule creation retains one fire without bypassing creation facts | pending / not run |
| S32 | [architecture-ownership](specs/architecture-ownership/spec.md) | Guard rejects an inline API execution fallback | pending / not run |
| S33 | [architecture-ownership](specs/architecture-ownership/spec.md) | Guard rejects duplicate creation and ledger writers | pending / not run |

## Consumer evidence ownership

| Owner | Evidence | State |
| --- | --- | --- |
| Locus | Neutral async/stream/control、batch/structured-output、stdio、schema、compatibility fixtures | planned only |
| Career Kit | 自己的 adapter/version/业务 E2E | unknown；历史事实不冒充本切片 receipt |
| Amadeus | Windows 接入方，具体命令/版本/adapter/E2E 自有 | unknown；不作协商或优先级安排 |
| Other | 消费者与 receipt | unknown |

## Stop gates and known limitations

- 文档 strict pass 不等于 Owner APPROVED、产品 VERIFIED、独立 REVIEW_APPROVED 或 ACCEPTED。
- L2 的正常终态 bytes 目标明确；executor 启动/异常可完成性是 Q2 / Red R1 待决项；本稿未默认采用破坏 L2 的 exit8 例外。
- feature enum 扩展是 Red R2，旧 pinned schema 失败是要披露的合同影响，不能删除失败 fixture。
- full check 本次因缺少 worktree 依赖未完成；实施 gate 必须在完整依赖环境重跑。
- Q4 需要 Owner 选择接受最小 read/ack barrier 残差或将 TICKET-128 完整修复前置。
- 未获 Owner ACCEPTED 停止收尾/归档；push 未获授权。任何后续代码变化都使实现验证和独立评审失效。
