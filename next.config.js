/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  images: {
    // Vercel rejects `images.unoptimized` in vercel.json ("should NOT have
    // additional property") — for Next.js it reads this file instead.
    // Originals pass through: no platform resize, no per-request image
    // optimization billing.
    unoptimized: true,
  },
  eslint: {
    // `next build` lints the WHOLE repo, and the repo carries known style
    // debt it does not want a deploy to trip on: vendored shadcn copies
    // (`src/components/ui/chart.tsx`, `toggle-group.tsx`, `code-block.tsx`)
    // and deliberate blocks like `confirm/route.ts:116-118` where `||` is the
    // intended semantics (`??` is NOT equivalent there). The gate is
    // `yarn lint`, which every change runs against its touched files;
    // typechecking stays on (this disables ESLint only, not `tsc` — the
    // build still fails on type errors, and `tsc --noEmit` is green).
    ignoreDuringBuilds: true,
  },
};

export default config;
