export type DefaultBranchSource = "local" | "remote" | "fallback"

export interface DefaultBranchResolution {
  branch: string
  source: DefaultBranchSource
}

interface DefaultBranchGit {
  getRemotes(): Promise<readonly { name: string }[]>
  raw(commands: string[]): Promise<string>
  branch(commands: string[]): Promise<{ all: string[] }>
}

export type DefaultBranchObservation =
  | {
      profile: "branch-listing"
      remoteBranches: readonly string[]
    }
  | {
      profile: "orphan-cleanup"
    }
  | {
      profile: "worktree"
    }

const FALLBACK: DefaultBranchResolution = {
  branch: "main",
  source: "fallback",
}

const LOCAL_BRANCH_PREFIX = "refs/heads/"

const WORKTREE_REMOTE_CANDIDATES = [
  "main",
  "master",
  "develop",
  "trunk",
] as const

function localResolution(branch: string): DefaultBranchResolution {
  return { branch, source: "local" }
}

function remoteResolution(branch: string): DefaultBranchResolution {
  return { branch, source: "remote" }
}

async function readCachedOriginHead(
  git: DefaultBranchGit,
): Promise<string | null> {
  try {
    const headRef = await git.raw(["symbolic-ref", "refs/remotes/origin/HEAD"])
    return headRef.trim().match(/^refs\/remotes\/origin\/(.+)$/)?.[1] ?? null
  } catch {
    return null
  }
}

function resolveLocalBranch(
  localBranches: readonly string[],
  currentBranch: string,
): DefaultBranchResolution {
  if (localBranches.includes("main")) {
    return localResolution("main")
  }
  if (localBranches.includes("master")) {
    return localResolution("master")
  }
  if (currentBranch && localBranches.includes(currentBranch)) {
    return localResolution(currentBranch)
  }
  return FALLBACK
}

async function resolveLocalOnlyBranch(
  git: DefaultBranchGit,
): Promise<DefaultBranchResolution> {
  try {
    const localRefs = await git.raw([
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads/",
    ])
    const localBranches = localRefs
      .split("\n")
      .map((ref) => ref.trim())
      .filter((ref) => ref.startsWith(LOCAL_BRANCH_PREFIX))
      .map((ref) => ref.slice(LOCAL_BRANCH_PREFIX.length))

    let currentBranch = ""
    try {
      const currentRef = (
        await git.raw(["symbolic-ref", "--quiet", "HEAD"])
      ).trim()
      currentBranch = currentRef.startsWith(LOCAL_BRANCH_PREFIX)
        ? currentRef.slice(LOCAL_BRANCH_PREFIX.length)
        : ""
    } catch {}

    return resolveLocalBranch(localBranches, currentBranch)
  } catch {
    return FALLBACK
  }
}

function normalizeRemoteBranches(branches: readonly string[]): string[] {
  return branches
    .filter((branch) => !branch.includes("->"))
    .map((branch) => branch.replace(/^origin\//, ""))
}

async function readWorktreeRemoteBranches(
  git: DefaultBranchGit,
): Promise<string[]> {
  try {
    const branches = await git.branch(["-r"])
    return normalizeRemoteBranches(branches.all)
  } catch {
    return []
  }
}

async function lookupOriginHead(git: DefaultBranchGit): Promise<string | null> {
  try {
    const result = await git.raw(["ls-remote", "--symref", "origin", "HEAD"])
    return result.match(/ref:\s+refs\/heads\/(.+?)\tHEAD/)?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * Resolves repository default-branch policy for the four main-process
 * consumers. The observation profile makes cached-only versus network-allowed
 * behavior explicit, while the result preserves whether the selected branch
 * is backed by a local ref, a remote fact, or only a compatibility fallback.
 */
export async function resolveDefaultBranch(
  git: DefaultBranchGit,
  observation: DefaultBranchObservation,
): Promise<DefaultBranchResolution> {
  let hasOrigin: boolean
  try {
    const remotes = await git.getRemotes()
    hasOrigin = remotes.some((remote) => remote.name === "origin")
  } catch {
    return FALLBACK
  }

  if (!hasOrigin) {
    return resolveLocalOnlyBranch(git)
  }

  const cachedOriginHead = await readCachedOriginHead(git)
  if (cachedOriginHead) {
    return remoteResolution(cachedOriginHead)
  }

  if (observation.profile === "orphan-cleanup") {
    return FALLBACK
  }

  const remoteBranches =
    observation.profile === "branch-listing"
      ? normalizeRemoteBranches(observation.remoteBranches)
      : await readWorktreeRemoteBranches(git)

  if (observation.profile === "branch-listing") {
    if (remoteBranches.includes("master") && !remoteBranches.includes("main")) {
      return remoteResolution("master")
    }
    return remoteBranches.includes("main") ? remoteResolution("main") : FALLBACK
  }

  for (const candidate of WORKTREE_REMOTE_CANDIDATES) {
    if (remoteBranches.includes(candidate)) {
      return remoteResolution(candidate)
    }
  }

  const remoteHead = await lookupOriginHead(git)
  return remoteHead ? remoteResolution(remoteHead) : FALLBACK
}
