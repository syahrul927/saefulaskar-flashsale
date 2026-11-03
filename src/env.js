import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    BETTER_AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    BETTER_AUTH_GITHUB_CLIENT_ID: z.string(),
    BETTER_AUTH_GITHUB_CLIENT_SECRET: z.string(),
    // Google OAuth for the customer onboarding flow (spec §4.1). Optional so
    // the app still boots without them; the social provider is registered only
    // when both are present.
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    JUBELIO_HOST: z.string().url(),
    SAFAR_COMPANY_ID: z.coerce.number().default(59325),
    // "Default" system account for Jubelio calls with no logged-in user
    // (the order-status sync, customer onboarding). Login (not a static
    // token) issues the bearer used for those calls — see
    // src/server/jubelio-token.ts.
    JUBELIO_SYSTEM_EMAIL: z.string(),
    JUBELIO_SYSTEM_PASSWORD: z.string(),
    JUBELIO_LOCATION_ID: z.coerce.number(),
    JUBELIO_BASE_URL: z
      .string()
      .url()
      .default("https://open.jubelio.com/core-api/"),
    WHATSAPP_NUMBER: z.string(),
    // JSON array string, parsed at runtime (e.g. BANK_ACCOUNTS = '[{"bank":"BCA",...}]')
    BANK_ACCOUNTS: z.string(),
    // Jubelio observation rig (spec §4.7): the secret path segment of the public
    // webhook sink. OPTIONAL on purpose — unset means the sink answers 503 and
    // stores nothing, so a public endpoint that writes to the database is always
    // a deliberate opt-in and never something a fresh clone turns on by default.
    JUBELIO_WEBHOOK_SINK_TOKEN: z.string().optional(),
    // Order-status sync throttle. This is the floor between the "an admin
    // opened the orders page" runs — the only trigger the app has — so a busy
    // dashboard cannot sweep Jubelio on every request. 0 disables the throttle.
    ORDER_SYNC_INTERVAL_MS: z.coerce.number().int().min(0).default(300_000),
    // How long a page render will wait for a due sync before painting with
    // whatever it has (the run keeps going in the background). Keeps the
    // dashboard fast when the upstream sweep is slow.
    ORDER_SYNC_AWAIT_MS: z.coerce.number().int().min(0).default(4_000),
    DATABASE_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_GITHUB_CLIENT_ID: process.env.BETTER_AUTH_GITHUB_CLIENT_ID,
    BETTER_AUTH_GITHUB_CLIENT_SECRET:
      process.env.BETTER_AUTH_GITHUB_CLIENT_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    JUBELIO_HOST: process.env.JUBELIO_HOST,
    SAFAR_COMPANY_ID: process.env.SAFAR_COMPANY_ID,
    JUBELIO_SYSTEM_EMAIL: process.env.JUBELIO_SYSTEM_EMAIL,
    JUBELIO_SYSTEM_PASSWORD: process.env.JUBELIO_SYSTEM_PASSWORD,
    JUBELIO_LOCATION_ID: process.env.JUBELIO_LOCATION_ID,
    JUBELIO_BASE_URL: process.env.JUBELIO_BASE_URL,
    WHATSAPP_NUMBER: process.env.WHATSAPP_NUMBER,
    BANK_ACCOUNTS: process.env.BANK_ACCOUNTS,
    JUBELIO_WEBHOOK_SINK_TOKEN: process.env.JUBELIO_WEBHOOK_SINK_TOKEN,
    ORDER_SYNC_INTERVAL_MS: process.env.ORDER_SYNC_INTERVAL_MS,
    ORDER_SYNC_AWAIT_MS: process.env.ORDER_SYNC_AWAIT_MS,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
