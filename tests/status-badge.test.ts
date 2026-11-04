import { describe, expect, it } from "vitest";

import {
  isPulseStatus,
  orderStatusTone,
  sessionStatusLabel,
  sessionStatusTone,
} from "@/app/_components/status-badge";

describe("sessionStatusLabel", () => {
  // The badges beside the console's filter pills must read the SAME words the
  // pills read (final review I-1) — this map is the single source the pills
  // (`session-list-filter.tsx` TABS) and every session badge derive from.
  it("spells every session status with the pill glossary, never the raw enum", () => {
    expect(sessionStatusLabel("SCHEDULED")).toBe("Terjadwal");
    expect(sessionStatusLabel("ACTIVE")).toBe("Aktif");
    expect(sessionStatusLabel("PAUSED")).toBe("Dijeda");
    expect(sessionStatusLabel("ENDED")).toBe("Selesai");
  });
});

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
    expect(orderStatusTone("CANCEL")).toBe("red");
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
    // A cancelled order is finished, not live — the dot must not blink on it.
    expect(isPulseStatus("CANCEL")).toBe(false);
  });
});
