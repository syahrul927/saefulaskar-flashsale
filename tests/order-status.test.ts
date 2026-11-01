import { describe, expect, it } from "vitest";
import {
  CANCELLABLE_STATUSES, CUSTOMER_STATUS_LABEL, END_STATUSES,
  isCancellable, isEndState, stepLabel,
} from "@/server/order-status";
import { orderStatus } from "@/server/db/schema";

describe("order-status vocabulary", () => {
  it("derives OrderStatus from the pgEnum, so the two cannot drift", () => {
    // Every enum member has a customer label; a missing key is a compile error,
    // and this pins the runtime map to the DB list too.
    expect(Object.keys(CUSTOMER_STATUS_LABEL).sort()).toEqual([...orderStatus.enumValues].sort());
    expect(CUSTOMER_STATUS_LABEL.CANCEL).toBe("Dibatalkan");
  });
  it("treats COMPLETED and CANCEL as end states, and nothing else", () => {
    expect(END_STATUSES).toEqual(["COMPLETED", "CANCEL"]);
    expect(isEndState("COMPLETED")).toBe(true);
    expect(isEndState("CANCEL")).toBe(true);
    expect(isEndState("SHIPPED")).toBe(false);   // legacy, can still advance
    expect(isEndState("UNPAID")).toBe(false);
    expect(isEndState("nonsense")).toBe(false);
  });
  it("allows cancel from UNPAID and CONFIRMED only", () => {
    expect(CANCELLABLE_STATUSES).toEqual(["UNPAID", "CONFIRMED"]);
    expect(isCancellable("SHIPPED")).toBe(false);
    expect(isCancellable("CANCEL")).toBe(false);
    expect(isCancellable("COMPLETED")).toBe(false);
  });
  it("labels a transition by what happened, not by the raw enum", () => {
    expect(stepLabel(null, "UNPAID")).toBe("Pesanan dibuat");
    expect(stepLabel("UNPAID", "CONFIRMED")).toBe("Dibayar — sales order dibuat");
    expect(stepLabel("CONFIRMED", "CANCEL")).toBe("Dibatalkan");
    expect(stepLabel("UNPAID", "CANCEL")).toBe("Dibatalkan");
    expect(stepLabel("CONFIRMED", "COMPLETED")).toBe("Selesai");
    expect(stepLabel("CONFIRMED", "SHIPPED")).toBe("Dikirim");
  });
});
