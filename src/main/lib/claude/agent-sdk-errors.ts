export const CLAUDE_MAX_POLICY_RETRIES = 2

export type ClaudeAgentSdkEmbeddedErrorCategory =
  | "SDK_ERROR"
  | "AUTH_FAILURE"
  | "AUTH_FAILED_SDK"
  | "MCP_INVALID_TOKEN"
  | "INVALID_API_KEY_SDK"
  | "RATE_LIMIT_SDK"
  | "OVERLOADED_SDK"
  | "USAGE_POLICY_VIOLATION"

export type ClaudeAgentSdkEmbeddedErrorDiagnostic = {
  category: ClaudeAgentSdkEmbeddedErrorCategory
  context: string
  rawErrorCode: string
  shouldEmitAuthError: boolean
  shouldRetryPolicy: boolean
}

export type ClaudeAgentSdkStreamErrorCategory =
  | "UNKNOWN"
  | "NATIVE_RESUME_REJECTED"
  | "PROCESS_CRASH"
  | "EXECUTABLE_NOT_FOUND"
  | "AUTH_FAILURE"
  | "INVALID_API_KEY"
  | "RATE_LIMIT"
  | "NETWORK_ERROR"

export type ClaudeAgentSdkStreamErrorDiagnostic = {
  category: ClaudeAgentSdkStreamErrorCategory
  context: string
  /**
   * The native runtime refused to resume the requested session. This is a
   * neutral rejection fact: it claims no expiry and changes no binding.
   */
  isNativeResumeRejected: boolean
}

export function getClaudePolicyRetryDelayMs(policyRetryCount: number): number {
  return policyRetryCount <= 1 ? 3000 : 6000
}

export function extractClaudeAgentSdkEmbeddedErrorText(message: any): string {
  const messageText = message?.message?.content?.[0]?.text
  return String(
    messageText ||
      message?.error ||
      message?.message ||
      "Unknown SDK error",
  )
}

export function classifyClaudeAgentSdkEmbeddedError(input: {
  rawErrorCode?: unknown
  sdkError: unknown
  usesApiKeyAuth: boolean
  policyRetryCount: number
  maxPolicyRetries?: number
  aborted: boolean
}): ClaudeAgentSdkEmbeddedErrorDiagnostic {
  const rawErrorCode =
    typeof input.rawErrorCode === "string" ? input.rawErrorCode : ""
  const sdkError = String(input.sdkError || "Unknown SDK error")
  const maxPolicyRetries =
    input.maxPolicyRetries ?? CLAUDE_MAX_POLICY_RETRIES
  let category: ClaudeAgentSdkEmbeddedErrorCategory = "SDK_ERROR"
  let context = sdkError

  if (
    rawErrorCode === "authentication_failed" ||
    sdkError.includes("authentication")
  ) {
    if (input.usesApiKeyAuth) {
      category = "AUTH_FAILURE"
      context = "Authentication failed - check your API key"
    } else {
      category = "AUTH_FAILED_SDK"
      context =
        "Authentication failed - reconnect or import local Claude Code credentials"
    }
  } else if (
    sdkError.includes("invalid_token") ||
    sdkError.includes("Invalid access token")
  ) {
    category = "MCP_INVALID_TOKEN"
    context = "Invalid access token. Update MCP settings"
  } else if (
    rawErrorCode === "invalid_api_key" ||
    sdkError.includes("api_key")
  ) {
    category = "INVALID_API_KEY_SDK"
    context = sdkError
  } else if (
    rawErrorCode === "rate_limit_exceeded" ||
    sdkError.includes("rate")
  ) {
    category = "RATE_LIMIT_SDK"
    context = "Session limit reached"
  } else if (
    rawErrorCode === "overloaded" ||
    sdkError.includes("overload")
  ) {
    category = "OVERLOADED_SDK"
    context = "Claude is overloaded, try again later"
  } else if (
    rawErrorCode === "invalid_request" ||
    sdkError.includes("Usage Policy") ||
    sdkError.includes("violate")
  ) {
    category = "USAGE_POLICY_VIOLATION"
  }

  return {
    category,
    context,
    rawErrorCode,
    shouldEmitAuthError: category === "AUTH_FAILED_SDK",
    shouldRetryPolicy:
      category === "USAGE_POLICY_VIOLATION" &&
      input.policyRetryCount < maxPolicyRetries &&
      !input.aborted,
  }
}

export function classifyClaudeAgentSdkStreamError(input: {
  error: Error
  stderrOutput?: string
}): ClaudeAgentSdkStreamErrorDiagnostic {
  const message = input.error.message || ""
  const stderrOutput = input.stderrOutput || ""
  const isNativeResumeRejected = stderrOutput.includes(
    "No conversation found with session ID",
  )

  if (isNativeResumeRejected) {
    return {
      category: "NATIVE_RESUME_REJECTED",
      context: "Claude could not resume the previous session",
      isNativeResumeRejected: true,
    }
  }

  if (message.includes("exited with code")) {
    return {
      category: "PROCESS_CRASH",
      context: "Claude Code process crashed",
      isNativeResumeRejected: false,
    }
  }

  if (message.includes("ENOENT")) {
    return {
      category: "EXECUTABLE_NOT_FOUND",
      context: "Required executable not found in PATH",
      isNativeResumeRejected: false,
    }
  }

  if (message.includes("authentication") || message.includes("401")) {
    return {
      category: "AUTH_FAILURE",
      context: "Authentication failed - check your API key",
      isNativeResumeRejected: false,
    }
  }

  if (
    message.includes("invalid_api_key") ||
    message.includes("Invalid API Key") ||
    stderrOutput.includes("invalid_api_key")
  ) {
    return {
      category: "INVALID_API_KEY",
      context: "Invalid API key",
      isNativeResumeRejected: false,
    }
  }

  if (message.includes("rate_limit") || message.includes("429")) {
    return {
      category: "RATE_LIMIT",
      context: "Session limit reached",
      isNativeResumeRejected: false,
    }
  }

  if (
    message.includes("network") ||
    message.includes("ECONNREFUSED") ||
    message.includes("fetch failed")
  ) {
    return {
      category: "NETWORK_ERROR",
      context: "Network error - check your connection",
      isNativeResumeRejected: false,
    }
  }

  return {
    category: "UNKNOWN",
    context: "Claude streaming error",
    isNativeResumeRejected: false,
  }
}
