import { describe, expect, it } from "vitest";

import { buildStatusSteps } from "@/server/status-steps";
import type { StatusHistoryEntry } from "@/server/status-history";

/**
 * One history row, in the shape `listStatusHistory` returns it. Defaults are a
 * real admin UNPAID → CONFIRMED transition (the case the dialog will most often
 * render) so each test overrides only what it is about — `id` is overridden by
 * nothing here because no test pins it, see the note in the implementation.
 */
const entry = (o: Partial<StatusHistoryEntry> = {}): StatusHistoryEntry => ({
  id: "h1",
  fromStatus: "UNPAID",
  toStatus: "CONFIRMED",
  source: "admin",
  actorName: "Rina",
  note: "SO #192626 dibuat",
  createdAt: new Date(2026, 9, 28, 20, 11),
  ...o,
});

describe("buildStatusSteps", () => {
  it("always opens with the creation step, from orders.created_at", () => {
    const steps = buildStatusSteps({
      status: "CONFIRMED",
      createdAt: new Date(2026, 9, 28, 19, 4),
      history: [entry()],
    });
    expect(steps[0]).toEqual({
      id: "created",
      label: "Pesanan dibuat",
      timestampLabel: "28 Okt 2026, 19.04",
      actorLabel: null,
      note: null,
      tone: "done",
    });
  });

  it("renders a history row with its actor, note and timestamp", () => {
    const steps = buildStatusSteps({
      status: "CONFIRMED",
      createdAt: new Date(2026, 9, 28),
      history: [entry()],
    });
    expect(steps[1]).toMatchObject({
      label: "Dibayar — sales order dibuat",
      actorLabel: "oleh Rina",
      note: "SO #192626 dibuat",
      timestampLabel: "28 Okt 2026, 20.11",
      tone: "done",
    });
  });

  it("attributes a sync cancel to the sync, never to a person", () => {
    const steps = buildStatusSteps({
      status: "CANCEL",
      createdAt: new Date(2026, 9, 28),
      history: [
        entry({
          id: "h2",
          fromStatus: "CONFIRMED",
          toStatus: "CANCEL",
          source: "sync",
          actorName: null,
          note: "SO #192626 dihapus di Jubelio — 2 unit kembali ke kuota sesi",
        }),
      ],
    });
    expect(steps[1]).toMatchObject({
      label: "Dibatalkan",
      actorLabel: "sinkronisasi Jubelio",
      tone: "cancel",
    });
  });

  it("names a deleted admin instead of dropping the step", () => {
    const steps = buildStatusSteps({
      status: "CANCEL",
      createdAt: new Date(2026, 9, 28),
      history: [entry({ toStatus: "CANCEL", source: "admin", actorName: null })],
    });
    expect(steps[1]?.actorLabel).toBe("oleh admin yang sudah dihapus");
  });

  it("adds a muted, timestamp-free step when the order predates history", () => {
    const steps = buildStatusSteps({
      status: "CONFIRMED",
      createdAt: new Date(2026, 9, 28),
      history: [],
    });
    // Three, not two: the pre-history `current` step and the `pending` step are
    // different statements (spec §4.5 vs §4.6.3) and both apply to a live order
    // that has no rows — the same thing the live-order test below asserts for
    // UNPAID. A cancelled order is the one that stops at two.
    expect(steps).toHaveLength(3);
    expect(steps[1]).toEqual({
      id: "current",
      label: "Dikonfirmasi",
      timestampLabel: null,
      actorLabel: null,
      note: "Tercatat sebelum riwayat status aktif",
      tone: "unknown",
    });
  });

  it("says a pre-history order is cancelled without claiming who did it", () => {
    const steps = buildStatusSteps({
      status: "CANCEL",
      createdAt: new Date(2026, 9, 28),
      history: [],
    });
    expect(steps[1]).toMatchObject({
      label: "Dibatalkan",
      actorLabel: null,
      timestampLabel: null,
      tone: "cancel",
    });
  });

  it("adds one pending step for a live order and none after an end state", () => {
    const unpaid = buildStatusSteps({
      status: "UNPAID",
      createdAt: new Date(2026, 9, 28),
      history: [],
    });
    expect(unpaid.at(-1)).toMatchObject({
      id: "pending",
      label: "Menunggu pembayaran",
      tone: "pending",
      timestampLabel: null,
    });
    expect(
      buildStatusSteps({
        status: "CANCEL",
        createdAt: new Date(2026, 9, 28),
        history: [],
      }).at(-1)?.tone,
    ).not.toBe("pending");
    expect(
      buildStatusSteps({
        status: "COMPLETED",
        createdAt: new Date(2026, 9, 28),
        history: [entry({ toStatus: "COMPLETED", fromStatus: "CONFIRMED" })],
      }).at(-1)?.tone,
    ).toBe("done");
  });
});
