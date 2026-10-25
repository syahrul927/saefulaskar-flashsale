import { describe, expect, it } from "vitest";

import { mapRecipientRows, type ReceiptRecipient } from "@/app/_components/receipt-dialog";

describe("mapRecipientRows", () => {
  it("passes through every resolved recipient field", () => {
    const recipient: ReceiptRecipient = {
      name: "Saeful Akbar",
      phone: "0812-3456-7890",
      address: "Jl. Merdeka No. 45, Jakarta",
    };
    expect(mapRecipientRows(recipient)).toEqual(recipient);
  });

  it("renders an em dash for every null (old order: no snapshot + deleted contact)", () => {
    expect(
      mapRecipientRows({ name: null, phone: null, address: null }),
    ).toEqual({ name: "—", phone: "—", address: "—" });
  });

  it("falls back field by field when only some values are missing", () => {
    expect(
      mapRecipientRows({ name: "Saeful Akbar", phone: null, address: null }),
    ).toEqual({ name: "Saeful Akbar", phone: "—", address: "—" });
  });

  it("normalises a stored empty string to the same em dash", () => {
    // Defensive: the receipt is a document — a blank cell reads as a bug, so
    // whitespace-only values render "—" like a missing one.
    expect(
      mapRecipientRows({ name: "", phone: "   ", address: null }),
    ).toEqual({ name: "—", phone: "—", address: "—" });
  });
});
