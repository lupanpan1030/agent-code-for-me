# TICKET-106 — 架构守卫：危险 router 输入必须经批准解析器（Phase 1.9）

- **级别**：🟡 结构（防回归 · 高杠杆）
- **来源**：openspec tasks 1.9
- **前置**：**必须在 TICKET-102/103/104/105 全部落地之后**（否则会因现存违规而直接红）
- **实施**：Codex ｜ **审查**：Claude

## 背景

前面的票逐个收敛了危险输入，但没有机制**防止将来有人再引入**一个吃原始 `cwd`/`path`/`command` 的裸 `publicProcedure`。设计（design.md「Verification Strategy」）要求加一道架构守卫。

`scripts/check-architecture-guards.mjs` 结构为一串 `assertX()` 函数，末尾顺序调用（见文件尾 `assertOwnershipDocs()` … `assertCanonicalVocabularyI18n()`），新增规则照此模式即可。

## 规定改法

在 `check-architecture-guards.mjs` 新增 `assertNoUnresolvedDangerousRouterInput()` 并加入末尾调用序列：

1. 扫描 `src/main/lib/trpc/routers/**` 各 router 文件中 `.input(z.object({ ... }))` 的字段名。
2. 若声明了危险字段名（`path`/`cwd`/`command`/`url`/`token`/`env`/`headers`/`absolutePath` 等，取 design.md 列表）**且**该 procedure 不在「已批准解析器」白名单内，则 `fail(...)`。
3. 维护一份显式白名单：列出已由 TICKET-101–105 通过注册根解析器/校验处理的 procedure（附对应票号注释）。白名单是「已知安全」的正面清单，不是宽泛豁免。
4. 目标：新加一个吃原始危险字段、未走解析器的 procedure 时，`bun run architecture:check` **必须失败**。

## 验收标准

- [ ] 新增守卫函数并接入调用序列；`bun run architecture:check` 在当前树上**通过**（说明 102–105 的收敛已完备，白名单准确）。
- [ ] 负向自证：临时加一个吃裸 `cwd` 的示例 procedure，守卫报错（提交前移除示例，或写成脚本内的单测夹具）。
- [ ] 白名单每一项都有票号/理由注释，无「为了过而豁免」的条目。
- [ ] `bun run check` 全绿。

## 不做范围

- 不改任何 router 逻辑（那是 102–105）；本票只加静态守卫。
- 不覆盖 Phase 3 的 capability 元数据/中间件（那是后续 3.1/3.2）。

## 审查清单（Claude 验收时核对）

1. 守卫**真的能抓**新违规（要求实施者演示负向用例，或看夹具测试）。
2. 白名单无过度豁免，每项可追溯到已落地的解析器。
3. 字段名清单与 design.md 一致，未漏 `command`/`env`/`headers` 等。
