import type { CanonicalDesktopRunLedger } from "../agent-runtime/run-event-ledger-host"
import type { AgentJobDatabase } from "../headless/job-store"

export type ClaudeAgentSdkDesktopRunState = {
  setDb(db: AgentJobDatabase): void
  getDb(): AgentJobDatabase | null
  setDesktopJob(input: {
    jobId: string
    ledger: CanonicalDesktopRunLedger
  }): void
  getJobId(): string | null
  /** The desktop job's host-composed ledger (null before the job exists). */
  getLedger(): CanonicalDesktopRunLedger | null
  markFailed(): void
  sawError(): boolean
  setReachedNaturalFinish(reachedNaturalFinish: boolean): void
  reachedNaturalFinish(): boolean
  isObservableActive(): boolean
  markInactive(): void
}

export function createClaudeAgentSdkDesktopRunState(): ClaudeAgentSdkDesktopRunState {
  let db: AgentJobDatabase | null = null
  let jobId: string | null = null
  let ledger: CanonicalDesktopRunLedger | null = null
  let sawError = false
  let reachedNaturalFinish = false
  let observableActive = true

  return {
    setDb(nextDb) {
      db = nextDb
    },
    getDb() {
      return db
    },
    setDesktopJob(input) {
      jobId = input.jobId
      ledger = input.ledger
    },
    getJobId() {
      return jobId
    },
    getLedger() {
      return ledger
    },
    markFailed() {
      sawError = true
    },
    sawError() {
      return sawError
    },
    setReachedNaturalFinish(nextReachedNaturalFinish) {
      reachedNaturalFinish = nextReachedNaturalFinish
    },
    reachedNaturalFinish() {
      return reachedNaturalFinish
    },
    isObservableActive() {
      return observableActive
    },
    markInactive() {
      observableActive = false
    },
  }
}
