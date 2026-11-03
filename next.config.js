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
};

export default config;
