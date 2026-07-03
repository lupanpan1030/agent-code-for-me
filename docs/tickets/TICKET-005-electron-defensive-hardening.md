# TICKET-005 — 防御性加固：OAuth 回环绑定 + openExternal scheme 白名单

- **级别**：🟡 Low（防御纵深）
- **类型**：两处小而独立的加固，同一审查пасс
- **实施**：Codex ｜ **审查**：Claude

包含两个独立子项，可在同一 PR 完成。

---

## 子项 A — MCP OAuth 回调服务器绑定 127.0.0.1

**文件**：`src/main/lib/oauth.ts:923`

现状：`this.server.listen(CALLBACK_PORT, () => {...})` 省略 host 参数，Node 默认监听**所有网卡**。
CSRF 由 128-bit 随机 `state`（`oauth.ts:510` 生成、:879-890 校验）保护，故**非**盗 token 向量；
实际影响仅限同网段对进行中 OAuth 流的 DoS。

**改法**：显式绑定回环：

```ts
this.server.listen(CALLBACK_PORT, "127.0.0.1", () => { /* Server started */ })
```

参照 `src/main/lib/provider-profiles/gateway.ts:1467` 已有的正确写法 `listen(0, "127.0.0.1", ...)`。

**验收**：绑定含 `"127.0.0.1"`；OAuth 回调流程仍能正常完成（现有 oauth 相关测试全过）。

---

## 子项 B — `openExternalUrl` 增加无条件 scheme 白名单

**文件**：`src/main/lib/local-only.ts:47-53`（`openExternalUrl`）
**触达点**：`src/main/windows/main.ts:304-314`（`shell:open-external` IPC）、`:574`；
渲染层经 agent markdown 链接 `src/renderer/components/chat-markdown-renderer.tsx:365-379`。

现状：仅在 `LOCAL_ONLY` 模式下按主机名（`isOfficialCloudUrl`）拦截，**无通用 scheme 白名单**。
agent 产出的 markdown 链接是已知 prompt 注入面 —— 「agent 产出的文本」到「OS 级 open 动作」之间
是一条未审信任边界。

**改法**：在 `openExternalUrl` 调用 `shell.openExternal` **之前**，**无条件**（与 local-only 模式无关）
校验 URL scheme，只允许 `http:` / `https:` / `mailto:`，其余（`file:`、自定义 scheme 等）拒绝并抛错：

```ts
export async function openExternalUrl(operation: string, url: string): Promise<void> {
  const scheme = (() => { try { return new URL(url).protocol } catch { return "" } })()
  const allowed = new Set(["http:", "https:", "mailto:"])
  if (!allowed.has(scheme)) {
    throw new Error(`Blocked external open of disallowed scheme: ${scheme || "unknown"}`)
  }
  assertOfficialCloudAllowed(operation, url)
  await electron.shell.openExternal(url)
}
```

**注意**：先确认应用内没有合法依赖 `file:` 等 scheme 打开外部内容的路径（grep `openExternal`
/ `shell:open-external` 全部调用点）。若存在合法 `file:` 用例，为其单独走一条经过校验的 API，
不要因此放宽白名单。

**验收**：
- [ ] 单元测试：`http`/`https`/`mailto` 放行；`file:` / `javascript:` / 自定义 scheme 被拒绝抛错。
- [ ] 确认无合法调用点被误伤（列出 grep 结果于 PR 描述）。

---

## 通用验收标准

- [ ] `bun run check` 全绿。

## 不做范围

- 不改 `isOfficialCloudUrl` / local-only 主机名逻辑本身。
- 不改 OAuth 的 state/CSRF 机制（已足够）。

## 审查清单（Claude 验收时核对）

1. A：`listen` 确实带 `"127.0.0.1"`，回调仍可完成。
2. B：白名单**无条件**生效（不依赖 local-only），负向 scheme 有测试覆盖。
3. B：无合法 `file:` 调用点被破坏。
