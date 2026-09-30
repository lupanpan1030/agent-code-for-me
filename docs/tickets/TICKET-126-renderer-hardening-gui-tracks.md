# TICKET-126 — Renderer hardening GUI 双轨补跑

## Status

待补跑（Owner 2026-09-30 ACCEPTED：先合入，再执行开发态与打包态 GUI 轨道）。
这不是已通过的 smoke 回执，也不补记 `IMPLEMENTATION_VERIFIED`。

## 绑定与环境

- 已接受的冻结产品源码：`5ca5a17aaa7c4ac4cd5d13b41fd528886a1c22ef`；
  证据头：`3de915c00c9c2f6d62569cd1404d3c606af1d5cf`。
- 实际补跑须记录所测 main 源码 SHA、构建产物 SHA/哈希、OS、Electron/Bun 版本、
  启动与打包命令、夹具哈希、脱敏 console/main 日志、截图/录屏哈希。较晚 SHA 的
  结果只证明该 SHA，不回填为冻结源码的 GUI 执行。
- 本机是 WSL2，已有 WSLg（`/mnt/wslg`；GUI 会话设 `DISPLAY=:0`）。目前缺少
  Electron 运行库：`sudo apt-get install -y libnspr4 libnss3 libasound2t64 libxss1`。
  装好后可在本机尝试开发态与打包态；安装记录本身不是 GUI 行为证据。
- 补跑结果逐项回填本票与归档后的
  `openspec/changes/archive/2026-09-30-add-renderer-untrusted-content-hardening/verification.md`。
  产品缺陷另走修复与评审，不改写冻结源码的历史 verdict。

## 5.1 — 开发态特权 renderer 内容矩阵

- [ ] 在真实开发态 Electron 特权 renderer 运行恶意 static/streaming markdown、
      highlighted code、Mermaid inline/fullscreen、tool subtitle、mentions
      paste/drop/beforeinput/undo/redo，以及正常安全格式化对照。对最终 DOM 应用共享
      executable-markup oracle，并分别记录正反结果；仅按 Owner Q9 决定增加 D10
      dependency-producer 行。
- [ ] 实测浏览器 rich paste/drop 拒绝、原生 `execCommand`/undo/redo、IME
      composition 序列；不能以 happy-dom synthetic dispatch 代替。
- [ ] 实测 Mermaid 临时挂载的执行、CSS、布局、网络作用和清理时序；保留深色主题
      正向对照。验证所有图类型在真实 Chromium、双主题经 sink-parse review 后仍可
      渲染，SVG 内 HTML breakout 被拒；尝试 keyframe `position:fixed` /
      `position:absolute` 及根级 `position:relative` + `z-index` + `transform`
      overlay。记录 T10 夹具：
      `<svg><desc><noscript><title></noscript><img src=x onerror=…>`；检查
      最终 sink 是否出现 HTML `img[onerror]`。当前适配器实测先将其净化为
      `<svg><desc/></svg>`；GUI 要验证真实 sink，不能把这项已记录的 P3 当作已执行。
- [ ] 实测浏览器 CSP；单独记录 HTTPS markdown image-beacon 外连残余；证明
      `@pierre/diffs` 开发态预打包 `resolveId` 绑定。

## 5.2 — 开发态 local-browser guest 安全矩阵

- [ ] 使用恶意本地浏览器夹具检查 bridge/Node probes、零 Session preload 的有效
      sandbox、exact-origin 初始导航和 link/location/`loadURL`/back/forward/redirect，
      包括跨端口逐跳 3xx、非网络 `about:`/`data:`/`blob:`/`javascript:` commit。
      记录首次请求的拦截顺序、attach 时序、各资源类型的 `webRequest` 结果。
- [ ] 检查 `locus-preview:` 是否到达 `webRequest`，以及协议 handler 独立的
      admission/host/scope 强制检查；HTTP(S) 准入的 guest 不可借该 scheme 读取。
      文件路径同时覆盖正常 broker 读取或诚实的平台禁用、直接 `file:`、symlink、
      rename、canonical-root identity 失败、同 worktree 范围外文件、另一 admission
      的 host 和相对 URL 对照。对准入内资产及上述越界目标分别尝试 fetch、XHR、
      iframe `contentDocument` 和 `script src` 读取/执行。
- [ ] 检查 popup、permission/device/display、首响应 download、外部 scheme、
      OS handler、`mcp-import:preview` 均被拒且无 OS prompt/handler/push；
      双 partition 隔离与撤销、限界 `capturePage` 与过期拒绝、固定诊断的
      secret redaction、受控子资源外连残余、auth/gateway 400/401/404、
      `persist:main` 的 trusted voice，均逐项记录。
- [ ] 主进程单独 `close()`/`isDestroyed()` 应销毁 guest；复活或重附着须有
      新 generation/admission。观察 Session gate 取消未被导航 handler 阻止的
      顶层请求后的真实事件序列：预期 `did-fail-provisional-load`、随后
      `did-fail-load` 的 -20 `ERR_BLOCKED_BY_CLIENT`、error-page commit 且无
      `did-navigate`，主进程以 `committed-url-rejected` 销毁 guest。另记录
      非 gate 来源的 -20 是否出现。实测 capture → navigate → insert 会拒绝
      旧报告，replayed attach 保持活跃 preview。
- [ ] 顶层链接（包括原范围内文件）必须重新 admission/origin；独立记录
      guest 子资源网络外连残余及命名 loopback listener，不把允许的外连说成隔离成功。

## 5.3 — 打包态重复矩阵

- [ ] 对实际 packaged build 完整重复 5.1 内容矩阵及 5.2 guest 安全矩阵，记录
      OS、精确所测 SHA、Electron/Bun、package/start 命令、夹具哈希、脱敏
      console/main 证据和截图/录屏哈希。证明生产 alias binding、canonical-root
      失败路径以及 Owner 选定的 Q9 矩阵。
- [ ] Windows packaged 轨道明确记录当前 win32 backend 下文件预览禁用；
      HTTP(S) guest 测试照做，不把不可用的文件预览记为 broker-read 成功。

## 5.4–5.5 — TICKET-114 CSP 双轨

- [ ] 5.4 同一精确 SHA 的 GUI 会话中尽量执行
      [TICKET-114](TICKET-114-codex-desktop-extraction-gui-smoke.md) 的
      packaged-production CSP 轨道，并按该票规则单独记证据；不改历史 4.4。
- [ ] 5.5 执行 TICKET-114 development-CSP/HMR 轨道并单独记证据；不改历史
      4.5，不把 guest smoke 当作 CSP 证据，反之亦然。

若 GUI host 或任一轨道不可用，保持相应 checkbox 未勾选，记录阻碍和已完成
轨道的实际结果；不得以 unit、旧回执或另一 SHA 代替。Owner 已接受先合入再补跑，
但这种处置不等于 5.1–5.5 通过。
