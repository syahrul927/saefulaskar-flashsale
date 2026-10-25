import { describe, expect, it } from "vitest";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { dayRange, nextBookingId } from "@/server/booking-id";
import type * as schema from "@/server/db/schema";

type BookingDb = Pick<PostgresJsDatabase<typeof schema>, "transaction">;

/** Minimal db mock: just a `transaction` that runs its callback with a fake tx. */
function makeDbMock(count: number): BookingDb {
  const tx = {
    select: () => ({
      from: () => ({
        where: async () => [{ value: String(count) }],
      }),
    }),
  };
  return {
    transaction: async (fn) => fn(tx as never),
  } as BookingDb;
}

describe("dayRange", () => {
  it("returns the same UTC day for 23:59 and midnight of the same date", () => {
    const late = dayRange(new Date("2026-10-25T23:59:59.999Z"));
    const mid = dayRange(new Date("2026-10-25T00:00:00.000Z"));
    expect(late.start).toEqual(mid.start);
    expect(late.end).toEqual(mid.end);
    expect(late.start.toISOString()).toBe("2026-10-25T00:00:00.000Z");
    expect(late.end.toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });

  it("excludes the instant just before midnight (23:59:59.999 previous day)", () => {
    const range = dayRange(new Date("2026-10-25T00:00:00.000Z"));
    const justBefore = new Date("2026-10-24T23:59:59.999Z");
    // `>= start` guard: the instant one millisecond before startDay is outside.
    expect(justBefore.getTime()).toBeLessThan(range.start.getTime());
  });
});

describe("nextBookingId", () => {
  it("returns FS-{today}-0001 with zero orders today", async () => {
    const res = await nextBookingId(makeDbMock(0), new Date("2026-10-25T12:00:00.000Z"));
    expect(res.bookingId).toBe("FS-20261025-0001");
    expect(res.seq).toBe(1);
  });

  it("returns FS-{today}-0003 with two orders today", async () => {
    const res = await nextBookingId(makeDbMock(2), new Date("2026-10-25T12:00:00.000Z"));
    expect(res.bookingId).toBe("FS-20261025-0003");
    expect(res.seq).toBe(3);
  });

  it("pads the sequence to 4 digits", async () => {
    const res = await nextBookingId(makeDbMock(9), new Date("2026-01-05T18:00:00.000Z"));
    expect(res.bookingId).toBe("FS-20260105-0010");
  });
});
