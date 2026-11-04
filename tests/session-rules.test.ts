import { describe, expect, it } from "vitest";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  activationBlockMessage,
  activationPreview,
  canActivate,
  hasOverlap,
} from "@/server/session-rules";
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

describe("activationBlockMessage", () => {
  it("explains OVERLAP in human, actionable Bahasa Indonesia", () => {
    expect(activationBlockMessage("OVERLAP")).toBe(
      "Jam sesi ini bertabrakan dengan sesi lain. Ubah jam salah satunya dulu.",
    );
  });

  it("explains PAUSED_BLOCK in human, actionable Bahasa Indonesia", () => {
    expect(activationBlockMessage("PAUSED_BLOCK")).toBe(
      "Masih ada sesi yang dijeda. Lanjutkan atau akhiri sesi itu sebelum mengaktifkan sesi baru.",
    );
  });
});

describe("activationPreview", () => {
  /** Same window as CANDIDATE so the list can serve both APIs. */
  const candidateRow: Row = {
    id: CANDIDATE.id,
    status: "SCHEDULED",
    startTime: CANDIDATE.startTime,
    endTime: CANDIDATE.endTime,
  };

  it("returns null when no other session blocks the candidate", () => {
    expect(
      activationPreview(
        [
          candidateRow,
          {
            id: "s1",
            status: "SCHEDULED",
            startTime: new Date("2026-10-26T09:00:00.000Z"),
            endTime: new Date("2026-10-26T10:00:00.000Z"),
          },
        ],
        CANDIDATE.id,
      ),
    ).toBeNull();
  });

  it("returns PAUSED_BLOCK when another session is PAUSED, even with no overlap", () => {
    expect(
      activationPreview(
        [
          candidateRow,
          {
            id: "p1",
            status: "PAUSED",
            startTime: new Date("2026-12-01T00:00:00.000Z"),
            endTime: new Date("2026-12-02T00:00:00.000Z"),
          },
        ],
        CANDIDATE.id,
      ),
    ).toBe("PAUSED_BLOCK");
  });

  it("returns OVERLAP against an overlapping SCHEDULED row", () => {
    expect(
      activationPreview(
        [
          candidateRow,
          {
            id: "s1",
            status: "SCHEDULED",
            startTime: new Date("2026-10-25T10:30:00.000Z"),
            endTime: new Date("2026-10-25T11:30:00.000Z"),
          },
        ],
        CANDIDATE.id,
      ),
    ).toBe("OVERLAP");
  });

  it("ignores the candidate's own row and ENDED rows", () => {
    expect(
      activationPreview([candidateRow], CANDIDATE.id),
    ).toBeNull();
    expect(
      activationPreview(
        [
          candidateRow,
          {
            id: "e1",
            status: "ENDED",
            startTime: new Date("2026-10-25T09:00:00.000Z"),
            endTime: new Date("2026-10-25T12:00:00.000Z"),
          },
        ],
        CANDIDATE.id,
      ),
    ).toBeNull();
  });

  it("skips other rows without times and candidates without a known window", () => {
    expect(
      activationPreview(
        [
          candidateRow,
          { id: "n1", status: "ACTIVE", startTime: null, endTime: null },
        ],
        CANDIDATE.id,
      ),
    ).toBeNull();
    // Candidate id not present in the list → no window to compare.
    expect(activationPreview([], CANDIDATE.id)).toBeNull();
  });

  // Parity: the list-based preview must agree with the DB-backed check on the
  // same rows, so the admin list never greys out a button the API would
  // accept (and vice versa).
  it("agrees with canActivate on a PAUSED_BLOCK list", async () => {
    const rows: Row[] = [
      candidateRow,
      {
        id: "p1",
        status: "PAUSED",
        startTime: new Date("2026-12-01T00:00:00.000Z"),
        endTime: new Date("2026-12-02T00:00:00.000Z"),
      },
    ];
    // Mirror the real query: `canActivate` fetches every row EXCEPT the
    // candidate (`ne(flashSessions.id, candidate.id)`), while the preview
    // receives the full list and skips the candidate's own id itself.
    const verdict = await canActivate(
      makeDbMock(rows.filter((r) => r.id !== CANDIDATE.id)),
      CANDIDATE,
    );
    expect(activationPreview(rows, CANDIDATE.id)).toBe(
      verdict.ok ? null : verdict.reason,
    );
    expect(activationPreview(rows, CANDIDATE.id)).toBe("PAUSED_BLOCK");
  });

  it("agrees with canActivate on an OVERLAP list", async () => {
    const rows: Row[] = [
      candidateRow,
      {
        id: "a1",
        status: "ACTIVE",
        startTime: new Date("2026-10-25T09:00:00.000Z"),
        endTime: new Date("2026-10-25T12:00:00.000Z"),
      },
      {
        id: "e1",
        status: "ENDED",
        startTime: new Date("2026-10-25T09:00:00.000Z"),
        endTime: new Date("2026-10-25T12:00:00.000Z"),
      },
    ];
    const verdict = await canActivate(
      makeDbMock(rows.filter((r) => r.id !== CANDIDATE.id)),
      CANDIDATE,
    );
    expect(activationPreview(rows, CANDIDATE.id)).toBe(
      verdict.ok ? null : verdict.reason,
    );
    expect(activationPreview(rows, CANDIDATE.id)).toBe("OVERLAP");
  });
});
