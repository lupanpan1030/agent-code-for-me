import { listRegisteredAgentRuntimeManifests } from "../../agent-runtime/runtime-registry"
import { publicProcedure, router } from "../index"

export const agentRuntimeRouter = router({
  listManifests: publicProcedure.query(() => {
    return listRegisteredAgentRuntimeManifests({ scope: "desktop" })
  }),
})
