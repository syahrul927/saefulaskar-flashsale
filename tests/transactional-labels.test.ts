import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The phone number IS the WhatsApp number, and onboarding data is the default
// every order starts from. Both facts have to be on screen, not in a guide.
describe("transactional data is explained where it is entered", () => {
  it("names the default-order purpose on the onboarding page", () => {
    const page = readFileSync("src/app/onboarding/page.tsx", "utf8");
    expect(page).toMatch(/default/i);
    expect(page).not.toMatch(/Kami butuh beberapa data untuk mendaftarkan/);
  });

  it("repeats it above the submit button", () => {
    expect(readFileSync("src/app/onboarding/onboarding-form.tsx", "utf8")).toMatch(
      /tiap checkout|setiap pesanan/,
    );
  });

  it("calls the number WhatsApp wherever it is entered, confirmed or read back", () => {
    for (const f of [
      "src/app/onboarding/onboarding-form.tsx",
      "src/app/_components/checkout-dialog.tsx",
      "src/app/_components/receipt-dialog.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src).toMatch(/WhatsApp/);
      expect(src).not.toMatch(/No\. Telf|No\. Telepon/);
    }
  });
});
