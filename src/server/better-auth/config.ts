import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { env } from "@/env";
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
  socialProviders: {
    // Google OAuth for the customer onboarding flow (spec §4.1). Registered
    // only when both credentials are present so the app still boots otherwise.
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
  },
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
      role: { type: "string", required: true, defaultValue: "CUSTOMER" },
      nik: { type: "string", required: false },
      // Session-carried Jubelio profile name — not a DB column.
      fullName: { type: "string", required: true, defaultValue: "" },
    },
  },
  databaseHooks: {
    user: {
      create: {
        // better-auth only creates user rows for Google OAuth customers here
        // (Jubelio login inserts users directly via Drizzle), so default any
        // better-auth-created user to the CUSTOMER role.
        before: async (user) => ({
          data: { ...user, role: "CUSTOMER" },
        }),
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
