import { describe, expect, test } from "bun:test"
import { findRollbackTargetSdkUuidForUserIndex } from "../src/renderer/features/agents/stores/message-store"
import type { ChatMessageMetadata } from "../src/shared/chat-message"

const checkpointMetadata: ChatMessageMetadata = {
  sdkMessageUuid: "sdk-target",
  rollbackCheckpointAvailable: true,
  rollbackCheckpointRef:
    "refs/locus-checkpoints/123e4567-e89b-42d3-a456-426614174000",
  rollbackCheckpointOid: "a".repeat(40),
}

function findTarget(metadata: ChatMessageMetadata): string | null {
  const messages = [
    { role: "user" as const },
    { role: "assistant" as const, metadata },
    { role: "user" as const },
  ]
  return findRollbackTargetSdkUuidForUserIndex(
    2,
    messages.length,
    (index) => messages[index],
  )
}

describe("message store rollback checkpoint visibility", () => {
  test("shows rollback only for an explicitly available canonical ref and OID", () => {
    expect(findTarget(checkpointMetadata)).toBe("sdk-target")
  })

  test("hides rollback when availability, ref, OID, or SDK identity is missing", () => {
    for (const metadata of [
      { sdkMessageUuid: "sdk-target" },
      {
        ...checkpointMetadata,
        rollbackCheckpointAvailable: false,
      },
      {
        ...checkpointMetadata,
        rollbackCheckpointRef: undefined,
      },
      {
        ...checkpointMetadata,
        rollbackCheckpointOid: undefined,
      },
      {
        ...checkpointMetadata,
        sdkMessageUuid: undefined,
      },
    ] satisfies ChatMessageMetadata[]) {
      expect(findTarget(metadata)).toBeNull()
    }
  })

  test("does not accept the retired SDK-UUID-derived ref shape", () => {
    expect(
      findTarget({
        ...checkpointMetadata,
        rollbackCheckpointRef: "refs/checkpoints/sdk-target",
      }),
    ).toBeNull()
  })
})
