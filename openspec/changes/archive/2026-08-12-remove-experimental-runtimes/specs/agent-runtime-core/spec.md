# agent-runtime-core Specification Delta

One requirement is removed. **This capability survives** — every other requirement in
`agent-runtime-core` is runtime-neutral or contract-runtime-scoped and is unchanged.

## REMOVED Requirements

### Requirement: Experimental Runtime Desktop Chat Dispatch
**Reason**: This requirement specifies a shared desktop chat route that dispatches by `runtimeId`
"across enabled experimental runtimes", keys state per experimental runtime, and rejects runtimes
whose feature flag is off. With `kun` and `qwen-code` removed, `EXPERIMENTAL_RUNTIME_IDS` is empty
and the requirement has no subject: there is no experimental runtime to dispatch to, no per-runtime
state to keep from colliding, and no feature flag to check. The implementation it governed — the
shared `chat` subscription in `trpc/routers/agent-runtime.ts`, `activeRuntimeStreams`,
`pendingRuntimeToolApprovals`, and `agent-runtime/experimental-runtime-message-history.ts` — is
deleted in the same change. Retaining the requirement would leave the spec asserting a dispatch
contract over an empty set.

**Migration**: None. The two contract runtimes have never used this route; Claude Code and Codex
each dispatch through their own entry points (`trpc/routers/claude.ts`, `trpc/routers/codex.ts`),
which are unchanged. The delegation discipline this requirement encoded — that a route must delegate
preflight, provider binding, permission policy, adapter execution, event normalization and redaction
to their canonical owners rather than reimplementing them — remains specified for the surviving
runtimes by the other requirements in this capability and is enforced by the runtime-core import
boundary guard. Should a third runtime ever be introduced, it will need a dispatch contract designed
against its own requirements rather than inheriting one written for two deleted runtimes.
