import { describe, expect, it } from "vitest";

import {
  isPulseStatus,
  orderStatusTone,
  sessionStatusTone,
} from "@/app/_components/status-badge";

describe("sessionStatusTone", () => {
  it("maps every session status to its badge tone", () => {
    expect(sessionStatusTone("SCHEDULED")).toBe("blue");
    expect(sessionStatusTone("ACTIVE")).toBe("emerald");
    expect(sessionStatusTone("PAUSED")).toBe("amber");
    expect(sessionStatusTone("ENDED")).toBe("neutral");
  });
});

describe("orderStatusTone", () => {
  it("maps every order status to its badge tone", () => {
    expect(orderStatusTone("UNPAID")).toBe("amber");
    expect(orderStatusTone("CONFIRMED")).toBe("emerald");
    expect(orderStatusTone("SHIPPED")).toBe("blue");
    expect(orderStatusTone("COMPLETED")).toBe("neutral");
  });
});

describe("isPulseStatus", () => {
  it("pulses only live states across both status unions", () => {
    expect(isPulseStatus("ACTIVE")).toBe(true);
    expect(isPulseStatus("UNPAID")).toBe(true);
    expect(isPulseStatus("SCHEDULED")).toBe(false);
    expect(isPulseStatus("PAUSED")).toBe(false);
    expect(isPulseStatus("ENDED")).toBe(false);
    expect(isPulseStatus("CONFIRMED")).toBe(false);
    expect(isPulseStatus("SHIPPED")).toBe(false);
    expect(isPulseStatus("COMPLETED")).toBe(false);
  });
});
