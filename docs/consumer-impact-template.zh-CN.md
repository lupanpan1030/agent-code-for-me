# Locus Public Consumer Impact 模板

> **状态：RATIFIED PROCESS TEMPLATE — 2026-08-25。**
>
> 当一个 change 可能改变 Local Job API、Session API、公开 CLI/SDK/schema/event/error，或
> app↔Runtime 独立版本协议时，必须在实现前复制并填写本模板。它是 Owner 决策材料，不是
> 自动兼容承诺。内部 TypeScript API、私有 tRPC、数据库和 service boundary 不使用本模板，
> 应在同一 change 原子迁移并删除旧路径。
>
> 本模板也不是未来 API 的真实合同文档。Approved change 仍必须另外发布 versioned consumer
> guide/reference、machine-readable schema、event/error semantics、examples 与 contract tests；
> 不能让 consumer 从本模板或规划文档猜测调用方式。

依据：[Locus Interoperability Contract v1 — C7](ideas/locus-interoperability-contract-v1.zh-CN.md)
和 [Locus AI 协作开发工作流 — W4.2](ideas/locus-ai-collaboration-workflow.zh-CN.md)。

## 1. Gate 状态

```text
Status: DRAFT | OWNER_DECISION_REQUIRED | APPROVED | REJECTED | SUPERSEDED
OpenSpec change:
Author / date:
Decision owner:
Implementation blocked until:
```

在 Owner 填写第 10 节前，受影响的 public contract 实现保持 blocked；可以继续不触及该边界的
分析和验证。

## 2. 一句话变化

```text
Current:
Proposed:
Why:
```

不要只写“重构”或“升级 API”。必须说明 consumer 能观察到的差异。

## 3. 受影响公共边界

| Contract / version | Surface | 当前行为 | 新行为 | Breaking? | 证据 |
| --- | --- | --- | --- | --- | --- |
| 例如 `locus.local-job.v1` | `runs create` response | `jobId` | `runId` | Yes | schema/test/doc path |

逐项覆盖适用内容：

- command / endpoint / SDK method；
- request/response field、type、requiredness、enum；
- event name、payload、ordering、cursor/replay；
- lifecycle/status、retry/cancel/idempotency；
- error code、exit code、HTTP/RPC status；
- default Runtime/provider/model/policy；
- auth、secret、permission、filesystem/network boundary；
- artifact/path/digest/retention；
- capability/extension negotiation；
- packaging、discovery、transport 或启动方式。

## 4. Current 与 proposed 示例

### Current

```json
{}
```

### Proposed

```json
{}
```

### 纯 schema diff 无法表达的语义变化

```text
例如：create 从等待 terminal 改为立即返回；retry 是否创建新 Run；event 是否可重放。
```

## 5. 已知 consumer 与所需修改

| Consumer | 使用证据 | 受影响调用 | 必须修改什么 | Consumer-owned test/E2E |
| --- | --- | --- | --- | --- |
| Career Kit / Amadeus / other | repo link、issue、dogfood record 或“unknown” |  |  |  |

Locus 不负责维护 Career Kit、Amadeus 的通用业务 contract matrix。Change author 只需列出当前有
证据的已知调用方和接入影响；consumer 自己拥有 adapter、业务逻辑与 E2E。不能因为没有完整矩阵
就宣称“没有 consumer”，未知必须明确写 `unknown`。

## 6. 选择方案与成本

至少比较适用选项：

| Option | Locus 变化 | Consumer 变化 | 维护成本 | 风险 | 删除条件 |
| --- | --- | --- | --- | --- | --- |
| Direct new standard | 只发布新 contract | consumer 同步升级 | 最低 | 协调升级 | 不适用 |
| New public version | 新 version adapter → canonical core | 可分期升级 | 中 | 多版本测试 | 旧版 sunset |
| Temporary old-contract facade | 旧 envelope 薄翻译到 canonical core | 暂时不改或小改 | 中 | facade 滞留 | 明确日期/条件 |

不得把“保留旧 core/DB/worker/state machine”列为兼容方案。

## 7. Compatibility facade 边界（仅 Owner 选择兼容时填写）

```text
Canonical owner:
Old contract/version:
New canonical contract/core:
Allowed translation:
Explicitly forbidden business logic/state:
Migration flag or gate:
Deprecation owner/comment:
Deletion date or objective removal condition:
Architecture guard / contract tests:
```

Facade 只能 parse/validate/translate/serialize，并调用同一 canonical core；不得拥有独立数据库、
状态转换、event ledger、retry/cancel、policy/auth、Runtime dispatch 或 artifact lifecycle。

## 8. 发布、失败恢复与回滚

```text
Required release order:
Can old consumer call new Locus?
Can new consumer call old Locus?
Unsupported-version error:
Downgrade behavior (must not be silent):
Rollback target:
External data/artifact impact:
Security impact:
```

如果 direct break 要求 consumer 同步升级，写明哪个版本组合被明确拒绝。不要自动猜测或静默
downgrade 到语义较弱的协议。

## 9. 验证证据

- [ ] machine-readable schema / generated type 已更新；
- [ ] common-core contract tests；
- [ ] old-contract facade tests（如适用）；
- [ ] unsupported version / extension fail-closed tests；
- [ ] consumer-neutral conformance fixture；
- [ ] 文档、示例和 error semantics 同步；
- [ ] 已知 consumer adapter/E2E 状态已记录；
- [ ] architecture guard 证明不存在 old/new business core；
- [ ] packaged/transport smoke（如边界涉及打包或 Host）。

## 10. Owner 决定

```text
Decision: DIRECT_NEW_STANDARD | NEW_VERSION | TEMPORARY_FACADE | DEFER | REJECT
Approved exact scope:
Compatibility obligation:
Sunset/deletion condition:
Consumer coordination required:
Owner:
Date:
```

Owner 的决定只覆盖这里写明的 contract/version/scope；不能被复用成以后所有 breaking change 的
永久授权。
