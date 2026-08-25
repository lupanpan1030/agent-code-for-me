import { execWithShellEnv } from "../git/shell-env"
import { normaliseDuration } from "./deep-conflict-deadline"
import type {
  MergeTreeCapability,
  MergeTreeTrialOptions,
  MergeTreeTrialResult,
} from "./deep-conflict-types"

export const MERGE_TREE_MINIMUM_VERSION = "2.38.0" as const
export const DEFAULT_MERGE_TREE_TRIAL_TIMEOUT_MS = 15_000

type ParsedVersion = {
  major: number
  minor: number
  patch: number
}

function parseVersion(output: string): ParsedVersion | null {
  const match = output.match(/\bgit version\s+(\d+)\.(\d+)(?:\.(\d+))?/i)
  if (!match) return null

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0),
  }
}

function formatVersion(version: ParsedVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`
}

function supportsMergeTree(version: ParsedVersion): boolean {
  if (version.major !== 2) return version.major > 2
  return version.minor >= 38
}

export function parseGitMergeTreeCapability(
  versionOutput: string,
): MergeTreeCapability {
  const version = parseVersion(versionOutput)
  if (!version) {
    return {
      available: false,
      gitVersion: null,
      minimumVersion: MERGE_TREE_MINIMUM_VERSION,
      reason: "version-unparseable",
    }
  }

  const gitVersion = formatVersion(version)
  if (!supportsMergeTree(version)) {
    return {
      available: false,
      gitVersion,
      minimumVersion: MERGE_TREE_MINIMUM_VERSION,
      reason: "git-too-old",
    }
  }

  return {
    available: true,
    gitVersion,
    minimumVersion: MERGE_TREE_MINIMUM_VERSION,
    reason: null,
  }
}

export function createMergeTreeCapabilityProbe(
  readVersion: () => Promise<string>,
): () => Promise<MergeTreeCapability> {
  let cachedProbe: Promise<MergeTreeCapability> | null = null

  return () => {
    cachedProbe ??= (async () => {
      try {
        return parseGitMergeTreeCapability(await readVersion())
      } catch {
        return {
          available: false,
          gitVersion: null,
          minimumVersion: MERGE_TREE_MINIMUM_VERSION,
          reason: "version-unavailable",
        }
      }
    })()
    return cachedProbe
  }
}

const probeMergeTreeCapabilityOnce = createMergeTreeCapabilityProbe(
  async () => {
    const { stdout } = await execWithShellEnv("git", ["--version"])
    return stdout
  },
)

export function probeMergeTreeCapability(): Promise<MergeTreeCapability> {
  return probeMergeTreeCapabilityOnce()
}

function readExecFailure(error: unknown): {
  code: number | string | undefined
  stdout: string
  timedOut: boolean
} {
  if (!error || typeof error !== "object") {
    return { code: undefined, stdout: "", timedOut: false }
  }

  const execError = error as {
    code?: number | string | null
    stdout?: unknown
    killed?: unknown
    signal?: unknown
  }
  return {
    code: execError.code ?? undefined,
    stdout:
      typeof execError.stdout === "string"
        ? execError.stdout
        : Buffer.isBuffer(execError.stdout)
          ? execError.stdout.toString("utf8")
          : "",
    timedOut: execError.killed === true && execError.signal !== undefined,
  }
}

export function isMergeTreeConflictExitCode(
  code: number | string | undefined,
): boolean {
  return Number(code) === 1
}

/**
 * `merge-tree --name-only -z` writes the tree id first, then conflicting
 * paths, then an empty NUL field before informational message tuples.
 */
export function parseMergeTreeConflictPaths(output: string): string[] {
  const fields = output.split("\0")
  if (fields.length < 2) return []

  const paths: string[] = []
  for (let index = 1; index < fields.length; index += 1) {
    const field = fields[index]
    if (!field) break
    paths.push(field)
  }
  return Array.from(new Set(paths)).sort()
}

export async function runGitMergeTreeTrial(
  projectPath: string,
  leftCommitSha: string,
  rightCommitSha: string,
  options: MergeTreeTrialOptions = {},
): Promise<MergeTreeTrialResult> {
  const args = [
    "-C",
    projectPath,
    "merge-tree",
    "--write-tree",
    "--name-only",
    "-z",
    "--",
    leftCommitSha,
    rightCommitSha,
  ]

  try {
    await execWithShellEnv("git", args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: normaliseDuration(
        options.timeoutMs,
        DEFAULT_MERGE_TREE_TRIAL_TIMEOUT_MS,
      ),
    })
    return { status: "clean", reason: null, conflictPaths: [] }
  } catch (error) {
    const failure = readExecFailure(error)
    if (failure.timedOut) {
      return {
        status: "unavailable",
        reason: "trial-failed",
        unavailableDetail: "trial-timeout",
        conflictPaths: [],
      }
    }
    if (isMergeTreeConflictExitCode(failure.code)) {
      if (failure.stdout.length === 0) {
        return {
          status: "unavailable",
          reason: "trial-failed",
          conflictPaths: [],
        }
      }
      return {
        status: "conflict",
        reason: null,
        conflictPaths: parseMergeTreeConflictPaths(failure.stdout),
      }
    }

    return {
      status: "unavailable",
      reason: "trial-failed",
      conflictPaths: [],
    }
  }
}
