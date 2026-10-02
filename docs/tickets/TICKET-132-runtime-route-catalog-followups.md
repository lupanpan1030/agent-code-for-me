# TICKET-132 — Runtime route catalog accepted follow-ups

## Status and evidence

**Open / 接受的残余；实施未授权。** 来源：`refactor-unified-runtime-route-catalog`
统筹 Claude Fable 5.1 依据 Owner 2026-10-02 自我迭代授权与 OD-5，于 **2026-10-02** 代行
**ACCEPTED @ f4783c38925fd59db11e3684d97bcc1088492c08**（source `f8e538bc`）。
Codex gpt-6-astra R2 IMPLEMENTATION_VERIFIED 与 fresh-context Claude REVIEW_APPROVED
均绑定该完整 SHA，候选统筹 check:full / PR-base lint exit 0。

范围、双签、门禁日志与接受披露 (a)–(j) 以
[verification](../../openspec/changes/refactor-unified-runtime-route-catalog/verification.md)
§1 / §4 / §6 / §7 / ACCEPTED 段为准；批准范围见 design D6 / OD-1–OD-5。
本票不把接受的缺口登记为已修复或已验证，不关闭 TICKET-127–131，不授权 merge、push、PR 或发布。

## Remaining work（全部未完成）

| 项 | 缺口与后续范围 | 验证 / 完成条件 |
| --- | --- | --- |
| 守卫已披露检测限制 | hoisted 局部布尔、const 间接、计算/动态成员访问、计算 map 键、反射、跨模块重绑定、多跳 wrapper；§6 与守卫头注释已有边界说明，守卫通过不等于穷尽证明 | 独立批准守卫切片，明确支持范围；增加正负 mutation 探针，保留 canonical owner 与原 ledger/async/route ratchet，不扩大豁免 |
| Claude binding 新 P3：forwarded 两形式 | `runtimeRouteCatalog` 初始化后重赋值仍按 initializer 放行；参数默认值（如 `runtimeRouteCatalog = build()`）仍视为转发。已独立 scratch 复现。伪造值由 WeakMap 认证 fail closed，不代表守卫形式判定正确 | 补数据流判定及重赋值/默认值正负探针，保留合法参数/解构/属性转发；同步守卫头注释 Detection limits 与 verification §6。本次纯文档红线未修改脚本，P3 未实施关闭 |
| OD-1 具名残余（design D6） | Phase 7「新 Runtime 不改 renderer switch」不由本切片验收；renderer neutral chat/approval IPC、approval 分派（含 Claude 默认）、admit gates、P28 provider 三元、alias 表留 Phase 4 / harness-conformance | 按 ratified Phase 4-conformance 顺序另行设计/批准；明确唯一 owner、neutral fixtures 与失败语义，不保留双业务路径；本票不改变路线图顺序 |
| Desktop smoke | WSL host-blocked：Electron 缺 libnspr4/libnss3/libasound 等、无 resources/bin、无 DISPLAY。plan/agent、project/folderless、profile/native、文本/工具/question/guard、取消/旧 Run、新绑定/重载与 descriptor 选择仍需真实宿主回执 | 使用 verification §7 复跑命令与矩阵，记录准确 app/runtime SHA、digest、OS/arch、操作与结果；TEST/synthetic/source 证据不能替代 GUI smoke |
| Packaged CLI / daemon / stdio smoke | WSL host-blocked；batch、policy-grant、completion、create/submit/wait/retry/cancel/events、daemon-first/own-pump、jobs-stdio、required capability 拒绝、no-probe、无凭据拒绝与 child teardown 未获真实回执 | 准备对应运行库/打包 runtime/隔离 profile 后依 §7 复跑；分别记录 stdout/stderr/exit 与真实 Runtime 结果；macOS/Windows packaged **not claimed**，不得把 Linux/WSL source 通过记作 Tier-1 stable 通过 |
| 平台矩阵与 consumer evidence | macOS/Windows 无宿主，consumer E2E unknown；tasks 8.2–8.4 保持未勾，TICKET-130 平台矩阵未关闭，TICKET-127 Windows artifact-bearing 请求既有 fail closed 单列 | 两平台各自运行 neutral fixtures + packaged smoke，记录 app/runtime SHA/digest/OS/arch；consumer 负责自身 adapter/E2E，未知状态不得冒称通过 |
| Renderer 描述符失败提示 | `route_descriptor_unavailable/error`、`unknown_transport` 当前仅 console.error + 不建 Chat，无新增 UI 文案；`chats.create` / `forkSubChat` 依赖重读绑定的既有披露保留（verification §4 决定 18/19） | 后续用户可见提示另行设计与批准，覆盖 error/loading/unknown transport，保持 fail closed 与已有 request/stream/cancel 语义，并取得 GUI 证据 |
| S28 clean 合成文本刷新 | fixture 中仍提及已删 `resolveLocalJobApiRuntimeReadiness` facade；当前夹具冻结，本段不改。D5 registry→router-surface 源扫描 token 一致但 biome 重排两处，已接受非逐字迁移 | **下一次合法夹具解冻时**刷新合成 clean 文本，按独立作者/裁定流程登记新基线与 hashes；不得悄改 `24801faa` 不可变零差异集合 |
| Policy-grant 非 api entry | 当前 Codex policy-grant 目录仅声明 api entry；非 api 来源与 visible-user 通道的生产不可达差异接受为收窄（verification §4 决定 13 / ACCEPTED (d)） | 未来若放开非 api entry，**先声明目录条目**，再审 parser/admission/profile/visible channel 语义与 C7 Consumer Impact，补独立 contract fixtures；不恢复旧 selector 或另建 dispatch owner |

## Verification and boundaries

- 每个实施范围须独立批准；先读 ownership map，路由/transport 仅解析 envelope，共享规则留 canonical owner。
- 守卫新探针应能在撤掉修复时失败；合法转发必须保持 clean。运行 targeted tests、strict 与 check:full，双技术 verdict 绑定同一最终 source SHA；任何后续代码变化须重新双验。
- Desktop、真实 Runtime、CLI/daemon/stdio 与平台 packaged 证据逐项留缺口；有真实回执后才更新对应 checkbox，不用本票代替 smoke。
- TICKET-127（Windows artifact backend）、128（创建/发布原子性）、129（native 证据/制品读取）、130（relay/Windows packaged）、131（async-submit follow-ups）保持 Open，本切片没有关闭它们。
- 不增加 Runtime ID / 公共身份、不把 routeId 变稳定身份、不改变 approved contract、无顺手迁移或双实现；公共/versioned 变化须独立 Consumer Impact 决定。
