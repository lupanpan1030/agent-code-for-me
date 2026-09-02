# Consumer Impact: Nested project cwd resolution

## 1. Gate 状态

```text
Status: APPROVED
OpenSpec change: fix-nested-project-cwd-resolution
Author / date: Codex / 2026-09-02
Decision owner: Repository Owner
Implementation blocked until: no public-contract blocker; exact-SHA technical gates and Owner ACCEPT still apply before main integration
```

The Owner's 2026-09-02 instruction explicitly selects local adoption of the
safe deepest-ancestor half and rejects the linked-worktree half.

## 2. 一句话变化

```text
Current: An implicit cwd inside multiple explicitly registered nested roots resolves to the first matching database row.
Proposed: It resolves deterministically to the matching canonical registered root with the greatest path length.
Why: Database row order is not project ownership; the nested project is the most specific explicit registration.
```

## 3. 受影响公共边界

| Contract / version | Surface | 当前行为 | 新行为 | Breaking? | 证据 |
| --- | --- | --- | --- | --- | --- |
| `locus.local-job.v1` | `api projects status` owning project | First matching registered ancestor | Deepest matching registered ancestor | No shape/version break; intentional ambiguous-case semantic correction | `tests/project-registry.test.ts` |
| `locus.local-job.v1` | `runs create` project attribution | May attribute nested cwd to outer project | Attributes to deepest explicitly registered project | Same | shared registry owner |
| Headless internal projections | ACP and schedules cwd ownership | Same first-match ambiguity | Same deterministic shared-owner result | No envelope change | shared registry owner |

No request/response fields, enums, error codes, exit codes, events, schema,
transport, auth, secret, provider, model, policy, or filesystem eligibility
change.

## 4. Current 与 proposed 示例

### Current

```json
{
  "cwd": "/repo/packages/app/workspace",
  "project": { "id": "outer" },
  "projectPath": "/repo"
}
```

### Proposed

```json
{
  "cwd": "/repo/packages/app/workspace",
  "project": { "id": "app" },
  "projectPath": "/repo/packages/app"
}
```

### 纯 schema diff 无法表达的语义变化

Only the winner among multiple already-eligible explicit registrations changes.
The allowed cwd set is identical before and after the change.

## 5. 已知 consumer 与所需修改

| Consumer | 使用证据 | 受影响调用 | 必须修改什么 | Consumer-owned test/E2E |
| --- | --- | --- | --- | --- |
| Career Kit | Ratified product-direction evidence | Local Job create/status if it registers nested roots | None; same v1 shape | Existing adapter/E2E remains consumer-owned |
| Amadeus | Ratified product-direction evidence and external PR #18 use case | Local Job create/status in nested registered workspaces | None; same v1 shape; explicit registration remains available | Amadeus E2E remains consumer-owned |
| Other/unknown local consumers | Unknown | Same ambiguous nested-root case | None expected | Consumer-owned |

## 6. 选择方案与成本

| Option | Locus 变化 | Consumer 变化 | 维护成本 | 风险 | 删除条件 |
| --- | --- | --- | --- | --- | --- |
| Direct new standard | Correct the shared owner in place | None | Lowest | Older Locus may still return outer project | N/A |
| New public version | Duplicate version for one winner rule | Version negotiation | High | Two semantics persist | Reject |
| Temporary old-contract facade | Preserve first-match projection | None | High | Retains nondeterminism and duplicate selection rule | Reject |

Selected: **Direct new standard**. No compatibility facade or second resolver is
approved.

## 7. Compatibility facade 边界

Not applicable. The v1 envelope is unchanged and no old business rule is kept.

## 8. 发布、失败恢复与回滚

```text
Required release order: ordinary Locus release after Owner ACCEPT; no consumer coordination required
Can old consumer call new Locus? yes; response shape is unchanged
Can new consumer call old Locus? yes syntactically; old builds may retain outer-project attribution in the ambiguous nested-root case
Unsupported-version error: not applicable; no new request or capability
Downgrade behavior: visible project attribution may revert to the older ambiguous behavior; cwd admission is not widened
Rollback target: exact pre-change base/source selected by the Integrator
External data/artifact impact: none
Security impact: allowed cwd set unchanged; no Git metadata trust added
```

## 9. 验证证据

- [ ] machine-readable schema / generated type updated — N/A, no shape change;
- [x] common-owner targeted contract test;
- [ ] old-contract facade tests — N/A, no facade;
- [ ] unsupported version / extension tests — N/A, no new version/extension;
- [x] consumer-neutral nested-root fixture;
- [ ] documentation and error semantics — N/A beyond this decision record;
- [x] known consumer impact recorded;
- [x] architecture/scope audit proves no second resolver or Git admission;
- [ ] packaged/transport smoke — N/A, no packaging/transport change.

## 10. Owner 决定

```text
Decision: DIRECT_NEW_STANDARD
Approved exact scope: Among already-eligible explicitly registered canonical roots, implicit cwd resolution selects the longest/most-specific projectReal path; explicit projectId and eligibility remain unchanged.
Compatibility obligation: Preserve the locus.local-job.v1 shape and existing rejection/error behavior; no facade.
Sunset/deletion condition: Not applicable; replace the first-match rule in place.
Consumer coordination required: None before implementation; disclose the nested-attribution correction in change evidence.
Owner: Repository Owner
Date: 2026-09-02
```
