import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { z } from "zod";

import { authenticateWithJubelio } from "@/lib/jubelio-login";
import { auth } from "@/server/better-auth";
import { db } from "@/server/db";
import { user } from "@/server/db/schema";
import { setSessionCookie } from "better-auth/cookies";
import { getCryptoKey, makeSignature } from "better-auth/crypto";

export const runtime = "nodejs";

const LoginBody = z.object({
  email: z.string(),
  password: z.string(),
});

function error(status: 400 | 401 | 500, message: string) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  let body: z.infer<typeof LoginBody>;
  try {
    body = LoginBody.parse(await request.json());
  } catch {
    return error(400, "Email dan password wajib diisi");
  }

  let result;
  try {
    result = await authenticateWithJubelio(body.email, body.password);
  } catch (e) {
    const message = (e as Error).message;
    console.error("jubelio-login: auth failed", e);
    return error(
      401,
      message.includes("Company tidak valid")
        ? "Company tidak valid"
        : "Username atau Password salah!",
    );
  }

  let row;
  try {
    // Best-effort upsert: create the user row when missing, otherwise refresh
    // name/company/nik. Jubelio credentials are owner credentials — force
    // `role` to OWNER on both insert and update (Google customers log in the
    // other way, so a Jubelio email/password session is always an owner).
    [row] = await db
      .insert(user)
      .values({
        id: randomUUID(),
        name: result.fullName,
        email: result.email.toLowerCase(),
        emailVerified: true,
        role: "OWNER",
        currentCompany: result.currentCompany,
        nik: result.nik,
        token: result.token,
        fullName: result.fullName,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: user.email,
        set: {
          name: result.fullName,
          role: "OWNER",
          currentCompany: result.currentCompany,
          nik: result.nik,
          token: result.token,
          fullName: result.fullName,
          updatedAt: new Date(),
        },
      })
      .returning();
  } catch (e) {
    console.error("jubelio-login: user upsert failed", e);
  }

  if (!row) {
    return error(401, "Gagal menyinkronkan pengguna");
  }

  const authCtx = await auth.$context;
  let session;
  try {
    session = await authCtx.internalAdapter.createSession(row.id);
  } catch (e) {
    console.error("jubelio-login: session create failed", e);
    return error(401, "Gagal membuat sesi");
  }

  // Hand-built better-call ctx. better-call / @better-auth/core are diagonal
  // deps and cannot be imported from app code, so implement just the cookie
  // surface the cookie functions touch, then flush through next/headers.
  const pending: Array<{
    name: string;
    value: string;
    options?: CookieOptions;
  }> = [];
  const ctx = {
    context: authCtx,
    headers: request.headers,
    responseHeaders: new Headers(),
    setCookie(name: string, value: string, options?: CookieOptions) {
      pending.push({ name, value, options });
    },
    async setSignedCookie(
      name: string,
      value: string,
      secret: string,
      options?: CookieOptions,
    ) {
      const signature = await makeSignature(value, secret);
      pending.push({
        name,
        value: `${value}.${signature}`,
        options,
      });
    },
    async getSignedCookie(name: string, secret: string) {
      const raw = getCookieValue(request.headers, name);
      if (!raw) return null;
      const lastDot = raw.lastIndexOf(".");
      if (lastDot < 1) return null;
      const value = raw.slice(0, lastDot);
      const signature = raw.slice(lastDot + 1);
      if (signature.length !== 44 || !signature.endsWith("=")) return null;
      const key = await getCryptoKey(secret);
      const match = await globalThis.crypto.subtle.verify(
        "HMAC",
        key,
        new TextEncoder().encode(signature),
        new TextEncoder().encode(value),
      );
      return match ? value : null;
    },
    getCookie(name: string) {
      return getCookieValue(request.headers, name);
    },
  };

  try {
    await setSessionCookie(
      ctx as never,
      {
        session,
        user: {
          ...row,
          token: result.token,
          fullName: result.fullName,
        } as never,
      },
      false,
    );
  } catch (e) {
    console.error("jubelio-login: cookie set failed", e);
    return error(500, "Gagal membuat sesi");
  }

  const cookieStore = await cookies();
  for (const c of pending) {
    cookieStore.set(c.name, c.value, c.options);
  }

  const userOut = {
    id: row.id,
    name: result.fullName,
    email: result.email.toLowerCase(),
    emailVerified: false,
    image: null,
    role: row.role,
    currentCompany: result.currentCompany,
    nik: result.nik ?? null,
    fullName: result.fullName,
    token: result.token,
  };

  return Response.json({ ok: true, user: userOut }, { status: 200 });
}

type CookieOptions = {
  httpOnly?: boolean;
  maxAge?: number;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
  domain?: string;
  expires?: Date;
};

function getCookieValue(headers: Headers, name: string): string | null {
  const header = headers.get("cookie");
  if (!header) return null;
  for (const entry of header.split("; ")) {
    if (!entry) continue;
    const eqIndex = entry.indexOf("=");
    const key = eqIndex >= 0 ? entry.slice(0, eqIndex) : entry;
    if (key === name) {
      const raw = eqIndex >= 0 ? entry.slice(eqIndex + 1) : "";
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}
