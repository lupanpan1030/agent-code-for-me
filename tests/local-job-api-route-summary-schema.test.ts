/**
 * Implementer test for refactor-unified-runtime-route-catalog T3-1 (Codex R1
 * P2 / A8): the published `runtimeRouteSummary` definition couples `kind`
 * and `executionProfile` as the delta spec requires
 * (specs/local-job-api/spec.md: "agent executionProfile SHALL reuse the
 * existing closed executionProfile definition (batch or policy-grant), and
 * completion executionProfile SHALL be null").
 *
 * The real emitted summaries come from the in-process
 * `locus api runtimes list --json --no-probe` (the S22 argv) and must stay
 * valid; the four illegal combinations are built from those real summaries.
 *
 * Remove-the-fix: deleting the `allOf` conditionals from
 * `$defs.runtimeRouteSummary` makes the completion+batch,
 * completion+policy-grant and agent+null assertions fail (the schema then
 * accepts them); agent+interactive stays rejected by the closed
 * `executionProfile` enum alone. The last test pins this with a reverted
 * in-memory copy of the schema.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import Ajv2020 from "ajv/dist/2020"
import addFormats from "ajv-formats"
import {
  cli,
  createProfile,
  type Profile,
} from "./local-job-api-async-submit-wait-kit"

type SchemaNode = Record<string, unknown>
type Route = Record<string, unknown>
type Envelope = {
  runtimes: Array<{ runtimeId: string; routes?: Route[] }>
}

const REPO_ROOT = join(import.meta.dir, "..")
const DISCOVERY_ARGV = ["api", "runtimes", "list", "--json", "--no-probe"]

const profiles: Profile[] = []

afterEach(() => {
  for (const profile of profiles.splice(0)) profile.cleanup()
})

function loadSchema(): SchemaNode {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, "docs/local-job-api-v1.schema.json"), "utf8"),
  ) as SchemaNode
}

function definitions(schema: SchemaNode): Record<string, SchemaNode> {
  return schema.$defs as Record<string, SchemaNode>
}

function validators(schema: SchemaNode) {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  ajv.addSchema(schema, "local-job-api-v1")
  const summary = ajv.getSchema("local-job-api-v1#/$defs/runtimeRouteSummary")
  const envelope = ajv.getSchema(
    "local-job-api-v1#/$defs/runtimeManifestEnvelope",
  )
  if (!summary || !envelope) throw new Error("schema definitions missing")
  return {
    summary: (value: unknown) => summary(value) === true,
    envelope: (value: unknown) => envelope(value) === true,
  }
}

async function emittedDiscovery(): Promise<Envelope> {
  const profile = createProfile()
  profiles.push(profile)
  const listed = await cli(profile, DISCOVERY_ARGV)
  expect(listed.code).toBe(0)
  return JSON.parse(listed.stdout) as Envelope
}

function emittedRoutes(envelope: Envelope): Route[] {
  return envelope.runtimes.flatMap((runtime) => runtime.routes ?? [])
}

function firstRoute(routes: Route[], kind: string): Route {
  const route = routes.find((candidate) => candidate.kind === kind)
  if (!route) throw new Error(`no emitted ${kind} route`)
  return route
}

/** The four kind/profile combinations the delta spec forbids. */
function illegalCombinations(routes: Route[]): Record<string, Route> {
  const completion = firstRoute(routes, "completion")
  const agent = firstRoute(routes, "agent")
  return {
    "completion+batch": { ...completion, executionProfile: "batch" },
    "completion+policy-grant": {
      ...completion,
      executionProfile: "policy-grant",
    },
    "agent+null": { ...agent, executionProfile: null },
    "agent+interactive": { ...agent, executionProfile: "interactive" },
  }
}

function withRoute(envelope: Envelope, route: Route): Envelope {
  const copy = structuredClone(envelope)
  const target = copy.runtimes.find((runtime) =>
    (runtime.routes ?? []).some(
      (candidate) => candidate.routeId === route.routeId,
    ),
  )
  if (!target?.routes) throw new Error("route owner missing")
  target.routes = target.routes.map((candidate) =>
    candidate.routeId === route.routeId ? route : candidate,
  )
  return copy
}

function verdicts(
  check: (value: unknown) => boolean,
  values: Record<string, unknown>,
): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, check(value)]),
  )
}

describe("runtimeRouteSummary kind/executionProfile coupling", () => {
  test("the definition keeps its exact keys, additionalProperties:false and the closed-definition refs, and adds the two conditionals", () => {
    const summary = definitions(loadSchema()).runtimeRouteSummary
    const properties = summary.properties as Record<string, SchemaNode>
    expect({
      additionalProperties: summary.additionalProperties,
      required: summary.required,
      keys: Object.keys(properties).sort(),
      kind: properties.kind,
      executionProfile: properties.executionProfile,
      conditionals: (summary.allOf as SchemaNode[]).map((branch) => ({
        condition: branch.if,
        consequence: branch.then,
      })),
    }).toEqual({
      additionalProperties: false,
      required: [
        "routeId",
        "surface",
        "kind",
        "executionProfile",
        "adapterSource",
        "transport",
        "extensions",
      ],
      keys: [
        "adapterSource",
        "executionProfile",
        "extensions",
        "kind",
        "routeId",
        "surface",
        "transport",
      ],
      kind: { $ref: "#/$defs/jobKind" },
      executionProfile: {
        oneOf: [{ $ref: "#/$defs/executionProfile" }, { type: "null" }],
      },
      conditionals: [
        {
          condition: {
            properties: { kind: { const: "completion" } },
            required: ["kind"],
          },
          consequence: { properties: { executionProfile: { const: null } } },
        },
        {
          condition: {
            properties: { kind: { const: "agent" } },
            required: ["kind"],
          },
          consequence: {
            properties: {
              executionProfile: { $ref: "#/$defs/executionProfile" },
            },
          },
        },
      ],
    })
  })

  test("the real emitted summaries of api runtimes list --json --no-probe stay valid, one by one and as the whole envelope", async () => {
    const valid = validators(loadSchema())
    const envelope = await emittedDiscovery()
    const routes = emittedRoutes(envelope)
    expect(
      routes
        .map((route) => [route.kind, route.executionProfile])
        .map((pair) => JSON.stringify(pair))
        .sort(),
    ).toEqual(
      [
        ["agent", "batch"],
        ["agent", "batch"],
        ["agent", "policy-grant"],
        ["completion", null],
        ["completion", null],
      ]
        .map((pair) => JSON.stringify(pair))
        .sort(),
    )
    expect(routes.map((route) => valid.summary(route))).toEqual(
      routes.map(() => true),
    )
    expect(valid.envelope(envelope)).toBe(true)
  }, 60_000)

  test("completion+batch, completion+policy-grant, agent+null and agent+interactive are rejected, as a summary and inside the emitted envelope", async () => {
    const valid = validators(loadSchema())
    const envelope = await emittedDiscovery()
    const illegal = illegalCombinations(emittedRoutes(envelope))
    const rejectedEverywhere = {
      "completion+batch": false,
      "completion+policy-grant": false,
      "agent+null": false,
      "agent+interactive": false,
    }
    expect(verdicts(valid.summary, illegal)).toEqual(rejectedEverywhere)
    expect(
      verdicts(
        valid.envelope,
        Object.fromEntries(
          Object.entries(illegal).map(([name, route]) => [
            name,
            withRoute(envelope, route),
          ]),
        ),
      ),
    ).toEqual(rejectedEverywhere)
  }, 60_000)

  test("remove-the-fix: without the conditionals the schema accepts completion+batch, completion+policy-grant and agent+null (only agent+interactive stays rejected)", async () => {
    const reverted = loadSchema()
    delete definitions(reverted).runtimeRouteSummary.allOf
    const valid = validators(reverted)
    const envelope = await emittedDiscovery()
    expect(
      verdicts(valid.summary, illegalCombinations(emittedRoutes(envelope))),
    ).toEqual({
      "completion+batch": true,
      "completion+policy-grant": true,
      "agent+null": true,
      "agent+interactive": false,
    })
  }, 60_000)
})
