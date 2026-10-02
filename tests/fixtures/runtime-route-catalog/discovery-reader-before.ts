/**
 * Neutral OLD discovery reader (S22 supporting fixture; tasks.md §7
 * `discovery-reader-before.ts`). Frozen from the published consumer guide
 * at 6192b13f (`docs/local-job-api-v1-consumer-guide.md`, SHA-256
 * c81abca1bc135f7397990621a3985694d485f3ff4e5c54a93d0fa77805c6bd87):
 *
 * - :224 "A consumer that depends on a feature checks `features` before
 *   dispatch and treats a missing identifier as unsupported."
 * - :263 "Locus rejects unsupported or degraded required capabilities"
 *   (a consumer may only require a capability whose `status` is
 *   `supported`; field name per the published 6192b13f schema
 *   `$defs.runtimeCapability.status`, the guide example's `state` being
 *   illustrative).
 * - :236-245 readiness is advisory (`ready|needs-auth|unavailable|unknown`)
 *   and never proves the daemon's environment.
 * - :1729 "Use the documented v1 fields and ignore unknown JSON fields."
 *
 * It reads only documented v1 discovery fields and is NOT a real Career Kit
 * or Amadeus adapter; it stands for any reader written against the 6192b13f
 * guide. Its decisions are the "common-core decisions" of S22.
 */

export const DISCOVERY_READER_BEFORE_SOURCE = {
  guide: "docs/local-job-api-v1-consumer-guide.md",
  sourceSha: "6192b13f74603fbcc57c8ba858cb6b0f0d0ac776",
  guideSha256:
    "c81abca1bc135f7397990621a3985694d485f3ff4e5c54a93d0fa77805c6bd87",
  rules: [":224", ":236-245", ":263", ":1729"],
} as const

/** Discovery features documented by the 6192b13f guide (:212-218). */
export const DOCUMENTED_FEATURES_BEFORE = [
  "runtime-readiness",
  "provider-binding",
  "completion",
  "canonical-run-ledger",
  "async-submit",
] as const

export type DiscoveryDecisionsBefore = {
  apiSupported: boolean
  features: Record<string, boolean>
  runtimes: Record<
    string,
    {
      readinessAdvisory: string
      requirableCapabilities: string[]
    }
  >
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function readDiscoveryBefore(
  envelope: unknown,
): DiscoveryDecisionsBefore {
  const body = record(envelope)
  const features = list(body.features).filter(
    (entry): entry is string => typeof entry === "string",
  )
  const runtimes: DiscoveryDecisionsBefore["runtimes"] = {}
  for (const entry of list(body.runtimes)) {
    const runtime = record(entry)
    if (typeof runtime.runtimeId !== "string") continue
    const readiness = record(runtime.readiness)
    runtimes[runtime.runtimeId] = {
      readinessAdvisory:
        typeof readiness.state === "string" ? readiness.state : "unknown",
      requirableCapabilities: list(runtime.capabilities)
        .map(record)
        .filter((capability) => capability.status === "supported")
        .map((capability) => String(capability.id))
        .sort(),
    }
  }
  return {
    apiSupported: body.apiVersion === "locus.local-job.v1",
    features: Object.fromEntries(
      DOCUMENTED_FEATURES_BEFORE.map((feature) => [
        feature,
        features.includes(feature),
      ]),
    ),
    runtimes,
  }
}
