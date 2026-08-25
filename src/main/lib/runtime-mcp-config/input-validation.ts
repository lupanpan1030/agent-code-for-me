import { z } from "zod"

const ENV_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/
const HTTP_HEADER_NAME_REGEX = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

function assertNoNullByte(value: string, label: string): void {
  if (value.includes("\0")) {
    throw new Error(`${label} must not contain null bytes`)
  }
}

function assertNoHeaderControlChars(value: string, label: string): void {
  assertNoNullByte(value, label)
  if (/[\r\n]/.test(value)) {
    throw new Error(`${label} must not contain header control characters`)
  }
}

function normalizeRequiredString(
  value: string | undefined,
  label: string,
): string {
  const normalized = value?.trim() ?? ""
  assertNoNullByte(normalized, label)
  if (!normalized) {
    throw new Error(`${label} is required`)
  }
  return normalized
}

export function assertMcpEnvName(value: string, label: string): string {
  const normalized = value.trim()
  assertNoNullByte(normalized, label)
  if (normalized !== value || !ENV_NAME_REGEX.test(normalized)) {
    throw new Error(`${label} must be a valid environment variable name`)
  }
  return normalized
}

export function normalizeMcpCommand(
  value: string | undefined,
  label = "MCP command",
): string {
  return normalizeRequiredString(value, label)
}

export function normalizeMcpServerUrl(
  value: string | undefined,
  label = "MCP server URL",
): string {
  const normalized = normalizeRequiredString(value, label)
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error(`${label} must be a valid URL`)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must use http or https`)
  }
  return normalized
}

export function normalizeMcpArgs(
  args: string[] | undefined,
  label = "MCP args",
): string[] | undefined {
  if (args === undefined) return undefined
  return args.map((arg, index) => {
    assertNoNullByte(arg, `${label}[${index}]`)
    return arg
  })
}

export function normalizeMcpEnv(
  env: Record<string, string> | undefined,
  label = "MCP env",
): Record<string, string> | undefined {
  if (env === undefined) return undefined
  const normalized: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(env)) {
    const key = assertMcpEnvName(rawKey, `${label} key`)
    assertNoNullByte(rawValue, `${label} value for ${key}`)
    normalized[key] = rawValue
  }
  return normalized
}

export function zodMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid input"
}

export const mcpStringInputSchema = z
  .string()
  .refine((value) => !value.includes("\0"), {
    message: "Value must not contain null bytes",
  })

export const mcpArgsInputSchema = z
  .array(mcpStringInputSchema)
  .superRefine((value, ctx) => {
    try {
      normalizeMcpArgs(value)
    } catch (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: zodMessage(error) })
    }
  })

export const mcpEnvInputSchema = z
  .record(z.string(), z.string())
  .superRefine((value, ctx) => {
    try {
      normalizeMcpEnv(value)
    } catch (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: zodMessage(error) })
    }
  })

export const mcpUrlInputSchema = z.string().superRefine((value, ctx) => {
  try {
    normalizeMcpServerUrl(value)
  } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: zodMessage(error) })
  }
})

export function normalizeMcpEnvNames(
  envNames: string[] | undefined,
  label = "MCP env vars",
): string[] | undefined {
  if (envNames === undefined) return undefined
  return envNames.map((envName, index) =>
    assertMcpEnvName(envName, `${label}[${index}]`),
  )
}

function assertMcpHeaderName(value: string, label: string): string {
  const normalized = value.trim()
  assertNoNullByte(normalized, label)
  if (normalized !== value || !HTTP_HEADER_NAME_REGEX.test(normalized)) {
    throw new Error(`${label} must be a valid HTTP header name`)
  }
  return normalized
}

export function normalizeMcpHeaders(
  headers: Record<string, string> | undefined,
  label = "MCP headers",
): Record<string, string> | undefined {
  if (headers === undefined) return undefined
  const normalized: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    const key = assertMcpHeaderName(rawKey, `${label} key`)
    assertNoHeaderControlChars(rawValue, `${label} value for ${key}`)
    normalized[key] = rawValue
  }
  return normalized
}

export function normalizeMcpEnvHeaderMap(
  headers: Record<string, string> | undefined,
  label = "MCP env header map",
): Record<string, string> | undefined {
  if (headers === undefined) return undefined
  const normalized: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    const key = assertMcpHeaderName(rawKey, `${label} key`)
    normalized[key] = assertMcpEnvName(rawValue, `${label} value for ${key}`)
  }
  return normalized
}

export function normalizeMcpServerConfigForWrite<
  T extends Record<string, unknown>,
>(config: T): T {
  const normalized: Record<string, unknown> = { ...config }

  if (typeof normalized.command === "string") {
    normalized.command = normalizeMcpCommand(normalized.command)
  }
  if (Array.isArray(normalized.args)) {
    normalized.args = normalizeMcpArgs(normalized.args)
  }
  if (
    normalized.env &&
    typeof normalized.env === "object" &&
    !Array.isArray(normalized.env)
  ) {
    normalized.env = normalizeMcpEnv(normalized.env as Record<string, string>)
  }
  if (typeof normalized.cwd === "string") {
    assertNoNullByte(normalized.cwd, "MCP cwd")
  }
  if (typeof normalized.url === "string") {
    normalized.url = normalizeMcpServerUrl(normalized.url)
  }
  if (
    normalized.headers &&
    typeof normalized.headers === "object" &&
    !Array.isArray(normalized.headers)
  ) {
    normalized.headers = normalizeMcpHeaders(
      normalized.headers as Record<string, string>,
    )
  }
  if (
    normalized.envHttpHeaders &&
    typeof normalized.envHttpHeaders === "object" &&
    !Array.isArray(normalized.envHttpHeaders)
  ) {
    normalized.envHttpHeaders = normalizeMcpEnvHeaderMap(
      normalized.envHttpHeaders as Record<string, string>,
    )
  }
  if (typeof normalized.bearerTokenEnvVar === "string") {
    normalized.bearerTokenEnvVar = assertMcpEnvName(
      normalized.bearerTokenEnvVar,
      "MCP bearer token env var",
    )
  }
  if (Array.isArray(normalized.envVars)) {
    normalized.envVars = normalizeMcpEnvNames(normalized.envVars)
  }
  if (typeof normalized.transportType === "string") {
    assertNoNullByte(normalized.transportType, "MCP transport type")
  }

  return normalized as T
}
