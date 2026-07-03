# TICKET-006 — 升级含漏洞的直接依赖

- **级别**：🟡 Medium（依赖债）
- **类型**：依赖升级
- **实施**：Codex ｜ **审查**：Claude

## 背景

`bun audit` 报告 132 个漏洞（1 critical / 48 high / 71 moderate）。多数在**构建期**传递依赖里
（`electron-builder` 链下的 `@xmldom/xmldom` / `minimatch` / `brace-expansion` / `picomatch`），
运行时不涉及，可跟随 electron-builder 升级批量解决，**本工单不强制处理**。

本工单聚焦**运行时直接依赖**的三项：

| 包 | 当前 | 目标 | 通告要点 |
|----|------|------|---------|
| `simple-git` | 3.30.0 | ≥ 3.32.0 | critical + 2 high（RCE / option-injection）。已核实项目仅做本地 status/diff/PR，不用不可信 URL clone，实际暴露低，但仍应升。 |
| `dompurify` | 3.4.11（另有 3.2.7 / 3.3.1 在树中） | 最新 3.x | 多个 moderate XSS 绕过。项目用它清洗 Mermaid SVG，底层版本自身有绕过 CVE。 |
| `mermaid` | 11.12.2 | ≥ 11.14.1（或含补丁的最新） | HTML/CSS 注入 + Gantt 无限循环 DoS。渲染 agent 产出内容。 |

## 规定改法

1. 升级上述三个直接依赖到目标版本（改 `package.json` + 刷新 `bun.lock`）。
   - 优先精确核对各包的「已修复版本」，取 ≥ 修复版的最新兼容版。
   - `dompurify` 注意去重：树中存在多版本（3.2.7 / 3.3.1 / 3.4.11），尽量收敛。
2. 跑安全相关测试确认无回归，重点：
   - `tests/renderer-mermaid-xss.test.ts`
   - `tests/renderer-csp-policy.test.ts`
   - `tests/renderer-html-sinks.test.ts`
   - `src/renderer/lib/security/mermaid-svg-sanitizer.ts` 相关用例
3. 若 `mermaid` 大版本引入 breaking（渲染 API 变化），在 PR 描述记录并最小化适配；如破坏性过大，
   降级目标为「取该大版本内含补丁的最新 patch」，不强行跨大版本。

## 验收标准

- [ ] `package.json` 三项版本达标，`bun.lock` 已更新且 `bun install --frozen-lockfile` 通过。
- [ ] `bun audit` 中这三个**直接依赖**的对应通告消失（传递依赖漏洞可残留，PR 描述说明）。
- [ ] 上列安全测试 + `bun run check` 全绿。
- [ ] Mermaid 图表在应用内仍能正常渲染（若能本地起应用，附一次渲染验证；否则以测试为准并说明）。

## 不做范围

- 不强制处理 electron-builder / node-gyp 链下的构建期传递依赖（另行跟随工具升级）。
- 不做无关的 `bun update --latest` 全量升级（避免引入不相关 breaking，放大审查面）。

## 审查清单（Claude 验收时核对）

1. 三项版本确达修复版以上；lockfile 一致、可复现安装。
2. Mermaid/DOMPurify 相关 XSS/CSP 测试仍全过（清洗行为未因升级退化）。
3. 无夹带的无关依赖变更。
