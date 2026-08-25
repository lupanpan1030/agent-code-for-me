import { describe, expect, mock, test } from "bun:test"
import { openWorkbenchDiffSurface } from "../src/renderer/features/agents/workbench/diff-surface-routing"

function routingHarness(input: {
  isMobile: boolean
  detailsAvailable: boolean
}) {
  const events: string[] = []
  const result = openWorkbenchDiffSurface({
    isMobile: input.isMobile,
    openDetailsWidget: mock(() => {
      events.push("open:details")
      return input.detailsAvailable
    }),
    setDiffDisplayMode: mock((mode) => events.push(`display:${mode}`)),
    setDiffSidebarOpen: mock((open) => events.push(`sidebar:${open}`)),
    setMobileViewMode: mock((mode) => events.push(`mobile:${mode}`)),
  })
  return { events, result }
}

describe("agent workbench diff-surface routing", () => {
  test("opens the canonical Details diff when it is available", () => {
    expect(routingHarness({ isMobile: false, detailsAvailable: true })).toEqual(
      {
        result: "details",
        events: ["display:details-expanded", "sidebar:false", "open:details"],
      },
    )
  })

  test("uses the existing mobile diff mode when Details is unavailable", () => {
    expect(routingHarness({ isMobile: true, detailsAvailable: false })).toEqual(
      {
        result: "mobile",
        events: [
          "display:details-expanded",
          "sidebar:false",
          "open:details",
          "mobile:diff",
        ],
      },
    )
  })

  test("falls back to the desktop full-page diff outside mobile layouts", () => {
    expect(
      routingHarness({ isMobile: false, detailsAvailable: false }),
    ).toEqual({
      result: "full-page",
      events: [
        "display:details-expanded",
        "sidebar:false",
        "open:details",
        "display:full-page",
        "sidebar:true",
      ],
    })
  })
})
