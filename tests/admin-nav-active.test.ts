import { describe, expect, it } from "vitest";

import { isKonsolPath } from "@/app/_components/admin-nav";

/**
 * The Konsol tab used `under("/admin")` as its active predicate — and
 * `under` is a prefix match, so `/admin/orders` and `/admin/jubelio` matched
 * it too: switching tabs lit TWO segments, with Konsol always among them.
 * The helper's own docstring warns "without swallowing siblings"; the
 * predicate ignored it. These cases pin the territory Konsol actually owns:
 * `/admin` itself and the session editor nested under it, nothing else.
 * (Reported live 2026-11-03; the bug predates the cancel plan.)
 */
describe("isKonsolPath", () => {
  it("is active on /admin itself", () => {
    expect(isKonsolPath("/admin")).toBe(true);
  });

  it("is active on the session editor nested under Konsol", () => {
    expect(isKonsolPath("/admin/sessions/new")).toBe(true);
    expect(isKonsolPath("/admin/sessions/s-1/edit")).toBe(true);
    expect(isKonsolPath("/admin/sessions/s-1/products")).toBe(true);
  });

  it("is NOT active on a sibling segment — the reported bug", () => {
    expect(isKonsolPath("/admin/orders")).toBe(false);
    expect(isKonsolPath("/admin/jubelio")).toBe(false);
  });

  it("is NOT active on a storefront or API path", () => {
    expect(isKonsolPath("/")).toBe(false);
    expect(isKonsolPath("/orders")).toBe(false);
    expect(isKonsolPath("/api/admin/x")).toBe(false);
  });

  it("is NOT fooled by a sibling that merely starts with the same characters", () => {
    // Guards the `/admin/sessions/` form against a future `under("/admin/sessions")`
    // regression matching e.g. `/admin/sessions-legacy`.
    expect(isKonsolPath("/admin/sessionsx")).toBe(false);
  });
});
