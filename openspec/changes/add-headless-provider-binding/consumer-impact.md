# Consumer Impact: Headless provider binding

## 1. Gate 状态

```text
Status: APPROVED
OpenSpec change: add-headless-provider-binding
Author / date: Codex / 2026-08-25
Decision owner: Locus Owner
Implementation blocked until: none; Owner decision is recorded below
```

## 2. 一句话变化

```text
Current: Local Job API v1 jobs can use only the selected Runtime's native credential path.
Proposed: A create request may select a stored provider profile/model by reference; when it
          omits a profile, Locus resolves runtime default profile before native credentials.
Why: Let consumers choose an Engine's provider/model without receiving or persisting secrets.
```

## 3. 受影响公共边界

| Contract / version | Surface | 当前行为 | 新行为 | Breaking? | 证据 |
| --- | --- | --- | --- | --- | --- |
| `locus.local-job.v1` | create request | no `provider` selection | optional `provider.profileId` / `provider.model` references | Additive | schema + contract tests |
| `locus.local-job.v1` | discovery | no binding advertisement | `features` contains `provider-binding` | Additive | schema + consumer guide |
| `locus.local-job.v1` | result | applied provider is implicit | sanitized `resolvedProvider` source/profile/model | Additive | schema + contract tests |
| `locus` CLI | `run`, `schedules create` | native credential/model only | `--provider-profile`, `--model` | Additive | CLI tests + guide |
| Runtime dispatch | omitted provider | native credential | configured runtime default, then native when no default exists | Observable default | provider-binding tests |
| Error semantics | unusable explicit/default profile | not expressible | structured fail-closed provider error; no native fallback | New failure mode | provider-binding tests |

Requests contain references only. Upstream credentials and per-run gateway tokens remain in the
main process/runtime environment boundary and are forbidden from CLI arguments, events, result
payloads, and persisted job records.

## 4. Current 与 proposed 示例

### Current

```json
{
  "apiVersion": "locus.local-job.v1",
  "runtime": { "id": "codex" },
  "mode": "agent",
  "prompt": { "text": "Inspect this repository." }
}
```

### Proposed

```json
{
  "apiVersion": "locus.local-job.v1",
  "runtime": { "id": "codex" },
  "mode": "agent",
  "prompt": { "text": "Inspect this repository." },
  "provider": {
    "profileId": "codex-main",
    "model": "gpt-5.4"
  }
}
```

Terminal results add a non-secret receipt such as:

```json
{
  "resolvedProvider": {
    "source": "request-profile",
    "profileId": "codex-main",
    "model": "gpt-5.4"
  }
}
```

If `provider` is omitted, a configured runtime default is authoritative. A missing, corrupt, or
runtime-mismatched configured default fails closed; only the absence of a default permits native
credential fallback. An older Locus build without the `provider-binding` feature must be treated as
unsupported because it may ignore an additive request field.

## 5. 已知 consumer 与所需修改

| Consumer | 使用证据 | 受影响调用 | 必须修改什么 | Consumer-owned test/E2E |
| --- | --- | --- | --- | --- |
| Career Kit | `lupanpan1030/career-application-kit` → `app/electron/runtime/locus-adapter.cjs` calls `locus.local-job.v1` and validates provider receipts | discovery, create, result | Feature-detect before sending `provider`; continue fail-closed result validation | Career Kit owns `test:locus` and synthetic lifecycle E2E |
| Amadeus | Owner-reported Locus integration; public repository `Lucas1479/Amadeus` | exact call sites unknown | Adopt the published consumer guide/schema; do not depend on Locus internals | Amadeus owner |
| Other consumers | unknown | unknown | Require exact `apiVersion` plus feature detection | consumer owner |

Locus publishes the contract, schema, examples, errors, and conformance fixtures. It does not own a
Career Kit/Amadeus business contract matrix or their adapters.

## 6. 选择方案与成本

| Option | Locus 变化 | Consumer 变化 | 维护成本 | 风险 | 删除条件 |
| --- | --- | --- | --- | --- | --- |
| Direct new standard | one canonical v1 implementation with feature detection | opt in only after feature proof | Low | older builds reject/omit capability | n/a |
| New public version | duplicate envelope/version adapter | migrate to v2 | Medium | unnecessary version split for additive fields | not selected |
| Temporary old-contract facade | translate two public contracts | delayed migration | Medium/high | facade lingers despite no production user obligation | not selected |

Selected: direct new standard. No old business core, duplicate provider registry, or compatibility
facade is retained.

## 7. Compatibility facade 边界

Not applicable. No compatibility facade is approved.

## 8. 发布、失败恢复与回滚

```text
Required release order: publish Locus schema/guide first; consumers feature-detect and adopt later.
Can old consumer call new Locus? Yes for its existing v1 fields; additive fields may be ignored.
Can new consumer call old Locus? Only when it does not require provider binding; otherwise reject
                              after discovery lacks `provider-binding`.
Unsupported-version error: existing exact apiVersion mismatch; missing feature is consumer-side unsupported capability.
Downgrade behavior: never silently remove a requested profile/model or fall back from a broken default.
Rollback target: prior Locus build; consumers must stop sending/requiring provider binding.
External data/artifact impact: test-only database rows may be reset; no production-user migration obligation.
Security impact: stored upstream credentials remain main-process-only; exact scoped-token redaction is required.
```

## 9. 验证证据

- [x] machine-readable schema / generated type 已更新；
- [x] common-core contract tests；
- [x] old-contract facade tests（不适用，无 facade）；
- [x] unsupported feature / invalid profile fail-closed tests；
- [x] consumer-neutral CLI/API fixtures；
- [x] 文档、示例和 error semantics 同步；
- [x] 已知 consumer adapter/E2E ownership 已记录；
- [x] architecture guard / ownership review 证明不存在第二套 provider storage core；
- [x] headless Host/provider smoke evidence 已记录在 `verification.md`。

## 10. Owner 决定

```text
Decision: DIRECT_NEW_STANDARD
Approved exact scope: optional provider/model references, provider-binding feature advertisement,
                      deterministic request-default-native resolution, sanitized applied-provider receipt.
Compatibility obligation: none for old public behavior beyond exact v1 validation and documented
                          feature detection; no old internal API or business path is retained.
Sunset/deletion condition: n/a; rejected duplicate provider readers/cores are removed in this change.
Consumer coordination required: publish guide/schema/fixtures and name observable changes; each consumer
                                owns its adapter and E2E adoption.
Owner: Locus Owner (confirmed in this planning/closeout thread)
Date: 2026-08-25
```
