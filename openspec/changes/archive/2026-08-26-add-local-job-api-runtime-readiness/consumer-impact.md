# Consumer Impact: Local Job API runtime readiness

## 1. Gate 状态

```text
Status: APPROVED
OpenSpec change: add-local-job-api-runtime-readiness
Author / date: Codex / 2026-08-25
Decision owner: Locus Owner
Implementation blocked until: none; Owner decision is recorded below
```

## 2. 一句话变化

```text
Current: runtime discovery advertises static capabilities but cannot show whether the default
         headless execution path is usable.
Proposed: discovery adds feature identifiers and an advisory readiness receipt for each Runtime.
Why: consumers can fail early instead of creating a job that predictably fails authentication/configuration.
```

## 3. 受影响公共边界

| Contract / version | Surface | 当前行为 | 新行为 | Breaking? | 证据 |
| --- | --- | --- | --- | --- | --- |
| `locus.local-job.v1` | runtime manifest | static capabilities only | required `readiness { state, detail?, hint? }` | Additive envelope | schema/tests |
| `locus.local-job.v1` | discovery envelope | no feature list | `features` includes `runtime-readiness` | Additive | schema/tests |
| `locus` CLI | `api runtimes list` | always probes available static data | `--no-probe` returns bounded `unknown` where probing is skipped | Additive | CLI tests |
| Default job preflight | credential source | not exposed | mirrors provider-omitted execution: configured default profile, otherwise native credential | Observable semantics | readiness/provider tests |

States are `ready`, `needs-auth`, `unavailable`, and `unknown`. The receipt is point-in-time and
advisory: creation remains permitted and the consumer must still handle terminal runtime errors.

## 4. Current 与 proposed 示例

### Current

```json
{
  "apiVersion": "locus.local-job.v1",
  "runtimes": [
    { "runtimeId": "codex", "capabilities": ["run"] }
  ]
}
```

### Proposed

```json
{
  "apiVersion": "locus.local-job.v1",
  "features": ["runtime-readiness"],
  "runtimes": [
    {
      "runtimeId": "codex",
      "capabilities": ["run"],
      "readiness": {
        "state": "needs-auth",
        "detail": "Codex is installed but not authenticated.",
        "hint": "Sign in with the Codex CLI."
      }
    }
  ]
}
```

When a runtime default provider profile exists, readiness reports that default job route. A usable
default can be `ready` even without native login; a corrupt/missing/mismatched configured default is
`unavailable` even when native login works, because the actual provider-omitted job fails closed.
Only when no default exists does readiness inspect native credentials. `--no-probe` may report
`unknown`; it never claims unproven readiness.

## 5. 已知 consumer 与所需修改

| Consumer | 使用证据 | 受影响调用 | 必须修改什么 | Consumer-owned test/E2E |
| --- | --- | --- | --- | --- |
| Career Kit | `lupanpan1030/career-application-kit` → `app/electron/runtime/locus-adapter.cjs` already feature-detects `runtime-readiness` | `api runtimes list --json` | Keep feature detection, treat receipt as advisory, handle terminal failure | Career Kit `test:locus` + synthetic lifecycle E2E |
| Amadeus | Owner-reported Locus integration; exact discovery use unknown | exact call sites unknown | Use published schema/guide; absence of feature means unsupported, not `ready` | Amadeus owner |
| Other consumers | unknown | unknown | Exact-match `apiVersion`; ignore unknown feature strings; do not infer readiness when feature absent | consumer owner |

Locus owns the stable discovery contract and conformance material; consumers own their adapters and
domain-specific fallback/UI.

## 6. 选择方案与成本

| Option | Locus 变化 | Consumer 变化 | 维护成本 | 风险 | 删除条件 |
| --- | --- | --- | --- | --- | --- |
| Direct new standard | additive v1 receipt + feature proof | opt in after feature proof | Low | stale advisory receipt | n/a |
| New public version | v2 envelope and translator | hard migration | Medium | needless split for additive discovery | not selected |
| Temporary facade | two discovery shapes | delayed migration | Medium | duplicate serialization path | not selected |

Selected: direct new standard with explicit feature detection. No duplicate discovery core or old
business state machine is retained.

## 7. Compatibility facade 边界

Not applicable. No compatibility facade is approved.

## 8. 发布、失败恢复与回滚

```text
Required release order: publish Locus schema/guide; consumers adopt feature detection independently.
Can old consumer call new Locus? Yes; additive JSON fields are ignorable.
Can new consumer call old Locus? Yes only if readiness is optional; otherwise missing feature is unsupported.
Unsupported-version error: existing exact apiVersion mismatch; missing feature is an unsupported capability.
Downgrade behavior: missing/skipped/failed proof becomes unknown or unavailable, never silent ready.
Rollback target: prior discovery envelope; consumers must fall back to terminal error handling.
External data/artifact impact: none; readiness is computed, not persisted.
Security impact: detail/hint are normalized and secret-free; provider credentials are never returned.
```

## 9. 验证证据

- [x] machine-readable schema / generated type 已更新；
- [x] common-core contract tests；
- [x] old-contract facade tests（不适用，无 facade）；
- [x] missing feature and non-ready fail-closed consumer semantics documented；
- [x] consumer-neutral CLI/API fixtures；
- [x] 文档、示例和 error semantics 同步；
- [x] 已知 consumer adapter/E2E ownership 已记录；
- [x] architecture review covers the default-provider/native single resolution order；
- [x] native Claude credential-source smoke evidence is recorded in `verification.md`。

## 10. Owner 决定

```text
Decision: DIRECT_NEW_STANDARD
Approved exact scope: additive runtime-readiness feature and per-runtime advisory receipt whose
                      provider-omitted semantics mirror default-profile-then-native execution.
Compatibility obligation: no v2 or old-envelope facade; older consumers may ignore additive fields,
                          newer consumers must feature-detect.
Sunset/deletion condition: n/a; there is one discovery serializer and one readiness resolver path.
Consumer coordination required: publish schema/guide/fixtures; consumer repositories own adoption tests.
Owner: Locus Owner (confirmed in this planning/closeout thread)
Date: 2026-08-25
```
