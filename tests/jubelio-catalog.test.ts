import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JubelioError, type JubelioClient } from "@/lib/jubelio";
import {
  __resetCatalogCache,
  getCatalogRows,
} from "@/server/jubelio-catalog";

/** One live-shaped masters item; mapper output length is what we assert. */
const MASTERS_OK = {
  data: [
    {
      item_group_id: 1,
      item_name: "Kuangyu Dream - SLA",
      sell_price: "3700000.0000",
      variants: JSON.stringify([{ item_id: 2685, item_code: "SKU-1" }]),
    },
  ],
};

function stubClient(listProducts = vi.fn().mockResolvedValue(MASTERS_OK)) {
  return { listProducts } as unknown as JubelioClient;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T04:00:00Z"));
  __resetCatalogCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getCatalogRows", () => {
  it("fetches once and serves cache hits within the 60s TTL", async () => {
    const client = stubClient();
    const first = await getCatalogRows(client);
    vi.setSystemTime(new Date("2026-10-26T04:00:59Z"));
    const second = await getCatalogRows(client);

    expect(client.listProducts).toHaveBeenCalledTimes(1);
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("refetches after the TTL expires", async () => {
    const client = stubClient();
    await getCatalogRows(client);
    vi.setSystemTime(new Date("2026-10-26T04:01:01Z"));
    await getCatalogRows(client);

    expect(client.listProducts).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent calls into one upstream fetch", async () => {
    const client = stubClient();
    const [a, b] = await Promise.all([
      getCatalogRows(client),
      getCatalogRows(client),
    ]);

    expect(client.listProducts).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("keeps the upstream JubelioError when the fetch fails (status 400)", async () => {
    const client = stubClient(
      vi
        .fn()
        .mockRejectedValue(new JubelioError(400, undefined, '"search" is not allowed')),
    );
    await expect(getCatalogRows(client)).rejects.toMatchObject({
      name: "JubelioError",
      status: 400,
      message: '"search" is not allowed',
    });
  });

  it("does not poison the cache on failure — next caller retries and succeeds", async () => {
    const failing = vi
      .fn()
      .mockRejectedValue(
        // Non-JSON upstream body path: request() fell back to this message.
        new JubelioError(500, undefined, "Jubelio request failed: 500"),
      );
    await expect(getCatalogRows(stubClient(failing))).rejects.toMatchObject({
      status: 500,
      message: "Jubelio request failed: 500",
    });

    const ok = stubClient();
    const rows = await getCatalogRows(ok);
    expect(rows).toHaveLength(1);
  });
});
