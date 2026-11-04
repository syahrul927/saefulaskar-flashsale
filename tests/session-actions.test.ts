import { describe, expect, it } from "vitest";
import { sessionActionRequest } from "@/app/_components/session-actions";

describe("sessionActionRequest", () => {
  it("routes delete to the session itself, not /delete", () => {
    expect(sessionActionRequest("delete", "abc")).toEqual({
      url: "/api/sessions/abc",
      method: "DELETE",
    });
  });
  it.each(["activate", "pause", "resume", "end"] as const)(
    "routes %s to its subresource via POST",
    (key) => {
      expect(sessionActionRequest(key, "abc")).toEqual({
        url: `/api/sessions/abc/${key}`,
        method: "POST",
      });
    },
  );
});
