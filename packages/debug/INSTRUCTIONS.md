# Structured Debug Logging Protocol

A tiny HTTP log sink for debugging runtime issues in the renderer or main
process without asking the user to copy-paste console output. Instrumented
code posts JSON events; the agent reads them back from a file.

## Endpoints

Server: `bun packages/debug/src/server.ts &` (port `7799`).
Logs land in `.debug/logs.ndjson` at the repo root (gitignored).

| Method | Path | Effect |
|--------|-------|--------|
| POST | `/log` | Append the JSON body as one NDJSON line |
| DELETE | `/logs` | Clear the log file |
| GET | `/logs` | Return the raw NDJSON |

Each entry is `{tag, msg, data, ts}` by convention: `tag` groups one
investigation, `msg` names the probe point, `data` carries values, `ts` is
`Date.now()`.

## Instrumentation snippet

Works in both renderer and main process — no import, fails silently if the
server is not running, safe to leave in during a reproduce cycle:

```js
fetch('http://localhost:7799/log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tag:'TAG',msg:'MESSAGE',data:{},ts:Date.now()})}).catch(()=>{});
```

## Workflow

1. **Hypothesize** — state what you expect to be true and where it could break.
2. **Instrument** — add probes at the decision points that discriminate
   between hypotheses. One `tag` per investigation.
3. **Reproduce** — clear old logs (`curl -X DELETE http://localhost:7799/logs`),
   then ask the user to trigger the behavior (or trigger it yourself).
4. **Read** — read `.debug/logs.ndjson`; each line is one probe hit in order.
5. **Fix with evidence** — change code only for causes the logs demonstrate.
6. **Verify** — re-run the reproduce step and confirm the logs show the fix.
7. **Remove instrumentation** — delete every probe before finishing. Probes
   must never be committed.

## Notes

- The server is dev-tooling only; it is never started by the app and nothing
  in `src/` may depend on it.
- `.debug/` is gitignored; treat its contents as disposable.
