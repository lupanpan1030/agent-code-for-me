export type DesktopRunAdmissionGeneration = Readonly<{
  subChatId: string
  generation: symbol
}>

const latestAdmissionBySubChat = new Map<
  string,
  DesktopRunAdmissionGeneration
>()

export function reserveDesktopRunAdmission(
  subChatId: string,
): DesktopRunAdmissionGeneration {
  const admission = Object.freeze({
    subChatId,
    generation: Symbol(subChatId),
  })
  latestAdmissionBySubChat.set(subChatId, admission)
  return admission
}

export function claimDesktopRunAdmission(
  admission: DesktopRunAdmissionGeneration,
): boolean {
  if (latestAdmissionBySubChat.get(admission.subChatId) !== admission) {
    return false
  }
  latestAdmissionBySubChat.delete(admission.subChatId)
  return true
}

export function releaseDesktopRunAdmission(
  admission: DesktopRunAdmissionGeneration,
): boolean {
  if (latestAdmissionBySubChat.get(admission.subChatId) !== admission) {
    return false
  }
  latestAdmissionBySubChat.delete(admission.subChatId)
  return true
}

/**
 * Makes every currently reserved desktop Run admission for this chat stale.
 *
 * This is intentionally only an ordering primitive. It does not own an active
 * Run and does not persist any execution state.
 */
export function invalidateDesktopRunAdmission(
  subChatId: string,
): DesktopRunAdmissionGeneration | null {
  const admission = latestAdmissionBySubChat.get(subChatId)
  if (!admission) return null

  latestAdmissionBySubChat.delete(subChatId)
  return admission
}

export function clearDesktopRunAdmissionsForTest(): void {
  latestAdmissionBySubChat.clear()
}
