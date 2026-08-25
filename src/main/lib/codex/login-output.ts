import { stripCodexAnsi } from "./ansi-cleanup"

const URL_CANDIDATE_REGEX = /https?:\/\/[^\s]+/g
const MAX_CODEX_LOGIN_URL_DISCOVERY_BUFFER_LENGTH = 64 * 1024

export const CODEX_LOGIN_OUTPUT_OMITTED =
  "[Codex login diagnostic output omitted]"

export type CodexLoginOutputSession = {
  rawOutput: string
  output: string
  url: string | null
}

export function isLocalhostHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.endsWith(".localhost")
  )
}

function extractNonLocalhostUrl(
  output: string,
  requireTerminatedCandidate: boolean,
): string | null {
  const cleanOutput = stripCodexAnsi(output)
  for (const candidate of cleanOutput.matchAll(URL_CANDIDATE_REGEX)) {
    const match = candidate[0]
    const matchEnd = (candidate.index ?? 0) + match.length
    if (
      requireTerminatedCandidate &&
      matchEnd === cleanOutput.length &&
      !/[),.;!?]$/.test(match)
    ) {
      continue
    }
    try {
      const parsedUrl = new URL(match.trim().replace(/[),.;!?]+$/, ""))
      if (!isLocalhostHostname(parsedUrl.hostname)) {
        return parsedUrl.toString()
      }
    } catch {
      // Ignore invalid URL candidates.
    }
  }

  return null
}

export function extractFirstNonLocalhostUrl(output: string): string | null {
  return extractNonLocalhostUrl(output, false)
}

export function redactCodexLoginUrlForDisplay(match: string): string {
  const trailingMatch = match.match(/[),.;!?]+$/)
  const trailing = trailingMatch?.[0] ?? ""
  const rawUrl = trailing ? match.slice(0, -trailing.length) : match

  try {
    const parsedUrl = new URL(rawUrl)
    if (isLocalhostHostname(parsedUrl.hostname)) {
      return match
    }

    const hadSearch = parsedUrl.search.length > 0
    const hadHash = parsedUrl.hash.length > 0
    parsedUrl.search = ""
    parsedUrl.hash = ""

    return [
      parsedUrl.toString(),
      hadSearch ? "?[redacted]" : "",
      hadHash ? "#[redacted]" : "",
      trailing,
    ].join("")
  } catch {
    return match
  }
}

export function redactCodexLoginOutput(output: string): string {
  return output
    .replace(URL_CANDIDATE_REGEX, redactCodexLoginUrlForDisplay)
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "sk-[redacted]")
    .replace(
      /("(?:access|refresh|id)_?token"\s*:\s*")[^"]+(")/gi,
      "$1[redacted]$2",
    )
    .replace(
      /\b((?:access|refresh|id)_?token|code|state|nonce|verifier)\s*=\s*[^\s]+/gi,
      "$1=[redacted]",
    )
}

export function appendCodexLoginOutput(
  session: CodexLoginOutputSession,
  chunk: string,
): void {
  const cleanChunk = stripCodexAnsi(chunk)
  if (!cleanChunk) return

  if (!session.url) {
    const discoveryBuffer = `${session.rawOutput}${cleanChunk}`
    session.url = extractNonLocalhostUrl(discoveryBuffer, true)
    session.rawOutput = session.url
      ? ""
      : discoveryBuffer.slice(-MAX_CODEX_LOGIN_URL_DISCOVERY_BUFFER_LENGTH)
  }
  // Login stdout/stderr is credential-bound and arrives on arbitrary stream
  // boundaries. A partial URL, state, code, or API key cannot be safely
  // classified until a future chunk arrives, so none of it is exposed to the
  // renderer. The separately extracted authorization URL remains available.
  session.output = CODEX_LOGIN_OUTPUT_OMITTED
}
