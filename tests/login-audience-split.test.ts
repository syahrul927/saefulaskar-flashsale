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

  it("keeps the two in-app customer guards on the customer door", () => {
    // The other two server-side guards a logged-out buyer can hit, in the same
    // idiom as the `login/success` pin above: orders/page.tsx:49 (the
    // storefront group's page, so the path is written with its group folder)
    // and onboarding/page.tsx:23, both `if (!session) redirect("/auth/login")`.
    // Nothing read either file for its redirect, so sweeping every redirect
    // onto one door — `/auth/staff` here — stayed green while it sent a buyer's
    // bookmarked /orders to the email/password form: the inverse of the split
    // these pins exist for. Each file holds exactly one redirect to the
    // customer door today, so the match is that call and not a mention of it.
    expect(
      readFileSync("src/app/(storefront)/orders/page.tsx", "utf8"),
    ).toMatch(/redirect\("\/auth\/login"\)/);
    expect(readFileSync("src/app/onboarding/page.tsx", "utf8")).toMatch(
      /redirect\("\/auth\/login"\)/,
    );
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
    // Structural, not lexical: a bare `not.toMatch(/AuthForm/)` would break the
    // next comment that explains why the credentials form is NOT on this door —
    // exactly the prose the sibling staff page carries — and `/GoogleSignInButton/`
    // passes on the bare import with the JSX deleted.
    expect(login).not.toMatch(/<AuthForm\s*\/>|@\/components\/auth-form/);
    expect(login).toMatch(/<GoogleSignInButton\s*\/>/);
    expect(login).toMatch(/href="\/auth\/staff"/); // the quiet staff link
  });

  it("gives that entrance a failure the buyer can see", () => {
    // Beyond the six adjudicated items, and deletable with them: the toast at
    // google-sign-in-button.tsx:38 is the wave's only product-code change, and
    // this suite has no DOM to click it with (vitest.config.ts:22 — environment
    // "node", no jsdom, no testing-library), so a source scan is all that is
    // available. Two halves, both needed: the `toast.error` call, and the
    // `<Toaster>` that renders it. The door has no layout of its own — only
    // (storefront)/ and admin/ do — so src/app/layout.tsx is the one that
    // wraps /auth/login, and it mounts the Toaster unconditionally.
    expect(
      readFileSync("src/components/google-sign-in-button.tsx", "utf8"),
    ).toMatch(/toast\.error\("Gagal masuk dengan Google\. Coba lagi\."\)/);
    expect(readFileSync("src/app/layout.tsx", "utf8")).toMatch(
      /<Toaster[^>]*\/>/,
    );
  });

  it("keeps the lockup on a white ground", () => {
    // logo-lockup.png is an opaque white export — a dark panel shows a white box.
    // Pinned to the <main> tag: a bare `bg-background|bg-white|bg-card` alternation
    // is already satisfied by the `bg-white/30` on the ink plate's status dot.
    const main = /<main[^>]*>/.exec(login)?.[0] ?? "";
    expect(main).toContain("bg-background");
  });

  it("keeps the two doors' lockup the same width", () => {
    // The title names BOTH doors, so both sides are pinned literally. Pinning
    // only the staff side let `md:w-44` be deleted from the customer page's
    // lockup (<img> in src/app/auth/login/page.tsx) and stay green — the two
    // columns then rendered at 10rem vs 11rem at md and above, while the test
    // that says they are the same width still passed. A literal per side, not
    // an equality between the files: `expect(a).toBe(b)` is satisfiable by
    // changing both to something else, e.g. both to `w-48`.
    expect(staff).toMatch(/w-40 md:w-44/);
    expect(login).toMatch(/w-40 md:w-44/);
  });
});
