import {
  normalizeExactSecretHints,
  redactExactSecretValues,
} from "../../../shared/secret-redaction-policy"
import type { JsonValue, RunEventRedactionContext } from "./runtime-events"

const SECRET_KEY_PATTERN =
  /(?:api[_-]?key|(?:^|[_-])token(?:$|[_-])|access[_-]?token|refresh[_-]?token|auth[_-]?token|gateway[_-]?token|authorization|cookie|password|secret|client[_-]?secret|oauth)/i

type SecretTextPattern = {
  pattern: RegExp
  /** Replacement for one match; defaults to keeping a `key=`/`key:` prefix. */
  replace?: (match: string) => string
}

const SECRET_TEXT_PATTERNS: readonly SecretTextPattern[] = [
  { pattern: /sk-[A-Za-z0-9_-]{16,}/g },
  { pattern: /bearer\s+[A-Za-z0-9._-]+/gi },
  {
    pattern:
      /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|authorization)=([A-Za-z0-9._~+/-]+)/gi,
  },
  {
    pattern:
      /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|password|secret|authorization)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{8,}["']?/gi,
  },
]

/**
 * Additional free-text patterns for untrusted page diagnostics only (Local
 * Browser guest console text, titles, DOM text). Page text routinely carries
 * bare JWTs, OAuth/OIDC callback parameters and scheme-less URLs whose query
 * or fragment the shared URL minimizer cannot recognize. Runtime payload
 * redaction keeps the base patterns so agent transcripts are not rewritten.
 */
const UNTRUSTED_DIAGNOSTIC_TEXT_PATTERNS: readonly SecretTextPattern[] = [
  // Bare JWT/JWS compact serialization: a base64url JSON header ("eyJ").
  {
    pattern: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g,
    replace: () => "<redacted>",
  },
  // A scheme-less query string or fragment carrying key=value pairs.
  {
    pattern: /[?#][^\s?#"'<>]*=[^\s"'<>]*/g,
    replace: (match) => `${match.charAt(0)}<redacted>`,
  },
  // OAuth/OIDC callback parameters anywhere else in free text.
  {
    pattern:
      /\b(?:code|state|nonce|id_token|session_state|code_verifier|code_challenge)=[^\s&#"'<>]+/gi,
  },
  ...SECRET_TEXT_PATTERNS,
]

function keepSecretKeyPrefix(match: string): string {
  const separatorIndex = Math.max(match.indexOf("="), match.indexOf(":"))
  if (separatorIndex > 0) {
    return `${match.slice(0, separatorIndex + 1)}<redacted>`
  }
  return "<redacted>"
}

export type RuntimeRedactionResult = {
  payload: JsonValue
  appliedRules: string[]
}

export type ExactSecretStreamRedactionResult = {
  value: string
  applied: boolean
  redactionCount: number
  hasPendingSuffix: boolean
}

export type ExactSecretStreamRedactor = {
  push(
    value: string,
    secretHints?: readonly string[],
  ): ExactSecretStreamRedactionResult
  flush(secretHints?: readonly string[]): ExactSecretStreamRedactionResult
}

export type ExactSecretStreamFragment<T> = {
  channel: string
  value: string
  withValue: (value: string) => T
}

export type ExactSecretStreamChannelRedaction<T> = {
  value: T
  applied: boolean
}

export type ExactSecretStreamChannelRedactor<T> = {
  push(
    fragment: ExactSecretStreamFragment<T>,
    secretHints?: readonly string[],
  ): ExactSecretStreamChannelRedaction<T>
  flushChannels(
    channels: readonly string[],
    secretHints?: readonly string[],
  ): ExactSecretStreamChannelRedaction<T>[]
  flush(secretHints?: readonly string[]): ExactSecretStreamChannelRedaction<T>[]
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function redactExactSecretHints(
  value: string,
  secretHints: readonly string[] | undefined,
): { value: string; applied: boolean; redactionCount: number } {
  return redactExactSecretValues(value, secretHints)
}

function longestPossibleSecretPrefixSuffix(
  value: string,
  secretHints: readonly string[],
): number {
  let longest = 0
  for (const hint of secretHints) {
    const maxLength = Math.min(value.length, hint.length - 1)
    for (let length = maxLength; length > longest; length -= 1) {
      if (hint.startsWith(value.slice(-length))) {
        longest = length
        break
      }
    }
  }
  return longest
}

/**
 * Redacts exact secret values across adjacent stream fragments.
 *
 * The redactor retains only a bounded suffix which could still become the
 * prefix of a configured secret on the next fragment. Callers own stream
 * channel boundaries and must flush at the channel's terminal boundary. This
 * is the sole stateful exact-secret algorithm for runtimes.
 */
export function createExactSecretStreamRedactor(): ExactSecretStreamRedactor {
  let pendingSuffix = ""
  let knownSecretHints: string[] = []

  const mergeSecretHints = (
    secretHints: readonly string[] | undefined,
  ): string[] => {
    knownSecretHints = normalizeExactSecretHints([
      ...knownSecretHints,
      ...(secretHints ?? []),
    ])
    return knownSecretHints
  }

  return {
    push(value, secretHints) {
      const hints = mergeSecretHints(secretHints)
      const redacted = redactExactSecretHints(`${pendingSuffix}${value}`, hints)
      const pendingLength = longestPossibleSecretPrefixSuffix(
        redacted.value,
        hints,
      )
      pendingSuffix =
        pendingLength > 0 ? redacted.value.slice(-pendingLength) : ""
      return {
        value:
          pendingLength > 0
            ? redacted.value.slice(0, -pendingLength)
            : redacted.value,
        applied: redacted.applied,
        redactionCount: redacted.redactionCount,
        hasPendingSuffix: pendingLength > 0,
      }
    },
    flush(secretHints) {
      const hints = mergeSecretHints(secretHints)
      const redacted = redactExactSecretHints(pendingSuffix, hints)
      pendingSuffix = ""
      knownSecretHints = []
      return {
        value: redacted.value,
        applied: redacted.applied,
        redactionCount: redacted.redactionCount,
        hasPendingSuffix: false,
      }
    },
  }
}

type ExactSecretStreamChannelState<T> = {
  redactor: ExactSecretStreamRedactor
  pendingFragment: ExactSecretStreamFragment<T>
  pendingSinceOrder: number
}

/** Owns per-channel buffering and ordered terminal flush for exact secrets. */
export function createExactSecretStreamChannelRedactor<
  T,
>(): ExactSecretStreamChannelRedactor<T> {
  const states = new Map<string, ExactSecretStreamChannelState<T>>()
  let observedOrder = 0

  const flushChannels = (
    channels: readonly string[],
    secretHints?: readonly string[],
  ): ExactSecretStreamChannelRedaction<T>[] => {
    const output: ExactSecretStreamChannelRedaction<T>[] = []
    const orderedStates = [...new Set(channels)]
      .map((channel) => ({ channel, state: states.get(channel) }))
      .filter(
        (
          entry,
        ): entry is {
          channel: string
          state: ExactSecretStreamChannelState<T>
        } => Boolean(entry.state),
      )
      .sort(
        (left, right) =>
          left.state.pendingSinceOrder - right.state.pendingSinceOrder,
      )
    for (const { channel, state } of orderedStates) {
      const redacted = state.redactor.flush(secretHints)
      states.delete(channel)
      if (!redacted.value) continue
      output.push({
        value: state.pendingFragment.withValue(redacted.value),
        applied: redacted.applied,
      })
    }
    return output
  }

  return {
    push(fragment, secretHints) {
      observedOrder += 1
      const state = states.get(fragment.channel) ?? {
        redactor: createExactSecretStreamRedactor(),
        pendingFragment: fragment,
        pendingSinceOrder: observedOrder,
      }
      const redacted = state.redactor.push(fragment.value, secretHints)
      state.pendingFragment = fragment
      if (redacted.hasPendingSuffix) {
        states.set(fragment.channel, state)
      } else {
        states.delete(fragment.channel)
      }
      return {
        value: fragment.withValue(redacted.value),
        applied: redacted.applied,
      }
    },
    flushChannels,
    flush(secretHints) {
      return flushChannels([...states.keys()], secretHints)
    },
  }
}

function redactString(
  value: string,
  appliedRules: Set<string>,
  secretHints: readonly string[],
  textPatterns: readonly SecretTextPattern[],
): string {
  const exactRedaction = redactExactSecretHints(value, secretHints)
  let redacted = exactRedaction.value
  if (exactRedaction.applied) {
    appliedRules.add("secret-hint")
  }
  for (const { pattern, replace } of textPatterns) {
    if (pattern.test(redacted)) {
      appliedRules.add("secret-text")
      pattern.lastIndex = 0
      redacted = redacted.replace(pattern, replace ?? keepSecretKeyPrefix)
    }
    pattern.lastIndex = 0
  }
  return redacted
}

function redactValue(
  value: JsonValue,
  appliedRules: Set<string>,
  secretHints: readonly string[],
  textPatterns: readonly SecretTextPattern[],
): JsonValue {
  if (typeof value === "string") {
    return redactString(value, appliedRules, secretHints, textPatterns)
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      redactValue(item, appliedRules, secretHints, textPatterns),
    )
  }
  if (!isJsonObject(value)) return value

  const output: { [key: string]: JsonValue } = {}
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      appliedRules.add("secret-key")
      output[key] = "<redacted>"
      continue
    }
    output[key] = redactValue(child, appliedRules, secretHints, textPatterns)
  }
  return output
}

function redactPayloadWith(
  payload: JsonValue,
  secretHints: readonly string[] | undefined,
  textPatterns: readonly SecretTextPattern[],
): RuntimeRedactionResult {
  const appliedRules = new Set<string>()
  const normalizedHints = normalizeExactSecretHints(secretHints)
  return {
    payload: redactValue(payload, appliedRules, normalizedHints, textPatterns),
    appliedRules: [...appliedRules].sort(),
  }
}

export function redactRuntimePayload(
  payload: JsonValue,
  context: RunEventRedactionContext,
): RuntimeRedactionResult {
  return redactPayloadWith(payload, context.secretHints, SECRET_TEXT_PATTERNS)
}

/**
 * Composition entry for main-process diagnostics that are not tied to an
 * agent run (for example Local Browser guest diagnostics). It applies the
 * same provider-pattern, secret-key and exact-secret matching as
 * {@link redactRuntimePayload}, plus the untrusted page-text patterns (bare
 * JWTs, OAuth/OIDC callback parameters, scheme-less query strings and
 * fragments), without fabricating a runtime/run identity, so callers never
 * re-implement secret matching.
 */
export function redactUntrustedDiagnosticPayload(
  payload: JsonValue,
  secretHints?: readonly string[],
): RuntimeRedactionResult {
  return redactPayloadWith(
    payload,
    secretHints,
    UNTRUSTED_DIAGNOSTIC_TEXT_PATTERNS,
  )
}
