import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const srcDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(srcDir, "src"),
    },
  },
  test: {
    environment: "node",
    // Minimal env so @/env (t3-env) validates in tests. These are dummy,
    // non-secret values — the helper is tested with stubbed fetch/real logic.
    env: {
      NODE_ENV: "test",
      JUBELIO_HOST: "https://api2.jubelio.com",
      SAFAR_COMPANY_ID: "59325",
      JUBELIO_ACCESS_TOKEN: "test-access-token",
      JUBELIO_LOCATION_ID: "1",
      JUBELIO_BASE_URL: "https://open.jubelio.com/core-api/",
      WHATSAPP_NUMBER: "628123456789",
      BANK_ACCOUNTS:
        '[{"bank":"BCA","account_number":"123","account_name":"Test"}]',
      CRON_SECRET: "test-cron-secret",
      DATABASE_URL:
        "postgresql://postgres:password@localhost:5432/saefulaskar-flash-sale",
      BETTER_AUTH_GITHUB_CLIENT_ID: "test-client-id",
      BETTER_AUTH_GITHUB_CLIENT_SECRET: "test-client-secret",
    },
  },
});
