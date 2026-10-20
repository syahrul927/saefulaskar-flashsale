import { z } from "zod";

import { env } from "@/env";
import { JUBELIO_PATH } from "@/lib/jubelio-path";

const LoginResponse = z.object({
  token: z.string(),
  fullName: z.string(),
  userName: z.string(),
  currentCompany: z.number(),
  nik: z.string().nullish(),
});

export type JubelioLoginResult = {
  token: string;
  fullName: string;
  email: string;
  currentCompany: number;
  nik: string | null;
};

/**
 * Authenticates against the Jubelio API and returns the issued token + profile.
 * Throws an `Error` with the Jubelio-provided code/message (or "Company tidak
 * valid" on a company gate mismatch) so callers can surface it directly.
 */
export async function authenticateWithJubelio(
  email: string,
  password: string,
): Promise<JubelioLoginResult> {
  const res = await fetch(`${env.JUBELIO_HOST}${JUBELIO_PATH.LOGIN}`, {
    method: "POST",
    body: JSON.stringify({ email, password }),
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    let message = "Jubelio authentication failed";
    try {
      const d = (await res.json()) as { message?: string; code?: string };
      message = d.code ?? d.message ?? message;
    } catch {
      // Non-JSON error body — keep the fallback message.
    }
    throw new Error(message);
  }
  const parsed = LoginResponse.parse(await res.json());
  if (parsed.currentCompany !== env.SAFAR_COMPANY_ID) {
    throw new Error("Company tidak valid");
  }
  return {
    token: parsed.token,
    fullName: parsed.fullName,
    email: parsed.userName,
    currentCompany: parsed.currentCompany,
    nik: parsed.nik ?? null,
  };
}
