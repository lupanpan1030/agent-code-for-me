export type ConflictVerdictFingerprint = {
  statusHash: string
  headSha: string | null
}

function hasConflictPairVerdictStatusMismatch(
  taskIds: readonly string[],
  currentStatusHashes: Readonly<Record<string, string | undefined>>,
  fingerprints: Readonly<
    Record<string, ConflictVerdictFingerprint | undefined>
  >,
): boolean {
  return taskIds.some((taskId) => {
    const currentStatusHash = currentStatusHashes[taskId]
    const computedStatusHash = fingerprints[taskId]?.statusHash
    return (
      currentStatusHash === undefined ||
      computedStatusHash === undefined ||
      currentStatusHash !== computedStatusHash
    )
  })
}

export type ConflictVerdictStalenessLatch = {
  isPairStale: (
    taskIds: readonly string[],
    currentStatusHashes: Readonly<Record<string, string | undefined>>,
    fingerprints: Readonly<
      Record<string, ConflictVerdictFingerprint | undefined>
    >,
  ) => boolean
  observePair: (
    taskIds: readonly string[],
    currentStatusHashes: Readonly<Record<string, string | undefined>>,
    fingerprints: Readonly<
      Record<string, ConflictVerdictFingerprint | undefined>
    >,
  ) => void
  reset: () => void
}

function getPairKey(taskIds: readonly string[]): string {
  return taskIds.slice().sort().join("\0")
}

/**
 * Latches passive staleness until a successful explicit re-run resets it.
 * HEAD is retained as verdict provenance, but only the status hash participates
 * in this passive comparison because listTasks must not add a HEAD subprocess.
 */
export function createConflictVerdictStalenessLatch(): ConflictVerdictStalenessLatch {
  const stalePairKeys = new Set<string>()

  return {
    isPairStale(taskIds, currentStatusHashes, fingerprints) {
      const pairKey = getPairKey(taskIds)
      return (
        stalePairKeys.has(pairKey) ||
        hasConflictPairVerdictStatusMismatch(
          taskIds,
          currentStatusHashes,
          fingerprints,
        )
      )
    },
    observePair(taskIds, currentStatusHashes, fingerprints) {
      if (
        hasConflictPairVerdictStatusMismatch(
          taskIds,
          currentStatusHashes,
          fingerprints,
        )
      ) {
        stalePairKeys.add(getPairKey(taskIds))
      }
    },
    reset() {
      stalePairKeys.clear()
    },
  }
}
