import { env } from "@/env";
import { authenticateWithJubelio } from "@/lib/jubelio-login";
import { createJubelioClient, isJubelioAuthError, type JubelioClient } from "@/lib/jubelio";

/**
 * System-account token for Jubelio calls that don't run under a logged-in
 * (Jubelio) user — e.g. the daily sync cron and customer onboarding. The
 * account is the "default" system user: `JUBELIO_SYSTEM_EMAIL` +
 * `JUBELIO_SYSTEM_PASSWORD` (no static API token).
 *
 * The token is cached in-memory; a Jubelio 401 invalidates it and re-logs in
 * (the login endpoint is idempotent), so a token rotation doesn't wedge the
 * cron.
 */

let cached: string | null = null;

export async function getSystemToken(): Promise<string> {
  if (cached) return cached;
  const result = await authenticateWithJubelio(
    env.JUBELIO_SYSTEM_EMAIL,
    env.JUBELIO_SYSTEM_PASSWORD,
  );
  cached = result.token;
  return result.token;
}

export function invalidateSystemToken(): void {
  cached = null;
}

/**
 * Run a Jubelio call authenticated as the system account, re-logging-in and
 * retrying exactly once if the token was rejected (401).
 */
export async function withSystemClient<T>(
  fn: (client: JubelioClient) => Promise<T>,
): Promise<T> {
  try {
    return await fn(createJubelioClient(await getSystemToken()));
  } catch (e) {
    if (!isJubelioAuthError(e)) throw e;
    invalidateSystemToken();
    return await fn(createJubelioClient(await getSystemToken()));
  }
}