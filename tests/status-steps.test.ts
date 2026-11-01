import { describe, expect, it } from "vitest";

import { buildStatusSteps } from "@/server/status-steps";
import type { StatusHistoryEntry } from "@/server/status-history";

/**
 * One history row, in the shape `listStatusHistory` returns it. Defaults are a
 * real admin UNPAID → CONFIRMED transition (the case the dialog will most often
 * render) so each test overrides only what it is about — including `id`, which
 * the "skips the checkout creation row" cases override and the exact id-list
 * assertions pin, since Task 12 uses it as the React key.
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

/**
 * The row `POST /api/orders` writes inside the checkout transaction
 * (`src/app/api/orders/route.ts:188`): `null → UNPAID`, `source: "checkout"`.
 * Every order created after this feature exists has exactly one of these, and
 * it restates the creation step — hence the skip ruled on in Task 6 review.
 */
const checkoutRow = (o: Partial<StatusHistoryEntry> = {}): StatusHistoryEntry =>
  entry({
    id: "h-checkout",
    fromStatus: null,
    toStatus: "UNPAID",
    source: "checkout",
    actorName: null,
    note: null,
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

  it("says only `oleh admin` for a nameless account, never a deletion", () => {
    // `status-history.ts:69-75` keeps these two cases apart on purpose:
    // `actorName === null` is the FK having zeroed `actor_user_id` when an
    // admin was deleted, while `""` is `full_name`'s default on an account that
    // still exists. Printing "sudah dihapus" for the second would report a
    // deletion that did not happen.
    const nameless = buildStatusSteps({
      status: "CANCEL",
      createdAt: new Date(2026, 9, 28),
      history: [entry({ toStatus: "CANCEL", source: "admin", actorName: "" })],
    });
    expect(nameless[1]?.actorLabel).toBe("oleh admin");

    // Whitespace-only is the same case, not a name of " ".
    const padded = buildStatusSteps({
      status: "CANCEL",
      createdAt: new Date(2026, 9, 28),
      history: [
        entry({ toStatus: "CANCEL", source: "admin", actorName: "   " }),
      ],
    });
    expect(padded[1]?.actorLabel).toBe("oleh admin");
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
    // Two, and the dialog stops there: CANCEL is an end state, so no pending
    // step follows, and no actor is claimed for a transition nobody observed.
    expect(steps).toHaveLength(2);
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

  it("does not repeat the creation step for a fresh order's checkout row", () => {
    // Spec §4.5: `order.created_at` "stays the creation time and the stepper's
    // first step", and `checkout` history rows are "optional, but creation must
    // still render as a step". So the creation step is authoritative and the
    // `null → UNPAID` row restates a transition already on screen.
    const steps = buildStatusSteps({
      status: "UNPAID",
      createdAt: new Date(2026, 9, 28, 19, 4),
      history: [checkoutRow()],
    });
    // The id list is the strong assertion: no `current` (this order's history
    // does NOT predate the feature, so it must not claim that) and no
    // `h-checkout` (its row is skipped, not rendered).
    expect(steps.map((s) => s.id)).toEqual(["created", "pending"]);
    expect(steps.map((s) => s.label)).toEqual([
      "Pesanan dibuat",
      "Menunggu pembayaran",
    ]);
    expect(steps[0]?.timestampLabel).toBe("28 Okt 2026, 19.04");
  });

  it("gives a fresh order one step per distinct transition and no repeated label", () => {
    const steps = buildStatusSteps({
      status: "CONFIRMED",
      createdAt: new Date(2026, 9, 28, 19, 4),
      history: [
        checkoutRow(),
        entry({ id: "h-confirm" }),
      ],
    });
    expect(steps.map((s) => s.id)).toEqual(["created", "h-confirm", "pending"]);
    const labels = steps.map((s) => s.label);
    expect(labels).toEqual([
      "Pesanan dibuat",
      "Dibayar — sales order dibuat",
      "Selesai",
    ]);
    // The behaviour the duplicate would have broken, stated once as a rule:
    // two steps never say the same thing.
    expect(new Set(labels).size).toBe(labels.length);
  });
});
