# Local Job API v1 下游接入手册

语言：[English](local-job-api-v1-consumer-guide.md) | 简体中文

这份手册给下游本地应用使用：它们想把 Locus 当作 runtime 层，但不应该 import Locus
源码，也不应该直接读取 `agents.db`。这个合同本身不绑定某一个业务场景，也不绑定某一个
runtime。

v1 的正式入口是机器可读 CLI：

```bash
locus api ...
```

机器可读合同：[local-job-api-v1.schema.json](local-job-api-v1.schema.json)

下游集成应该使用 `locus api`。`locus run` 和 `locus jobs` 继续保留给人工使用和兼容脚本。

## 文档参考模型

这份手册参考了几类成熟官方文档的组织方式：

- [GitHub CLI Manual](https://cli.github.com/manual/) 把安装、配置、命令参考和示例分开，
  适合脚本化 CLI。
- [Stripe API Reference](https://docs.stripe.com/api?lang=curl) 把 request、response
  envelope 和 error 都作为集成合同的一部分。
- [Docker CLI Reference](https://docs.docker.com/reference/cli/docker/) 会明确环境变量、
  配置、示例、subcommands 和敏感配置风险。

Locus 这里不是 HTTP API，而是本地 CLI + JSON 合同；手册结构借鉴这些文档，但内容全部
落在 Locus 的真实实现上。

## v1 提供什么

Local Job API v1 允许下游 consumer：

- 列出 runtime capability manifests
- 发起一次 agent run
- 发起一次 single-shot completion
- 读取 run status
- 读取标准化 event envelopes
- 读取最终 result envelope
- 取消 queued 或 running 的 API job
- 重试 failed、canceled、interrupted 的 API job
- 收集 Locus run-owned metadata artifacts
- 注册、查看、非破坏性地注销本地 project workspace

它不提供：

- HTTP 或 WebSocket server
- hosted queue 或 cloud agent
- 直接写入下游 `final/` artifacts
- 由 consumer 传 provider credentials
- 访问 Locus SQLite 内部结构
- 完整 OS sandbox
- 通过 CLI 或 Local Job API 命令删除 project history

## 安装和定位 CLI

打包后的 app 会包含 `locus` launcher。开发环境里，本 repo 使用：

```bash
resources/cli/locus api runtimes list --json
```

macOS packaged app 的 launcher 在 app resources 目录下：

```bash
/Applications/Locus.app/Contents/Resources/cli/locus api runtimes list --json
```

Windows 使用 app resources 目录下的 `locus.cmd` launcher。源码级 shim 行为已有测试覆盖。
Windows packaged 实机 smoke 已明确延期，不要求它阻塞当前源码/macOS 下游接入。

开发 smoke 可以覆盖 headless executable：

```bash
LOCUS_HEADLESS_EXECUTABLE=/path/to/locus-electron-wrapper \
LOCUS_USER_DATA_DIR=/tmp/locus-api-profile \
resources/cli/locus api runtimes list --json
```

生产 consumer 不应该设置 `LOCUS_HEADLESS_EXECUTABLE`。它只用于本地 QA 和 packaging
smoke。

## 命令参考

```bash
locus api runtimes list --json
locus api runs create --request <path|-> --json
locus api runs status <job-id> --json
locus api runs events <job-id> [--after <sequence>] [--follow] --jsonl
locus api runs result <job-id> --json
locus api runs cancel <job-id> --json
locus api runs retry <job-id> --json
locus api projects register --cwd <path> [--name <name>] --json
locus api projects status --cwd <path> --json
locus api projects unregister --cwd <path> [--force] --json
```

规则：

- JSON 命令在 stdout 输出可解析 JSON。
- event stream 每行一个 JSON object。
- diagnostics 和 validation errors 写到 stderr。
- `--request -` 表示从 stdin 读取 create request。
- `--after <sequence>` 返回 sequence 大于该值的 events。
- `create` 和 `retry` 是同步执行：命令会在 run 进入 terminal status 后返回。
- `projects unregister` 是非破坏性操作：它只把 project 从 active registration
  移除，不删除 chats、sub-chats、worktrees、job history 或 repository files。
  永久删除 project history 只在桌面 UI 里提供。

## 最小接入流程

1. 下游应用创建或定位自己的 package directory。
2. 确保 `project.cwd` 指向 Locus 已注册的本地 project，或该 project 内的子目录。
3. 把 `artifacts.baseDir` 放在 `project.cwd` 下面。
4. 列出 runtime capabilities。
5. 用 `locus api runs create` 创建 run。
6. 用 job ID 读取 `status`、`events` 和 `result`。
7. 下游应用只在自己的用户审核通过后，才提升或复制最终业务 artifacts。

## Project Registration Commands

consumer 可以在创建 runs 前注册 project path：

```bash
locus api projects register --cwd "$PROJECT_DIR" --json
locus api projects status --cwd "$PROJECT_DIR" --json
locus api projects unregister --cwd "$PROJECT_DIR" --json
```

registration 按 canonical project path 幂等。在 project lifecycle 改动里，重新
register 一个已移除 project 会恢复原 project registration，并保留原 chat history
和同一个 project 的关联。

`unregister` 的意思是“从 active Projects list 移除”。为了自动化安全，它是软移除：

- 不删除 chats 或 sub-chats
- 不删除 Locus worktrees
- 不删除 job history
- 不删除 repository files
- `--force` 只绕过 active-list removal 的 active-job 拒绝；它仍然不会删除
  project history

v1 没有 `locus api projects delete-history` 命令。永久删除 project history 只能在
桌面 UI 里做，并且必须先把 project 从 active Projects list 移除，再由用户确认受影响
的 chat/worktree 数量。

## Runtime Capabilities

创建 job 前先检查 runtime 能力：

```bash
locus api runtimes list --json
```

响应结构：

```json
{
  "apiVersion": "locus.local-job.v1",
  "features": [
    "runtime-readiness",
    "provider-binding",
    "completion",
    "canonical-run-ledger"
  ],
  "runtimes": [
    {
      "runtimeId": "codex",
      "readiness": {
        "state": "needs-auth",
        "detail": "Codex login is required.",
        "hint": "Connect Codex with ChatGPT login, use a Codex API key, or choose a provider profile."
      },
      "capabilities": [
        {
          "id": "planMode",
          "state": "supported",
          "scope": "runtime",
          "reason": "..."
        }
      ]
    }
  ]
}
```

Discovery features：

| Feature | 含义 |
| --- | --- |
| `runtime-readiness` | 每个 runtime 带下文所述的 advisory `readiness` 对象。 |
| `provider-binding` | create request 会遵循 `provider` 引用块。 |
| `completion` | 支持 `kind: "completion"` request。 |
| `canonical-run-ledger` | events 与 result 来自同一个已提交的 Run ledger：逐记录的稠密 event 投影、修正后的终态真相、可选 native 元数据。见 [Canonical Run Ledger](#canonical-run-ledger)。 |

依赖某个 feature 的 consumer 应在派发前检查 `features`，缺少该标识即视为不支持。
v1 没有要求 feature 或 extension 的 request 字段，Locus 也不做 extension 协商；
这项检查是 consumer 自己的 preflight。
[local-job-api-v1.schema.json](local-job-api-v1.schema.json) 中的
`discoveryFeature` enum 是封闭的：用旧版 schema 副本校验 discovery 输出的
consumer 必须刷新该副本，因为“忽略未知字段”不覆盖新的 enum 值。

`readiness.state` 是 advisory，可取 `ready`、`needs-auth`、`unavailable`
或 `unknown`。readiness probe 失败时 discovery 仍然 exit 0 并返回完整
manifest list；该 runtime 报 `unknown`，诊断写 stderr。用
`locus api runtimes list --json --no-probe` 可以跳过 subprocess status
probe；被跳过的 probe 状态报 `unknown`，不会误报 `ready`。

对省略 provider 的 agent run，readiness 遵循真实执行顺序：先检查该 runtime 的
headless 默认 profile；只有完全没有配置 default 时，才检查 native credentials。可严格
读取且 target 匹配的 default 报 `ready`。已经配置但缺失、损坏、无法解密或 target
不匹配的 default 报 `unavailable`，不会把 native auth 宣传成 fallback，因为真实 run
也会 fail closed。`--no-probe` 只跳过 native subprocess probe，仍会执行这个低成本的
default-profile 检查。这里描述的是 runtime default readiness，不是对未来 create request
中任意显式 profile 的诊断。

如果下游 workflow 依赖某个能力，就在 create request 的 `runtime.requiredCapabilities`
里声明。Locus 会在 provider work 开始前拒绝 unsupported 或 degraded 的必需能力。

常见 runtime IDs：

- `codex`
- `claude-code`
- `claude`，作为 `claude-code` 的 alias

常见 modes：

- `plan`
- `agent`

Execution profiles：

- 省略 `runtime.executionProfile` 或设为 `batch`：v1 默认行为。能力和权限
  gate 允许时，Codex 使用 `codex exec`，Claude 使用 `claude -p`。
- `policy-grant`：高级、显式 opt-in 的非 batch adapter profile。目前必须提供
  `runtime.policyGrant.scopes`，且这些 scope 在 v1 中只作为准入/审计 metadata；
  它们还不是稳定的 app-server per-scope 强制边界。

Provider 选择：

- 省略 `provider`：Locus 会先读取该 runtime 的 headless 默认 profile
  （Claude Code 用 `claude-main`，Codex 用 `codex-main`）。如果没有配置默认
  profile，runtime 使用自己的 native credentials。
- 设置 `provider.profileId`：Locus 在 main process 解析已存储的 provider
  profile，并为本次 run 创建 scoped local gateway token。如果 profile 不存在、
  target runtime 不匹配，或 credential 无法解密，job 会 fail closed。
- 设置 `provider.model`：传入 model override。若没有同时设置
  `provider.profileId`，它使用 runtime-managed credentials，并绕过 headless
  defaults。

一旦传入 `provider`，至少必须包含一个非空的 `profileId` 或 `model`。空对象或
值为 `null` 的 provider block 都是无效输入；只有完全省略整个属性才会选择默认
profile 路径。

consumer 只能传 provider 引用，不能在 `provider`、`input` 或 artifacts 中传
provider token、headers 或 environment variables。

completion job 比 agent job 更严格：必须提供 `provider.profileId`，不会使用 runtime
defaults，也不会回落到 native credentials。

## Agent Create Request

通用本地 package 示例：

```json
{
  "apiVersion": "locus.local-job.v1",
  "consumer": {
    "id": "docs-workbench",
    "runExternalId": "package-review-001"
  },
  "project": {
    "cwd": "/Users/alice/LocalPackages/example-package",
    "projectId": null
  },
  "runtime": {
    "id": "codex",
    "requiredCapabilities": ["planMode"]
  },
  "mode": "plan",
  "prompt": {
    "text": "Review this local package and produce a readiness note."
  },
  "provider": {
    "profileId": "codex-main",
    "model": "gpt-5.3-codex"
  },
  "input": {
    "contract": "example.local-package.v1",
    "packageDir": "/Users/alice/LocalPackages/example-package",
    "sourceMetadata": "source.json"
  },
  "artifacts": {
    "baseDir": "/Users/alice/LocalPackages/example-package/.locus/runs",
    "writePolicy": "metadata-only"
  }
}
```

执行：

```bash
locus api runs create --request request.json --json
```

或通过 stdin：

```bash
cat request.json | locus api runs create --request - --json
```

## Completion Create Request

completion job 用于一次上游模型请求：没有 tools、worktree、artifacts，也不会启动 runtime
child process。通过 `"kind": "completion"` 选择。

文本 completion：

```json
{
  "apiVersion": "locus.local-job.v1",
  "kind": "completion",
  "consumer": {
    "id": "generic-tool",
    "runExternalId": "text-task-001"
  },
  "provider": {
    "profileId": "completion-main",
    "model": "provider-model"
  },
  "messages": [
    {
      "role": "user",
      "content": "Summarize this generic text in one paragraph."
    }
  ],
  "responseFormat": {
    "type": "text"
  }
}
```

结构化 completion：

```json
{
  "apiVersion": "locus.local-job.v1",
  "kind": "completion",
  "consumer": {
    "id": "generic-tool"
  },
  "provider": {
    "profileId": "completion-main"
  },
  "messages": [
    {
      "role": "user",
      "content": "Return a label and confidence for this generic input."
    }
  ],
  "responseFormat": {
    "type": "json_schema",
    "schema": {
      "type": "object",
      "required": ["label", "confidence"],
      "properties": {
        "label": { "type": "string" },
        "confidence": { "type": "number" }
      }
    }
  }
}
```

`responseFormat.schema` 由 caller 拥有。Locus 只把它映射到 provider 原生结构化输出机制，
并用它校验返回 JSON；Locus 不解释 schema 字段含义。

## Request 字段

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `apiVersion` | 是 | 必须是 `locus.local-job.v1`。 |
| `consumer.id` | 是 | 下游应用稳定 ID，例如 `docs-workbench`。 |
| `consumer.runExternalId` | 否 | consumer 自己的 run ID，用于关联。 |
| `project.cwd` | 是 | 本次 run 的绝对本地路径。必须存在，并位于 Locus 已注册 project 内。 |
| `project.projectId` | 否 | 可选 Locus project ID。提供后，`cwd` 必须在该 project 内。 |
| `runtime.id` | 是 | `codex`、`claude-code`，或 alias `claude`。 |
| `runtime.requiredCapabilities` | 否 | runtime work 开始前必须满足的 capability IDs。 |
| `runtime.executionProfile` | 否 | `batch` 或 `policy-grant`。默认 `batch`；现有 v1 caller 应该省略，除非需要显式 gated profile。 |
| `runtime.policyGrant.scopes` | 当 `runtime.executionProfile` 为 `policy-grant` 时必填 | 用于准入/审计的 bounded scope labels。v1 中这些 labels 还不会绑定 app-server permission decisions。 |
| `runtime.policyGrant.canDecideAutomatically` | 否 | 可选 boolean。若在 `policy-grant` 中为 false，Locus 会 fail closed，因为没有可见用户。 |
| `mode` | 是 | `plan` 或 `agent`。 |
| `prompt.text` | 是 | prompt 文本，最大 256 KiB。 |
| `provider.profileId` | 否 | 已存储 provider profile ID。request 只携带引用；credentials 由 Locus main process 解析。 |
| `provider.model` | 否 | model override。没有 `provider.profileId` 时，它使用 runtime-managed credentials，不读取 defaults。 |
| `input` | 否 | consumer 自己的结构化 metadata，不能包含 secrets。 |
| `artifacts.baseDir` | 否 | Locus run metadata 的绝对目录，必须在 `project.cwd` 内。 |
| `artifacts.writePolicy` | 否 | `metadata-only` 或 `proposal-only`，默认 `metadata-only`。 |

completion-only 字段：

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `kind` | 是 | 必须是 `completion`。省略 `kind` 表示 agent request。 |
| `provider.profileId` | 是 | 已存储 provider profile ID。缺失或不可用时 completion job fail closed。 |
| `provider.model` | 否 | 针对所选 profile 的 model override。 |
| `messages` | 是 | 有序 `system`、`user` 或 `assistant` messages。 |
| `maxTokens` | 否 | 最大输出 token 数。 |
| `temperature` | 否 | `0` 到 `2` 的数字。 |
| `responseFormat` | 否 | `{ "type": "text" }` 或 `{ "type": "json_schema", "schema": ... }`，默认 text。 |

completion request 会拒绝 agent-only 字段，例如 `project`、`mode`、`prompt`、`input`
和 `artifacts`。

ID 限制：

- `consumer.id`：1-80 个字符，可用字母、数字、`.`、`_`、`:`、`-`
- `consumer.runExternalId`：1-160 个字符，同样字符集
- request JSON：最大 1 MiB

## Artifact Contract

如果设置了 `artifacts.baseDir`，Locus 会把 run-owned metadata 写到：

```text
<artifacts.baseDir>/<jobId>/
  request.json
  events.jsonl
  result.json
  artifacts.json
```

对通用本地 package，推荐结构：

```text
example-package/
  source.json
  source.md
  notes.md
  drafts/
  final/
  .locus/
    runs/
      <jobId>/
        request.json
        events.jsonl
        result.json
        artifacts.json
```

规则：

- `artifacts.baseDir` 必须是绝对路径。
- 它必须在 `project.cwd` 下面。
- 它不能在 `.git` 里。
- 它不能在名为 `final` 的路径组件里。
- 如果它已经存在，必须是目录。
- 已存在路径组件不能通过 symlink 逃逸 project。
- v1 中 Locus 不会把输出提升到下游 `final/` 目录。

`final/` 只用于下游应用或用户审核批准后的材料。

manifest 与 result 中每个 `artifacts` 条目都带 `role`。Locus run-dir 文件使用
`request`、`events`、`result`、`manifest`。API create/retry 时，已准备好的
run-dir 文件的初始 `artifact_created` 仍然排在 `job_started` 之前。

在带 `canonical-run-ledger` 的 build 上，最终的 `events.jsonl`、`result.json`、
`artifacts.json` 由该 run 冻结的终态前缀准备，并与该 run 唯一的 `completed`
在同一次持久提交中登记。它们不会再发出自己的 `artifact_created`。提交后这些文件
不可变：即使之后到达迟到诊断，登记的 SHA-256 仍与文件字节一致（见
[Canonical Run Ledger](#canonical-run-ledger) 的迟到观察）。最终文件准备失败时
run 不能成功：结算为 `failed`（或保留 `canceled`/`interrupted`），
`completed.payload.reasons` 含 `terminal_artifact_preparation_failed`，且不登记
未验证条目。

run 的 artifact owner 也可以准入 native artifact 候选，准入后追加 role 为
`native` 的条目；被拒绝的候选变成 `status` 记录：`subtype: "artifact_admission"`、
`result: "rejected"`，`reason` 为 `missing`、`out_of_scope`、`ownership_mismatch`、
`digest_mismatch` 或 `redaction_unsafe`。当前 build 中没有 runtime adapter 提交
native 候选，所以 result 目前只列出 Locus run-dir role。未知 role 按新增处理。

## Create Response

`create` 返回一个 v1 envelope，包含 serialized job 和 final result：

```json
{
  "apiVersion": "locus.local-job.v1",
  "job": {
    "id": "mpzcxv3xp2ji1fl2",
    "source": "api",
    "runtime": "codex",
    "mode": "plan",
    "status": "succeeded",
    "apiConsumerId": "docs-workbench",
    "apiConsumerRunId": "package-review-001",
    "artifactManifestPath": "/.../.locus/runs/mpzcxv3xp2ji1fl2/artifacts.json"
  },
  "result": {
    "apiVersion": "locus.local-job.v1",
    "jobId": "mpzcxv3xp2ji1fl2",
    "status": "succeeded",
    "runtime": "codex",
    "mode": "plan",
    "consumer": {
      "id": "docs-workbench",
      "runExternalId": "package-review-001"
    },
    "artifactManifestPath": "/.../.locus/runs/mpzcxv3xp2ji1fl2/artifacts.json",
    "providerProfileId": "codex-main",
    "modelOverride": "gpt-5.3-codex",
    "artifacts": [],
    "diagnostics": [],
    "resolvedProvider": {
      "source": "request-profile",
      "profileId": "codex-main",
      "model": "gpt-5.3-codex"
    },
    "result": {}
  }
}
```

实际 `job` object 可能包含更多 renderer-safe 字段。consumer 只应该依赖本手册列出的
字段，并忽略未知字段。

## Status

```bash
locus api runs status <job-id> --json
```

响应：

```json
{
  "apiVersion": "locus.local-job.v1",
  "job": {
    "id": "mpzcxv3xp2ji1fl2",
    "source": "api",
    "status": "succeeded"
  }
}
```

只有 `source=api` 的 job 能通过 `locus api runs ...` 读取。

## Events

```bash
locus api runs events <job-id> --after 0 --jsonl
```

每行是一个 event envelope：

```json
{"apiVersion":"locus.local-job.v1","jobId":"mpzcxv3xp2ji1fl2","sequence":1,"type":"job_created","createdAt":"2026-06-04T10:33:00.000Z","payload":{}}
```

稳定 v1 event types：

- `job_created`
- `job_started`
- `assistant_delta`
- `reasoning_delta`
- `tool_started`
- `tool_delta`
- `tool_finished`
- `usage_update`
- `artifact_created`
- `status`
- `error`
- `completed`

Envelope 与 payload 规则：

- `payload` 是该记录裸的、已脱敏的语义 payload。没有包装对象：不会出现
  `runId`、`runEventSequence`、`redaction` 这些键。
- 12 个公开类型之外的内部记录类型，会以 `status` 在自己的 sequence 上投递，
  `payload.subtype` 等于内部类型名（例如 `command_output`、`permission_requested`），
  并保留其 payload 成员。
- 在带 `canonical-run-ledger` 的 build 上，每条已提交记录都在原始 `sequence` 上
  恰好投影一次。sequence 保持稠密、从不重新编号，因此每个 run 的 `status` event
  数量会增加。请用 `--after` 分页，不要假定单个 run 的 event 数量有上限。只处理
  既有非 `status` 类型的 consumer 语义不变。
- 忽略未知 payload 字段、未知 `status` subtype 和未知 `payload.extensions`
  命名空间。

断点续读逻辑：

```text
lastSequence = 0
用 --after lastSequence 读取 events
逐个处理 event:
  lastSequence = event.sequence
直到 job terminal
```

如果想让命令等待新 events，使用 `--follow`。job 进入 terminal status 后，follow 命令会退出。
`--follow` 在终态 `completed` 之后退出，不等待迟到诊断；如需收集，用
`--after <completed 的 sequence>` 再读一次。

## Result

```bash
locus api runs result <job-id> --json
```

响应：

```json
{
  "apiVersion": "locus.local-job.v1",
  "jobId": "mpzcxv3xp2ji1fl2",
  "status": "succeeded",
  "runtime": "codex",
  "mode": "plan",
  "consumer": {
    "id": "docs-workbench",
    "runExternalId": "package-review-001"
  },
  "artifactManifestPath": "/.../.locus/runs/mpzcxv3xp2ji1fl2/artifacts.json",
  "artifacts": [
    {
      "role": "request",
      "path": "/.../request.json",
      "sha256": "...",
      "contentType": "application/json",
      "sizeBytes": 1234
    }
  ],
  "diagnostics": [],
  "resolvedProvider": {
    "source": "request-profile",
    "profileId": "codex-main",
    "model": "gpt-5.3-codex"
  },
  "result": {
    "finalMessage": "..."
  }
}
```

对非 success 状态，先读取 `diagnostics`，再决定给用户展示什么。
`resolvedProvider` 只有在 terminal result envelope 中才是权威值。in-flight
status 轮询时，Locus 还可能正在解析 defaults 或铸造 scoped gateway token，
所以 provider 字段可能是暂态值。

completion result envelope 使用同一个外层 result 结构。内层 `result` 是：

```json
{
  "content": {
    "label": "example",
    "confidence": 0.91
  },
  "usage": {
    "inputTokens": 12,
    "outputTokens": 6
  },
  "resolvedProvider": {
    "source": "request-profile",
    "profileId": "completion-main",
    "model": "provider-model"
  }
}
```

文本 completion 的 `content` 是 string。`json_schema` completion 的 `content` 是已经按
caller schema 校验过的 JSON。

Provider binding 错误一律 fail-closed。如果显式选择的 profile 或已配置的
headless 默认 profile 不可用，job 会以结构化 diagnostic 失败，例如
`provider_profile_required`、`provider_profile_not_found`、
`provider_profile_runtime_mismatch` 或 `provider_profile_unavailable`。这些情况下
Locus 不会静默回落到 runtime native credentials。
`provider_profile_required`、`provider_profile_not_found` 和
`provider_profile_runtime_mismatch` 属于 invalid request，exit `2`；
`provider_profile_unavailable` 属于 credential availability，exit `4`；
`local_only_guard_blocked` 表示所配置的 profile 指向 local-only 模式禁用的
Locus 托管服务或远程 sandbox 服务，exit `6`。

## Canonical Run Ledger

在 `features` 中列出 `canonical-run-ledger` 的 build，会通过承载该 run 的进程里的
同一个已提交 ledger 记录每个 run。命令、request 字段、12 个 event 类型、6 字段
event envelope、`jobId` 和 `sequence` 游标都不变。变化的是：哪些 run 算成功、
唯一的 `completed` 记录携带什么、以及一个 run 有多少 `status` 记录。

### 对 consumer 的变化

- **终态真相（breaking）。** run 的状态来自已记录的证据，而不是 runtime 的默认
  成功。即使 runtime 报告成功，只要记录了拒绝（denial）、输出无效或输出为空，
  run 就是 `failed`，exit `1`。只有 Locus 自身的内部请求显式允许时，空输出才被
  接受。可重试的 `error` 之后若有带有效输出的 live 成功，仍为 `succeeded`，exit
  `0`。见下文“Outcome 与 exit 示例”。
- **`completed.payload` 是 ledger outcome。** 每个 run 恰好一个 `completed`。其
  payload 为 `{status, reasons?, evidenceKeys, synthetic?, recovery?, code?,
  message?, lossPossible?}`，不再携带 `exitCode`、`errorCode`、`errorMessage`
  或 `result`。这些信息请从 `runs result`（`status`、`diagnostics`、`result`）和
  create/retry 的 exit code 读取。
- **`status` 记录变多。** 每条已提交记录都在原始 sequence 上投影一次（见
  [Events](#events)）。请用 `--after` 分页。
- **脱敏标记。** 持久化记录、events、`events.jsonl`、`result.json` 和 diagnostics
  中被脱敏的值统一写作 `<redacted>`。此前 store 对部分模式还会写 `[redacted]`、
  `[redacted-jwt]` 或 `[redacted-pem]`。请把标记当作不透明文本，不要解析。
- **裸 payload。** API event payload 仍是裸的语义 payload。仅桌面端使用的
  `{runId, runtimeId, runEventSequence, redaction, payload}` 包装对新 run 已不存在，
  也从不经由 `locus api` 出现。
- **可选 native 元数据。** 由 runtime 执行的 Codex app-server 记录可以附加
  `payload.extensions["runtime.codex.v1"]`，见下文“Native 元数据”。
- **Codex 文件变更。** Codex app-server 的文件变更进度以带 `changeCount` 的
  `tool_delta` 到达，turn 级 diff 是 `subtype: "diff_observation"` 的 `status`
  记录。桌面 Workbench 不再渲染单独的 Codex “file-change” 行；Workbench 渲染不属于
  本合同。
- **过期 worker。** 只有 Locus 在同一主机上确认 worker 进程已不存在、或从未认领该
  job 时，才会把该 job 以带 `recovery` 证据的 `interrupted` 结算。来自仍存活或状态
  未知 worker 的过期心跳会让 job 保持 `running`，并在 stderr 或 daemon 日志中输出
  主机诊断，不产生 event。
- **历史 run。** 见下文“历史 run”。

### Outcome 与 exit 示例

ledger 依据已记录的证据，对每个 run 只结算一次，顺序如下：

1. 显式 cancel 得到 `canceled`。
2. interrupt、transport exit 或已确认的 worker 丢失得到 `interrupted`。
3. 记录的拒绝、无效输出、空输出、运行后凭据检查失败或 live runtime 失败得到
   `failed`。
4. 否则，live 成功（或有效的 batch/completion 主机结果）且输出有效，得到
   `succeeded`。

缺少成功证据即为 `failed`。`error` event 只是证据，自身从不结束 run。

| 已记录的证据 | `completed.payload`（节选） | Result `diagnostics` | create/retry exit |
| --- | --- | --- | --- |
| runtime 成功且记录了输出 | `{"status":"succeeded","evidenceKeys":["policy:no-recorded-denial","record:5","postrun:security-cleanup-ok"]}` | `[]` | `0` |
| 可重试 `error`（`willRetry: true`）之后成功并有输出 | `{"status":"succeeded",...}` | `[]` | `0` |
| runtime 报告成功，但有权限请求被拒绝 | `{"status":"failed","reasons":["policy_denied"],"evidenceKeys":["record:4",...]}` | `[{"code":"policy_denied","message":"Run outcome failed: policy_denied."}]` | `1` |
| runtime 报告成功但没有输出 | `{"status":"failed","reasons":["output_empty","output_evidence_missing"],...}` | `[{"code":"output_empty",...}]` | `1` |
| Codex app-server transport 在终态前退出 | `{"status":"interrupted","reasons":["transport_exit"],"evidenceKeys":[],"synthetic":{"source":"transport_exit","transportId":"t1","exitCode":1,"signal":null}}` | 视 runtime 而定 | `1` |
| 运行中请求 cancel | `{"status":"canceled","reasons":["cancel_requested"],...,"synthetic":{"source":"cancel"}}` | `[{"code":"job_canceled","message":"Job was canceled."}]` | `5` |
| 已确认 worker 丢失（之后用 `runs status` / `runs result` 读取） | `{"status":"interrupted","reasons":["worker_stopped"],...,"synthetic":{"source":"recovery"},"recovery":{"confidence":"confirmed","basis":"worker_process_absent","observedAt":"..."}}` | `[{"code":"worker_interrupted",...}]` | 不适用 |

字段说明：

- `reasons` 是说明性字符串，不是封闭 enum。当前取值包括 `policy_denied`、
  `output_invalid`、`output_empty`、`output_evidence_missing`、
  `credential_postcheck_failed`、`native_failed`、`host_failed`、
  `success_evidence_missing`、`terminal_artifact_preparation_failed`、
  `transport_exit`、`worker_stopped`，以及 `cancel_requested`、`queued_cancel` 等
  cancel/interrupt 原因。
- `evidenceKeys` 中形如 `record:<n>` 的条目指向提供该证据的已提交记录的
  `sequence`；其他键是不透明的。
- `code` 在观察到 native 终态码时携带它；`message` 是失败 run 最后记录的错误信息。
- `lossPossible: true` 表示因可能含密钥而被扣留的流文本在终态时无法安全释放，
  已被丢弃而非发布。
- [Exit Codes](#exit-codes) 中的 exit code 表不变；修正的只是它所依据的 status。

### Errors

`error` payload 保留既有成员，并新增：

- `classification`：`diagnostic`、`retryable`、`fatal_candidate` 或
  `policy_denial` 之一。粗粒度 runtime 默认 `diagnostic`，`willRetry` 为 `true`
  时为 `retryable`。
- runtime 提供时的 `willRetry`。
- 存在时的 native 错误码 `code`。

### Usage 快照

`usage_update` payload 保留既有成员，并新增规范化快照：

```json
{"kind":"snapshot","total":{"inputTokens":90,"outputTokens":18,"totalTokens":108},"last":{"inputTokens":6,"outputTokens":2,"totalTokens":8},"delta":{"inputTokens":90,"outputTokens":18,"totalTokens":108},"dedupeKey":"...","asOfSequence":7}
```

- `total` 是该 run 的累计向量，`last` 是最近一次调用或 turn 的向量。
- `delta` 是 `total` 减去 `baseline`。resume 的 run 建立起点时才有 `baseline`。
- `dedupeKey` 标识一次快照修订；重复的修订不会重复计数，而向量相同的不同调用都会
  计数。
- `asOfSequence` 是该快照对应的 sequence。
- 计数器下降不会产生负 delta；`discontinuity: true` 标记这次重置。
- 向量只包含 runtime 报告的计数器，缺失的计数器是缺省而不是 0。
- `completed` 之后到达的 usage 是仅供诊断的迟到记录；result 的 usage 截至封存前缀。

### Status 记录

`status` payload 带 `payload.subtype`。未知 subtype 按可忽略的诊断处理。

| Subtype | 含义 |
| --- | --- |
| `system_lifecycle` | 本身没有 subtype 的主机生命周期 status。既有主机 status（如 `runtime_selected` / `runtime_selection_refused`）保留其 `payload.status` 与字符串 `payload.runtime`。 |
| `guard_decision`、`permission_requested`、`scope_expansion_requested`、`question_pending`、`question_result`、`mcp_needs_auth`、`command_started`、`command_output`、`command_finished` | 12 个公开类型之外的内部记录类型，投影时保留其 payload 成员。 |
| `late_event` | run 封存后到达、仅供诊断的观察。见下文“迟到观察”。 |
| `artifact_admission` | 被拒绝的 native artifact 候选。见 [Artifact Contract](#artifact-contract)。 |
| `interaction_boundary` | native server request、response send（`sent` 或 `failed`）或 resolution。它记录的是观察，不是交互状态或授权。 |
| `native_resume_validated`、`native_resume_rejected` | 关联的 resume 事实（Codex `thread/resume` 响应、Claude 关联的 `system/init`）。拒绝既不结算 run，也不改变 session 绑定。 |
| `thread_lifecycle`、`turn_lifecycle`、`item_lifecycle`、`item_reconciliation`、`reasoning_part`、`plan`、`hook_lifecycle`、`compaction`、`review_mode`、`user_message`、`diff_observation`、`runtime_process`、`workspace_observation`、`approval_review`、`model_verification`、`mcp_lifecycle`、`reroute`、`warning`、`protocol_response` 等 | Codex app-server native 边界，遵循 `codex-runtime-parity` capability 中固定的处置表。 |
| `unknown_native_method`、`unsupported_native_surface`、`raw_response_observed` | 固定表之外的 native 方法、已观察但延后支持的面（realtime、remote control、Windows），或 raw response item。`contentOmitted: true` 表示刻意不存储 native 内容。 |

### 迟到观察

`completed` 之后，runtime 仍可能发出尾随输出、usage 或退出。Locus 将其记录为
`status`：`subtype: "late_event"`、`diagnosticOnly: true`、`terminalSequence`
（即 `completed` 的 sequence）、`originalType`、可选的 `nativeMethod`，以及已
脱敏的 `observation`。迟到的 usage 记录在 `observation` 中保留观察到的
`total`/`last`。迟到记录从不产生第二个 `completed`，从不改变 result 或其 usage，
也从不改变已提交的 `events.jsonl`、`result.json` 摘要。`--follow` 停在
`completed`；显式执行 `runs events <job-id> --after <completed 的 sequence>` 会返回
迟到记录。

### Native 元数据（`runtime.codex.v1`）

由 runtime 执行的 Codex app-server 记录，其对象 payload 可以带：

```json
{"text":"hello","extensions":{"runtime.codex.v1":{"schemaVersion":1,"maturity":"experimental","threadId":"th","turnId":"tu","itemId":"msg"}}}
```

- 该命名空间是可选、实验性的（`schemaVersion: 1`，`maturity: "experimental"`）。
  其余成员（`threadId`、`turnId`、`itemId`、`sessionId`、`requestId`、`callId`，
  以及可能更多）是该边界上出现过的、已脱敏的 native 标识。
- 只有在 run 绑定其 runtime 执行之后才会发出。绑定之前写入的生命周期记录（包括
  带字符串 `payload.runtime` 的 `runtime_selected`、`runtime_selection_refused`
  status）从不携带它，之后也不会补加到已有记录上。
- Codex `exec` run（默认 `batch` profile）产生不含它的粗粒度记录。由 app-server
  执行的 run 可以携带它；对 API job 而言，就是 `runtime.executionProfile:
  "policy-grant"` 的 Codex run。Claude run 不使用该命名空间。
- 它不是 native 协议稳定性承诺，也不授予 live-attach 或控制能力。直接从 runtime
  消费的 Codex native events 不在本合同范围内。

### 历史 run

`canonical-run-ledger` build 之前记录的 run，其已存储的 events、sequence 和 ID
逐字节保留。Locus 不会为它们补加 fact key、provenance、reconciliation 记录或缺失
的 `completed`，也从不向它们追加。这一区分只在内部；公开 job envelope 没有
`historyQuality` 字段。

`canonical-run-ledger` build 不会启动或恢复旧 build 留下的 `queued` 或 `running`
job。升级前请用旧 build 排空它们：让它们完成、取消它们，或让旧 build 的 recovery
结算它们。升级后，对已排空的 `failed`、`canceled` 或 `interrupted` job 执行
`runs retry`，会在 ledger 上创建新 run。

### 升级检查清单

1. 依赖修正后的终态真相之前，先检查 `features` 是否含 `canonical-run-ledger`；
   缺少时拒绝或回退。
2. 刷新本地固定的 `local-job-api-v1.schema.json` 副本。
3. 从 `runs result` 和 exit code 读取 outcome 细节，不要读 `completed.payload`
   中已不存在的成员。
4. 此前报告成功、但被拒绝、输出无效或输出为空的 run，现在预期为 `failed` 与
   exit `1`。
5. 用 `--after` 分页读取 events；忽略未知 `status` subtype 和未知 extension 命名空间。
6. 把 `<redacted>` 当作不透明文本。

## Cancel

```bash
locus api runs cancel <job-id> --json
```

Cancel 只作用于 API jobs。queued API job 会立即完成为 `canceled`。running job 会收到
持久化 cancel request，由 runtime runner 观察并处理。

## Retry

```bash
locus api runs retry <job-id> --json
```

只有以下 terminal retryable 状态的 API job 可以 retry：

- `failed`
- `canceled`
- `interrupted`

`retry` 会创建新的 API job，通过 `retryOfJobId` 指向原 job，准备新的 artifact run
directory，同步执行，并返回和 `create` 相同的 envelope 结构。

不要对 API job 使用 `locus jobs retry`。那个命令保留给非 API 的人工 job flow。

## Exit Codes

| Code | 含义 |
| --- | --- |
| `0` | 成功。 |
| `1` | Runtime 执行失败。 |
| `2` | 参数无效，或 request/artifact contract 无效。 |
| `3` | runtime、mode 或 required capability 不支持。 |
| `4` | 缺少 runtime credentials。 |
| `5` | Job 被取消。 |
| `6` | local-only guard 阻止执行。 |
| `7` | `project.cwd` 无效或未注册。 |
| `8` | 内部错误。 |

在带 `canonical-run-ledger` 的 build 上，create/retry 的 exit code 跟随 ledger
outcome。runtime 报告成功、但 ledger 结算为 `failed` 的 run（记录的拒绝、无效或空
输出、缺少输出证据、运行后凭据检查失败）exit `1`。见
[Canonical Run Ledger](#canonical-run-ledger) 的“Outcome 与 exit 示例”。

consumer 应该先看 exit code 和 stderr，再解析 stdout。Diagnostics 写到 stderr。

## 安全规则

不要在 request 里放这些内容：

- provider API keys
- OAuth tokens
- `Authorization` headers
- raw environment variables
- passwords
- private keys
- credential file contents

Locus 会通过自己的 main-process provider/runtime setup 路径解析 credentials。consumer 只
传业务上下文，不传 provider secrets。
provider-backed runs 只传 `provider.profileId`，可选再传 `provider.model`；
scoped gateway token lifecycle 由 Locus 管理。

secret-like key 或 value 会在 provider work 开始前被拒绝。

## 接入示例

推荐的下游应用流程：

```text
1. 用户创建或审核一个本地工作 package。
2. 下游应用创建本地 package：

   packages/<example-package>/
     source.json
     source.md
     notes.md
     drafts/
     final/

3. 下游应用写 request.json：
   project.cwd = packages/<example-package>
   input.packageDir = packages/<example-package>
   artifacts.baseDir = packages/<example-package>/.locus/runs

4. 下游应用执行：
   locus api runs create --request request.json --json

5. 下游应用读取 result/artifacts/events。
6. 下游应用给用户展示 proposed output。
7. 只有用户批准后，下游应用才写入或提升 final artifacts。
```

最小 shell 示例：

```bash
PACKAGE_DIR="$HOME/LocalPackages/example-package"
mkdir -p "$PACKAGE_DIR/.locus/runs" "$PACKAGE_DIR/drafts" "$PACKAGE_DIR/final"

cat > "$PACKAGE_DIR/request.json" <<EOF
{
  "apiVersion": "locus.local-job.v1",
  "consumer": {
    "id": "docs-workbench",
    "runExternalId": "example-package-001"
  },
  "project": {
    "cwd": "$PACKAGE_DIR"
  },
  "runtime": {
    "id": "codex",
    "requiredCapabilities": ["planMode"]
  },
  "mode": "plan",
  "prompt": {
    "text": "Review this local package and identify missing source material."
  },
  "input": {
    "contract": "example.local-package.v1",
    "packageDir": "$PACKAGE_DIR"
  },
  "artifacts": {
    "baseDir": "$PACKAGE_DIR/.locus/runs",
    "writePolicy": "metadata-only"
  }
}
EOF

locus api runs create --request "$PACKAGE_DIR/request.json" --json
```

`PACKAGE_DIR` 必须位于 Locus 已注册 project 里面。

## Troubleshooting

| 现象 | 常见原因 | 处理方式 |
| --- | --- | --- |
| `project.cwd must be inside a registered project` | package 目录未注册，或不在 Locus 已注册 project 内。 | 在 Locus 打开/注册该 project，或传入已注册 project 内的 cwd。 |
| `artifacts.baseDir must be inside project.cwd` | artifact base 在 run cwd 外面。 | 使用 `<project.cwd>/.locus/runs`。 |
| `artifacts.baseDir cannot be inside a final artifact directory` | Locus 拒绝把 metadata 写入下游 final artifacts。 | 把 API metadata 放到 `.locus/runs`。 |
| `Unsupported runtime.id` | runtime ID 不被识别。 | 使用 `codex`、`claude-code` 或 `claude`。 |
| `Unsupported required capability` | capability ID 不存在。 | 先看 `locus api runtimes list --json`。 |
| exit `4` | runtime credentials 缺失。 | 在 Locus 里配置 runtime，不要通过 request 传 credentials。 |
| JSON parse 失败 | 命令可能失败并把 diagnostics 写到了 stderr。 | 先检查 exit code 和 stderr，再解析 stdout。 |
| `completed.payload` 没有 `exitCode` 或 `result` | 在 `canonical-run-ledger` build 上，`completed` 只携带 ledger outcome。 | 读取 `runs result`（`status`、`diagnostics`、`result`）和命令 exit code。 |
| runtime 报告成功，但 run 为 `failed`，原因是 `policy_denied`、`output_empty`、`output_invalid` 或 `output_evidence_missing` | 修正后的终态真相：拒绝、无效输出和空输出会使 run 失败。 | 查看 `diagnostics` 以及该 run 的 `status`/`error` events。 |
| schema 校验拒绝 `features` 中的 `canonical-run-ledger` | 本地固定的旧版 schema 的 `discoveryFeature` enum 是封闭的。 | 刷新 `local-job-api-v1.schema.json` 副本。 |

## 稳定性合同

v1 稳定：

- `locus api` 下的命令名
- `apiVersion: locus.local-job.v1`
- 本手册列出的 request fields
- 本手册列出的 response envelopes
- event envelope 字段
- discovery feature 标识，包括 `canonical-run-ledger`
- 带 `canonical-run-ledger` 时：每个 run 稠密的 `sequence`、每个 run 恰好一个
  `completed`，以及 `completed.payload.status`
- run metadata artifact 文件名
- secret rejection boundary
- `projects unregister` 的非破坏性语义

v1 不稳定：

- serialized `job` 里的额外字段
- 内部 SQLite schema
- v1 envelope 之外的内部 event payload 细节，包括 `status` subtype 及其成员，
  以及 `completed.payload.reasons` 与 `evidenceKeys` 的取值
- `payload.extensions["runtime.codex.v1"]`（`maturity: "experimental"`）
- Workbench 渲染细节
- `locus run` 和 `locus jobs` 的人工 CLI 格式

consumer 应该只依赖本手册列出的 v1 字段，并忽略未知 JSON 字段。
