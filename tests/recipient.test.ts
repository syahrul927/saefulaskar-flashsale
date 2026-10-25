import { describe, expect, it } from "vitest";

import { recipientSchema, resolveRecipient } from "@/server/recipient";

const EMPTY_SNAPSHOT = {
  recipientName: null,
  recipientPhone: null,
  recipientAddress: null,
};

const CONTACT = {
  contactName: "Budi Santoso",
  phone: "081234567890",
  sAddress: "Jl. Merdeka No. 1, Jakarta Pusat",
};

describe("resolveRecipient", () => {
  it("uses the order snapshot when every field is present", () => {
    const order = {
      recipientName: "Andi Wijaya",
      recipientPhone: "081111111111",
      recipientAddress: "Jl. Sudirman No. 45, Bandung",
    };
    expect(resolveRecipient({ order, contact: CONTACT })).toEqual({
      name: "Andi Wijaya",
      phone: "081111111111",
      address: "Jl. Sudirman No. 45, Bandung",
    });
  });

  it("falls back to the contact per field for a partial snapshot", () => {
    const order = {
      recipientName: "Andi Wijaya",
      recipientPhone: null,
      recipientAddress: null,
    };
    expect(resolveRecipient({ order, contact: CONTACT })).toEqual({
      name: "Andi Wijaya",
      phone: "081234567890",
      address: "Jl. Merdeka No. 1, Jakarta Pusat",
    });
  });

  it("returns the contact for a legacy order with an empty snapshot", () => {
    expect(
      resolveRecipient({ order: EMPTY_SNAPSHOT, contact: CONTACT }),
    ).toEqual({
      name: "Budi Santoso",
      phone: "081234567890",
      address: "Jl. Merdeka No. 1, Jakarta Pusat",
    });
  });

  it("returns null fields when snapshot and contact are both missing", () => {
    expect(resolveRecipient({ order: EMPTY_SNAPSHOT, contact: null })).toEqual({
      name: null,
      phone: null,
      address: null,
    });
  });
});

describe("recipientSchema", () => {
  it("accepts an empty body — recipient fields are additive/optional", () => {
    expect(recipientSchema.parse({})).toEqual({});
  });

  it("rejects a one-character recipient name", () => {
    expect(recipientSchema.safeParse({ recipientName: "a" }).success).toBe(
      false,
    );
  });

  it("trims each field before persisting", () => {
    expect(
      recipientSchema.parse({
        recipientName: "  Andi Wijaya  ",
        recipientPhone: " 081234567890 ",
        recipientAddress: "  Jl. Sudirman No. 45, Bandung ",
      }),
    ).toEqual({
      recipientName: "Andi Wijaya",
      recipientPhone: "081234567890",
      recipientAddress: "Jl. Sudirman No. 45, Bandung",
    });
  });

  it("rejects a phone shorter than 6 chars and an address shorter than 10", () => {
    expect(recipientSchema.safeParse({ recipientPhone: "12345" }).success).toBe(
      false,
    );
    expect(
      recipientSchema.safeParse({ recipientAddress: "Jl. X" }).success,
    ).toBe(false);
  });
});
