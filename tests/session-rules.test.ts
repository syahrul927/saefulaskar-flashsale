import { describe, expect, it } from "vitest";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { canActivate, hasOverlap } from "@/server/session-rules";
import type * as schema from "@/server/db/schema";

type SessionStatus = "SCHEDULED" | "ACTIVE" | "PAUSED" | "ENDED";

type Row = {
  id: string;
  status: SessionStatus;
  startTime: Date | null;
  endTime: Date | null;
};

type SessionDb = Pick<PostgresJsDatabase<typeof schema>, "select">;

/** Minimal db mock: `select().from().where()` returns the given rows. */
function makeDbMock(rows: Row[]): SessionDb {
  const sel = {
    from: () => ({
      where: async () => rows,
    }),
  };
  return { select: () => sel } as unknown as SessionDb;
}

const CANDIDATE = {
  id: "candidate",
  startTime: new Date("2026-10-25T10:00:00.000Z"),
  endTime: new Date("2026-10-25T11:00:00.000Z"),
};

describe("hasOverlap", () => {
  it("returns false for back-to-back windows that only share an instant", () => {
    const a = {
      startTime: new Date("2026-10-25T10:00:00.000Z"),
      endTime: new Date("2026-10-25T11:00:00.000Z"),
    };
    const b = {
      startTime: new Date("2026-10-25T11:00:00.000Z"),
      endTime: new Date("2026-10-25T12:00:00.000Z"),
    };
    expect(hasOverlap(a, b)).toBe(false);
  });

  it("returns true when one window sits inside the other", () => {
    const a = {
      startTime: new Date("2026-10-25T10:30:00.000Z"),
      endTime: new Date("2026-10-25T11:30:00.000Z"),
    };
    const b = {
      startTime: new Date("2026-10-25T10:00:00.000Z"),
      endTime: new Date("2026-10-25T12:00:00.000Z"),
    };
    expect(hasOverlap(a, b)).toBe(true);
  });
});

describe("canActivate", () => {
  it("blocks with PAUSED_BLOCK when any existing session is PAUSED, even with no overlap", async () => {
    const db = makeDbMock([
      {
        id: "p1",
        status: "PAUSED",
        startTime: new Date("2026-12-01T00:00:00.000Z"),
        endTime: new Date("2026-12-02T00:00:00.000Z"),
      },
    ]);
    await expect(canActivate(db, CANDIDATE)).resolves.toEqual({
      ok: false,
      reason: "PAUSED_BLOCK",
    });
  });

  it("blocks with OVERLAP against an existing ACTIVE session", async () => {
    const db = makeDbMock([
      {
        id: "a1",
        status: "ACTIVE",
        startTime: new Date("2026-10-25T09:00:00.000Z"),
        endTime: new Date("2026-10-25T12:00:00.000Z"),
      },
    ]);
    await expect(canActivate(db, CANDIDATE)).resolves.toEqual({
      ok: false,
      reason: "OVERLAP",
    });
  });

  it("blocks with OVERLAP against an existing SCHEDULED session", async () => {
    const db = makeDbMock([
      {
        id: "s1",
        status: "SCHEDULED",
        startTime: new Date("2026-10-25T10:30:00.000Z"),
        endTime: new Date("2026-10-25T11:30:00.000Z"),
      },
    ]);
    await expect(canActivate(db, CANDIDATE)).resolves.toEqual({
      ok: false,
      reason: "OVERLAP",
    });
  });

  it("allows when existing SCHEDULED/ACTIVE sessions do not overlap", async () => {
    const db = makeDbMock([
      {
        id: "s1",
        status: "SCHEDULED",
        startTime: new Date("2026-10-26T09:00:00.000Z"),
        endTime: new Date("2026-10-26T10:00:00.000Z"),
      },
      {
        id: "a1",
        status: "ACTIVE",
        startTime: new Date("2026-10-27T09:00:00.000Z"),
        endTime: new Date("2026-10-27T10:00:00.000Z"),
      },
    ]);
    await expect(canActivate(db, CANDIDATE)).resolves.toEqual({ ok: true });
  });
});
