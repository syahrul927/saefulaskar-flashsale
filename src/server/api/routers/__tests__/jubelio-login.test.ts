import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticateWithJubelio } from "@/lib/jubelio-login";

describe("authenticateWithJubelio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns token + user on valid creds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          token: "abc",
          fullName: "A",
          userName: "a@b.c",
          currentCompany: 59325,
          nik: null,
        }),
      }),
    );

    const res = await authenticateWithJubelio("a@b.c", "pw");
    expect(res).toMatchObject({
      token: "abc",
      email: "a@b.c",
      currentCompany: 59325,
    });
  });

  it("throws with Jubelio's error message when Jubelio returns non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ message: "Login gagal" }),
      }),
    );

    await expect(authenticateWithJubelio("a@b.c", "bad")).rejects.toThrow(
      "Login gagal",
    );
  });

  it("throws 'Company tidak valid' on company mismatch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          token: "abc",
          fullName: "A",
          userName: "a@b.c",
          currentCompany: 999,
          nik: null,
        }),
      }),
    );

    await expect(authenticateWithJubelio("a@b.c", "pw")).rejects.toThrow(
      "Company tidak valid",
    );
  });

  it("throws fallback message when non-ok response has no code or message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      }),
    );

    await expect(authenticateWithJubelio("a@b.c", "bad")).rejects.toThrow(
      "Jubelio authentication failed",
    );
  });
});
