/**
 * Canonical unified-diff parser shared by the main and renderer processes.
 *
 * Keep path decoding, validation, hunk extraction, and parsed-file metadata in
 * this module. Consumers must import it directly instead of maintaining a
 * process-specific parser or compatibility facade.
 */

export interface ParsedDiffFile {
  key: string
  oldPath: string
  newPath: string
  diffText: string
  isBinary: boolean
  additions: number
  deletions: number
  isValid: boolean
  fileLang: string | null
  isNewFile: boolean
  isDeletedFile: boolean
  hunks?: {
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
  }[]
}

/**
 * Language mapping for syntax highlighting
 */
const LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  css: "css",
  scss: "scss",
  less: "less",
  json: "json",
  md: "markdown",
  mdx: "markdown",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  yaml: "yaml",
  yml: "yaml",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  vue: "vue",
  svelte: "svelte",
}

const hunkHeaderRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
const gitPathEncoder = new TextEncoder()
const gitPathDecoder = new TextDecoder()
const gitPathEscapeBytes: Record<string, number> = {
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
  '"': 0x22,
  "\\": 0x5c,
}

function decodeGitPath(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"')) return path

  const quoted = path.slice(1, -1)
  const bytes: number[] = []
  const appendText = (value: string) => {
    bytes.push(...gitPathEncoder.encode(value))
  }

  let cursor = 0
  while (cursor < quoted.length) {
    const escapeIndex = quoted.indexOf("\\", cursor)
    if (escapeIndex === -1) {
      appendText(quoted.slice(cursor))
      break
    }

    appendText(quoted.slice(cursor, escapeIndex))
    const escaped = quoted[escapeIndex + 1]
    if (escaped === undefined) {
      appendText("\\")
      break
    }

    if (escaped >= "0" && escaped <= "7") {
      let octalEnd = escapeIndex + 2
      while (octalEnd < quoted.length && octalEnd < escapeIndex + 4) {
        const octalDigit = quoted[octalEnd]
        if (octalDigit === undefined || octalDigit < "0" || octalDigit > "7") {
          break
        }
        octalEnd += 1
      }
      bytes.push(Number.parseInt(quoted.slice(escapeIndex + 1, octalEnd), 8))
      cursor = octalEnd
      continue
    }

    const escapedByte = gitPathEscapeBytes[escaped]
    if (escapedByte === undefined) {
      appendText(`\\${escaped}`)
    } else {
      bytes.push(escapedByte)
    }
    cursor = escapeIndex + 2
  }

  return gitPathDecoder.decode(Uint8Array.from(bytes))
}

function readQuotedGitPathToken(
  value: string,
  start: number,
): { token: string; end: number } | null {
  if (value[start] !== '"') return null

  let escaped = false
  for (let cursor = start + 1; cursor < value.length; cursor += 1) {
    const character = value[cursor]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === "\\") {
      escaped = true
      continue
    }
    if (character === '"') {
      return { token: value.slice(start, cursor + 1), end: cursor + 1 }
    }
  }
  return null
}

function stripGitDiffPrefix(path: string, prefix: "a/" | "b/"): string {
  const decoded = decodeGitPath(path)
  return decoded.startsWith(prefix) ? decoded.slice(prefix.length) : decoded
}

/**
 * Parse the two paths in a `diff --git` header. Git C-quotes non-ASCII paths,
 * including binary files that have no `---`/`+++` fallback headers. Ordinary
 * paths containing spaces remain unquoted, so the unquoted branch retains
 * Git's conventional ` a/... b/...` boundary handling.
 */
function parseDiffGitHeaderPaths(
  line: string,
): { oldPath: string; newPath: string } | null {
  const prefix = "diff --git "
  if (!line.startsWith(prefix)) return null
  const value = line.slice(prefix.length)

  if (value.startsWith('"')) {
    const oldToken = readQuotedGitPathToken(value, 0)
    if (!oldToken) return null
    const nextStart = value.slice(oldToken.end).search(/\S/)
    if (nextStart < 0) return null
    const absoluteNextStart = oldToken.end + nextStart
    const quotedNewToken = readQuotedGitPathToken(value, absoluteNextStart)
    const newToken = quotedNewToken?.token ?? value.slice(absoluteNextStart)
    return {
      oldPath: stripGitDiffPrefix(oldToken.token, "a/"),
      newPath: stripGitDiffPrefix(newToken, "b/"),
    }
  }

  const boundary = value.lastIndexOf(" b/")
  if (!value.startsWith("a/") || boundary < 2) return null
  return {
    oldPath: stripGitDiffPrefix(value.slice(0, boundary), "a/"),
    newPath: stripGitDiffPrefix(value.slice(boundary + 1), "b/"),
  }
}

/**
 * Get language identifier for syntax highlighting
 */
export function getFileLang(filePath: string): string | null {
  if (!filePath || filePath === "/dev/null") return null
  const ext = filePath.split(".").pop()?.toLowerCase() || ""
  return LANG_MAP[ext] || ext || null
}

/**
 * Validate if a diff hunk has valid structure
 * This is a lenient validator - only reject clearly malformed diffs
 */
function validateDiffHunk(diffText: string): {
  valid: boolean
  reason?: string
} {
  if (!diffText || diffText.trim().length === 0) {
    return { valid: false, reason: "empty diff" }
  }

  const lines = diffText.split("\n")
  // Find the --- and +++ lines
  const minusLineIdx = lines.findIndex((l) => l.startsWith("--- "))
  const plusLineIdx = lines.findIndex((l) => l.startsWith("+++ "))

  // Check for special cases that don't have hunks
  const hasCompleteRename =
    lines.some((line) => line.startsWith("rename from ")) &&
    lines.some((line) => line.startsWith("rename to "))
  const hasPureRename =
    hasCompleteRename && lines.some((line) => line === "similarity index 100%")
  const hasCompleteModeChange =
    lines.some((line) => line.startsWith("old mode ")) &&
    lines.some((line) => line.startsWith("new mode "))
  const hasBinaryMarker = lines.some(
    (line) => line.startsWith("Binary files ") && line.endsWith(" differ"),
  )
  if (hasPureRename || hasCompleteModeChange || hasBinaryMarker) {
    return { valid: true }
  }

  // Must have both header lines
  if (minusLineIdx === -1 || plusLineIdx === -1) {
    return { valid: false, reason: "missing header lines" }
  }

  // +++ must come after ---
  if (plusLineIdx <= minusLineIdx) {
    return { valid: false, reason: "header order wrong" }
  }

  // Must have at least one hunk header after +++ line
  let hasHunk = false
  for (let i = plusLineIdx + 1; i < lines.length; i++) {
    if (hunkHeaderRegex.test(lines[i] ?? "")) {
      hasHunk = true
      break
    }
  }

  if (!hasHunk) {
    return { valid: false, reason: "no hunk headers found" }
  }

  return { valid: true }
}

/**
 * Split a unified diff into separate file diffs
 */
export function splitUnifiedDiffByFile(diffText: string): ParsedDiffFile[] {
  if (!diffText?.trim()) {
    return []
  }

  const normalized = diffText.replace(/\r\n/g, "\n")
  const lines = normalized.split("\n")

  const blocks: string[] = []
  let current: string[] = []

  const pushCurrent = () => {
    const text = current.join("\n").trim()
    if (
      text &&
      (text.startsWith("diff --git ") ||
        text.startsWith("--- ") ||
        text.startsWith("+++ ") ||
        text.startsWith("Binary files ") ||
        text.includes("\n+++ ") ||
        text.includes("\nBinary files "))
    ) {
      blocks.push(text)
    }
    current = []
  }

  for (const line of lines) {
    if (line.startsWith("diff --git ") && current.length > 0) {
      pushCurrent()
    }
    current.push(line)
  }
  pushCurrent()

  return blocks.map((blockText, index) => {
    const blockLines = blockText.split("\n")
    let oldPath = ""
    let newPath = ""
    let isBinary = false
    let additions = 0
    let deletions = 0
    let hasRenameFrom = false
    let hasRenameTo = false
    const hunks: NonNullable<ParsedDiffFile["hunks"]> = []

    for (const line of blockLines) {
      const hunkMatch = line.match(hunkHeaderRegex)
      if (hunkMatch) {
        hunks.push({
          oldStart: Number(hunkMatch[1]),
          oldLines: hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]),
          newStart: Number(hunkMatch[3]),
          newLines: hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]),
        })
      }

      if (line.startsWith("diff --git ")) {
        // Fallback: parse paths from "diff --git a/path b/path"
        // Needed for binary files that don't have ---/+++ lines
        const parsedPaths = parseDiffGitHeaderPaths(line)
        if (parsedPaths) {
          if (!oldPath) oldPath = parsedPaths.oldPath
          if (!newPath) newPath = parsedPaths.newPath
        }
      }

      if (line.startsWith("Binary files ") && line.endsWith(" differ")) {
        isBinary = true
      }

      if (line.startsWith("rename from ")) {
        oldPath = decodeGitPath(line.slice("rename from ".length))
        hasRenameFrom = true
      }

      if (line.startsWith("rename to ")) {
        newPath = decodeGitPath(line.slice("rename to ".length))
        hasRenameTo = true
      }

      if (line.startsWith("--- ") && !hasRenameFrom) {
        const decoded = decodeGitPath(line.slice(4).trim())
        oldPath = decoded.startsWith("a/") ? decoded.slice(2) : decoded
      }

      if (line.startsWith("+++ ") && !hasRenameTo) {
        const decoded = decodeGitPath(line.slice(4).trim())
        newPath = decoded.startsWith("b/") ? decoded.slice(2) : decoded
      }

      if (line.startsWith("+") && !line.startsWith("+++ ")) {
        additions += 1
      } else if (line.startsWith("-") && !line.startsWith("--- ")) {
        deletions += 1
      }
    }

    const key = oldPath || newPath ? `${oldPath}->${newPath}` : `file-${index}`
    const validation = isBinary ? { valid: true } : validateDiffHunk(blockText)
    const isValid = validation.valid

    const isNewFile = oldPath === "/dev/null"
    const isDeletedFile = newPath === "/dev/null"

    const actualPath = isNewFile
      ? newPath
      : isDeletedFile
        ? oldPath
        : newPath || oldPath
    const fileLang = getFileLang(actualPath)

    return {
      key,
      oldPath,
      newPath,
      diffText: blockText,
      isBinary,
      additions,
      deletions,
      isValid,
      fileLang,
      isNewFile,
      isDeletedFile,
      ...(isBinary ? {} : { hunks }),
    }
  })
}

export interface ParsedDiffResponse {
  files: ParsedDiffFile[]
  totalAdditions: number
  totalDeletions: number
  fileContents: Record<string, string>
}
