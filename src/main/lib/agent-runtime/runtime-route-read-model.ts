import {
  projectRuntimeRoutes,
  type RuntimeRouteCatalogState,
} from "./runtime-route-catalog"

/**
 * The renderer's transport key stamped on a binding read model (design D3,
 * OD-3): an internal, additive read-model field, never persisted.
 */
export type RuntimeRouteTransportStamp = { transportId?: string }

/**
 * Returns a copy of a binding read model stamped with the transportId the
 * runtime route catalog's renderer projection assigns to its runtime. The
 * durable binding is never written or mutated; a catalog failure state, an
 * unavailable projection or a runtime without a desktop route omits the
 * field (the renderer then shows route_descriptor_unavailable). The catalog
 * argument is the test-only seam, forwarded unchanged.
 */
export function withRuntimeRouteTransportId<T extends { runtime: string }>(
  binding: T,
  catalog?: RuntimeRouteCatalogState,
): Omit<T, "transportId"> & RuntimeRouteTransportStamp {
  const { transportId: _stale, ...copy } = binding as T &
    RuntimeRouteTransportStamp
  let transportId: string | null = null
  try {
    transportId =
      projectRuntimeRoutes("renderer", catalog).find(
        (route) => route.runtimeId === binding.runtime,
      )?.transportId ?? null
  } catch {
    transportId = null
  }
  return transportId === null ? copy : { ...copy, transportId }
}
