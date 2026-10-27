import { describe, expect, it } from "vitest";

import { planImageBackfill } from "@/server/backfill-images";

// The backfill's decision is pure (same seam style as daily-sync's
// `planSync`): given the rows still missing a photo and the v2 stock map,
// which rows get which URL. The route is just plumbing around it.
describe("planImageBackfill", () => {
  it("fills only rows whose item has a thumbnail in the map", () => {
    const patches = planImageBackfill(
      [
        { id: "a", itemId: 1 },
        { id: "b", itemId: 2 },
        { id: "c", itemId: 3 },
      ],
      new Map([
        [1, { available: 5, image: "https://cdn/1.jpg" }],
        [2, { available: 5, image: null }],
      ]),
    );
    // item 2 has a v2 entry but no picture, item 3 is absent from v2 —
    // neither gets a fabricated URL (missing ≠ empty).
    expect(patches).toEqual([{ id: "a", imageUrl: "https://cdn/1.jpg" }]);
  });

  it("no rows, no patches", () => {
    expect(planImageBackfill([], new Map())).toEqual([]);
  });
});
