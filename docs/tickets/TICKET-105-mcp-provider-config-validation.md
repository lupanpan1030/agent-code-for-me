# TICKET-105 — MCP/provider 配置写入的项目根解析与输入校验（Phase 1.6）

- **级别**：🟠 High（安全 · 项目级配置写入 + command/url/env 校验）
- **来源**：openspec tasks 1.6
- **前置**：TICKET-101（共享解析器）
- **实施**：Codex ｜ **审查**：Claude

## 背景与受影响文件

- `src/main/lib/trpc/routers/claude.ts`：`addMcpServer`（:374）、`updateMcpServer`（:388）、`setMcpBearerToken`（:406）等，输入含 `projectPath`（:374/:388…）+ command/args/env/url/token。
- `src/main/lib/trpc/routers/codex.ts`：`addMcpServer`（design 记 :371）。
- `src/main/lib/trpc/routers/mcp-registry.ts`：`install`（design 记 :141）。
- provider 配置写入：`providerProfiles.saveProfile`、`localApiProviderConfig.save`、`claudeProviderConfig.save/importLegacy` 等（design 清单）。

## 问题与失败场景

这些路由据 renderer 的原始 `projectPath` 写「稍后会被运行时执行」的 MCP stdio 命令 / HTTP URL / bearer token。项目根未服务端校验、command/url/env 未显式校验时，被驱动的 renderer 可向任意项目写入配置，或注入畸形 url/env。

> 注：**stdio 命令的指纹原生同意门已在 openspec 3.3a 落地**（`runtime-mcp-config/mcp-command-trust.ts`）。本票**不重复**那层，只补：①项目根服务端解析；②command/url/env 的结构化输入校验。两层叠加。

## 规定改法

1. 所有带 `projectPath` 的 MCP/provider 项目级写入：先用 TICKET-101 的 `resolveRegisteredProjectRoot` 解析并校验，未注册拒绝。
2. 输入显式校验：
   - `url` 只允许 `http:`/`https:`（复用 TICKET-005 的 scheme 白名单思路）；
   - `env` 键名符合环境变量命名、值为字符串、无 null 字节；
   - `command`/`args` 为字符串数组、无 null 字节（**其可信性仍由 3.3a 指纹同意门把关，本票只做形状校验，不弱化同意门**）。
3. 保持既有 3.3a 原生同意门与 OAuth token 主进程存储（P1）不变。

## 验收标准

- [ ] 对抗性测试：未注册 `projectPath`、非 http(s) 的 MCP url、畸形 env（坏键名/null 字节）被拒绝。
- [ ] 3.3a 指纹同意门在改动后仍生效（既有 `runtime-mcp-config-service.test.ts` 全过）。
- [ ] 正常 MCP/provider 配置写入不回归。
- [ ] `bun run check` 全绿。

## 不做范围

- 不改 3.3a 同意门逻辑、不改 OAuth token 存储。
- 不做 provider 密钥的读回渲染层（本就不该，保持现状）。

## 审查清单（Claude 验收时核对）

1. 项目根解析覆盖所有带 `projectPath` 的 MCP/provider 写入路由，无遗漏。
2. url/env/command 校验到位且**未削弱** 3.3a 同意门（两层都在）。
3. 既有 MCP 授权/存储测试全过。
