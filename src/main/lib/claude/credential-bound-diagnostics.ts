export const CLAUDE_CREDENTIAL_BOUND_DIAGNOSTIC_OMITTED =
  "[credential-bound diagnostic content omitted]"

export function shouldOmitClaudeCredentialBoundDiagnostic(
  secretHints: readonly string[] | undefined,
): boolean {
  return Boolean(secretHints?.some((hint) => hint.length > 0))
}
