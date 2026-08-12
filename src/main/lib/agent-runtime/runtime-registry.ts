import {
  type AgentRuntimeAlias,
  type AgentRuntimeCapabilityGate,
  type AgentRuntimeCapabilityId,
  type AgentRuntimeCapabilityLookup,
  type AgentRuntimeCapabilityManifest,
  type AgentRuntimeId,
  type AgentRuntimeManifestLookup,
  CONTRACT_RUNTIME_IDS,
  checkAgentRuntimeCapability,
  getAgentRuntimeCapabilityManifest,
  resolveAgentRuntimeCapability,
  resolveAgentRuntimeCapabilityManifest,
  toAgentRuntimeId,
} from "../../../shared/agent-runtime-capabilities"

export type AgentRuntimeRegistryScope = "contract" | "desktop"

export type AgentRuntimeRegistryOptions = {
  scope?: AgentRuntimeRegistryScope
}

export function listRegisteredAgentRuntimeManifests(
  _options: AgentRuntimeRegistryOptions = {},
): AgentRuntimeCapabilityManifest[] {
  return CONTRACT_RUNTIME_IDS.map((runtimeId) =>
    getAgentRuntimeCapabilityManifest(runtimeId),
  )
}

export function getRegisteredAgentRuntimeManifest(
  runtime: AgentRuntimeAlias,
  _options: AgentRuntimeRegistryOptions = {},
): AgentRuntimeCapabilityManifest {
  return getAgentRuntimeCapabilityManifest(runtime)
}

export function getRegisteredAgentRuntimeId(
  runtime: AgentRuntimeAlias | string | null | undefined,
): AgentRuntimeId | null {
  return toAgentRuntimeId(runtime)
}

export function checkRegisteredAgentRuntimeCapability(input: {
  runtime: AgentRuntimeAlias
  capabilityId: AgentRuntimeCapabilityId
  options?: AgentRuntimeRegistryOptions
}): AgentRuntimeCapabilityGate {
  return checkAgentRuntimeCapability(input)
}

export function resolveRegisteredAgentRuntimeManifest(
  runtime: string,
  _options: AgentRuntimeRegistryOptions = {},
): AgentRuntimeManifestLookup {
  return resolveAgentRuntimeCapabilityManifest(runtime)
}

export function resolveRegisteredAgentRuntimeCapability(input: {
  runtime: string
  capabilityId: AgentRuntimeCapabilityId
  options?: AgentRuntimeRegistryOptions
}): AgentRuntimeCapabilityLookup {
  return resolveAgentRuntimeCapability(input)
}
