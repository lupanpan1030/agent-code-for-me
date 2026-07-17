// Structured debug log sink used during debugging sessions.
// Start: bun packages/debug/src/server.ts &
// Contract (documented in CLAUDE.md "Debug Mode" and packages/debug/INSTRUCTIONS.md):
//   POST   /log   append one JSON entry as a line to .debug/logs.ndjson
//   DELETE /logs  clear the log file
//   GET    /logs  return the raw NDJSON (convenience)
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const PORT = 7799
const REPO_ROOT = join(import.meta.dir, "..", "..", "..")
const LOG_DIR = join(REPO_ROOT, ".debug")
const LOG_FILE = join(LOG_DIR, "logs.ndjson")

// Renderer instrumentation posts JSON cross-origin, so preflight + CORS are required.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

mkdirSync(LOG_DIR, { recursive: true })
appendFileSync(LOG_FILE, "")

Bun.serve({
  port: PORT,
  async fetch(request) {
    const { pathname } = new URL(request.url)

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    if (request.method === "POST" && pathname === "/log") {
      let entry: unknown
      try {
        entry = await request.json()
      } catch {
        return new Response("invalid JSON body", {
          status: 400,
          headers: CORS_HEADERS,
        })
      }
      appendFileSync(LOG_FILE, `${JSON.stringify(entry)}\n`)
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    if (request.method === "DELETE" && pathname === "/logs") {
      writeFileSync(LOG_FILE, "")
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    if (request.method === "GET" && pathname === "/logs") {
      return new Response(Bun.file(LOG_FILE), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/x-ndjson" },
      })
    }

    return new Response("not found", { status: 404, headers: CORS_HEADERS })
  },
})

console.log(`[debug] log sink on http://localhost:${PORT} -> ${LOG_FILE}`)
