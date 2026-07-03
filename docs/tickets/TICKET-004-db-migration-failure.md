# TICKET-004 — 数据库迁移失败静默退化为混乱的运行时错误

- **级别**：🟠 Medium（数据完整性 / 可诊断性）
- **类型**：错误处理 —— 失败后返回半初始化状态
- **实施**：Codex ｜ **审查**：Claude

## 背景与受影响文件

- `src/main/lib/db/index.ts:43-73`（`initDatabase`）
- `src/main/index.ts:833-845`（GUI 启动调用点）

## 问题与失败场景

`initDatabase()` 在 `migrate()` **之前**就把 `sqlite`（:52）与 `db`（:58）赋给模块级单例。
若 `migrate()` 抛错（:65），这两个全局已非空。GUI 启动路径（`src/main/index.ts:834-845`）
catch 住错误、`console.error`、然后**照常** `createMainWindow()` —— 不退出、不重试、不向用户呈现错误。

此后所有 `getDatabase()`（:78-83，因 `db` 非空）**静默返回那个可能未迁移的句柄**。净效果：迁移失败
退化成后续 tRPC 调用里一堆 `no such column/table` 的 SQLite 错误，而非一次清晰、可操作的启动失败。

## 规定改法

1. `initDatabase()`：迁移成功前**不缓存**句柄。改为局部变量，`migrate()` 成功后再赋给模块级 `db`/`sqlite`；
   失败时关闭已打开的 sqlite 连接、置空局部、**重新抛出**，确保下次 `getDatabase()` 会重新尝试而非
   返回半初始化实例：

   ```ts
   export function initDatabase() {
     if (db) return db
     const dbPath = getDatabasePath()
     const connection = new Database(dbPath)
     connection.pragma("journal_mode = WAL")
     connection.pragma("busy_timeout = 5000")
     connection.pragma("foreign_keys = ON")
     const instance = drizzle(connection, { schema })
     try {
       migrate(instance, { migrationsFolder: getMigrationsPath() })
     } catch (error) {
       connection.close()          // 不泄漏连接
       throw error                 // db/sqlite 仍为 null
     }
     sqlite = connection
     db = instance
     return db
   }
   ```

2. `src/main/index.ts:833-845`：迁移失败时**不要静默继续**。改为向用户呈现明确错误（`dialog.showErrorBox`
   或等价 UI），并阻止进入不可用状态 —— 优先 `app.quit()`；若产品希望给「重试/查看日志」入口，
   至少不要在 db 未就绪时 `createMainWindow()` 进入会不断报 SQLite 错误的界面。与团队既有交互风格保持一致。

## 验收标准

- [ ] 单元测试（可 mock `migrate` 抛错）：`initDatabase()` 抛错后，`db`/`sqlite` 模块状态保持未初始化，
      再次调用会重新尝试而非返回旧句柄；且不泄漏未关闭的 sqlite 连接。
- [ ] 启动路径在迁移失败时向用户呈现明确错误并阻止进入不可用窗口（可用 mock/单测覆盖分支逻辑）。
- [ ] 正常启动路径不变（既有测试全过）。
- [ ] `bun run check` 全绿。

## 不做范围

- 不改迁移文件本身、不改 `getMigrationsPath` 的 dev/packaged 解析（已验证正确）。
- 不引入自动「修复/回滚」迁移的复杂逻辑；本工单只做「失败要响亮且不半初始化」。

## 审查清单（Claude 验收时核对）

1. 失败路径确实不缓存句柄、确实关闭连接、确实重抛。
2. 启动分支不再静默 `createMainWindow()`；用户可感知失败。
3. `getDatabase()` 在失败后重试语义正确（不会因 `db` 残留而返回坏句柄）。
