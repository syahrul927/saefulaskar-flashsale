import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "@/server/db";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  // emailAndPassword stays disabled: Jubelio is the source of truth for
  // credentials — login happens against the Jubelio API, never against a
  // local password. Sessions are created directly from the synced user row
  // (internalAdapter.createSession + setSessionCookie), not signInEmail.
  // emailAndPassword: {
  //   enabled: true,
  // },
  session: {
    // 2h session TTL — matches the Jubelio reference implementation.
    expiresIn: 7200,
    // JWT cookie cache lets session reads work without hitting the DB
    // (stateless-ish). Compact-cache fallback is not used.
    cookieCache: {
      enabled: true,
      strategy: "jwt",
      maxAge: 3600,
    },
  },
  user: {
    additionalFields: {
      // Raw Jubelio API token stored on the user row (NOT better-auth's
      // own session.token). Carried on the session user for Jubelio calls.
      token: { type: "string", required: true, defaultValue: "" },
      currentCompany: { type: "number", required: true, defaultValue: 59325 },
      role: { type: "string", required: true, defaultValue: "STAFF" },
      nik: { type: "string", required: false },
      // Session-carried Jubelio profile name — not a DB column.
      fullName: { type: "string", required: true, defaultValue: "" },
    },
  },
  // GitHub social provider removed from active flows — Jubelio login
  // replaces it. Re-enable here if needed later:
  // socialProviders: {
  //   github: {
  //     clientId: env.BETTER_AUTH_GITHUB_CLIENT_ID,
  //     clientSecret: env.BETTER_AUTH_GITHUB_CLIENT_SECRET,
  //   },
  // },
});

export type Session = typeof auth.$Infer.Session;
