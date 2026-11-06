import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The phone number IS the WhatsApp number, and what a buyer saves at
// onboarding is what every later order begins with. Both facts have to be on
// screen, not in a guide. The pins below name the copy itself — never a
// keyword or a stray note — so each one can only go green for its own reason.
describe("transactional data is explained where it is entered", () => {
  it("names the default-order purpose on the onboarding page", () => {
    const page = readFileSync("src/app/onboarding/page.tsx", "utf8");
    // `/default/i` is permanently satisfied by the `export default` keyword two
    // lines up, so it cannot fail for the reason it claims. Scope it to the copy.
    expect(page).toMatch(/data default untuk setiap pesanan/);
    expect(page).not.toMatch(/Kami butuh beberapa data untuk mendaftarkan/);
  });

  it("repeats it above the submit button", () => {
    const form = readFileSync("src/app/onboarding/onboarding-form.tsx", "utf8");
    expect(form).toMatch(/tiap checkout|setiap pesanan/);
    // The claim is positional, so the pin must be too: a whole-file match is
    // satisfied by a comment anywhere in the file, or by the sentence sitting
    // under the button instead of above it.
    //
    // Order-independent inside that position. `prettier-plugin-tailwindcss` is
    // registered in prettier.config.js and `format:write` covers **/*.{ts,tsx},
    // so one format pass rewrites `text-xs text-muted-foreground` to
    // `text-muted-foreground text-xs` and breaks the 84-column `<Button ...>`
    // onto one attribute per line. Both were literal-continuation anchors, so
    // `format:write` alone turned this suite red with no product change — a
    // false red that trains whoever runs it to ignore the result.
    const note = form.search(
      /<p className="(?=[^"]*\btext-xs\b)(?=[^"]*\btext-muted-foreground\b)[^"]*"/,
    );
    const submit = form.search(/<Button[\s\S]{0,160}?type="submit"/);
    expect(note).toBeGreaterThanOrEqual(0);
    expect(submit).toBeGreaterThan(note);
  });

  it("calls the number WhatsApp wherever it is entered, confirmed or read back", () => {
    for (const f of [
      "src/app/onboarding/onboarding-form.tsx",
      "src/app/_components/checkout-dialog.tsx",
      "src/app/_components/receipt-dialog.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src).toMatch(/WhatsApp/);
      // Case-insensitive: the checkout validation string was lowercase
      // (`No. telepon minimal …`), so the case-sensitive form of this pin would
      // let a regression reintroduce it untouched.
      expect(src).not.toMatch(/no\.\s*(telf|telepon)/i);
    }
  });
});
