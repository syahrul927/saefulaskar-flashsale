import { describe, expect, it } from "vitest";

import { loginPathFor } from "@/middleware";

// Middleware can only see a cookie's presence, never a role, so the audience
// split has to be made on the path the visitor asked for.
describe("loginPathFor", () => {
  it("sends staff surfaces to the staff door", () => {
    expect(loginPathFor("/admin")).toBe("/auth/staff");
    expect(loginPathFor("/admin/orders")).toBe("/auth/staff");
    expect(loginPathFor("/admin/jubelio")).toBe("/auth/staff");
  });

  it("sends customer surfaces to the customer door", () => {
    expect(loginPathFor("/orders")).toBe("/auth/login");
    expect(loginPathFor("/onboarding")).toBe("/auth/login");
    // The two door rows nothing here covered: the storefront root and the OAuth
    // landing. Falsifies an `else → "/auth/staff"` default, or a staff-path
    // list that grows — a buyer arriving from a WhatsApp link at `/` would land
    // on the email/password door, and `/login/success` would bounce a Google
    // callback to credentials the customer does not have.
    expect(loginPathFor("/")).toBe("/auth/login");
    expect(loginPathFor("/login/success")).toBe("/auth/login");
  });

  it("does not mistake a customer path that merely contains the word", () => {
    expect(loginPathFor("/administrator-guide")).toBe("/auth/login");
    expect(loginPathFor("/orders/admin-notes")).toBe("/auth/login");
  });
});
