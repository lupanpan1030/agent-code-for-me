import { z } from "zod"

import {
  type ApplyActiveGuardedScopeExpansionResult,
  respondActiveGuardedScopeExpansion,
} from "../agent-guard/active-contracts"
import type {
  ValidateAgentScopeContractOptions,
  validateAgentScopeContract,
} from "../agent-guard/contract"

export const desktopScopeExpansionResponseInputSchema = z
  .object({
    requestId: z.string().min(1),
    approved: z.boolean(),
  })
  .strict()

export type DesktopScopeExpansionResponseInput = z.infer<
  typeof desktopScopeExpansionResponseInputSchema
>

export type DesktopScopeExpansionResponseRuntimeInput =
  DesktopScopeExpansionResponseInput & {
    nowMs?: number
    validateOptions?: Partial<ValidateAgentScopeContractOptions>
    validateContract?: typeof validateAgentScopeContract
  }

export function respondDesktopScopeExpansion(
  input: DesktopScopeExpansionResponseRuntimeInput,
): Promise<ApplyActiveGuardedScopeExpansionResult> {
  return respondActiveGuardedScopeExpansion(input)
}
