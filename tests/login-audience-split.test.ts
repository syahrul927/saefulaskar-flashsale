import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const staff = readFileSync("src/app/auth/staff/page.tsx", "utf8");

describe("login audiences stay separated", () => {
  it("puts the Jubelio form on the staff page, on a white ground", () => {
    expect(staff).toMatch(/AuthForm/);
    expect(staff).toMatch(/logo-lockup\.png/);
    expect(staff).toMatch(/bg-background/); // paper: the lockup export is opaque white
    expect(staff).toMatch(/\/auth\/login/);
  });

  it("points every staff door at the staff page", () => {
    expect(readFileSync("src/app/admin/layout.tsx", "utf8")).toMatch(/redirect\("\/auth\/staff"\)/);
    expect(readFileSync("src/app/_components/use-session-expiry.ts", "utf8")).toMatch(
      /"\/auth\/staff"/,
    );
  });

  it("sends a live session arriving at the old OAuth landing straight to the storefront", () => {
    const success = readFileSync("src/app/login/success/page.tsx", "utf8");
    expect(success).toMatch(/redirect\("\/"\)/); // the spec's "live session → /"
    // ...and keeps the customer door for the no-session case: this is a
    // customer-facing guard, which the spec says stays on /auth/login.
    expect(success).toMatch(/redirect\("\/auth\/login"\)/);
  });

  it("returns a signed-out admin to the door they can use again", () => {
    expect(readFileSync("src/components/sign-out-button.tsx", "utf8")).toMatch(
      /redirectTo = "\/"/,
    );
    expect(readFileSync("src/app/admin/layout.tsx", "utf8")).toMatch(/redirectTo="\/auth\/staff"/);
  });
});
