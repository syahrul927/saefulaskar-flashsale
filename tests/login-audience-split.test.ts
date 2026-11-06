import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const staff = readFileSync("src/app/auth/staff/page.tsx", "utf8");

describe("login audiences stay separated", () => {
  it("puts the Jubelio form on the staff page, on a white ground", () => {
    // Each pin is tightened to the structure it claims to check: a bare
    // `import { AuthForm }` with the JSX removed, a doc comment naming the
    // lockup with the `<img>` deleted, and `bg-background` moved onto an inner
    // div would all have kept the old loose matches green.
    expect(staff).toMatch(/<AuthForm\s*\/>/);
    expect(staff).toMatch(/src="\/brand\/logo-lockup\.png"/);
    const staffMain = /<main[^>]*>/.exec(staff)?.[0] ?? "";
    // paper: the lockup export is opaque white
    expect(staffMain).toContain("bg-background");
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

const login = readFileSync("src/app/auth/login/page.tsx", "utf8");

describe("customer page is Google-only", () => {
  it("keeps the Jubelio form off the customer page", () => {
    expect(login).not.toMatch(/AuthForm/);
    expect(login).toMatch(/GoogleSignInButton/);
    expect(login).toMatch(/\/auth\/staff/); // the quiet staff link
  });

  it("keeps the lockup on a white ground", () => {
    // logo-lockup.png is an opaque white export — a dark panel shows a white box
    expect(login).toMatch(/bg-background|bg-white|bg-card/);
  });
});
