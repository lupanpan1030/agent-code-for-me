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
- 提交 agent run 或 completion，在其执行前拿到 job ID，再以有界超时等待它
  （feature `async-submit`）
- 读取 run status
- 读取标准化 event envelopes
- 读取最终 result envelope
- 取消 queued 或 running 的 API job
- 重试 failed、canceled、interrupted 的 API job，可选异步并带 idempotency key
  （feature `async-submit`）
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
locus api runs submit --request <path|-> --json
locus api runs create --request <path|-> --json
locus api runs wait <job-id> [--timeout <milliseconds>] --json
locus api runs status <job-id> --json
locus api runs events <job-id> [--after <sequence>] [--follow] --jsonl
locus api runs result <job-id> --json
locus api runs cancel <job-id> --json
locus api runs retry <job-id> [--request <path|->] [--async] --json
locus api projects register --cwd <path> [--name <name>] --json
locus api projects status --cwd <path> --json
locus api projects unregister --cwd <path> [--force] --json
```

规则：

- JSON 命令在 stdout 输出可解析 JSON。
- event stream 每行一个 JSON object。
- diagnostics 和 validation errors 写到 stderr。
- `--request -` 表示从 stdin 读取 create、submit 或 retry request。
- `--after <sequence>` 返回 sequence 大于该值的 events。
- `create` 和（不带 `--async` 的）`retry` 是同步执行：命令会在 run 进入 terminal
  status 后返回。在带 `async-submit` 的 build 上，它们是同一进程内的一次 submit 加
  一次 wait，输出不变；见
  [Synchronous create and default retry](#synchronous-create-and-default-retry)。
- `submit`、`wait`、`retry --async` 与 `retry --request` 需要 `async-submit`
  feature。`submit` 在 run 被记录后立即返回，`wait` 是有界、只读的等待；见
  [Asynchronous Submission](#asynchronous-submission-async-submit)。
- `projects unregister` 是非破坏性操作：它只把 project 从 active registration
  移除，不删除 chats、sub-chats、worktrees、job history 或 repository files。
  永久删除 project history 只在桌面 UI 里提供。

## 最小接入流程

1. 下游应用创建或定位自己的 package directory。
2. 确保 `project.cwd` 指向 Locus 已注册的本地 project，或该 project 内的子目录。
3. 把 `artifacts.baseDir` 放在 `project.cwd` 下面。
4. 列出 runtime capabilities。
5. 用 `locus api runs create` 创建 run；或在带 `async-submit` 的 build 上用
   `locus api runs submit` 提交并保存返回的 job ID。
6. 用 job ID 读取 `status`、`events` 和 `result`（submit 之后，用
   `locus api runs wait` 等待已发布的结果）。
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
| `async-submit` | 提供 `runs submit`、`runs wait`、`runs retry --async` / `--request`、可选的 `idempotencyKey` 以及 `runs status` 的 `execution` 成员，且 `create`/`retry` 以 submit 加 wait 执行。见 [Asynchronous Submission](#asynchronous-submission-async-submit)。 |

依赖某个 feature 的 consumer 应在派发前检查 `features`，缺少该标识即视为不支持。
既有的 create request 字段不要求任何 feature。`idempotencyKey`（只被 `runs submit`
与 `runs retry --request` 接受）以及 `submit`、`wait`、`retry --async`、
`retry --request` 命令形状需要先做 `async-submit` preflight：旧 build 会以 stderr
诊断和 exit `2` 拒绝这些命令形状，但旧 build 会静默忽略发给 `runs create` 的
`idempotencyKey`，并以无幂等方式执行 job。不要假设被静默丢弃的字段已经生效。
Locus 不做 extension 协商；这项检查是 consumer 自己的 preflight。
[local-job-api-v1.schema.json](local-job-api-v1.schema.json) 中的
`discoveryFeature` enum 是封闭的：用旧版 schema 副本校验 discovery 输出的
consumer 必须刷新该副本，因为“忽略未知字段”不覆盖新的 enum 值。`async-submit`
扩展了该 enum，因此在该 feature 之前固定的副本会在 `async-submit` 处拒绝当前的
discovery 输出，直到刷新为止。

`readiness.state` 是 advisory，可取 `ready`、`needs-auth`、`unavailable`
或 `unknown`。readiness probe 失败时 discovery 仍然 exit 0 并返回完整
manifest list；该 runtime 报 `unknown`，诊断写 stderr。用
`locus api runtimes list --json --no-probe` 可以跳过 subprocess status
probe；被跳过的 probe 状态报 `unknown`，不会误报 `ready`。

`readiness` 描述的是执行 `runtimes list` 的进程的环境。在带 `async-submit` 的
build 上，由 `locus daemon run` 认领的 run 在 daemon 的环境中执行（见
[Execution context](#execution-context)），所以这里的 `ready` 不能证明 daemon 已就绪。

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

### Route summaries (`runtimes[].routes`, experimental)

包含统一 runtime route catalog 的 build 会在 `locus api runtimes list --json` 的每个
runtime 上追加可选的 `routes` 数组。该数组位于 `readiness` 之后，带或不带
`--no-probe` 都会输出：它不依赖任何 readiness probe。没有 discovery feature 标识宣告它，
也没有任何 request 字段接受其中的内容。consumer 应直接检查该成员本身。

当前 build 的 Codex 条目（省略 `label`、`description`、`capabilities` 与
`readiness`）：

```json
{
  "runtimeId": "codex",
  "routes": [
    {
      "routeId": "codex.api.policy-grant",
      "surface": "api",
      "kind": "agent",
      "executionProfile": "policy-grant",
      "adapterSource": "codex-app-server",
      "transport": "json-rpc-stdio",
      "extensions": [
        {
          "namespace": "runtime.codex.v1",
          "schemaVersion": 1,
          "maturity": "experimental",
          "schemaRef": "#/$defs/eventPayloadExtensions/properties/runtime.codex.v1"
        }
      ]
    },
    {
      "routeId": "codex.completion",
      "surface": "api",
      "kind": "completion",
      "executionProfile": null,
      "adapterSource": "locus-completion",
      "transport": "provider-http",
      "extensions": []
    },
    {
      "routeId": "codex.headless.batch",
      "surface": "api",
      "kind": "agent",
      "executionProfile": "batch",
      "adapterSource": "codex-batch",
      "transport": "process-stdio",
      "extensions": []
    }
  ]
}
```

`claude-code` 条目列出 `claude-code.completion`（`kind: "completion"`、
`adapterSource: "locus-completion"`、`transport: "provider-http"`）与
`claude-code.headless.batch`（`kind: "agent"`、`executionProfile: "batch"`、
`adapterSource: "claude-code-batch"`、`transport: "process-stdio"`），两者都是
`extensions: []`。数组顺序没有含义。

每条摘要恰好包含以下成员：

| 成员 | 含义 |
| --- | --- |
| `routeId` | 路线的描述性标签。它不是身份，也不保证跨版本稳定：不要持久化、不要跨 build 比较，也不要用它选择行为。没有 request 字段接受它。 |
| `surface` | 入口 surface。只列出 `api`。 |
| `kind` | 既有封闭的 `jobKind`：`agent` 或 `completion`。 |
| `executionProfile` | `agent` 时为既有封闭的 `executionProfile`：`batch` 或 `policy-grant`；`completion` 时为 `null`。 |
| `adapterSource` | 描述性的 adapter 标签。已知取值：`claude-code-batch`、`codex-batch`、`codex-app-server`、`locus-completion`。 |
| `transport` | 描述性的 transport 标签。已知取值：`process-stdio`、`json-rpc-stdio`、`provider-http`。 |
| `extensions` | 该路线真实 event producer 可能输出的 runtime extension namespace，每项恰好包含 `namespace`、`schemaVersion`、`maturity` 与 `schemaRef`（指向 [local-job-api-v1.schema.json](local-job-api-v1.schema.json) 的 JSON Pointer）。只有 Codex `policy-grant` 路线声明 `runtime.codex.v1`；batch 与 completion 路线声明 `[]`。声明不代表每条 event 都携带该 extension。 |

读取规则：

- 只列出 API 当前接受的 request 组合（`surface: "api"`）。protocol 路线被省略，因为
  jobs-stdio 的 `initialize` 拥有该合同；desktop 路线从不列出。
- `routeId`、`surface`、`adapterSource` 与 `transport` 是开放词表。上面的已知取值并不
  穷尽：遇到不认识的值也要接受。`kind` 与 `executionProfile` 复用 request 合同中的
  封闭定义。
- 不要按 `adapterSource` 或 `transport` 分支。根据 `features`、`capabilities` 与
  request 合同决定发送什么；Locus 仍按 request（`runtime.id`、`kind`、
  `runtime.executionProfile`）选择 adapter，与以前完全相同。
- 路线摘要是描述，不是授权。它不授予执行权，不覆盖 `capabilities` 或 `readiness`，
  不授权 native extension，也不是 endpoint。所有 request 校验、capability gate、权限
  检查与 claim-time 检查照常执行，也不存在按路线执行的命令。
- advisory readiness 不是 daemon readiness。列出某条路线不说明该 runtime 已就绪；与
  `readiness` 一样，它描述的是执行 `runtimes list` 的进程，而不是 `locus daemon run`
  executor。
- 缺少 `routes` 成员只表示该 build 不描述自己的路线，绝不表示 `async-submit`、
  `completion`、`policy-grant` 或其他既有 feature 不受支持；继续按 `features` 与
  request 合同调用。

兼容性：

- 遵循 [稳定性合同](#稳定性合同) 中“只依赖本手册列出的 v1 字段，并忽略未知 JSON 字段”
  规则的 reader 无需修改。这条已发布规则是 Locus 将该成员归类为 additive 变化的前提
  （interoperability contract C7 §9.2）。
- schema 以 `runtimeRouteSummary` 与 `runtimeRouteExtension` 定义各项，两者都是
  `additionalProperties: false` 且键集精确。在该 block 之前固定的
  [local-job-api-v1.schema.json](local-job-api-v1.schema.json) 副本会把 `routes`
  当作未知 runtime 成员接受；但包含这些定义的副本会拒绝其中未列出的任何 route 或
  extension 成员。与上文封闭的 `discoveryFeature` enum 一样，“忽略未知字段”不覆盖
  封闭对象中的成员：该 block 每次变化都要刷新固定副本。
- schema 同时强制 `kind` 与 `executionProfile` 的联动：`completion` 摘要必须是
  `executionProfile: null`，`agent` 摘要必须是 `batch` 或 `policy-grant`。
- 由于该 block 是 experimental，Locus 可能改变它的键集。route 摘要或 extension 声明
  的任何新增、删除或重命名成员都是新的兼容性决定（interoperability contract C7 #2 与
  #10），并会在这里记录；开放词表规则只覆盖新取值，从不覆盖新成员。

#### 升级检查清单（`runtimes[].routes`）

1. 无需修改。忽略未知字段的 reader 继续可用。
2. 如果用本地固定的 `local-job-api-v1.schema.json` 校验 discovery 输出，刷新该副本；
   该 experimental block 以后每次变化都要再次刷新。
3. 接受 `routeId`、`surface`、`adapterSource` 与 `transport` 的未知取值；不要持久化
   `routeId`，也不要按 `adapterSource` 或 `transport` 分支。
4. 把缺少 `routes` 成员理解为“未描述”，不是缺少 feature。
5. 不要把列出的路线当作已就绪、已授权或可执行。

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

run 的 artifact owner 也会准入 native artifact 候选。Codex app-server run
（`runtime.executionProfile: "policy-grant"`）把生成图片的路径
（`imageGeneration.savedPath`）、已完成文件改动的路径以及该 turn 的累计 diff
作为候选上报。runtime 自己从不创建 artifact，Locus 也不会授予 run 目录之外的
文件系统访问：

- 只有位于本 run 目录内的稳定普通文件才会被准入。准入条目的 role 为
  `native-image`、`native-file` 或 `native-diff`，并带常规的 `path`、`sha256`、
  `contentType`、`sizeBytes`。
- Locus 把该 turn 最终的 diff 写入 run 目录，文件名为 `native-diff-<n>.patch`，
  然后准入。含有精确 secret 的 diff 内容不会被写入。
- 其余候选都变成 `status` 记录：`subtype: "artifact_admission"`、
  `result: "rejected"`、候选的 `role`，`reason` 为 `missing`、`out_of_scope`、
  `ownership_mismatch`、`digest_mismatch` 或 `redaction_unsafe`。该记录从不包含
  路径或内容。因此工作区改动和保存在 run 目录之外的图片会以 `out_of_scope`
  被拒绝。
- 准入条目的 `artifact_created` 排在 run 的 `completed` 之前。最终的
  `result.json`、`artifacts.json` 和 result 信封在 Locus run-dir 文件之后列出准入
  条目。
- `runs result` 只列出 run 的账本已登记 digest 的条目，所以为尚未提交的终态
  准备的文件永远不会被列出。

batch 模式的 Codex 与 Claude run、completion run，以及没有 `artifacts.baseDir`
的 run 不会提交 native 候选。未知 role 按新增处理。

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

在带 `async-submit` 的 build 上，`create` 是同一进程内的一次 `runs submit` 加一次
`runs wait`，正常终态输出与这个 envelope 逐字节相同。`create` 拒绝
`idempotencyKey`；见 [Idempotency](#idempotency)。

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

在带 `async-submit` 的 build 上，`queued` 或 `running` 的 API job 的 status 还带一个
建议性的 `execution` 对象；终态 job 不带。见
[Executor availability](#executor-availability)。

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
  message?, lossPossible?, exitCode?, errorCode?, errorMessage?, result?}`。
  `exitCode`、`errorCode`、`errorMessage` 和 `result` 含义与此前相同（run 的
  exit code、错误码、已脱敏的错误信息和公开 result，与 `runs status` /
  `runs result` 报告的值一致）。它们可为 `null`：没有该值的结算携带 `null`，
  绝不编造（例如排队中取消的 `result`，或 worker 恢复的 `exitCode` 与 `result`）。
  `result` 不含 Locus 内部成员（例如已登记的 artifact refs）。
  这四个成员与基础 job envelope 字段处于同一稳定性层级：可选、可为 `null`、
  增量添加。不要依赖其中任何一个必然存在，接受 `null`，并忽略不认识的成员。
- **`status` 记录变多。** 每条已提交记录都在原始 sequence 上投影一次（见
  [Events](#events)）。请用 `--after` 分页。
- **脱敏标记。** 在持久化记录、events、`events.jsonl`、`result.json` 和
  diagnostics 中，被脱敏规则（敏感键和已知凭据模式）移除的值写作 `<redacted>`，
  已配置的精确密钥提示（例如为该 run 登记的 provider 凭据）写作 `<mask>`。此前
  store 对部分模式还会写 `[redacted]`、`[redacted-jwt]` 或 `[redacted-pem]`。请把
  所有标记都当作不透明文本，不要解析。
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
| runtime 成功且记录了输出 | `{"status":"succeeded","evidenceKeys":["policy:no-recorded-denial","record:5","postrun:security-cleanup-ok"],"exitCode":0,"errorCode":null,"errorMessage":null,"result":{...}}` | `[]` | `0` |
| 可重试 `error`（`willRetry: true`）之后成功并有输出 | `{"status":"succeeded",...,"exitCode":0,"errorCode":null,"errorMessage":null,"result":{...}}` | `[]` | `0` |
| runtime 报告成功，但有权限请求被拒绝 | `{"status":"failed","reasons":["policy_denied"],"evidenceKeys":["record:4",...],"exitCode":1,"errorCode":"policy_denied","errorMessage":"Run outcome failed: policy_denied.","result":{...}}` | `[{"code":"policy_denied","message":"Run outcome failed: policy_denied."}]` | `1` |
| runtime 报告成功但没有输出 | `{"status":"failed","reasons":["output_empty","output_evidence_missing"],...,"exitCode":1,"errorCode":"output_empty",...}` | `[{"code":"output_empty",...}]` | `1` |
| Codex app-server transport 在终态前退出 | `{"status":"interrupted","reasons":["transport_exit"],"evidenceKeys":[],"synthetic":{"source":"transport_exit","transportId":"t1","exitCode":2,"signal":null},"exitCode":1,"errorCode":"transport_exit",...}` | 视 runtime 而定 | `1` |
| 运行中请求 cancel | `{"status":"canceled","reasons":["cancel_requested"],...,"synthetic":{"source":"cancel"},"exitCode":5,"errorCode":"job_canceled","errorMessage":"Job was canceled.",...}` | `[{"code":"job_canceled","message":"Job was canceled."}]` | `5` |
| 已确认 worker 丢失（之后用 `runs status` / `runs result` 读取） | `{"status":"interrupted","reasons":["worker_stopped"],...,"synthetic":{"source":"recovery"},"recovery":{"confidence":"confirmed","basis":"worker_process_absent","observedAt":"..."},"exitCode":null,"errorCode":"worker_interrupted","errorMessage":"Worker stopped before the job finished.","result":null}` | `[{"code":"worker_interrupted",...}]` | 不适用 |

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
- 顶层 `exitCode` 是 run 的 Locus exit code（即 create/retry exit 列；结算没有该值
  时为 `null`，例如 worker 恢复）。`synthetic.exitCode` 是已结束的 runtime
  transport 进程的 exit code；两者可以不同。
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
| `artifact_admission` | 被拒绝的 native artifact 候选，带其 `role` 与 `reason`。见 [Artifact Contract](#artifact-contract)。 |
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
3. 把 `completed.payload.exitCode`、`errorCode`、`errorMessage` 和 `result`
   视为可选、可为 `null`；`runs result` 和命令 exit code 仍是权威的 outcome 读取
   方式。
4. 此前报告成功、但被拒绝、输出无效或输出为空的 run，现在预期为 `failed` 与
   exit `1`。
5. 用 `--after` 分页读取 events；忽略未知 `status` subtype 和未知 extension 命名空间。
6. 把 `<redacted>` 和 `<mask>` 当作不透明文本。

## Asynchronous Submission (`async-submit`)

`features` 含 `async-submit` 的 build 可以不等 run 执行就接收它、立即返回 job ID，
并让 consumer 按该 ID 等待、观察、取消或重试。wire version 仍是
`locus.local-job.v1`。12 种 event type、六字段 event envelope、`runs result`、
artifact 文件、`--after`/`--follow` 以及 exit `0`–`8` 的含义都不变。唯一新增的
exit code 是 `9`，且只有 `runs wait` 会返回它。

### Submit

```bash
locus api runs submit --request <path|-> --json
```

request 就是 agent 或 completion 的 create request（见
[Agent Create Request](#agent-create-request) 与
[Completion Create Request](#completion-create-request)），另可带一个可选的顶层
`idempotencyKey`（见 [Idempotency](#idempotency)）。所有 create 校验以及
project、capability、profile、provider、secret 检查都先执行，失败时的 error、
输出流和 exit 与 `create` 相同。被拒绝的 request 不会启动任何 provider work。

新提交成功时输出一行，exit `0`：

```json
{"apiVersion":"locus.local-job.v1","job":{"id":"job-A","status":"queued"}}
```

（`job` 是完整的 serialized job，此处有删节。）

- 这个确认表示 run 已持久记录且可被认领：它的 `job_created` event 已提交；带
  `artifacts.baseDir` 的 run，其 run directory 与初始文件也已完成 admission。
  它不表示 run 已经开始。
- `job.status` 是 admission 时的快照。另一个进程可能在你读到 stdout 之前就认领了
  该 run，此时 `runs status` 会报告 `running`。
- 确认不需要 executor。提交后的 run 在被 executor 认领时执行：正在运行的
  `locus daemon run`（前台运行，由用户或 consumer 启动），或 `runs create` /
  `runs retry` 命令为自己的 run 启动的进程内 executor。没有 executor 时它保持
  `queued`，`runs status` 和 `runs wait` 会如实报告。
- 提交进程退出不会取消该 run。请按 ID 取消。
- 响应不含 `result`。

### Wait

```bash
locus api runs wait <job-id> [--timeout <milliseconds>] --json
```

`runs wait` 只读取一个 API job，从不改变它：不结算、不取消、不重试、不延长任何
期限。与所有 `locus api` 命令一样，它会先执行 Locus 既有的 stale worker
recovery，该步骤可能结算一个已被 Locus 确认停止的 worker 所属的 run。

- `--timeout` 默认 `30000` ms，接受 `0` 到 `86400000`（24 h）的整数。`0` 只做
  一次观察。
- run 在其 `completed` event 已提交、且该提交登记的每个终态文件都已发布并通过校验
  （digest 与 size）时就绪。没有终态文件的 run 在 `completed` 提交后即就绪。
- 就绪时的输出与 `create` 的 envelope `{apiVersion, job, result}` 完全相同，
  exit code 是 run 的 outcome exit（`0`–`8`）。`result.artifacts` 按顺序列出该
  提交的终态文件。
- 截止时 run 仍未就绪，`wait` 输出一个 timeout envelope 并 exit `9`。截止时刻
  最后一次读取若已就绪，则以就绪结果为准。

```json
{"apiVersion":"locus.local-job.v1","job":{"id":"job-A","status":"queued"},"wait":{"state":"timeout","timeoutMs":30000,"reason":"executor_unavailable"}}
```

exit `9` 不是 run outcome：没有 `result`，run 也没有变化。可以再次 `wait`，或读取
`status`。

| `job.status` | 观察 | `wait.reason` |
| --- | --- | --- |
| `queued` | 初始 admission 未提交（最先检查） | `admission_incomplete` |
| `queued` | 有可用 executor | `run_pending` |
| `queued` | 没有 executor | `executor_unavailable` |
| `queued` | executor 状态未知 | `executor_unknown` |
| `running` | 任意 | `run_pending` |
| terminal | 某个已登记的终态文件缺失或不匹配 | `terminal_artifacts_pending` |

`terminal_artifacts_pending` 会保留真实的终态 `job.status`。它覆盖发布尚未完成或
发布失败的情况，也覆盖已发布文件之后被删除或修改的情况：`wait` 无法区分这些情况，
会再次报告未就绪。`runs result` 和 `runs events --follow` 不变，不是发布屏障；只有
`wait` 检查文件。

| 情况 | 输出 | Exit |
| --- | --- | --- |
| 未知 ID，或不是 API job 的 ID | stderr `Unknown job: <id>` | `3` |
| `--timeout` 无效 | stderr `Invalid timeout: expected an integer from 0 to 86400000 milliseconds.` | `2` |
| 已读到 job 之后 store 读取失败 | stdout `{"apiVersion":"locus.local-job.v1","job":{…},"wait":{"state":"error","reason":"observation_failed"}}` | `8` |
| 读到 job 之前 store 读取失败 | stderr `Failed to observe job: <id>` | `8` |

stderr 行是纯文本加换行，不是 JSON。`runs status` 对未知 ID 与非 API ID 保留原有
错误（`Unknown API job: <id>` 与 `Job <id> is not an API job`，exit `3`）；两个
命令的消息不承诺一致。

### Executor availability

对 `queued` 或 `running` 的 API job，`runs status` 会附加一个 `execution` 对象。
终态 job 以及其他所有 envelope 都不带它。

```json
{"apiVersion":"locus.local-job.v1","job":{"id":"job-A","status":"queued"},"execution":{"state":"unavailable","reason":"no_executor","observedAt":"2026-10-01T00:00:00.000Z","hint":"locus daemon run"}}
```

| `state` | `reason` | 何时 |
| --- | --- | --- |
| `unknown` | `admission_incomplete` | queued run 的初始 admission 未提交。不带 hint。 |
| `available` | `executor_observed` | queued run，且同一 profile 的 `locus daemon run` 存活并有新鲜心跳；running run 自己记录的 worker 在 120 s recovery 心跳窗口内被确认存活。 |
| `unavailable` | `no_executor` | 没有 daemon lock，或其进程已不存在；running run 的 worker 进程已不存在。带 `hint: "locus daemon run"`。 |
| `unknown` | `probe_unavailable` | lock 过期、为旧格式或无法读取，进程无法探测，或心跳不可信。 |

- `execution` 只是建议性信息。它不是 runtime readiness（`runtimes list`），不会
  启动 daemon，读取它也不会改变任何东西。
- 它从不包含 PID、nonce、hostname、lock 路径或 secret。既有的 `job.workerId` 与
  `job.workerPid` 指向实际认领该 run 的进程：daemon 认领时是 daemon，`create` /
  `retry` 命令自己执行时是调用方进程。不要向 `workerPid` 发信号，请用
  `runs cancel`。`workerId` 是不透明字符串，其格式在本版本中有变化：现在带有
  每次认领唯一的一段（`<kind>:<pid>:<ms>:<unique>:<jobId>`，以前是
  `<kind>:<pid>:<ms>:<jobId>`）。不要解析它。
- daemon 按 daemon job、schedule job、API run 的顺序填充 slot。持续的 daemon 或
  schedule 工作会推迟 API run；没有优先级调度器。

### Synchronous create and default retry

在带 `async-submit` 的 build 上，`runs create` 和不带 `--async` 的
`runs retry <job-id>` 是同一进程内的一次 submit 加一次 wait：

1. request 与 `runs submit` 完全相同地完成 admission（不带 key）。
2. 命令在进程内执行自己 admitted 的 run，使用与 `locus daemon run` 相同的
   executor，并限定只处理这一个 run。不需要 daemon，也不会触碰其他排队的 run。
3. 等待终态并输出。

正常 run 的 stdout（含末尾换行）和 exit code 与 `async-submit` 之前逐字节相同。
内部等待没有会泄漏出来的截止时间：`create` 与 `retry` 从不 exit `9`，也从不输出
timeout envelope。

**daemon 先认领的 run。** 如果同一 profile 的 `locus daemon run` 先于命令认领了
run，命令不会再执行一次，只等待 daemon 的结果。此时：

- run 在 daemon 的环境而非调用方环境中执行（见
  [Execution context](#execution-context)），`job.workerId` / `job.workerPid`
  指向 daemon。
- run 在排队中、或其 worker 存活未被确认时连续 30 s 没有进展，命令输出
  `{"apiVersion":"locus.local-job.v1","job":{…},"wait":{"state":"error","reason":"executor_unavailable"}}`
  并 exit `8`。没有观察到 executor 时 reason 为 `executor_unavailable`，否则为
  `executor_unknown`。已提交的 event、心跳变化，或 worker 在 120 s recovery
  心跳窗口内被确认存活，都算作进展，因此长时间运行（包括 45 s 的 completion
  调用）不会被截断。
- daemon 已提交终态、但 30 s 后文件仍未发布时，命令输出同样的 envelope，
  `"reason":"terminal_artifacts_pending"`，并 exit `8`。
- store 读取失败时输出同样的 envelope，`"reason":"observation_failed"`，并 exit `8`。

这个 `wait.state: "error"` envelope 带 job ID、不带 `result`；它不是 run 的
outcome。请读取 `runs status` 或 `runs result`、调用 `runs wait`，或按 ID 取消。

保持原样的失败行为：

- 进程内 executor 完成了 run、但终态文件发布失败时，命令仍输出终态 envelope，
  `result.artifacts: []`，exit 为 run 的 outcome exit。对同一 run 执行
  `runs wait` 会报告 `terminal_artifacts_pending` 并 exit `9`。
- 进程内 executor 出现不属于 run outcome 的故障，或命令等待自己的进程内 run 时
  store 读取失败，会停止它自己的执行树，并保留原有的 stderr 文本与 exit
  （`create`：`2`，消息含 "unsupported" 时为 `3`；`retry`：`3`），stdout 不输出
  任何内容。已 admitted 但未开始的 run 会被取消；被停止的 run 在 store 允许时结算为
  `canceled`。不会伪造终态 envelope。上面的 `observation_failed` envelope 仅用于由
  其他进程执行的 run。

#### Execution context

run 在认领它的进程的环境中执行。命令自己的 executor 认领时，那就是调用方环境，
与以前相同。`locus daemon run` 认领时，runtime 子进程使用 daemon 的环境：各
runtime adapter 允许的 native-home 变量（例如 POSIX 上的 `HOME`、`CODEX_HOME`、
`CLAUDE_CONFIG_DIR`；Windows 上的 `USERPROFILE`、`APPDATA`、`LOCALAPPDATA`）以及
`PATH` 系列变量来自 daemon，proxy 变量只在该 adapter 转发时才随之迁移。因此原生
凭据及其可用性跟随 daemon。两条路径的 secret 剥离不变，调用方环境的快照不会被
存储或传递。对传给 `locus` 的环境做最小化处理的 consumer 并不能控制 daemon 的
环境。`runtimes list` 的 readiness 反映的是 CLI 进程的环境，不能证明 daemon 已就绪。

#### Aborting a waiting command

命令在进程内执行自己的 run 时，Bun 测试证明杀掉命令的进程树会停止 runtime
子进程，stdin EOF 不会取消它。Windows 信号退出码为推断；Electron packaged
own-pump 信号基线尚未验证（见下方平台限制）。

daemon 认领了 run 时，等待中的命令退出后 daemon 仍会继续执行。为此，命令会在
可捕获的中止时转发对自己 run（且仅限自己的 run）的取消。转发在 run admission
之前就已 armed，并保持到命令报告结果为止，因此这段时间内的可捕获中止要么被转发，
要么以默认处置结束命令。转发一直持续到命令自己的 executor 认领该 run：

- 命令仍在 arm 转发、admission 尚未开始时到达的中止不会 admit 任何 run：信号以
  其默认处置结束命令。
- admission 进行中捕获的中止会被暂存，直到命令拿到 run 的 ID，然后按下一条处理。
  admission 失败时没有可取消的 run：暂存的信号以该信号的默认处置结束命令，暂存的
  stdin EOF 被忽略。
- 尚无任何 executor 认领时，可捕获的中止会取消这个 queued run（结算为
  `canceled`，从不启动），命令也不会再执行它。
- 另一执行者（daemon）先认领时，可捕获的中止会为该 run 持久化 cancel request。
- 命令自己的 executor 认领后，适用上面的进程内行为：可捕获的信号以其默认处置结束
  命令，stdin EOF 被忽略。命令写出结果之前会先让已捕获的信号生效，因此即使 run 在
  命令处理该信号之前就已结束（或其认领未通过 claim-time 检查），信号也不会被吞掉：
  命令以该信号结束（Windows 上为下文的退出码）、stdout 为空，run 保持它已到达的
  终态。
- 同步的带 key `runs retry <job-id> --request <path>` 若 replay 了同 key 早先请求的
  run，它并不拥有该 run，因此不转发任何取消：可捕获的信号以默认处置结束等待中的
  命令，stdin EOF 被忽略，run 继续执行。需要时请按 ID 取消。

| 平台 | 转发（可捕获） | 不转发 |
| --- | --- | --- |
| POSIX | `SIGINT`、`SIGTERM`、`SIGHUP`、已 armed 的 stdin EOF | `SIGKILL` |
| Windows | Ctrl+C（`SIGINT`）、Ctrl+Break（`SIGBREAK`）、console 窗口关闭（`SIGHUP`）、已 armed 的 stdin EOF | 父进程 `child.kill()` / `TerminateProcess`；logoff 与 shutdown console 事件 |

- 转发中止时，命令先持久化 cancel request，最多等待 5 s 让 run 进入终态，不向
  stdout 写任何内容，然后重新抛出原信号（让 POSIX 父进程看到该信号），stdin EOF
  时则 exit `8`。
- Windows 没有 signal exit status。转发 Ctrl+C 后命令以 exit `1` 结束（由 Node
  终止进程）；转发 Ctrl+Break 或 console 关闭后 exit `8`。只要已 armed 的转发以
  信号的默认处置结束命令，退出码也是这样：命令自己的 executor 认领之后、带 key 的
  replay waiter、admission 失败之后以及 admission 之前。没有转发的进程则会以
  `STATUS_CONTROL_C_EXIT`（`0xC000013A`）结束。这些 Windows 退出码是根据 Node 与
  libuv 的行为推断的，尚未在 Windows 主机上验证。
- Windows 父进程如需 graceful stop，可对以 `CREATE_NEW_PROCESS_GROUP` 启动的命令
  发送 Ctrl+Break（`GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, pid)`）；Windows 会在
  这种进程组中禁用 Ctrl+C。没有 console 的进程收不到任何 console 事件。console
  窗口关闭后，Windows 会在系统定义的短暂宽限后结束进程，可能截短 5 s 的确认等待。
- 只有在命令 arm 转发时 stdin 仍是打开的 pipe、之后才关闭，stdin EOF 才会 armed。
  命令启动时已经关闭的 stdin 不会 arm EOF 转发，例如 Node 不带 `input` 的
  `execFileSync` 或 `spawnSync`，或父进程在 spawn 后立即结束子进程的 stdin。被忽略
  的 stdin，以及结束 `--request -` 正文的 EOF，同样不会触发取消。通过 stdin 发送
  request 的 consumer 仍可用信号或按 ID 取消。
- 信号之后很快跟上的 kill（例如在 `SIGKILL` 前只给 500 ms）会截短 5 s 的确认等待。
  cancel request 通常在此之前已经持久化，但 hard kill 之后不保证送达。
- `SIGKILL`，以及 Windows 上的 `TerminateProcess`、Node 的 `child.kill()` 和
  logoff/shutdown console 事件，都无法捕获，因此无法转发：daemon 中的 run 会继续
  执行，且仍可查询；尚无 executor 认领的 run 保持 queued，直到 daemon 认领或按 ID
  取消。

`runs cancel <job-id>` 是唯一在所有平台都可靠的取消方式。请保存 job ID：需要可靠
取消时（尤其在 Windows 上），使用 `runs submit`，它会在 run 执行前输出 ID。

### Idempotency

`runs submit` 和 `runs retry <job-id> --request <path|->` 接受可选的
`idempotencyKey`，其他命令都不接受。`runs create` 带 `idempotencyKey` 时输出

```json
{"apiVersion":"locus.local-job.v1","error":{"code":"idempotency_key_not_supported","message":"idempotencyKey is not accepted by runs create; use runs submit."}}
```

exit `2`，不执行任何东西。`async-submit` 之前的 build 会在 `create` 上静默忽略
该字段，并以无幂等的方式执行 job，所以请先检查 feature，且只把 key 发给 `submit`
和 `retry --request`。

key 规则：

- 1–160 个 `[A-Za-z0-9._:-]` ASCII 字符，大小写敏感，从不 trim。
- 作用域是规范化后的 `consumer.id`：同一个 key 在两个 consumer 下指向两个不同的
  run。`consumer.id` 是归属标识，不是认证。
- 看起来像 secret 的 key 以 `secret_in_request` 拒绝，即使它同时违反字符规则。
  带 key 的 request 若其 `consumer.id` 会被 Locus 的 secret redaction 改写，也以
  同样方式拒绝。两种错误都不回显 key。
- Locus 只存储 key 的 domain-separated hash。原始 key 从不出现在 store、
  `request.json`、events、result、diagnostics 或日志中。hash 不是加密：不要把
  secret 放进 key。

**同一 key、同一 request。** request 在规范化默认值、runtime 别名、canonical
路径与对象 key 顺序之后比较；key 本身、wait/async 选择以及生成的 ID 不参与比较。
Locus 返回保留的 run，而不是再创建一个，也不会产生新的 provider work：

```json
{"apiVersion":"locus.local-job.v1","idempotentReplay":true,"job":{"id":"job-A","status":"running"}}
```

重放的 `job` 是其当前状态（`queued`、`running` 或终态）。不带 `--async` 的带 key
`runs retry --request` 则输出所保留子 run 的终态 envelope。只有带 key 的重放才带
`idempotentReplay`。

**同一 key、不同 request。** stdout `idempotency_conflict`，exit `2`，不创建任何
东西。submit 与 retry 之间、针对不同源 job 的 retry 之间，都不会互相重放。

**Retry 正文。** `runs retry <job-id> --request <path|->` 读取：

```json
{"apiVersion":"locus.local-job.v1","consumer":{"id":"docs-workbench"},"idempotencyKey":"retry-1"}
```

它只接受 `apiVersion`、`consumer.id` 和 `idempotencyKey`；其他成员是 stderr
校验错误，exit `2`。`consumer.id` 必须与源 job 的 consumer 一致，否则在查 key
之前就返回 stdout `consumer_mismatch`，exit `2`。不带 `--request` 的
`runs retry <job-id>` 仍使用源 job 保存的 consumer 与输入。

**待定提交。** 带 key 的提交已记录、但其 creation 或初始 admission 从未提交（崩溃，
或另一个进程仍在提交中）时，同一 key 返回

```json
{"apiVersion":"locus.local-job.v1","error":{"code":"submission_pending","message":"Submission is not yet admitted; retry the same key.","retryable":true}}
```

并 exit `8`。用同一 key 重试是安全的，永远不会创建第二个 run，但 `retryable`
不承诺该状态一定会解除。崩溃的提交者留下的 attempt 会一直待定，直到后续 Locus
修复（TICKET-128）；Locus 也无法把它与仍在工作的提交者区分开。换新 key 是明确的
补救手段；如果原提交者其实仍然存活，可能产生重复工作。如果你已经拿到 job ID，
`runs cancel <job-id>` 可以结算它。

**保留期。** key 与其 run 的绑定至少保留到 run 的终态文件发布并校验通过后 30 天；
run 没有登记终态文件时（无 artifact 的 run、recovery、admission 前取消、claim-time
检查失败）则从终态结算起算。过期的 key 会在同一 consumer 每次 `submit`、`create`
或 `retry` 之前，以及 daemon 每次循环时被清理；此后同一 key 会创建新的 run。run
从未到达已校验终态（仍在运行、发布失败或待定提交）的 key 不会自动过期。读取或重放
从不延长保留期。保留期只针对 key 绑定；job、events 与文件都会保留。

新增的 request 错误：

| 情况 | 输出流 | Exit | `error.code` |
| --- | --- | --- | --- |
| `runs create` 带 `idempotencyKey` | stdout | `2` | `idempotency_key_not_supported` |
| key 已绑定到不同的 request | stdout | `2` | `idempotency_conflict` |
| retry 的 `consumer.id` 与源 job 不一致 | stdout | `2` | `consumer_mismatch` |
| key 格式错误 | stdout | `2` | `invalid_idempotency_key` |
| 像 secret 的 key，或会被 redaction 改写的带 key `consumer.id` | stdout | `2` | `secret_in_request` |
| 带 key 的提交已记录但未完成 admission | stdout | `8` | `submission_pending`（带 `"retryable":true`） |

每个错误都是一行 stdout：`{"apiVersion":"locus.local-job.v1","error":{"code":…,"message":…}}`，
属于 request 错误，不是 run status。其他错误保持原有的结构、输出流与 exit。

`runs submit` 或 `runs retry <job-id> --request` 的正文不是合法 JSON 时，stderr
输出 `Invalid JSON request` 一行，exit `2`。该行从不引用 request 内容，所以格式错误
正文里的 key 不会被回显。`runs create` 保持以前的诊断，其中包含 JSON parser 的消息。

### Claim-time checks

提交后的 run 可能在队列中等待。在任何 provider 调用或子进程启动之前，认领 API run
的 executor 会重新检查其 admission。检查失败时 run 结算为 `failed`，不会执行：

| `completed.payload.reasons` 条目 | `job.errorCode` | Exit（`create`、默认 `retry`、`wait`） |
| --- | --- | --- |
| `project_unregistered` | `project_unregistered` | `7` |
| `cwd_identity_changed`：cwd 被替换、移动，或不再与记录的身份一致 | `cwd_identity_changed` | `7` |
| `execution_profile_invalid`：保存的 capability、profile 或 policy grant，或显式 provider profile 不再有效 | 有 provider-binding code 时用该 code，否则 `execution_profile_invalid` | binding 不可用 `4`、request 无效 `2`、local-only 阻止 `6`；否则 `3` |
| `queued_age_exceeded`：排队已达 24 h 或更久 | `queued_age_exceeded` | `1` |
| `artifact_admission_mismatch`：已 admitted 的 run directory 或其初始文件被改动 | `artifact_admission_mismatch` | `1` |
| `claim_gate_failed`：检查本身意外失败时的内部兜底 | `internal_error` | `8` |

- 最大排队时长为从 `createdAt` 起 24 h，不可配置。运行中的 daemon 也会在不认领的
  情况下结算已达该时长的 admitted API run，按最旧优先、每次循环数量有上限。没有
  daemon 时，超龄 run 在 executor 尝试认领它时结算。
- 多项检查同时失败时，报告的 code 取决于由哪一步结算该 run。daemon 的超龄结算
  只检查时长，而认领时先检查 project、cwd 与 profile，再检查时长。因此项目已撤销
  登记的超龄 run 由 daemon 的超龄结算处理时为 `queued_age_exceeded` / `1`，由认领
  先处理时为 `project_unregistered` / `7`。daemon 在每次循环中先执行超龄结算、再认领
  queued run，所以在一次循环开始时已经超龄的 run 会从该 daemon 得到
  `queued_age_exceeded`，除非该 run 超出本轮 16 条结算上限，或 daemon 已报告无法
  结算并排除之。
- 这些结算不登记终态文件：`result.artifacts` 为 `[]`，`wait` 立即就绪。
- 公开承诺是 `job.errorCode` 与 exit code。`completed.payload.reasons` 的取值
  仍是信息性的，与以前相同。没有新增 exit code，`0`–`8` 含义不变。
- completion run 没有 project、cwd 或 run directory，因此只适用 profile、时长与
  内部检查。
- 新 run 的 run directory 或初始 admission 在其 creation 已提交之后失败时，命令仍
  像以前一样报告错误，而该 attempt 会作为 `failed` job 保留，`job.errorCode` 为
  `artifact_admission_failed`。用于它的 key 仍绑定在该 job 上。

#### Admission failure after creation

这同样适用于旧的 request 形态。run directory 现在在 job 的 creation 提交之后创建
（这样只有已提交的 run 才会得到确认），而不是之前：

- 带 artifacts 的 `runs create` 与 `runs retry <job-id>`：run directory 或初始
  artifact admission 失败时，stderr 与 exit 与以前相同，但现在会留下一个
  `job.errorCode` 为 `artifact_admission_failed` 的 `failed` job（经 `runs wait`
  为 exit `1`）。旧版在 mkdir 失败时不留下 job；该比较不涵盖 mkdir 后的 initial admission 失败。`runs list`、`runs status` 与 Workbench 都会显示它。
- 带 key 的 `runs submit`：该 key 在保留期内绑定到这个失败的 attempt；重新提交会以
  `idempotentReplay: true` 重放该失败 job。新的尝试请用新 key。
- `runs retry <job-id>` 先检查源 run 的状态，再创建 run directory；旧版先创建目录。
- 在 Windows 上，run directory 后端落地前（TICKET-127），每个带 `artifacts.baseDir`
  的 run 都会这样失败，因此每次尝试都会留下这样的 job。

### Cancel, recovery and terminal files

- 取消一个初始 admission 已提交的 queued run，会像正常结束的 run 一样发布其终态
  文件（`result.json`、刷新后的 `events.jsonl` 与 `artifacts.json`），
  `result.artifacts` 会列出它们。
- 取消一个没有 run directory、或初始 admission 从未提交的 queued run，不登记终态
  文件：`result.artifacts` 为 `[]`。已知 ID、卡在 `admission_incomplete` 的 run
  可以这样补救。
- worker 停止后被 Locus 恢复为 `interrupted` 的 run 同样不登记新的终态文件：
  `result.artifacts` 为 `[]`，初始文件作为历史保留。

### 已知限制

- creation 与终态发布尚未完全原子化（TICKET-128）。崩溃可能留下待定提交、staged
  文件或部分发布的终态；`wait` 会把这类 run 报告为未就绪，而不是虚构结果。
- 在 Windows 上，带 `artifacts.baseDir` 的 run 会 fail closed，直到 run directory
  后端落地（TICKET-127），且每次这样的尝试都会留下 `job.errorCode` 为
  `artifact_admission_failed` 的 `failed` job。
- 没有 HTTP 或 socket server，没有优先级调度，也没有后台 daemon 启动器：
  `locus daemon run` 由用户或 consumer 启动。
- 让旧版 Locus build（CLI 或 daemon）与 `async-submit` build 共用同一 profile 不受
  支持：旧 build 不理解 key reservation 与待定提交，技术上也没有任何东西阻止它。
  升级前先停止旧进程；回滚时使用单独的 profile。

### 异步流程示例

```bash
OUT="$(locus api runs submit --request "$PACKAGE_DIR/request.json" --json)" || exit $?
JOB="$(printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{console.log(JSON.parse(s).job.id)})')"
locus api runs wait "$JOB" --timeout 600000 --json
case $? in
  9) echo "not ready yet; wait again or read status" ;;
esac
```

### 升级检查清单（`async-submit`）

1. 使用 `submit`、`wait`、`retry --async`、`retry --request` 或 `idempotencyKey`
   之前，先检查 `features` 是否含 `async-submit`。旧 build 会以 exit `2` 拒绝新
   命令形状，但会忽略发给 `create` 的 key。
2. 刷新本地固定的 `local-job-api-v1.schema.json` 副本：`discoveryFeature` 现在包含
   `async-submit`。使用 JSON Schema 2020-12 校验器；completion 请求成员现位于
   `completionRequestMembers`，`completionCreateRequest` / `completionSubmitRequest`
   经 `allOf` + `unevaluatedProperties: false` 从该定义派生。
3. 不要把 `idempotencyKey` 发给 `runs create`。
4. 把 `runs wait` 的 exit `9` 当作“尚未就绪”，而不是 run 失败。
5. 处理 `submission_pending`（exit `8`，`"retryable":true`）：用同一 key 重试，或
   接受换新 key 的重复风险。
6. 把 `create`、`retry` 或 `wait` 输出的 `wait.state: "error"` envelope（exit `8`）
   当作观察问题；run 的 ID 在 `job.id` 中。
7. 预期由 `locus daemon run` 认领的 run 使用 daemon 的环境与凭据。
8. 保存 job ID 并按 ID 取消；中止转发不覆盖 hard kill。
9. 把 claim-time 的 `job.errorCode` 映射到你现有的 exit code 处理上；它们使用既有的
   exit code。

## Cancel

```bash
locus api runs cancel <job-id> --json
```

Cancel 只作用于 API jobs。queued API job 会立即完成为 `canceled`。running job 会收到
持久化 cancel request，由 runtime runner 观察并处理。

在带 `async-submit` 的 build 上，取消一个初始 admission 已提交的 queued run 会发布其
终态文件；见 [Cancel, recovery and terminal files](#cancel-recovery-and-terminal-files)。
对 daemon 认领的 run，`runs cancel` 是唯一在所有平台都可靠的取消方式。

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

在带 `async-submit` 的 build 上：

```bash
locus api runs retry <job-id> [--request <path|->] [--async] --json
```

- `--async` 像 `runs submit` 一样返回新 job 的 admission envelope，不等待。用新的
  job ID 调用 `runs wait`。
- `--request` 传入 retry 正文 `{apiVersion, consumer:{id}, idempotencyKey?}`，其
  `consumer.id` 必须与源 job 一致；见 [Idempotency](#idempotency)。
- 不带 `--async` 时，retry 与 `create` 一样是 submit 加 wait；见
  [Synchronous create and default retry](#synchronous-create-and-default-retry)。

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
| `9` | 仅 `runs wait`（feature `async-submit`）：有界等待结束时 run 尚未就绪。不是 run outcome。 |

在带 `canonical-run-ledger` 的 build 上，create/retry 的 exit code 跟随 ledger
outcome。runtime 报告成功、但 ledger 结算为 `failed` 的 run（记录的拒绝、无效或空
输出、缺少输出证据、运行后凭据检查失败）exit `1`。见
[Canonical Run Ledger](#canonical-run-ledger) 的“Outcome 与 exit 示例”。

`0`–`8` 的含义不变。在带 `async-submit` 的 build 上，`create` 与 `retry` 从不
exit `9`；claim-time 检查与 `submission_pending` 使用既有 code（见
[Claim-time checks](#claim-time-checks) 与 [Idempotency](#idempotency)）。exit `8`
也可能伴随一个带 job ID 和 `"wait":{"state":"error",…}` 的 stdout envelope；它报告
的是观察问题，不是 run 的 outcome。

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
| `completed.payload.exitCode` 或 `result` 为 `null` | 该结算没有此值（例如排队中取消或 worker 恢复）。这些成员可选且可为 `null`。 | 读取 `runs result`（`status`、`diagnostics`、`result`）和命令 exit code。 |
| runtime 报告成功，但 run 为 `failed`，原因是 `policy_denied`、`output_empty`、`output_invalid` 或 `output_evidence_missing` | 修正后的终态真相：拒绝、无效输出和空输出会使 run 失败。 | 查看 `diagnostics` 以及该 run 的 `status`/`error` events。 |
| schema 校验拒绝 `features` 中的 `canonical-run-ledger` | 本地固定的旧版 schema 的 `discoveryFeature` enum 是封闭的。 | 刷新 `local-job-api-v1.schema.json` 副本。 |
| schema 校验拒绝 `features` 中的 `async-submit` | 同一个封闭 enum；`async-submit` 比你的副本新。 | 刷新 `local-job-api-v1.schema.json` 副本。 |
| schema 校验拒绝 `runtimes[].routes` 中的某个成员 | 你固定的副本以精确键集定义 experimental route 摘要，而该 block 在你固定之后发生了变化。 | 刷新 `local-job-api-v1.schema.json` 副本；见 [Route summaries](#route-summaries-runtimesroutes-experimental)。 |
| `runs wait` exit `9` | 截止时 run 尚未就绪（原因见 `wait.reason`）。这不是失败。 | 再次 wait，或读取 `runs status`。`executor_unavailable` 时启动 `locus daemon run`。 |
| `runs submit` 成功但 run 一直 `queued` | 没有运行中的 executor（`execution.reason: "no_executor"`）。 | 启动 `locus daemon run`，或用 `runs create` 在进程内执行。 |
| `idempotency_conflict` | 该 key 已为此 consumer 绑定到不同的 request。 | 不同的 request 使用新 key。 |
| `submission_pending`（exit `8`） | 带 key 的提交已记录但从未完成 admission。 | 用同一 key 重试；一直不解除时按 ID 取消，或换新 key 并接受重复风险。 |
| `idempotency_key_not_supported` | `runs create` 不接受 key。 | 使用 `runs submit`（以及 `runs wait`）。 |
| run 以 `queued_age_exceeded`、`cwd_identity_changed` 或 `project_unregistered` 失败 | run 在队列中等待后，claim-time 检查失败。 | 修正 project 或 profile 后重新提交；见 [Claim-time checks](#claim-time-checks)。 |

## 稳定性合同

v1 稳定：

- `locus api` 下的命令名
- `apiVersion: locus.local-job.v1`
- 本手册列出的 request fields
- 本手册列出的 response envelopes
- event envelope 字段
- discovery feature 标识，包括 `canonical-run-ledger` 和 `async-submit`
- 带 `async-submit` 时：`runs submit`、`runs wait`、`runs retry --async` /
  `--request` 的命令形状；`wait` envelope 的成员与 `wait.reason` 取值；仅
  `runs wait` 使用的 exit `9`；`execution` 的成员与取值；`idempotentReplay`；
  新增的 `error.code` 取值；以及每个 claim-time 检查的 `job.errorCode` 与 exit
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
- error `message` 文本、`job.workerId` 的格式，以及 executor 的时序细节（心跳
  节奏、每次循环的结算上限）
- `payload.extensions["runtime.codex.v1"]`（`maturity: "experimental"`）
- `runtimes[].routes`（experimental）：是否出现、`routeId` 的取值，以及 `surface`、
  `adapterSource`、`transport` 的开放取值；其键集的任何变化都是新的兼容性决定，记录在
  [Route summaries](#route-summaries-runtimesroutes-experimental)
- Workbench 渲染细节
- `locus run` 和 `locus jobs` 的人工 CLI 格式

consumer 应该只依赖本手册列出的 v1 字段，并忽略未知 JSON 字段。
